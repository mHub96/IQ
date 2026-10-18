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
    // Accounts without a resident profile or "My Schedule": rotators and Administrative Affairs officers.
    const OFFICER_ROLES = ['aa_user', 'aa_admin'];
    const NO_PROFILE = ['rotator', ...OFFICER_ROLES];
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
    let portalNext = false; // open the ER preferences form once the schedule tab shows

    async function open(which = 'profile') {
        portalNext = which === 'portal';
        if (portalNext) which = 'schedule';
        tab = ['profile', 'schedule', 'comments', 'settings', 'admin'].includes(which) ? which : 'profile';
        const acc = Hub.auth.getAccount();
        const approver = ['owner', 'admin'].includes(Hub.auth.getRole());
        sheet = A.openSheet(`<header class="hacc-sheet-head hp-head">
                <div class="hp-who">
                    <span data-role="head-avatar">${acc ? A.avatarHtml(acc, 46) : '<span class="hacc-avatar"><i class="fas fa-user"></i></span>'}</span>
                    <div><h2>${esc(acc ? acc.name : (ROLE_NAMES[Hub.auth.getRole()] || 'حسابي'))}</h2>
                    <div class="hacc-muted">${acc ? `<span dir="ltr">@${esc(acc.username)}</span> · ${esc(ROLE_NAMES[acc.role] || acc.role)}` : 'مسجّل بكلمة المرور المشتركة'}</div></div>
                </div>
                <button type="button" class="hacc-icon-btn" data-act="close" aria-label="إغلاق">✕</button>
            </header>
            <div class="hacc-tabs" role="tablist">
                ${acc ? `<button type="button" role="tab" data-tab="profile">الملف الشخصي</button>
                ${!NO_PROFILE.includes(acc.role) ? '<button type="button" role="tab" data-tab="schedule">جدولي</button>' : ''}
                ${!OFFICER_ROLES.includes(acc.role) ? '<button type="button" role="tab" data-tab="comments">تعليقاتي</button>' : ''}` : ''}
                <button type="button" role="tab" data-tab="settings">الإعدادات</button>
                ${Hub.auth.isOwner() ? '<button type="button" role="tab" data-tab="admin">القطاع الإداري</button>' : approver ? '<button type="button" role="tab" data-tab="admin">لوحة الإدارة</button>' : ''}
            </div>
            <div class="hacc-sheet-body hp-body" data-role="body"><div class="hacc-empty">جاري التحميل…</div></div>
            <footer class="hp-foot">
                ${approver && !Hub.auth.isOwner() ? `<a class="hacc-btn sm" href="./scheduler.html?hospital=${encodeURIComponent((Hub.auth.getAdminHospitalIds() || [])[0] || '')}"><i class="fas fa-calendar-alt"></i> المجدول</a>` : ''}
                ${!acc ? '<a class="hacc-btn sm primary" href="./account.html#signup">إنشاء حساب شخصي</a>' : ''}
                <button type="button" class="hacc-btn sm danger" data-act="logout"><i class="fas fa-sign-out-alt"></i> خروج</button>
            </footer>`, { label: 'لوحة الحساب', tall: true });
        if (!acc && tab !== 'admin') tab = 'settings';
        if (tab === 'admin' && !approver) tab = acc ? 'profile' : 'settings';
        if (tab === 'schedule' && acc && NO_PROFILE.includes(acc.role)) tab = 'profile';
        if (tab === 'comments' && acc && OFFICER_ROLES.includes(acc.role)) tab = 'profile';
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
        if (window.HubMySchedule) window.HubMySchedule.detach();
        const portalForm = portalNext && which === 'schedule';
        portalNext = false;
        ({ profile: renderProfile, schedule: renderSchedule, comments: renderComments, settings: renderSettings, admin: renderAdmin })[which](body, portalForm);
    }

    // ------------------------------------------------------------------
    // My Schedule (hub-myschedule.js + .css, loaded on first use)
    // ------------------------------------------------------------------
    let scheduleLoading = null;
    function loadSchedule() {
        if (window.HubMySchedule) return Promise.resolve();
        const base = ((document.querySelector('script[src*="hub-panel.js"]') || {}).src || './').replace(/hub-panel\.js.*$/, '');
        const add = (tag, attrs) => new Promise((resolve, reject) => {
            const el = Object.assign(document.createElement(tag), attrs);
            el.onload = resolve;
            el.onerror = reject;
            document.head.appendChild(el);
        });
        return scheduleLoading = scheduleLoading || Promise.all([
            add('link', { rel: 'stylesheet', href: base + 'hub-myschedule.css' }),
            add('script', { src: base + 'hub-myschedule.js' }),
        ]).catch(err => { scheduleLoading = null; throw err; });
    }
    async function renderSchedule(body, portalForm) {
        body.innerHTML = '<div class="hacc-empty">جاري التحميل…</div>';
        try { await loadSchedule(); } catch (e) {
            body.innerHTML = '<div class="hacc-empty">تعذر التحميل. تحقق من الاتصال.</div>';
            return;
        }
        if (tab !== 'schedule' || !sheet || !body.isConnected) return;
        if (portalForm) window.HubMySchedule.openPortal(body); else window.HubMySchedule.render(body);
    }

    async function logout() {
        if (!confirm('تسجيل الخروج من هذا الجهاز؟')) return;
        // Turning push off is best effort: never let it hold up signing out.
        await Promise.race([A.push.disable().catch(() => {}), new Promise(r => setTimeout(r, 2500))]);
        Hub.auth.signOut();
    }

    // ------------------------------------------------------------------
    // Profile
    // ------------------------------------------------------------------
    function stageText(n) { return n ? `المرحلة ${STAGE_NAMES[n] || n}` : '—'; }

    /** Rotators and Administrative Affairs officers: no board, specialty or stage. */
    function renderBasicProfile(body, a) {
        const officer = OFFICER_ROLES.includes(a.role);
        body.innerHTML = `
            <div class="hp-avatar-card">
                ${A.avatarHtml(a, 96, 'hp-avatar-big')}
                <div><b>صورتك الرمزية</b><div class="hacc-muted">رسم كرتوني بدلاً من الصورة الشخصية</div>
                <button type="button" class="hacc-btn sm primary" data-act="edit-avatar" style="margin-top:8px">🎨 تعديل الصورة الرمزية</button></div>
            </div>
            <dl class="hp-kv">
                <dt>الاسم</dt><dd>${esc(a.name)}</dd>
                <dt>${officer ? 'المستشفى' : 'مستشفى الروتيشن'}</dt><dd>${esc(hospitalName(a.hosp))}</dd>
                ${officer ? `<dt>القسم</dt><dd>الشؤون الإدارية</dd><dt>العنوان الوظيفي</dt><dd>${esc(a.aa_job_name || '—')}</dd>` : ''}
                <dt>الصلاحية</dt><dd>${esc(ROLE_NAMES[a.role] || a.role)}</dd>
                <dt>الجنس</dt><dd>${esc(SEX[a.sex] || '—')}</dd>
                ${a.phone ? `<dt>الهاتف</dt><dd dir="ltr">${esc(localPhone(a.phone))}</dd>` : ''}
                <dt>عضو منذ</dt><dd>${esc(new Date(a.created_at).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' }))}</dd>
            </dl>
            <p class="hacc-muted">${officer
                ? 'الاسم والهاتف والعنوان الوظيفي مرتبطة بقاعدة بيانات الشؤون الإدارية؛ لتغييرها راجع مدير الشؤون الإدارية أو مدير المستشفى.'
                : 'حساب الروتيتر لتصفح الموقع والتواصل مع المقيمين. لتغيير الاسم أو المستشفى راجع مالك المنظومة.'}</p>`;
        body.querySelector('[data-act="edit-avatar"]').addEventListener('click', () => avatarEditor(body));
    }

    function renderProfile(body) {
        const a = me || Hub.auth.getAccount();
        if (!a) { body.innerHTML = ''; return; }
        if (NO_PROFILE.includes(a.role)) return renderBasicProfile(body, a);
        const specs = (Hub.getGlobalSpecialties ? Hub.getGlobalSpecialties() : []).map(s => s.name_ar).filter(Boolean);
        const years = a.board_years || '';
        const month = a.stage_month || 10;
        body.innerHTML = `
            <div class="hp-avatar-card">
                ${A.avatarHtml(a, 96, 'hp-avatar-big')}
                <div><b>صورتك الرمزية</b><div class="hacc-muted">رسم كرتوني بدلاً من الصورة الشخصية</div>
                <button type="button" class="hacc-btn sm primary" data-act="edit-avatar" style="margin-top:8px">🎨 تعديل الصورة الرمزية</button></div>
            </div>
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

        body.querySelector('[data-act="edit-avatar"]').addEventListener('click', () => avatarEditor(body));
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
                if (res.account.profile_complete) { const nudge = document.getElementById('hacc-nudge'); if (nudge) nudge.remove(); }
                toast(res.account.profile_complete ? 'تم حفظ ملفك ✓' : 'تم الحفظ. ما زالت بعض المعلومات ناقصة.', res.account.profile_complete ? 'success' : 'info');
                renderProfile(body);
            } catch (err) {
                const code = err && err.data && err.data.error;
                toast(({ stage_over_years: 'المرحلة أكبر من عدد سنوات البورد.', bad_stage: 'مرحلة غير صحيحة.', bad_years: 'عدد سنوات غير صحيح.' })[code] || errorText(err), 'error');
            }
        });
    }

    // ------------------------------------------------------------------
    // Avatar editor (cartoon parts from hub-avatar.js; nothing is uploaded)
    // ------------------------------------------------------------------
    function avatarEditor(body) {
        const HA = window.HubAvatar;
        const a = me || Hub.auth.getAccount();
        const sex = a.sex;
        let cfg = HA.forAccount(a);
        const parts = HA.PARTS.filter(p => !(p.male && sex === 'f'));
        let part = parts[1] || parts[0]; // start on hair
        body.innerHTML = `<div class="ae">
                <div class="ae-preview" data-role="preview"></div>
                <div class="ae-tools">
                    <button type="button" class="hacc-btn sm" data-act="random">🎲 عشوائي</button>
                    <button type="button" class="hacc-btn sm" data-act="cancel">إلغاء</button>
                    <button type="button" class="hacc-btn sm primary" data-act="save">حفظ</button>
                </div>
                <div class="ae-cats" role="tablist">${parts.map(p => `<button type="button" role="tab" data-part="${p.key}">${esc(p.label)}</button>`).join('')}</div>
                <div class="ae-colors" data-role="colors"></div>
                <div class="ae-grid" data-role="grid"></div>
            </div>`;
        const preview = body.querySelector('[data-role="preview"]');
        const grid = body.querySelector('[data-role="grid"]');
        const colors = body.querySelector('[data-role="colors"]');

        const paint = () => {
            preview.innerHTML = `<span class="hav-wrap" style="width:132px;height:132px">${HA.svg(cfg, 132, sex)}</span>`;
            body.querySelectorAll('[data-part]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.part === part.key)));
            // Colour row: the part's own palette (skin / background are colour-only parts).
            const palette = part.colors || part.palette;
            const colorKey = part.colors ? part.key : part.color;
            colors.innerHTML = palette ? palette.map((hex, i) => `<button type="button" class="ae-swatch" data-color="${i}" style="background:${hex}" aria-label="لون ${i + 1}" aria-pressed="${cfg[colorKey] === i}"></button>`).join('') : '';
            colors.hidden = !palette;
            colors.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { cfg = { ...cfg, [colorKey]: Number(b.dataset.color) }; paint(); }));
            // Colour-only parts (skin, headwear colour, background) preview on the figure itself; nothing else to pick.
            // Option grid: each option drawn on the current avatar.
            // Some options only show with another choice (shirt graphics need the graphic T-shirt).
            const need = part.requires || {};
            grid.innerHTML = part.options ? part.options.map((label, i) => `<button type="button" class="ae-opt" data-opt="${i}" aria-pressed="${cfg[part.key] === i}">
                    <span class="hav-wrap" style="width:64px;height:64px">${HA.svg({ ...cfg, ...need, [part.key]: i }, 64, sex)}</span><span>${esc(label)}</span></button>`).join('') : '';
            grid.hidden = !part.options;
            grid.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => { cfg = { ...cfg, ...need, [part.key]: Number(b.dataset.opt) }; paint(); }));
        };
        body.querySelectorAll('[data-part]').forEach(b => b.addEventListener('click', () => { part = parts.find(p => p.key === b.dataset.part); paint(); b.scrollIntoView({ inline: 'center', block: 'nearest' }); }));
        body.querySelector('[data-act="random"]').addEventListener('click', () => { cfg = HA.random(sex); paint(); });
        body.querySelector('[data-act="cancel"]').addEventListener('click', () => renderProfile(body));
        body.querySelector('[data-act="save"]').addEventListener('click', async e => {
            e.target.disabled = true;
            try {
                const res = await Hub.api('POST', '/api/accounts/avatar', { avatar: cfg }, { retries: 0 });
                me = { ...me, avatar: res.avatar };
                Hub.auth.refreshAccount({ ...Hub.auth.getAccount(), avatar: res.avatar }, Hub.auth.getRole(), Hub.auth.getAdminHospitalIds());
                A.refreshNavSlots();
                const head = sheet && sheet.querySelector('[data-role="head-avatar"]');
                if (head) head.innerHTML = A.avatarHtml(me, 46);
                toast('تم حفظ صورتك الرمزية ✓', 'success');
                renderProfile(body);
            } catch (err) {
                e.target.disabled = false;
                toast(errorText(err), 'error');
            }
        });
        paint();
        body.scrollTop = 0;
    }

    // ------------------------------------------------------------------
    // Administrative sector (owner): every owner tool in one place
    // ------------------------------------------------------------------
    /** A hospital admin's panel: their hospital's accounts and comments. */
    // Tiles shared by the owner's and the hospital admins' tabs: the per-hospital settings view and the
    // duty exchange requests.
    const HOSPITAL_TOOLS = [
        ['fa-sliders', 'إعدادات المستشفيات', 'التعليقات، والتعليق المجهول، وموافقة تبديل الخفارات لكل مستشفى', { view: 'hospital-settings' }],
        ['fa-right-left', 'طلبات تبديل الخفارات', 'الطلبات بانتظار موافقتك في المستشفيات التي فعّلت نظام الموافقة', { open: 'exchanges' }],
    ];
    function tileHtml([icon, label, sub, act]) {
        const inner = `<i class="fas ${icon}"></i><span><b>${label}</b><small>${sub}</small></span>`;
        if (act.href) return `<a class="hp-admin-tile" href="${act.href}">${inner}</a>`;
        if (act.view) return `<button type="button" class="hp-admin-tile" data-view="${act.view}">${inner}</button>`;
        if (act.open) return `<button type="button" class="hp-admin-tile" data-open="${act.open}">${inner}</button>`;
        return `<button type="button" class="hp-admin-tile" data-fn="${act.fn}">${inner}</button>`;
    }
    function bindTiles(body) {
        body.querySelectorAll('[data-fn]').forEach(b => b.addEventListener('click', () => A.adminAction(b.dataset.fn)));
        body.querySelectorAll('[data-view="hospital-settings"]').forEach(b => b.addEventListener('click', () => renderHospitalSettings(body)));
        body.querySelectorAll('[data-open="exchanges"]').forEach(b => b.addEventListener('click', () => { A.closeSheet(); setTimeout(() => A.openExchanges(), 260); }));
    }

    /** A hospital admin's panel: their hospital's accounts, comments and settings. */
    function renderHospitalAdmin(body) {
        const lead = `<a class="hp-admin-lead" href="./account.html#manage-all"><i class="fas fa-users-gear"></i><span><b>حسابات مستشفاي</b><small>مراجعة حسابات المقيمين: السماح بالتعليق أو منعه، وحذف الحساب</small></span><i class="fas fa-chevron-left"></i></a>`;
        const items = [
            ['fa-user-check', 'طلبات الحسابات', 'الموافقة على طلبات الحسابات الجديدة أو رفضها', { href: './account.html#manage' }],
            ['fa-key', 'طلبات كلمات المرور', 'السماح للأطباء بتغيير كلمات مرورهم', { href: './account.html#manage-resets' }],
            ['fa-comments', 'مراجعة التعليقات', 'تعليقات مستشفاك، مع الاسم الحقيقي للمجهولين', { href: './account.html#manage-comments' }],
        ];
        body.innerHTML = lead + `<section class="hp-section"><h3>الحسابات والتعليقات</h3><div class="hp-admin-grid">${items.map(tileHtml).join('')}</div></section>
            <section class="hp-section"><h3>المستشفى</h3><div class="hp-admin-grid">${HOSPITAL_TOOLS.map(tileHtml).join('')}</div></section>`;
        bindTiles(body);
    }

    /**
     * Per-hospital settings (owner: every hospital; an admin: their own), opened from the tab so the tab
     * stays short however many hospitals there are: commenting, anonymous commenting, exchange approval.
     */
    async function renderHospitalSettings(body) {
        body.scrollTop = 0;
        body.innerHTML = `<div class="hp-sub-head"><button type="button" class="hacc-btn sm" data-act="back"><i class="fas fa-chevron-right"></i> رجوع</button><h3>إعدادات المستشفيات</h3></div>
            <div class="hacc-empty">جاري التحميل…</div>`;
        body.querySelector('[data-act="back"]').addEventListener('click', () => show('admin'));
        let off = [], anonOff = [], approval = [], scope = [];
        try {
            const [c, x] = await Promise.all([
                Hub.api('GET', '/api/social/hospitals', undefined, { retries: 1 }),
                Hub.api('GET', '/api/exchange/settings', undefined, { retries: 1 }),
            ]);
            off = c.off || []; anonOff = c.anonOff || []; scope = c.scope || []; approval = x.on || [];
        } catch (err) {
            body.querySelector('.hacc-empty').textContent = errorText(err);
            return;
        }
        if (tab !== 'admin' || !body.isConnected) return;
        const hospitals = Hub.getHospitals().filter(h => scope.includes('*') || scope.includes(h.id));
        let query = '';
        const row = (h) => {
            const on = !off.includes(h.id), anon = !anonOff.includes(h.id), ap = approval.includes(h.id);
            const sw = (key, label, state, onText, offText) => `<span class="hp-switch-row"><span class="hp-switch-label">${label}</span>
                <span class="hacc-chip ${state ? 'on' : 'off'}">${state ? onText : offText}</span>
                <button type="button" class="hacc-btn sm ${state ? 'danger' : 'primary'}" data-act="${key}">${state ? 'إيقاف' : 'تفعيل'}</button></span>`;
            return `<li data-h="${esc(h.id)}"><span class="hp-switch-name">${esc(h.name_ar || h.hospitalName || h.id)}</span>
                ${sw('toggle', '💬 التعليقات', on, 'مفعّلة', 'متوقفة')}
                ${sw('toggle-anon', '🕶️ التعليق المجهول', anon, 'مسموح', 'متوقف')}
                ${sw('toggle-approval', '🔁 موافقة تبديل الخفارات', ap, 'مفعّلة', 'متوقفة')}</li>`;
        };
        const paint = () => {
            const list = hospitals.filter(h => !query || String(h.name_ar || h.hospitalName || h.id).includes(query));
            const box = body.querySelector('[data-role="hs-list"]');
            box.innerHTML = list.map(row).join('') || '<li class="hacc-muted">لا توجد مستشفيات مطابقة.</li>';
            box.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => toggle(btn)));
        };
        const toggle = async (btn) => {
            const h = btn.closest('li').dataset.h;
            const name = (hospitals.find(x => x.id === h) || {}).name_ar || h;
            const kind = btn.dataset.act;
            let path = '/api/social/hospitals', payload, confirmText = null, done;
            if (kind === 'toggle') {
                const on = off.includes(h);
                payload = { hosp: h, on };
                if (!on) confirmText = `إيقاف التعليقات في ${name}؟`;
                done = on ? 'تم تفعيل التعليقات ✓' : 'تم إيقاف التعليقات';
            } else if (kind === 'toggle-anon') {
                const anon = anonOff.includes(h);
                payload = { hosp: h, anon };
                if (!anon) confirmText = `إيقاف التعليق المجهول في ${name}؟ ستكون التعليقات الجديدة بالاسم الحقيقي فقط.`;
                done = anon ? 'تم السماح بالتعليق المجهول ✓' : 'تم إيقاف التعليق المجهول';
            } else {
                const on = !approval.includes(h);
                path = '/api/exchange/settings';
                payload = { hosp: h, on };
                confirmText = on
                    ? `تفعيل نظام موافقة التبديل في ${name}؟\n\nكل تبديل يطلبه مقيم يُرسل إلى صاحب الخفارة ليوافق، ثم إليك للموافقة، ولا يُثبَّت إلا بعد موافقة الإدارة.`
                    : `إيقاف نظام موافقة التبديل في ${name}؟ يعود التبديل حراً للجميع مباشرة.`;
                done = on ? 'تم تفعيل موافقة التبديل ✓' : 'أُوقف نظام الموافقة، والتبديل حر';
            }
            if (confirmText && !confirm(confirmText)) return;
            btn.disabled = true;
            try {
                const res = await Hub.api('POST', path, payload, { retries: 0 });
                if (path === '/api/exchange/settings') approval = res.on || [];
                else { off = res.off || off; anonOff = res.anonOff || anonOff; }
                toast(done, 'success');
                paint();
            } catch (err) { btn.disabled = false; toast(errorText(err), 'error'); }
        };
        body.innerHTML = `<div class="hp-sub-head"><button type="button" class="hacc-btn sm" data-act="back"><i class="fas fa-chevron-right"></i> رجوع</button><h3>إعدادات المستشفيات</h3></div>
            <p class="hacc-muted hp-switch-note">إيقاف التعليقات يمنع التعليق على بطاقات خفارات المستشفى${Hub.auth.isOwner() ? ' (عدا المالك)' : ''} وتبقى التعليقات السابقة. مع إيقاف «المجهول» تكون التعليقات الجديدة بالاسم الحقيقي. ومع «موافقة التبديل» يمر كل تبديل يطلبه مقيم بموافقة صاحب الخفارة ثم الإدارة.</p>
            ${hospitals.length > 4 ? '<input type="search" class="hp-hs-search" data-role="hs-search" placeholder="ابحث عن مستشفى…" aria-label="ابحث عن مستشفى">' : ''}
            <ul class="hp-switches" data-role="hs-list"></ul>`;
        body.querySelector('[data-act="back"]').addEventListener('click', () => show('admin'));
        const search = body.querySelector('[data-role="hs-search"]');
        if (search) search.addEventListener('input', debounce(() => { query = search.value.trim(); paint(); }, 150));
        paint();
    }

    function renderAdmin(body) {
        if (!Hub.auth.isOwner()) return renderHospitalAdmin(body);
        const lead = `<a class="hp-admin-lead" href="./account.html#manage-all"><i class="fas fa-users-gear"></i><span><b>إدارة الحسابات</b><small>كل الحسابات: الأدوار والمستشفيات والأجهزة والإيقاف</small></span><i class="fas fa-chevron-left"></i></a>`;
        const groups = [
            ['الحسابات', [
                ['fa-user-check', 'طلبات الحسابات والموافقات', 'موافقة ورفض وإدارة الحسابات والأجهزة', { href: './account.html#manage' }],
                ['fa-key', 'طلبات كلمات المرور', 'السماح للأطباء بتغيير كلمات مرورهم', { href: './account.html#manage-resets' }],
                ['fa-comments', 'مراجعة التعليقات', 'كل التعليقات في كل المستشفيات', { href: './account.html#manage-comments' }],
                ['fa-layer-group', 'ترقية المراحل السنوية', 'شهر ارتفاع مراحل المقيمين', { href: './account.html#manage-system' }],
            ]],
            ['المستشفيات', HOSPITAL_TOOLS],
            ['المنظومة', [
                ['fa-truck-medical', 'نظام خفارات الطوارئ (ER)', 'جداول وتوزيع خفارات الطوارئ', { href: './emergency.html' }],
                ['fa-plus-circle', 'إضافة مستشفى جديد', 'مستشفى جديد بكامل هيكليته', { fn: 'openAddHospitalModal' }],
                ['fa-crown', 'مستودع التخصصات العام', 'التخصصات المشتركة لكل المستشفيات', { fn: 'openGlobalSpecialtiesModal' }],
                ['fa-database', 'النسخ الاحتياطي الشامل', 'تنزيل واستعادة نسخة كاملة', { fn: 'openFullSystemBackupModal' }],
            ]],
            ['الصلاحيات', [
                ['fa-lock', 'كلمات المرور المشتركة', 'كلمات مرور المالك والمدراء والمستخدمين', { fn: 'openAllPasswordsModalNav' }],
            ]],
        ];
        body.innerHTML = lead + groups.map(([title, items]) => `<section class="hp-section"><h3>${title}</h3><div class="hp-admin-grid">${items.map(tileHtml).join('')}</div></section>`).join('');
        bindTiles(body);
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
                return head + `<li>${c.anon ? '<span class="hacc-avatar anon">🕶️</span>' : A.avatarHtml({ ...c, name: c.author }, 36)}
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
            <section class="hp-section" data-role="install-section" hidden>
                <h3>التطبيق</h3>
                <div class="hp-line"><span data-role="install-text"></span><button type="button" class="hacc-btn sm primary" data-act="install" hidden>تثبيت</button></div>
            </section>
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
                <h3>اسم المستخدم</h3>
                <p class="hacc-muted">الحالي: <b dir="ltr" data-role="uname">@${esc(a.username)}</b></p>
                <form class="hp-form" data-role="uname-form" novalidate>
                    <input name="username" dir="ltr" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24" placeholder="اسم المستخدم الجديد" />
                    <div class="hp-hint" data-role="uname-hint">٣–٢٤ حرفاً: أحرف إنجليزية صغيرة وأرقام و . و _</div>
                    <input name="password" type="password" dir="ltr" autocomplete="current-password" placeholder="كلمة المرور الحالية (للتأكيد)" />
                    <button type="submit" class="hacc-btn primary" disabled>تغيير اسم المستخدم</button>
                </form>
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

        // Install the app (Android / desktop: browser prompt; iPhone: Share > Add to Home Screen)
        const P = window.HubPWA;
        if (P) {
            const sec = body.querySelector('[data-role="install-section"]');
            const txt = body.querySelector('[data-role="install-text"]');
            const btn = body.querySelector('[data-act="install"]');
            if (P.installed()) { sec.hidden = false; txt.textContent = 'التطبيق مثبّت على هذا الجهاز ✓'; }
            else if (P.canPrompt()) { sec.hidden = false; txt.textContent = 'ثبّت التطبيق على الشاشة الرئيسية'; btn.hidden = false; }
            else if (P.isIos()) { sec.hidden = false; txt.textContent = 'أضف التطبيق إلى الشاشة الرئيسية'; btn.hidden = false; btn.textContent = 'الطريقة'; }
            btn.addEventListener('click', async () => {
                if (!P.canPrompt()) { HubAccounts.offerInstall(); return; }
                if (await P.install()) { txt.textContent = 'تم التثبيت ✓'; btn.hidden = true; }
            });
        }

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

        // Username (unique; checked live)
        const uf = body.querySelector('[data-role="uname-form"]');
        const uhint = body.querySelector('[data-role="uname-hint"]');
        const usave = uf.querySelector('button[type=submit]');
        let ufree = false;
        const setU = (t, color = '') => { uhint.textContent = t; uhint.style.color = color; };
        const checkU = debounce(async () => {
            const u = uf.username.value.trim().toLowerCase();
            ufree = false; usave.disabled = true;
            if (!u) return setU('٣–٢٤ حرفاً: أحرف إنجليزية صغيرة وأرقام و . و _');
            if (u === (me || a).username) return setU('هذا اسمك الحالي.');
            if (!/^[a-z0-9][a-z0-9._]{2,23}$/.test(u)) return setU('✗ أحرف إنجليزية صغيرة وأرقام و . و _ فقط (٣ أحرف على الأقل).', 'var(--hacc-danger)');
            setU('جاري التحقق…');
            try {
                const r = await Hub.api('GET', '/api/accounts/username?u=' + encodeURIComponent(u), undefined, { useToken: false, retries: 0 });
                if (uf.username.value.trim().toLowerCase() !== u) return;
                ufree = !!r.free;
                setU(r.free ? '✓ الاسم متاح' : '✗ هذا الاسم مستخدم، اختر اسماً آخر', r.free ? '#059669' : 'var(--hacc-danger)');
                usave.disabled = !(ufree && uf.password.value);
            } catch (err) { setU(errorText(err), 'var(--hacc-danger)'); }
        }, 400);
        uf.username.addEventListener('input', () => { const v = uf.username.value.toLowerCase().replace(/\s/g, ''); if (v !== uf.username.value) uf.username.value = v; checkU(); });
        uf.password.addEventListener('input', () => { usave.disabled = !(ufree && uf.password.value); });
        uf.addEventListener('submit', async e => {
            e.preventDefault();
            if (usave.disabled) return;
            usave.disabled = true;
            const oldName = (me || a).username, newName = uf.username.value.trim().toLowerCase();
            try {
                const [oldKey, newKey] = await Promise.all([Hub.auth.deriveAccountKey(oldName, uf.password.value), Hub.auth.deriveAccountKey(newName, uf.password.value)]);
                const res = await Hub.api('POST', '/api/accounts/rename', { username: newName, oldKey, newKey }, { retries: 0 });
                me = { ...me, username: res.username };
                Hub.auth.refreshAccount({ ...Hub.auth.getAccount(), username: res.username }, Hub.auth.getRole(), Hub.auth.getAdminHospitalIds());
                body.querySelector('[data-role="uname"]').textContent = '@' + res.username;
                const head = sheet && sheet.querySelector('.hp-who .hacc-muted span[dir="ltr"]');
                if (head) head.textContent = '@' + res.username;
                uf.reset(); setU('');
                toast('تم تغيير اسم المستخدم ✓ استخدمه في تسجيل الدخول القادم.', 'success');
            } catch (err) {
                const code = err && err.data && err.data.error;
                toast(({ wrong_password: 'كلمة المرور الحالية غير صحيحة.', username_taken: 'هذا الاسم أصبح مستخدماً.', bad_username: 'اسم مستخدم غير صالح.' })[code] || errorText(err), 'error');
                usave.disabled = false;
            }
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
                    if (self) { Hub.auth.signOut(); return; }
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
