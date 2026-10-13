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
    const ROLE_NAMES = { owner: 'المالك', admin: 'مدير مستشفى', anaesthesia: 'مقيم تخدير', user: 'مقيم' };

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
        })[code] || 'تعذر الاتصال بالخادم. حاول مجدداً.';
    }

    // ------------------------------------------------------------------
    // Bottom sheet (used by the notification panel and the comment threads)
    // ------------------------------------------------------------------
    let openSheetEl = null;

    function openSheet(html, { label = '', onClose } = {}) {
        closeSheet();
        const wrap = document.createElement('div');
        wrap.className = 'hacc-sheet-backdrop';
        wrap.innerHTML = `<section class="hacc-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
            <div class="hacc-sheet-grip" aria-hidden="true"></div>${html}</section>`;
        wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
        wrap._onClose = onClose;
        document.body.appendChild(wrap);
        document.documentElement.classList.add('hacc-no-scroll');
        requestAnimationFrame(() => wrap.classList.add('open'));
        openSheetEl = wrap;
        enableSwipeToClose(wrap.querySelector('.hacc-sheet'));
        return wrap.querySelector('.hacc-sheet');
    }

    function closeSheet() {
        if (!openSheetEl) return;
        const el = openSheetEl;
        openSheetEl = null;
        document.documentElement.classList.remove('hacc-no-scroll');
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
        notif.timer = setInterval(() => { if (document.visibilityState === 'visible') pollNotifications(); }, POLL_MS);
    }

    function stopPolling() {
        if (notif.timer) clearInterval(notif.timer);
        notif.timer = null;
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollNotifications(); });
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
            case 'signup_request':
                return { icon: '🆕', text: `طلب حساب جديد: ${d.name} (@${d.username}) – ${hospitalName(d.hosp)}`, href: './account.html#manage' };
            case 'reset_request':
                return { icon: '🔑', text: `طلب إعادة تعيين كلمة المرور: ${d.name} (@${d.username})`, href: './account.html#manage-resets' };
            case 'account_approved':
                return { icon: '✅', text: 'تمت الموافقة على حسابك. أهلاً بك!' };
            case 'reset_approved':
                return { icon: '🔓', text: 'تمت الموافقة على طلب تغيير كلمة المرور.' };
            case 'role_changed':
                return { icon: '⭐', text: `تم تغيير صلاحياتك إلى: ${ROLE_NAMES[d.role] || d.role}` };
            default:
                return { icon: '🔔', text: 'إشعار جديد' };
        }
    }

    function openNotifications() {
        const sheet = openSheet(`<header class="hacc-sheet-head">
                <h2>الإشعارات</h2>
                <button type="button" class="hacc-link" data-act="all-read">تعليم الكل كمقروء</button>
            </header>
            <div class="hacc-sheet-body" data-role="list"><div class="hacc-empty">جاري التحميل…</div></div>`, { label: 'الإشعارات' });
        openSheetEl.dataset.kind = 'notifications';
        sheet.querySelector('[data-act="all-read"]').addEventListener('click', markAllRead);
        renderNotificationList(sheet);
        pollNotifications();
    }

    function renderNotificationList(sheet) {
        const list = sheet.querySelector('[data-role="list"]');
        const parts = [];
        const p = notif.pending;
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
        if (!notif.items.length && account()) parts.push('<div class="hacc-empty">لا توجد إشعارات بعد</div>');
        notif.items.forEach((n, i) => {
            const d = describe(n);
            parts.push(`<button type="button" class="hacc-notif ${n.seen ? '' : 'unread'}" data-i="${i}">
                <span class="hacc-notif-icon" aria-hidden="true">${d.icon}</span>
                <span class="hacc-notif-main"><span class="hacc-notif-text">${esc(d.text)}</span>
                <time class="hacc-notif-time">${esc(timeAgo(n.ts))}</time></span></button>`);
        });
        list.innerHTML = parts.join('');
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
        const initial = acc ? esc((acc.name || acc.username || '?').replace(/^د\.?\s*/, '').trim().charAt(0)) : '<i class="fas fa-user"></i>';
        return `<button type="button" class="hacc-nav-btn hacc-bell" onclick="HubAccounts.openNotifications()" aria-label="الإشعارات">
                <i class="fas fa-bell"></i><span class="hacc-bell-count" hidden>0</span></button>
            <a class="hacc-nav-btn hacc-nav-account ${acc ? 'has-account' : ''}" href="./account.html" title="${acc ? esc(acc.name) : 'إنشاء حساب شخصي'}" aria-label="حسابي">${initial}</a>`;
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
            if (res && res.account) Hub.auth.refreshAccount(res.account, res.role, res.adminHospitals);
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

    function socialBarHtml(card, s, canReact) {
        const likes = s ? s.likes : 0, comments = s ? s.comments : 0, mine = s && s.mine;
        return `<div class="hacc-social-summary">
                <button type="button" class="hacc-count" data-act="likes" ${likes ? '' : 'hidden'}><span class="hacc-heart-dot" aria-hidden="true">❤</span> <span data-role="likes">${likes}</span></button>
                <button type="button" class="hacc-count" data-act="comments" ${comments ? '' : 'hidden'}><span data-role="comments">${comments}</span> تعليق</button>
            </div>
            <div class="hacc-social-actions">
                <button type="button" class="hacc-react ${mine ? 'liked' : ''}" data-act="like" aria-pressed="${mine ? 'true' : 'false'}">
                    <span class="hacc-heart" aria-hidden="true">${mine ? '❤️' : '🤍'}</span> أعجبني</button>
                <button type="button" class="hacc-react" data-act="comment"><span aria-hidden="true">💬</span> تعليق</button>
            </div>`;
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
            let bar = c.el.querySelector(':scope > .hacc-social');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'hacc-social';
                bar.addEventListener('click', e => e.stopPropagation());
                bar.addEventListener('mousemove', e => e.stopPropagation());
                c.el.appendChild(bar);
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
            else if (act === 'likes') openThread(bar._card, 'likes');
            else openThread(bar._card, 'comments', act === 'comment');
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
        if (on) bar.querySelector('.hacc-heart')?.classList.add('pop');
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
        document.querySelectorAll('.hacc-social').forEach(b => {
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
                <div class="hacc-identity" role="radiogroup" aria-label="التعليق باسم">
                    <label><input type="radio" name="hacc-as" value="real" checked> <span>باسمي</span></label>
                    <label><input type="radio" name="hacc-as" value="anon"> <span data-role="anon-label">مجهول</span></label>
                </div>
                <div class="hacc-compose-row">
                    <textarea rows="1" maxlength="600" placeholder="اكتب تعليقاً…" aria-label="تعليق" required></textarea>
                    <button type="submit" class="hacc-send" aria-label="إرسال">➤</button>
                </div>
            </form>` : `<div class="hacc-composer hacc-cta">للتعليق والإعجاب <a href="./account.html#signup">أنشئ حساباً شخصياً</a></div>`}`,
            { label: 'التعليقات والإعجابات' });

        let data = null;
        let current = tab;
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
                    ? `<ul class="hacc-people">${data.likes.map(l => `<li><span class="hacc-avatar">${esc(l.name.replace(/^د\.?\s*/, '').charAt(0))}</span>
                        <span class="hacc-person-name">${esc(l.name)}${l.mine ? ' <span class="hacc-chip">أنت</span>' : ''}</span>
                        <span class="hacc-heart-dot" aria-hidden="true">❤</span></li>`).join('')}</ul>`
                    : '<div class="hacc-empty">لا إعجابات بعد. كن أول من يُعجب ❤️</div>';
            } else {
                body.innerHTML = data.comments.length
                    ? `<ul class="hacc-comments">${data.comments.map(c => `<li data-cid="${c.cid}">
                        <span class="hacc-avatar ${c.anon ? 'anon' : ''}">${c.anon ? '🕶️' : esc(c.author.replace(/^د\.?\s*/, '').charAt(0))}</span>
                        <div class="hacc-bubble-wrap">
                          <div class="hacc-bubble"><div class="hacc-author">${esc(c.author)}${c.mine ? ' <span class="hacc-chip">أنت</span>' : ''}</div>
                          <div class="hacc-text">${esc(c.body)}</div></div>
                          <div class="hacc-meta"><time>${esc(timeAgo(c.ts))}</time>
                          ${c.realName ? `<span class="hacc-reveal" title="ظاهر للمالك فقط">👁 ${esc(c.realName)}</span>` : ''}
                          ${c.canDelete ? '<button type="button" class="hacc-link danger" data-act="delete">حذف</button>' : ''}</div>
                        </div></li>`).join('')}</ul>`
                    : '<div class="hacc-empty">لا تعليقات بعد. اكتب أول تعليق 💬</div>';
                body.querySelectorAll('[data-act="delete"]').forEach(btn => btn.addEventListener('click', () => removeComment(Number(btn.closest('li').dataset.cid))));
                body.scrollTop = body.scrollHeight;
            }
        };

        const load = async () => {
            try {
                data = await Hub.api('GET', '/api/social/thread?' + new URLSearchParams(card), undefined, { retries: 1 });
                if (composer && data.myAnonTag) composer.querySelector('[data-role="anon-label"]').textContent = data.myAnonTag;
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

        const removeComment = async cid => {
            if (!confirm('حذف هذا التعليق؟')) return;
            try {
                await Hub.api('POST', '/api/social/comment/delete', { cid }, { retries: 1 });
                data.comments = data.comments.filter(c => c.cid !== cid);
                render();
                updateCounts();
            } catch (err) { toast(errorText(err), 'error'); }
        };

        sheet.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => { current = t.dataset.tab; render(); }));

        if (composer) {
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
                    const res = await Hub.api('POST', '/api/social/comment', { ...card, body: text, anon }, { retries: 0 });
                    ta.value = '';
                    ta.style.height = '';
                    if (data) { data.comments.push(res.comment); current = 'comments'; render(); updateCounts(); }
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
    // Start
    // ------------------------------------------------------------------
    function start() {
        refreshNavSlots();
        slotObserver.observe(document.body, { childList: true, subtree: true });
        startPolling();
        refreshProfile();
    }

    window.HubAccounts = {
        navButtons,
        refreshNavSlots,
        openNotifications,
        pollNotifications,
        decorate,
        openThread,
        toast,
        esc,
        timeAgo,
        ROLE_NAMES,
        errorText,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
