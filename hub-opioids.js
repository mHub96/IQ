/**
 * The opioids responsibility ("ذمة المخدرات"), worker/src/opioids.js.
 *  - manager(host):  the owner's / hospital admins' tab in the account panel (create, edit, confirm and
 *                    notify, replenish / withdraw, delete; every duty's live stock and records).
 *  - mine(host):     the holder's tab: live counters, alerts, a small dashboard and their own records.
 *  - homeButton(btn, hosp): the duty roster's button (the hospital's rotators, the holder, the owner)
 *                    that opens the form to record an ampoule used on a patient.
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    const A = window.HubAccounts;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, k) => (A && A.toast ? A.toast(m, k) : alert(m));
    const fmt = n => Number(n || 0).toLocaleString('en-US');
    const ERR = {
        place_required: 'اكتب اسم المكان.', wards_required: 'أضف ردهة واحدة على الأقل.', holder_required: 'اختر المقيم المسؤول.',
        holder_not_resident: 'المقيم غير موجود في قاعدة بيانات المستشفى (أو أنه روتيتر).', items_required: 'أضف مادة مخدرة واحدة على الأقل.',
        qty_required: 'اكتب عدد الأمبولات لكل مادة.', item_not_empty: 'لا يمكن حذف مادة بقي منها شيء: اسحب المتبقي أولاً.',
        not_enough: 'العدد المطلوب أكثر من المتبقي.', patient_required: 'اكتب اسم المريض.', sex_required: 'اختر الجنس.',
        age_required: 'اكتب عمراً صحيحاً.', ward_required: 'اختر الردهة.', bad_date: 'التاريخ غير صحيح (لا يكون في المستقبل).',
        reason_required: 'اكتب سبب الإلغاء.', forbidden: 'لا تملك صلاحية لهذا.', rate_limited: 'محاولات كثيرة، انتظر قليلاً.',
    };
    const errText = e => { const c = e && e.data && e.data.error; return (c === 'item_not_empty' && e.data.item ? `«${e.data.item}»: ` : '') + (ERR[c] || (A && A.errorText ? A.errorText(e) : 'تعذر الإتمام')); };
    const api = (method, path, body) => Hub.api(method, path, body, { retries: method === 'GET' ? 1 : 0 });
    const today = () => (Hub.getMedicalDate ? Hub.getMedicalDate() : '').split('/').reverse().join('-') || new Date().toISOString().slice(0, 10);
    const dateText = iso => iso ? iso.split('-').reverse().join('/') : '';
    const timeText = ms => ms ? new Date(ms).toLocaleString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' }) : '';
    const hospName = id => { const h = Hub.getHospital && Hub.getHospital(id); return h ? (h.name_ar || h.hospitalName || id) : id; };
    const level = (left, low) => left <= 0 ? 'out' : left <= low ? 'low' : 'ok';
    const SEX = { m: 'ذكر', f: 'أنثى' };
    const KIND = { issue: ['📦', 'استلام / تعويض'], use: ['💉', 'استخدام'], withdraw: ['↩️', 'سحب'], handover: ['🤝', 'استلام من المسؤول السابق'] };

    const CSS = `
    .opi { --opi1: #7c3aed; --opi2: #db2777; }
    .opi-top { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; }
    .opi-top select { min-height: 38px; border-radius: 10px; padding: 0 10px; border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; font: 700 .8rem inherit; font-family: inherit; }
    .opi-new { border: 0; border-radius: 12px; padding: 9px 14px; background: linear-gradient(135deg, var(--opi1), var(--opi2)); color: #fff; font: 800 .8rem inherit; font-family: inherit; cursor: pointer; box-shadow: 0 6px 16px rgba(124,58,237,.3); }
    .opi-card { border-radius: 18px; padding: 14px; margin-bottom: 12px; border: 1px solid rgba(142,142,147,.22); background: rgba(142,142,147,.05); position: relative; overflow: hidden; }
    .opi-card::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg, var(--opi1), var(--opi2)); }
    .opi-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    .opi-head h3 { margin: 0; font-size: 1rem; font-weight: 900; }
    .opi-sub { font-size: .72rem; font-weight: 700; opacity: .7; margin-top: 2px; }
    .opi-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: .66rem; font-weight: 900; white-space: nowrap; }
    .opi-chip.draft { background: rgba(142,142,147,.18); }
    .opi-chip.pending { background: #fef3c7; color: #92400e; }
    .opi-chip.active { background: #dcfce7; color: #166534; }
    .opi-wards { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
    .opi-wards span { padding: 3px 9px; border-radius: 999px; font-size: .68rem; font-weight: 800; background: rgba(124,58,237,.1); color: var(--opi1); }
    body.dark .opi-wards span { color: #c4b5fd; }
    .opi-holder { display: flex; align-items: center; gap: 8px; font-size: .78rem; font-weight: 800; margin: 6px 0 10px; flex-wrap: wrap; }
    .opi-holder .next { color: #b45309; }
    .opi-items { display: grid; gap: 8px; }
    .opi-item { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; padding: 9px 11px; border-radius: 14px; background: rgba(142,142,147,.08); }
    .opi-item b { font-size: .82rem; font-weight: 900; }
    .opi-num { font-size: 1.05rem; font-weight: 900; font-variant-numeric: tabular-nums; }
    .opi-item.low .opi-num { color: #d97706; } .opi-item.out .opi-num { color: #dc2626; } .opi-item.ok .opi-num { color: #16a34a; }
    .opi-bar { grid-column: 1 / -1; height: 6px; border-radius: 99px; background: rgba(142,142,147,.2); overflow: hidden; }
    .opi-bar i { display: block; height: 100%; border-radius: 99px; background: #22c55e; transition: width .5s; }
    .opi-item.low .opi-bar i { background: #f59e0b; } .opi-item.out .opi-bar i { background: #ef4444; }
    .opi-item-acts { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
    .opi-btn { border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; border-radius: 10px; padding: 6px 10px; font: 800 .72rem inherit; font-family: inherit; cursor: pointer; }
    .opi-btn.primary { border: 0; color: #fff; background: linear-gradient(135deg, var(--opi1), var(--opi2)); }
    .opi-btn.warn { border-color: #f59e0b; color: #b45309; }
    .opi-btn.danger { border-color: rgba(220,38,38,.4); color: #dc2626; }
    .opi-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
    .opi-confirm { width: 100%; margin-top: 10px; padding: 11px; border-radius: 14px; border: 0; font: 900 .85rem inherit; font-family: inherit; color: #fff; cursor: pointer;
        background: linear-gradient(135deg, #f59e0b, #ea580c); box-shadow: 0 6px 16px rgba(234,88,12,.3); animation: opiPulse 2.4s ease-in-out infinite; }
    @keyframes opiPulse { 50% { box-shadow: 0 6px 22px rgba(234,88,12,.55); } }
    .opi-form { display: grid; gap: 10px; }
    .opi-form label { display: grid; gap: 4px; font-size: .74rem; font-weight: 800; }
    .opi-form input, .opi-form select { min-height: 40px; border-radius: 10px; padding: 0 10px; border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; font: 700 .82rem inherit; font-family: inherit; width: 100%; box-sizing: border-box; }
    .opi-row { display: flex; gap: 6px; align-items: center; }
    .opi-row > * { min-width: 0; }
    .opi-tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .opi-tags span { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px 4px 10px; border-radius: 999px; background: rgba(124,58,237,.12); font-size: .72rem; font-weight: 800; }
    .opi-tags button { border: 0; background: rgba(0,0,0,.12); color: inherit; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: .6rem; line-height: 1; }
    .opi-sugg { position: relative; }
    .opi-sugg-list { position: absolute; inset: 100% 0 auto 0; z-index: 20; margin-top: 4px; border-radius: 12px; overflow: hidden; background: #fff; color: #111827; box-shadow: 0 12px 30px rgba(0,0,0,.2); max-height: 240px; overflow-y: auto; }
    body.dark .opi-sugg-list { background: #1c1c1e; color: #f2f2f7; }
    .opi-sugg-list button { display: block; width: 100%; text-align: start; padding: 9px 12px; border: 0; background: transparent; color: inherit; font: 700 .8rem inherit; font-family: inherit; cursor: pointer; }
    .opi-sugg-list button:hover, .opi-sugg-list button.on { background: rgba(124,58,237,.12); }
    .opi-it-row { display: grid; grid-template-columns: 1fr 70px 64px 30px; gap: 6px; align-items: end; }
    .opi-it-row small { font-size: .62rem; opacity: .7; }
    .opi-x { border: 0; border-radius: 9px; height: 40px; background: rgba(220,38,38,.1); color: #dc2626; cursor: pointer; }
    .opi-log { margin-top: 10px; overflow-x: auto; border-radius: 12px; border: 1px solid rgba(142,142,147,.2); }
    .opi-log table { width: 100%; border-collapse: collapse; font-size: .7rem; min-width: 520px; }
    .opi-log th { background: rgba(142,142,147,.12); font-weight: 900; padding: 7px 6px; text-align: start; white-space: nowrap; }
    .opi-log td { padding: 7px 6px; border-top: 1px solid rgba(142,142,147,.15); font-weight: 700; vertical-align: top; }
    .opi-log tr.void td { text-decoration: line-through; opacity: .5; }
    .opi-log .k-issue { color: #16a34a; } .opi-log .k-withdraw { color: #b45309; } .opi-log .k-handover { color: #2563eb; }
    .opi-empty { text-align: center; padding: 26px 10px; font-weight: 800; opacity: .7; font-size: .82rem; }
    .opi-mine-head { border-radius: 20px; padding: 16px; color: #fff; background: linear-gradient(135deg, #5b21b6, #9d174d); margin-bottom: 12px; box-shadow: 0 10px 26px rgba(91,33,182,.3); }
    .opi-mine-head h3 { margin: 0 0 2px; font-size: 1.05rem; font-weight: 900; }
    .opi-mine-head .opi-wards span { background: rgba(255,255,255,.18); color: #fff; }
    .opi-counters { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .opi-counter { border-radius: 16px; padding: 12px; text-align: center; border: 1.5px solid; }
    .opi-counter.ok { border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.08); }
    .opi-counter.low { border-color: rgba(245,158,11,.6); background: rgba(245,158,11,.12); }
    .opi-counter.out { border-color: rgba(239,68,68,.6); background: rgba(239,68,68,.12); animation: opiOut 1.8s ease-in-out infinite; }
    @keyframes opiOut { 50% { background: rgba(239,68,68,.22); } }
    .opi-counter b { display: block; font-size: 1.9rem; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .opi-counter.ok b { color: #16a34a; } .opi-counter.low b { color: #d97706; } .opi-counter.out b { color: #dc2626; }
    .opi-counter span { font-size: .74rem; font-weight: 900; }
    .opi-counter small { display: block; font-size: .62rem; font-weight: 800; opacity: .75; margin-top: 3px; }
    .opi-alert { border-radius: 14px; padding: 10px 12px; margin-bottom: 8px; font-size: .78rem; font-weight: 800; display: flex; gap: 8px; align-items: center; }
    .opi-alert.low { background: #fef3c7; color: #92400e; } .opi-alert.out { background: #fee2e2; color: #991b1b; }
    .opi-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .opi-stat { border-radius: 14px; padding: 10px; text-align: center; background: rgba(142,142,147,.08); }
    .opi-stat b { display: block; font-size: 1.2rem; font-weight: 900; }
    .opi-stat small { font-size: .64rem; font-weight: 800; opacity: .7; }
    .opi-wardbars { display: grid; gap: 6px; margin-bottom: 12px; }
    .opi-wardbar { display: grid; grid-template-columns: 90px 1fr 28px; gap: 8px; align-items: center; font-size: .7rem; font-weight: 800; }
    .opi-wardbar div { height: 8px; border-radius: 99px; background: rgba(142,142,147,.18); overflow: hidden; }
    .opi-wardbar i { display: block; height: 100%; background: linear-gradient(90deg, var(--opi1), var(--opi2)); border-radius: 99px; }
    .opi-h4 { margin: 14px 0 8px; font-size: .84rem; font-weight: 900; }
    .opi-seg { display: inline-grid; grid-auto-flow: column; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(142,142,147,.14); }
    .opi-seg button { border: 0; padding: 7px 14px; border-radius: 9px; background: transparent; color: inherit; font: 800 .78rem inherit; font-family: inherit; cursor: pointer; }
    .opi-seg button.on { background: #fff; color: #111827; box-shadow: 0 2px 6px rgba(0,0,0,.12); }
    .nav-btn.nav-opi { background: linear-gradient(135deg, #7c3aed, #db2777) !important; color: #fff !important; border: 0 !important; box-shadow: 0 4px 14px rgba(124,58,237,.35) !important; }
    .nav-btn.nav-opi .opi-dot { width: 8px; height: 8px; border-radius: 50%; background: #fde047; box-shadow: 0 0 0 2px rgba(255,255,255,.5); }
    `;
    if (!document.getElementById('hub-opi-css')) {
        const st = document.createElement('style');
        st.id = 'hub-opi-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------
    // Shared pieces
    // ------------------------------------------------------------------
    function itemsHtml(items, acts) {
        if (!items.length) return '<div class="opi-sub">لا توجد مواد.</div>';
        const top = Math.max(...items.map(i => i.left), 1);
        return `<div class="opi-items">${items.map(i => `<div class="opi-item ${level(i.left, i.low)}" data-item="${i.id}">
                <b>💊 ${esc(i.name)}</b><span class="opi-num">${fmt(i.left)}</span>
                <div class="opi-bar"><i style="width:${Math.round(Math.min(1, i.left / top) * 100)}%"></i></div>
                ${acts ? `<div class="opi-item-acts"><button type="button" class="opi-btn" data-stock="issue">＋ تعويض</button><button type="button" class="opi-btn warn" data-stock="withdraw">－ سحب</button></div>` : ''}
            </div>`).join('')}</div>`;
    }
    function logTable(moves, { showHolder = false, canVoid = null } = {}) {
        if (!moves.length) return '<div class="opi-empty">لا توجد سجلات بعد.</div>';
        return `<div class="opi-log"><table><thead><tr><th>النوع</th><th>المادة</th><th>العدد</th><th>المريض</th><th>الجنس</th><th>العمر</th><th>الردهة</th><th>التاريخ</th><th>سجّله</th>${showHolder ? '<th>المسؤول</th>' : ''}${canVoid ? '<th></th>' : ''}</tr></thead><tbody>
            ${moves.map(m => `<tr class="${m.voided ? 'void' : ''}" title="${m.voided ? 'أُلغي: ' + esc(m.voidReason) : ''}">
                <td class="k-${m.kind}">${KIND[m.kind][0]} ${KIND[m.kind][1]}${m.note && m.kind !== 'use' ? `<br><small>${esc(m.note)}</small>` : ''}</td>
                <td>${esc(m.itemName)}</td><td>${m.kind === 'use' || m.kind === 'withdraw' ? '−' : '+'}${fmt(m.qty)}</td>
                <td>${esc(m.patient)}</td><td>${SEX[m.sex] || ''}</td><td>${m.age != null && m.kind === 'use' ? m.age : ''}</td><td>${esc(m.ward)}</td>
                <td>${m.date ? dateText(m.date) : timeText(m.at)}</td><td>${esc(m.by)}</td>
                ${showHolder ? `<td>${esc(m.holder)}</td>` : ''}
                ${canVoid ? `<td>${m.kind === 'use' && !m.voided && canVoid(m) ? `<button type="button" class="opi-btn danger" data-void="${m.id}">إلغاء</button>` : ''}</td>` : ''}
            </tr>`).join('')}</tbody></table></div>`;
    }
    function bindVoid(host, after) {
        host.querySelectorAll('[data-void]').forEach(b => b.addEventListener('click', async () => {
            const reason = prompt('سبب إلغاء هذا السجل (يُعاد العدد إلى المتبقي):');
            if (!reason || !reason.trim()) return;
            try { await api('POST', '/api/opioids/void', { id: Number(b.dataset.void), reason: reason.trim() }); toast('أُلغي السجل وأُعيد العدد ✓', 'success'); after(); }
            catch (e) { toast(errText(e), 'error'); }
        }));
    }

    // ------------------------------------------------------------------
    // The owner / admins: every duty of their hospitals
    // ------------------------------------------------------------------
    async function manager(host) {
        host.innerHTML = '<div class="opi"><div class="opi-empty">جاري التحميل…</div></div>';
        let data;
        try { data = await api('GET', '/api/opioids'); }
        catch (e) { host.innerHTML = `<div class="opi-empty">${esc(errText(e))}</div>`; return; }
        const scope = data.scope.includes('*') ? (Hub.getHospitals ? Hub.getHospitals().map(h => h.id) : []) : data.scope;
        let hosp = host._opiHosp && (data.scope.includes('*') || scope.includes(host._opiHosp)) ? host._opiHosp : (scope[0] || '');
        const openLogs = host._opiLogs || (host._opiLogs = new Set());
        const paint = () => {
            host._opiHosp = hosp;
            const duties = data.duties.filter(d => !hosp || d.hosp === hosp);
            host.innerHTML = `<div class="opi">
                <div class="opi-top">
                    ${scope.length > 1 ? `<select data-role="hosp" aria-label="المستشفى">${scope.map(h => `<option value="${esc(h)}" ${h === hosp ? 'selected' : ''}>${esc(hospName(h))}</option>`).join('')}</select>` : `<b style="font-size:.85rem">${esc(hospName(hosp))}</b>`}
                    <button type="button" class="opi-new" data-act="new">＋ ذمة جديدة</button>
                </div>
                ${duties.length ? duties.map(d => card(d)).join('') : '<div class="opi-empty">💊<br>لا توجد ذمم مخدرات في هذا المستشفى بعد.<br>أنشئ أول ذمة: المكان، الردهات، المقيم المسؤول، والمواد.</div>'}
            </div>`;
            const sel = host.querySelector('[data-role="hosp"]');
            if (sel) sel.addEventListener('change', () => { hosp = sel.value; paint(); });
            host.querySelector('[data-act="new"]').addEventListener('click', () => editor(host, { hosp }, () => manager(host)));
            host.querySelectorAll('.opi-card').forEach(el => {
                const d = data.duties.find(x => x.id === Number(el.dataset.duty));
                el.querySelector('[data-act="edit"]').addEventListener('click', () => editor(host, d, () => manager(host)));
                el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
                    if (!confirm(`حذف ذمة «${d.place}»؟ تبقى سجلاتها محفوظة للإدارة والمالك.`)) return;
                    try { await api('POST', '/api/opioids/delete', { id: d.id }); toast('حُذفت الذمة', 'success'); manager(host); } catch (e) { toast(errText(e), 'error'); }
                });
                const conf = el.querySelector('[data-act="confirm"]');
                if (conf) conf.addEventListener('click', async () => {
                    conf.disabled = true;
                    try {
                        const r = await api('POST', '/api/opioids/confirm', { id: d.id });
                        toast(r.notified ? `تم التأكيد وإشعار ${d.next.name} ✓` : `تم التأكيد. ${d.next.name} لا يملك حساباً بعد، فلن يصله إشعار حتى ينشئ حسابه.`, r.notified ? 'success' : 'info');
                        manager(host);
                    } catch (e) { conf.disabled = false; toast(errText(e), 'error'); }
                });
                el.querySelector('[data-act="log"]').addEventListener('click', () => { if (openLogs.has(d.id)) openLogs.delete(d.id); else openLogs.add(d.id); paint(); });
                el.querySelectorAll('[data-stock]').forEach(b => b.addEventListener('click', async () => {
                    const itemId = Number(b.closest('[data-item]').dataset.item);
                    const it = d.items.find(i => i.id === itemId);
                    const withdraw = b.dataset.stock === 'withdraw';
                    const n = Number(prompt(`${withdraw ? 'سحب' : 'تعويض'} «${it.name}»: كم أمبولة؟ (المتبقي ${it.left})`, withdraw ? '' : '5'));
                    if (!n || n < 1) return;
                    const note = withdraw ? (prompt('سبب السحب (اختياري):') || '') : '';
                    try { const r = await api('POST', '/api/opioids/stock', { item: itemId, qty: n, kind: withdraw ? 'withdraw' : 'issue', note }); toast(`${withdraw ? 'سُحب' : 'أُضيف'} ✓ · المتبقي ${r.left}`, 'success'); manager(host); }
                    catch (e) { toast(errText(e), 'error'); }
                }));
                bindVoid(el, () => manager(host));
            });
        };
        const card = d => {
            const status = d.status === 'draft' ? ['draft', 'مسودة · لم تُؤكد'] : d.pending ? ['pending', 'بانتظار تأكيد المسؤول الجديد'] : ['active', 'فعّالة'];
            const moves = data.moves.filter(m => m.duty === d.id);
            return `<div class="opi-card" data-duty="${d.id}">
                <div class="opi-head"><div><h3>📍 ${esc(d.place)}</h3><div class="opi-sub">${data.owner || data.scope.length > 1 ? esc(hospName(d.hosp)) + ' · ' : ''}آخر تحديث ${esc(timeText(d.updated))}</div></div>
                    <span class="opi-chip ${status[0]}">${status[1]}</span></div>
                <div class="opi-wards">${d.wards.map(w => `<span>🛏️ ${esc(w)}</span>`).join('')}</div>
                <div class="opi-holder">👤 ${d.holder ? `المسؤول: ${esc(d.holder.name)} <span class="opi-sub">منذ ${esc(timeText(d.holder.since))}</span>` : 'لا يوجد مسؤول مؤكد بعد'}
                    ${d.pending && d.next && (!d.holder || d.holder.key !== d.next.key) ? `<span class="next">← ${esc(d.next.name)} (بانتظار التأكيد)</span>` : ''}</div>
                ${itemsHtml(d.items, d.status === 'active')}
                ${d.pending ? `<button type="button" class="opi-confirm" data-act="confirm">✅ تأكيد ${d.status === 'draft' ? 'الذمة' : 'التغيير'} وإشعار ${esc(d.next ? d.next.name : 'المقيم')}</button>` : ''}
                <div class="opi-acts">
                    <button type="button" class="opi-btn" data-act="edit">✏️ تعديل</button>
                    <button type="button" class="opi-btn" data-act="log">📋 السجل (${moves.length})</button>
                    <button type="button" class="opi-btn danger" data-act="delete">🗑️ حذف</button>
                </div>
                ${openLogs.has(d.id) ? logTable(moves, { showHolder: true, canVoid: () => true }) : ''}
            </div>`;
        };
        paint();
    }

    /** Create / edit form (inside the same tab; "رجوع" returns to the list). */
    function editor(host, duty, done) {
        const isNew = !duty.id;
        const st = {
            place: duty.place || '', wards: [...(duty.wards || [])],
            holder: duty.next ? { ...duty.next } : duty.holder ? { res: duty.holder.res, name: duty.holder.name, key: duty.holder.key } : null,
            items: (duty.items || []).map(i => ({ id: i.id, name: i.name, low: i.low, left: i.left })),
        };
        if (!st.items.length) st.items.push({ name: '', qty: '', low: 2 });
        const draft = isNew || duty.status === 'draft';
        const paint = () => {
            host.innerHTML = `<div class="opi"><div class="opi-top"><button type="button" class="opi-btn" data-act="back">→ رجوع</button><b>${isNew ? 'ذمة مخدرات جديدة' : 'تعديل الذمة'} · ${esc(hospName(duty.hosp))}</b></div>
                <div class="opi-form">
                    <label>المكان<input data-f="place" maxlength="60" placeholder="مثال: الطابق الرابع" value="${esc(st.place)}"></label>
                    <label>الردهات التي تغطيها
                        <div class="opi-row"><input data-f="ward" maxlength="40" placeholder="اسم الردهة ثم «إضافة»"><button type="button" class="opi-btn primary" data-act="add-ward">إضافة</button></div>
                        <div class="opi-tags">${st.wards.map((w, i) => `<span>${esc(w)} <button type="button" data-del-ward="${i}" aria-label="حذف">✕</button></span>`).join('')}</div>
                    </label>
                    <label>المقيم المسؤول
                        <div class="opi-sugg"><input data-f="holder" autocomplete="off" placeholder="اكتب الاسم واختر من القائمة" value="${esc(st.holder ? st.holder.name : '')}"><div class="opi-sugg-list" hidden></div></div>
                        <small class="opi-sub">${st.holder ? '✓ ' + esc(st.holder.name) : 'كل مقيمي المستشفى عدا الروتيترية.'}</small>
                    </label>
                    <div><div class="opi-h4" style="margin-top:0">المواد المخدرة</div>
                        ${st.items.map((it, i) => `<div class="opi-it-row" data-i="${i}" style="margin-bottom:6px">
                            <label>اسم المادة<input data-it="name" maxlength="60" placeholder="مثال: Pethidine 100mg" value="${esc(it.name)}"></label>
                            ${it.id && !draft ? `<label>المتبقي<input value="${fmt(it.left)}" disabled></label>` : `<label>الأمبولات<input data-it="qty" type="number" min="1" max="500" inputmode="numeric" value="${esc(it.qty || '')}"></label>`}
                            <label><small>تنبيه عند</small><input data-it="low" type="number" min="0" max="100" inputmode="numeric" value="${esc(it.low != null ? it.low : 2)}"></label>
                            <button type="button" class="opi-x" data-del-item="${i}" aria-label="حذف المادة">✕</button>
                        </div>`).join('')}
                        <button type="button" class="opi-btn" data-act="add-item">＋ مادة أخرى</button>
                        ${!draft ? '<div class="opi-sub" style="margin-top:6px">عدد المواد الحالية يتغير من «تعويض» و«سحب» في بطاقة الذمة.</div>' : ''}
                    </div>
                    <button type="button" class="opi-new" data-act="save">${isNew ? 'إنشاء الذمة' : 'حفظ التعديلات'}</button>
                    <div class="opi-sub">${isNew ? 'بعد الإنشاء اضغط «تأكيد وإشعار» ليصل الإشعار إلى المقيم وتظهر الذمة في حسابه.' : 'تغيير المقيم المسؤول يحتاج «تأكيد التغيير» ليستلم المسؤول الجديد ما تبقى.'}</div>
                </div></div>`;
            const $ = s => host.querySelector(s);
            $('[data-act="back"]').addEventListener('click', done);
            $('[data-f="place"]').addEventListener('input', e => { st.place = e.target.value; });
            const addWard = () => { const v = $('[data-f="ward"]').value.trim(); if (v && !st.wards.includes(v)) st.wards.push(v); paint(); host.querySelector('[data-f="ward"]').focus(); };
            $('[data-act="add-ward"]').addEventListener('click', addWard);
            $('[data-f="ward"]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addWard(); } });
            host.querySelectorAll('[data-del-ward]').forEach(b => b.addEventListener('click', () => { st.wards.splice(Number(b.dataset.delWard), 1); paint(); }));
            host.querySelectorAll('.opi-it-row').forEach(row => {
                const it = st.items[Number(row.dataset.i)];
                row.querySelectorAll('[data-it]').forEach(inp => inp.addEventListener('input', () => { it[inp.dataset.it] = inp.value; }));
            });
            host.querySelectorAll('[data-del-item]').forEach(b => b.addEventListener('click', () => { st.items.splice(Number(b.dataset.delItem), 1); if (!st.items.length) st.items.push({ name: '', qty: '', low: 2 }); paint(); }));
            $('[data-act="add-item"]').addEventListener('click', () => { st.items.push({ name: '', qty: '', low: 2 }); paint(); });
            // The holder: suggestions as the admin types (the hospital's residents, not rotators).
            const inp = $('[data-f="holder"]'), list = $('.opi-sugg-list');
            let timer = null, found = [], idx = -1;
            const show = () => {
                list.hidden = !found.length;
                list.innerHTML = found.map((r, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-r="${i}">${esc(r.name)}</button>`).join('');
                list.querySelectorAll('[data-r]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); choose(found[Number(b.dataset.r)]); }));
            };
            const choose = r => { st.holder = r; inp.value = r.name; list.hidden = true; host.querySelector('.opi-sugg + small').textContent = '✓ ' + r.name; };
            inp.addEventListener('input', () => {
                st.holder = null;
                host.querySelector('.opi-sugg + small').textContent = 'اختر الاسم من القائمة.';
                clearTimeout(timer);
                const q = inp.value.trim();
                timer = setTimeout(async () => {
                    try { found = (await api('GET', `/api/opioids/residents?h=${encodeURIComponent(duty.hosp)}&q=${encodeURIComponent(q)}`)).residents || []; idx = -1; show(); } catch (e) { /* offline */ }
                }, 200);
            });
            inp.addEventListener('focus', () => inp.dispatchEvent(new Event('input')));
            inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
            inp.addEventListener('keydown', e => {
                if (list.hidden) return;
                if (e.key === 'ArrowDown') { idx = Math.min(found.length - 1, idx + 1); show(); e.preventDefault(); }
                else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); show(); e.preventDefault(); }
                else if (e.key === 'Enter' && found[Math.max(0, idx)]) { e.preventDefault(); choose(found[Math.max(0, idx)]); }
            });
            $('[data-act="save"]').addEventListener('click', async e => {
                const btn = e.currentTarget;
                if (!st.holder) { toast('اختر المقيم المسؤول من القائمة.', 'error'); inp.focus(); return; }
                btn.disabled = true;
                try {
                    await api('POST', '/api/opioids/duty', {
                        id: duty.id || undefined, hosp: duty.hosp, place: st.place, wards: st.wards, holder: { res: st.holder.res, name: st.holder.name },
                        items: st.items.filter(i => String(i.name || '').trim()).map(i => ({ id: i.id, name: i.name, qty: Number(i.qty) || 0, low: Number(i.low) })),
                    });
                    toast(isNew ? 'أُنشئت الذمة. اضغط «تأكيد وإشعار» لإسنادها.' : 'حُفظت التعديلات ✓', 'success');
                    done();
                } catch (err) { btn.disabled = false; toast(errText(err), 'error'); }
            });
        };
        paint();
        host.scrollIntoView && host.closest('[data-role="body"]') && (host.closest('[data-role="body"]').scrollTop = 0);
    }

    // ------------------------------------------------------------------
    // The holder: their tab
    // ------------------------------------------------------------------
    async function mine(host) {
        host.innerHTML = '<div class="opi"><div class="opi-empty">جاري التحميل…</div></div>';
        let data;
        try { data = await api('GET', '/api/opioids/mine'); }
        catch (e) { host.innerHTML = `<div class="opi-empty">${esc(errText(e))}</div>`; return; }
        if (!data.duties.length) { host.innerHTML = '<div class="opi"><div class="opi-empty">💊<br>لا توجد ذمة مخدرات باسمك.</div></div>'; return; }
        const holding = data.duties.filter(d => d.holding);
        const past = data.duties.filter(d => !d.holding);
        let sel = host._opiSel && data.duties.some(d => d.id === host._opiSel) ? host._opiSel : (holding[0] || data.duties[0]).id;
        const paint = () => {
            host._opiSel = sel;
            const d = data.duties.find(x => x.id === sel);
            const myTenures = new Set(d.tenures.map(t => t.id));
            const moves = data.moves.filter(m => m.duty === d.id && myTenures.has(m.tenure));
            const uses = moves.filter(m => m.kind === 'use' && !m.voided);
            const month = (data.today || today()).slice(0, 7);
            const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
            const byWard = {};
            uses.forEach(m => { byWard[m.ward] = (byWard[m.ward] || 0) + m.qty; });
            const topWard = Math.max(1, ...Object.values(byWard));
            const alerts = d.items.filter(i => level(i.left, i.low) !== 'ok');
            host.innerHTML = `<div class="opi">
                ${data.duties.length > 1 ? `<div class="opi-top"><div class="opi-seg">${data.duties.map(x => `<button type="button" data-sel="${x.id}" class="${x.id === sel ? 'on' : ''}">${esc(x.place)}${x.holding ? '' : ' (سابقة)'}</button>`).join('')}</div></div>` : ''}
                <div class="opi-mine-head"><h3>💊 ذمة المخدرات · ${esc(d.place)}</h3>
                    <div class="opi-sub" style="opacity:.85">${esc(hospName(d.hosp))}${d.holding ? ' · أنت المسؤول الآن' : ' · ذمة سابقة (سجلاتك فقط)'}</div>
                    <div class="opi-wards">${d.wards.map(w => `<span>🛏️ ${esc(w)}</span>`).join('')}</div></div>
                ${d.holding ? `
                    ${alerts.map(i => `<div class="opi-alert ${level(i.left, i.low)}">${i.left <= 0 ? '⛔' : '⚠️'} ${esc(i.name)}: ${i.left <= 0 ? 'نفد تماماً، اطلب التعويض من الإدارة.' : `بقي ${fmt(i.left)} فقط.`}</div>`).join('')}
                    <div class="opi-counters">${d.items.map(i => `<div class="opi-counter ${level(i.left, i.low)}"><span>💊 ${esc(i.name)}</span><b>${fmt(i.left)}</b><small>أمبولة متبقية${i.low ? ` · التنبيه عند ${i.low}` : ''}</small></div>`).join('')}</div>
                    <button type="button" class="opi-new" data-act="log" style="width:100%;margin-bottom:12px">💉 تسجيل استخدام أمبولة</button>` : ''}
                <div class="opi-stats">
                    <div class="opi-stat"><b>${fmt(uses.filter(m => m.date >= weekAgo).reduce((n, m) => n + m.qty, 0))}</b><small>آخر 7 أيام</small></div>
                    <div class="opi-stat"><b>${fmt(uses.filter(m => (m.date || '').startsWith(month)).reduce((n, m) => n + m.qty, 0))}</b><small>هذا الشهر</small></div>
                    <div class="opi-stat"><b>${fmt(uses.reduce((n, m) => n + m.qty, 0))}</b><small>كل استخداماتك</small></div>
                </div>
                ${Object.keys(byWard).length ? `<div class="opi-h4">حسب الردهة</div><div class="opi-wardbars">${Object.entries(byWard).sort((a, b) => b[1] - a[1]).map(([w, n]) => `<div class="opi-wardbar"><span>${esc(w)}</span><div><i style="width:${Math.round(n / topWard * 100)}%"></i></div><b>${n}</b></div>`).join('')}</div>` : ''}
                <div class="opi-h4">سجل الاستخدام (${fmt(moves.length)})</div>
                ${logTable(moves, { canVoid: () => d.holding })}
                ${past.length && d.holding ? `<div class="opi-sub" style="margin-top:10px">لك ذمم سابقة: اخترها من الأعلى لعرض سجلاتك فيها.</div>` : ''}
            </div>`;
            host.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => { sel = Number(b.dataset.sel); paint(); }));
            const logBtn = host.querySelector('[data-act="log"]');
            if (logBtn) logBtn.addEventListener('click', () => useForm([{ id: d.id, place: d.place, wards: d.wards, items: d.items }], () => mine(host)));
            bindVoid(host, () => mine(host));
        };
        paint();
    }

    // ------------------------------------------------------------------
    // Recording a use (a pop-up: the duty roster's button, or the holder's tab)
    // ------------------------------------------------------------------
    function useForm(duties, after) {
        if (!duties.length) return;
        const sheet = A.openSheet(`<header class="hacc-sheet-head"><div><h2>💉 تسجيل استخدام مادة مخدرة</h2><div class="hacc-muted">يُسجَّل باسمك تلقائياً: ${esc((Hub.auth.getAccount() || {}).name || '')}</div></div>
                <button type="button" class="hacc-icon-btn" data-act="close" aria-label="إغلاق">✕</button></header>
            <div class="hacc-sheet-body opi"><div class="opi-form" data-role="form"></div></div>`, { label: 'تسجيل استخدام مادة مخدرة', tall: true });
        sheet.querySelector('[data-act="close"]').addEventListener('click', A.closeSheet);
        const form = sheet.querySelector('[data-role="form"]');
        const st = { duty: duties[0].id, item: null, qty: 1, patient: '', sex: '', age: '', ward: '', date: today() };
        const paint = () => {
            const d = duties.find(x => x.id === st.duty);
            if (!d.items.some(i => i.id === st.item)) st.item = (d.items.find(i => i.left > 0) || d.items[0] || {}).id || null;
            if (!d.wards.includes(st.ward)) st.ward = d.wards.length === 1 ? d.wards[0] : '';
            const it = d.items.find(i => i.id === st.item);
            form.innerHTML = `
                ${duties.length > 1 ? `<label>الذمة (المكان)<select data-f="duty">${duties.map(x => `<option value="${x.id}" ${x.id === st.duty ? 'selected' : ''}>${esc(x.place)}${x.holder ? ' · ' + esc(x.holder) : ''}</option>`).join('')}</select></label>` : `<div class="opi-sub">📍 ${esc(d.place)}${d.holder ? ' · المسؤول: ' + esc(d.holder) : ''}</div>`}
                <label>المادة<select data-f="item">${d.items.map(i => `<option value="${i.id}" ${i.id === st.item ? 'selected' : ''} ${i.left <= 0 ? 'disabled' : ''}>${esc(i.name)} · المتبقي ${fmt(i.left)}</option>`).join('')}</select></label>
                <div class="opi-row"><label style="flex:1">اسم المريض<input data-f="patient" maxlength="80" value="${esc(st.patient)}" autocomplete="off"></label>
                    <label style="width:90px">العدد<input data-f="qty" type="number" min="1" max="${Math.min(10, it ? it.left : 1)}" inputmode="numeric" value="${st.qty}"></label></div>
                <div class="opi-row">
                    <label style="flex:1">الجنس<div class="opi-seg" style="display:grid;grid-template-columns:1fr 1fr"><button type="button" data-sex="m" class="${st.sex === 'm' ? 'on' : ''}">ذكر</button><button type="button" data-sex="f" class="${st.sex === 'f' ? 'on' : ''}">أنثى</button></div></label>
                    <label style="width:90px">العمر<input data-f="age" type="number" min="0" max="120" inputmode="numeric" value="${esc(st.age)}"></label>
                </div>
                <label>الردهة<select data-f="ward"><option value="">اختر الردهة</option>${d.wards.map(w => `<option ${w === st.ward ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
                <label>تاريخ الاستخدام<input data-f="date" type="date" max="${today()}" value="${esc(st.date)}"></label>
                <button type="button" class="opi-new" data-act="submit" ${!it || it.left <= 0 ? 'disabled' : ''}>تسجيل الاستخدام</button>`;
            form.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
                const v = inp.value;
                st[inp.dataset.f] = inp.dataset.f === 'duty' || inp.dataset.f === 'item' ? Number(v) : v;
                if (inp.tagName === 'SELECT') paint();
            }));
            form.querySelectorAll('[data-sex]').forEach(b => b.addEventListener('click', () => { st.sex = b.dataset.sex; form.querySelectorAll('[data-sex]').forEach(x => x.classList.toggle('on', x === b)); }));
            form.querySelector('[data-act="submit"]').addEventListener('click', async e => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                    const r = await api('POST', '/api/opioids/use', { duty: st.duty, item: st.item, qty: Number(st.qty) || 1, patient: st.patient, sex: st.sex, age: st.age === '' ? null : Number(st.age), ward: st.ward, date: st.date });
                    const dd = duties.find(x => x.id === st.duty);
                    const ii = dd.items.find(i => i.id === st.item);
                    if (ii) ii.left = r.left;
                    toast(`سُجّل ✓ · المتبقي من ${ii ? ii.name : 'المادة'}: ${r.left}${r.low ? (r.left ? ' ⚠️ قارب على النفاد' : ' ⛔ نفد') : ''}`, r.low ? 'info' : 'success');
                    A.closeSheet();
                    if (after) after();
                } catch (err) { btn.disabled = false; toast(errText(err), 'error'); }
            });
        };
        paint();
    }

    // ------------------------------------------------------------------
    // The duty roster's button (next to Rotation Heroes)
    // ------------------------------------------------------------------
    const targetCache = new Map();
    async function homeButton(btn, hosp) {
        if (!btn) return;
        btn.hidden = true;
        if (!hosp || !Hub.auth.isLoggedIn() || (Hub.aa && Hub.aa.active)) return;
        let hit = targetCache.get(hosp);
        if (!hit || Date.now() - hit.t > 120000) {
            try { hit = { t: Date.now(), v: await api('GET', `/api/opioids/targets?h=${encodeURIComponent(hosp)}`) }; targetCache.set(hosp, hit); }
            catch (e) { return; }
        }
        const duties = hit.v.duties || [];
        if (!duties.length) return;
        btn.hidden = false;
        const out = duties.some(d => d.items.some(i => i.left <= 0));
        btn.innerHTML = `<i class="fas fa-syringe"></i><span>ذمة المخدرات</span>${out ? '<span class="opi-dot" title="مادة نفدت"></span>' : ''}`;
        btn.onclick = e => {
            e.preventDefault();
            useForm(duties, () => targetCache.delete(hosp));
        };
    }

    // ------------------------------------------------------------------
    // For the account panel: does this resident hold (or has held) a duty? (cached briefly)
    // ------------------------------------------------------------------
    let mineAt = 0, mineHas = false;
    async function holds(fresh) {
        if (!fresh && Date.now() - mineAt < 60000) return mineHas;
        try { const r = await api('GET', '/api/opioids/mine'); mineHas = (r.duties || []).length > 0; mineAt = Date.now(); } catch (e) { /* keep the last answer */ }
        return mineHas;
    }

    window.HubOpioids = { manager, mine, homeButton, useForm, holds };
})(window, document);
