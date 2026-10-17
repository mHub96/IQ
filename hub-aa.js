/**
 * Administrative Affairs division pages (الشؤون الإدارية). Loaded after hub-core.js on the pages
 * a division uses (portal, roster, schedule, duty exchange, admin, scheduler); does nothing in
 * the doctors' version of a page.
 *
 * The division reuses the doctors' pages on its own data (see hub-core.js), so here the wording is
 * switched from doctors to staff (resident -> officer, specialty -> job title), the doctors-only
 * parts are hidden, and the owner or a hospital admin gets a way back to the doctors' side.
 */
(function (window, document) {
    'use strict';
    const Hub = window.Hub;
    if (!Hub || !Hub.aa || !Hub.aa.active) return;

    // Doctors-only links and controls (ICU, specialists, residents directory, ER, Rotation Heroes, the
    // specialists' schedule mode, importing specialties from the doctors' store or other hospitals).
    const style = document.createElement('style');
    style.textContent = [
        'html.aa-mode a[href*="icu.html"], html.aa-mode a[href*="specialists.html"], html.aa-mode a[href*="residents.html"], html.aa-mode a[href*="emergency.html"]',
        'html.aa-mode #btn-rotation-heroes, html.aa-mode #mode-specialists-btn, html.aa-mode #btn-role-specialists',
        'html.aa-mode #tab-btn-import-spec, html.aa-mode #tab-btn-clone-spec, html.aa-mode #hosp-modal-owner-store-btn, html.aa-mode #admin-owner-store-btn',
        'html.aa-mode #admin-owner-heroes-btn, html.aa-mode #admin-owner-full-backup-btn, html.aa-mode #admin-owner-full-restore-btn, html.aa-mode #admin-owner-passwords-btn',
        'html.aa-mode button[onclick="openHospitalSettingsModal()"]',
        'html.aa-mode #hosp-owner-heroes-container, html.aa-mode #hosp-owner-heroes-clicks-container, html.aa-mode #hosp-owner-passwords-container',
        'html.aa-mode .hosp-icu-btn, html.aa-mode .hosp-er-btn, html.aa-mode [data-doctors-only]',
    ].join(',\n') + ' { display: none !important; }\n' +
        '.aa-pill { position: fixed; z-index: 9000; left: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 88px); display: inline-flex; align-items: center; gap: 8px;' +
        ' padding: 7px 8px 7px 12px; border-radius: 999px; font: 700 12px/1.2 inherit; color: #fff; background: rgba(51, 65, 85, 0.92);' +
        ' box-shadow: 0 6px 20px rgba(15, 23, 42, 0.28); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); direction: rtl; }\n' +
        '.aa-pill a { color: #0f172a; background: #fff; border-radius: 999px; padding: 4px 10px; text-decoration: none; font-weight: 800; }\n' +
        'html:not(.in-shell) .aa-pill { bottom: calc(env(safe-area-inset-bottom, 0px) + 100px); }';
    (document.head || document.documentElement).appendChild(style);

    // ------------------------------------------------------------------
    // Wording: doctors -> staff
    // ------------------------------------------------------------------
    const WORDS = [
        ['الأطباء المقيمين', 'الموظفين'], ['الاطباء المقيمين', 'الموظفين'], ['الأطباء المقيمون', 'الموظفون'],
        ['المقيمين', 'الموظفين'], ['المقيمون', 'الموظفون'], ['مقيمين', 'موظفين'], ['مقيمون', 'موظفون'],
        ['المقيمة', 'الموظفة'], ['المقيم', 'الموظف'], ['مقيمة', 'موظفة'], ['مقيم', 'موظف'],
        ['الأطباء', 'الموظفين'], ['الاطباء', 'الموظفين'], ['أطباء', 'موظفين'], ['اطباء', 'موظفين'],
        ['الطبيب', 'الموظف'], ['طبيب', 'موظف'],
        ['تخصص طبي', 'عنوان وظيفي'], ['التخصصات الطبية', 'العناوين الوظيفية'],
        ['التخصصات', 'العناوين الوظيفية'], ['الاختصاصات', 'العناوين الوظيفية'], ['تخصصات', 'عناوين وظيفية'], ['اختصاصات', 'عناوين وظيفية'],
        ['التخصص', 'العنوان الوظيفي'], ['الاختصاص', 'العنوان الوظيفي'], ['تخصص', 'عنوان وظيفي'], ['اختصاص', 'عنوان وظيفي'],
        ['إدارة المستشفى', 'إدارة الشؤون الإدارية'],
        ['RESIDENTS', 'STAFF'], ['Residents', 'Staff'],
    ];
    const RE = new RegExp(WORDS.map(w => w[0]).sort((a, b) => b.length - a.length).join('|'), 'g');
    const MAP = new Map(WORDS);
    const swap = text => text.replace(RE, m => MAP.get(m) || m);
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
    const ATTRS = ['placeholder', 'title', 'aria-label'];
    const has = text => { RE.lastIndex = 0; return RE.test(text); };
    const excluded = el => !el || SKIP.has(el.nodeName) || !!(el.closest && el.closest('[data-no-relabel]'));

    function relabelText(node) {
        if (!excluded(node.parentElement) && has(node.nodeValue)) node.nodeValue = swap(node.nodeValue);
    }
    function relabelAttrs(el) {
        ATTRS.forEach(a => { const v = el.getAttribute(a); if (v && has(v)) el.setAttribute(a, swap(v)); });
    }
    // Swapped words never contain a word that is swapped, so the observer below settles at once.
    function relabel(node) {
        if (!node) return;
        if (node.nodeType === 3) return relabelText(node);
        if (node.nodeType !== 1 || excluded(node)) return;
        [node, ...node.querySelectorAll('[placeholder], [title], [aria-label]')].forEach(relabelAttrs);
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach(relabelText);
    }

    let pending = new Set(), queued = false;
    function flush() {
        queued = false;
        const nodes = [...pending];
        pending = new Set();
        nodes.forEach(n => { if (n.isConnected) relabel(n); });
        if (has(document.title)) document.title = swap(document.title);
    }
    function queue(node) {
        pending.add(node);
        if (!queued) { queued = true; requestAnimationFrame(flush); }
    }
    function start() {
        relabel(document.body);
        new MutationObserver(list => {
            for (const m of list) {
                if (m.type === 'childList') m.addedNodes.forEach(queue);
                else queue(m.target);
            }
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        showPill();
        flush();
    }

    // ------------------------------------------------------------------
    // The owner and hospital admins can go back to the doctors' side
    // ------------------------------------------------------------------
    function showPill() {
        // Inside the app the tab bar has the way back ("الأطباء"); a page opened on its own gets this pill.
        if (Hub.auth.isOfficer() || document.documentElement.classList.contains('in-shell') || document.querySelector('.aa-pill')) return;
        const h = Hub.getHospital(Hub.aa.hosp);
        const pill = document.createElement('div');
        pill.className = 'aa-pill';
        pill.setAttribute('data-no-relabel', '');
        pill.innerHTML = '<span>🏢 الشؤون الإدارية</span><a href="./index.html?portal=true&aa=off">↩ الأطباء</a>';
        pill.title = h ? 'الشؤون الإدارية — ' + (h.name_ar || h.hospitalName || '') : 'الشؤون الإدارية';
        document.body.appendChild(pill);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();

    window.HubAA = { relabel, swap };
})(window, document);
