/**
 * Head of residents ("رئيس الأطباء") and his deputies ("رديف رئيس الأطباء") of each hospital.
 *
 * Kept on the hospital record as `chiefs: { head: residentId | '', deputies: [residentId…] }`; names
 * and phones come from the hospital's residents (already loaded), so showing them reads nothing
 * from the server. The hospital's admins and the owner change them (admin page); everyone signed in
 * can contact them from the hospital's card on the hub page.
 */
(function (window, document) {
    'use strict';

    const MAX_DEPUTIES = 6;
    const TITLES = { head: 'رئيس الأطباء', deputy: 'رديف رئيس الأطباء' };

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, t) => (window.HubAccounts && HubAccounts.toast ? HubAccounts.toast(m, t) : alert(m));

    function chiefsOf(h) {
        const c = h && h.chiefs && typeof h.chiefs === 'object' ? h.chiefs : {};
        return {
            head: typeof c.head === 'string' ? c.head : '',
            deputies: Array.isArray(c.deputies) ? c.deputies.filter(x => typeof x === 'string' && x) : [],
        };
    }

    /** The hospital's residents by id (the hospital's copy of the residents list). */
    function residentsById(h) {
        const m = new Map();
        (h && h.names || []).forEach(r => { if (r && r.id) m.set(r.id, r); });
        return m;
    }

    /** [{ role, title, id, name, phone }] for the people currently named (removed residents are left out). */
    function people(h) {
        const c = chiefsOf(h), byId = residentsById(h), out = [];
        const add = (id, role) => {
            const r = byId.get(id);
            if (!r || r.active === false || out.some(p => p.id === id)) return;
            out.push({ role, title: TITLES[role], id, name: r.name || '', phone: r.phone && r.phone !== 'رقم غير متوفر' ? r.phone : '' });
        };
        if (c.head) add(c.head, 'head');
        c.deputies.forEach(id => add(id, 'deputy'));
        return out;
    }

    const has = h => people(h).length > 0;

    function digits(phone) {
        let d = String(phone || '').replace(/[٠-٩]/g, x => '٠١٢٣٤٥٦٧٨٩'.indexOf(x)).replace(/\D/g, '');
        if (d.startsWith('00')) d = d.slice(2);
        if (d.startsWith('0')) d = '964' + d.replace(/^0+/, '');
        return d.length >= 10 ? d : '';
    }

    injectCss();

    // ------------------------------------------------------------------
    // Contact sheet (hub page)
    // ------------------------------------------------------------------
    function openContact(hospId) {
        const h = window.Hub && Hub.getHospital(hospId);
        if (!h || !window.HubAccounts) return;
        const list = people(h);
        const rows = list.length ? list.map(p => {
            const d = digits(p.phone);
            return `<li class="hch-person ${p.role}">
                <div class="hch-badge"><i class="fas ${p.role === 'head' ? 'fa-user-tie' : 'fa-user-shield'}"></i></div>
                <div class="hch-who"><span class="hch-title">${esc(p.title)}</span><b>${esc(p.name)}</b>
                    <span class="hch-phone" dir="ltr">${esc(p.phone || 'رقم غير متوفر')}</span></div>
                <div class="hch-acts">
                    <a class="hch-act wa ${d ? '' : 'off'}" href="${d ? 'whatsapp://send?phone=' + d : '#'}" ${d ? '' : 'onclick="event.preventDefault()"'} aria-label="WhatsApp"><i class="fab fa-whatsapp"></i></a>
                    <a class="hch-act call ${d ? '' : 'off'}" href="${d ? 'tel:+' + d : '#'}" ${d ? '' : 'onclick="event.preventDefault()"'} aria-label="اتصال"><i class="fas fa-phone"></i></a>
                </div></li>`;
        }).join('') : '<li class="hacc-empty">لم يُحدَّد رئيس الأطباء لهذا المستشفى بعد.</li>';
        HubAccounts.openSheet(`<header class="hacc-sheet-head"><h2>رئاسة الأطباء · ${esc(h.name_ar || h.hospitalName || h.id)}</h2></header>
            <div class="hacc-sheet-body"><ul class="hch-list">${rows}</ul></div>`, { label: 'رئاسة الأطباء' });
    }

    /** The button on a hospital's card (empty when nobody is named). */
    function cardButton(h) {
        if (!has(h)) return '';
        return `<button type="button" class="hosp-chiefs-btn" onclick="event.stopPropagation(); HubChiefs.openContact('${esc(h.id)}')" title="التواصل مع رئيس الأطباء ورديفه" aria-label="رئيس الأطباء">
            <i class="fas fa-user-tie"></i><span>رئيس الأطباء</span></button>`;
    }

    // ------------------------------------------------------------------
    // Editor (admin page): the hospital's admins and the owner
    // ------------------------------------------------------------------
    function openEditor(hospId, onSaved) {
        const h = window.Hub && Hub.getHospital(hospId);
        if (!h || !window.HubAccounts) return;
        if (!Hub.auth.isAdmin(hospId)) { toast('هذه الصلاحية لمدراء المستشفى فقط.', 'error'); return; }
        const byId = residentsById(h);
        const pool = (h.names || []).filter(r => r && r.id && r.active !== false && r.spec !== 'RESERVE')
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
        const start = chiefsOf(h);
        let head = byId.has(start.head) ? start.head : '';
        let deputies = start.deputies.filter(id => byId.has(id) && id !== head);
        let query = '';
        const sheet = HubAccounts.openSheet(`<header class="hacc-sheet-head"><h2>رئيس الأطباء ورديفه</h2></header>
            <div class="hacc-sheet-body hch-edit">
                <p class="hacc-muted">يظهر زر «رئيس الأطباء» على بطاقة المستشفى في الصفحة الرئيسية ليتواصل معهم الجميع. الأسماء والأرقام من قائمة المقيمين.</p>
                <div data-role="current"></div>
                <label class="hch-search"><i class="fas fa-magnifying-glass"></i><input type="search" data-role="q" placeholder="ابحث عن مقيم بالاسم…" autocomplete="off"></label>
                <ul class="hch-pick" data-role="pick"></ul>
                <div class="hacc-row"><button type="button" class="hacc-btn primary" data-act="save"><i class="fas fa-check"></i> حفظ</button></div>
            </div>`, { label: 'رئيس الأطباء', tall: true });
        const cur = sheet.querySelector('[data-role="current"]'), pick = sheet.querySelector('[data-role="pick"]');
        const nameOf = id => (byId.get(id) || {}).name || '';
        const draw = () => {
            cur.innerHTML = `<div class="hch-slot"><span class="hch-title">${TITLES.head}</span>${head
                ? `<span class="hch-chip head">${esc(nameOf(head))}<button type="button" data-del="${esc(head)}" aria-label="إزالة">×</button></span>`
                : '<span class="hacc-muted">لم يُحدَّد</span>'}</div>
                <div class="hch-slot"><span class="hch-title">${TITLES.deputy} (${deputies.length}/${MAX_DEPUTIES})</span>${deputies.length
                ? deputies.map(id => `<span class="hch-chip">${esc(nameOf(id))}<button type="button" data-del="${esc(id)}" aria-label="إزالة">×</button></span>`).join('')
                : '<span class="hacc-muted">لا يوجد</span>'}</div>`;
            const q = query.trim().toLowerCase();
            const list = pool.filter(r => !q || String(r.name).toLowerCase().includes(q)).slice(0, 40);
            pick.innerHTML = list.length ? list.map(r => {
                const isHead = r.id === head, isDep = deputies.includes(r.id);
                return `<li><span class="hch-pname">${esc(r.name)}<small>${esc((window.Hub && Hub.getSpecialtyName ? Hub.getSpecialtyName(r.spec) : r.spec) || '')}</small></span>
                    <button type="button" class="hacc-btn sm ${isHead ? 'primary' : ''}" data-head="${esc(r.id)}" ${isHead ? 'disabled' : ''}>رئيس</button>
                    <button type="button" class="hacc-btn sm ${isDep ? 'primary' : ''}" data-dep="${esc(r.id)}" ${isDep || deputies.length >= MAX_DEPUTIES ? 'disabled' : ''}>رديف</button></li>`;
            }).join('') : '<li class="hacc-empty">لا توجد نتائج.</li>';
        };
        sheet.querySelector('[data-role="q"]').addEventListener('input', e => { query = e.target.value; draw(); });
        sheet.addEventListener('click', async e => {
            const t = e.target.closest('button');
            if (!t) return;
            if (t.dataset.del) { const id = t.dataset.del; if (head === id) head = ''; deputies = deputies.filter(x => x !== id); draw(); return; }
            if (t.dataset.head) { head = t.dataset.head; deputies = deputies.filter(x => x !== head); draw(); return; }
            if (t.dataset.dep) { if (!deputies.includes(t.dataset.dep) && deputies.length < MAX_DEPUTIES) deputies.push(t.dataset.dep); if (head === t.dataset.dep) head = ''; draw(); return; }
            if (t.dataset.act === 'save') {
                t.disabled = true;
                try {
                    await Hub.updateHospital(hospId, { chiefs: { head, deputies } });
                    toast('تم حفظ رئيس الأطباء ورديفه ✓', 'success');
                    HubAccounts.closeSheet();
                    if (typeof onSaved === 'function') onSaved();
                } catch (err) {
                    t.disabled = false;
                    toast((err && err.message) || 'تعذر الحفظ', 'error');
                }
            }
        });
        draw();
    }

    function injectCss() {
        if (document.getElementById('hub-chiefs-css')) return;
        const st = document.createElement('style');
        st.id = 'hub-chiefs-css';
        st.textContent = `
.hosp-chiefs-btn { min-height: 44px; padding: 0 12px; border-radius: 14px; display: inline-flex; align-items: center; gap: 6px; flex: none;
  border: 1px solid rgba(180, 83, 9, 0.32); background: rgba(245, 158, 11, 0.1); color: #b45309; font: 800 0.74rem/1.2 'IBM Plex Sans Arabic', system-ui, sans-serif; cursor: pointer; }
body.dark .hosp-chiefs-btn, html.dark .hosp-chiefs-btn { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); background: rgba(251, 191, 36, 0.1); }
.hosp-chiefs-btn:active { transform: scale(0.95); }
@media (max-width: 360px) { .hosp-chiefs-btn span { display: none; } .hosp-chiefs-btn { width: 44px; padding: 0; justify-content: center; } }
.hch-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.hch-person { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 16px; background: var(--hacc-surface); }
.hch-person.head { box-shadow: inset 0 0 0 1.5px rgba(217, 119, 6, 0.45); }
.hch-badge { width: 42px; height: 42px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(245, 158, 11, 0.16); color: #b45309; font-size: 1.05rem; }
.hch-person.deputy .hch-badge { background: var(--hacc-accent-soft); color: var(--hacc-accent); }
.hch-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.hch-who b { font-size: 0.92rem; overflow-wrap: anywhere; }
.hch-title { font-size: 0.7rem; font-weight: 800; color: var(--hacc-muted); }
.hch-phone { font-size: 0.76rem; color: var(--hacc-muted); text-align: right; }
.hch-acts { display: flex; gap: 8px; flex: none; }
.hch-act { width: 42px; height: 42px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 1.1rem; text-decoration: none; color: #fff; }
.hch-act.wa { background: #22c55e; } .hch-act.call { background: var(--hacc-accent); }
.hch-act.off { opacity: 0.35; }
.hch-edit .hch-slot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; margin: 8px 0; border-radius: 14px; background: var(--hacc-surface); }
.hch-edit .hch-slot .hch-title { flex: 0 0 100%; }
.hch-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 4px 4px 10px; border-radius: 999px; background: var(--hacc-accent-soft); color: var(--hacc-accent); font-size: 0.8rem; font-weight: 800; }
.hch-chip.head { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.hch-chip button { width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, 0.08); color: inherit; font-size: 0.9rem; line-height: 1; cursor: pointer; }
.hch-search { display: flex; align-items: center; gap: 8px; margin: 12px 0 6px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--hacc-border); background: var(--hacc-bg); color: var(--hacc-muted); }
.hch-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--hacc-text); font: 500 16px/1.4 inherit; font-family: inherit; padding: 10px 0; outline: none; }
.hch-pick { list-style: none; margin: 0; padding: 0; }
.hch-pick li { display: flex; align-items: center; gap: 6px; padding: 8px 2px; border-bottom: 1px solid var(--hacc-border); }
.hch-pname { flex: 1; min-width: 0; font-size: 0.84rem; font-weight: 700; display: flex; flex-direction: column; }
.hch-pname small { font-size: 0.68rem; color: var(--hacc-muted); font-weight: 600; }
`;
        document.head.appendChild(st);
    }

    window.HubChiefs = { people, has, cardButton, openContact, openEditor, TITLES };
})(window, document);
