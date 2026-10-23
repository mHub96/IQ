/**
 * App shell: the app's permanent frame.
 *
 * Every page of the site is a "view" that is loaded once and then kept running in its own
 * frame. Switching tabs only shows another live view: nothing reloads, so the switch is
 * instant and each tab keeps its scroll position, open sections and data. The tab views
 * are warmed up in the background after the first screen, so even the first switch is instant.
 * Pages talk to the shell through app-view.js (window.HubView inside a view).
 *
 * Back button / gesture (as in native apps): it closes the pop-up on top first (sheet, dialog,
 * drawer), then returns to the screen the user came from inside the app; from a tab it returns to
 * the home tab (switching tabs does not pile up history); on the home screen of the installed app a
 * first press says "press again to exit". The shell owns the history: views never add entries of
 * their own (app-view.js hands their pushes, hash links and pop-ups to the shell).
 */
(function () {
    'use strict';

    // Pages that run inside the shell, and the tab each one belongs to.
    const PAGES = ['index.html', 'Home.html', 'schedule.html', 'icu.html', 'specialists.html', 'residents.html',
        'signup.html', 'admin.html', 'scheduler.html', 'account.html', 'emergency.html', 's.html'];
    const TAB_OF = { 'index.html': 'home', 'Home.html': 'home', 'schedule.html': 'schedule', 'icu.html': 'icu',
        'specialists.html': 'specialists', 'residents.html': 'residents', 'signup.html': 'signup' };
    const TAB_PAGE = { home: 'index.html', schedule: 'schedule.html', icu: 'icu.html', specialists: 'specialists.html',
        residents: 'residents.html', signup: 'signup.html' };
    const MAX_VIEWS = 9;               // live views kept in memory (least recently used ones are released)
    const HOME_ROUTE = 'index.html?portal=true';

    const base = new URL('./', location.href);
    const viewsEl = document.getElementById('app-views');
    const tabbar = document.getElementById('app-tabbar');
    const pill = tabbar.querySelector('.app-tab-pill');
    const splash = document.getElementById('app-splash');

    /** page file -> { page, frame, hosp, overlay, stale, ready, lastShown } */
    const views = new Map();
    let active = null;

    // History bookkeeping (see "History" below).
    const STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    let depth = 0;          // depth of the entry on screen
    let ignorePops = 0;     // back steps taken by the shell itself (their popstate is not a user's back)
    const afterPop = [];    // what to do once those steps are done
    let restoring = false;  // pop-ups being closed by the shell itself (not by their own buttons)
    const routeOf = u => u.pathname.slice(base.pathname.length) + u.search + u.hash;

    const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const signedIn = () => !!read('hospital_hub_session_role');

    // ------------------------------------------------------------------
    // Administrative Affairs division context
    // ------------------------------------------------------------------
    // Officers of a division always use their own division. The owner and a hospital's admins enter
    // it from the hospital card (?aa=<hospital>); while inside, every tab opens the division's
    // version of its page (the pages switch data on the aa parameter, see hub-core.js) and the
    // doctors-only tabs are hidden. The hub (the portal without ?aa, from the home tab or a page's
    // hub button) is each user's own: the hospitals hub for them, the division hub for officers.
    const AA_ROLES = ['aa_user', 'aa_admin'];
    const AA_PAGES = ['index.html', 'Home.html', 'schedule.html', 'signup.html', 'admin.html', 'scheduler.html'];
    const NEUTRAL_PAGES = ['account.html'];   // the same in and out of a division
    const AA_KEY = 'hub_aa_ctx';
    const role = () => read('hospital_hub_session_role') || '';
    function officerHosp() {
        if (!AA_ROLES.includes(role())) return null;
        try { return (JSON.parse(read('hospital_hub_account') || 'null') || {}).hosp || null; } catch (e) { return null; }
    }
    function mayEnter(h) {
        if (role() === 'owner') return true;
        if (role() !== 'admin') return false;
        try { const scope = JSON.parse(read('hospital_hub_session_admin_hospitals') || '[]'); return scope.includes('*') || scope.includes(h); } catch (e) { return false; }
    }
    function aaContext() {
        const own = officerHosp();
        if (own) return own;
        let h = null;
        try { h = sessionStorage.getItem(AA_KEY); } catch (e) {}
        return h && mayEnter(h) ? h : null;
    }
    function setAaContext(h) {
        const before = aaContext();
        try { if (h) sessionStorage.setItem(AA_KEY, h); else sessionStorage.removeItem(AA_KEY); } catch (e) {}
        if (aaContext() !== before) for (const v of views.values()) v.stale = true;   // every view reloads in the new mode
    }
    /** The address a page should really open at in the current context (enters / leaves the division on ?aa=). */
    function contextual(url, page) {
        const wanted = url.searchParams.get('aa');
        if (wanted !== null) {
            if (wanted === 'off' || wanted === '') setAaContext(null);
            else if (mayEnter(wanted)) setAaContext(wanted);
        }
        if (NEUTRAL_PAGES.includes(page)) { url.searchParams.delete('aa'); return url; }
        // The owner / an admin going to the hub (no ?aa) leaves the division.
        if (page === 'index.html' && wanted === null && !officerHosp()) setAaContext(null);
        const ctx = aaContext();
        if (!ctx) { url.searchParams.delete('aa'); return url; }
        if (!AA_PAGES.includes(page)) {
            // Doctors-only page: officers stay in their division; the owner or an admin leaves it.
            if (officerHosp()) return new URL(HOME_ROUTE + '&aa=' + encodeURIComponent(ctx), base);
            setAaContext(null);
            url.searchParams.delete('aa');
            return url;
        }
        url.searchParams.set('aa', ctx);
        if (page !== 'index.html') url.searchParams.set('hospital', ctx);
        return url;
    }
    // Views are re-pointed when the hospital or the division context changes.
    const hospital = () => (read('hospital_hub_active_id') || '') + '|' + (aaContext() || '');

    function pageOf(href) {
        let u;
        try { u = new URL(href, base); } catch (e) { return null; }
        if (u.origin !== location.origin || !u.pathname.startsWith(base.pathname)) return null;
        const rel = u.pathname.slice(base.pathname.length) || 'index.html';
        return PAGES.includes(rel) ? rel : null;
    }
    const docKey = u => u.pathname + u.search;
    function viewLocation(v) {
        try { return new URL(v.frame.contentWindow.location.href); } catch (e) { return null; }
    }
    function viewOf(win) {
        for (const v of views.values()) if (v.frame.contentWindow === win) return v;
        return null;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function createView(page, url) {
        const frame = document.createElement('iframe');
        frame.className = 'app-view';
        frame.title = page;
        frame.setAttribute('allow', 'clipboard-write; web-share; fullscreen');
        const v = { page, frame, hosp: hospital(), overlay: false, stale: false, ready: false, lastShown: 0, pendingUrl: url.href };
        frame.addEventListener('load', () => onViewLoad(v));
        frame.src = url.href;
        views.set(page, v);
        viewsEl.appendChild(frame);
        return v;
    }

    function removeView(v) {
        if (views.get(v.page) === v) views.delete(v.page);
        try { v.frame.contentWindow.HubView && v.frame.contentWindow.HubView._setActive(false); } catch (e) {}
        v.frame.remove();
        if (active === v) active = null;
    }

    /** Navigates an existing view without adding a history entry. */
    function navigateView(v, url) {
        v.ready = false;
        v.hosp = hospital();
        v.pendingUrl = url.href;
        try {
            const w = v.frame.contentWindow;
            if (w.HubView) w.HubView._allow = url.href;
            w.location.replace(url.href);
        } catch (e) { v.frame.src = url.href; }
    }

    // A view finished loading. Pages can still navigate on their own (location.href = …): the view
    // then simply belongs to the page it arrived at.
    function onViewLoad(v) {
        const loc = viewLocation(v);
        if (!loc) return;
        const page = pageOf(loc.href);
        if (!page) {
            // The view left the app (app.html itself, or an unknown page): bring it back to the portal.
            if (loc.pathname.endsWith('/app.html')) { removeView(v); go(loc.hash.slice(1) || HOME_ROUTE); }
            return;
        }
        // A page that navigated itself (no Navigation API) into the wrong mode is re-pointed.
        const ctxUrl = contextual(new URL(loc.href), page);
        if (docKey(ctxUrl) !== docKey(loc)) { navigateView(v, ctxUrl); return; }
        if (page !== v.page) {
            const other = views.get(page);
            if (other && other !== v) {
                // Two views on one page: keep the one on screen.
                if (active === other) { removeView(v); return; }
                removeView(other);
            }
            if (views.get(v.page) === v) views.delete(v.page);
            v.page = page;
            v.frame.title = page;
            views.set(page, v);
        }
        v.pendingUrl = null;
        if (v === active) { setViewActive(v, true); syncChrome(); }
        else setViewActive(v, false);
    }

    function setViewActive(v, on) {
        try { const hv = v.frame.contentWindow.HubView; if (hv) hv._setActive(on); } catch (e) {}
    }

    function show(v) {
        if (active && active !== v) {
            active.frame.classList.remove('active');
            setViewActive(active, false);
        }
        active = v;
        v.lastShown = Date.now();
        // A view left behind by a sign-in, sign-out or theme change elsewhere is refreshed now.
        if (v.stale) {
            v.stale = false;
            const loc = viewLocation(v);
            if (loc) navigateView(v, contextual(loc, v.page));
        }
        v.frame.classList.add('active');
        setViewActive(v, true);
        syncChrome();
        trim();
    }

    function trim() {
        if (views.size <= MAX_VIEWS) return;
        const spare = [...views.values()].filter(v => v !== active)
            .sort((a, b) => (TAB_OF[a.page] ? 1 : 0) - (TAB_OF[b.page] ? 1 : 0) || a.lastShown - b.lastShown);
        while (views.size > MAX_VIEWS && spare.length) removeView(spare.shift());
    }

    /**
     * Opens a URL of the app: shows its live view, loading or re-pointing it only when needed.
     * how: 'push' = a new screen the user opened (one back step returns), 'none' = the current entry.
     */
    function go(href, how = 'none') {
        let url = new URL(href, base);
        const page = pageOf(url.href);
        if (!page) { location.href = url.href; return; }
        url = contextual(url, page);
        if (how === 'push') {
            const cur = active ? viewLocation(active) : null;
            if (!active || active.page !== page || !cur || docKey(cur) !== docKey(url) || cur.hash !== url.hash) navEntry(routeOf(url));
        }
        let v = views.get(page);
        if (!v) {
            v = createView(page, url);
        } else if (v.stale) {
            v.stale = false;
            navigateView(v, url);
        } else {
            const cur = viewLocation(v);
            const target = v.pendingUrl ? new URL(v.pendingUrl) : cur;
            if (!target || docKey(target) !== docKey(url)) navigateView(v, url);
            else if (url.hash && cur && cur.hash !== url.hash) { try { v.frame.contentWindow.location.replace(url.href); } catch (e) {} }
        }
        show(v);
    }

    // ------------------------------------------------------------------
    // Tab bar, title, address
    // ------------------------------------------------------------------
    function syncChrome() {
        if (!active) return;
        const tab = TAB_OF[active.page] || null;
        tabbar.querySelectorAll('.app-tab').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
        placePill(tab);
        tabbar.classList.toggle('covered', !!active.overlay);
        tabbar.classList.toggle('off', !signedIn());      // the sign-in screen has no tabs
        tabbar.classList.toggle('aa', !!aaContext());      // division: roster, schedule and exchange only
        let title = '';
        try { title = active.frame.contentDocument.title; } catch (e) {}
        if (title) document.title = title;
        const loc = viewLocation(active);
        const pend = active.pendingUrl ? new URL(active.pendingUrl) : null;
        const u = pend || (loc && pageOf(loc.href) ? loc : null);
        if (u) {
            const route = routeOf(u);
            const st = history.state && history.state.hub ? history.state : { hub: 1, depth, ov: 0 };
            try { history.replaceState({ ...st, route }, '', '#' + route); } catch (e) {}
            write('app_last_route', route);
        }
    }

    function placePill(tab) {
        const el = tab && tabbar.querySelector(`.app-tab[data-tab="${tab}"]`);
        if (!el) { pill.classList.remove('on'); return; }
        pill.style.width = el.offsetWidth + 'px';
        pill.style.transform = `translateX(${el.offsetLeft}px)`;
        pill.classList.add('on');
    }
    window.addEventListener('resize', () => active && placePill(TAB_OF[active.page]));

    function tabUrl(tab) {
        const ctx = aaContext();
        if (tab === 'home') return HOME_ROUTE;   // each user's own hub (see contextual)
        if (ctx) return TAB_PAGE[tab] + '?hospital=' + encodeURIComponent(ctx) + '&aa=' + encodeURIComponent(ctx);
        const h = read('hospital_hub_active_id') || '';
        return TAB_PAGE[tab] + (h ? '?hospital=' + encodeURIComponent(h) : '');
    }

    tabbar.addEventListener('click', e => {
        const a = e.target.closest('.app-tab');
        if (!a) return;
        e.preventDefault();
        const tab = a.dataset.tab;
        // Tapping the tab you are on scrolls it back to the top, as on iOS. The division's hub is not the
        // owner's / an admin's home: for them the home tab goes back to the hospitals hub.
        const leavingDivision = tab === 'home' && !!aaContext() && !officerHosp();
        if (active && TAB_OF[active.page] === tab && (tab !== 'home' || active.page === 'index.html') && !leavingDivision) {
            try { active.frame.contentWindow.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e2) {}
            return;
        }
        const page = TAB_PAGE[tab];
        arm();
        // History: home is the bottom screen and any other tab sits right above it, so back from a tab
        // returns home. A tab takes the place of the tab before it (its entry is reused, not added again).
        const H = homeDepth();
        const open = () => {
            const v = leavingDivision ? null : views.get(page);
            // A warm view for the same hospital is shown as it is, exactly where the user left it.
            if (tab !== 'home' && v && !v.stale && v.hosp === hospital() && !v.pendingUrl) show(v);
            else go(tabUrl(tab));
        };
        if (tab === 'home') { unwindTo(H, open); return; }
        if (depth === H) { pushEntry(tabUrl(tab)); open(); return; }   // from home: one step up
        unwindTo(H + 1, open);                                           // from a tab (or deeper): that step is reused
    });

    // ------------------------------------------------------------------
    // Background warm-up of the tab views
    // ------------------------------------------------------------------
    let warmed = false;
    function warmUp() {
        if (warmed || !signedIn()) return;   // signed-out visitors only see the sign-in screen
        warmed = true;
        const conn = navigator.connection || {};
        if (conn.saveData || (navigator.deviceMemory && navigator.deviceMemory < 2)) return;
        const inDivision = !!aaContext();
        const queue = Object.keys(TAB_PAGE).filter(t => t !== 'home' && !(inDivision && !AA_PAGES.includes(TAB_PAGE[t])))
            .map(t => ({ page: TAB_PAGE[t], tab: t }));
        const idle = cb => (window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 300));
        const next = () => {
            if (!signedIn()) { warmed = false; return; }
            const item = queue.shift();
            if (!item) return;
            if (views.has(item.page)) { idle(next); return; }
            const v = createView(item.page, new URL(tabUrl(item.tab), base));
            let done = false;
            const step = () => { if (done) return; done = true; setTimeout(() => idle(next), 350); };
            v.frame.addEventListener('load', step, { once: true });
            setTimeout(step, 8000);
        };
        setTimeout(() => idle(next), 1200);
    }

    // ------------------------------------------------------------------
    // Messages from the views (window.HubView in app-view.js)
    // ------------------------------------------------------------------
    window.HubShell = {
        go: (href, how) => { if (how !== 'replace') arm(); go(href, how === 'replace' ? 'none' : 'push'); },
        /** The user touched the page (the first touch lays the base history entries). */
        _interact() { arm(); },
        isActive: win => !!active && active.frame.contentWindow === win,
        /** The view on screen is about to move in place (a hash link, pushState): one back step returns here. */
        _push(win) {
            const v = viewOf(win);
            if (!v || v !== active) return;
            arm();
            const loc = viewLocation(v);
            if (loc) navEntry(routeOf(loc));
        },
        /** A view is ready to be seen (its first screen has rendered). */
        _ready(win) {
            const v = viewOf(win);
            if (!v) return;
            v.ready = true;
            if (v === active) { syncChrome(); hideSplash(); warmUp(); }
        },
        /** The view's address or title changed in place (hash, pushState, title). */
        _changed(win) { const v = viewOf(win); if (v && v === active) syncChrome(); },
        /**
         * The number of pop-ups open inside a view changed: the tab bar steps aside under them, and each
         * one opened on screen gets a history entry (back closes it); one closed by its own button gives
         * its entry back.
         */
        _overlay(win, count) {
            const v = viewOf(win);
            if (!v) return;
            count = Number(count) || 0;
            v.overlay = count > 0;
            if (v !== active) return;
            tabbar.classList.toggle('covered', v.overlay);
            if (!armed) return;
            const have = currentOv();
            if (count > have) {
                const loc = viewLocation(v);
                const route = loc ? routeOf(loc) : (history.state && history.state.route) || HOME_ROUTE;
                for (let n = have + 1; n <= count; n++) pushEntry(route, n);
            } else if (count < have && !restoring) {
                unwindBy(have - count);
            }
        },
    };

    function hideSplash() {
        if (!splash || splash.classList.contains('gone')) return;
        splash.classList.add('gone');
        setTimeout(() => splash.remove(), 400);
    }
    setTimeout(hideSplash, 5000);

    // ------------------------------------------------------------------
    // Sign-in, sign-out and theme changes made in one view reach the others
    // ------------------------------------------------------------------
    const bareKey = k => String(k || '').replace(/^IQ-[^:]+:/, '');
    function markOthersStale() {
        for (const v of views.values()) if (v !== active) v.stale = true;
    }
    window.addEventListener('storage', e => {
        const k = bareKey(e.key);
        if (e.key === null || k === 'hospital_hub_session_role' || k === 'hospital_hub_session_admin_hospitals') {
            if (e.oldValue !== e.newValue) markOthersStale();
            if (signedIn()) setTimeout(warmUp, 1500);
            syncChrome();
        } else if (k === 'hospital_hub_account') {
            const id = s => { try { return (JSON.parse(s || 'null') || {}).id || null; } catch (x) { return null; } };
            if (id(e.oldValue) !== id(e.newValue)) markOthersStale();
        } else if (k === 'hospital_hub_theme') {
            applyTheme();
            markOthersStale();
        }
    });
    function applyTheme() {
        const dark = read('hospital_hub_theme') === 'dark';
        document.documentElement.classList.toggle('dark', dark);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', dark ? '#000000' : '#F2F2F7');
    }
    applyTheme();

    // Notification taps: the service worker hands the address to the running app.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', e => {
            if (e.data && e.data.type === 'app:open' && e.data.url) go(e.data.url, 'push');
        });
    }
    window.addEventListener('hashchange', () => {
        const route = location.hash.slice(1);
        if (!route || !active) return;
        const cur = viewLocation(active);
        const want = new URL(route, base);
        if (!cur || docKey(cur) !== docKey(want) || cur.hash !== want.hash) go(want.href);
    });

    // ------------------------------------------------------------------
    // History (back button / gesture)
    // ------------------------------------------------------------------
    // Every entry the shell adds: { hub: 1, depth, route, ov } (ov = pop-ups open at that entry). In the
    // installed app a "sentinel" entry sits under home, so the first back on home asks before leaving.
    function homeDepth() { return STANDALONE ? 1 : 0; }
    function currentOv() { return history.state && history.state.hub ? (history.state.ov || 0) : 0; }
    function pushEntry(route, ov = 0) {
        if (!armed) return;
        depth++;
        try { history.pushState({ hub: 1, depth, route, ov }, '', '#' + route); } catch (e) {}
    }
    const isHomeRoute = route => {
        const u = new URL(route || HOME_ROUTE, base);
        return pageOf(u.href) === 'index.html' && !u.hash && /portal=true/.test(u.search) && !u.searchParams.get('aa');
    };
    /**
     * The base entries are laid on the first touch of the app (never while it loads: Chrome skips, on
     * back, a screen that added history without the user touching it): (a "press again to exit" entry
     * in the installed app,) home, then the screen the app opened on (a link, a notification).
     */
    let armed = false;
    function arm() {
        if (armed) return;
        armed = true;
        const st = history.state && history.state.hub ? history.state : null;
        const route = (st && st.route) || HOME_ROUTE;
        depth = 0;
        try { history.replaceState({ hub: 1, depth: 0, route: HOME_ROUTE, ov: 0, sentinel: STANDALONE || undefined }, '', '#' + HOME_ROUTE); } catch (e) {}
        if (STANDALONE) pushEntry(HOME_ROUTE);
        if (!isHomeRoute(route)) pushEntry(route);
        // Pop-ups already open on that screen.
        const n = active ? overlaysOf(active) : 0;
        for (let i = 1; i <= n; i++) pushEntry(route, i);
    }
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
    /**
     * A new screen the user opens. From inside a pop-up (a link in a sheet), the pop-up closes and the new
     * screen takes its back step, as in native apps (the stale pop-up entries under it are skipped on back).
     */
    function navEntry(route) {
        if (currentOv() > 0 && active) {
            restoring = true;
            let guard = 8;
            while (overlaysOf(active) > 0 && guard-- > 0 && closeTop(active)) {}
            setTimeout(() => { restoring = false; }, 400);
            try { history.replaceState({ hub: 1, depth, route, ov: 0 }, '', '#' + route); } catch (e) {}
            return;
        }
        pushEntry(route);
    }

    /** Goes back `n` entries without acting on them (they were already undone on screen). */
    function unwindBy(n) {
        if (n <= 0) return;
        ignorePops++;
        history.go(-n);
    }
    /** Goes back to `target` depth, then runs `then` (immediately when already there). */
    function unwindTo(target, then) {
        if (depth <= target) { then(); return; }
        ignorePops++;
        afterPop.push(then);
        history.go(target - depth);
    }

    /** Closes the top pop-up of a view; false when it has none or would not close. */
    function closeTop(v) {
        try { return !!v.frame.contentWindow.HubView._closeTop(); } catch (e) { return false; }
    }
    function overlaysOf(v) {
        try { return v.frame.contentWindow.HubView._overlays(); } catch (e) { return 0; }
    }

    window.addEventListener('popstate', e => {
        const s = e.state;
        if (ignorePops > 0) {
            ignorePops--;
            if (s && s.hub) depth = s.depth;
            if (!ignorePops && afterPop.length) afterPop.splice(0).forEach(f => f());
            return;
        }
        if (!s || !s.hub) return;               // an address from before the app: the browser handles it
        const backwards = s.depth < depth;
        depth = s.depth;
        if (s.sentinel) { askBeforeLeaving(); return; }
        const url = new URL(s.route || HOME_ROUTE, base);
        const page = pageOf(url.href);
        restoring = true;
        try {
            // 1. Pop-ups above this entry close, the top one first.
            if (active && active.page === page) {
                let open = overlaysOf(active), guard = 6;
                while (open > (s.ov || 0) && guard-- > 0 && closeTop(active)) open = overlaysOf(active);
            }
            // 2. The screen of this entry (another view, or the same one at another address).
            go(url.href);
        } finally {
            setTimeout(() => { restoring = false; }, 400);
        }
        // An entry for a pop-up that is no longer open (it was replaced, or the screen changed): skip it.
        if ((s.ov || 0) > 0 && active && overlaysOf(active) < s.ov) {
            if (backwards) history.back(); else history.forward();
        }
    });

    // Installed app, home screen: the first back press asks, the second within 2 s leaves the app.
    let askedAt = 0;
    function askBeforeLeaving() {
        if (Date.now() - askedAt < 2000) { ignorePops++; history.back(); return; }
        askedAt = Date.now();
        pushEntry(HOME_ROUTE);
        go(HOME_ROUTE);
        toast('اضغط رجوع مرة أخرى للخروج');
    }
    function toast(text) {
        let el = document.getElementById('app-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'app-toast';
            el.setAttribute('role', 'status');
            el.style.cssText = 'position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483600;'
                + 'background:rgba(28,28,30,.92);color:#fff;font:700 13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:999px;'
                + 'box-shadow:0 6px 24px rgba(0,0,0,.25);transition:opacity .25s;pointer-events:none;direction:rtl;white-space:nowrap';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
    }

    // ------------------------------------------------------------------
    // Start: the address after # (shared links, notifications), else where the user last was
    // ------------------------------------------------------------------
    if (history.state && history.state.hub && history.state.armed !== false && history.state.depth > 0) {
        // A reload: the entries are still there.
        armed = true;
        depth = history.state.depth;
        go(history.state.route || HOME_ROUTE);
    } else {
        let start = location.hash.slice(1);
        if (!start || !pageOf(new URL(start, base).href)) {
            const last = read('app_last_route');
            start = (STANDALONE && last && pageOf(new URL(last, base).href)) ? last : HOME_ROUTE;
        }
        // One entry for now (the screen opened); the rest is laid on the first touch (arm).
        depth = 0;
        try { history.replaceState({ hub: 1, depth: 0, route: start, ov: 0 }, '', '#' + start); } catch (e) {}
        go(start);
    }
})();
