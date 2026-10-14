/**
 * ER preferences portal (admin side of the ER page).
 *
 * - Control panel: open the portal for a hospital and a coming month until a deadline (residents of
 *   the hospital are notified), extend it, or close it early.
 * - Live summary of the residents' requests.
 * - Requests are copied into the ER residents database when this page shows the portal's month
 *   (and again right before an automatic distribution), so the preferences panel of each resident
 *   and the auto-scheduler already use them. Each copied request is stamped on the server, so it
 *   is copied once; a resident who edits again is copied again.
 */
(function (window, document) {
    'use strict';

    const MONTHS = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const SHIFT_AR = { morning: 'الصباحية', afternoon: 'بعد الصباحية', preNight: 'البرينايت', lateNight: 'الليلية' };
    const pad2 = n => String(n).padStart(2, '0');
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const monthTitle = ym => `${MONTHS[Number(ym.slice(5, 7))]} ${ym.slice(0, 4)}`;
    const when = ms => new Date(ms).toLocaleString('ar-IQ-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    const core = () => window.EmergencyCore;
    const Hub = () => window.Hub;
    const notify = (msg, type) => { try { core().showNotification(msg, type); } catch (e) {} };

    function period() {
        const st = core() && core().state();
        if (!st) return null;
        return { hosp: st.hospitalId, ym: `${st.year}-${pad2(st.month)}`, month: Number(st.month) };
    }
    const hospitalName = id => { const h = Hub() && Hub().getHospital && Hub().getHospital(id); return h ? (h.name_ar || h.hospitalName) : id; };
    function nextMonthYm() {
        const d = new Date();
        const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`;
    }
    function apiError(err) {
        const code = err && err.data && err.data.error;
        return ({ forbidden: 'لا تملك صلاحية إدارة هذا المستشفى.', bad_deadline: 'موعد الإغلاق غير صالح (من 10 دقائق إلى 45 يوماً من الآن).', unauthorized: 'انتهت الجلسة، سجّل الدخول مجدداً.' })[code]
            || (err && err.message) || 'تعذر الاتصال بالخادم';
    }

    // ------------------------------------------------------------------
    // Copying requests into the residents database
    // ------------------------------------------------------------------
    let last = null; // last GET /api/er-portal response for the hospital on screen
    let syncing = null;

    function applyPrefs(res, p, month, at) {
        res.prefShifts = [...(p.prefShifts || [])];
        res.prefDays = [...(p.prefDays || [])];
        res.noConsecutiveDays = p.noConsecutiveDays !== false;
        res.prefDaysMode = p.prefDaysMode === 'prefer' ? 'prefer' : 'exclude';
        res.specificDays = [...(p.specificDays || [])];
        res.excludedDates = res.prefDaysMode === 'exclude' ? res.specificDays.map(d => `${d}/${month}`) : [];
        res.intervalMode = p.intervalMode === 'strictly_within' ? 'strictly_within' : 'exclude';
        res.excludedIntervals = (p.excludedIntervals || []).map(iv => ({ start: iv.start, end: iv.end }));
        res.preferences = { prefDays: [...res.prefDays], prefShifts: [...res.prefShifts], noConsecutiveDays: res.noConsecutiveDays };
        res.portalPrefsAt = at;
    }

    /** Fetches the requests of the month on screen and copies the new ones. Returns the response. */
    function sync() {
        if (syncing) return syncing;
        syncing = (async () => {
            const per = period();
            if (!per || !Hub() || !Hub().api) return null;
            const res = await Hub().api('GET', `/api/er-portal?hosp=${encodeURIComponent(per.hosp)}&ym=${per.ym}`, undefined, { retries: 1 });
            last = { ...res, hosp: per.hosp };
            paintPill();
            const pending = (res.requests || []).filter(r => r.erId && (!r.appliedAt || r.appliedAt < r.at));
            if (!pending.length) return res;
            const st = core().state();
            const now = period();
            if (!now || now.hosp !== per.hosp || now.ym !== per.ym) return res; // the admin moved on meanwhile
            const done = [];
            pending.forEach(r => {
                const target = (st.residents || []).find(x => String(x.id) === String(r.erId));
                if (!target) return;
                applyPrefs(target, r.prefs || {}, per.month, r.at);
                done.push({ accountId: r.accountId, at: r.at });
            });
            if (!done.length) return res;
            core().saveState();
            try { core().pushDBHistory(`تطبيق رغبات البوابة (${done.length} مقيم)`); } catch (e) {}
            core().updateDBUndoRedoUI();
            if (!document.getElementById('residents-db-modal')?.classList.contains('hidden')) { try { core().refreshDBView(); } catch (e) {} }
            notify(`تمت إضافة رغبات ${done.length} مقيم من البوابة إلى قاعدة بيانات ${monthTitle(per.ym)}`, 'success');
            try {
                const ok = await Hub().api('POST', '/api/er-portal/applied', { hosp: per.hosp, ym: per.ym, items: done }, { retries: 1 });
                (res.requests || []).forEach(r => { if (done.some(d => d.accountId === r.accountId && d.at === r.at)) r.appliedAt = ok.at; });
            } catch (e) {}
            return res;
        })().catch(err => { console.warn('ER portal sync failed', err); return null; }).finally(() => { syncing = null; });
        return syncing;
    }

    function paintPill() {
        const open = last && (last.portals || []).find(p => p.open);
        const text = open ? `مفتوحة · ${monthTitle(open.ym)}` : '';
        document.querySelectorAll('.er-portal-pill').forEach(el => {
            if (el.classList.contains('hidden') === !!open) el.classList.toggle('hidden', !open);
            if (el.textContent !== text) el.textContent = text;
        });
    }

    window.addEventListener('er:period', () => sync());
    // The residents database toolbar is redrawn often: keep its "open" label current.
    new MutationObserver(() => { if (last && (last.portals || []).some(p => p.open) && document.querySelector('.er-portal-pill:empty')) paintPill(); })
        .observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

    // The automatic distribution always works with the latest requests.
    const origAuto = window.triggerScheduleAutoGenerate;
    if (typeof origAuto === 'function') {
        window.triggerScheduleAutoGenerate = async function (type) {
            try { await sync(); } catch (e) {}
            return origAuto.call(this, type);
        };
    }

    // ------------------------------------------------------------------
    // Modal frame (same look as the page's other pop-ups)
    // ------------------------------------------------------------------
    function modal(id, width) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm hidden flex items-center justify-center p-3 sm:p-4 no-print';
            el.style.zIndex = '99999';
            el.innerHTML = `<div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full ${width} max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"></div>`;
            el.addEventListener('click', e => { if (e.target === el) close(id); });
            document.body.appendChild(el);
        }
        return el;
    }
    function close(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
        if (id === 'er-portal-summary-modal') clearInterval(summaryTimer);
    }
    const head = (icon, title, sub, id) => `<div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0"><i class="fas ${icon}"></i></div>
                <div class="min-w-0"><h3 class="font-black text-sm text-slate-800 dark:text-slate-100">${title}</h3><p class="text-[11px] text-slate-500 truncate">${sub}</p></div>
            </div>
            <button type="button" data-close="${id}" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"><i class="fas fa-times text-sm"></i></button>
        </div>`;
    const bindClose = el => el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => close(b.dataset.close)));

    // ------------------------------------------------------------------
    // Control panel: open / extend / close
    // ------------------------------------------------------------------
    async function openControl() {
        const per = period();
        if (!per) return;
        const el = modal('er-portal-modal', 'max-w-lg');
        const card = el.firstElementChild;
        card.innerHTML = head('fa-door-open', 'بوابة رغبات خفارات الطوارئ', esc(hospitalName(per.hosp)), 'er-portal-modal') + '<div class="p-5 text-xs text-slate-500">جاري التحميل…</div>';
        bindClose(card);
        el.classList.remove('hidden');
        let res;
        try {
            res = await Hub().api('GET', `/api/er-portal?hosp=${encodeURIComponent(per.hosp)}`, undefined, { retries: 1 });
        } catch (err) {
            card.lastElementChild.textContent = apiError(err);
            return;
        }
        last = { ...res, hosp: per.hosp };
        paintPill();
        const open = (res.portals || []).find(p => p.open);
        const defYm = open ? open.ym : nextMonthYm();
        const defClose = new Date(Date.now() + 7 * 86400000);
        defClose.setHours(23, 59, 0, 0);
        const toLocalInput = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        const months = [];
        for (let k = 0; k <= 3; k++) { const d = new Date(); const n = new Date(d.getFullYear(), d.getMonth() + k, 1); months.push(`${n.getFullYear()}-${pad2(n.getMonth() + 1)}`); }
        if (!months.includes(defYm)) months.push(defYm);
        const maxClose = new Date(Date.now() + 44 * 86400000);
        const body = `<div class="p-5 space-y-4 text-xs overflow-y-auto flex-1">
            ${open ? `<div class="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
                    <div class="font-black text-sm flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span> البوابة مفتوحة لشهر ${esc(monthTitle(open.ym))}</div>
                    <div class="mt-1">تُغلق تلقائياً: <b>${esc(when(open.closesAt))}</b></div>
                    <div class="mt-1">${res.ym === open.ym ? `وصلت <b>${res.requests.length}</b> طلبات من أصل <b>${res.accounts}</b> حساب في المستشفى` : ''}</div>
                </div>` : `<div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 leading-relaxed">
                    عند التفعيل يصل إشعار لكل مقيم لديه حساب في <b>${esc(hospitalName(per.hosp))}</b>، فيفتح البوابة من تبويب <b>«جدولي»</b> في حسابه ويحدد رغباته للشهر المختار. تظهر الطلبات هنا مباشرة، وتُضاف إلى قاعدة بيانات ذلك الشهر عند فتحه في هذه الصفحة، ويعمل عليها التوزيع الآلي.
                </div>`}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block"><span class="block font-black text-slate-700 dark:text-slate-300 mb-1.5">شهر الجدول</span>
                    <select data-role="ym" ${open ? 'disabled' : ''} class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
                        ${months.map(m => `<option value="${m}" ${m === defYm ? 'selected' : ''}>${monthTitle(m)}</option>`).join('')}
                    </select></label>
                <label class="block"><span class="block font-black text-slate-700 dark:text-slate-300 mb-1.5">${open ? 'موعد الإغلاق الجديد' : 'تبقى مفتوحة حتى'}</span>
                    <input type="datetime-local" data-role="close" value="${toLocalInput(open ? new Date(open.closesAt) : defClose)}" min="${toLocalInput(new Date(Date.now() + 15 * 60000))}" max="${toLocalInput(maxClose)}" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100" dir="ltr"></label>
            </div>
            ${open ? `<label class="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" data-role="renotify" class="w-4 h-4 accent-indigo-600"> إشعار المقيمين بالموعد الجديد</label>` : ''}
            <div class="flex flex-wrap gap-2">
                <button type="button" data-act="open" class="flex-1 px-4 py-2.5 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition flex items-center justify-center gap-1.5"><i class="fas ${open ? 'fa-clock-rotate-left' : 'fa-paper-plane'}"></i> ${open ? 'حفظ الموعد الجديد' : 'تفعيل البوابة وإشعار المقيمين'}</button>
                ${open ? '<button type="button" data-act="close-now" class="px-4 py-2.5 rounded-xl text-xs font-black text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 transition flex items-center gap-1.5"><i class="fas fa-lock"></i> إغلاق الآن</button>' : ''}
                <button type="button" data-act="summary" class="px-4 py-2.5 rounded-xl text-xs font-black text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 transition flex items-center gap-1.5"><i class="fas fa-list-check"></i> ملخص الطلبات</button>
            </div>
            ${(res.portals || []).filter(p => !p.open).length ? `<div class="pt-3 border-t border-slate-100 dark:border-slate-800">
                <div class="font-black text-slate-700 dark:text-slate-300 mb-2">بوابات سابقة</div>
                <div class="space-y-1.5">${res.portals.filter(p => !p.open).map(p => `<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span class="font-bold text-slate-700 dark:text-slate-200">${esc(monthTitle(p.ym))}</span>
                    <span class="text-[11px] text-slate-500">أُغلقت ${esc(when(p.closedAt || p.closesAt))}</span></div>`).join('')}</div></div>` : ''}
        </div>`;
        card.innerHTML = head('fa-door-open', 'بوابة رغبات خفارات الطوارئ', esc(hospitalName(per.hosp)), 'er-portal-modal') + body;
        bindClose(card);
        card.querySelector('[data-act="summary"]').addEventListener('click', () => { close('er-portal-modal'); openSummary(open ? open.ym : undefined); });
        card.querySelector('[data-act="open"]').addEventListener('click', async e => {
            const btn = e.currentTarget;
            const ym = card.querySelector('[data-role="ym"]').value;
            const closesAt = new Date(card.querySelector('[data-role="close"]').value).getTime();
            if (!closesAt || closesAt < Date.now() + 10 * 60000) { notify('اختر موعد إغلاق بعد 10 دقائق على الأقل من الآن', 'error'); return; }
            const renotify = card.querySelector('[data-role="renotify"]');
            if (!open && !confirm(`تفعيل بوابة رغبات شهر ${monthTitle(ym)} حتى ${when(closesAt)}؟\nسيصل إشعار لكل مقيم لديه حساب في ${hospitalName(per.hosp)}.`)) return;
            btn.disabled = true;
            try {
                const r = await Hub().api('POST', '/api/er-portal/open', { hosp: per.hosp, ym, closesAt, notify: !!(renotify && renotify.checked) }, { retries: 0 });
                notify(open ? `تم تحديث موعد الإغلاق${r.notified ? ` وإشعار ${r.notified} مقيم` : ''}` : `تم تفعيل البوابة وإشعار ${r.notified} مقيم ✓`, 'success');
                openControl();
            } catch (err) {
                btn.disabled = false;
                notify(apiError(err), 'error');
            }
        });
        const closeNow = card.querySelector('[data-act="close-now"]');
        if (closeNow) closeNow.addEventListener('click', async () => {
            if (!confirm('إغلاق البوابة الآن؟ لن يتمكن المقيمون من إرسال أو تعديل رغباتهم بعد ذلك.')) return;
            closeNow.disabled = true;
            try {
                await Hub().api('POST', '/api/er-portal/close', { hosp: per.hosp, ym: open.ym }, { retries: 0 });
                notify('تم إغلاق البوابة', 'info');
                openControl();
            } catch (err) { closeNow.disabled = false; notify(apiError(err), 'error'); }
        });
    }

    // ------------------------------------------------------------------
    // Live summary
    // ------------------------------------------------------------------
    let summaryTimer = null;

    function prefsChips(p) {
        const chip = (txt, cls) => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-bold ${cls}">${txt}</span>`;
        const out = [];
        if ((p.prefShifts || []).length) out.push(chip(`<i class="fas fa-clock"></i> ${p.prefShifts.map(s => SHIFT_AR[s] || s).join('، ')}`, 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'));
        if ((p.prefDays || []).length) out.push(chip(`<i class="fas fa-calendar-week"></i> ${p.prefDays.join('، ')}`, 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'));
        if ((p.specificDays || []).length) out.push(chip(`${p.prefDaysMode === 'prefer' ? '✓ أيام مفضلة' : '🚫 أيام مستبعدة'}: ${p.specificDays.join('، ')}`, p.prefDaysMode === 'prefer' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'));
        const day = iso => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
        (p.excludedIntervals || []).forEach(iv => out.push(chip(`${p.intervalMode === 'strictly_within' ? '🎯 حصراً' : '🚫 استبعاد'} من ${esc(day(iv.start))} إلى ${esc(day(iv.end))}`, 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300')));
        out.push(chip(p.noConsecutiveDays !== false ? 'بدون أيام متتالية' : 'يقبل أياماً متتالية', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'));
        return out.join(' ');
    }

    async function openSummary(ymWanted) {
        const per = period();
        if (!per) return;
        const el = modal('er-portal-summary-modal', 'max-w-4xl');
        const card = el.firstElementChild;
        el.classList.remove('hidden');
        let ym = ymWanted;
        const load = async (quiet) => {
            if (!quiet) {
                card.innerHTML = head('fa-list-check', 'ملخص طلبات رغبات المقيمين', esc(hospitalName(per.hosp)), 'er-portal-summary-modal') + '<div class="p-5 text-xs text-slate-500">جاري التحميل…</div>';
                bindClose(card);
            }
            let res;
            try {
                if (!ym) { const first = await Hub().api('GET', `/api/er-portal?hosp=${encodeURIComponent(per.hosp)}`, undefined, { retries: 1 }); ym = first.ym; res = first; }
                if (!res && ym) res = await Hub().api('GET', `/api/er-portal?hosp=${encodeURIComponent(per.hosp)}&ym=${ym}`, undefined, { retries: 1 });
            } catch (err) {
                if (!quiet) card.lastElementChild.textContent = apiError(err);
                return;
            }
            if (!res || !res.ym) {
                card.innerHTML = head('fa-list-check', 'ملخص طلبات رغبات المقيمين', esc(hospitalName(per.hosp)), 'er-portal-summary-modal')
                    + `<div class="p-6 text-center text-xs text-slate-500">لم تُفتح أي بوابة لهذا المستشفى بعد.<br><button type="button" data-act="ctl" class="mt-3 px-4 py-2 rounded-xl text-xs font-black text-white bg-indigo-600">فتح البوابة</button></div>`;
                bindClose(card);
                card.querySelector('[data-act="ctl"]').addEventListener('click', () => { close('er-portal-summary-modal'); openControl(); });
                return;
            }
            const portalRow = (res.portals || []).find(p => p.ym === res.ym);
            const onScreen = period();
            const sameMonth = onScreen && onScreen.hosp === per.hosp && onScreen.ym === res.ym;
            const st = core().state();
            const requestedIds = new Set(res.requests.map(r => String(r.erId)));
            const missing = sameMonth ? (st.residents || []).filter(r => r.active !== false && !requestedIds.has(String(r.id))) : [];
            const applied = res.requests.filter(r => r.appliedAt && r.appliedAt >= r.at).length;
            const scrollY = card.lastElementChild ? card.lastElementChild.scrollTop : 0;
            card.innerHTML = head('fa-list-check', 'ملخص طلبات رغبات المقيمين', `${esc(hospitalName(per.hosp))} · ${esc(monthTitle(res.ym))}`, 'er-portal-summary-modal') + `
                <div class="p-4 sm:p-5 space-y-4 text-xs overflow-y-auto flex-1">
                    <div class="flex flex-wrap items-center gap-2 justify-between">
                        <div class="flex items-center gap-2">
                            <select data-role="ym" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
                                ${(res.portals || []).map(p => `<option value="${p.ym}" ${p.ym === res.ym ? 'selected' : ''}>${monthTitle(p.ym)}${p.open ? ' (مفتوحة)' : ''}</option>`).join('')}
                            </select>
                            ${portalRow && portalRow.open ? `<span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-bold">مفتوحة حتى ${esc(when(portalRow.closesAt))}</span>` : '<span class="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 font-bold">مغلقة</span>'}
                        </div>
                        <span class="text-[11px] text-slate-400 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> تحديث تلقائي</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div class="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-center"><div class="text-xl font-black text-indigo-700 dark:text-indigo-300">${res.requests.length}</div><div class="text-[11px] font-bold text-slate-500">طلب مستلم</div></div>
                        <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 text-center"><div class="text-xl font-black text-slate-700 dark:text-slate-200">${res.accounts}</div><div class="text-[11px] font-bold text-slate-500">حساب في المستشفى</div></div>
                        <div class="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-center"><div class="text-xl font-black text-emerald-700 dark:text-emerald-300">${applied}</div><div class="text-[11px] font-bold text-slate-500">أُضيف لقاعدة البيانات</div></div>
                        <div class="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-center"><div class="text-xl font-black text-amber-700 dark:text-amber-300">${sameMonth ? missing.length : '—'}</div><div class="text-[11px] font-bold text-slate-500">نشطون بلا طلب</div></div>
                    </div>
                    ${sameMonth ? '' : `<div class="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                        <span>الصفحة تعرض شهراً آخر. تُضاف الطلبات إلى قاعدة البيانات عند فتح شهر ${esc(monthTitle(res.ym))}.</span>
                        <button type="button" data-act="goto" class="px-3 py-1.5 rounded-xl font-black text-white bg-amber-600 hover:bg-amber-700">الانتقال إلى ${esc(monthTitle(res.ym))}</button></div>`}
                    <div class="space-y-2">
                        ${res.requests.length ? res.requests.map(r => `<div class="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="min-w-0"><div class="font-black text-sm text-slate-800 dark:text-slate-100">${esc(r.erName || r.name)}</div>
                                    <div class="text-[11px] text-slate-400"><span dir="ltr">@${esc(r.username || '')}</span> · آخر تعديل ${esc(when(r.at))}</div></div>
                                <div class="flex items-center gap-1.5">
                                    ${r.appliedAt && r.appliedAt >= r.at ? '<span class="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 text-[10.5px] font-bold"><i class="fas fa-check"></i> في قاعدة البيانات</span>' : '<span class="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 text-[10.5px] font-bold">بانتظار الإضافة</span>'}
                                    ${sameMonth && r.erId ? `<button type="button" data-prefs="${esc(r.erId)}" class="px-2.5 py-1 rounded-xl text-[11px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">التفضيلات</button>` : ''}
                                </div>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-1.5">${prefsChips(r.prefs || {})}</div>
                        </div>`).join('') : '<div class="p-6 text-center text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">لم يصل أي طلب بعد.</div>'}
                    </div>
                    ${missing.length ? `<details class="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
                        <summary class="font-black text-slate-700 dark:text-slate-300 cursor-pointer">أطباء نشطون لم يرسلوا طلباً (${missing.length})</summary>
                        <div class="mt-2 flex flex-wrap gap-1.5">${missing.map(m => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-bold">${esc(m.name)}</span>`).join('')}</div>
                    </details>` : ''}
                </div>`;
            bindClose(card);
            card.lastElementChild.scrollTop = scrollY;
            card.querySelector('[data-role="ym"]').addEventListener('change', e => { ym = e.target.value; load(); });
            const go = card.querySelector('[data-act="goto"]');
            if (go) go.addEventListener('click', () => {
                close('er-portal-summary-modal');
                window.onMonthYearChange(Number(res.ym.slice(5, 7)), Number(res.ym.slice(0, 4)));
            });
            card.querySelectorAll('[data-prefs]').forEach(b => b.addEventListener('click', () => { close('er-portal-summary-modal'); window.openResidentPrefsModal(b.dataset.prefs); }));
        };
        if (period() && (!ymWanted || ymWanted === period().ym)) await sync();
        await load(false);
        clearInterval(summaryTimer);
        summaryTimer = setInterval(async () => {
            if (document.hidden || el.classList.contains('hidden')) return;
            if (period() && ym === period().ym) await sync();
            load(true);
        }, 30000);
    }

    window.ErPortal = { openControl, openSummary, sync };
})(window, document);
