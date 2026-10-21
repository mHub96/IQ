/**
 * "My Schedule" tab of the account panel (loaded on first use by hub-panel.js):
 * - the resident's monthly duties from their hospital roster and the ER schedule, on a calendar
 *   (today highlighted) and in a list, any month;
 * - personal marks on each duty: bought (+$) / sold (-$), a flag with a reason, a note;
 * - a PDF of the month;
 * - the ER preferences portal: while an admin keeps it open, the resident fills in their ER
 *   preferences for the coming month (same fields as the ER page's preferences panel);
 * - duty reminders: a switch for a notification a chosen time before each duty (sent by the server,
 *   so it arrives with the app closed).
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    const A = window.HubAccounts;
    const { esc, toast, errorText } = A;

    const MONTHS = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const WEEK = [6, 0, 1, 2, 3, 4, 5]; // columns start on Saturday (as the ER page)
    const ER_LABELS = {
        er: { morning: ['طوارئ · الصباحية', '8:00 ص – 2:00 م'], afternoon: ['طوارئ · بعد الصباحية', '2:00 م – 8:00 م'], preNight: ['طوارئ · البرينايت', '8:00 م – 2:00 ص'], lateNight: ['طوارئ · الليلية', '2:00 ص – 8:00 ص'] },
        con: { doctor: ['الاستشارية الخافرة', ''] },
        dc: { doctor: ['شهادات الوفاة', ''] },
        rs: {
            er_morning: ['إضراب طوارئ · صباحية', '8:00 ص – 2:00 م'], er_afternoon: ['إضراب طوارئ · بعد الصباحية', '2:00 م – 8:00 م'],
            er_preNight: ['إضراب طوارئ · برينايت', '8:00 م – 2:00 ص'], er_lateNight: ['إضراب طوارئ · ليلية', '2:00 ص – 8:00 ص'],
            ward_private: ['إضراب ردهات · الجناح الخاص', ''], ward_floor4: ['إضراب ردهات · طابق 4', ''], ward_floor5: ['إضراب ردهات · طابق 5', ''],
        },
    };
    const FLAGS = [
        { id: 'swap', icon: 'fa-right-left', label: 'تبديل مع زميل' },
        { id: 'cover', icon: 'fa-user-shield', label: 'تغطية عن زميل' },
        { id: 'leave', icon: 'fa-umbrella-beach', label: 'إجازة' },
        { id: 'sick', icon: 'fa-notes-medical', label: 'إجازة مرضية' },
        { id: 'exam', icon: 'fa-file-pen', label: 'امتحان' },
        { id: 'course', icon: 'fa-graduation-cap', label: 'دورة / مؤتمر' },
        { id: 'important', icon: 'fa-star', label: 'مهمة' },
        { id: 'other', icon: 'fa-flag', label: 'سبب آخر' },
    ];
    const flagOf = id => FLAGS.find(f => f.id === id);
    const SHIFT_OPTIONS = [['morning', 'الصباحية (8ص - 2م)'], ['afternoon', 'بعد الصباحية (2م - 8م)'], ['preNight', 'البرينايت (8م - 2ص)'], ['lateNight', 'الليلية (2ص - 8ص)']];
    const WEEKDAY_OPTIONS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

    const pad2 = n => String(n).padStart(2, '0');
    const ymOf = (y, m) => `${y}-${pad2(m)}`;
    const parseYm = ym => ({ y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)) });
    const shiftYm = (ym, k) => { const { y, m } = parseYm(ym); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return ymOf(d.getUTCFullYear(), d.getUTCMonth() + 1); };
    const daysIn = ym => { const { y, m } = parseYm(ym); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
    const dowOf = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
    const monthTitle = ym => { const { y, m } = parseYm(ym); return `${MONTHS[m]} ${y}`; };
    /** Today in Iraq (UTC+3). */
    function iraqToday() { const d = new Date(Date.now() + 3 * 3600 * 1000); return d.toISOString().slice(0, 10); }
    const hospitalName = id => { const h = Hub.getHospital && Hub.getHospital(id); return h ? (h.name_ar || h.hospitalName) : (id || ''); };
    const fmtTime = t => String(t || '').replace(/\b0(\d):/g, '$1:').replace(/\s*AM\b/gi, ' ص').replace(/\s*PM\b/gi, ' م').replace(/\s*-\s*/, ' – ');
    function deadlineText(ms) {
        const d = new Date(ms);
        return d.toLocaleString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' });
    }

    let host = null;      // the panel body we render into
    let ym = iraqToday().slice(0, 7);
    let data = null;      // last /my-duties response
    let portal = null;    // last /er-portal/mine response
    let openEditor = null;
    let selDate = '';
    let nextKey = '';     // the next duty's key (highlighted)
    let reminder = null;  // last /duty-reminder response

    // ------------------------------------------------------------------
    // Data
    // ------------------------------------------------------------------
    const cache = new Map();
    async function loadMonth(which, force) {
        if (!force && cache.has(which)) return cache.get(which);
        const res = await Hub.api('GET', '/api/accounts/my-duties?ym=' + which, undefined, { retries: 1 });
        cache.set(which, res);
        return res;
    }

    const FULL_DAY = '24 ساعة · 8:00 ص – 8:00 ص';
    /** A duty's name and time (its start and end, or the whole 24-hour duty day). */
    function view(d) {
        if (d.src === 'hospital') {
            const name = (Hub.getSpecialtyName && Hub.getSpecialtyName(d.spec, d.hosp || data.hosp)) || d.spec || 'خفارة المستشفى';
            return { title: name, time: d.time ? fmtTime(d.time) : FULL_DAY, er: false };
        }
        const l = (ER_LABELS[d.type] || {})[d.slot] || [d.type, ''];
        return { title: l[0], time: l[1] || FULL_DAY, er: true };
    }
    /** The next duty (today's or the first one after it), shown only in the month it falls in. */
    function nextDuty(duties) {
        const today = iraqToday();
        if (ym !== today.slice(0, 7)) return null;
        return duties.find(d => d.date >= today) || null;
    }
    const PLATFORM = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ? 'ios'
        : /Android/i.test(navigator.userAgent) ? 'android' : 'other';
    const markOf = d => (data && data.marks && data.marks[d.key]) || null;
    /** The hospitals this month's duties were in (a resident who moved has duties in more than one). */
    const monthHospitals = () => (data && data.hospitals && data.hospitals.length ? data.hospitals : [data.hosp]);
    /** A duty names its hospital when the month spans hospitals or it is not the resident's current one. */
    const showsHospital = d => !!d.hosp && (monthHospitals().length > 1 || d.hosp !== data.hosp);
    function hospitalLine() {
        const hs = monthHospitals();
        const moved = hs.length > 1 || hs[0] !== data.hosp;
        return `<div class="ms-hosp-line"><i class="fas fa-hospital"></i> ${hs.length > 1 ? 'مستشفيات هذا الشهر' : 'مستشفى هذا الشهر'}: <b>${hs.map(h => esc(hospitalName(h))).join('، ')}</b>${moved ? `<span class="ms-hosp-now">مستشفاك الحالي: ${esc(hospitalName(data.hosp))}</span>` : ''}</div>`;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    async function render(body) {
        host = body;
        body.innerHTML = '<div class="ms"><div class="hacc-empty">جاري تحميل جدولك…</div></div>';
        loadPortal(); // does not block the schedule
        loadReminder();
        await showMonth(ym);
    }

    async function showMonth(which, force) {
        ym = which;
        openEditor = null;
        try {
            data = await loadMonth(which, force);
        } catch (err) {
            if (!host) return;
            host.querySelector('.ms').innerHTML = `<div class="ms-empty">${esc(errorText(err))}<br><button type="button" class="ms-btn" data-act="retry" style="margin-top:10px">إعادة المحاولة</button></div>`;
            host.querySelector('[data-act="retry"]').addEventListener('click', () => showMonth(which, true));
            return;
        }
        if (which !== ym || !host) return;
        paint();
    }

    function paint() {
        const root = host.querySelector('.ms');
        const today = iraqToday();
        const duties = data.duties || [];
        nextKey = (nextDuty(duties) || {}).key || '';
        const byDate = {};
        duties.forEach(d => { (byDate[d.date] = byDate[d.date] || []).push(d); });
        const count = (f) => duties.filter(f).length;
        const bought = count(d => (markOf(d) || {}).kind === 'bought');
        const sold = count(d => (markOf(d) || {}).kind === 'sold');

        // Month options: two years back to six months ahead.
        const cur = today.slice(0, 7);
        const opts = [];
        for (let k = 6; k >= -24; k--) opts.push(shiftYm(cur, k));
        if (!opts.includes(ym)) opts.push(ym);

        const first = `${ym}-01`;
        const lead = WEEK.indexOf(dowOf(first));
        const n = daysIn(ym);
        let cells = '';
        for (let i = 0; i < lead; i++) cells += '<div class="ms-day pad" aria-hidden="true"></div>';
        for (let d = 1; d <= n; d++) {
            const iso = `${ym}-${pad2(d)}`;
            const list = byDate[iso] || [];
            const marks = list.map(markOf).filter(Boolean);
            const dow = dowOf(iso);
            const tags = [
                marks.some(k => k.kind === 'bought') ? '<span class="ms-mini p">+$</span>' : '',
                marks.some(k => k.kind === 'sold') ? '<span class="ms-mini m">-$</span>' : '',
                marks.some(k => k.flag) ? '<span class="ms-mini f"><i class="fas fa-flag"></i></span>' : '',
                !marks.some(k => k.flag) && marks.some(k => k.note) ? '<span class="ms-mini note"><i class="fas fa-comment"></i></span>' : '',
            ].join('');
            cells += `<button type="button" class="ms-day ${list.length ? 'has' : ''} ${iso === today ? 'today' : ''} ${iso === selDate ? 'sel' : ''} ${dow === 5 || dow === 6 ? 'wk' : ''}" data-date="${iso}" aria-label="${d} ${MONTHS[parseYm(ym).m]}${list.length ? '، ' + list.length + ' خفارة' : ''}">
                <span class="n">${d}</span>
                ${list.length ? `<span class="ms-pips">${list.slice(0, 3).map(x => `<span class="ms-pip ${x.src === 'er' ? 'er' : ''}"></span>`).join('')}</span>` : ''}
                ${tags ? `<span class="ms-day-tags">${tags}</span>` : ''}
            </button>`;
        }
        const tail = (7 - ((lead + n) % 7)) % 7;
        for (let i = 0; i < tail; i++) cells += '<div class="ms-day pad" aria-hidden="true"></div>';

        root.innerHTML = `
            <div data-role="portal">${portalHtml()}</div>
            <div data-role="reminder">${reminderHtml()}</div>
            <div class="ms-bar">
                <button type="button" class="ms-nav" data-act="next" aria-label="الشهر التالي"><i class="fas fa-chevron-right"></i></button>
                <select class="ms-month" data-role="month" aria-label="الشهر">${opts.map(o => `<option value="${o}" ${o === ym ? 'selected' : ''}>${monthTitle(o)}${o === cur ? ' (الحالي)' : ''}</option>`).join('')}</select>
                <button type="button" class="ms-nav" data-act="prev" aria-label="الشهر السابق"><i class="fas fa-chevron-left"></i></button>
            </div>
            <div class="ms-stats">
                <div class="ms-stat"><b>${duties.length}</b><span>كل الخفارات</span></div>
                <div class="ms-stat hosp"><b>${count(d => d.src === 'hospital')}</b><span>المستشفى</span></div>
                <div class="ms-stat er"><b>${count(d => d.src === 'er')}</b><span>الطوارئ</span></div>
                <div class="ms-stat money"><b><span class="p" dir="ltr">+${bought}</span> <span class="m" dir="ltr">−${sold}</span></b><span>مشتراة / مباعة</span></div>
            </div>
            <div class="ms-cal" role="grid" aria-label="تقويم ${esc(monthTitle(ym))}">
                <div class="ms-cal-head">${WEEK.map(i => `<span class="${i === 5 || i === 6 ? 'wk' : ''}">${DAY_NAMES[i]}</span>`).join('')}</div>
                <div class="ms-cal-grid">${cells}</div>
            </div>
            <div class="ms-legend">
                <span><i class="ms-pip"></i> المستشفى</span><span><i class="ms-pip er"></i> الطوارئ</span>
                <span><i class="tday"></i> اليوم</span><span><b class="ms-mini p">+$</b> مشتراة</span><span><b class="ms-mini m">-$</b> مباعة</span>
            </div>
            <div class="ms-section-title">خفاراتي في ${esc(monthTitle(ym))}</div>
            ${duties.length ? hospitalLine() : ''}
            <div class="ms-list" data-role="list">${duties.length ? duties.map(dutyHtml).join('') : `<div class="ms-empty">لا توجد خفارات باسمك في ${esc(monthTitle(ym))}.<br><small>نبحث في جداول خفارات المستشفيات وجداول الطوارئ باسم «${esc(data.name)}»${data.erName && data.erName !== data.name ? ` و«${esc(data.erName)}»` : ''}.</small></div>`}</div>
            ${duties.length ? '<button type="button" class="ms-btn gold ms-export" data-act="pdf"><i class="fas fa-file-pdf"></i> تصدير الجدول PDF</button>' : ''}
            ${duties.length && data.cal ? `<div class="ms-cal-actions">
                <a class="ms-btn ms-cal-add" data-act="cal-add" href="${esc(calLink('add'))}" ${PLATFORM === 'ios' ? 'target="_blank" rel="noopener"' : ''}><i class="${PLATFORM === 'ios' ? 'fab fa-apple' : PLATFORM === 'android' ? 'fab fa-android' : 'fas fa-calendar-plus'}"></i> ${PLATFORM === 'other' ? `تنزيل خفارات ${esc(MONTHS[parseYm(ym).m])} كملف تقويم` : `إضافة خفارات ${esc(MONTHS[parseYm(ym).m])} إلى تقويم ${PLATFORM === 'ios' ? 'iPhone' : 'Android'}`}</a>
                <a class="ms-cal-remove" data-act="cal-remove" href="${esc(calLink('remove'))}" ${PLATFORM === 'ios' ? 'target="_blank" rel="noopener"' : ''}><i class="fas fa-calendar-xmark"></i> إزالة تذكيرات هذا الشهر من التقويم</a>
                <small>تذكير قبل كل خفارة بـ 24 ساعة</small>
            </div>` : ''}
            <p class="ms-foot-note">الملاحظات والعلامات خاصة بك ولا يراها غيرك.</p>`;

        root.querySelector('[data-act="prev"]').addEventListener('click', () => showMonth(shiftYm(ym, -1)));
        root.querySelector('[data-act="next"]').addEventListener('click', () => showMonth(shiftYm(ym, 1)));
        root.querySelector('[data-role="month"]').addEventListener('change', e => showMonth(e.target.value));
        root.querySelectorAll('.ms-day[data-date]').forEach(b => b.addEventListener('click', () => pickDay(b.dataset.date)));
        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => toggleEditor(b.dataset.edit)));
        const pdf = root.querySelector('[data-act="pdf"]');
        if (pdf) pdf.addEventListener('click', () => exportPdf(pdf));
        const calAdd = root.querySelector('[data-act="cal-add"]');
        if (calAdd) calAdd.addEventListener('click', () => toast(PLATFORM === 'ios' ? 'في نافذة التقويم اضغط «إضافة الكل» (Add All)'
            : PLATFORM === 'android' ? 'اختر تطبيق التقويم (Google أو Samsung) ثم «حفظ / استيراد»'
            : 'افتح الملف الذي نُزّل بتطبيق التقويم', 'info'));
        const calRemove = root.querySelector('[data-act="cal-remove"]');
        if (calRemove) calRemove.addEventListener('click', e => {
            if (!confirm(`إزالة تذكيرات خفارات ${monthTitle(ym)} من تقويم الهاتف؟\n\nسيُفتح ملف إلغاء لنفس الخفارات؛ افتحه بتطبيق التقويم ليلغيها.`)) { e.preventDefault(); return; }
            toast('افتح الملف بتطبيق التقويم لتطبيق الإلغاء', 'info');
        });
        bindPortal(root);
        bindReminder(root);

        // First view of the current month: bring today's (or the next) duty into view.
        if (!selDate && ym === today.slice(0, 7)) {
            const next = duties.find(d => d.date >= today);
            if (next) requestAnimationFrame(() => { const el = root.querySelector(`.ms-duty[data-date="${next.date}"]`); if (el && host) host.scrollTop = 0; });
        }
    }

    /**
     * The calendar button's link for this phone: iPhone opens the file in Safari, which offers the events
     * to the Calendar app ("Add All"); Android asks the phone for its calendar app (an intent for the
     * file, falling back to downloading it); a computer downloads the file.
     */
    function calLink(mode) {
        const url = calUrl(mode);
        if (PLATFORM === 'android') {
            const u = new URL(url);
            return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};action=android.intent.action.VIEW;type=text/calendar;S.browser_fallback_url=${encodeURIComponent(url + '&dl=1')};end`;
        }
        return PLATFORM === 'other' ? url + '&dl=1' : url;
    }

    /** This month's calendar file (/api/cal): add = events with a reminder 24 h before; remove = their cancellation. */
    function calUrl(mode) {
        const names = {};
        (data.duties || []).forEach(d => { if (d.src === 'hospital') names[d.spec] = view(d).title; });
        const base = (Hub.getSyncStatus && Hub.getSyncStatus().apiBase) || '';
        return `${base}/api/cal?mode=${mode}&t=${encodeURIComponent(data.cal)}&h=${encodeURIComponent(hospitalName(data.hosp))}&n=${encodeURIComponent(JSON.stringify(names))}`;
    }

    function dutyHtml(d) {
        const v = view(d);
        const mk = markOf(d) || {};
        const f = flagOf(mk.flag);
        const today = iraqToday();
        const isNext = d.key === nextKey;
        return `<article class="ms-duty ${mk.kind ? 'kind-' + mk.kind : ''} ${d.date === today ? 'is-today' : ''} ${isNext ? 'is-next' : ''}" data-date="${d.date}" data-key="${esc(d.key)}">
            ${isNext ? `<span class="ms-next-badge"><i class="fas fa-bell"></i> ${d.date === today ? 'خفارتك اليوم' : 'الخفارة القادمة'}</span>` : ''}
            ${mk.kind === 'bought' ? '<span class="ms-badge-big p">+$</span>' : mk.kind === 'sold' ? '<span class="ms-badge-big m">-$</span>' : ''}
            <div class="ms-date"><b>${Number(d.date.slice(8))}</b><span>${DAY_NAMES[dowOf(d.date)]}</span></div>
            <div class="ms-main">
                <div class="ms-t">${esc(v.title)}</div>
                <div class="ms-s"><span class="ms-time"><i class="far fa-clock"></i> ${esc(v.time)}</span>${showsHospital(d) ? `<span class="ms-hosp-tag"><i class="fas fa-hospital"></i> ${esc(hospitalName(d.hosp))}</span>` : ''}</div>
                ${mk.kind || f ? `<div class="ms-tags">
                    ${mk.kind === 'bought' ? '<span class="ms-tag p"><span class="cur">+$</span> خفارة مشتراة</span>' : ''}
                    ${mk.kind === 'sold' ? '<span class="ms-tag m"><span class="cur">-$</span> خفارة مباعة</span>' : ''}
                    ${f ? `<span class="ms-tag f"><i class="fas ${f.icon}"></i> ${esc(f.label)}${mk.flagText ? ': ' + esc(mk.flagText) : ''}</span>` : ''}
                </div>` : ''}
                ${mk.note ? `<div class="ms-note">${esc(mk.note)}</div>` : ''}
            </div>
            <button type="button" class="ms-edit" data-edit="${esc(d.key)}" aria-label="ملاحظات وعلامات هذه الخفارة"><i class="fas fa-pen"></i></button>
        </article>`;
    }

    function pickDay(iso) {
        selDate = iso;
        host.querySelectorAll('.ms-day.sel').forEach(el => el.classList.remove('sel'));
        const cell = host.querySelector(`.ms-day[data-date="${iso}"]`);
        if (cell) cell.classList.add('sel');
        const card = host.querySelector(`.ms-duty[data-date="${iso}"]`);
        if (!card) { toast(`لا توجد خفارة يوم ${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7))]}`, 'info'); return; }
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    }

    // ------------------------------------------------------------------
    // Duty editor (bought / sold, flag, note)
    // ------------------------------------------------------------------
    function toggleEditor(key) {
        const prev = host.querySelector('.ms-editor');
        if (prev) prev.remove();
        if (openEditor === key) { openEditor = null; return; }
        openEditor = key;
        const card = [...host.querySelectorAll('.ms-duty')].find(c => c.dataset.key === key);
        const duty = data.duties.find(d => d.key === key);
        if (!card || !duty) return;
        const mk = { ...(markOf(duty) || {}) };
        const ed = document.createElement('div');
        ed.className = 'ms-editor';
        ed.innerHTML = `
            <div><h4>نوع الخفارة</h4>
                <div class="ms-seg" role="group">
                    <button type="button" data-kind="" aria-pressed="${!mk.kind}">عادية</button>
                    <button type="button" data-kind="bought" aria-pressed="${mk.kind === 'bought'}"><span dir="ltr">+$</span> مشتراة</button>
                    <button type="button" data-kind="sold" aria-pressed="${mk.kind === 'sold'}"><span dir="ltr">-$</span> مباعة</button>
                </div>
                <p class="msp-note">مشتراة: أخذتها من زميل مقابل مبلغ. مباعة: دفعت لزميل ليأخذها عنك.</p>
            </div>
            <div><h4>علامة (اختياري)</h4>
                <div class="ms-flags">${FLAGS.map(f => `<button type="button" class="ms-flag" data-flag="${f.id}" aria-pressed="${mk.flag === f.id}"><i class="fas ${f.icon}"></i>${f.label}</button>`).join('')}</div>
                <input class="ms-input" data-role="flag-text" maxlength="120" placeholder="السبب (مثلاً: تبديل مع د. أحمد)" value="${esc(mk.flagText || '')}" style="margin-top:8px" ${mk.flag ? '' : 'hidden'} />
            </div>
            <div><h4>ملاحظة</h4><textarea class="ms-textarea" data-role="note" maxlength="500" placeholder="أي ملاحظة تخص هذه الخفارة">${esc(mk.note || '')}</textarea></div>
            <div class="ms-row">
                <button type="button" class="ms-btn primary" data-act="save"><i class="fas fa-check"></i> حفظ</button>
                <button type="button" class="ms-btn" data-act="cancel">إلغاء</button>
                ${mk.kind || mk.flag || mk.note ? '<button type="button" class="ms-btn ghost-danger" data-act="clear"><i class="fas fa-eraser"></i> مسح</button>' : ''}
            </div>`;
        card.after(ed);
        ed.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
            mk.kind = b.dataset.kind || null;
            ed.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        }));
        const flagText = ed.querySelector('[data-role="flag-text"]');
        ed.querySelectorAll('[data-flag]').forEach(b => b.addEventListener('click', () => {
            mk.flag = mk.flag === b.dataset.flag ? null : b.dataset.flag;
            ed.querySelectorAll('[data-flag]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.flag === mk.flag)));
            flagText.hidden = !mk.flag;
            if (mk.flag) flagText.focus();
        }));
        ed.querySelector('[data-act="cancel"]').addEventListener('click', () => toggleEditor(key));
        const save = async (clear) => {
            const payload = clear ? { dkey: key } : { dkey: key, kind: mk.kind || null, flag: mk.flag || null, flagText: mk.flag ? flagText.value.trim() : '', note: ed.querySelector('[data-role="note"]').value.trim() };
            ed.querySelectorAll('button').forEach(b => { b.disabled = true; });
            try {
                const res = await Hub.api('POST', '/api/accounts/duty-mark', payload, { retries: 0 });
                data.marks = data.marks || {};
                if (res.mark) data.marks[key] = res.mark; else delete data.marks[key];
                cache.set(ym, data);
                openEditor = null;
                paint();
                const el = [...host.querySelectorAll('.ms-duty')].find(c => c.dataset.key === key);
                if (el) el.scrollIntoView({ block: 'nearest' });
                toast(clear ? 'تم المسح' : 'تم الحفظ ✓', 'success');
            } catch (err) {
                ed.querySelectorAll('button').forEach(b => { b.disabled = false; });
                toast(errorText(err), 'error');
            }
        };
        ed.querySelector('[data-act="save"]').addEventListener('click', () => save(false));
        const clr = ed.querySelector('[data-act="clear"]');
        if (clr) clr.addEventListener('click', () => save(true));
        ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ------------------------------------------------------------------
    // PDF (the month drawn as an A4 page, captured with html2canvas, saved with jsPDF)
    // ------------------------------------------------------------------
    const LIBS = {
        html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    };
    const loaded = {};
    function loadScript(src) {
        return loaded[src] = loaded[src] || new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true; s.crossOrigin = 'anonymous';
            s.onload = resolve;
            s.onerror = () => { delete loaded[src]; reject(new Error('lib')); };
            document.head.appendChild(s);
        });
    }

    // Left-to-right override: the PDF capture draws "+$" / "+3" in the right order inside Arabic text.
    const ltr = t => '‭' + t + '‬';

    function pdfHtml() {
        const acc = Hub.auth.getAccount() || {};
        const duties = data.duties || [];
        const next = nextDuty(duties);
        const bought = duties.filter(d => (markOf(d) || {}).kind === 'bought').length;
        const sold = duties.filter(d => (markOf(d) || {}).kind === 'sold').length;
        const { m } = parseYm(ym);
        const dayLabel = iso => `${DAY_NAMES[dowOf(iso)]} ${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7))]}`;
        const rows = duties.map((d, i) => {
            const v = view(d), mk = markOf(d) || {}, f = flagOf(mk.flag), dow = dowOf(d.date);
            const isNext = next && d.key === next.key;
            const status = [
                mk.kind === 'bought' ? `<span class="pill p"><span class="cur">${ltr('+$')}</span> مشتراة</span>` : '',
                mk.kind === 'sold' ? `<span class="pill m"><span class="cur">${ltr('-$')}</span> مباعة</span>` : '',
                f ? `<span class="pill f">${esc(f.label)}${mk.flagText ? ': ' + esc(mk.flagText) : ''}</span>` : '',
                mk.note ? `<div class="note">${esc(mk.note)}</div>` : '',
            ].join(' ').trim();
            return `<tr class="${mk.kind || ''} ${isNext ? 'next' : ''} ${dow === 5 || dow === 6 ? 'wk' : ''}">
                <td class="num">${i + 1}</td>
                <td class="dt"><b>${d.date.slice(8)}/${d.date.slice(5, 7)}</b></td>
                <td class="dy">${DAY_NAMES[dow]}</td>
                <td class="nm"><b>${esc(v.title)}</b>${isNext ? ' <span class="nx">القادمة</span>' : ''}${showsHospital(d) ? `<div class="hs">${esc(hospitalName(d.hosp))}</div>` : ''}</td>
                <td class="tm">${esc(v.time)}</td>
                <td class="st">${status || '<span class="dash">—</span>'}</td>
            </tr>`;
        }).join('');
        return `<div class="pbar"></div>
            <header class="ph">
                <div class="who">
                    <div class="kicker">جدول الخفارات الشهري · Duty Schedule</div>
                    <h1>${esc(acc.name || data.name || '')}</h1>
                    <div class="sub">${monthHospitals().map(h => esc(hospitalName(h))).join(' · ')}${acc.specialty ? ' · ' + esc(acc.specialty) : ''}</div>
                    ${monthHospitals().length > 1 || monthHospitals()[0] !== data.hosp ? `<div class="sub now">المستشفى الحالي: ${esc(hospitalName(data.hosp))}</div>` : ''}
                </div>
                <div class="mon"><span>الشهر</span><b>${esc(MONTHS[m])}</b><em>${parseYm(ym).y}</em></div>
            </header>
            <div class="psum">
                <div><b>${duties.length}</b><span>عدد الخفارات</span></div>
                <div><b class="p">${ltr('+' + bought)}</b><span>مشتراة</span></div>
                <div><b class="m">${ltr('−' + sold)}</b><span>مباعة</span></div>
                <div class="wide"><b>${next ? esc(dayLabel(next.date)) : '—'}</b><span>${next ? 'الخفارة القادمة · ' + esc(view(next).title) : 'الخفارة القادمة'}</span></div>
            </div>
            <table class="plist">
                <thead><tr><th class="num">#</th><th class="dt">التاريخ</th><th class="dy">اليوم</th><th>الخفارة</th><th class="tm">الوقت</th><th class="st">الحالة والملاحظات</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="pfoot">
                <span>بوابة المستشفيات التعليمية · Hospital Hub</span>
                <span>الأوقات بتوقيت بغداد</span>
                <span dir="ltr">${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Baghdad', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>`;
    }

    /** True when the capture is not an empty white page (some browsers draw nothing for foreignObject). */
    function canvasHasInk(canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = Math.min(canvas.height, 400);
        const px = ctx.getImageData(0, 0, w, h).data;
        for (let i = 0; i < px.length; i += 4 * 97) if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) return true;
        return false;
    }

    async function exportPdf(btn) {
        btn.disabled = true;
        const label = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إنشاء الملف…';
        // The page is laid out under a cover while it is captured, so nothing of it shows on screen.
        const stage = document.createElement('div');
        stage.className = 'ms-pdf-stage';
        const page = document.createElement('div');
        page.className = 'ms-pdf';
        page.innerHTML = pdfHtml();
        stage.appendChild(page);
        const cover = document.createElement('div');
        cover.className = 'ms-pdf-cover';
        cover.innerHTML = '<div><i class="fas fa-file-pdf"></i><b>جاري إنشاء ملف PDF…</b><span>لحظات من فضلك</span></div>';
        document.body.append(stage, cover);
        try {
            await Promise.all([loadScript(LIBS.html2canvas), loadScript(LIBS.jspdf)]);
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
            // The browser's own rendering (exact Arabic text); html2canvas's drawing if the browser refuses it.
            const opts = { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, ignoreElements: el => el.classList && el.classList.contains('ms-pdf-cover') };
            let canvas;
            try {
                canvas = await window.html2canvas(page, { ...opts, foreignObjectRendering: true });
                canvas.getContext('2d').getImageData(0, 0, 1, 1); // throws when the canvas is tainted
                if (!canvasHasInk(canvas)) throw new Error('blank');
            } catch (e) {
                canvas = await window.html2canvas(page, opts);
            }
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
            const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
            const pxPerPt = canvas.width / pw;
            const pageHpx = Math.floor(ph * pxPerPt);
            if (canvas.height <= pageHpx * 1.35) {
                // A little over one page: shrink to fit on a single page (centred).
                const k = Math.min(1, pageHpx / canvas.height);
                const w = pw * k, h = (canvas.height / pxPerPt) * k;
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, 0, w, h);
            } else for (let y = 0, i = 0; y < canvas.height; y += pageHpx, i++) {
                // Long months continue on further pages.
                const slice = document.createElement('canvas');
                slice.width = canvas.width;
                slice.height = Math.min(pageHpx, canvas.height - y);
                slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
                if (i) pdf.addPage();
                pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, slice.height / pxPerPt);
            }
            pdf.setProperties({ title: `جدول خفاراتي - ${monthTitle(ym)}` });
            pdf.save(`My-Schedule-${ym}.pdf`);
            toast('تم إنشاء ملف PDF ✓', 'success');
        } catch (err) {
            toast('تعذر إنشاء الملف. تحقق من الاتصال وحاول مجدداً.', 'error');
        } finally {
            stage.remove();
            cover.remove();
            btn.disabled = false;
            btn.innerHTML = label;
        }
    }

    // ------------------------------------------------------------------
    // Duty reminders
    // ------------------------------------------------------------------
    const LEAD_PRESETS = [15, 30, 60, 120, 180, 360, 720, 1440];
    const LEAD_DEFAULT = 120;
    let customLead = false; // the custom hours / minutes fields are open

    function durationText(min) {
        const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
        const unit = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
        const parts = [];
        if (d) parts.push(unit(d, 'يوم', 'يومين', 'أيام', 'يوماً'));
        if (h) parts.push(unit(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة'));
        if (m) parts.push(unit(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'));
        return parts.join(' و') || 'دقيقة';
    }

    async function loadReminder() {
        try {
            reminder = await Hub.api('GET', '/api/accounts/duty-reminder', undefined, { retries: 1 });
        } catch (e) { reminder = null; }
        if (reminder && reminder.on) A.push.status().then(st => { reminder.push = st; paintReminder(); }).catch(() => {});
        paintReminder();
    }

    function paintReminder() {
        const slot = host && host.querySelector('[data-role="reminder"]');
        if (!slot) return;
        slot.innerHTML = reminderHtml();
        bindReminder(host);
    }

    function reminderHtml() {
        if (!reminder) return '';
        const on = !!reminder.on;
        const lead = reminder.lead || LEAD_DEFAULT;
        const preset = LEAD_PRESETS.includes(lead) && !customLead;
        const next = reminder.next;
        const pushOff = on && reminder.push && reminder.push !== 'on';
        return `<div class="ms-remind ${on ? 'on' : ''}">
            <div class="ms-remind-head">
                <i class="fas fa-bell lead"></i>
                <div class="txt"><b>تذكير بخفارتي القادمة</b>
                    <small>${on ? `يصلك إشعار قبل كل خفارة بـ ${esc(durationText(lead))}، حتى والتطبيق مغلق.` : 'إشعار قبل كل خفارة بالوقت الذي تختاره.'}</small></div>
                <button type="button" class="hp-toggle" role="switch" aria-checked="${on}" aria-label="تذكير بخفارتي القادمة" data-act="remind-toggle"><span></span></button>
            </div>
            ${on ? `<div class="ms-remind-opts">
                <label class="ms-remind-lead">قبل الخفارة بـ
                    <select class="ms-input" data-role="remind-lead">
                        ${LEAD_PRESETS.map(m => `<option value="${m}" ${preset && m === lead ? 'selected' : ''}>${esc(durationText(m))}</option>`).join('')}
                        <option value="custom" ${preset ? '' : 'selected'}>وقت آخر…</option>
                    </select></label>
                ${preset ? '' : `<div class="ms-remind-custom">
                    <input class="ms-input" type="number" inputmode="numeric" min="0" max="72" value="${Math.floor(lead / 60)}" data-role="remind-h" aria-label="ساعات"><span>ساعة</span>
                    <input class="ms-input" type="number" inputmode="numeric" min="0" max="59" step="5" value="${lead % 60}" data-role="remind-m" aria-label="دقائق"><span>دقيقة</span>
                    <button type="button" class="ms-btn primary" data-act="remind-save">حفظ</button>
                </div>`}
                ${next ? `<div class="ms-remind-next"><i class="fas fa-clock"></i> خفارتك القادمة: <b>${esc(next.title)}</b> · ${esc(deadlineText(next.start))}${next.sent ? ' <span class="ok">(أُرسل التذكير)</span>' : ''}</div>`
                    : '<div class="ms-remind-next"><i class="fas fa-clock"></i> لا توجد خفارة قادمة في جدولك حالياً.</div>'}
                ${pushOff ? `<div class="ms-remind-warn">${reminder.push === 'needs-install' ? '📲 لتصلك الإشعارات على iPhone أضف الموقع إلى الشاشة الرئيسية أولاً، ثم فعّل الإشعارات.'
                    : reminder.push === 'denied' ? '🔕 الإشعارات محظورة لهذا الموقع في إعدادات المتصفح؛ سيظهر التذكير داخل التطبيق فقط.'
                    : reminder.push === 'unsupported' ? 'هذا المتصفح لا يدعم الإشعارات؛ سيظهر التذكير داخل التطبيق فقط.'
                    : '🔔 الإشعارات غير مفعّلة على هذا الجهاز. <button type="button" class="ms-btn sm" data-act="remind-push">تفعيل الإشعارات</button>'}</div>` : ''}
            </div>` : ''}
        </div>`;
    }

    /** Names of the hospital's duty codes as this app shows them (the server has no copy of them). */
    function dutyNames() {
        const names = {};
        const hosp = (data && data.hosp) || (Hub.auth.getAccount() || {}).hosp;
        const h = hosp && Hub.getHospital && Hub.getHospital(hosp);
        ((h && h.specialties) || []).forEach(sp => { if (sp && sp.id) names[sp.id] = (Hub.getSpecialtyName && Hub.getSpecialtyName(sp.id, hosp)) || sp.name_ar || sp.id; });
        for (const month of cache.values()) (month.duties || []).forEach(d => { if (d.src === 'hospital' && d.spec) names[d.spec] = view(d).title; });
        return names;
    }

    async function saveReminder(on, lead, btn) {
        if (btn) btn.disabled = true;
        try {
            const res = await Hub.api('POST', '/api/accounts/duty-reminder', { on, lead, names: on ? dutyNames() : undefined }, { retries: 0 });
            reminder = { ...res, push: reminder && reminder.push };
            customLead = false;
            toast(on ? `سيصلك تذكير قبل كل خفارة بـ ${durationText(res.lead)} ✓` : 'تم إيقاف تذكير الخفارات', 'success');
        } catch (err) {
            toast(errorText(err), 'error');
            paintReminder();
            return;
        }
        paintReminder();
        if (!on) return;
        // The reminder comes as a push: make sure this device receives them (may ask for permission).
        let st = await A.push.status().catch(() => 'unknown');
        if (st === 'off') { const r = await A.push.enable().catch(() => ({ ok: false })); st = r && r.ok ? 'on' : await A.push.status().catch(() => 'off'); }
        if (reminder && reminder.on) { reminder.push = st; paintReminder(); }
    }

    function bindReminder(root) {
        const box = root.querySelector('.ms-remind');
        if (!box) return;
        const toggle = box.querySelector('[data-act="remind-toggle"]');
        toggle.addEventListener('click', () => saveReminder(!reminder.on, reminder.lead || LEAD_DEFAULT, toggle));
        const sel = box.querySelector('[data-role="remind-lead"]');
        if (sel) sel.addEventListener('change', () => {
            if (sel.value === 'custom') { customLead = true; paintReminder(); return; }
            saveReminder(true, Number(sel.value), sel);
        });
        const save = box.querySelector('[data-act="remind-save"]');
        if (save) save.addEventListener('click', () => {
            const h = Math.max(0, Math.floor(Number(box.querySelector('[data-role="remind-h"]').value) || 0));
            const m = Math.max(0, Math.floor(Number(box.querySelector('[data-role="remind-m"]').value) || 0));
            const lead = h * 60 + m;
            if (lead < 5 || lead > 72 * 60) { toast('اختر وقتاً بين 5 دقائق و72 ساعة.', 'error'); return; }
            saveReminder(true, lead, save);
        });
        const pushBtn = box.querySelector('[data-act="remind-push"]');
        if (pushBtn) pushBtn.addEventListener('click', async () => {
            pushBtn.disabled = true;
            const r = await A.push.enable().catch(() => ({ ok: false }));
            reminder.push = await A.push.status().catch(() => 'off');
            if (!(r && r.ok)) toast((r && r.error) || 'تعذّر تفعيل الإشعارات', 'error');
            paintReminder();
        });
    }

    // ------------------------------------------------------------------
    // ER preferences portal
    // ------------------------------------------------------------------
    async function loadPortal() {
        try {
            portal = await Hub.api('GET', '/api/er-portal/mine', undefined, { retries: 1 });
        } catch (e) { portal = null; }
        const slot = host && host.querySelector('[data-role="portal"]');
        if (slot) { slot.innerHTML = portalHtml(); bindPortal(host); }
    }

    function portalHtml() {
        if (!portal || !portal.portal) return '';
        const p = portal.portal;
        return `<div class="ms-portal">
            <i class="fas fa-calendar-check lead"></i>
            <div class="txt"><b>بوابة رغبات الطوارئ لشهر ${esc(monthTitle(p.ym))}</b>
                <small>مفتوحة حتى ${esc(deadlineText(p.closesAt))}</small>
                ${portal.request ? `<div class="ok">✓ أرسلت رغباتك، ويمكنك تعديلها حتى الإغلاق</div>` : ''}</div>
            <button type="button" class="ms-btn primary" data-act="portal">${portal.request ? 'تعديل' : 'تحديد رغباتي'}</button>
        </div>`;
    }
    function bindPortal(root) {
        const b = root.querySelector('[data-act="portal"]');
        if (b) b.addEventListener('click', openPortalForm);
    }

    function openPortalForm() {
        const p = portal.portal;
        const prefs = JSON.parse(JSON.stringify(portal.prefs || {}));
        prefs.prefShifts = prefs.prefShifts || [];
        prefs.prefDays = prefs.prefDays || [];
        prefs.specificDays = prefs.specificDays || [];
        prefs.excludedIntervals = prefs.excludedIntervals || [];
        const female = portal.er && portal.er.sex === 'f';
        const min = `${p.ym}-01`, max = `${p.ym}-${pad2(daysIn(p.ym))}`;
        const root = host.querySelector('.ms');
        host.scrollTop = 0;
        if (!portal.er) {
            root.innerHTML = `<div class="msp"><div class="msp-head"><button type="button" class="ms-nav" data-act="back" aria-label="رجوع"><i class="fas fa-arrow-right"></i></button><div><h3>رغبات الطوارئ</h3></div></div>
                <div class="ms-empty">لم نجد اسمك في قاعدة بيانات أطباء الطوارئ لمستشفاك، لذلك لا يمكن ربط رغباتك بجدول الطوارئ.<br>راجع مدير المستشفى ليضيفك أو يصحح اسمك أو رقم هاتفك.</div></div>`;
            root.querySelector('[data-act="back"]').addEventListener('click', () => paint());
            return;
        }
        root.innerHTML = `<div class="msp">
            <div class="msp-head"><button type="button" class="ms-nav" data-act="back" aria-label="رجوع"><i class="fas fa-arrow-right"></i></button>
                <div><h3>رغبات خفارات الطوارئ · ${esc(monthTitle(p.ym))}</h3><small>${esc(portal.er.name)} · متاحة حتى ${esc(deadlineText(p.closesAt))}</small></div></div>
            ${female ? '<div class="msp-female"><b>قاعدة خفارات الطبيبات:</b> لا يتم توزيع الطبيبات آلياً على وجبتي البرينايت (8م - 2ص) والليلية (2ص - 8ص).</div>' : ''}
            <div class="msp-card"><div class="t"><i class="fas fa-clock"></i> الوجبات المفضلة للطوارئ</div>
                <div class="msp-chips">${SHIFT_OPTIONS.map(([v, l]) => `<label class="msp-chip"><input type="checkbox" data-shift="${v}" ${prefs.prefShifts.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>
                <p class="msp-note">اترك الكل بلا تحديد إذا لم تكن لديك رغبة معينة.</p></div>
            <div class="msp-card"><div class="t"><i class="fas fa-calendar-week"></i> الأيام المفضلة في الأسبوع</div>
                <div class="msp-chips days">${WEEKDAY_OPTIONS.map(d => `<label class="msp-chip"><input type="checkbox" data-wd="${d}" ${prefs.prefDays.includes(d) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>
            <div class="msp-card"><div class="t"><i class="fas fa-calendar-days"></i> أيام معينة من شهر ${esc(monthTitle(p.ym))}</div>
                <div class="msp-mode" data-role="days-mode">
                    <button type="button" data-mode="exclude">🚫 استبعاد الأيام</button>
                    <button type="button" data-mode="prefer">✓ أيام مفضلة للخفارة</button>
                </div>
                <div class="msp-cal-head">${WEEK.map(i => `<span>${DAY_NAMES[i]}</span>`).join('')}</div>
                <div class="msp-cal" data-role="cal"></div>
                <p class="msp-note" data-role="days-desc"></p></div>
            <div class="msp-card"><div class="t"><i class="fas fa-arrows-left-right-to-line"></i> فترات زمنية محددة</div>
                <div class="msp-mode" data-role="iv-mode">
                    <button type="button" data-mode="exclude">🚫 استبعاد الفترة</button>
                    <button type="button" data-mode="strictly_within">🎯 حصر الخفارات ضمنها</button>
                </div>
                <div data-role="ivs"></div>
                <button type="button" class="ms-btn" data-act="add-iv" style="width:100%"><i class="fas fa-plus"></i> إضافة فترة زمنية</button>
                <p class="msp-note" data-role="iv-desc"></p></div>
            <div class="msp-card"><label class="msp-check"><input type="checkbox" data-role="nocons" ${prefs.noConsecutiveDays !== false ? 'checked' : ''}>
                <span>تجنب الخفارات في أيام متتالية<br><small class="hacc-muted">مفضل افتراضياً لمنع الإجهاد وضمان فاصل كافٍ بين الخفارات</small></span></label></div>
            <div class="msp-save"><button type="button" class="ms-btn primary" data-act="send" style="width:100%"><i class="fas fa-paper-plane"></i> ${portal.request ? 'حفظ التعديلات' : 'إرسال رغباتي'}</button>
                <div class="msp-status" data-role="status">${portal.request ? `<span class="ok">✓ أُرسلت</span> · آخر تعديل ${esc(new Date(portal.request.at).toLocaleString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' }))}` : 'لم ترسل رغباتك بعد'}</div></div>
        </div>`;
        const form = root.querySelector('.msp');
        const paintMode = (role, value) => form.querySelectorAll(`[data-role="${role}"] [data-mode]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === value)));
        const paintCal = () => {
            const lead = WEEK.indexOf(dowOf(min));
            const n = daysIn(p.ym);
            const cls = prefs.prefDaysMode === 'prefer' ? 'pr' : 'ex';
            let html = '';
            for (let i = 0; i < lead; i++) html += '<span class="msp-d pad"></span>';
            for (let d = 1; d <= n; d++) html += `<button type="button" class="msp-d ${cls}" data-d="${d}" aria-pressed="${prefs.specificDays.includes(d)}">${d}</button>`;
            form.querySelector('[data-role="cal"]').innerHTML = html;
            form.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
                const d = Number(b.dataset.d);
                prefs.specificDays = prefs.specificDays.includes(d) ? prefs.specificDays.filter(x => x !== d) : prefs.specificDays.concat(d).sort((a, c) => a - c);
                b.setAttribute('aria-pressed', String(prefs.specificDays.includes(d)));
            }));
            form.querySelector('[data-role="days-desc"]').textContent = prefs.prefDaysMode === 'prefer'
                ? 'الأيام المحددة باللون الأخضر تُفضَّل لخفاراتك.'
                : 'الأيام المحددة باللون الأحمر لن تُوزَّع عليك فيها أي خفارة.';
            paintMode('days-mode', prefs.prefDaysMode);
        };
        const paintIvs = () => {
            const box = form.querySelector('[data-role="ivs"]');
            box.innerHTML = prefs.excludedIntervals.map((iv, i) => `<div class="msp-iv" data-i="${i}">
                <input type="date" class="ms-input" data-k="start" min="${min}" max="${max}" value="${esc(iv.start || '')}" aria-label="من">
                <input type="date" class="ms-input" data-k="end" min="${min}" max="${max}" value="${esc(iv.end || '')}" aria-label="إلى">
                <button type="button" data-act="del-iv" aria-label="حذف"><i class="fas fa-trash"></i></button></div>`).join('') || '<p class="msp-note" style="margin:0 0 8px">لا توجد فترات.</p>';
            box.querySelectorAll('input[type="date"]').forEach(inp => inp.addEventListener('change', () => {
                prefs.excludedIntervals[Number(inp.closest('[data-i]').dataset.i)][inp.dataset.k] = inp.value;
            }));
            box.querySelectorAll('[data-act="del-iv"]').forEach(b => b.addEventListener('click', () => {
                prefs.excludedIntervals.splice(Number(b.closest('[data-i]').dataset.i), 1);
                paintIvs();
            }));
            form.querySelector('[data-role="iv-desc"]').textContent = prefs.intervalMode === 'strictly_within'
                ? 'ستكون كل خفاراتك داخل هذه الفترات فقط.'
                : 'لن تُوزَّع عليك خفارات خلال هذه الفترات.';
            paintMode('iv-mode', prefs.intervalMode);
        };
        form.querySelectorAll('[data-role="days-mode"] [data-mode]').forEach(b => b.addEventListener('click', () => { prefs.prefDaysMode = b.dataset.mode; paintCal(); }));
        form.querySelectorAll('[data-role="iv-mode"] [data-mode]').forEach(b => b.addEventListener('click', () => { prefs.intervalMode = b.dataset.mode; paintIvs(); }));
        form.querySelector('[data-act="add-iv"]').addEventListener('click', () => { prefs.excludedIntervals.push({ start: '', end: '' }); paintIvs(); });
        form.querySelector('[data-act="back"]').addEventListener('click', () => paint());
        prefs.prefDaysMode = prefs.prefDaysMode === 'prefer' ? 'prefer' : 'exclude';
        prefs.intervalMode = prefs.intervalMode === 'strictly_within' ? 'strictly_within' : 'exclude';
        paintCal();
        paintIvs();

        form.querySelector('[data-act="send"]').addEventListener('click', async e => {
            const btn = e.currentTarget;
            const out = {
                prefShifts: [...form.querySelectorAll('[data-shift]:checked')].map(i => i.dataset.shift),
                prefDays: [...form.querySelectorAll('[data-wd]:checked')].map(i => i.dataset.wd),
                prefDaysMode: prefs.prefDaysMode,
                specificDays: prefs.specificDays,
                intervalMode: prefs.intervalMode,
                excludedIntervals: prefs.excludedIntervals.filter(iv => iv.start || iv.end),
                noConsecutiveDays: form.querySelector('[data-role="nocons"]').checked,
            };
            btn.disabled = true;
            try {
                const res = await Hub.api('POST', '/api/er-portal/mine', { ym: p.ym, prefs: out }, { retries: 0 });
                portal.prefs = res.prefs;
                portal.request = res.request;
                toast('تم إرسال رغباتك ✓ يمكنك تعديلها حتى إغلاق البوابة', 'success');
                paint();
            } catch (err) {
                btn.disabled = false;
                const code = err && err.data && err.data.error;
                toast(({ portal_closed: 'انتهت مدة البوابة، لم يعد التعديل ممكناً.', not_in_er: 'اسمك غير موجود في قاعدة بيانات الطوارئ.' })[code] || errorText(err), 'error');
                if (code === 'portal_closed') { portal = null; paint(); }
            }
        });
    }

    window.HubMySchedule = {
        render,
        /** Opens the portal form directly (notification tap). */
        async openPortal(body) {
            host = body;
            await render(body);
            if (!portal) await loadPortal();
            if (portal && portal.portal) openPortalForm();
        },
        detach() { host = null; },
    };
})(window, document);
