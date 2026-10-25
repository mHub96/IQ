/**
 * Connects a page to the app shell (app-shell.js). Loaded second on every page, before it renders.
 *
 * - Opened on its own (a shared link, a bookmark, a notification): the page reopens inside the app
 *   shell, at the same address, so it gets the permanent frame.
 * - Inside the shell: links to other pages switch to that page's live view instead of loading it
 *   here, the tab bar is the shell's, and the page knows whether it is on screen (window.HubView).
 * - History belongs to the shell (back button, app-shell.js): this page adds no entries of its own.
 *   Its pushes and hash links become entries of the shell, and each pop-up it opens is reported, so
 *   the back button closes the pop-up on top first (window.HubView._closeTop).
 */
(function () {
    'use strict';
    var shell = null;
    try {
        if (window.parent !== window && window.parent.location.origin === location.origin && window.parent.HubShell) shell = window.parent.HubShell;
    } catch (e) {}

    var dir = location.pathname.replace(/[^/]*$/, '');
    var file = location.pathname.slice(dir.length) || 'index.html';

    // Opened inside the account panel (embed=1): the page shows without the site's bars, its links stay
    // in the panel (embedded too) and it adds no history steps (the panel's own bar goes back).
    if (/[?&]embed=1(&|$)/.test(location.search)) { embedMode(); return; }

    if (!shell) {
        if (window.parent !== window) return;                         // framed by something else: leave it be
        if (/[?&]noshell(=|&|$)/.test(location.search)) return;       // escape hatch for debugging
        location.replace(dir + 'app.html#' + file + location.search + location.hash);
        return;
    }

    function embedMode() {
        var root = document.documentElement;
        root.classList.add('hub-embed');
        var css = document.createElement('style');
        css.textContent = 'html.hub-embed .hub-nav-bar,html.hub-embed .ios-top-bar,html.hub-embed #universal-nav,html.hub-embed body > header.top,'
            + 'html.hub-embed .hub-mobile-bottom-dock,html.hub-embed .ios-bottom-dock,html.hub-embed #pwa-install-button,html.hub-embed [data-hacc-slot],'
            + 'html.hub-embed .footer-credit,html.hub-embed a.back{display:none!important}html.hub-embed body{padding-top:0!important;padding-bottom:0!important}';
        (document.head || root).appendChild(css);
        var pages = ['index.html', 'Home.html', 'schedule.html', 'icu.html', 'specialists.html', 'residents.html',
            'signup.html', 'admin.html', 'scheduler.html', 'account.html', 'emergency.html', 's.html'];
        var dirE = location.pathname.replace(/[^/]*$/, '');
        var isPage = function (u) { return u.origin === location.origin && u.pathname.indexOf(dirE) === 0 && pages.indexOf(u.pathname.slice(dirE.length) || 'index.html') >= 0; };
        var keep = function (u) { u.searchParams.set('noshell', '1'); u.searchParams.set('embed', '1'); return u.href; };
        var same = function (u) { return u.pathname === location.pathname && u.search === location.search; };
        // Links: other pages open embedded (never the whole app inside the panel); in-page addresses replace.
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button !== 0) return;
            var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
            if (!a || a.hasAttribute('download') || (a.getAttribute('target') || '') === '_blank') return;
            var u;
            try { u = new URL(a.href, location.href); } catch (err) { return; }
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
            if (same(u)) { if (u.hash !== location.hash) { e.preventDefault(); location.replace(u.href); } return; }
            if (isPage(u)) { e.preventDefault(); location.replace(keep(u)); }
        });
        if (window.navigation && typeof window.navigation.addEventListener === 'function') {
            window.navigation.addEventListener('navigate', function (e) {
                if (!e.cancelable || e.navigationType === 'reload' || e.navigationType === 'traverse' || e.downloadRequest || e.formData) return;
                // The page tidying its own address (history.replaceState / pushState) is no navigation:
                // reloading it then would lose what it was doing (e.g. the owner tool asked for by #admin=).
                if (e.destination && e.destination.sameDocument && !e.hashChange) return;
                var u;
                try { u = new URL(e.destination.url); } catch (err) { return; }
                if (e.hashChange) { if (e.navigationType === 'push') { e.preventDefault(); location.replace(u.href); } return; }
                if (isPage(u) && !/[?&]embed=1(&|$)/.test(u.search)) { e.preventDefault(); location.replace(keep(u)); }
            });
        }
        var push = history.pushState;
        history.pushState = function () { return history.replaceState.apply(history, arguments); };
        void push;
    }

    var html = document.documentElement;
    html.classList.add('in-shell');
    var style = document.createElement('style');
    style.textContent = 'html.in-shell .hub-mobile-bottom-dock,html.in-shell .ios-bottom-dock,html.in-shell #pwa-install-button{display:none!important}';
    (document.head || html).appendChild(style);

    var PAGES = ['index.html', 'Home.html', 'schedule.html', 'icu.html', 'specialists.html', 'residents.html',
        'signup.html', 'admin.html', 'scheduler.html', 'account.html', 'emergency.html', 's.html'];
    function appPage(u) {
        if (u.origin !== location.origin || u.pathname.indexOf(dir) !== 0) return null;
        var rel = u.pathname.slice(dir.length) || 'index.html';
        return PAGES.indexOf(rel) >= 0 ? rel : null;
    }
    function sameDocument(u) { return u.pathname === location.pathname && u.search === location.search; }

    var hiddenAt = 0;
    var view = {
        inShell: true,
        active: shell.isActive(window),
        /** Opens an address of the app (its live view if it has one); how 'replace' = no back step. */
        go: function (url, how) { shell.go(new URL(url, location.href).href, how); },
        _allow: null,
        _setActive: function (on) {
            on = !!on;
            if (on === view.active) return;
            view.active = on;
            var hiddenFor = on && hiddenAt ? Date.now() - hiddenAt : 0;
            if (!on) hiddenAt = Date.now();
            window.dispatchEvent(new CustomEvent(on ? 'hub:view-shown' : 'hub:view-hidden', { detail: { hiddenFor: hiddenFor } }));
            if (on) reportOverlay(true);
        },
    };
    window.HubView = view;

    // The first touch lays the app's base history entries (app-shell.js arm).
    var interacted = false;
    function interact() {
        if (interacted) return;
        interacted = true;
        try { shell._interact(); } catch (e) {}
    }
    window.addEventListener('pointerdown', interact, true);
    window.addEventListener('keydown', interact, true);

    // Links to other pages open their live view (instant) instead of loading the page in this one.
    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a || a.hasAttribute('download')) return;
        var target = (a.getAttribute('target') || '').toLowerCase();
        if (target && target !== '_self' && target !== '_top' && target !== '_parent') return;
        var u;
        try { u = new URL(a.href, location.href); } catch (err) { return; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            // tel:, mailto:, sms:, whatsapp: belong to the whole app window.
            e.preventDefault();
            try { window.top.location.href = u.href; } catch (err) { location.href = u.href; }
            return;
        }
        if (u.origin !== location.origin) { e.preventDefault(); window.open(u.href, '_blank', 'noopener'); return; }
        if (sameDocument(u)) {
            // A bare "#" link is a button: no jump, no history step.
            if (a.getAttribute('href') === '#') { e.preventDefault(); return; }
            // An in-page address (a section, a panel): a back step of the app's, not of this frame.
            if (u.hash !== location.hash) { e.preventDefault(); pushInPlace(u.href); }
            return;
        }
        if (!appPage(u)) return;
        e.preventDefault();
        view.go(u.href);
    }, false);

    // Script navigations (location.href = …) are routed the same way where the browser can intercept them.
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigate', function (e) {
            if (!e.cancelable || e.downloadRequest || e.formData || e.navigationType === 'reload' || e.navigationType === 'traverse') return;
            var u;
            try { u = new URL(e.destination.url); } catch (err) { return; }
            // location.hash = … : the same as a hash link (the shell keeps the back step).
            if (e.hashChange) {
                if (e.navigationType === 'push' && !inPlace) { e.preventDefault(); pushInPlace(u.href); }
                return;
            }
            if (view._allow && view._allow === u.href) { view._allow = null; return; }   // the shell itself is moving this view
            if (!appPage(u) || sameDocument(u)) return;
            e.preventDefault();
            view.go(u.href, e.navigationType === 'replace' ? 'replace' : 'push');
        });
    }

    // Pop-ups: the shell's tab bar steps aside under them, and the back button closes them, top first.
    var OVERLAYS = '.modal-overlay.active, .hub-modal-overlay.active, .hacc-sheet-backdrop.open, #role-switcher-modal[style*="flex"], '
        + '#hub-passwords-modal[style*="flex"], .fixed.inset-0[id$="-modal"]:not(.hidden), #err-picker, #erl-modal, .hub-pop.open';
    function openOverlays() {
        var list = Array.prototype.slice.call(document.querySelectorAll(OVERLAYS)).filter(function (el, i, all) {
            if (all.indexOf(el) !== i) return false;
            var cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden';
        });
        // The top one last: higher z-index, then later in the page.
        var z = function (el) { var v = parseInt(getComputedStyle(el).zIndex, 10); return isNaN(v) ? 0 : v; };
        list.sort(function (a, b) { return z(a) - z(b) || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); });
        return list;
    }
    function overlayCount() {
        return openOverlays().length + (html.classList.contains('ers-drawer-open') ? 1 : 0);
    }
    var CLOSERS = '[data-erl-close], [data-close], [data-act="close"], .modal-close, .hacc-sheet-close, '
        + 'button[aria-label*="إغلاق"], button[aria-label*="close" i], button[title*="إغلاق"]';
    /** Closes the pop-up on top. The page can handle it first ('hub:back', cancelable). */
    function closeTop() {
        var before = overlayCount();
        if (!before) return false;
        var ev = new CustomEvent('hub:back', { cancelable: true });
        window.dispatchEvent(ev);
        if (ev.defaultPrevented || overlayCount() < before) return true;
        var list = openOverlays();
        var top = list[list.length - 1];
        if (!top) {
            // Only the ER drawer is open: its own Escape handler closes it.
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return overlayCount() < before;
        }
        // 1. Its own close button (×), 2. Escape, 3. a tap outside, 4. hidden by force.
        var btn = top.querySelector(CLOSERS);
        if (!btn) {
            var icons = top.querySelectorAll('button .fa-times, button .fa-xmark, button .fa-close');
            if (icons.length) btn = icons[0].closest('button');
        }
        if (!btn) {
            var all = top.querySelectorAll('button[onclick]');
            for (var i = 0; i < all.length && !btn; i++) if (/close/i.test(all[i].getAttribute('onclick'))) btn = all[i];
        }
        if (btn) { btn.click(); if (overlayCount() < before) return true; }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (overlayCount() < before) return true;
        top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        if (overlayCount() < before) return true;
        if (top.id === 'err-picker' || top.id === 'erl-modal') top.remove();
        else {
            top.classList.remove('active', 'open');
            if (/fixed/.test(top.className)) top.classList.add('hidden');
            if (top.style.display) top.style.display = 'none';
        }
        return overlayCount() < before;
    }
    view._closeTop = closeTop;
    view._overlays = overlayCount;

    var overlayN = 0, queued = false;
    function reportOverlay(force) {
        var n = overlayCount();
        if (n === overlayN && !force) return;
        overlayN = n;
        try { shell._overlay(window, n); } catch (e) {}
    }
    function queueOverlayCheck() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; reportOverlay(false); });
    }
    new MutationObserver(queueOverlayCheck).observe(html, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

    // Address and title changes made in place reach the shell (its URL mirrors the view on screen).
    function changed() { try { shell._changed(window); } catch (e) {} }
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    var origPush = history.pushState, origReplace = history.replaceState, inPlace = false;
    history.replaceState = function () { var r = origReplace.apply(this, arguments); changed(); return r; };
    history.pushState = function () {
        // The shell keeps the back step; this frame only changes its address.
        try { shell._push(window); } catch (e) {}
        var r = origReplace.apply(this, arguments);
        changed();
        return r;
    };
    /** Moves this page to another address of itself (a hash), with the back step kept by the shell. */
    function pushInPlace(href) {
        try { shell._push(window); } catch (e) {}
        inPlace = true;
        try { location.replace(href); } finally { inPlace = false; }
    }

    function ready() {
        requestAnimationFrame(function () { try { shell._ready(window); } catch (e) {} changed(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
})();
