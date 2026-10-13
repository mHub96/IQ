/**
 * Account panel: opens over the current page (profile, comments received, settings).
 * Loaded on first use by hub-accounts.js (HubAccounts.openPanel).
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    const A = window.HubAccounts;
    const { esc, toast, timeAgo, errorText, ROLE_NAMES } = A;
    const BOARD_NAMES = { arab: 'البورد العربي', iraqi: 'البورد العراقي', other: 'بورد آخر', none: 'بدون بورد' };
    const STAGE_NAMES = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'];
    const MONTHS = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const SEX = { m: 'ذكر', f: 'أنثى' };
    const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,23}$/u;
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const hospitalName = id => { const h = Hub.getHospital && Hub.getHospital(id); return h ? (h.name_ar || h.hospitalName) : (id || ''); };
    const localPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '0' + d : p; };
    const initial = name => esc(String(name || '?').replace(/^د\.?\s*/, '').trim().charAt(0));
    const isoToLocal = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : (iso || ''));

    let me = null;        // profile from the server
    let sheet = null;     // the open panel element
    let tab = 'profile';

    async function loadMe() {
        try {
            const res = await Hub.api('GET', '/api/accounts/me', undefined, { retries: 1 });
            if (res.account) {
                me = { ...res.account, thisDevice: res.device };
                Hub.auth.refreshAccount(res.account, res.role, res.adminHospitals);
            }
        } catch (e) {
            me = me || Hub.auth.getAccount();
        }
        return me;
    }

    // ------------------------------------------------------------------
    // Shell
    // ------------------------------------------------------------------
    async function open(which = 'profile') {
        tab = ['profile', 'comments', 'settings'].includes(which) ? which : 'profile';
        const acc = Hub.auth.getAccount();
        const approver = ['owner', 'admin'].includes(Hub.auth.getRole());
        sheet = A.openSheet(`<header class="hacc-sheet-head hp-head">
                <div class="hp-who">
                    <span class="hacc-avatar">${acc ? initial(acc.name) : '<i class="fas fa-user"></i>'}</span>
                    <div><h2>${esc(acc ? acc.name : (ROLE_NAMES[Hub.auth.getRole()] || 'حسابي'))}</h2>
                    <div class="hacc-muted">${acc ? `<span dir="ltr">@${esc(acc.username)}</span> · ${esc(ROLE_NAMES[acc.role] || acc.role)}` : 'مسجّل بكلمة المرور المشتركة'}</div></div>
                </div>
                <button type="button" class="hacc-icon-btn" data-act="close" aria-label="إغلاق">✕</button>
            </header>
            <div class="hacc-tabs" role="tablist">
                ${acc ? `<button type="button" role="tab" data-tab="profile">الملف الشخصي</button>
                <button type="button" role="tab" data-tab="comments">تعليقاتي</button>` : ''}
                <button type="button" role="tab" data-tab="settings">الإعدادات</button>
            </div>
            <div class="hacc-sheet-body hp-body" data-role="body"><div class="hacc-empty">جاري التحميل…</div></div>
            <footer class="hp-foot">
                ${approver ? '<a class="hacc-btn sm" href="./account.html#manage"><i class="fas fa-user-shield"></i> إدارة الحسابات</a>' : ''}
                ${!acc ? '<a class="hacc-btn sm primary" href="./account.html#signup">إنشاء حساب شخصي</a>' : ''}
                <button type="button" class="hacc-btn sm danger" data-act="logout"><i class="fas fa-sign-out-alt"></i> خروج</button>
            </footer>`, { label: 'لوحة الحساب', tall: true });
        if (!acc) tab = 'settings';
        sheet.querySelector('[data-act="close"]').addEventListener('click', A.closeSheet);
        sheet.querySelector('[data-act="logout"]').addEventListener('click', logout);
        sheet.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
        if (acc) await loadMe();
        show(tab);
    }

    function show(which) {
        tab = which;
        sheet.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === which)));
        const body = sheet.querySelector('[data-role="body"]');
        body.scrollTop = 0;
        ({ profile: renderProfile, comments: renderComments, settings: renderSettings })[which](body);
    }

    async function logout() {
        if (!confirm('تسجيل الخروج من هذا الجهاز؟')) return;
        await A.push.disable().catch(() => {});
        Hub.auth.logout();
        location.href = './index.html?portal=true';
    }

    // ------------------------------------------------------------------
    // Profile
    // ------------------------------------------------------------------
    function stageText(n) { return n ? `المرحلة ${STAGE_NAMES[n] || n}` : '—'; }

    function renderProfile(body) {
        const a = me || Hub.auth.getAccount();
        if (!a) { body.innerHTML = ''; return; }
        const specs = (Hub.getGlobalSpecialties ? Hub.getGlobalSpecialties() : []).map(s => s.name_ar).filter(Boolean);
        const years = a.board_years || '';
        const month = a.stage_month || 10;
        body.innerHTML = `
            ${a.profile_complete ? '' : `<div class="hp-banner">📝 <b>أكمل ملفك الشخصي</b><br>${a.profile_src === 'auto'
                ? 'عبّأنا بعض المعلومات تلقائياً من بيانات المستشفى والطوارئ. راجعها وأكمل الناقص ثم احفظ.'
                : 'أضف نوع البورد والاختصاص والمرحلة وعدد سنوات البورد.'}</div>`}
            <form class="hp-form" data-role="profile-form" novalidate>
                <label class="hp-field"><span>نوع البورد</span>
                    <select name="board">
                        <option value="">اختر…</option>
                        ${Object.entries(BOARD_NAMES).map(([k, v]) => `<option value="${k}" ${a.board === k ? 'selected' : ''}>${v}</option>`).join('')}
                    </select></label>
                <label class="hp-field"><span>الاختصاص</span>
                    <input name="specialty" list="hp-specs" value="${esc(a.specialty || '')}" placeholder="اختر أو اكتب الاختصاص" maxlength="80" />
                    <datalist id="hp-specs">${specs.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist></label>
                <div class="hp-row" data-role="board-only">
                    <label class="hp-field"><span>المرحلة الحالية</span>
                        <select name="stage"><option value="">—</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${a.stage_now === n ? 'selected' : ''}>${STAGE_NAMES[n]}</option>`).join('')}</select></label>
                    <label class="hp-field"><span>سنوات البورد</span>
                        <select name="boardYears"><option value="">—</option>${[3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${years === n ? 'selected' : ''}>${n} سنوات</option>`).join('')}</select></label>
                </div>
                <p class="hacc-muted" data-role="board-only">ترتفع المرحلة تلقائياً مرحلةً واحدة في شهر <b>${MONTHS[month]}</b> من كل عام، وتتوقف عند السنة الأخيرة من البورد.</p>
                <div class="hp-actions">
                    <button type="submit" class="hacc-btn primary">حفظ</button>
                    <button type="button" class="hacc-btn" data-act="suggest">🪄 تعبئة من بيانات النظام</button>
                </div>
            </form>
            <dl class="hp-kv">
                <dt>الاسم</dt><dd>${esc(a.name)}</dd>
                <dt>المستشفى</dt><dd>${esc(hospitalName(a.hosp))}</dd>
                <dt>الجنس</dt><dd>${esc(SEX[a.sex] || '—')}</dd>
                <dt>الهاتف</dt><dd dir="ltr">${esc(localPhone(a.phone))}</dd>
                <dt>المرحلة الآن</dt><dd>${a.board === 'none' ? '—' : esc(stageText(a.stage_now))}${a.board_years ? ` من ${a.board_years}` : ''}</dd>
                <dt>عضو منذ</dt><dd>${esc(new Date(a.created_at).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' }))}</dd>
            </dl>
            <p class="hacc-muted">الاسم والهاتف والمستشفى مرتبطة بجدول الخفارات؛ لتغييرها راجع مالك المنظومة.</p>`;

        const form = body.querySelector('[data-role="profile-form"]');
        const syncBoard = () => {
            const none = form.board.value === 'none';
            body.querySelectorAll('[data-role="board-only"]').forEach(el => { el.hidden = none; });
        };
        form.board.addEventListener('change', syncBoard);
        syncBoard();
        body.querySelector('[data-act="suggest"]').addEventListener('click', async e => {
            e.target.disabled = true;
            try {
                const { suggestion: s } = await Hub.api('GET', '/api/accounts/profile-suggest', undefined, { retries: 1 });
                let filled = 0;
                if (s.board) { form.board.value = s.board; filled++; }
                if (s.specialty) { form.specialty.value = s.specialty; filled++; }
                if (s.stage) { form.stage.value = String(s.stage); filled++; }
                syncBoard();
                toast(filled ? `تمت تعبئة ${filled} حقول من بيانات النظام. راجعها ثم احفظ.` : 'لم نجد معلومات إضافية لك في بيانات النظام.', filled ? 'success' : 'info');
            } catch (err) { toast(errorText(err), 'error'); }
            e.target.disabled = false;
        });
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const payload = {
                board: form.board.value || null,
                specialty: form.specialty.value.trim() || null,
                stage: form.board.value === 'none' ? null : (form.stage.value || null),
                boardYears: form.board.value === 'none' ? null : (form.boardYears.value || null),
            };
            if (payload.stage && payload.boardYears && Number(payload.stage) > Number(payload.boardYears)) {
                toast('المرحلة أكبر من عدد سنوات البورد.', 'error');
                return;
            }
            try {
                const res = await Hub.api('POST', '/api/accounts/profile', payload, { retries: 0 });
                me = { ...me, ...res.account };
                Hub.auth.refreshAccount({ ...Hub.auth.getAccount(), ...res.account }, Hub.auth.getRole(), Hub.auth.getAdminHospitalIds());
                A.refreshNavSlots();
                toast(res.account.profile_complete ? 'تم حفظ ملفك ✓' : 'تم الحفظ. ما زالت بعض المعلومات ناقصة.', res.account.profile_complete ? 'success' : 'info');
                renderProfile(body);
            } catch (err) {
                const code = err && err.data && err.data.error;
                toast(({ stage_over_years: 'المرحلة أكبر من عدد سنوات البورد.', bad_stage: 'مرحلة غير صحيحة.', bad_years: 'عدد سنوات غير صحيح.' })[code] || errorText(err), 'error');
            }
        });
    }

    // ------------------------------------------------------------------
    // Comments received (all time)
    // ------------------------------------------------------------------
    async function renderComments(body, more = false) {
        if (!more) body.innerHTML = '<div class="hacc-empty">جاري التحميل…</div>';
        const list = body._comments || [];
        try {
            const before = more && list.length ? list[list.length - 1].cid : '';
            const res = await Hub.api('GET', '/api/accounts/received' + (before ? '?before=' + before : ''), undefined, { retries: 1 });
            body._comments = more ? list.concat(res.comments) : res.comments;
            body._totals = res.totals || body._totals;
            body._more = res.comments.length === 50;
        } catch (err) {
            body.innerHTML = `<div class="hacc-empty">${esc(errorText(err))}</div>`;
            return;
        }
        const t = body._totals || {};
        const items = body._comments;
        let lastDate = '';
        body.innerHTML = `<div class="hp-stats">
                <div><b>${t.likes || 0}</b><span>❤️ إعجاب</span></div>
                <div><b>${t.comments || 0}</b><span>💬 تعليق</span></div>
                <div><b>${t.days || 0}</b><span>📅 خفارة</span></div>
            </div>
            ${items.length ? `<ul class="hacc-comments">${items.map(c => {
                const head = c.date !== lastDate ? `<li class="hp-date">${esc(isoToLocal(c.date))} · ${esc(hospitalName(c.hosp))}</li>` : '';
                lastDate = c.date;
                return head + `<li><span class="hacc-avatar ${c.anon ? 'anon' : ''}">${c.anon ? '🕶️' : initial(c.author)}</span>
                    <div class="hacc-bubble-wrap"><div class="hacc-bubble"><div class="hacc-author"><bdi>${esc(c.author)}</bdi></div>
                    <div class="hacc-text">${esc(c.body)}</div></div>
                    <div class="hacc-meta"><time>${esc(timeAgo(c.ts))}</time>${c.edited ? '<span>معدّل</span>' : ''}</div></div></li>`;
            }).join('')}</ul>` : '<div class="hacc-empty">لم تصلك تعليقات بعد. ستظهر هنا كل التعليقات على بطاقات خفاراتك.</div>'}
            ${body._more ? '<button type="button" class="hacc-btn btn-block" data-act="more">عرض المزيد</button>' : ''}`;
        const moreBtn = body.querySelector('[data-act="more"]');
        if (moreBtn) moreBtn.addEventListener('click', () => { moreBtn.disabled = true; renderComments(body, true); });
    }

    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------
    function renderSettings(body) {
        const a = me || Hub.auth.getAccount();
        body.innerHTML = `
            <section class="hp-section">
                <h3>المظهر</h3>
                <div class="hp-line"><span>الوضع</span>
                    <div class="hp-seg" data-role="theme">
                        <button type="button" data-theme="light">☀️ فاتح</button>
                        <button type="button" data-theme="dark">🌙 داكن</button>
                    </div></div>
            </section>
            ${a ? `
            <section class="hp-section" id="hp-nick">
                <h3>اللقب المجهول</h3>
                <p class="hacc-muted">يظهر بدلاً من اسمك عندما تعلّق كمجهول، ويبقى إلى أن تغيّره.</p>
                <div class="hp-nick">🕶️ <bdi data-role="nick">${esc(a.anon_tag || '—')}</bdi></div>
                <div class="hp-line"><span>لغة اللقب</span>
                    <div class="hp-seg" data-role="nick-lang">
                        <button type="button" data-lang="ar">عربي</button>
                        <button type="button" data-lang="en">English</button>
                    </div></div>
                <div class="hp-line"><span>لقب عشوائي جديد</span><button type="button" class="hacc-btn sm" data-act="nick-random">🎲 عشوائي</button></div>
                <div class="hp-inline">
                    <input data-role="nick-custom" maxlength="24" placeholder="لقب خاص: Night_Owl أو بومة-الليل" autocapitalize="none" spellcheck="false" />
                    <button type="button" class="hacc-btn sm primary" data-act="nick-save" disabled>حفظ</button>
                </div>
                <div class="hp-hint" data-role="nick-hint">٣–٢٤ حرفاً وأرقام و - _ . بدون مسافات، وغير مستخدم من شخص آخر.</div>
            </section>
            <section class="hp-section">
                <h3>الإشعارات</h3>
                <div class="hp-line"><span data-role="push-text">جاري الفحص…</span><button type="button" class="hacc-btn sm" data-act="push" disabled>…</button></div>
                <div class="hp-line" data-role="push-test" hidden><span>إشعار تجريبي</span><button type="button" class="hacc-btn sm" data-act="push-test">إرسال</button></div>
            </section>
            <section class="hp-section">
                <h3>الأجهزة</h3>
                <p class="hacc-muted" data-role="dev-lead"></p>
                <ul class="hp-devices" data-role="devices"></ul>
            </section>
            <section class="hp-section">
                <details><summary><h3 style="display:inline">تغيير كلمة المرور</h3></summary>
                <form class="hp-form" data-role="pw-form" novalidate style="margin-top:10px">
                    <input type="password" name="old" dir="ltr" autocomplete="current-password" placeholder="كلمة المرور الحالية" />
                    <input type="password" name="new1" dir="ltr" autocomplete="new-password" placeholder="كلمة المرور الجديدة (٨ أحرف على الأقل)" />
                    <input type="password" name="new2" dir="ltr" autocomplete="new-password" placeholder="تأكيد كلمة المرور الجديدة" />
                    <button type="submit" class="hacc-btn primary">حفظ</button>
                    <div class="hp-hint" data-role="pw-msg"></div>
                </form></details>
            </section>` : ''}`;

        // Theme
        const paintTheme = () => body.querySelectorAll('[data-role="theme"] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === Hub.getTheme())));
        body.querySelectorAll('[data-role="theme"] button').forEach(b => b.addEventListener('click', () => { Hub.setTheme(b.dataset.theme); paintTheme(); }));
        paintTheme();
        if (!a) return;

        // Nickname
        const paintNick = acc => {
            body.querySelector('[data-role="nick"]').textContent = acc.anon_tag || '—';
            body.querySelectorAll('[data-role="nick-lang"] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === (acc.anon_lang || 'ar'))));
        };
        paintNick(a);
        const saveNick = async (payload, ok) => {
            try {
                const res = await Hub.api('POST', '/api/accounts/anon', payload, { retries: 0 });
                me = { ...me, anon_tag: res.anon_tag, anon_lang: res.anon_lang };
                Hub.auth.refreshAccount({ ...Hub.auth.getAccount(), anon_tag: res.anon_tag, anon_lang: res.anon_lang }, Hub.auth.getRole(), Hub.auth.getAdminHospitalIds());
                paintNick(me);
                toast(ok, 'success');
                return true;
            } catch (err) {
                const code = err && err.data && err.data.error;
                toast(({ nick_taken: 'هذا اللقب مستخدم من شخص آخر.', nick_invalid: 'لقب غير صالح.', nick_reserved: 'لا يمكن استخدام هذا اللقب.' })[code] || errorText(err), 'error');
                return false;
            }
        };
        body.querySelectorAll('[data-role="nick-lang"] button').forEach(b => b.addEventListener('click', () => {
            if (b.getAttribute('aria-pressed') !== 'true') saveNick({ lang: b.dataset.lang }, 'تم تغيير لغة اللقب ✓');
        }));
        body.querySelector('[data-act="nick-random"]').addEventListener('click', () => saveNick({ mode: 'random' }, 'لقب جديد ✓'));
        const custom = body.querySelector('[data-role="nick-custom"]');
        const hint = body.querySelector('[data-role="nick-hint"]');
        const saveBtn = body.querySelector('[data-act="nick-save"]');
        const setHint = (text, color = '') => { hint.textContent = text; hint.style.color = color; };
        const check = debounce(async () => {
            const tag = custom.value.trim();
            saveBtn.disabled = true;
            if (!tag) return setHint('٣–٢٤ حرفاً وأرقام و - _ . بدون مسافات، وغير مستخدم من شخص آخر.');
            if (!NICK_RE.test(tag)) return setHint('✗ ٣–٢٤ حرفاً، يبدأ بحرف أو رقم، بدون رموز غير - _ .', 'var(--hacc-danger)');
            setHint('جاري التحقق…');
            try {
                const r = await Hub.api('GET', '/api/accounts/anon-check?tag=' + encodeURIComponent(tag), undefined, { retries: 0 });
                if (custom.value.trim() !== tag) return;
                if (!r.valid) return setHint(r.reason === 'reserved' ? '✗ لا يمكن استخدام هذا اللقب.' : '✗ لقب غير صالح.', 'var(--hacc-danger)');
                if (r.mine) return setHint('هذا لقبك الحالي.');
                setHint(r.free ? '✓ اللقب متاح' : '✗ هذا اللقب مستخدم من شخص آخر', r.free ? '#059669' : 'var(--hacc-danger)');
                saveBtn.disabled = !r.free;
            } catch (err) { setHint(errorText(err), 'var(--hacc-danger)'); }
        }, 400);
        custom.addEventListener('input', () => {
            const v = custom.value.replace(/\s+/g, '-');
            if (v !== custom.value) custom.value = v;
            check();
        });
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            if (await saveNick({ mode: 'custom', tag: custom.value.trim() }, 'تم حفظ لقبك ✓')) { custom.value = ''; setHint(''); }
        });

        // Push
        const pushBtn = body.querySelector('[data-act="push"]');
        const paintPush = async () => {
            const st = await A.push.status();
            const t = {
                on: ['مفعّلة على هذا الجهاز ✓', 'إيقاف'],
                off: ['غير مفعّلة على هذا الجهاز', 'تفعيل'],
                denied: ['محظورة من إعدادات المتصفح', 'تفعيل'],
                'needs-install': ['على الآيفون: أضف التطبيق للشاشة الرئيسية أولاً', 'تفعيل'],
                unsupported: ['غير مدعومة في هذا المتصفح', 'غير متاح'],
            }[st] || ['…', '…'];
            body.querySelector('[data-role="push-text"]').textContent = t[0];
            pushBtn.textContent = t[1];
            pushBtn.className = 'hacc-btn sm' + (st === 'on' ? '' : ' primary');
            pushBtn.disabled = st === 'unsupported';
            pushBtn.dataset.state = st;
            body.querySelector('[data-role="push-test"]').hidden = st !== 'on';
        };
        pushBtn.addEventListener('click', async () => {
            pushBtn.disabled = true;
            if (pushBtn.dataset.state === 'on') { await A.push.disable(); toast('تم إيقاف الإشعارات على هذا الجهاز', 'info'); }
            else { const r = await A.push.enable(); toast(r.ok ? 'تم تفعيل الإشعارات ✓' : r.error, r.ok ? 'success' : 'error'); }
            paintPush();
        });
        body.querySelector('[data-act="push-test"]').addEventListener('click', async () => {
            try { const r = await A.push.test(); toast(r.sent ? 'أُرسل إشعار تجريبي ✓' : 'لم يتم الإرسال. أعد تفعيل الإشعارات.', r.sent ? 'success' : 'error'); }
            catch (err) { toast(errorText(err), 'error'); }
        });
        paintPush();

        // Devices
        const paintDevices = acc => {
            const n = acc.max_devices || 0;
            body.querySelector('[data-role="dev-lead"]').textContent = `الحد المسموح: ${!n ? 'غير محدود' : n === 1 ? 'جهاز واحد' : n + ' أجهزة'}.`;
            const ul = body.querySelector('[data-role="devices"]');
            const devices = [...(acc.devices || [])].sort((x, y) => (y.last || 0) - (x.last || 0));
            ul.innerHTML = devices.length ? devices.map(d => `<li data-device="${esc(d.id)}">
                    <i class="fas ${/iPhone|Android|iPad/.test(d.label || '') ? 'fa-mobile-screen' : 'fa-laptop'}"></i>
                    <span class="hp-dev-main"><b>${esc(d.label || 'جهاز')}</b>${d.id === acc.thisDevice ? ' <span class="hacc-chip">هذا الجهاز</span>' : ''}
                    <small>آخر نشاط ${esc(timeAgo(d.last || d.first))}</small></span>
                    <button type="button" class="hacc-btn sm danger" data-act="unlink">إلغاء الربط</button></li>`).join('')
                : '<li class="hacc-muted">لا توجد أجهزة.</li>';
            ul.querySelectorAll('[data-act="unlink"]').forEach(btn => btn.addEventListener('click', async () => {
                const id = btn.closest('li').dataset.device;
                const self = id === acc.thisDevice;
                if (!confirm(self ? 'إلغاء ربط هذا الجهاز؟ سيتم تسجيل خروجك منه.' : 'إلغاء ربط هذا الجهاز؟ سيتم تسجيل خروجه.')) return;
                try {
                    await Hub.api('POST', '/api/accounts/devices/remove', { deviceId: id }, { retries: 0 });
                    if (self) { Hub.auth.logout(); location.href = './index.html?portal=true'; return; }
                    acc.devices = acc.devices.filter(d => d.id !== id);
                    paintDevices(acc);
                } catch (err) { toast(errorText(err), 'error'); }
            }));
        };
        paintDevices(a);

        // Password
        const pw = body.querySelector('[data-role="pw-form"]');
        const pwMsg = body.querySelector('[data-role="pw-msg"]');
        pw.addEventListener('submit', async e => {
            e.preventDefault();
            const p = pw.new1.value;
            if (p.length < 8) { pwMsg.textContent = 'كلمة المرور الجديدة قصيرة (٨ أحرف على الأقل).'; pwMsg.style.color = 'var(--hacc-danger)'; return; }
            if (p !== pw.new2.value) { pwMsg.textContent = 'كلمتا المرور غير متطابقتين.'; pwMsg.style.color = 'var(--hacc-danger)'; return; }
            pwMsg.textContent = 'جاري الحفظ…'; pwMsg.style.color = '';
            try {
                const user = Hub.auth.getAccount().username;
                const [oldKey, newKey] = await Promise.all([Hub.auth.deriveAccountKey(user, pw.old.value), Hub.auth.deriveAccountKey(user, p)]);
                const res = await Hub.api('POST', '/api/accounts/password', { oldKey, newKey }, { retries: 0 });
                Hub.auth.replaceToken(res.token, res.exp);
                pw.reset();
                pwMsg.textContent = 'تم تغيير كلمة المرور ✓ وتم تسجيل الخروج من الأجهزة الأخرى.'; pwMsg.style.color = '#059669';
            } catch (err) {
                pwMsg.textContent = err && err.data && err.data.error === 'wrong_password' ? 'كلمة المرور الحالية غير صحيحة.' : errorText(err);
                pwMsg.style.color = 'var(--hacc-danger)';
            }
        });
    }

    window.HubPanel = { open };
})(window, document);
