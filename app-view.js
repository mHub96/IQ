/**
 * Connects a page to the app shell (app-shell.js). Loaded second on every page, before it renders.
 *
 * - Opened on its own (a shared link, a bookmark, a notification): the page reopens inside the app
 *   shell, at the same address, so it gets the permanent frame.
 * - Inside the shell: links to other pages switch to that page's live view instead of loading it
 *   here, the tab bar is the shell's, and the page knows whether it is on screen (window.HubView).
 */
(function () {
    'use strict';
    var shell = null;
    try {
        if (window.parent !== window && window.parent.location.origin === location.origin && window.parent.HubShell) shell = window.parent.HubShell;
    } catch (e) {}

    var dir = location.pathname.replace(/[^/]*$/, '');
    var file = location.pathname.slice(dir.length) || 'index.html';

    if (!shell) {
        if (window.parent !== window) return;                         // framed by something else: leave it be
        if (/[?&]noshell(=|&|$)/.test(location.search)) return;       // escape hatch for debugging
        location.replace(dir + 'app.html#' + file + location.search + location.hash);
        return;
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
        /** Opens an address of the app (its live view if it has one). */
        go: function (url) { shell.go(new URL(url, location.href).href); },
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
        if (!appPage(u) || sameDocument(u)) return;                 // in-page anchors stay in the page
        e.preventDefault();
        view.go(u.href);
    }, false);

    // Script navigations (location.href = …) are routed the same way where the browser can intercept them.
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigate', function (e) {
            if (!e.cancelable || e.hashChange || e.downloadRequest || e.formData || e.navigationType === 'reload' || e.navigationType === 'traverse') return;
            var u;
            try { u = new URL(e.destination.url); } catch (err) { return; }
            if (view._allow && view._allow === u.href) { view._allow = null; return; }   // the shell itself is moving this view
            if (!appPage(u) || sameDocument(u)) return;
            e.preventDefault();
            view.go(u.href);
        });
    }

    // Pop-ups: while one is open on screen, the shell's tab bar steps aside.
    var overlayOn = false, queued = false;
    function overlayOpen() {
        return !!document.querySelector('.modal-overlay.active, .hub-modal-overlay.active, .hacc-sheet-backdrop.open, #role-switcher-modal[style*="flex"], #hub-passwords-modal[style*="flex"], .fixed.inset-0[id$="-modal"]:not(.hidden)')
            || html.classList.contains('hacc-no-scroll') || html.classList.contains('ers-drawer-open');
    }
    function reportOverlay(force) {
        var on = overlayOpen();
        if (on === overlayOn && !force) return;
        overlayOn = on;
        try { shell._overlay(window, on); } catch (e) {}
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
    ['pushState', 'replaceState'].forEach(function (m) {
        var orig = history[m];
        history[m] = function () { var r = orig.apply(this, arguments); changed(); return r; };
    });

    function ready() {
        requestAnimationFrame(function () { try { shell._ready(window); } catch (e) {} changed(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
})();
