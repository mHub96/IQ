/**
 * The ER page's frame: the side bar (a drawer on phones and tablets), the top bar and the sheet
 * tabs. It only reads the page's state and calls the page's own functions (switchTab,
 * openResidentsDbModal…), so every mechanic stays as it was.
 *
 * It also writes each schedule cell's column title into data-label, so phones can show a day as a
 * card with labelled shifts (presentation only).
 */
(function (window, document) {
    'use strict';

    const core = () => window.EmergencyCore;
    const ready = () => core() && core().ready && core().ready();
    const S = () => core().state();
    const COMPACT = '(max-width: 1023px)';
    const TITLES = { er: 'جدول الطوارئ', con: 'الاستشارية الخافرة', dc: 'شهادات الوفاة', rs_er: 'إسناد الطوارئ (RS)', rs_wards: 'إسناد الردهات (RS)' };
    const SLOTS = {
        er: ['morning', 'afternoon', 'preNight', 'lateNight'], con: ['doctor'], dc: ['doctor'],
        rs_er: ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight'], rs_wards: ['ward_private', 'ward_floor4', 'ward_floor5'],
    };
    const ORDER_KEY = 'ers_order_open';
    const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const $$ = sel => Array.from(document.querySelectorAll(sel));

    /** Filled / total slots of a sheet this month. */
    function coverage(tab) {
        const st = S();
        const src = tab === 'rs_er' || tab === 'rs_wards' ? 'rs' : tab;
        let days = (st.schedules && st.schedules[src]) || [];
        if (src === 'rs') {
            const dim = new Date(st.year, st.month, 0).getDate();
            const a = parseInt(String(st.rsStartDate || '').split('-')[2], 10) || 1;
            const b = parseInt(String(st.rsEndDate || '').split('-')[2], 10) || dim;
            days = days.filter(d => d.dayNumber >= a && d.dayNumber <= b);
        }
        let filled = 0, total = 0;
        days.forEach(d => SLOTS[tab].forEach(k => { total++; if (d[k] && String(d[k]).trim()) filled++; }));
        return { filled, total };
    }

    function activeTab() {
        const t = S().activeTab;
        return t === 'rs' ? 'rs_er' : (TITLES[t] ? t : 'er');
    }

    let painting = false;
    function paint() {
        if (!ready() || painting) return;
        painting = true;
        try {
            const st = S();
            const tab = activeTab();
            const hospName = st.hospitalName || '';
            const period = st.monthYear || '';
            document.documentElement.classList.toggle('ers-rs-on', !!st.rsEnabled);
            $$('[data-ers-hosp]').forEach(el => { el.textContent = hospName; });
            $$('[data-ers-period]').forEach(el => { el.textContent = period; });
            $$('[data-ers-title]').forEach(el => { el.textContent = TITLES[tab]; });
            $$('[data-ers-sub]').forEach(el => { el.textContent = [hospName, period].filter(Boolean).join(' · '); });
            $$('[data-ers-tab]').forEach(el => {
                const on = el.dataset.ersTab === tab;
                el.classList.toggle('on', on);
                if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
            });
            $$('[data-ers-count]').forEach(el => {
                const c = coverage(el.dataset.ersCount);
                el.textContent = c.total ? `${c.filled}/${c.total}` : '';
                el.classList.toggle('full', c.total > 0 && c.filled === c.total);
            });
            const sum = document.querySelector('[data-ers-order-sum]');
            if (sum) sum.textContent = [st.orderNumber ? `العدد ${st.orderNumber}` : '', st.orderDate || '', st.rsEnabled ? 'الإضراب مفعّل' : ''].filter(Boolean).join(' · ');
            // Keep the active tab visible in the scrolling tab strip.
            const strip = document.querySelector('.ers-tabs');
            const on = strip && strip.querySelector('.on');
            if (strip && on && strip.scrollWidth > strip.clientWidth) {
                const s = strip.getBoundingClientRect(), r = on.getBoundingClientRect();
                if (r.left < s.left || r.right > s.right) strip.scrollLeft += (r.left + r.width / 2) - (s.left + s.width / 2);
            }
            labelCells();
        } finally { painting = false; }
    }

    /** Copies each column's title to its cells (phones show them as labelled cards). */
    function labelCells() {
        const box = document.getElementById('schedule-view-container');
        const table = box && box.querySelector('table');
        if (!table || table.dataset.ersLabelled === '1') return;
        const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.replace(/\s+/g, ' ').trim());
        table.querySelectorAll('tbody tr').forEach(tr => {
            Array.from(tr.children).forEach((td, i) => { if (heads[i] && td.hasAttribute('data-slot')) td.setAttribute('data-label', heads[i]); });
        });
        table.dataset.ersLabelled = '1';
        table.classList.add('ers-sched');
    }

    // ----- Drawer (phones and tablets) -----
    function openDrawer() {
        document.documentElement.classList.add('ers-drawer-open'); // the app shell's tab bar steps aside (app-view.js)
    }
    function closeDrawer() {
        document.documentElement.classList.remove('ers-drawer-open');
    }

    function goTab(tab) {
        if (typeof window.switchTab !== 'function') return;
        window.switchTab(tab);
        closeDrawer();
        // Show the schedule itself (on phones the dashboard sits above it).
        if (window.matchMedia(COMPACT).matches) {
            const box = document.getElementById('schedule-view-container');
            const top = document.querySelector('.ers-top');
            const tabs = document.querySelector('.ers-tabs');
            if (box) {
                const y = box.getBoundingClientRect().top + window.scrollY - ((top && top.offsetHeight) || 0) - ((tabs && tabs.offsetHeight) || 0) - 8;
                window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            }
        }
        paint();
    }

    // ----- Order card: folded on phones by default, remembered -----
    function setOrderOpen(open, remember) {
        const card = document.getElementById('ers-order');
        if (!card) return;
        card.classList.toggle('folded', !open);
        const btn = card.querySelector('[data-ers-collapse]');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (remember) write(ORDER_KEY, open ? '1' : '0');
    }

    function start() {
        document.addEventListener('click', e => {
            const tabBtn = e.target.closest('[data-ers-tab]');
            if (tabBtn) { e.preventDefault(); return goTab(tabBtn.dataset.ersTab); }
            if (e.target.closest('[data-ers-open]')) return openDrawer();
            if (e.target.closest('[data-ers-close]')) return closeDrawer();
            const navAction = e.target.closest('.ers-side .ers-nav-item, .ers-side .ers-icon-btn');
            if (navAction && window.matchMedia(COMPACT).matches) setTimeout(closeDrawer, 0);
            const col = e.target.closest('[data-ers-collapse]');
            if (col) setOrderOpen(document.getElementById('ers-order').classList.contains('folded'), true);
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

        const saved = read(ORDER_KEY);
        setOrderOpen(saved === null ? !window.matchMedia(COMPACT).matches : saved === '1', false);

        // Repaint whenever the page redraws its schedule or dashboard, or the data changes.
        let queued = false;
        const queue = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); };
        const watch = () => {
            ['schedule-view-container', 'duty-dashboard-grid', 'rs-settings-bar'].forEach(id => {
                const el = document.getElementById(id);
                if (el) new MutationObserver(queue).observe(el, { childList: true, subtree: id !== 'schedule-view-container', attributes: id === 'rs-settings-bar' });
            });
        };
        ['er:period', 'hub:er-sync', 'hub:data-changed'].forEach(ev => window.addEventListener(ev, queue));
        ['meta-order-number', 'meta-order-date'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', queue); });
        const boot = () => { if (!ready()) return setTimeout(boot, 300); watch(); paint(); };
        boot();
    }

    window.ERShell = { paint, openDrawer, closeDrawer };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
