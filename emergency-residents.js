/**
 * ER residents: added from the hospital's database only, and managed many at a time.
 *
 * - Import: every way of adding a resident to the ER (the import button, "add resident", the hospital
 *   match screen) opens one picker with the hospital's residents who are not in the ER yet, grouped by
 *   specialty, with a select-all box per specialty and for the whole hospital. One resident is added
 *   with its own button, several with the checkboxes. Each new ER resident is linked to its hospital
 *   record (hubId, see emergency-link.js); a name typed by hand can no longer be added.
 * - Selection: the residents panel's "تحديد متعدد" opens the same picker over the ER residents, to
 *   deactivate (for the month on screen), reactivate or delete (from the ER database only) the
 *   residents ticked, or a whole specialty.
 * - Board information: the residents' accounts are its source. The board and stage of an ER resident
 *   with an account follow the account (edited by the resident, or by the hospital's admins), and are
 *   not edited on this page.
 * - Pop-ups opened from another pop-up (preferences over the residents panel) are drawn above it.
 */
(function (window, document) {
    'use strict';

    const core = () => window.EmergencyCore;
    const Hub = () => window.Hub;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const notify = (msg, type) => { try { core().showNotification(msg, type); } catch (e) {} };
    const phoneOf = p => { const d = String(p || '').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, ''); const m = /7\d{9}$/.exec(d); return m ? m[0] : ''; };
    const norm = s => { try { return core().normalizeArabic(String(s || '')).toLowerCase(); } catch (e) { return String(s || '').toLowerCase(); } };
    const hospitalName = id => { const h = Hub() && Hub().getHospital && Hub().getHospital(id); return h ? (h.name_ar || h.hospitalName) : id; };
    const STAGES = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];
    const BOARD_ER = { arab: 'Arabic', iraqi: 'Iraqi', none: 'None' };
    const FEMALE = ['فاطمة', 'زينب', 'زهراء', 'مريم', 'نور', 'سارة', 'هدى', 'شهد', 'آية', 'اية', 'رشا', 'دعاء', 'رنا', 'منى', 'اسراء', 'إسراء', 'أمل', 'امل', 'ريم', 'حوراء', 'تبارك', 'ضحى', 'بنين', 'تقى', 'فرح', 'آلاء', 'أبرار', 'مروة', 'يقين', 'إيناس', 'خديجة'];

    // ------------------------------------------------------------------
    // Board information from the residents' accounts
    // ------------------------------------------------------------------
    const profileCache = new Map(); // hospital -> { at, list }
    async function profiles(hosp, fresh) {
        const c = profileCache.get(hosp);
        if (c && !fresh && Date.now() - c.at < 60 * 1000) return c.list;
        try {
            const res = await Hub().api('GET', '/api/accounts/er-profiles?h=' + encodeURIComponent(hosp), undefined, { retries: 1 });
            const list = Array.isArray(res && res.profiles) ? res.profiles : [];
            profileCache.set(hosp, { at: Date.now(), list });
            return list;
        } catch (e) {
            return c ? c.list : [];
        }
    }
    const cachedProfiles = hosp => (profileCache.get(hosp) || {}).list || [];
    /** The account of an ER resident (or a hospital record): by its hospital record, else by phone. */
    function accountOf(list, recId, phone) {
        const byRec = recId && list.find(p => p.resident_id === recId);
        if (byRec) return byRec;
        const ph = phoneOf(phone);
        const byPhone = ph ? list.filter(p => phoneOf(p.phone) === ph) : [];
        return byPhone.length === 1 ? byPhone[0] : null;
    }
    /** { board, stage } for the ER from an account, or null (no board set on the account). */
    function boardOf(p) {
        if (!p || !BOARD_ER[p.board]) return null;
        const out = { board: BOARD_ER[p.board] };
        if (p.board !== 'none' && p.stage_now) out.stage = STAGES[Math.min(6, Math.max(1, Number(p.stage_now)))];
        return out;
    }
    const accountBoardOf = r => {
        const st = core() && core().state();
        return st && r ? boardOf(accountOf(cachedProfiles(st.hospitalId), r.hubId, r.phone)) : null;
    };

    const BOARD_ACCOUNT = { Arabic: 'arab', Iraqi: 'iraqi', None: 'none' };
    /** An ER change of board / stage goes to the resident's account (admins and the owner may set it). */
    async function pushBoard(r) {
        const st = core().state();
        const p = accountOf(cachedProfiles(st.hospitalId), r.hubId, r.phone);
        if (!p) return;
        const board = BOARD_ACCOUNT[r.board] || null;
        const n = STAGES.indexOf(r.stage);
        const stage = board === 'none' || !board ? null : (n > 0 ? n : (p.stage_now || null));
        const years = board === 'none' ? null : Math.max(p.board_years || 0, stage || 0) || null;
        if (p.board === board && (board === 'none' || p.stage_now === stage)) return;
        try {
            await Hub().api('POST', '/api/accounts/decide', { id: p.id, action: 'set_profile', profile: { board, specialty: p.specialty || '', stage, boardYears: years } }, { retries: 1 });
            Object.assign(p, { board, stage_now: stage, board_years: years });
            notify('حُدّثت معلومات البورد في الملف الشخصي للمقيم أيضاً ✓', 'success');
        } catch (e) {
            notify('تعذر تحديث الملف الشخصي للمقيم: ' + ((e && e.data && e.data.error) || 'خطأ في الاتصال'), 'error');
        }
    }

    let syncing = false;
    /** Copies the board and stage of every ER resident who has an account from that account. */
    async function syncBoards({ fresh = false, quiet = false } = {}) {
        if (syncing || !core() || !core().ready()) return 0;
        syncing = true;
        try {
            const st = core().state();
            const hosp = st.hospitalId;
            const list = await profiles(hosp, fresh);
            if (st.hospitalId !== hosp || !list.length) return 0;
            let n = 0;
            (st.residents || []).forEach(r => {
                const b = boardOf(accountOf(list, r.hubId, r.phone));
                if (!b) return;
                if (r.board !== b.board) { r.board = b.board; n++; }
                if (b.stage && r.stage !== b.stage) { r.stage = b.stage; n++; }
            });
            if (n) {
                try { core().saveState(); } catch (e) {}
                try { core().refreshDBView(); } catch (e) {}
                if (!quiet) notify(`تم تحديث معلومات البورد لأطباء الطوارئ من حساباتهم (${n})`, 'info');
            }
            decorate();
            return n;
        } finally { syncing = false; }
    }

    /** Board and stage of residents with an account are shown as read-only (they come from the account). */
    let decorating = false;
    function decorate() {
        if (decorating || !core() || !core().ready()) return;
        decorating = true;
        try {
            document.querySelectorAll('tr[data-resident-id]').forEach(tr => {
                const r = (core().state().residents || []).find(x => x.id === tr.dataset.residentId);
                const fromAccount = !!accountBoardOf(r);
                ['.resident-board-cell', '.resident-stage-cell'].forEach(sel => {
                    const cell = tr.querySelector(sel);
                    if (!cell) return;
                    const want = fromAccount ? '1' : '';
                    if ((cell.dataset.err || '') === want) return;
                    cell.dataset.err = want;
                    cell.title = fromAccount ? 'من حساب المقيم: تعديلها هنا يحدّث ملفه الشخصي أيضاً' : '';
                    cell.classList.toggle('err-from-account', fromAccount);
                });
            });
        } finally { decorating = false; }
    }

    // ------------------------------------------------------------------
    // The picker (shared by the import and the selection)
    // ------------------------------------------------------------------
    /**
     * opts: { title, note, groups: [{ key, title, color, items: [{ id, name, sub, tag }] }],
     *         options: html above the buttons, single: { label, run(id) }, actions: [{ label, cls, run(ids) }],
     *         preselect: [ids], empty: text }
     */
    function openPicker(opts) {
        closePicker();
        const modal = document.createElement('div');
        modal.id = 'err-picker';
        modal.className = 'err-modal';
        const selected = new Set(opts.preselect || []);
        const all = opts.groups.flatMap(g => g.items);
        modal.innerHTML = `<div class="err-card" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
            <header><div><h3>${esc(opts.title)}</h3>${opts.note ? `<p>${opts.note}</p>` : ''}</div>
                <button type="button" data-err-close aria-label="إغلاق">✕</button></header>
            ${all.length ? `<div class="err-tools">
                <input type="search" data-err-search placeholder="ابحث بالاسم أو الهاتف أو الاختصاص…" aria-label="بحث">
                <label class="err-all"><input type="checkbox" data-err-all> <span>تحديد الكل (<b data-err-total>${all.length}</b>)</span></label>
            </div>` : ''}
            <div class="err-body">${all.length ? opts.groups.filter(g => g.items.length).map(g => `<section class="err-group" data-group="${esc(g.key)}">
                <label class="err-group-head" style="--c:${esc(g.color || '#64748b')}"><input type="checkbox" data-err-group="${esc(g.key)}">
                    <span class="err-dot"></span><b>${esc(g.title)}</b><small data-err-gcount>${g.items.length}</small></label>
                ${g.items.map(it => `<div class="err-item" data-id="${esc(it.id)}" data-q="${esc(norm([it.name, it.sub, g.title, it.phone].join(' ')))} ${esc(phoneOf(it.phone))}">
                    <label><input type="checkbox" data-err-item value="${esc(it.id)}" ${selected.has(it.id) ? 'checked' : ''}>
                    <span class="err-who"><b>${esc(it.name)}</b>${it.sub ? `<small>${it.sub}</small>` : ''}</span></label>
                    ${it.tag ? `<span class="err-tag ${it.tagCls || ''}">${esc(it.tag)}</span>` : ''}
                    ${opts.single ? `<button type="button" class="err-btn sm" data-err-one="${esc(it.id)}">${esc(opts.single.label)}</button>` : ''}
                </div>`).join('')}</section>`).join('') : `<div class="err-empty">${esc(opts.empty || 'لا يوجد أحد')}</div>`}</div>
            ${all.length ? `<footer>${opts.options || ''}<div class="err-actions"><span class="err-count" data-err-count></span>
                ${opts.actions.map((a, i) => `<button type="button" class="err-btn ${a.cls || ''}" data-err-act="${i}" disabled>${esc(a.label)}</button>`).join('')}</div></footer>` : ''}
        </div>`;
        document.body.appendChild(modal);
        const $ = s => modal.querySelector(s);
        const $$ = s => [...modal.querySelectorAll(s)];
        const visible = el => !el.closest('.err-item').hidden;
        const paint = () => {
            const boxes = $$('[data-err-item]');
            boxes.forEach(b => b.closest('.err-item').classList.toggle('on', b.checked));
            $$('[data-err-group]').forEach(g => {
                const sec = g.closest('.err-group');
                const mine = [...sec.querySelectorAll('[data-err-item]')].filter(visible);
                const on = mine.filter(b => b.checked).length;
                g.checked = mine.length > 0 && on === mine.length;
                g.indeterminate = on > 0 && on < mine.length;
                sec.hidden = mine.length === 0;
                sec.querySelector('[data-err-gcount]').textContent = on ? `${on} / ${mine.length}` : String(mine.length);
            });
            const shown = boxes.filter(visible);
            const allBox = $('[data-err-all]');
            if (allBox) {
                const on = shown.filter(b => b.checked).length;
                allBox.checked = shown.length > 0 && on === shown.length;
                allBox.indeterminate = on > 0 && on < shown.length;
                $('[data-err-total]').textContent = shown.length;
            }
            const n = boxes.filter(b => b.checked).length;
            const count = $('[data-err-count]');
            if (count) count.textContent = n ? `محدد: ${n}` : 'لم يُحدَّد أحد';
            $$('[data-err-act]').forEach(b => { b.disabled = !n; });
        };
        const ids = () => $$('[data-err-item]:checked').map(b => b.value);
        modal.addEventListener('change', e => {
            const t = e.target;
            if (t.matches('[data-err-all]')) $$('[data-err-item]').filter(visible).forEach(b => { b.checked = t.checked; });
            if (t.matches('[data-err-group]')) [...t.closest('.err-group').querySelectorAll('[data-err-item]')].filter(visible).forEach(b => { b.checked = t.checked; });
            paint();
        });
        const search = $('[data-err-search]');
        if (search) search.addEventListener('input', () => {
            const q = norm(search.value.trim().replace(/^د[.\s]*/, ''));
            const qd = search.value.replace(/\D/g, '');
            $$('.err-item').forEach(el => { el.hidden = !!q && !el.dataset.q.includes(q) && !(qd.length >= 3 && el.dataset.q.includes(qd)); });
            paint();
        });
        modal.addEventListener('click', e => {
            if (e.target === modal || e.target.closest('[data-err-close]')) return closePicker();
            const one = e.target.closest('[data-err-one]');
            if (one) return opts.single.run(one.dataset.errOne);
            const act = e.target.closest('[data-err-act]');
            if (act && !act.disabled) opts.actions[Number(act.dataset.errAct)].run(ids());
        });
        paint();
        const first = selected.size && modal.querySelector('[data-err-item]:checked');
        if (first) first.closest('.err-item').scrollIntoView({ block: 'center' });
        else if (search && window.matchMedia('(min-width: 768px)').matches) search.focus();
        return modal;
    }
    function closePicker() { const m = document.getElementById('err-picker'); if (m) m.remove(); }

    // ------------------------------------------------------------------
    // Import from the hospital's database
    // ------------------------------------------------------------------
    /** The hospital's residents who are not in the ER yet, grouped by the hospital's specialties. */
    function importGroups(hosp) {
        const c = core();
        const st = c.state();
        const docs = c.getHospitalDoctorsList(hosp).filter(d => d && d.name);
        const specs = c.getHospitalSpecificSpecialties(hosp);
        const er = st.residents || [];
        const linked = new Set(er.map(r => r.hubId).filter(Boolean));
        const names = new Set(er.map(r => norm(r.name)));
        const phones = new Set(er.map(r => phoneOf(r.phone)).filter(Boolean));
        const fresh = docs.filter(d => !(d.id && linked.has(d.id)) && !names.has(norm(d.name)) && !(phoneOf(d.phone) && phones.has(phoneOf(d.phone))));
        const groups = specs.map(s => ({ key: s.id, title: s.name_ar ? `${s.name_ar} (${s.name_en})` : s.name_en, color: s.color, spec: s, items: [] }));
        const other = { key: '__other', title: 'أخرى', color: '#64748b', items: [] };
        const list = cachedProfiles(hosp);
        fresh.forEach(d => {
            const g = groups.find(x => c.isDoctorInHospitalSpecialty(d, x.key, specs)) || other;
            const acc = accountOf(list, d.id, d.phone);
            const b = boardOf(acc);
            const ph = c.formatIraqiPhoneNumber(d.phone || '');
            g.items.push({
                id: d.id || d.name, name: c.formatDoctorName(d.name), phone: d.phone || '', doc: d, group: g,
                sub: [ph && ph !== 'رقم غير متوفر' ? `<span dir="ltr">${esc(ph)}</span>` : 'بلا هاتف',
                    b ? `🎓 ${b.board === 'None' ? 'بدون بورد' : b.board === 'Arabic' ? 'بورد عربي' : 'بورد عراقي'}${b.stage ? ' · ' + b.stage : ''}` : '',
                    d.active === false ? 'غير نشط في المستشفى' : ''].filter(Boolean).join(' · '),
                tag: acc ? 'لديه حساب' : '',
            });
        });
        groups.push(other);
        groups.forEach(g => g.items.sort((a, b) => a.name.localeCompare(b.name, 'ar')));
        return groups;
    }

    function guessSex(name, acc) {
        if (acc && (acc.sex === 'f' || acc.sex === 'm')) return acc.sex === 'f' ? 'F' : 'M';
        const first = String(name || '').replace(/^د[.\s]+/, '').trim().split(/\s+/)[0] || '';
        return FEMALE.includes(first) || first.endsWith('ة') || first.endsWith('اء') ? 'F' : 'M';
    }

    /** ER residents for these hospital records, with the targets chosen in the picker. */
    function buildResidents(items, hosp, targets) {
        const c = core();
        const st = c.state();
        const taken = new Set((st.residents || []).map(r => r.id));
        const list = cachedProfiles(hosp);
        return items.map(it => {
            const d = it.doc;
            const acc = accountOf(list, d.id, d.phone);
            const b = boardOf(acc) || {};
            const spec = it.group.spec;
            const specialty = spec ? c.canonicalizeSpecialtyName(spec.name_en || spec.name_ar || spec.id) : c.canonicalizeSpecialtyName(d.spec || d.specialty || d.dept || '');
            let id = `er_${hosp}_${d.id || Date.now()}`;
            for (let i = 2; taken.has(id); i++) id = `er_${hosp}_${d.id}_${i}`;
            taken.add(id);
            const phone = c.formatIraqiPhoneNumber(d.phone || '');
            return {
                id, hubId: d.id || undefined, name: c.formatDoctorName(d.name), sex: guessSex(d.name, acc), specialty,
                board: b.board || 'None', stage: b.stage || 'الأولى',
                er_target: targets.er, con_target: targets.con, dc_target: targets.dc, rs_target: targets.rs,
                phone: phone === 'رقم غير متوفر' ? '' : phone, expiryMonth: '', notes: '', active: true, hospitals: [hosp],
                prefDays: [], prefShifts: [], noConsecutiveDays: true, preferences: { prefDays: [], prefShifts: [] },
            };
        });
    }

    /** The month's quotas would be exceeded by n more residents with these targets: the message, or ''. */
    function quotaProblem(n, targets) {
        const c = core();
        let summary = {};
        try { summary = c.getMonthlyDutyAllocationsSummary() || {}; } catch (e) {}
        const titles = { er: 'الطوارئ (ER)', con: 'الاستشارية (Con)', dc: 'شهادات الوفاة (DC)', rs: 'الإسناد الإضافي (RS)' };
        for (const k of Object.keys(titles)) {
            const s = summary[k];
            if (!s || !targets[k]) continue;
            if (s.allocated + n * targets[k] > s.required) {
                const left = Math.max(0, s.required - s.allocated);
                return `النصاب الافتراضي لـ ${titles[k]} (${targets[k]} × ${n} = ${n * targets[k]}) يتجاوز المتبقي لهذا الشهر (${left} من ${s.required}).\nخفّض النصاب الافتراضي أو اجعله 0 وحدّد الأنصبة في الجدول.`;
            }
        }
        return '';
    }

    async function openImport(preselectName) {
        const c = core();
        if (!c || !c.ready()) { notify('الصفحة ما زالت تُحمَّل…', 'info'); return; }
        try { await c.ensureHubDatabaseLoaded(); } catch (e) {}
        const st = c.state();
        const hosp = st.hospitalId;
        await profiles(hosp);
        const groups = importGroups(hosp);
        const items = groups.flatMap(g => g.items);
        const pre = preselectName ? items.filter(it => norm(it.doc.name) === norm(preselectName) || norm(it.name) === norm(preselectName)).map(it => it.id) : [];
        const rs = !!st.rsEnabled;
        const targetInput = (k, label, cls) => `<label class="err-target ${cls}"><span>${label}</span><input type="number" min="0" max="31" value="0" data-target="${k}" inputmode="numeric"></label>`;
        const add = (ids) => {
            const modal = document.getElementById('err-picker');
            const t = k => Math.max(0, parseInt((modal.querySelector(`[data-target="${k}"]`) || {}).value, 10) || 0);
            const targets = { er: t('er'), con: t('con'), dc: t('dc'), rs: rs ? t('rs') : 0 };
            const chosen = items.filter(it => ids.includes(it.id));
            if (!chosen.length) return;
            const problem = quotaProblem(chosen.length, targets);
            if (problem) { alert('⚠️ ' + problem); return; }
            const list = buildResidents(chosen, hosp, targets);
            const n = c.addResidentsToER(list, chosen.length === 1 ? `استيراد الطبيب (${list[0].name})` : `استيراد ${list.length} طبيب من قاعدة المستشفى`);
            closePicker();
            notify(n === 1 ? `تمت إضافة ${list[0].name} إلى قاعدة الطوارئ ✓` : `تمت إضافة ${n} طبيب إلى قاعدة الطوارئ ✓`, 'success');
            try { window.EmergencyLink && window.EmergencyLink.reconcile({ quiet: true }); } catch (e) {}
            decorate();
        };
        openPicker({
            title: `إضافة مقيمين من قاعدة ${hospitalName(hosp)}`,
            note: 'يُضاف إلى الطوارئ مقيمو المستشفى فقط. تظهر هنا أسماء من لم يُضافوا بعد؛ اسم غير موجود يُضاف أولاً إلى قاعدة مقيمي المستشفى من صفحة إدارة المستشفى.',
            groups,
            preselect: pre,
            empty: 'كل مقيمي المستشفى مضافون إلى الطوارئ ✓',
            options: `<div class="err-targets"><span>النصاب الافتراضي لكل مقيم:</span>${targetInput('er', 'ER', 'er')}${targetInput('con', 'Con', 'con')}${targetInput('dc', 'DC', 'dc')}${rs ? targetInput('rs', 'RS', 'rs') : ''}</div>`,
            single: { label: 'إضافة', run: id => add([id]) },
            actions: [{ label: 'إضافة المحددين', cls: 'primary', run: add }],
        });
    }

    // ------------------------------------------------------------------
    // Selection in the residents panel
    // ------------------------------------------------------------------
    function openSelection() {
        const c = core();
        if (!c || !c.ready()) return;
        const st = c.state();
        const list = st.residents || [];
        const byspec = new Map();
        list.forEach(r => {
            const k = r.specialty || 'أخرى';
            if (!byspec.has(k)) byspec.set(k, []);
            byspec.get(k).push(r);
        });
        const groups = [...byspec.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => ({
            key: k, title: k, color: (() => { try { return c.getSpecialtyColor(k); } catch (e) { return '#64748b'; } })(),
            items: rs.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')).map(r => ({
                id: r.id, name: r.name, phone: r.phone,
                sub: [r.active === false ? 'غير نشط هذا الشهر' : `ER ${r.er_target || 0} · Con ${r.con_target || 0} · DC ${r.dc_target || 0}`, r.phone ? `<span dir="ltr">${esc(r.phone)}</span>` : ''].filter(Boolean).join(' · '),
                tag: r.active === false ? 'معطّل' : '', tagCls: 'off',
            })),
        }));
        const names = ids => list.filter(r => ids.includes(r.id)).map(r => r.name);
        const preview = ids => { const n = names(ids); return n.slice(0, 8).join('\n') + (n.length > 8 ? `\n… و${n.length - 8} آخرون` : ''); };
        openPicker({
            title: 'تحديد أطباء الطوارئ',
            note: `حدّد أطباء أو اختصاصاً كاملاً، ثم اختر الإجراء. التعطيل لشهر (${esc(st.monthYear)}) فقط، والحذف من قاعدة الطوارئ فقط ويبقون في قاعدة المستشفى.`,
            groups,
            empty: 'لا يوجد أطباء في قاعدة الطوارئ',
            actions: [
                { label: 'تعطيل لهذا الشهر', cls: 'warn', run: ids => {
                    const act = list.filter(r => ids.includes(r.id) && r.active !== false);
                    if (!act.length) { notify('المحددون معطّلون مسبقاً', 'info'); return; }
                    if (!confirm(`تعطيل ${act.length} طبيب لشهر (${st.monthYear})؟\nتُصفَّر أنصبتهم وتُزال أسماؤهم من جداول هذا الشهر فقط.\n\n${preview(act.map(r => r.id))}`)) return;
                    c.bulkDeactivateResidents(act.map(r => r.id)); closePicker();
                } },
                { label: 'إعادة التنشيط', cls: '', run: ids => {
                    const off = list.filter(r => ids.includes(r.id) && r.active === false);
                    if (!off.length) { notify('المحددون نشطون مسبقاً', 'info'); return; }
                    c.bulkReactivateResidents(off.map(r => r.id)); closePicker();
                } },
                { label: 'حذف من الطوارئ', cls: 'danger', run: ids => {
                    if (!confirm(`حذف ${ids.length} طبيب من قاعدة الطوارئ؟\nيبقون في قاعدة مقيمي المستشفى ويمكن إضافتهم لاحقاً.\n\n${preview(ids)}`)) return;
                    c.bulkDeleteResidents(ids); closePicker();
                } },
            ],
        });
    }

    // ------------------------------------------------------------------
    // Pop-ups: the one opened last is drawn on top
    // ------------------------------------------------------------------
    // On phones every ER pop-up gets the same z-index (hub-ios.css), so the page order decided which one
    // was in front: the preferences pop-up comes before the residents panel in the page and opened behind it.
    let zTop = 100010;
    function watchModals() {
        const isModal = el => el && el.nodeType === 1 && el.id && /-modal$/.test(el.id) && el.classList.contains('fixed');
        const lift = el => { if (!el.classList.contains('hidden')) el.style.setProperty('z-index', String(++zTop), 'important'); };
        new MutationObserver(muts => muts.forEach(m => {
            if (m.type === 'attributes' && isModal(m.target)) {
                const was = String(m.oldValue || '').split(/\s+/).includes('hidden');
                if (was && !m.target.classList.contains('hidden')) lift(m.target);
            } else if (m.type === 'childList') m.addedNodes.forEach(n => { if (isModal(n)) lift(n); });
        })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, childList: true });
    }

    // ------------------------------------------------------------------
    // Hooks into the ER page
    // ------------------------------------------------------------------
    function install() {
        // Every way of adding a resident opens the picker.
        window.openAddResidentModal = () => openImport();
        window.openImportResidentFromHospitalModal = (hospId, name) => openImport(name);
        window.importSingleDoctorToER = name => { try { window.closeHospitalSyncModal(); } catch (e) {} openImport(name); };
        window.importAllMissingDoctorsToER = () => { try { window.closeHospitalSyncModal(); } catch (e) {} openImport(); };
        window.openResidentsSelection = openSelection;
        // Board and stage of a resident with an account: changed here, they change in the account too
        // (their profile), so the account stays the one source both sides follow.
        const toAccount = name => {
            const orig = window[name];
            if (typeof orig !== 'function' || orig.__err) return;
            const w = function (id) {
                const out = orig.apply(this, arguments);
                const r = (core().state().residents || []).find(x => x.id === id);
                if (r) pushBoard(r);
                return out;
            };
            w.__err = true;
            window[name] = w;
        };
        toAccount('cycleResidentBoard');
        toAccount('selectResidentStage');
        const after = (name, fn) => {
            const orig = window[name];
            if (typeof orig !== 'function' || orig.__errAfter) return;
            const w = function () { const out = orig.apply(this, arguments); Promise.resolve(out).then(() => setTimeout(fn, 400)); return out; };
            w.__errAfter = true;
            window[name] = w;
        };
        after('openResidentsDbModal', () => syncBoards({ fresh: true }));
        after('onHospitalChange', () => syncBoards());
        after('advanceBoardResidentsStage', () => syncBoards({ quiet: true }));
        new MutationObserver(() => { if (!decorating) requestAnimationFrame(decorate); }).observe(document.body, { childList: true, subtree: true });
    }

    const CSS = `
        .err-modal { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .err-card { width: 100%; max-width: 680px; max-height: 90vh; display: flex; flex-direction: column; background: #fff; color: #0f172a; border-radius: 22px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); font-size: 12px; }
        .err-card * { box-sizing: border-box; }
        .err-card header { display: flex; gap: 10px; align-items: flex-start; padding: 16px; border-bottom: 1px solid rgba(148,163,184,.25); }
        .err-card header div { flex: 1; min-width: 0; }
        .err-card h3 { font-size: 14px; font-weight: 900; margin: 0 0 4px; }
        .err-card header p { font-size: 11px; opacity: .75; margin: 0; line-height: 1.6; }
        .err-card header button { flex: none; border: 0; background: rgba(148,163,184,.2); width: 30px; height: 30px; border-radius: 999px; cursor: pointer; color: inherit; }
        .err-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; border-bottom: 1px solid rgba(148,163,184,.2); }
        .err-tools input[type=search] { flex: 1 1 220px; min-width: 0; padding: 8px 12px; border-radius: 12px; border: 1px solid rgba(148,163,184,.5); background: #fff; color: inherit; font: inherit; }
        .err-all { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; cursor: pointer; user-select: none; white-space: nowrap; }
        .err-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 16px 12px; }
        .err-group { margin: 8px 0 4px; border: 1px solid rgba(148,163,184,.3); border-radius: 14px; overflow: hidden; }
        .err-group-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: color-mix(in srgb, var(--c) 9%, transparent); cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 1; }
        .err-group-head b { flex: 1; min-width: 0; font-weight: 900; }
        .err-group-head small { font-weight: 800; opacity: .75; font-family: ui-monospace, monospace; }
        .err-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--c); flex: none; }
        .err-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-top: 1px solid rgba(148,163,184,.18); }
        .err-item.on { background: rgba(225, 29, 72, 0.06); }
        .err-item label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .err-who { min-width: 0; display: grid; gap: 1px; overflow-wrap: anywhere; }
        .err-who small { opacity: .7; font-weight: 600; font-size: 11px; }
        .err-tag { flex: none; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: rgba(16,185,129,.12); color: #047857; }
        .err-tag.off { background: rgba(245,158,11,.14); color: #b45309; }
        .err-card input[type=checkbox] { width: 18px; height: 18px; flex: none; accent-color: #e11d48; cursor: pointer; }
        .err-empty { padding: 24px; text-align: center; font-weight: 800; color: #059669; }
        .err-card footer { border-top: 1px solid rgba(148,163,184,.25); padding: 10px 16px 12px; display: grid; gap: 8px; }
        .err-targets { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 800; }
        .err-target { display: inline-flex; align-items: center; gap: 4px; }
        .err-target input { width: 52px; padding: 5px; border-radius: 10px; border: 1px solid rgba(148,163,184,.5); text-align: center; font: 800 12px ui-monospace, monospace; background: #fff; color: inherit; }
        .err-target.er span { color: #e11d48; } .err-target.con span { color: #0284c7; } .err-target.dc span { color: #059669; } .err-target.rs span { color: #d97706; }
        .err-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; justify-content: flex-end; }
        .err-count { margin-inline-end: auto; font-weight: 800; opacity: .8; }
        .err-btn { padding: 8px 14px; border-radius: 12px; border: 1px solid rgba(148,163,184,.5); background: transparent; color: inherit; font: 800 12px inherit; font-family: inherit; cursor: pointer; }
        .err-btn.sm { padding: 5px 10px; font-size: 11px; flex: none; color: #be123c; border-color: rgba(225,29,72,.35); }
        .err-btn.primary { background: #e11d48; border-color: #e11d48; color: #fff; }
        .err-btn.warn { background: #d97706; border-color: #d97706; color: #fff; }
        .err-btn.danger { background: transparent; border-color: #e11d48; color: #be123c; }
        .err-btn:disabled { opacity: .45; cursor: not-allowed; }
        .err-from-account { position: relative; }
        .err-from-account > * { opacity: .85; }
        .err-from-account::after { content: '\\1F512'; position: absolute; top: 1px; left: 2px; font-size: 8px; opacity: .7; }
        @media (max-width: 640px) {
            .err-modal { padding: 0; align-items: flex-end; }
            .err-card { max-height: 94vh; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
            .err-card header, .err-tools, .err-body, .err-card footer { padding-left: 12px; padding-right: 12px; }
            .err-actions .err-btn:not(.sm) { flex: 1 1 auto; }
        }
        html.dark .err-modal { background: rgba(2, 6, 23, 0.72); }
        html.dark .err-card { background: #111827; color: #f1f5f9; }
        html.dark .err-card header, html.dark .err-tools, html.dark .err-card footer { border-color: #334155; }
        html.dark .err-card header p { color: #cbd5e1; opacity: 1; }
        html.dark .err-card header button { background: #334155; color: #f1f5f9; }
        html.dark .err-tools input[type=search], html.dark .err-target input { background: #0f172a; border-color: #475569; color: #f1f5f9; color-scheme: dark; }
        html.dark .err-group { border-color: #374151; }
        html.dark .err-item { border-top-color: #1f2937; }
        html.dark .err-item.on { background: rgba(244, 63, 94, 0.14); }
        html.dark .err-who small { color: #cbd5e1; opacity: 1; }
        html.dark .err-tag { background: rgba(16,185,129,.18); color: #6ee7b7; }
        html.dark .err-tag.off { background: rgba(245,158,11,.18); color: #fcd34d; }
        html.dark .err-btn { border-color: #475569; color: #f1f5f9; }
        html.dark .err-btn.sm { color: #fda4af; border-color: rgba(244,63,94,.5); }
        html.dark .err-btn.primary { background: #e11d48; color: #fff; }
        html.dark .err-btn.danger { color: #fda4af; border-color: #f43f5e; }
        html.dark .err-empty { color: #34d399; }`;

    function start() {
        if (!document.getElementById('err-style')) {
            const s = document.createElement('style');
            s.id = 'err-style';
            s.textContent = CSS;
            document.head.appendChild(s);
        }
        watchModals();
        let tries = 0;
        const tick = () => {
            if (core() && core().ready && core().ready() && core().state().hospitalId) { install(); syncBoards({ quiet: true }); return; }
            if (++tries < 120) setTimeout(tick, 1000);
        };
        tick();
    }
    window.EmergencyResidents = { openImport, openSelection, syncBoards };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
