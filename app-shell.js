/**
 * App shell: the app's permanent frame.
 *
 * Every page of the site is a "view" that is loaded once and then kept running in its own
 * frame. Switching tabs only shows another live view: nothing reloads, so the switch is
 * instant and each tab keeps its scroll position, open sections and data. The tab views
 * are warmed up in the background after the first screen, so even the first switch is instant.
 * Pages talk to the shell through app-view.js (window.HubView inside a view).
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

    const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const signedIn = () => !!read('hospital_hub_session_role');

    // ------------------------------------------------------------------
    // Administrative Affairs division context
    // ------------------------------------------------------------------
    // Officers of a division always use their own division. The owner and a hospital's admins enter
    // it from the hospital card (?aa=<hospital>) and leave with ?aa=off; while inside, every tab
    // opens the division's version of its page (the pages switch data on the aa parameter, see
    // hub-core.js) and the doctors-only tabs are hidden.
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
        const ctx = aaContext();
        if (NEUTRAL_PAGES.includes(page)) { url.searchParams.delete('aa'); return url; }
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

    /** Opens a URL of the app: shows its live view, loading or re-pointing it only when needed. */
    function go(href) {
        let url = new URL(href, base);
        const page = pageOf(url.href);
        if (!page) { location.href = url.href; return; }
        url = contextual(url, page);
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
        tabbar.classList.toggle('rotator', read('hospital_hub_session_role') === 'rotator'); // no duty exchange tab
        tabbar.classList.toggle('aa', !!aaContext());      // division: roster, schedule and exchange only
        tabbar.classList.toggle('aa-exit', !!aaContext() && !officerHosp());
        let title = '';
        try { title = active.frame.contentDocument.title; } catch (e) {}
        if (title) document.title = title;
        const loc = viewLocation(active);
        const pend = active.pendingUrl ? new URL(active.pendingUrl) : null;
        const u = pend || (loc && pageOf(loc.href) ? loc : null);
        if (u) {
            const route = u.pathname.slice(base.pathname.length) + u.search + u.hash;
            try { history.replaceState(history.state, '', '#' + route); } catch (e) {}
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
        if (ctx) return (tab === 'home' ? HOME_ROUTE + '&' : TAB_PAGE[tab] + '?hospital=' + encodeURIComponent(ctx) + '&') + 'aa=' + encodeURIComponent(ctx);
        if (tab === 'home') return HOME_ROUTE;
        const h = read('hospital_hub_active_id') || '';
        return TAB_PAGE[tab] + (h ? '?hospital=' + encodeURIComponent(h) : '');
    }

    tabbar.addEventListener('click', e => {
        const a = e.target.closest('.app-tab');
        if (!a) return;
        e.preventDefault();
        const tab = a.dataset.tab;
        if (tab === 'aa-exit') { go(HOME_ROUTE + '&aa=off'); return; }
        // Tapping the tab you are on scrolls it back to the top, as on iOS.
        if (active && TAB_OF[active.page] === tab && (tab !== 'home' || active.page === 'index.html')) {
            try { active.frame.contentWindow.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e2) {}
            return;
        }
        const page = TAB_PAGE[tab];
        const v = views.get(page);
        // A warm view for the same hospital is shown as it is, exactly where the user left it.
        if (v && !v.stale && v.hosp === hospital() && !v.pendingUrl) { show(v); return; }
        go(tabUrl(tab));
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
        const rotator = read('hospital_hub_session_role') === 'rotator';
        const inDivision = !!aaContext();
        const queue = Object.keys(TAB_PAGE).filter(t => t !== 'home' && !(rotator && t === 'signup') && !(inDivision && !AA_PAGES.includes(TAB_PAGE[t])))
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
        go,
        isActive: win => !!active && active.frame.contentWindow === win,
        /** A view is ready to be seen (its first screen has rendered). */
        _ready(win) {
            const v = viewOf(win);
            if (!v) return;
            v.ready = true;
            if (v === active) { syncChrome(); hideSplash(); warmUp(); }
        },
        /** The view's address or title changed in place (hash, pushState, title). */
        _changed(win) { const v = viewOf(win); if (v && v === active) syncChrome(); },
        /** A pop-up opened or closed inside a view: the tab bar steps aside under it. */
        _overlay(win, on) {
            const v = viewOf(win);
            if (!v) return;
            v.overlay = !!on;
            if (v === active) tabbar.classList.toggle('covered', v.overlay);
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
            if (e.data && e.data.type === 'app:open' && e.data.url) go(e.data.url);
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
    // Start: the address after # (shared links, notifications), else where the user last was
    // ------------------------------------------------------------------
    let start = location.hash.slice(1);
    if (!start || !pageOf(new URL(start, base).href)) {
        const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
        const last = read('app_last_route');
        start = (standalone && last && pageOf(new URL(last, base).href)) ? last : HOME_ROUTE;
    }
    go(start);
})();
