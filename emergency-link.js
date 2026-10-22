/**
 * One residents database for the hospital and the ER scheduler.
 *
 * Every ER resident belongs to their hospital: the ER list is the hospital residents the admin
 * imported for ER duties, plus the ER's own settings for them (targets, board, stage, preferences).
 * Each ER resident is linked to their record in the hospital database (`hubId`), and the record is
 * the source of their identity: name and phone are copied from it whenever this page opens or the
 * hospital data changes, and a new name replaces the old one in that hospital's ER schedules of every
 * month (so counts and the resident's own schedule stay right).
 *
 * Linking is done automatically only when it is certain (the import's own id, or a phone number or a
 * full name that matches exactly one resident of the hospital, never two ER residents to one record).
 * The rest are listed for the admin to link by hand or to add to the hospital database; nothing is
 * ever removed. Everything runs here, in the ER page, and is saved through the page's own state,
 * so the server copy of the ER data is only ever written by the ER page.
 */
(function (window, document) {
    'use strict';

    const MONTH_PREFIX = 'hosp_hub_emergency_sched_';
    const NOT_NAMES = new Set(['date', 'dayName', 'notes', 'dayNumber']);
    const core = () => window.EmergencyCore;
    const Hub = () => window.Hub;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const notify = (msg, type) => { try { core().showNotification(msg, type); } catch (e) {} };
    const keyOf = n => (Hub() && Hub().nameKey ? Hub().nameKey(n) : String(n || '').trim());
    const phoneOf = p => { const d = String(p || '').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, ''); const m = /7\d{9}$/.exec(d); return m ? m[0] : ''; };
    const hospitalName = id => { const h = Hub() && Hub().getHospital && Hub().getHospital(id); return h ? (h.name_ar || h.hospitalName) : id; };

    function hubResidents() {
        const db = Hub() && Hub().getDatabase && Hub().getDatabase();
        return db && Array.isArray(db.residents) ? db.residents : [];
    }
    const ready = () => {
        if (!core() || !core().ready || !core().ready()) return false;
        const st = core().state();
        return !!(st && st.hospitalId && Array.isArray(st.residents) && hubResidents().length);
    };

    /** The ER residents list of every hospital (the one on screen is the working copy, state.residents). */
    function erLists(st) {
        const out = new Map();
        Object.entries(st.hospitalResidents || {}).forEach(([h, list]) => { if (Array.isArray(list)) out.set(h, list); });
        out.set(st.hospitalId, st.residents);
        return out;
    }

    /** The hospital record this ER resident certainly is, or null. */
    function findRecord(r, hosp, pool, used) {
        const free = pool.filter(x => !used.has(x.id));
        // Bulk import ids: er_<hospital>_<record id>.
        const m = /^er_(.+?)_(.+)$/.exec(String(r.id || ''));
        if (m && m[1] === hosp) { const x = free.find(p => p.id === m[2]); if (x) return x; }
        const ph = phoneOf(r.phone);
        if (ph) { const byPhone = pool.filter(x => phoneOf(x.phone) === ph); if (byPhone.length === 1 && !used.has(byPhone[0].id)) return byPhone[0]; }
        const k = keyOf(r.name);
        const byName = pool.filter(x => keyOf(x.name) === k);
        if (k && byName.length === 1 && !used.has(byName[0].id)) return byName[0];
        return null;
    }

    /** First and second name match (a likely candidate the admin confirms). */
    function suggest(r, pool, used) {
        const t = keyOf(r.name).split(' ');
        if (t.length < 2) return null;
        const c = pool.filter(x => !used.has(x.id) && (() => { const u = keyOf(x.name).split(' '); return u[0] === t[0] && u[1] === t[1]; })());
        return c.length === 1 ? c[0] : null;
    }

    /** The new name replaces the old one in this hospital's ER schedules of every month. */
    function renameInMonths(st, hosp, oldName, newName) {
        const oldKey = keyOf(oldName);
        if (!oldKey) return 0;
        let n = 0;
        const fix = sched => {
            let changed = false;
            ['er', 'con', 'dc', 'rs'].forEach(type => (Array.isArray(sched && sched[type]) ? sched[type] : []).forEach(day => {
                if (!day || typeof day !== 'object') return;
                Object.keys(day).forEach(f => {
                    if (!NOT_NAMES.has(f) && typeof day[f] === 'string' && day[f] && day[f] !== newName && keyOf(day[f]) === oldKey) { day[f] = newName; n++; changed = true; }
                });
            }));
            return changed;
        };
        Object.keys(st.monthlySchedules || {}).forEach(k => { if (k.startsWith(hosp + '_')) fix(st.monthlySchedules[k]); });
        if (hosp === st.hospitalId) fix(st.schedules);
        // The months kept on this device (mirrored to the server by the page's storage sync).
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(MONTH_PREFIX + hosp + '_')) keys.push(k); }
        keys.forEach(k => {
            try {
                const sched = JSON.parse(localStorage.getItem(k) || 'null');
                if (sched && fix(sched)) localStorage.setItem(k, JSON.stringify(sched));
            } catch (e) {}
        });
        if (hosp === st.hospitalId && st.headOfResidents && keyOf(st.headOfResidents) === oldKey) st.headOfResidents = newName;
        return n;
    }

    /** The ER specialty name of a hospital record ({ name, sig }), from the hospital's specialties. */
    function specOf(rec, hosp) {
        const code = rec.spec || rec.tag;
        const h = Hub() && Hub().getHospital && Hub().getHospital(hosp);
        const s = code && h && Array.isArray(h.specialties) ? h.specialties.find(x => x.id === code) : null;
        if (!s) return null;
        let name = s.name_en || s.enName || s.name_ar || s.id;
        try { name = core().canonicalizeSpecialtyName(name); } catch (e) {}
        return { name, sig: `${code}|${name}` };
    }

    let lastReport = null;
    /**
     * Links what can be linked and copies name and phone from the hospital database.
     * Returns { linked, total, unlinked: [{ r, hosp, hint }], away: [{ r, hosp, rec }], renamed }.
     */
    function reconcile({ quiet = false } = {}) {
        if (!ready()) return null;
        const st = core().state();
        const all = hubResidents();
        const byId = new Map(all.map(x => [x.id, x]));
        const report = { linked: 0, total: 0, unlinked: [], away: [], renamed: 0, updated: 0 };
        let changed = false;
        erLists(st).forEach((list, hosp) => {
            const pool = all.filter(x => (x.hospitals || []).includes(hosp));
            const used = new Set(list.map(r => r.hubId).filter(Boolean));
            list.forEach(r => {
                if (!r || typeof r !== 'object') return;
                if (r.hubId && !byId.has(r.hubId)) { delete r.hubId; changed = true; }  // record deleted
                if (!r.hubId) {
                    const rec = findRecord(r, hosp, pool, used);
                    if (rec) { r.hubId = rec.id; used.add(rec.id); changed = true; }
                }
                const rec = r.hubId ? byId.get(r.hubId) : null;
                if (hosp === st.hospitalId) report.total++;
                if (!rec) { if (hosp === st.hospitalId) report.unlinked.push({ r, hosp, hint: suggest(r, pool, used) }); return; }
                if (hosp === st.hospitalId) report.linked++;
                if (!(rec.hospitals || []).includes(hosp) && hosp === st.hospitalId) report.away.push({ r, hosp, rec });
                if (rec.name && r.name !== rec.name) {
                    // Another ER resident of this hospital with the old name: their duties could not be told apart.
                    const twin = list.some(o => o !== r && keyOf(o.name) === keyOf(r.name));
                    if (!twin) report.renamed += renameInMonths(st, hosp, r.name, rec.name);
                    r.name = rec.name;
                    report.updated++;
                    changed = true;
                }
                const ph = rec.phone && phoneOf(rec.phone) ? rec.phone : '';
                if (ph && phoneOf(r.phone) !== phoneOf(ph)) { r.phone = ph; report.updated++; changed = true; }
                // The specialty follows the hospital record too: when the record moves to another specialty,
                // or the hospital's specialty is renamed. (First seen: only remembered, so a specialty the
                // admin chose for the ER on purpose is kept until the hospital side changes.)
                const sp = specOf(rec, hosp);
                if (sp && r.hubSpec !== sp.sig) {
                    if (r.hubSpec && r.specialty !== sp.name) { r.specialty = sp.name; report.updated++; }
                    r.hubSpec = sp.sig;
                    changed = true;
                }
            });
        });
        lastReport = report;
        if (changed) {
            try { core().saveState(); } catch (e) {}
            try { core().refreshDBView(); } catch (e) {}
            try { core().renderActiveTab(); } catch (e) {}
            if (!quiet && report.updated) notify(`تم تحديث ${report.updated} من بيانات أطباء الطوارئ من قاعدة مقيمي المستشفى`, 'info');
        }
        decorate();
        return report;
    }

    // ------------------------------------------------------------------
    // The ER residents table: link status, identity fields locked for linked residents
    // ------------------------------------------------------------------
    function erResident(id) {
        const st = core() && core().state();
        return st ? (st.residents || []).find(r => r.id === id) : null;
    }

    function banner() {
        const r = lastReport;
        if (!r) return '';
        const ok = !r.unlinked.length && !r.away.length;
        return `<div class="erl-banner ${ok ? 'ok' : 'warn'}" data-erl-banner>
            <i class="fas ${ok ? 'fa-link' : 'fa-triangle-exclamation'}"></i>
            <span><b>مرتبط بقاعدة مقيمي ${esc(hospitalName(core().state().hospitalId))}: ${r.linked} من ${r.total}</b>
            <small>الاسم والهاتف يُؤخذان من قاعدة المستشفى تلقائياً${r.unlinked.length ? ` · ${r.unlinked.length} غير مرتبط` : ''}${r.away.length ? ` · ${r.away.length} لم يعد في المستشفى` : ''}</small></span>
            ${ok ? '' : '<button type="button" data-erl-review>مراجعة الربط</button>'}
        </div>`;
    }

    let decorating = false;
    function decorate() {
        if (decorating || !lastReport) return;
        decorating = true;
        try {
            const rows = document.querySelectorAll('tr[data-resident-id]');
            rows.forEach(tr => {
                const r = erResident(tr.dataset.residentId);
                if (!r) return;
                const cell = tr.querySelector('.resident-name-cell');
                const input = cell && cell.querySelector('input.db-cell-input');
                if (!cell || !input) return;
                const linked = !!r.hubId;
                if (input.readOnly !== linked) input.readOnly = linked;
                input.title = linked ? 'الاسم من قاعدة مقيمي المستشفى (يُعدّل من صفحة المقيمين)' : 'غير مرتبط بقاعدة المستشفى';
                let badge = cell.querySelector('[data-erl-badge]');
                const want = linked ? 'linked' : 'unlinked';
                if (!badge || badge.dataset.erlBadge !== want) {
                    if (badge) badge.remove();
                    badge = document.createElement('span');
                    badge.dataset.erlBadge = want;
                    badge.className = 'erl-badge ' + want;
                    badge.innerHTML = linked ? '<i class="fas fa-link"></i>' : '<i class="fas fa-link-slash"></i>';
                    badge.title = linked ? 'مرتبط بقاعدة مقيمي المستشفى' : 'غير مرتبط بقاعدة المستشفى: اضغط للربط';
                    if (!linked) badge.addEventListener('click', () => openReview(r.id));
                    (cell.querySelector('div') || cell).prepend(badge);
                }
            });
            if (rows.length) {
                const table = rows[0].closest('table');
                const host = table && table.parentElement;
                const old = document.querySelector('[data-erl-banner]');
                const r = lastReport;
                const sig = [core().state().hospitalId, r.linked, r.total, r.unlinked.length, r.away.length].join('|');
                // Re-drawn only when its numbers change or the table was re-rendered without it.
                if (host && (!old || old.dataset.sig !== sig || old.nextElementSibling !== host)) {
                    if (old) old.remove();
                    host.insertAdjacentHTML('beforebegin', banner());
                    const nb = host.previousElementSibling;
                    nb.dataset.sig = sig;
                    const b = nb.querySelector('[data-erl-review]');
                    if (b) b.addEventListener('click', () => openReview());
                }
            }
        } finally { decorating = false; }
    }

    // ------------------------------------------------------------------
    // Review: link by hand, or add the resident to the hospital database
    // ------------------------------------------------------------------
    function openReview(focusId) {
        const report = reconcile({ quiet: true }) || lastReport;
        if (!report) { notify('قاعدة مقيمي المستشفى غير محمّلة بعد', 'warning'); return; }
        const st = core().state();
        const hosp = st.hospitalId;
        const used = new Set((st.residents || []).map(r => r.hubId).filter(Boolean));
        const pool = hubResidents().filter(x => (x.hospitals || []).includes(hosp) && !used.has(x.id))
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
        let modal = document.getElementById('erl-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'erl-modal'; document.body.appendChild(modal); }
        modal.className = 'erl-modal';
        const options = pool.map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.phone ? ' · ' + esc(x.phone) : ''}</option>`).join('');
        modal.innerHTML = `<div class="erl-card" role="dialog" aria-modal="true" aria-label="ربط أطباء الطوارئ بقاعدة المستشفى">
            <header><div><h3>ربط أطباء الطوارئ بقاعدة ${esc(hospitalName(hosp))}</h3>
            <p>كل طبيب في الطوارئ يجب أن يكون من مقيمي المستشفى. بعد الربط يُؤخذ اسمه وهاتفه من قاعدة المستشفى، ويُحدَّث اسمه في جداول الطوارئ لكل الأشهر.</p></div>
            <button type="button" data-erl-close aria-label="إغلاق">✕</button></header>
            <div class="erl-body">
            ${report.unlinked.length ? report.unlinked.map(({ r, hint }) => `<div class="erl-row ${r.id === focusId ? 'focus' : ''}" data-id="${esc(r.id)}">
                <div class="erl-who"><b>${esc(r.name)}</b><small>${esc(r.phone || 'بلا هاتف')} · ${esc(r.specialty || '')}</small></div>
                ${hint ? `<button type="button" class="erl-btn good" data-erl-link="${esc(hint.id)}"><i class="fas fa-link"></i> ربط بـ ${esc(hint.name)}</button>` : ''}
                <div class="erl-pick"><select aria-label="اختر المقيم من قاعدة المستشفى"><option value="">اختر من مقيمي المستشفى…</option>${options}</select>
                <button type="button" class="erl-btn" data-erl-link-pick>ربط</button></div>
                <button type="button" class="erl-btn ghost" data-erl-export><i class="fas fa-user-plus"></i> إضافته إلى قاعدة المستشفى</button>
            </div>`).join('') : '<div class="erl-empty">✓ كل أطباء الطوارئ مرتبطون بقاعدة المستشفى.</div>'}
            ${report.away.length ? `<h4>لم يعودوا من مقيمي هذا المستشفى</h4>${report.away.map(({ r, rec }) => `<div class="erl-row away"><div class="erl-who"><b>${esc(r.name)}</b>
                <small>مسجّل الآن في: ${esc((rec.hospitals || []).map(hospitalName).join('، ') || '—')}. عطّله في الطوارئ إن لم يعد يداوم هنا.</small></div></div>`).join('')}` : ''}
            </div></div>`;
        const close = () => modal.remove();
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.querySelector('[data-erl-close]').addEventListener('click', close);
        const link = (erId, recId) => {
            const r = erResident(erId);
            const rec = hubResidents().find(x => x.id === recId);
            if (!r || !rec) return;
            if ((st.residents || []).some(o => o !== r && o.hubId === recId)) { notify('هذا المقيم مرتبط بطبيب آخر في الطوارئ', 'error'); return; }
            if (!confirm(`ربط «${r.name}» بالمقيم «${rec.name}» في قاعدة المستشفى؟\nسيُعتمد اسمه وهاتفه من قاعدة المستشفى في الطوارئ ولكل الأشهر.`)) return;
            r.hubId = rec.id;
            reconcile();
            try { core().pushDBHistory(`ربط ${rec.name} بقاعدة المستشفى`); } catch (e) {}
            notify(`تم ربط ${rec.name} ✓`, 'success');
            openReview();
        };
        modal.querySelectorAll('[data-erl-link]').forEach(b => b.addEventListener('click', () => link(b.closest('.erl-row').dataset.id, b.dataset.erlLink)));
        modal.querySelectorAll('[data-erl-link-pick]').forEach(b => b.addEventListener('click', () => {
            const v = b.parentElement.querySelector('select').value;
            if (!v) { notify('اختر المقيم أولاً', 'warning'); return; }
            link(b.closest('.erl-row').dataset.id, v);
        }));
        modal.querySelectorAll('[data-erl-export]').forEach(b => b.addEventListener('click', () => {
            const id = b.closest('.erl-row').dataset.id;
            close();
            if (typeof window.openExportResidentModal === 'function') window.openExportResidentModal(id);
        }));
        const f = focusId && modal.querySelector('.erl-row.focus');
        if (f) f.scrollIntoView({ block: 'center' });
    }

    // ------------------------------------------------------------------
    // Hooks into the ER page
    // ------------------------------------------------------------------
    function wrap(name, fn) {
        const orig = window[name];
        if (typeof orig !== 'function' || orig.__erl) return;
        const w = function () { return fn.call(this, orig, arguments); };
        w.__erl = true;
        window[name] = w;
    }

    function install() {
        // Name and phone of a linked resident come from the hospital database.
        wrap('onResidentFieldChange', function (orig, args) {
            const [resId, field] = args;
            const r = erResident(resId);
            if (r && r.hubId && (field === 'name' || field === 'phone')) {
                notify('الاسم والهاتف من قاعدة مقيمي المستشفى؛ عدّلهما من صفحة المقيمين وسيتحدثان هنا تلقائياً', 'warning');
                try { core().refreshDBView(); } catch (e) {}
                decorate();
                return;
            }
            return orig.apply(this, args);
        });
        // ER residents are added from the hospital database only.
        wrap('openAddResidentModal', function () {
            const st = core().state();
            notify('يُضاف أطباء الطوارئ من قاعدة مقيمي المستشفى', 'info');
            return window.openImportResidentFromHospitalModal(st.hospitalId);
        });
        // The import links the new ER resident to the record it came from.
        wrap('handleSaveImportedResident', function (orig, args) {
            const st = core().state();
            const recId = (document.getElementById('import-res-selected-id') || {}).value || '';
            const before = new Set((st.residents || []).map(r => r.id));
            const out = orig.apply(this, args);
            const rec = hubResidents().find(x => x.id === recId);
            const added = (st.residents || []).filter(r => !before.has(r.id));
            if (rec && added.length === 1 && !(st.residents || []).some(r => r.hubId === rec.id)) {
                added[0].hubId = rec.id;
                added[0].name = rec.name;
                if (rec.phone) added[0].phone = rec.phone;
                try { core().saveState(); } catch (e) {}
            }
            setTimeout(() => reconcile({ quiet: true }), 50);
            return out;
        });
        ['onHospitalChange', 'openResidentsDbModal', 'handleConfirmExportResident', 'importAllMissingDoctorsToER'].forEach(n => wrap(n, function (orig, args) {
            const out = orig.apply(this, args);
            Promise.resolve(out).then(() => setTimeout(() => reconcile(), 300));
            return out;
        }));
        // The hospital database changed (a rename on the residents page, another device): follow it.
        let t = null;
        window.addEventListener('hub:data-changed', () => { clearTimeout(t); t = setTimeout(() => reconcile(), 1200); });
        new MutationObserver(() => { if (!decorating) requestAnimationFrame(decorate); })
            .observe(document.body, { childList: true, subtree: true });
        // The import form shows the hospital's name and phone as they are (identity is not edited here).
        document.addEventListener('focusin', e => {
            if (e.target && (e.target.id === 'import-res-name' || e.target.id === 'import-res-phone')) e.target.readOnly = !!(document.getElementById('import-res-selected-id') || {}).value;
        });
    }

    const CSS = `
        .erl-banner { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; padding: 10px 14px; border-radius: 14px; font-size: 12px; border: 1px solid; }
        .erl-banner.ok { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.35); color: #047857; }
        .erl-banner.warn { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.45); color: #92400e; }
        .erl-banner span { flex: 1; min-width: 0; display: grid; gap: 2px; }
        .erl-banner small { opacity: 0.85; font-weight: 600; }
        .erl-banner button { flex: none; padding: 6px 12px; border-radius: 10px; border: 0; background: #d97706; color: #fff; font: 800 11px inherit; font-family: inherit; cursor: pointer; }
        .erl-badge { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 999px; font-size: 10px; }
        .erl-badge.linked { background: rgba(16, 185, 129, 0.12); color: #059669; }
        .erl-badge.unlinked { background: rgba(239, 68, 68, 0.12); color: #dc2626; cursor: pointer; }
        .resident-name-cell input[readonly] { cursor: default; }
        .erl-modal { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .erl-card { width: 100%; max-width: 620px; max-height: 88vh; display: flex; flex-direction: column; background: #fff; color: #0f172a; border-radius: 22px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
        .erl-card * { box-sizing: border-box; }
        @media (max-width: 640px) {
            .erl-modal { padding: 10px; align-items: flex-end; }
            .erl-card { max-height: 92vh; border-radius: 20px; }
            .erl-card header, .erl-body { padding-left: 12px; padding-right: 12px; }
        }
        .erl-card header { display: flex; gap: 10px; align-items: flex-start; padding: 16px; border-bottom: 1px solid rgba(148,163,184,.25); }
        .erl-card header div { flex: 1; }
        .erl-card h3 { font-size: 14px; font-weight: 900; margin: 0 0 4px; }
        .erl-card header p { font-size: 11px; opacity: .75; margin: 0; line-height: 1.6; }
        .erl-card header button { border: 0; background: rgba(148,163,184,.2); width: 30px; height: 30px; border-radius: 999px; cursor: pointer; color: inherit; }
        .erl-body { overflow-y: auto; overflow-x: hidden; padding: 12px 16px 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
        .erl-body h4 { font-size: 12px; font-weight: 900; margin: 8px 0 0; }
        .erl-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; padding: 10px 12px; border-radius: 14px; border: 1px solid rgba(148,163,184,.3); }
        .erl-row.focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,.18); }
        .erl-row.away { background: rgba(148,163,184,.08); }
        .erl-who { flex: 1 1 100%; min-width: 0; display: grid; gap: 2px; font-size: 12px; overflow-wrap: anywhere; }
        .erl-who small { opacity: .7; font-weight: 600; }
        .erl-pick { display: flex; gap: 6px; flex: 1 1 100%; min-width: 0; }
        /* Width set by the row, not by the longest name in the list (Safari sizes selects by their text). */
        .erl-pick select { flex: 1 1 0; width: 0; min-width: 0; max-width: 100%; padding: 8px; border-radius: 10px; border: 1px solid rgba(148,163,184,.5); background: #fff; color: #0f172a; font: inherit; font-size: 12px; text-overflow: ellipsis; }
        .erl-btn { max-width: 100%; padding: 7px 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,.5); background: transparent; color: inherit; font: 800 11px inherit; font-family: inherit; cursor: pointer; white-space: normal; text-align: center; overflow-wrap: anywhere; }
        .erl-btn.good { background: #059669; border-color: #059669; color: #fff; }
        .erl-btn.ghost { color: #0369a1; }
        .erl-empty { padding: 18px; text-align: center; font-weight: 800; color: #059669; font-size: 12px; }
        /* Dark mode: a readable palette of its own (light text on dark surfaces, brighter accents). */
        html.dark .erl-modal { background: rgba(2, 6, 23, 0.72); }
        html.dark .erl-card { background: #111827; color: #f1f5f9; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
        html.dark .erl-card header { border-bottom-color: #334155; }
        html.dark .erl-card header p { color: #cbd5e1; opacity: 1; }
        html.dark .erl-card header button { background: #334155; color: #f1f5f9; }
        html.dark .erl-row { background: #1f2937; border-color: #374151; }
        html.dark .erl-row.away { background: #1e293b; }
        html.dark .erl-row.focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.25); }
        html.dark .erl-who small { color: #cbd5e1; opacity: 1; }
        html.dark .erl-pick select { background: #0f172a; color: #f1f5f9; border-color: #475569; color-scheme: dark; }
        html.dark .erl-btn { border-color: #475569; color: #f1f5f9; }
        html.dark .erl-btn.good { background: #059669; border-color: #10b981; color: #fff; }
        html.dark .erl-btn.ghost { color: #7dd3fc; border-color: #0369a1; }
        html.dark .erl-empty { color: #34d399; }
        html.dark .erl-banner.ok { background: rgba(16, 185, 129, 0.14); color: #6ee7b7; }
        html.dark .erl-banner.warn { background: rgba(245, 158, 11, 0.14); color: #fcd34d; }`;

    function start() {
        if (!document.getElementById('erl-style')) {
            const s = document.createElement('style');
            s.id = 'erl-style';
            s.textContent = CSS;
            document.head.appendChild(s);
        }
        let tries = 0;
        const tick = () => {
            if (ready() && core()) { install(); reconcile(); return; }
            if (++tries < 120) setTimeout(tick, 1000);
        };
        tick();
    }
    window.EmergencyLink = { reconcile, openReview, report: () => lastReport };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
