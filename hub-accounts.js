/**
 * Personal accounts on every page: notification bell, notification panel, and likes / comments
 * on duty cards. Load after hub-core.js. Everything is rendered with escaped text only.
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    if (!Hub) {
        console.error('hub-accounts.js must be loaded after hub-core.js');
        return;
    }

    const POLL_MS = 60 * 1000;
    const SUMMARY_TTL_MS = 45 * 1000;
    const ROLE_NAMES = { owner: 'المالك', admin: 'مدير مستشفى', anaesthesia: 'مقيم تخدير', user: 'مقيم', rotator: 'روتيتر', aa_user: 'موظف الشؤون الإدارية', aa_admin: 'مدير الشؤون الإدارية' };

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const rtf = (() => { try { return new Intl.RelativeTimeFormat('ar', { numeric: 'auto' }); } catch (e) { return null; } })();

    function timeAgo(ts) {
        const s = Math.round((ts - Date.now()) / 1000);
        const abs = Math.abs(s);
        if (!rtf) return new Date(ts).toLocaleString('ar-IQ');
        if (abs < 60) return 'الآن';
        if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
        if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
        return new Date(ts).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
    }

    function isoToLocal(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
    }

    function hospitalName(id) {
        const h = Hub.getHospital && Hub.getHospital(id);
        return (h && (h.name_ar || h.hospitalName)) || id || '';
    }

    function toast(msg, type = 'info') {
        let host = document.getElementById('hacc-toasts');
        if (!host) {
            host = document.createElement('div');
            host.id = 'hacc-toasts';
            host.setAttribute('role', 'status');
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = `hacc-toast ${type}`;
        el.textContent = msg;
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
    }

    /** Round cartoon avatar of a person ({ avatar, sex, name }); initials if hub-avatar.js is missing. */
    function avatarHtml(person, size = 36, extraClass = '') {
        const p = person || {};
        if (window.HubAvatar) {
            const cfg = window.HubAvatar.forAccount({ avatar: p.avatar, sex: p.sex, name: p.name || p.author || p.username });
            return `<span class="hav-wrap ${extraClass}" style="width:${size}px;height:${size}px">${window.HubAvatar.svg(cfg, size, p.sex)}</span>`;
        }
        return `<span class="hacc-avatar ${extraClass}">${esc(String(p.name || p.author || '?').replace(/^د\.?\s*/, '').charAt(0))}</span>`;
    }

    const signedIn = () => Hub.auth.isLoggedIn();
    const account = () => Hub.auth.getAccount();
    const isApprover = () => ['owner', 'admin'].includes(Hub.auth.getRole());

    function errorText(err) {
        const code = err && err.data && err.data.error;
        return ({
            rate_limited: 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.',
            account_required: 'هذه الميزة تحتاج حساباً شخصياً.',
            forbidden: 'لا تملك صلاحية لهذا الإجراء.',
            unauthorized: 'انتهت الجلسة. سجّل الدخول مجدداً.',
            duty_closed: 'انتهى يوم هذه الخفارة؛ لا يمكن التفاعل معها الآن.',
            comments_off: 'التعليقات متوقفة في هذا المستشفى حالياً.',
            comment_blocked: 'تم إيقاف التعليق لحسابك من قبل الإدارة.',
            anon_off: 'التعليق المجهول متوقف في هذا المستشفى؛ يمكنك التعليق باسمك.',
        })[code] || 'تعذر الاتصال بالخادم. حاول مجدداً.';
    }

    // ------------------------------------------------------------------
    // Bottom sheet (used by the notification panel and the comment threads)
    // ------------------------------------------------------------------
    let openSheetEl = null;

    // Each open sheet adds one history entry, so the phone's back button / gesture closes it.
    let sheetHistory = false;
    let ignorePop = false;
    window.addEventListener('popstate', () => {
        if (ignorePop) { ignorePop = false; return; }
        if (openSheetEl) { sheetHistory = false; closeSheet(true); }
    });

    // Scroll lock that keeps the reader's place: overflow:hidden on <html> + <body> resets the page
    // to the top on pages whose body has overflow-x:hidden, so the body is pinned at its offset instead.
    let lockedY = null;
    let replacingSheet = false;
    let pinnedBars = [];
    function lockScroll() {
        if (lockedY !== null) return;
        lockedY = window.scrollY;
        // Sticky top bars would travel up with the pinned body; hold them where they are on screen.
        pinnedBars = [...document.querySelectorAll('.hub-nav-bar, body > .top')].filter(el => getComputedStyle(el).position === 'sticky').map(el => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            // A placeholder keeps the bar's space so the page does not shift under the sheet.
            const hold = document.createElement('div');
            hold.className = 'hacc-bar-hold';
            hold.style.height = (el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)) + 'px';
            el.before(hold);
            el._hold = hold;
            el.style.position = 'fixed';
            el.style.top = r.top + 'px';
            el.style.left = r.left + 'px';
            el.style.width = r.width + 'px';
            return el;
        });
        document.body.style.top = -lockedY + 'px';
        document.documentElement.classList.add('hacc-no-scroll');
    }
    function unlockScroll() {
        if (lockedY === null) return;
        const y = lockedY;
        lockedY = null;
        document.documentElement.classList.remove('hacc-no-scroll');
        document.body.style.top = '';
        pinnedBars.forEach(el => {
            el.style.position = el.style.top = el.style.left = el.style.width = '';
            if (el._hold) { el._hold.remove(); el._hold = null; }
        });
        pinnedBars = [];
        window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    }

    function openSheet(html, { label = '', onClose, tall = false } = {}) {
        const replacing = !!openSheetEl;
        replacingSheet = replacing;
        closeSheet(true);
        replacingSheet = false;
        if (!replacing && !sheetHistory) {
            try { history.pushState({ haccSheet: true }, ''); sheetHistory = true; } catch (e) {}
        }
        const wrap = document.createElement('div');
        wrap.className = 'hacc-sheet-backdrop';
        wrap.innerHTML = `<section class="hacc-sheet${tall ? ' tall' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
            <div class="hacc-sheet-grip" aria-hidden="true"></div>${html}</section>`;
        wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
        wrap._onClose = onClose;
        document.body.appendChild(wrap);
        lockScroll();
        requestAnimationFrame(() => wrap.classList.add('open'));
        openSheetEl = wrap;
        enableSwipeToClose(wrap.querySelector('.hacc-sheet'));
        return wrap.querySelector('.hacc-sheet');
    }

    function closeSheet(fromHistory) {
        if (!openSheetEl) return;
        const el = openSheetEl;
        openSheetEl = null;
        if (fromHistory !== true && sheetHistory) {
            sheetHistory = false;
            ignorePop = true;
            history.back();
        }
        // A sheet replacing this one keeps the lock (and the saved place).
        if (fromHistory !== true || !replacingSheet) unlockScroll();
        el.classList.remove('open');
        if (el._onClose) el._onClose();
        setTimeout(() => el.remove(), 250);
    }

    function enableSwipeToClose(sheet) {
        const grip = sheet.querySelector('.hacc-sheet-grip');
        let startY = null, dy = 0;
        grip.addEventListener('touchstart', e => { startY = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
        grip.addEventListener('touchmove', e => {
            if (startY === null) return;
            dy = Math.max(0, e.touches[0].clientY - startY);
            sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        grip.addEventListener('touchend', () => {
            sheet.style.transition = '';
            sheet.style.transform = '';
            if (dy > 90) closeSheet();
            startY = null;
        });
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

    // ------------------------------------------------------------------
    // A contact from the phone (name + number) into a form
    // ------------------------------------------------------------------
    const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

    /**
     * The browser's contact picker (Chrome / Edge on Android). It opens only from a top-level page, and
     * every page of the app runs in a frame of the app shell, so the shell's window opens it (the tap in
     * the frame counts for the shell's window too).
     */
    function contactsApi() {
        const ok = nav => !!(nav && nav.contacts && typeof nav.contacts.select === 'function');
        try { if (window.top !== window && ok(window.top.navigator)) return window.top.navigator.contacts; } catch (e) {}
        return ok(navigator) ? navigator.contacts : null;
    }

    /** "د. احمد علي 0780 123 4567" -> { name, tel } */
    function splitContactText(text) {
        const t = String(text || '');
        const m = t.match(/\+?\d[\d\s()-]{6,}\d/);
        const tel = m ? m[0].replace(/[\s()-]/g, '') : '';
        const name = (m ? t.replace(m[0], ' ') : t).replace(/[\n\r\t,;:|]+/g, ' ').replace(/\s+/g, ' ').trim();
        return { name, tel };
    }

    /**
     * Fills a form from one of the phone's contacts.
     * opts: { name: <input>, phone: <input>, file: <input type=file> for a vCard, apply(name, tel) }
     * Android (Chrome / Edge): the phone's contacts list. iPhone (Safari has no contact picker): the
     * keyboard's "AutoFill Contact" on the name field, a vCard file, or pasted text.
     */
    async function pickContact(opts) {
        const api = contactsApi();
        if (api) {
            try {
                const list = await api.select(['name', 'tel'], { multiple: false });
                if (list && list.length) opts.apply((list[0].name && list[0].name[0]) || '', (list[0].tel && list[0].tel[0]) || '');
                return; // nothing chosen: cancelled
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn('Contact picker:', err);
            }
        }
        contactFallback(opts);
    }

    function contactFallback(opts) {
        const sheet = openSheet(`<header class="hacc-sheet-head"><h2>إضافة من جهات الاتصال</h2></header>
            <div class="hacc-sheet-body hacc-contact">
                ${IS_IOS ? `<button type="button" class="hacc-btn primary" data-act="autofill"><i class="fas fa-address-book"></i> اختيار من جهات اتصال iPhone</button>
                    <p class="hacc-muted">تظهر لوحة المفاتيح على حقل الاسم: اضغط <b>«ملء تلقائي لجهة اتصال»</b> (AutoFill Contact) أو أيقونة جهات الاتصال فوق لوحة المفاتيح، ثم اختر الطبيب فيُملأ الاسم والرقم.</p>`
                    : '<p class="hacc-muted">هذا المتصفح لا يفتح جهات الاتصال مباشرة (تعمل على Chrome أو Edge في أندرويد). يمكنك اختيار ملف جهة اتصال أو لصق الاسم والرقم.</p>'}
                <button type="button" class="hacc-btn" data-act="file"><i class="fas fa-file-arrow-up"></i> اختيار ملف جهة اتصال (.vcf)</button>
                ${IS_IOS ? '<p class="hacc-muted">للحصول على الملف: جهات الاتصال ← الطبيب ← مشاركة جهة الاتصال ← حفظ في الملفات.</p>' : ''}
                <label class="hacc-contact-paste"><span>أو الصق الاسم والرقم</span>
                    <textarea rows="2" placeholder="د. احمد علي 07801234567"></textarea></label>
                <button type="button" class="hacc-btn" data-act="paste"><i class="fas fa-wand-magic-sparkles"></i> تعبئة الحقول</button>
            </div>`, { label: 'إضافة من جهات الاتصال' });
        const autofill = sheet.querySelector('[data-act="autofill"]');
        if (autofill) autofill.addEventListener('click', () => {
            // Safari offers "AutoFill Contact" on fields marked as a person's name / phone number.
            if (opts.name) opts.name.setAttribute('autocomplete', 'name');
            if (opts.phone) opts.phone.setAttribute('autocomplete', 'tel');
            const fields = [opts.name, opts.phone].filter(Boolean);
            const done = () => { fields.forEach(f => f.removeEventListener('change', done)); setTimeout(() => opts.apply(opts.name ? opts.name.value : '', opts.phone ? opts.phone.value : ''), 50); };
            fields.forEach(f => f.addEventListener('change', done));
            closeSheet();
            if (opts.name) { opts.name.focus(); opts.name.scrollIntoView({ block: 'center' }); }
        });
        sheet.querySelector('[data-act="file"]').addEventListener('click', () => {
            if (opts.file) opts.file.click();
            closeSheet();
        });
        sheet.querySelector('[data-act="paste"]').addEventListener('click', () => {
            const { name, tel } = splitContactText(sheet.querySelector('textarea').value);
            if (!name && !tel) { toast('الصق اسم الطبيب ورقم هاتفه أولاً.', 'error'); return; }
            closeSheet();
            opts.apply(name, tel);
        });
    }

    // Every page's pop-ups are bottom sheets on phones (hub-ios.css): swipe one down from its top
    // edge to close it, like iOS. Closing = a tap on the backdrop, which every page already handles.
    (function sheetSwipe() {
        const SHEET = '.modal-overlay > .modal-card, .modal-overlay > .hub-modal-card, .hub-modal-overlay > .modal-card, .hub-modal-overlay > .hub-modal-card';
        let card = null, startY = 0, dy = 0;
        document.addEventListener('touchstart', e => {
            if (window.innerWidth > 768) return;
            const c = e.target.closest && e.target.closest(SHEET);
            if (!c || c.scrollTop > 0) return;
            const top = c.getBoundingClientRect().top;
            if (e.touches[0].clientY - top > 56) return; // only from the grabber / title area
            card = c; startY = e.touches[0].clientY; dy = 0;
            card.style.transition = 'none';
        }, { passive: true });
        document.addEventListener('touchmove', e => {
            if (!card) return;
            dy = Math.max(0, e.touches[0].clientY - startY);
            card.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        document.addEventListener('touchend', () => {
            if (!card) return;
            const c = card; card = null;
            c.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
            if (dy > 90) {
                c.style.transform = 'translateY(100%)';
                setTimeout(() => {
                    const overlay = c.parentElement;
                    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    c.style.transform = ''; c.style.transition = '';
                }, 220);
            } else {
                c.style.transform = '';
                setTimeout(() => { c.style.transition = ''; }, 300);
            }
        });
    })();

    // ------------------------------------------------------------------
    // Notifications
    // ------------------------------------------------------------------
    const notif = { items: [], unread: null, pending: null, timer: null, loading: null };

    function bellCount() {
        const pending = notif.pending ? (notif.pending.accounts || 0) + (notif.pending.resets || 0) : 0;
        return (notif.unread || 0) + pending;
    }

    function paintBells() {
        const n = bellCount();
        document.querySelectorAll('.hacc-bell').forEach(b => {
            const badge = b.querySelector('.hacc-bell-count');
            badge.textContent = n > 99 ? '99+' : String(n);
            badge.hidden = n === 0;
            b.setAttribute('aria-label', n ? `الإشعارات (${n} جديدة)` : 'الإشعارات');
        });
        // Number on the installed app icon (supported on Android Chrome / desktop PWAs).
        try {
            if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
        } catch (e) {}
    }

    async function pollNotifications() {
        if (!signedIn()) return;
        if (notif.loading) return notif.loading;
        notif.loading = (async () => {
            try {
                const res = await Hub.api('GET', '/api/notifications', undefined, { retries: 0 });
                const hadUnread = notif.unread;
                notif.items = res.items || [];
                notif.unread = res.unread || 0;
                notif.pending = res.pending || null;
                paintBells();
                if (hadUnread !== null && notif.unread > hadUnread && document.visibilityState === 'visible' && notif.items[0] && !notif.items[0].seen) {
                    toast(describe(notif.items[0]).text, 'info');
                }
                if (openSheetEl && openSheetEl.dataset.kind === 'notifications') renderNotificationList(openSheetEl.querySelector('.hacc-sheet'));
            } catch (e) {
                // Offline or signed out: keep the last state.
            } finally {
                notif.loading = null;
            }
        })();
        return notif.loading;
    }

    function startPolling() {
        stopPolling();
        if (!signedIn()) { notif.items = []; notif.unread = null; notif.pending = null; paintBells(); return; }
        pollNotifications();
        notif.timer = setInterval(() => { if (onScreen()) pollNotifications(); }, POLL_MS);
    }

    function stopPolling() {
        if (notif.timer) clearInterval(notif.timer);
        notif.timer = null;
    }

    // In the app shell several pages stay loaded; only the one on screen checks for news.
    function onScreen() { return document.visibilityState === 'visible' && (!window.HubView || window.HubView.active); }
    document.addEventListener('visibilitychange', () => { if (onScreen()) pollNotifications(); });
    window.addEventListener('hub:view-shown', () => { if (signedIn()) pollNotifications(); });
    window.addEventListener('hub:auth-changed', () => { startPolling(); refreshNavSlots(); });

    /** Text, icon and action for one notification. */
    function describe(n) {
        const d = n.data || {};
        const others = d.count > 1 ? ` و${d.count - 1} ${d.count - 1 === 1 ? 'شخص آخر' : 'آخرين'}` : '';
        const when = d.d ? ` (${isoToLocal(d.d)})` : '';
        switch (n.type) {
            case 'like':
                return { icon: '❤️', text: `${d.last || 'أحدهم'}${others} أُعجب ببطاقة خفارتك${when}`, open: () => openThread({ h: d.h, d: isoToLocal(d.d), n: d.name }, 'likes') };
            case 'comment':
                return { icon: '💬', text: `${d.last || 'أحدهم'} علّق على بطاقة خفارتك${when}${d.text ? ': «' + d.text + '»' : ''}`, open: () => openThread({ h: d.h, d: isoToLocal(d.d), n: d.name }, 'comments') };
            case 'reply':
                return { icon: '↩️', text: `${d.last || 'أحدهم'} ردّ على تعليقك في بطاقة ${d.name || ''}${d.text ? ': «' + d.text + '»' : ''}`, open: () => openThread({ h: d.h, d: isoToLocal(d.d), n: d.name }, 'comments') };
            case 'signup_request':
                if (d.officer) return { icon: '🏢', text: `طلب حساب جديد في الشؤون الإدارية: ${d.name} (@${d.username}) – ${d.job || ''} – ${hospitalName(d.hosp)}${d.verified ? '' : ' ⚠️ غير موجود في قاعدة البيانات'}`, href: './account.html#manage' };
                return { icon: '🆕', text: `طلب حساب ${d.rotator ? 'روتيتر ' : ''}جديد: ${d.name} (@${d.username}) – ${hospitalName(d.hosp)}`, href: './account.html#manage' };
            case 'reset_request':
                return { icon: '🔑', text: `طلب إعادة تعيين كلمة المرور: ${d.name} (@${d.username})`, href: './account.html#manage-resets' };
            case 'account_approved':
                return { icon: '✅', text: 'تمت الموافقة على حسابك. أهلاً بك!' };
            case 'reset_approved':
                return { icon: '🔓', text: 'تمت الموافقة على طلب تغيير كلمة المرور.' };
            case 'role_changed':
                return { icon: '⭐', text: `تم تغيير صلاحياتك إلى: ${ROLE_NAMES[d.role] || d.role}` };
            case 'warning':
                return { icon: '⚠️', text: `تحذير من ${d.role === 'owner' ? 'المالك' : 'إدارة المستشفى'} بسبب تعليقك على بطاقة ${d.name || ''}${when}: «${d.text || ''}»${d.note ? ' – ' + d.note : ''}`, open: () => openThread({ h: d.h, d: isoToLocal(d.d), n: d.name }, 'comments') };
            case 'exchange_request':
                return { icon: '🔁', text: `${d.by || 'أحد الزملاء'} يطلب تبديل خفارتك يوم ${d.date || ''} (${hospitalName(d.h)}) إلى ${d.newName || ''}. اضغط للموافقة أو الرفض.`, open: () => openExchanges() };
            case 'exchange_admin':
                return { icon: '🔁', text: `طلب تبديل بانتظار موافقتك: ${d.date || ''} · ${d.oldName || ''} ← ${d.newName || ''}${d.ownerApproved ? ' (وافق صاحب الخفارة)' : ''}`, open: () => openExchanges() };
            case 'exchange_result': {
                const head = { approved: d.holder ? 'تم تبديل خفارتك' : 'تمت الموافقة وتبديل الخفارة', owner_approved: 'وافق صاحب الخفارة، والطلب بانتظار الإدارة', owner_rejected: 'رفض صاحب الخفارة طلب التبديل', admin_rejected: 'رفضت الإدارة طلب التبديل' }[d.step] || 'طلب التبديل';
                return { icon: d.step === 'approved' ? '✅' : d.step === 'owner_approved' ? '👍' : '❌', text: `${head}: ${d.date || ''} · ${d.oldName || ''} ← ${d.newName || ''}${d.note ? ' · «' + d.note + '»' : ''}`, open: () => openExchanges() };
            }
            case 'comments_barred':
                return { icon: '🚫', text: 'تم إيقاف التعليق لحسابك من قبل الإدارة.' };
            case 'comments_allowed':
                return { icon: '💬', text: 'أُعيد السماح بالتعليق لحسابك.' };
            case 'er_portal': {
                const mon = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'][Number(String(d.ym || '').slice(5))] || '';
                const until = d.closes ? new Date(d.closes).toLocaleString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' }) : '';
                return { icon: '🗓️', text: `${d.extended ? 'تم تمديد' : 'فُتحت'} بوابة رغبات خفارات الطوارئ لشهر ${mon} ${String(d.ym || '').slice(0, 4)}${until ? ' حتى ' + until : ''}. اضغط لتحديد رغباتك.`, open: () => openPanel('portal') };
            }
            case 'duty_reminder': {
                const at = d.start ? new Date(d.start).toLocaleString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' }) : '';
                return { icon: '⏰', text: `تذكير: خفارتك ${d.title ? '«' + d.title + '» ' : ''}${at ? 'تبدأ ' + at : 'قريباً'}${d.hospName ? ' (' + d.hospName + ')' : ''}.`, open: () => openPanel('schedule') };
            }
            default:
                return { icon: '🔔', text: 'إشعار جديد' };
        }
    }

    function openNotifications() {
        const sheet = openSheet(`<header class="hacc-sheet-head">
                <h2>الإشعارات</h2>
                <span class="hacc-notif-head-acts">
                    <button type="button" class="hacc-link" data-act="all-read">تعليم الكل كمقروء</button>
                    <button type="button" class="hacc-link danger" data-act="clear-all">مسح الكل</button>
                </span>
            </header>
            <div class="hacc-sheet-body" data-role="list"><div class="hacc-empty">جاري التحميل…</div></div>`, { label: 'الإشعارات' });
        openSheetEl.dataset.kind = 'notifications';
        sheet.querySelector('[data-act="all-read"]').addEventListener('click', markAllRead);
        sheet.querySelector('[data-act="clear-all"]').addEventListener('click', () => clearNotifications(null));
        renderNotificationList(sheet);
        pollNotifications();
    }

    function renderNotificationList(sheet) {
        const list = sheet.querySelector('[data-role="list"]');
        const parts = [];
        const p = notif.pending;
        if (p && p.exchanges) {
            parts.push(`<button type="button" class="hacc-pending" data-act="exchanges">
                <span class="hacc-pending-icon">🔁</span>
                <span>${p.exchanges} طلب تبديل خفارة بانتظار موافقتك</span>
                <span class="hacc-chevron" aria-hidden="true">‹</span></button>`);
        }
        if (p && (p.accounts || p.resets)) {
            parts.push(`<a class="hacc-pending" href="./account.html#manage">
                <span class="hacc-pending-icon">🛡️</span>
                <span>${p.accounts ? `${p.accounts} طلب حساب بانتظار الموافقة` : ''}${p.accounts && p.resets ? ' · ' : ''}${p.resets ? `${p.resets} طلب كلمة مرور` : ''}</span>
                <span class="hacc-chevron" aria-hidden="true">‹</span></a>`);
        }
        if (!account()) {
            parts.push(`<div class="hacc-cta">أنت مسجّل بكلمة مرور مشتركة. أنشئ حساباً شخصياً لتصلك إشعارات الإعجابات والتعليقات.
                <a class="hacc-btn primary sm" href="./account.html#signup">إنشاء حساب</a></div>`);
        }
        if (account() && push.state === 'off') {
            parts.push(`<div class="hacc-cta">🔔 فعّل الإشعارات على هذا الجهاز لتصلك حتى عندما يكون التطبيق مغلقاً.
                <button type="button" class="hacc-btn primary sm" data-act="push-on">تفعيل الإشعارات</button></div>`);
        }
        if (!notif.items.length && account()) parts.push('<div class="hacc-empty">لا توجد إشعارات بعد</div>');
        notif.items.forEach((n, i) => {
            const d = describe(n);
            parts.push(`<div class="hacc-notif-row"><button type="button" class="hacc-notif ${n.seen ? '' : 'unread'}" data-i="${i}">
                <span class="hacc-notif-icon" aria-hidden="true">${d.icon}</span>
                <span class="hacc-notif-main"><span class="hacc-notif-text">${esc(d.text)}</span>
                <time class="hacc-notif-time">${esc(timeAgo(n.ts))}</time></span></button>
                <button type="button" class="hacc-notif-del" data-del="${i}" aria-label="مسح هذا الإشعار" title="مسح">✕</button></div>`);
        });
        list.innerHTML = parts.join('');
        list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => clearNotifications([notif.items[Number(b.dataset.del)]])));
        const xBtn = list.querySelector('[data-act="exchanges"]');
        if (xBtn) xBtn.addEventListener('click', () => { closeSheet(); setTimeout(openExchanges, 260); });
        const pushBtn = list.querySelector('[data-act="push-on"]');
        if (pushBtn) pushBtn.addEventListener('click', async () => {
            pushBtn.disabled = true;
            const r = await enablePush();
            toast(r.ok ? 'تم تفعيل الإشعارات ✓' : r.error, r.ok ? 'success' : 'error');
            renderNotificationList(sheet);
        });
        list.querySelectorAll('.hacc-notif').forEach(btn => btn.addEventListener('click', () => {
            const n = notif.items[Number(btn.dataset.i)];
            const d = describe(n);
            if (!n.seen) markRead([n.nid]);
            if (d.href) { window.location.href = d.href; return; }
            if (d.open) { closeSheet(); setTimeout(d.open, 260); }
        }));
    }

    async function markRead(nids) {
        notif.items.forEach(n => { if (nids.includes(n.nid)) n.seen = 1; });
        notif.unread = notif.items.filter(n => !n.seen).length;
        paintBells();
        try { await Hub.api('POST', '/api/notifications/seen', { nids }, { retries: 0 }); } catch (e) {}
    }

    /** Removes the given notifications (null: all of them) from this account. */
    async function clearNotifications(items) {
        if (!items && notif.items.length && !confirm('مسح كل الإشعارات؟')) return;
        const gone = new Set((items || notif.items).map(n => n.nid));
        notif.items = notif.items.filter(n => !gone.has(n.nid));
        notif.unread = notif.items.filter(n => !n.seen).length;
        paintBells();
        if (openSheetEl && openSheetEl.dataset.kind === 'notifications') renderNotificationList(openSheetEl.querySelector('.hacc-sheet'));
        try { await Hub.api('POST', '/api/notifications/clear', items ? { nids: [...gone] } : {}, { retries: 1 }); } catch (e) { toast(errorText(e), 'error'); }
    }

    // ------------------------------------------------------------------
    // Duty exchange requests (hospitals with exchange approval on)
    // ------------------------------------------------------------------
    const XSTATUS = {
        owner_pending: ['⏳', 'بانتظار موافقة صاحب الخفارة'], admin_pending: ['🛡️', 'بانتظار موافقة الإدارة'],
        approved: ['✅', 'تمت الموافقة وتبديل الخفارة'], rejected: ['❌', 'مرفوض'], cancelled: ['↩️', 'ملغى'],
    };
    async function openExchanges() {
        const sheet = openSheet(`<header class="hacc-sheet-head">
                <div><h2>طلبات تبديل الخفارات</h2><div class="hacc-muted">الموافقة على الطلبات ومتابعة طلباتك</div></div>
                <button type="button" class="hacc-icon-btn" data-act="close" aria-label="إغلاق">✕</button>
            </header>
            <div class="hacc-sheet-body" data-role="list"><div class="hacc-empty">جاري التحميل…</div></div>`, { label: 'طلبات تبديل الخفارات' });
        openSheetEl.dataset.kind = 'exchanges';
        sheet.querySelector('[data-act="close"]').addEventListener('click', closeSheet);
        const list = sheet.querySelector('[data-role="list"]');
        let items = [];
        const card = (r, acts) => {
            const [icon, label] = XSTATUS[r.status] || ['🔁', r.status];
            const spec = (Hub.getSpecialtyName && Hub.getSpecialtyName(r.spec, r.hosp)) || r.spec;
            return `<article class="hx-card st-${esc(r.status)}" data-id="${r.id}">
                <div class="hx-top"><b>${esc(r.date)}</b> · ${esc(spec)} · <span class="hacc-muted">${esc(hospitalName(r.hosp))}</span></div>
                <div class="hx-swap"><span>${esc(r.oldName)}</span><i class="fas fa-arrow-left"></i><span>${esc(r.newName)}</span></div>
                <div class="hx-meta">${r.mine ? 'طلبك' : `طلب ${esc(r.requester || '')}`} · ${esc(timeAgo(r.created))}</div>
                <div class="hx-status">${icon} ${esc(label)}${r.ownerNote ? ` · صاحب الخفارة: «${esc(r.ownerNote)}»` : ''}${r.note ? ` · الإدارة: «${esc(r.note)}»` : ''}</div>
                ${acts ? `<div class="hx-acts">${acts}</div>` : ''}
            </article>`;
        };
        const paint = () => {
            const mineToDecide = items.filter(r => r.canOwnerDecide);
            const adminToDecide = items.filter(r => r.canAdminDecide);
            const mine = items.filter(r => r.mine);
            const recent = items.filter(r => !r.mine && !r.canOwnerDecide && !r.canAdminDecide);
            const decide = '<button type="button" class="hacc-btn sm primary" data-act="approve">موافقة</button><button type="button" class="hacc-btn sm danger" data-act="reject">رفض</button>';
            const section = (title, arr, acts) => arr.length ? `<h3 class="hx-h">${title} <span class="hacc-chip">${arr.length}</span></h3>${arr.map(r => card(r, acts(r))).join('')}` : '';
            const html = section('بانتظار موافقتك على خفارتك', mineToDecide, () => decide)
                + section('بانتظار موافقة الإدارة', adminToDecide, () => decide)
                + section('طلباتي', mine, r => r.canCancel ? '<button type="button" class="hacc-btn sm" data-act="cancel">إلغاء الطلب</button>' : '')
                + section('طلبات أخرى حديثة', recent, () => '');
            list.innerHTML = html || '<div class="hacc-empty">لا توجد طلبات تبديل.</div>';
            list.querySelectorAll('.hx-card [data-act]').forEach(b => b.addEventListener('click', () => act(Number(b.closest('.hx-card').dataset.id), b.dataset.act, b)));
        };
        const act = async (id, what, btn) => {
            const r = items.find(x => x.id === id);
            let note = '';
            if (what === 'reject') {
                const t = prompt('سبب الرفض (يصل إلى صاحب الطلب):', '');
                if (t === null) return;
                note = t.trim();
            } else if (what === 'approve') {
                if (!confirm(r.canAdminDecide ? `الموافقة وتثبيت التبديل الآن؟\n${r.date}: ${r.oldName} ← ${r.newName}` : `الموافقة على تبديل خفارتك يوم ${r.date} إلى ${r.newName}؟\nيُرسل بعدها إلى الإدارة.`)) return;
            } else if (what === 'cancel' && !confirm('إلغاء طلب التبديل؟')) return;
            btn.disabled = true;
            try {
                if (what === 'cancel') await Hub.api('POST', '/api/exchange/cancel', { id }, { retries: 0 });
                else await Hub.api('POST', '/api/exchange/decide', { id, approve: what === 'approve', note }, { retries: 0 });
                toast({ approve: r.canAdminDecide ? 'تم تثبيت التبديل ✓' : 'تمت موافقتك، والطلب عند الإدارة ✓', reject: 'تم رفض الطلب', cancel: 'تم إلغاء الطلب' }[what], 'success');
                if (what === 'approve' && r.canAdminDecide && Hub.loadDatabase) Hub.loadDatabase(true).catch(() => {});
                await load();
                pollNotifications();
            } catch (err) {
                btn.disabled = false;
                const code = err && err.data && err.data.error;
                toast(({ duty_changed: 'تغيّرت هذه الخفارة في الجدول؛ رُفض الطلب تلقائياً.', already_decided: 'سبق اتخاذ قرار في هذا الطلب.' })[code] || errorText(err), 'error');
                if (code) load();
            }
        };
        const load = async () => {
            try {
                items = (await Hub.api('GET', '/api/exchange', undefined, { retries: 1 })).requests || [];
                if (openSheetEl && openSheetEl.dataset.kind === 'exchanges') paint();
            } catch (err) { list.innerHTML = `<div class="hacc-empty">${esc(errorText(err))}</div>`; }
        };
        await load();
    }

    async function markAllRead() {
        notif.items.forEach(n => { n.seen = 1; });
        notif.unread = 0;
        paintBells();
        if (openSheetEl) renderNotificationList(openSheetEl.querySelector('.hacc-sheet'));
        try { await Hub.api('POST', '/api/notifications/seen', {}, { retries: 0 }); } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Navigation buttons (bell + account)
    // ------------------------------------------------------------------
    function navButtons() {
        if (!signedIn()) {
            return `<a class="hacc-nav-btn hacc-nav-account" href="./account.html" title="حسابي" aria-label="حسابي"><i class="fas fa-user-circle"></i></a>`;
        }
        const acc = account();
        const initial = acc ? avatarHtml(acc, 34) : '<i class="fas fa-user"></i>';
        return `<button type="button" class="hacc-nav-btn hacc-bell" onclick="HubAccounts.openNotifications()" aria-label="الإشعارات">
                <i class="fas fa-bell"></i><span class="hacc-bell-count" hidden>0</span></button>
            <button type="button" class="hacc-nav-btn hacc-nav-account ${acc ? 'has-account has-avatar' : ''}" onclick="HubAccounts.openPanel()" title="${acc ? esc(acc.name) : 'حسابي والإعدادات'}" aria-label="حسابي والإعدادات">${initial}${acc && acc.profile_complete === false ? '<span class="hacc-dot" aria-label="الملف غير مكتمل"></span>' : ''}</button>`;
    }

    // ------------------------------------------------------------------
    // Account panel (hub-panel.js, loaded on first use)
    // ------------------------------------------------------------------
    let panelLoading = null;
    function openPanel(tab) {
        if (!window.HubPanel) {
            panelLoading = panelLoading || new Promise((resolve, reject) => {
                const el = document.createElement('script');
                const self = document.querySelector('script[src*="hub-accounts.js"]');
                el.src = (self ? self.src.replace(/hub-accounts\.js.*$/, '') : './') + 'hub-panel.js';
                el.onload = resolve;
                el.onerror = () => { panelLoading = null; reject(new Error('panel')); };
                document.head.appendChild(el);
            });
            return panelLoading.then(() => window.HubPanel.open(tab)).catch(() => toast('تعذر فتح لوحة الحساب. تحقق من الاتصال.', 'error'));
        }
        return window.HubPanel.open(tab);
    }

    /** Once a day, remind accounts with an incomplete profile (board, specialty, stage). */
    function nudgeProfile() {
        const acc = account();
        if (!acc || acc.profile_complete !== false || document.getElementById('hacc-nudge')) return;
        const today = new Date().toDateString();
        try { if (localStorage.getItem('hacc_nudge_day') === today) return; } catch (e) {}
        const el = document.createElement('div');
        el.id = 'hacc-nudge';
        el.setAttribute('role', 'status');
        el.innerHTML = `<span class="hacc-nudge-icon" aria-hidden="true">📝</span>
            <span class="hacc-nudge-text"><b>أكمل ملفك الشخصي</b><br>نوع البورد، الاختصاص، المرحلة وسنوات البورد.</span>
            <button type="button" class="hacc-btn sm primary" data-act="go">إكمال</button>
            <button type="button" class="hacc-icon-btn" data-act="later" aria-label="لاحقاً">✕</button>`;
        const done = () => { try { localStorage.setItem('hacc_nudge_day', today); } catch (e) {} el.remove(); };
        el.querySelector('[data-act="go"]').addEventListener('click', () => { done(); openPanel('profile'); });
        el.querySelector('[data-act="later"]').addEventListener('click', done);
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
    }

    function refreshNavSlots() {
        document.querySelectorAll('[data-hacc-slot]').forEach(slot => { slot.innerHTML = navButtons(); });
        paintBells();
    }

    // Pages render their own headers; any element with data-hacc-slot gets the buttons.
    const slotObserver = new MutationObserver(muts => {
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                const slots = node.matches && node.matches('[data-hacc-slot]') ? [node] : node.querySelectorAll ? node.querySelectorAll('[data-hacc-slot]') : [];
                slots.forEach(s => { if (!s.firstChild) s.innerHTML = navButtons(); });
                if (slots.length) paintBells();
            }
        }
    });

    // ------------------------------------------------------------------
    // Profile refresh: role changes made by an approver apply without signing in again
    // ------------------------------------------------------------------
    async function refreshProfile() {
        if (!account()) return;
        try {
            const res = await Hub.api('GET', '/api/accounts/me', undefined, { retries: 0 });
            if (res && res.account) {
                const before = (account() || {}).profile_complete;
                Hub.auth.refreshAccount(res.account, res.role, res.adminHospitals);
                if (before !== res.account.profile_complete) refreshNavSlots();
                setTimeout(nudgeProfile, 2500);
            }
        } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Likes and comments on duty cards
    // ------------------------------------------------------------------
    const summaryCache = new Map(); // "<h>|<d>" -> { at, cards, canReact, pending }

    function cardKey(c) { return `${c.h}|${c.d}|${c.n}`; }

    async function fetchSummary(h, d, names, force) {
        const key = `${h}|${d}`;
        const cached = summaryCache.get(key);
        const missing = names.filter(n => !(cached && n in cached.cards));
        if (cached && !force && !missing.length && Date.now() - cached.at < SUMMARY_TTL_MS) return cached;
        if (cached && cached.pending) return cached.pending;
        const q = new URLSearchParams({ h, d });
        names.slice(0, 60).forEach(n => q.append('n', n));
        const pending = Hub.api('GET', '/api/social?' + q, undefined, { retries: 1 }).then(res => {
            const entry = { at: Date.now(), cards: res.cards || {}, canReact: !!res.canReact };
            names.forEach(n => { if (!(n in entry.cards)) entry.cards[n] = { likes: 0, comments: 0, mine: false }; });
            summaryCache.set(key, entry);
            return entry;
        }).finally(() => { const c = summaryCache.get(key); if (c) c.pending = null; });
        if (cached) cached.pending = pending;
        else summaryCache.set(key, { at: 0, cards: {}, canReact: false, pending });
        return pending;
    }

    function socialBarHtml(card, s) {
        const likes = s ? s.likes : 0, comments = s ? s.comments : 0, mine = s && s.mine;
        return `<button type="button" class="hacc-act like ${mine ? 'on' : ''}" data-act="like" aria-pressed="${mine ? 'true' : 'false'}"
                    aria-label="${mine ? 'إلغاء الإعجاب' : 'إعجاب'}${likes ? ' (' + likes + ')' : ''}" title="إعجاب">
                <i class="${mine ? 'fa-solid' : 'fa-regular'} fa-heart" aria-hidden="true"></i>${likes ? `<span class="hacc-act-n">${likes > 99 ? '99+' : likes}</span>` : ''}</button>
            <button type="button" class="hacc-act comment" data-act="comment" aria-label="التعليقات${comments ? ' (' + comments + ')' : ''}" title="التعليقات">
                <i class="fa-regular fa-comment" aria-hidden="true"></i>${comments ? `<span class="hacc-act-n">${comments > 99 ? '99+' : comments}</span>` : ''}</button>`;
    }

    /**
     * Adds the like / comment bar to roster cards.
     * cards: [{ el, h, d, n }] where el is the element the bar is appended to, h the hospital id,
     * d the duty date (DD/MM/YYYY) and n the resident's name as shown on the card.
     */
    async function decorate(cards) {
        if (!cards.length || !signedIn()) return;
        const groups = new Map();
        for (const c of cards) {
            let bar = c.el.querySelector(':scope > .hacc-acts');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'hacc-acts';
                bar.setAttribute('role', 'group');
                bar.setAttribute('aria-label', 'التفاعل مع البطاقة');
                bar.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
                bar.addEventListener('click', e => e.stopPropagation());
                bar.addEventListener('mousemove', e => e.stopPropagation());
                c.el.insertBefore(bar, c.el.firstChild);
            }
            bar._card = { h: c.h, d: c.d, n: c.n };
            const key = `${c.h}|${c.d}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(bar);
            // Paint immediately from the cache so a re-render never flickers.
            const cached = summaryCache.get(key);
            if (!bar.firstChild || cached) paintBar(bar, cached && cached.cards[c.n], cached ? cached.canReact : !!account());
        }
        for (const [key, bars] of groups) {
            const [h, d] = key.split('|');
            try {
                const res = await fetchSummary(h, d, bars.map(b => b._card.n));
                bars.forEach(b => b.isConnected && paintBar(b, res.cards[b._card.n], res.canReact));
            } catch (e) { /* counts stay hidden while offline */ }
        }
    }

    function paintBar(bar, s, canReact) {
        bar.innerHTML = socialBarHtml(bar._card, s, canReact);
        bar.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const act = btn.dataset.act;
            if (act === 'like') toggleLike(bar);
            else openThread(bar._card, 'comments', true);
        }));
    }

    function requireAccount() {
        if (account()) return true;
        const sheet = openSheet(`<div class="hacc-sheet-body hacc-center">
            <div class="hacc-big-icon">👤</div>
            <h2>الإعجاب والتعليق يحتاجان حساباً شخصياً</h2>
            <p class="hacc-muted">أنت مسجّل حالياً بكلمة المرور المشتركة. أنشئ حسابك (باسمك ورقم هاتفك المسجّل في الجدول) أو سجّل دخولك إليه.</p>
            <div class="hacc-row">
                <a class="hacc-btn primary" href="./account.html#signup">إنشاء حساب</a>
                <a class="hacc-btn" href="./account.html#signin">تسجيل الدخول</a>
            </div></div>`, { label: 'حساب شخصي مطلوب' });
        return !sheet;
    }

    async function toggleLike(bar) {
        if (!requireAccount()) return;
        const card = bar._card;
        const entry = summaryCache.get(`${card.h}|${card.d}`);
        const s = (entry && entry.cards[card.n]) || { likes: 0, comments: 0, mine: false };
        const on = !s.mine;
        // Optimistic update, rolled back if the server refuses.
        const before = { ...s };
        s.mine = on;
        s.likes = Math.max(0, s.likes + (on ? 1 : -1));
        if (entry) entry.cards[card.n] = s;
        paintBar(bar, s, true);
        if (on) bar.querySelector('.hacc-act.like')?.classList.add('pop');
        if (navigator.vibrate && on) navigator.vibrate(12);
        try {
            const res = await Hub.api('POST', '/api/social/like', { ...card, on }, { retries: 1 });
            s.likes = res.likes;
            s.mine = res.mine;
        } catch (err) {
            Object.assign(s, before);
            toast(errorText(err), 'error');
        }
        syncBars(card, s);
    }

    /** Same card may be visible more than once (e.g. after a re-render): keep them in step. */
    function syncBars(card, s) {
        document.querySelectorAll('.hacc-acts').forEach(b => {
            if (b._card && cardKey(b._card) === cardKey(card)) paintBar(b, s, true);
        });
    }

    async function openThread(card, tab = 'comments', focusComposer = false) {
        const canReact = !!account();
        const sheet = openSheet(`<header class="hacc-sheet-head">
                <div><h2>${esc(card.n)}</h2><div class="hacc-muted">${esc(hospitalName(card.h))} · ${esc(card.d)}</div></div>
                <button type="button" class="hacc-icon-btn" data-act="close" aria-label="إغلاق">✕</button>
            </header>
            <div class="hacc-tabs" role="tablist">
                <button type="button" role="tab" data-tab="comments" aria-selected="${tab === 'comments'}">التعليقات <span data-role="nc"></span></button>
                <button type="button" role="tab" data-tab="likes" aria-selected="${tab === 'likes'}">الإعجابات <span data-role="nl"></span></button>
            </div>
            <div class="hacc-sheet-body" data-role="body"><div class="hacc-empty">جاري التحميل…</div></div>
            ${canReact ? `<form class="hacc-composer" data-role="composer" ${tab === 'likes' ? 'hidden' : ''}>
                <div class="hacc-replying" data-role="replying" hidden>
                    <span>↩️ الرد على <bdi data-role="reply-name"></bdi></span>
                    <button type="button" class="hacc-icon-btn sm" data-act="cancel-reply" aria-label="إلغاء الرد">✕</button>
                </div>
                <div class="hacc-identity" role="radiogroup" aria-label="التعليق باسم">
                    <label><input type="radio" name="hacc-as" value="real" checked> <span>باسمي</span></label>
                    <label><input type="radio" name="hacc-as" value="anon"> <span>🕶️ <bdi data-role="anon-label">${esc((account() || {}).anon_tag || 'مجهول')}</bdi></span></label>
                    <button type="button" class="hacc-link" data-act="nick" title="تغيير اللقب المجهول من الإعدادات">تغيير اللقب</button>
                </div>
                <div class="hacc-compose-row">
                    <textarea rows="1" maxlength="600" placeholder="اكتب تعليقاً…" aria-label="تعليق" required></textarea>
                    <button type="submit" class="hacc-send" aria-label="إرسال">➤</button>
                </div>
            </form>` : `<div class="hacc-composer hacc-cta">للتعليق والإعجاب <a href="./account.html#signup">أنشئ حساباً شخصياً</a></div>`}`,
            { label: 'التعليقات والإعجابات' });

        let data = null;
        let current = tab;
        let replyTo = null;
        const body = sheet.querySelector('[data-role="body"]');
        const composer = sheet.querySelector('[data-role="composer"]');
        sheet.querySelector('[data-act="close"]').addEventListener('click', closeSheet);

        const render = () => {
            sheet.querySelector('[data-role="nc"]').textContent = data ? `(${data.comments.length})` : '';
            sheet.querySelector('[data-role="nl"]').textContent = data ? `(${data.likes.length})` : '';
            sheet.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === current)));
            if (composer) composer.hidden = current !== 'comments';
            if (!data) return;
            if (current === 'likes') {
                body.innerHTML = data.likes.length
                    ? `<ul class="hacc-people">${data.likes.map(l => `<li>${avatarHtml(l, 36)}
                        <span class="hacc-person-name">${esc(l.name)}${l.mine ? ' <span class="hacc-chip">أنت</span>' : ''}</span>
                        <span class="hacc-heart-dot" aria-hidden="true">❤</span></li>`).join('')}</ul>`
                    : '<div class="hacc-empty">لا إعجابات بعد. كن أول من يُعجب ❤️</div>';
            } else {
                const canReply = !!composer && composer.isConnected && data.open !== false;
                const ids = new Set(data.comments.map(c => c.cid));
                const roots = data.comments.filter(c => !c.parent || !ids.has(c.parent));
                const repliesOf = cid => data.comments.filter(c => c.parent === cid && ids.has(cid));
                const item = (c, size) => `<li data-cid="${c.cid}">
                        ${c.anon ? `<span class="hacc-avatar anon" style="width:${size}px;height:${size}px">🕶️</span>` : avatarHtml({ ...c, name: c.author }, size)}
                        <div class="hacc-bubble-wrap">
                          <div class="hacc-bubble"><div class="hacc-author">${esc(c.author)}${c.mine ? ' <span class="hacc-chip">أنت</span>' : ''}</div>
                          <div class="hacc-text">${esc(c.body)}</div></div>
                          <div class="hacc-meta"><time>${esc(timeAgo(c.ts))}</time>${c.edited ? '<span>معدّل</span>' : ''}
                          ${c.realName ? `<span class="hacc-reveal" title="الاسم الحقيقي: ظاهر للإدارة فقط">👁 ${esc(c.realName)}</span>` : ''}
                          ${c.warned ? '<span class="hacc-warned" title="تم تحذير الكاتب">⚠️ حُذّر</span>' : ''}
                          ${canReply ? '<button type="button" class="hacc-link" data-act="reply">ردّ</button>' : ''}
                          ${c.canEdit ? '<button type="button" class="hacc-link" data-act="edit">تعديل</button>' : ''}
                          ${c.canWarn ? `<button type="button" class="hacc-link warn" data-act="warn">تحذير</button>` : ''}
                          ${c.canDelete ? '<button type="button" class="hacc-link danger" data-act="delete">حذف</button>' : ''}</div>
                        </div>`;
                body.innerHTML = data.comments.length
                    ? `<ul class="hacc-comments">${roots.map(c => {
                        const kids = repliesOf(c.cid);
                        return item(c, 36) + (kids.length ? `<ul class="hacc-replies">${kids.map(k => item(k, 28) + '</li>').join('')}</ul>` : '') + '</li>';
                    }).join('')}</ul>`
                    : '<div class="hacc-empty">لا تعليقات بعد. اكتب أول تعليق 💬</div>';
                body.querySelectorAll('[data-act="reply"]').forEach(btn => btn.addEventListener('click', () => startReply(Number(btn.closest('li').dataset.cid))));
                body.querySelectorAll('[data-act="delete"]').forEach(btn => btn.addEventListener('click', () => removeComment(Number(btn.closest('li').dataset.cid))));
                body.querySelectorAll('[data-act="edit"]').forEach(btn => btn.addEventListener('click', () => editComment(btn.closest('li'))));
                body.querySelectorAll('[data-act="warn"]').forEach(btn => btn.addEventListener('click', () => warnAuthor(Number(btn.closest('li').dataset.cid))));
                if (!keepScroll) body.scrollTop = body.scrollHeight;
                keepScroll = false;
            }
        };
        let keepScroll = false;

        const setReplyTo = c => {
            replyTo = c || null;
            if (!composer) return;
            const banner = composer.querySelector('[data-role="replying"]');
            banner.hidden = !replyTo;
            if (replyTo) banner.querySelector('[data-role="reply-name"]').textContent = replyTo.author;
            composer.querySelector('textarea').placeholder = replyTo ? 'اكتب ردّاً…' : 'اكتب تعليقاً…';
        };
        const startReply = cid => {
            const c = data && data.comments.find(x => x.cid === cid);
            if (!c || !composer) return;
            setReplyTo(c);
            const ta = composer.querySelector('textarea');
            ta.focus();
        };

        const load = async () => {
            try {
                data = await Hub.api('GET', '/api/social/thread?' + new URLSearchParams(card), undefined, { retries: 1 });
                if (composer && data.myAnonTag) composer.querySelector('[data-role="anon-label"]').textContent = data.myAnonTag;
                if (composer && data.open === false) {
                    // Another day's card: read-only (likes and comments belong to that duty day).
                    composer.outerHTML = '<div class="hacc-composer hacc-cta">🔒 انتهى يوم هذه الخفارة؛ التعليقات للقراءة فقط.</div>';
                } else if (composer && data.canComment === false) {
                    composer.outerHTML = `<div class="hacc-composer hacc-cta">${data.blocked === 'comments_off' ? '🔕 التعليقات متوقفة في هذا المستشفى حالياً.' : '🚫 تم إيقاف التعليق لحسابك من قبل الإدارة.'}</div>`;
                } else if (composer && data.anonAllowed === false) {
                    // Anonymous commenting is off in this hospital: comments carry the real name.
                    const anonLabel = composer.querySelector('input[name="hacc-as"][value="anon"]').closest('label');
                    composer.querySelector('input[name="hacc-as"][value="real"]').checked = true;
                    anonLabel.hidden = true;
                    composer.querySelector('[data-act="nick"]').hidden = true;
                }
                render();
                updateCounts();
            } catch (err) {
                body.innerHTML = `<div class="hacc-empty">${esc(errorText(err))}</div>`;
            }
        };

        const updateCounts = () => {
            const entry = summaryCache.get(`${card.h}|${card.d}`);
            if (!entry || !data) return;
            const s = entry.cards[card.n] || (entry.cards[card.n] = { likes: 0, comments: 0, mine: false });
            s.likes = data.likes.length;
            s.comments = data.comments.length;
            s.mine = data.likes.some(l => l.mine);
            syncBars(card, s);
        };

        const editComment = li => {
            const cid = Number(li.dataset.cid);
            const c = data.comments.find(x => x.cid === cid);
            const textEl = li.querySelector('.hacc-text');
            textEl.innerHTML = `<textarea class="hacc-edit" maxlength="600" rows="2" aria-label="تعديل التعليق"></textarea>
                <div class="hacc-edit-actions"><button type="button" class="hacc-btn sm primary" data-act="save">حفظ</button>
                <button type="button" class="hacc-btn sm" data-act="cancel">إلغاء</button></div>`;
            const ta = textEl.querySelector('textarea');
            ta.value = c.body;
            ta.focus();
            textEl.querySelector('[data-act="cancel"]').addEventListener('click', render);
            textEl.querySelector('[data-act="save"]').addEventListener('click', async () => {
                const text = ta.value.trim();
                if (!text) return;
                try {
                    const res = await Hub.api('POST', '/api/social/comment/edit', { cid, body: text }, { retries: 0 });
                    c.body = res.body;
                    c.edited = true;
                    render();
                } catch (err) { toast(errorText(err), 'error'); }
            });
        };

        // Moderators: a warning reaches the author (also behind a nickname) as a notification.
        const warnAuthor = async cid => {
            const c = data.comments.find(x => x.cid === cid);
            if (!c) return;
            const who = c.anon ? `${c.author}${c.realName ? ' (' + c.realName + ')' : ''}` : c.author;
            const note = prompt(`تحذير ${who} بسبب هذا التعليق؟\nيمكنك كتابة ملاحظة تصله مع التحذير (اختياري):`, '');
            if (note === null) return;
            try {
                await Hub.api('POST', '/api/social/comment/warn', { cid, note: note.trim() }, { retries: 0 });
                c.warned = true;
                keepScroll = true;
                render();
                toast('تم إرسال التحذير ⚠️', 'success');
            } catch (err) { toast(errorText(err), 'error'); }
        };

        const removeComment = async cid => {
            if (!confirm('حذف هذا التعليق؟')) return;
            try {
                await Hub.api('POST', '/api/social/comment/delete', { cid }, { retries: 1 });
                data.comments = data.comments.filter(c => c.cid !== cid);
                if (replyTo && replyTo.cid === cid) setReplyTo(null);
                keepScroll = true;
                render();
                updateCounts();
            } catch (err) { toast(errorText(err), 'error'); }
        };

        sheet.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => { current = t.dataset.tab; render(); }));

        if (composer) {
            composer.querySelector('[data-act="cancel-reply"]').addEventListener('click', () => setReplyTo(null));
            composer.querySelector('[data-act="nick"]').addEventListener('click', () => { closeSheet(); setTimeout(() => openPanel('settings'), 260); });
            const ta = composer.querySelector('textarea');
            ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
            ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); } });
            composer.addEventListener('submit', async e => {
                e.preventDefault();
                const text = ta.value.trim();
                if (!text) return;
                const anon = composer.querySelector('input[name="hacc-as"]:checked').value === 'anon';
                const send = composer.querySelector('.hacc-send');
                send.disabled = true;
                try {
                    const payload = { ...card, body: text, anon };
                    if (replyTo) payload.parentCid = replyTo.cid;
                    const res = await Hub.api('POST', '/api/social/comment', payload, { retries: 0 });
                    ta.value = '';
                    ta.style.height = '';
                    const sent = res.comment;
                    if (!sent.anon && !sent.avatar) { const me = account() || {}; sent.avatar = me.avatar || null; sent.sex = me.sex || null; }
                    const wasReply = !!replyTo;
                    setReplyTo(null);
                    if (data) {
                        data.comments.push(sent);
                        current = 'comments';
                        keepScroll = wasReply;
                        render();
                        updateCounts();
                        const el = body.querySelector(`li[data-cid="${sent.cid}"]`);
                        if (el && wasReply) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                } catch (err) {
                    toast(errorText(err), 'error');
                } finally {
                    send.disabled = false;
                }
            });
            if (focusComposer) setTimeout(() => ta.focus(), 280);
        }
        await load();
    }

    // ------------------------------------------------------------------
    // Push notifications (shown by service-worker.js even when the app is closed)
    // ------------------------------------------------------------------
    const push = { state: 'unknown' };
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

    function pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function urlB64ToBytes(b64) {
        const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
        return Uint8Array.from(s, c => c.charCodeAt(0));
    }

    /** 'unsupported' | 'needs-install' (iPhone: add to the home screen first) | 'denied' | 'on' | 'off' */
    async function pushStatus() {
        if (!pushSupported()) push.state = isIos && !standalone() ? 'needs-install' : 'unsupported';
        else if (Notification.permission === 'denied') push.state = 'denied';
        else {
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                push.state = sub && Notification.permission === 'granted' ? 'on' : 'off';
            } catch (e) { push.state = 'off'; }
        }
        return push.state;
    }

    async function sendSubscription(sub) {
        await Hub.api('POST', '/api/push/subscribe', { subscription: sub.toJSON() }, { retries: 1 });
        try { localStorage.setItem('hacc_push_synced', String(Date.now())); } catch (e) {}
    }

    async function enablePush() {
        if (!account()) return { ok: false, error: 'الإشعارات تحتاج حساباً شخصياً.' };
        const st = await pushStatus();
        if (st === 'needs-install') return { ok: false, error: 'على الآيفون: أضف التطبيق إلى الشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم فعّل الإشعارات من داخله.' };
        if (st === 'unsupported') return { ok: false, error: 'هذا المتصفح لا يدعم الإشعارات.' };
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                await pushStatus();
                return { ok: false, error: 'لم يتم السماح بالإشعارات. يمكنك السماح بها من إعدادات المتصفح.' };
            }
            const { key } = await Hub.api('GET', '/api/push/key', undefined, { useToken: false, retries: 1 });
            if (!key) return { ok: false, error: 'الإشعارات غير مفعّلة على الخادم بعد.' };
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (sub && sub.options && sub.options.applicationServerKey) {
                // Subscribed with an older server key: start over.
                const current = new Uint8Array(sub.options.applicationServerKey);
                const wanted = urlB64ToBytes(key);
                if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) { await sub.unsubscribe(); sub = null; }
            }
            if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) });
            await sendSubscription(sub);
            push.state = 'on';
            return { ok: true };
        } catch (err) {
            await pushStatus();
            return { ok: false, error: err && err.status ? errorText(err) : 'تعذر تفعيل الإشعارات على هذا الجهاز.' };
        }
    }

    async function disablePush() {
        try {
            // getRegistration (not .ready, which never settles without an active service worker).
            const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
            if (!reg || !reg.pushManager) throw new Error('no service worker');
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await Hub.api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }, { retries: 1 }).catch(() => {});
                await sub.unsubscribe();
            }
        } catch (e) {}
        push.state = 'off';
        return { ok: true };
    }

    /** Keeps the server copy of this device's subscription fresh (it can change, or the account can). */
    async function resyncPush() {
        if (!account() || (await pushStatus()) !== 'on') return;
        let last = 0;
        try { last = Number(localStorage.getItem('hacc_push_synced')) || 0; } catch (e) {}
        if (Date.now() - last < 24 * 3600 * 1000) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) await sendSubscription(sub);
        } catch (e) {}
    }

    /** Tapping a like / comment push lands on Home.html#thread=<date>|<name>: open that thread. */
    function openThreadFromHash() {
        const m = location.hash.match(/^#thread=([^|]*)\|(.*)$/);
        if (!m || !/Home\.html$/i.test(location.pathname)) return;
        const h = new URLSearchParams(location.search).get('hospital') || (Hub.getActiveHospitalId && Hub.getActiveHospitalId());
        const d = decodeURIComponent(m[1]);
        const local = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d;
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(() => openThread({ h, d: local, n: decodeURIComponent(m[2]) }, 'comments'), 400);
    }

    /** A push that lands on <page>#panel=<tab> opens the account panel there (schedule = ER portal form). */
    function openPanelFromHash() {
        const m = location.hash.match(/^#panel=(\w+)$/);
        if (!m || !account()) return;
        history.replaceState(null, '', location.pathname + location.search);
        if (m[1] === 'exchanges') { setTimeout(openExchanges, 400); return; }
        // #panel=schedule = the ER preferences portal (its notification); #panel=duties = My Schedule.
        setTimeout(() => openPanel(m[1] === 'schedule' ? 'portal' : m[1] === 'duties' ? 'schedule' : m[1]), 400);
    }

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------
    /** Marks rotators on <html> (CSS hides the duty exchange links for them). */
    function markRole() {
        document.documentElement.classList.toggle('role-rotator', Hub.auth.getRole() === 'rotator');
    }

    function start() {
        markRole();
        window.addEventListener('hub:auth-changed', markRole);
        refreshNavSlots();
        slotObserver.observe(document.body, { childList: true, subtree: true });
        startPolling();
        refreshProfile();
        pushStatus().then(resyncPush);
        openThreadFromHash();
        openPanelFromHash();
        window.addEventListener('hashchange', openThreadFromHash);
        window.addEventListener('hashchange', openPanelFromHash);
        initIosChrome();
        scheduleInstallOffer();
    }

    /** Owner tools that live on the portal page (index.html) or in the shared navigation script. */
    const ADMIN_PAGES = {
        openAddHospitalModal: './index.html?portal=true',
        openGlobalSpecialtiesModal: './index.html?portal=true',
        openFullSystemBackupModal: './index.html?portal=true',
        openAllPasswordsModalNav: './index.html?portal=true',
    };
    const ADMIN_ACTIONS = Object.keys(ADMIN_PAGES);
    function adminAction(fn) {
        if (!ADMIN_ACTIONS.includes(fn)) return;
        const run = typeof window[fn] === 'function' ? window[fn] : null;
        if (run) { closeSheet(); setTimeout(() => run(), 280); return; }
        location.href = ADMIN_PAGES[fn] + '#admin=' + fn;
    }

    function goBack(fallback = './index.html?portal=true') {
        let internal = false;
        try { internal = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
        if (internal && history.length > 1) history.back();
        else location.href = fallback;
    }

    // ------------------------------------------------------------------
    // iOS chrome: the bars turn to glass once content scrolls under them; cards rise in
    // ------------------------------------------------------------------
    function initIosChrome() {
        let scrolled = null;
        const update = () => {
            if (lockedY !== null) return; // the page is pinned under a sheet
            const now = window.scrollY > 6;
            if (now !== scrolled) { scrolled = now; document.body.classList.toggle('ios-scrolled', now); }
        };
        update();
        window.addEventListener('scroll', update, { passive: true });
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // The first screenful of cards rises in with a short stagger (once per page).
        requestAnimationFrame(() => {
            const cards = [...document.querySelectorAll('.glass-card, .hospital-card, .roster-card')]
                .filter(el => { const r = el.getBoundingClientRect(); return r.width && r.top < innerHeight; }).slice(0, 10);
            cards.forEach((el, i) => { el.style.animationDelay = (i * 40) + 'ms'; el.classList.add('ios-rise'); });
            setTimeout(() => cards.forEach(el => { el.classList.remove('ios-rise'); el.style.animationDelay = ''; }), 1200);
        });
    }

    // ------------------------------------------------------------------
    // Install offer: Android gets the system prompt, iPhone gets the Add to Home Screen steps
    // ------------------------------------------------------------------
    const INSTALL_SNOOZE_MS = 7 * 24 * 3600 * 1000;
    const isPhone = () => window.matchMedia && window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches;
    const iosShareIcon = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1"/></svg>';
    const addIcon = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

    function installState() {
        const P = window.HubPWA;
        if (!P || P.installed()) return 'installed';
        if (P.canPrompt()) return 'prompt';
        if (P.isIos()) return 'ios';
        return 'none';
    }

    /** Opens the install sheet. Returns false when this device cannot install (or already has). */
    function offerInstall() {
        const state = installState();
        if (state === 'installed' || state === 'none') return false;
        const sheet = openSheet(`<div class="ios-install">
                <img class="ios-install-icon" src="./pwa-icon.svg" alt="" width="76" height="76">
                <h2>بوابة المستشفيات على شاشتك الرئيسية</h2>
                <p class="hacc-muted">افتحها بلمسة كتطبيق كامل، واستلم إشعارات الإعجابات والتعليقات والردود حتى والتطبيق مغلق.</p>
                <ul class="ios-install-perks">
                    <li><span>⚡️</span>فتح فوري بملء الشاشة</li>
                    <li><span>🔔</span>إشعارات فورية</li>
                    <li><span>📶</span>يعمل مع ضعف الإنترنت</li>
                </ul>
                ${state === 'prompt' ? `<button type="button" class="ios-install-cta" data-act="install">تثبيت التطبيق</button>` : `<ol class="ios-install-steps">
                    <li><b>1</b><span>اضغط زر المشاركة ${iosShareIcon} في شريط Safari</span></li>
                    <li><b>2</b><span>اختر «إضافة إلى الشاشة الرئيسية» ${addIcon}</span></li>
                    <li><b>3</b><span>اضغط «إضافة» في الأعلى</span></li>
                </ol>`}
                <button type="button" class="ios-install-later" data-act="later">ليس الآن</button>
            </div>`, { label: 'تثبيت التطبيق' });
        const snooze = () => { try { localStorage.setItem('ios_install_offer', String(Date.now())); } catch (e) {} };
        snooze();
        sheet.querySelector('[data-act="later"]').addEventListener('click', closeSheet);
        const btn = sheet.querySelector('[data-act="install"]');
        if (btn) btn.addEventListener('click', async () => {
            const ok = await window.HubPWA.install();
            closeSheet();
            if (ok) toast('تم تثبيت التطبيق ✓', 'success');
        });
        return true;
    }

    /** Offered once a week on phones that have not installed the app, when nothing else is open. */
    function scheduleInstallOffer() {
        if (!isPhone()) return;
        let last = 0;
        try { last = Number(localStorage.getItem('ios_install_offer')) || 0; } catch (e) { return; }
        if (Date.now() - last < INSTALL_SNOOZE_MS) return;
        const tryOffer = () => {
            if (window.HubView && !window.HubView.active) return;     // another view is on screen
            try { if (Date.now() - (Number(localStorage.getItem('ios_install_offer')) || 0) < INSTALL_SNOOZE_MS) return; } catch (e) { return; }
            if (openSheetEl || document.querySelector('.modal-overlay.active, .hub-modal-overlay.active')) return;
            if (installState() === 'ios' || installState() === 'prompt') offerInstall();
        };
        // Android: Chrome decides when the app is installable (the event reaches the app window); iPhone: right away.
        let host = window;
        try { if (window.HubView) host = window.parent; } catch (e) {}
        host.addEventListener('beforeinstallprompt', () => setTimeout(tryOffer, 2500), { once: true });
        setTimeout(tryOffer, 6000);
    }

    window.HubAccounts = {
        offerInstall,
        installState,
        navButtons,
        avatarHtml,
        goBack,
        adminAction,
        ADMIN_ACTIONS,
        openPanel,
        openSheet,
        closeSheet,
        pickContact,
        refreshNavSlots,
        openNotifications,
        pollNotifications,
        decorate,
        openThread,
        openExchanges,
        toast,
        esc,
        timeAgo,
        ROLE_NAMES,
        errorText,
        push: {
            status: pushStatus,
            enable: enablePush,
            disable: disablePush,
            test: () => Hub.api('POST', '/api/push/test', {}, { retries: 0 }),
        },
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
