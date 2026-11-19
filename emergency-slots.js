/**
 * Save slots of the ER tables, and the read-only preview they share with the CSV import.
 *
 * Save slots (button "النسخ المحفوظة" over the ER, consultation clinic and death certificates
 * tables), like the save slots of a game:
 * - The menu always ends with one empty slot. Tapping it saves the table on screen there as
 *   "النسخة N", and a new empty slot appears under it.
 * - Tapping a saved slot shows it in the table, read-only, with the cells that differ from the
 *   current table marked. "استبدال" puts it in the table (after a confirmation, undo works);
 *   "إغلاق" goes back to the table as it is.
 * - Slots belong to one hospital, month and table. They are kept in localStorage
 *   'hosp_hub_emergency_slots_<sheet>_<hosp>_<year>_<month>', which the ER sync (hub-core) mirrors
 *   to the server like the schedules, so every admin device sees them.
 *
 * CSV import (emergency.js applySheetCsv) shows the file the same way: "تطبيق" or "إلغاء".
 *
 * The preview never touches the schedule: the table is drawn as always, then (afterRender) its
 * cells are drawn again with the preview's names and locked. Nothing is saved until the button.
 */
(function (window, document) {
    'use strict';

    const core = () => window.EmergencyCore;
    const S = () => core().state();
    const L = () => window.ERLayout;
    const notify = (msg, type) => { try { core().showNotification(msg, type || 'info'); } catch (e) {} };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = s => { const v = String(s || '').trim(); try { return core().normalizeArabic(v); } catch (e) { return v; } };

    const SHEETS = { er: 'الطوارئ', con: 'الاستشارية', dc: 'شهادات الوفاة' };
    // The rotators' ER keeps its save slots apart from the residents' ER.
    const PREFIX = (window.EmergencyCore && window.EmergencyCore.rot) ? 'hosp_hub_emergency_rslots_' : 'hosp_hub_emergency_slots_';
    const keyOf = (sheet, st) => `${PREFIX}${sheet}_${st.hospitalId}_${st.year}_${st.month}`;

    // ------------------------------------------------------------------------------------------
    // Slots
    // ------------------------------------------------------------------------------------------
    function readSlots(sheet) {
        try {
            const v = JSON.parse(localStorage.getItem(keyOf(sheet, S())) || 'null');
            return v && Array.isArray(v.slots) ? v.slots.filter(x => x && x.n && x.days) : [];
        } catch (e) { return []; }
    }
    function writeSlots(sheet, slots) {
        try {
            if (slots.length) localStorage.setItem(keyOf(sheet, S()), JSON.stringify({ v: 1, slots }));
            else localStorage.removeItem(keyOf(sheet, S()));
            return true;
        } catch (e) {
            notify('ذاكرة هذا المتصفح ممتلئة، فلم تُحفظ النسخة.', 'error');
            return false;
        }
    }

    /** The table on screen as a slot: { keys, days: { dayNumber: [names in keys order] }, filled }. */
    function snapshot(sheet) {
        const keys = L().keys(sheet);
        const days = {};
        let filled = 0;
        (S().schedules[sheet] || []).forEach(d => {
            days[d.dayNumber] = keys.map(k => { const v = String(d[k] || '').trim(); if (v) filled++; return v; });
        });
        return { keys, days, filled };
    }
    /** A slot as preview values: Map dayNumber -> { key: name } (only keys of the table on screen). */
    function slotValues(sheet, slot) {
        const now = new Set(L().keys(sheet));
        const map = new Map();
        Object.keys(slot.days).forEach(d => {
            const vals = {};
            (slot.keys || []).forEach((k, i) => { if (now.has(k)) vals[k] = String((slot.days[d] || [])[i] || ''); });
            map.set(Number(d), vals);
        });
        return map;
    }

    const when = t => {
        try {
            return new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ' ·');
        } catch (e) { return ''; }
    };
    function savedBy() {
        try { const a = window.Hub && window.Hub.auth && window.Hub.auth.getAccount && window.Hub.auth.getAccount(); return (a && a.name) || ''; } catch (e) { return ''; }
    }

    function closeMenu() {
        const m = document.getElementById('er-slots-menu');
        if (m) m.remove();
        document.removeEventListener('pointerdown', menuOutside, true);
    }
    function menuOutside(e) {
        const m = document.getElementById('er-slots-menu');
        if (m && !m.contains(e.target)) closeMenu();
    }

    function menuHtml(sheet, fresh) {
        const st = S();
        const slots = readSlots(sheet);
        const shown = preview && preview.source === 'slot' && preview.sheet === sheet ? preview.n : null;
        const items = slots.map(s => `
            <div class="er-slot-row${fresh === s.n ? ' er-slot-new' : ''}">
                <button type="button" class="er-slot${shown === s.n ? ' on' : ''}" data-open="${s.n}">
                    <span class="er-slot-ic"><i class="fas fa-floppy-disk"></i></span>
                    <span class="er-slot-tx"><b>النسخة ${s.n}</b><small>${esc(when(s.at))} · ${s.filled || 0} خفارة${s.by ? ' · ' + esc(s.by) : ''}</small></span>
                </button>
                <button type="button" class="er-slot-del" data-del="${s.n}" title="حذف النسخة ${s.n}" aria-label="حذف النسخة ${s.n}"><i class="fas fa-xmark"></i></button>
            </div>`).join('');
        const next = slots.reduce((m, s) => Math.max(m, s.n), 0) + 1;
        return `<div class="er-csv-title">النسخ المحفوظة · ${SHEETS[sheet]} · ${st.month}/${st.year}</div>
            <div class="er-slot-list">${items}
                <button type="button" class="er-slot empty${fresh ? ' er-slot-new' : ''}" data-save="1">
                    <span class="er-slot-ic"><i class="fas fa-plus"></i></span>
                    <span class="er-slot-tx"><b>خانة فارغة</b><small>احفظ الجدول الحالي هنا (النسخة ${next})</small></span>
                </button>
            </div>`;
    }

    function openMenu(event, sheet) {
        event.stopPropagation();
        closeMenu();
        try { window.closeTableCsvMenu && window.closeTableCsvMenu(); } catch (e) {}
        const menu = document.createElement('div');
        menu.id = 'er-slots-menu';
        menu.className = 'er-csv-menu er-slots-menu no-print';
        menu.innerHTML = menuHtml(sheet);
        menu.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            if (b.dataset.save) return saveSlot(sheet, menu);
            if (b.dataset.del) return deleteSlot(sheet, Number(b.dataset.del), menu);
            if (b.dataset.open) { closeMenu(); return showSlot(sheet, Number(b.dataset.open)); }
        });
        document.body.appendChild(menu);
        const r = event.currentTarget.getBoundingClientRect();
        menu.dataset.anchor = JSON.stringify([r.left, r.width, r.bottom]);
        place(menu);
        setTimeout(() => document.addEventListener('pointerdown', menuOutside, true), 0);
    }
    function place(menu) {
        const [left, width, bottom] = JSON.parse(menu.dataset.anchor || '[8,0,8]');
        const w = menu.offsetWidth, h = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, left + width / 2 - w / 2)) + 'px';
        menu.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, bottom + 6)) + 'px';
    }

    function saveSlot(sheet, menu) {
        const slots = readSlots(sheet);
        const n = slots.reduce((m, s) => Math.max(m, s.n), 0) + 1;
        const snap = snapshot(sheet);
        slots.push({ n, at: Date.now(), by: savedBy(), keys: snap.keys, days: snap.days, filled: snap.filled });
        if (!writeSlots(sheet, slots)) return;
        notify(`تم حفظ الجدول في النسخة ${n}`, 'success');
        if (menu) {
            menu.innerHTML = menuHtml(sheet, n);
            place(menu);
            const list = menu.querySelector('.er-slot-list');
            if (list) list.scrollTop = list.scrollHeight;   // the new empty slot in view
        }
    }
    function deleteSlot(sheet, n, menu) {
        if (!confirm(`حذف النسخة ${n} من النسخ المحفوظة لجدول ${SHEETS[sheet]}؟`)) return;
        if (!writeSlots(sheet, readSlots(sheet).filter(s => s.n !== n))) return;
        if (preview && preview.source === 'slot' && preview.sheet === sheet && preview.n === n) end();
        if (menu) { menu.innerHTML = menuHtml(sheet); place(menu); }
    }
    function showSlot(sheet, n) {
        const slot = readSlots(sheet).find(s => s.n === n);
        if (!slot) return notify('لم تعد هذه النسخة موجودة', 'error');
        begin({ sheet, source: 'slot', n, title: `النسخة ${n}`, sub: `محفوظة ${when(slot.at)}${slot.by ? ' · ' + slot.by : ''}`, values: slotValues(sheet, slot) });
    }

    // ------------------------------------------------------------------------------------------
    // The read-only preview (a slot, or a CSV file before it is applied)
    // ------------------------------------------------------------------------------------------
    // { sheet, source: 'slot' | 'csv', n?, title, sub, note?, values: Map(day -> { key: name }), hosp, year, month }
    let preview = null;

    function begin(p) {
        const st = S();
        preview = Object.assign({ hosp: st.hospitalId, year: st.year, month: st.month }, p);
        if (st.activeTab !== p.sheet && typeof window.switchTab === 'function') window.switchTab(p.sheet);
        else core().renderActiveTab();
        const bar = document.getElementById('er-pv-bar');
        if (bar) bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function end() {
        preview = null;
        core().renderActiveTab();
    }
    const active = () => !!(preview && preview.sheet === S().activeTab && samePeriod());
    const samePeriod = () => { const st = S(); return preview && preview.hosp === st.hospitalId && preview.year === st.year && preview.month === st.month; };

    /** Puts the preview's names into the table: the schedule itself is not changed. */
    function apply() {
        if (!preview || !samePeriod()) return end();
        const p = preview;
        const st = S();
        const isSlot = p.source === 'slot';
        const changed = countChanges(p);
        if (isSlot && !confirm(`استبدال جدول ${SHEETS[p.sheet]} الحالي (${st.month}/${st.year}) بـ${p.title}؟\n\n• ${changed} خانة ستتغير\n\n(يمكنك التراجع بزر "تراجع" أو Ctrl+Z)`)) return;
        core().pushScheduleHistory(isSlot ? `استبدال الجدول بـ${p.title}` : `استيراد جدول ${SHEETS[p.sheet]}`);
        const keys = L().keys(p.sheet);
        (st.schedules[p.sheet] || []).forEach(day => {
            const vals = p.values.get(day.dayNumber);
            if (vals) keys.forEach(k => { if (k in vals) day[k] = vals[k]; });
        });
        preview = null;
        core().saveState();
        core().renderActiveTab();
        try { core().updateDutyDashboard(); } catch (e) {}
        notify(isSlot ? `تم استبدال الجدول بـ${p.title}` : `تم استيراد جدول ${SHEETS[p.sheet]} (${changed} خانة تغيرت)`, 'success');
    }

    function countChanges(p) {
        let n = 0;
        (S().schedules[p.sheet] || []).forEach(day => {
            const vals = p.values.get(day.dayNumber);
            if (vals) Object.keys(vals).forEach(k => { if (norm(vals[k]) !== norm(day[k])) n++; });
        });
        return n;
    }

    // Toolbar buttons that change the table: off while a preview is shown.
    const EDITING = /clearCurrentSchedule|triggerScheduleAutoGenerate|undoScheduleAction|redoScheduleAction|openTableCsvMenu/;

    /** Called by renderActiveTab after every drawing of the table. */
    function afterRender(container) {
        if (!container) return;
        container.classList.remove('er-pv-lock');
        if (preview && !samePeriod()) {
            preview = null;    // another hospital or month: the preview belonged to the previous one
            notify('أُغلقت معاينة الجدول بعد تغيير الشهر أو المستشفى', 'info');
        }
        if (!active()) return;
        const p = preview;
        const keys = new Set(L().keys(p.sheet));
        const renderCell = core().renderShiftCellHTML;
        let changed = 0;
        container.querySelectorAll('tr[data-day]').forEach(tr => {
            const day = Number(tr.dataset.day);
            const vals = p.values.get(day);
            if (!vals) return;
            const cur = (S().schedules[p.sheet] || []).find(d => d.dayNumber === day) || {};
            tr.querySelectorAll('td[data-slot]').forEach(td => {
                const k = td.dataset.slot;
                if (!keys.has(k) || !(k in vals)) return;
                const name = vals[k];
                const was = String(cur[k] || '').trim();
                const diff = norm(name) !== norm(was);
                const tpl = document.createElement('tbody');
                tpl.innerHTML = `<tr>${renderCell(p.sheet, day, tr.dataset.date, k, name)}</tr>`;
                const cell = tpl.querySelector('td');
                if (!cell) return;
                if (diff) {
                    changed++;
                    cell.classList.add('er-pv-diff');
                    cell.setAttribute('title', `في الجدول الحالي: ${was || 'شاغر'}`);
                    cell.insertAdjacentHTML('beforeend', `<div class="er-pv-was">كان: ${esc(was || 'شاغر')}</div>`);
                }
                td.replaceWith(cell);
            });
        });
        container.classList.add('er-pv-lock');
        container.querySelectorAll('button').forEach(b => {
            if (EDITING.test(b.getAttribute('onclick') || '')) { b.disabled = true; b.classList.add('er-pv-off'); }
        });
        const isSlot = p.source === 'slot';
        const bar = document.createElement('div');
        bar.id = 'er-pv-bar';
        bar.className = 'er-pv-bar no-print' + (isSlot ? '' : ' csv');
        bar.innerHTML = `
            <div class="er-pv-info">
                <span class="er-pv-ic"><i class="fas ${isSlot ? 'fa-floppy-disk' : 'fa-file-csv'}"></i></span>
                <div><b>${isSlot ? 'معاينة ' : ''}${esc(p.title)} · للقراءة فقط</b>
                <small>${esc(p.sub || '')}${p.sub ? ' · ' : ''}${changed ? `<span class="er-pv-count">${changed} خانة مختلفة عن الجدول الحالي</span> (مظللة)` : 'مطابق للجدول الحالي'}</small>
                ${p.note ? `<small class="er-pv-note">${esc(p.note)}</small>` : ''}</div>
            </div>
            <div class="er-pv-actions">
                <button type="button" class="er-pv-btn primary" data-pv="apply"><i class="fas ${isSlot ? 'fa-right-left' : 'fa-check'}"></i> ${isSlot ? 'استبدال' : 'تطبيق'}</button>
                <button type="button" class="er-pv-btn" data-pv="close"><i class="fas fa-xmark"></i> ${isSlot ? 'إغلاق' : 'إلغاء'}</button>
            </div>`;
        bar.addEventListener('click', e => {
            const b = e.target.closest('[data-pv]');
            if (!b) return;
            if (b.dataset.pv === 'apply') apply();
            else end();
        });
        const table = container.querySelector('table');
        const host = table ? (table.closest('.overflow-x-auto, .overflow-auto') || table) : null;
        if (host && host.parentNode) host.parentNode.insertBefore(bar, host);
        else container.prepend(bar);
    }

    /** CSV import: the file's days as a preview to apply or cancel. */
    function previewCsv(sheet, values, title, note) {
        begin({ sheet, source: 'csv', title: title || 'ملف CSV', sub: `${values.size} يوماً في الملف`, note, values });
    }

    window.ERSlots = { openMenu, closeMenu, afterRender, previewCsv, active, end, apply };
})(window, document);
