/**
 * Site themes on the page (window.HubThemes): picks the theme in force, applies its colours, styles and
 * effects (hub-fx.js), and draws the owner's manager and the users' choice in Settings.
 *
 * In force, in order: a theme forced by the owner (its day / night is imposed and the switch greyed out),
 * else the theme this user picked among the optional ones (the owner also among their own), else none.
 * Periods (start / end) are checked here, so themes switch on and off at their times with no request.
 *
 * Reads: the themes' settings once per 15 minutes per device (GET /api/themes/state, cached on the
 * server too); a theme file once per version (kept on the device). hub-core.js applies the last theme
 * from localStorage before the page draws (no flash), then loads this file.
 */
(function (window, document) {
    'use strict';

    const STATE_KEY = 'hub_theme_state';     // { at, themes: [{ id, name, icon, preview, mode, start, end, v, scheme }] }
    const CHOICE_KEY = 'hub_theme_choice';   // the optional theme this user picked (per device)
    const FILE_PREFIX = 'hub_theme_file:';   // <id> -> { v, theme }
    const LIVE_KEY = 'hub_theme_live';       // what hub-core applies at once: { id, v, css, forced, scheme, name, effects, start, end }
    const STATE_TTL = 10 * 60 * 1000;

    const Hub = () => window.Hub;
    const toast = (m, t) => { try { (window.HubAccounts && HubAccounts.toast) ? HubAccounts.toast(m, t) : console.log(m); } catch (e) {} };
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
    const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const isOwner = () => { try { return Hub().auth.isOwner(); } catch (e) { return false; } };
    const inPeriod = (t, now = Date.now()) => (!t.start || t.start <= now) && (!t.end || now < t.end);
    const choiceKey = () => { try { const a = Hub().auth.getAccount(); return CHOICE_KEY + (a ? ':' + a.id : ''); } catch (e) { return CHOICE_KEY; } };

    // -------------------------------------------------------------------------------------------
    // Building a theme's stylesheet
    // -------------------------------------------------------------------------------------------
    const decl = obj => Object.entries(obj || {}).map(([k, v]) => `${k}:${v};`).join('');
    // The bottom bar in the pages (outside the app): the theme's deep hero colour for the capsule, its
    // bright accent for the chosen tab (each theme pairs them for strong contrast).
    const DOCK_CSS = `html.hub-themed :is(.hub-mobile-bottom-dock,.ios-bottom-dock){background:color-mix(in srgb,var(--v5-ink) 93%,transparent)!important;border-color:rgba(255,255,255,.1)!important}`
        + `html.hub-themed :is(.hub-mobile-bottom-dock,.ios-bottom-dock) .dock-tab-btn{color:rgba(255,255,255,.7)!important}`
        + `html.hub-themed :is(.hub-mobile-bottom-dock,.ios-bottom-dock) .dock-tab-btn.active{background:var(--v5-mint)!important;color:var(--v5-mint-ink)!important}`;
    function compile(theme) {
        const light = theme.tokens && (theme.tokens.light || theme.tokens.dark);
        const dark = theme.tokens && (theme.tokens.dark || theme.tokens.light);
        return `html.hub-themed,html.hub-themed body{${decl(light)}}`
            + `html.hub-themed.dark,html.hub-themed body.dark,html.hub-themed.dark body{${decl(dark)}}`
            + DOCK_CSS + String(theme.css || '');
    }
    /**
     * The app's own frame (app.html: its tab bar, side rail and background) has no page styles: its
     * colours, from the theme's. Capsule = the deep hero colour, labels light; the chosen tab = the
     * bright accent with its dark ink; the side rail (wide screens) = cards and the brand colour.
     */
    function compileShell(theme) {
        const one = (t, dark) => {
            if (!t) return '';
            const g = k => t[k];
            const v = {
                '--app-bg': g('--ds-bg'),
                '--app-ink': g('--v5-ink') && `color-mix(in srgb, ${g('--v5-ink')} 94%, transparent)`,
                '--app-ink-label': 'rgba(255, 255, 255, 0.7)',
                '--app-mint': g('--v5-mint'), '--app-mint-ink': g('--v5-mint-ink'),
                '--app-tint': g('--ds-brand'), '--app-label': g('--ds-ink'), '--app-line': g('--ds-line'),
                '--app-rail-bg': g('--ds-card'), '--app-rail-label': g('--ds-ink-2'),
                '--app-rail-active': dark ? g('--v5-mint') : (g('--ds-brand-strong') || g('--ds-brand')), '--app-rail-pill': g('--ds-brand-soft'),
            };
            return Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k}:${x};`).join('');
        };
        const tk = theme.tokens || {};
        return `html.hub-themed{${one(tk.light || tk.dark, false)}}html.hub-themed.dark{${one(tk.dark || tk.light, true)}}`;
    }

    // -------------------------------------------------------------------------------------------
    // State and files
    // -------------------------------------------------------------------------------------------
    let refreshing = null;
    async function refreshState(force) {
        const H = Hub();
        if (!H || !H.auth || !H.auth.isLoggedIn() || !H.api) return null;
        const cached = read(STATE_KEY, null);
        if (!force && cached && Date.now() - cached.at < STATE_TTL) return cached;
        if (!refreshing) refreshing = H.api('GET', '/api/themes/state', undefined, { retries: 1 })
            .then(r => { const s = { at: Date.now(), themes: r.themes || [] }; write(STATE_KEY, s); return s; })
            .catch(() => cached)
            .finally(() => { refreshing = null; });
        return refreshing;
    }
    async function loadTheme(meta) {
        const kept = read(FILE_PREFIX + meta.id, null);
        if (kept && kept.v === meta.v && kept.theme) return kept.theme;
        const r = await Hub().api('GET', `/api/themes/file?id=${encodeURIComponent(meta.id)}&v=${meta.v}`, undefined, { retries: 1 });
        // Only the theme in use is kept on the device (themes can be a few hundred KB).
        try { Object.keys(localStorage).filter(k => k.startsWith(FILE_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
        write(FILE_PREFIX + meta.id, { v: meta.v, theme: r.theme });
        return r.theme;
    }

    /** The theme in force now: { meta, forced } or null. */
    function pickActive(state) {
        const now = Date.now();
        const list = (state && state.themes) || [];
        const forced = list.find(t => t.mode === 'forced' && inPeriod(t, now));
        if (forced) return { meta: forced, forced: true };
        const want = read(choiceKey(), null);
        const chosen = want && list.find(t => t.id === want && inPeriod(t, now) && (t.mode === 'optional' || (t.mode === 'owner' && isOwner())));
        return chosen ? { meta: chosen, forced: false } : null;
    }

    // -------------------------------------------------------------------------------------------
    // Applying
    // -------------------------------------------------------------------------------------------
    function loadFx(cb) {
        if (window.HubFX) return cb();
        const self = document.querySelector('script[src*="hub-themes.js"]');
        const s = document.createElement('script');
        s.src = (self ? self.src.replace(/hub-themes\.js.*$/, '') : './') + 'hub-fx.js';
        s.onload = cb;
        document.head.appendChild(s);
    }
    function applyLive(live) {
        const H = Hub();
        let style = document.getElementById('hub-theme-css');
        if (!live) {
            if (style) style.remove();
            document.documentElement.classList.remove('hub-themed');
            [...document.documentElement.classList].filter(c => c.startsWith('hub-th-')).forEach(c => document.documentElement.classList.remove(c));
            if (window.HubFX) HubFX.set([]);
            if (H && H.applyThemeLock) H.applyThemeLock(null);
            return;
        }
        if (!style) { style = document.createElement('style'); style.id = 'hub-theme-css'; document.head.appendChild(style); }
        if (style.textContent !== live.css) style.textContent = live.css;
        [...document.documentElement.classList].filter(c => c.startsWith('hub-th-') && c !== 'hub-th-' + live.id).forEach(c => document.documentElement.classList.remove(c));
        document.documentElement.classList.add('hub-themed', 'hub-th-' + live.id);
        if (H && H.applyThemeLock) H.applyThemeLock(live.forced ? { scheme: live.scheme, name: live.name } : null);
        if (live.effects && live.effects.length) loadFx(() => HubFX.set(live.effects)); else if (window.HubFX) HubFX.set([]);
    }

    let timer = null;
    async function evaluate(forceRefresh) {
        const state = await refreshState(forceRefresh);
        const act = pickActive(state);
        let live = null;
        if (act) {
            try {
                const theme = await loadTheme(act.meta);
                if (theme) live = { id: theme.id, v: act.meta.v, name: theme.name, css: compile(theme), shellCss: compileShell(theme), forced: act.forced, scheme: theme.mode === 'light' ? 'light' : 'dark', effects: theme.effects || [], start: act.meta.start || null, end: act.meta.end || null };
            } catch (e) { live = read(LIVE_KEY, null); }
        }
        write(LIVE_KEY, live);
        applyLive(live);
        // The next change of the themes' periods (a start or an end), and a fresh look every 15 minutes.
        clearTimeout(timer);
        const now = Date.now();
        const edges = ((state && state.themes) || []).flatMap(t => [t.start, t.end]).filter(x => x && x > now);
        const next = Math.min(now + STATE_TTL, ...edges);
        timer = setTimeout(() => evaluate(false), Math.max(5000, next - now + 500));
        window.dispatchEvent(new CustomEvent('hub:site-theme', { detail: { live, state } }));
        return { live, state };
    }

    // -------------------------------------------------------------------------------------------
    // Settings › المظهر (every user): the optional themes, the effects switch
    // -------------------------------------------------------------------------------------------
    const swatch = p => {
        const c = [p && p.bg, p && p.accent, p && p.card, p && p.ink].filter(Boolean);
        return `<span class="hth-swatch" style="background:${esc(p && p.gradient ? p.gradient : `linear-gradient(135deg, ${(c[0] || '#0B7A6E')}, ${(c[1] || '#5EE0C8')})`)}"></span>`;
    };
    async function renderUserSection(host) {
        if (!host) return;
        host.innerHTML = '<div class="hacc-empty" style="padding:10px">جاري تحميل الثيمات…</div>';
        const state = await refreshState(false);
        const now = Date.now();
        const list = ((state && state.themes) || []).filter(t => inPeriod(t, now) && (t.mode === 'optional' || t.mode === 'forced' || (t.mode === 'owner' && isOwner())));
        const forced = list.find(t => t.mode === 'forced');
        const chosen = read(choiceKey(), null);
        const fxOff = (() => { try { return localStorage.getItem('hub_fx_off') === '1'; } catch (e) { return false; } })();
        const until = t => t.end ? ` · حتى ${new Date(t.end).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long' })}` : '';
        host.innerHTML = `
            ${forced ? `<div class="hth-forced"><span>${esc(forced.icon || '🎨')}</span><div><b>ثيم «${esc(forced.name)}» مفعّل للجميع${esc(until(forced))}</b><small>الوضع الفاتح والداكن يتبعان الثيم حتى انتهائه.</small></div></div>` : ''}
            <div class="hth-list">
                <button type="button" class="hth-item" data-pick="" aria-pressed="${!chosen || forced ? 'true' : 'false'}" ${forced ? 'disabled' : ''}>
                    <span class="hth-swatch hth-default"></span><span class="hth-name"><b>المظهر الأساسي</b><small>ألوان الموقع المعتادة</small></span></button>
                ${list.filter(t => t.mode !== 'forced').map(t => `
                <button type="button" class="hth-item" data-pick="${esc(t.id)}" aria-pressed="${!forced && chosen === t.id ? 'true' : 'false'}" ${forced ? 'disabled' : ''}>
                    ${swatch(t.preview)}<span class="hth-name"><b>${esc(t.icon || '🎨')} ${esc(t.name)}</b><small>${t.mode === 'owner' ? 'لك فقط (معاينة المالك)' : 'متاح للجميع'}${esc(until(t))}</small></span></button>`).join('')}
            </div>
            ${list.length ? '' : `<p class="hth-note">${isOwner() ? 'لا يوجد ثيم مفعّل لك الآن. الثيمات المرفوعة كلها متوقفة: فعّلها من «إدارة الثيمات» أدناه.' : 'لا توجد ثيمات مناسبات متاحة الآن. ستصلك إشعارات عند إضافة ثيم جديد.'}</p>`}
            ${isOwner() ? `<button type="button" class="hacc-btn primary hth-manage" data-act="manage"><i class="fas fa-swatchbook"></i> إدارة الثيمات (رفع، تفعيل، جدولة، حذف)</button>
            <div class="hth-manage-host" data-role="manage-host" hidden></div>` : ''}
            <div class="hp-switch-card" style="margin-top:10px">
                <span class="hp-switch-main"><b><i class="fas fa-wand-magic-sparkles"></i> تقليل المؤثرات المتحركة</b>
                <small>إيقاف الثلج والمطر والألعاب النارية وغيرها (تبقى ألوان الثيم).</small></span>
                <button type="button" class="hp-toggle" role="switch" aria-checked="${fxOff}" aria-label="تقليل المؤثرات" data-act="fx-off"><span></span></button>
            </div>`;
        host.querySelectorAll('[data-pick]').forEach(b => { b._bound = true; }), host.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', async () => {
            write(choiceKey(), b.dataset.pick || null);
            host.querySelectorAll('[data-pick]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            await evaluate(false);
            toast(b.dataset.pick ? 'تم تطبيق الثيم ✓' : 'عاد المظهر الأساسي ✓', 'success');
        }));
        // The owner: the whole manager right here (also in القطاع الإداري › المنظومة › ثيمات الموقع).
        const manage = host.querySelector('[data-act="manage"]');
        if (manage) manage.addEventListener('click', () => {
            const box = host.querySelector('[data-role="manage-host"]');
            box.hidden = !box.hidden;
            manage.innerHTML = box.hidden ? '<i class="fas fa-swatchbook"></i> إدارة الثيمات (رفع، تفعيل، جدولة، حذف)' : '<i class="fas fa-chevron-up"></i> إخفاء إدارة الثيمات';
            if (!box.hidden) renderManager(box);
        });
        // After a save in the manager: the themes list above follows, in place (the manager stays open where it is).
        if (!host._themesSaved) {
            host._themesSaved = true;
            window.addEventListener('hub:themes-saved', () => {
                const list = host.querySelector('.hth-list');
                if (!list || !document.contains(host)) return;
                refreshState(true).then(st => {
                    if (!document.contains(host)) return;
                    const now = Date.now();
                    const avail = ((st && st.themes) || []).filter(t => inPeriod(t, now) && (t.mode === 'optional' || (t.mode === 'owner' && isOwner())));
                    const chosen = read(choiceKey(), null);
                    const box = host.querySelector('[data-role="manage-host"]');
                    keepScroll(host, () => {
                        list.querySelectorAll('[data-pick]:not([data-pick=""])').forEach(x => x.remove());
                        list.insertAdjacentHTML('beforeend', avail.map(t => `<button type="button" class="hth-item" data-pick="${esc(t.id)}" aria-pressed="${chosen === t.id}">${swatch(t.preview)}<span class="hth-name"><b>${esc(t.icon || '🎨')} ${esc(t.name)}</b><small>${t.mode === 'owner' ? 'لك فقط (معاينة المالك)' : 'متاح للجميع'}</small></span></button>`).join(''));
                        list.querySelectorAll('[data-pick]').forEach(b => {
                            if (b._bound) return;
                            b._bound = true;
                            b.addEventListener('click', async () => { write(choiceKey(), b.dataset.pick || null); list.querySelectorAll('[data-pick]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); await evaluate(false); });
                        });
                    }, box && !box.hidden ? box : null);
                });
            });
        }
        const fx = host.querySelector('[data-act="fx-off"]');
        fx.addEventListener('click', () => {
            const off = fx.getAttribute('aria-checked') !== 'true';
            fx.setAttribute('aria-checked', String(off));
            if (window.HubFX) HubFX.setOff(off); else { try { if (off) localStorage.setItem('hub_fx_off', '1'); else localStorage.removeItem('hub_fx_off'); } catch (e) {} }
        });
    }

    // -------------------------------------------------------------------------------------------
    // The owner's manager (account panel › القطاع الإداري › الثيمات)
    // -------------------------------------------------------------------------------------------
    const MODE_NAMES = { off: 'إيقاف', owner: 'لي فقط', optional: 'اختياري للجميع', forced: 'إجباري للجميع' };
    const toLocalInput = ms => { if (!ms) return ''; const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
    const fromLocalInput = v => (v ? new Date(v).getTime() : null);
    const ERRORS = { bad_format: 'الملف ليس ثيماً (hubtheme/1).', bad_id: 'معرّف الثيم غير صالح.', no_name: 'الثيم بلا اسم.', bad_tokens: 'ألوان الثيم غير صالحة.',
        css_tag: 'الثيم يحتوي وسوماً غير مسموحة.', css_unsafe: 'الثيم يحتوي أوامر غير مسموحة.', css_url: 'الصور والخطوط يجب أن تكون داخل الملف (data:).', bad_effects: 'مؤثر غير معروف في الثيم.',
        too_big: 'حجم الثيم أكبر من المسموح (450 KB).', too_many: 'وصلت للحد الأقصى من الثيمات (60).', bad_period: 'الفترة غير صحيحة: النهاية قبل البداية.' };
    const errText = e => ERRORS[e && e.data && e.data.error] || (e && e.message) || 'تعذر الحفظ';

    /** The scrolling box around an element (the panel's body, or the page). */
    function scrollerOf(el) {
        for (let x = el && el.parentElement; x; x = x.parentElement) {
            const o = getComputedStyle(x).overflowY;
            if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x;
        }
        return document.scrollingElement || document.documentElement;
    }
    /**
     * Redraws without moving what is on screen: `anchor` (default: the redrawn box) stays exactly where it
     * was, even when something above it grows or shrinks.
     */
    function keepScroll(host, redraw, anchor) {
        const el = anchor && document.contains(anchor) ? anchor : host;
        const sc = scrollerOf(el), top = sc.scrollTop, y0 = el.getBoundingClientRect().top;
        redraw();
        sc.scrollTop = top;
        const d = el.getBoundingClientRect().top - y0;
        if (Math.abs(d) > 0.5) sc.scrollTop += d;
    }

    async function renderManager(host) {
        if (!host) return;
        if (!isOwner()) { host.innerHTML = '<div class="hacc-empty">للمالك فقط.</div>'; return; }
        if (!host.querySelector('.hth-mgr')) host.innerHTML = '<div class="hacc-empty">جاري التحميل…</div>';
        let res;
        try { res = await Hub().api('GET', '/api/themes', undefined, { retries: 1 }); }
        catch (e) { host.innerHTML = '<div class="hacc-empty">تعذر التحميل. تحقق من الاتصال.</div>'; return; }
        keepScroll(host, () => drawManager(host, res.themes || []));
    }

    function drawManager(host, themes) {
        const now = Date.now();
        const status = t => {
            if (t.mode === 'off') return '<span class="hth-badge off">متوقف</span>';
            if (t.end && now >= t.end) return '<span class="hth-badge off">انتهت فترته</span>';
            if (t.start && now < t.start) return `<span class="hth-badge wait">يبدأ ${esc(new Date(t.start).toLocaleString('ar-IQ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>`;
            return `<span class="hth-badge on">${esc(MODE_NAMES[t.mode])} · فعّال</span>`;
        };
        host.innerHTML = `
            <div class="hth-mgr">
                <div class="hth-top">
                    <label class="hacc-btn primary hth-upload"><i class="fas fa-upload"></i> رفع ثيم (.hubtheme)<input type="file" accept=".hubtheme,.json,application/json" hidden data-role="upload"></label>
                    <p class="hth-note">الثيمات ألوان وأنماط ومؤثرات جاهزة فقط (بلا أوامر برمجية). «إجباري للجميع» يفرض الثيم ووضعه الفاتح/الداكن على كل المستخدمين؛ «اختياري» يرسل إشعاراً ويضيفه لإعدادات المظهر؛ «لي فقط» لمعاينتك. عدّل ما تشاء من الثيمات ثم احفظها كلها بزر «حفظ التغييرات» أسفل القائمة. تصل التغييرات للمستخدمين خلال ربع ساعة تقريباً.</p>
                </div>
                ${themes.length ? '' : '<div class="hacc-empty">لا توجد ثيمات بعد. ارفع ملف ثيم للبدء.</div>'}
                ${themes.map(t => `
                <article class="hth-card" data-id="${esc(t.id)}" data-mode0="${esc(t.mode)}" data-start0="${toLocalInput(t.start)}" data-end0="${toLocalInput(t.end)}">
                    <header>${swatch(t.preview)}<div class="hth-title"><b>${esc(t.icon || '🎨')} ${esc(t.name)}</b><small dir="ltr">${esc(t.id)} · ${Math.round((t.size || 0) / 1024)} KB · ${t.scheme === 'light' ? 'فاتح' : 'داكن'}</small></div>${status(t)}</header>
                    <div class="hth-modes" role="radiogroup" aria-label="وضع الثيم">${Object.entries(MODE_NAMES).map(([m, n]) => `<button type="button" data-mode="${m}" aria-pressed="${t.mode === m}">${n}</button>`).join('')}</div>
                    <div class="hth-period">
                        <label>من<input type="datetime-local" data-f="start" value="${toLocalInput(t.start)}"></label>
                        <label>إلى<input type="datetime-local" data-f="end" value="${toLocalInput(t.end)}"></label>
                    </div>
                    <div class="hth-actions">
                        <span class="hth-edited" aria-hidden="true">● معدّل</span>
                        <button type="button" class="hacc-btn sm" data-act="preview"><i class="fas fa-eye"></i> معاينة عندي</button>
                        <button type="button" class="hacc-btn sm" data-act="download"><i class="fas fa-download"></i> تنزيل</button>
                        <button type="button" class="hacc-btn sm danger" data-act="delete" aria-label="حذف"><i class="fas fa-trash-can"></i></button>
                    </div>
                </article>`).join('')}
                ${themes.length ? `<div class="hth-savebar" data-role="savebar">
                    <span data-role="dirty-count">لا تغييرات</span>
                    <button type="button" class="hacc-btn sm" data-act="undo" disabled><i class="fas fa-rotate-left"></i> تراجع</button>
                    <button type="button" class="hacc-btn primary" data-act="save-all" disabled><i class="fas fa-check"></i> حفظ التغييرات</button>
                </div>` : ''}
            </div>`;

        const cards = [...host.querySelectorAll('.hth-card')];
        const current = card => ({
            id: card.dataset.id,
            mode: (card.querySelector('[data-mode][aria-pressed="true"]') || {}).dataset.mode || 'off',
            start: card.querySelector('[data-f="start"]').value,
            end: card.querySelector('[data-f="end"]').value,
        });
        const isDirty = card => { const c = current(card); return c.mode !== card.dataset.mode0 || c.start !== card.dataset.start0 || c.end !== card.dataset.end0; };
        const paintDirty = () => {
            const dirty = cards.filter(isDirty);
            cards.forEach(c => c.classList.toggle('dirty', dirty.includes(c)));
            const count = host.querySelector('[data-role="dirty-count"]');
            if (count) count.textContent = dirty.length ? `${dirty.length} ${dirty.length === 1 ? 'ثيم معدّل' : dirty.length === 2 ? 'ثيمان معدّلان' : 'ثيمات معدّلة'}` : 'لا تغييرات';
            const save = host.querySelector('[data-act="save-all"]'), undo = host.querySelector('[data-act="undo"]');
            if (save) save.disabled = !dirty.length;
            if (undo) undo.disabled = !dirty.length;
            const mgr = host.querySelector('.hth-mgr');
            if (mgr) mgr.classList.toggle('has-dirty', dirty.length > 0);
        };

        host.querySelector('[data-role="upload"]').addEventListener('change', async e => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            let theme;
            try { theme = JSON.parse(await f.text()); } catch (err) { toast('الملف ليس ثيماً صالحاً.', 'error'); return; }
            try {
                const r = await Hub().api('POST', '/api/themes', { theme }, { retries: 0 });
                toast(r.replaced ? `تم تحديث الثيم «${theme.name}» ✓` : `تمت إضافة الثيم «${theme.name}» (متوقف) ✓`, 'success');
                renderManager(host);
            } catch (err) { toast(errText(err), 'error'); }
        });

        cards.forEach(card => {
            const id = card.dataset.id;
            card.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
                card.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
                paintDirty();
            }));
            card.querySelectorAll('input[data-f]').forEach(i => { i.addEventListener('input', paintDirty); i.addEventListener('change', paintDirty); });
            card.querySelector('[data-act="preview"]').addEventListener('click', async () => {
                // The owner sees it at once (their own choice); the mode decides what the others see.
                write(choiceKey(), id);
                try {
                    const meta = themes.find(t => t.id === id);
                    const theme = await loadTheme(meta);
                    const live = { id, v: meta.v, name: theme.name, css: compile(theme), shellCss: compileShell(theme), forced: false, scheme: theme.mode, effects: theme.effects || [] };
                    write(LIVE_KEY, live); applyLive(live);
                    toast(`معاينة «${theme.name}» ✓ (للعودة: الإعدادات › المظهر › المظهر الأساسي)`, 'success');
                } catch (err) { toast(errText(err), 'error'); }
            });
            card.querySelector('[data-act="download"]').addEventListener('click', async () => {
                try {
                    const meta = themes.find(t => t.id === id);
                    const theme = await loadTheme(meta);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' }));
                    a.download = id + '.hubtheme';
                    document.body.appendChild(a); a.click(); a.remove();
                } catch (err) { toast(errText(err), 'error'); }
            });
            card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
                const t = themes.find(x => x.id === id);
                if (!confirm(`حذف الثيم «${t ? t.name : id}» نهائياً؟ (احتفظ بنسخة من ملفه إن أردت إعادته لاحقاً)`)) return;
                try {
                    await Hub().api('POST', '/api/themes/delete', { id }, { retries: 0 });
                    toast('تم حذف الثيم', 'success');
                    // The other cards keep their unsaved edits: only this one goes.
                    keepScroll(host, () => { card.remove(); themes.splice(themes.findIndex(x => x.id === id), 1); cards.splice(cards.indexOf(card), 1); paintDirty(); });
                    await evaluate(true);
                    window.dispatchEvent(new CustomEvent('hub:themes-saved'));
                } catch (err) { toast(errText(err), 'error'); }
            });
        });

        const undoBtn = host.querySelector('[data-act="undo"]');
        if (undoBtn) undoBtn.addEventListener('click', () => keepScroll(host, () => drawManager(host, themes)));

        const saveAll = host.querySelector('[data-act="save-all"]');
        if (saveAll) saveAll.addEventListener('click', async () => {
            const dirty = cards.filter(isDirty);
            if (!dirty.length) return;
            const items = dirty.map(c => { const x = current(c); return { id: x.id, mode: x.mode, start: fromLocalInput(x.start), end: fromLocalInput(x.end) }; });
            const bad = items.find(x => x.start && x.end && x.end <= x.start);
            if (bad) { toast(`«${(themes.find(t => t.id === bad.id) || {}).name || bad.id}»: النهاية قبل البداية.`, 'error'); return; }
            const forced = items.filter(x => x.mode === 'forced');
            if (forced.length && !confirm(`فرض ${forced.map(x => '«' + ((themes.find(t => t.id === x.id) || {}).name || x.id) + '»').join(' و')} على كل المستخدمين؟ (يتوقف أي ثيم إجباري آخر في نفس الفترة)`)) return;
            saveAll.disabled = true;
            saveAll.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ…';
            try {
                const r = await Hub().api('POST', '/api/themes/settings', { items }, { retries: 0 });
                const told = r.notified || [];
                toast(`تم حفظ ${items.length === 1 ? 'الثيم' : items.length + ' ثيمات'} ✓${told.length ? ' وأُرسل إشعار ثيم جديد للمستخدمين' : ''}`, 'success');
                // Redrawn from the saved settings, in place (the screen does not move).
                const fresh = (r.themes || []).map(t => ({ ...(themes.find(o => o.id === t.id) || {}), ...t }));
                keepScroll(host, () => drawManager(host, fresh.length ? fresh : themes));
                await evaluate(true);
                window.dispatchEvent(new CustomEvent('hub:themes-saved'));
            } catch (err) {
                toast(errText(err), 'error');
                saveAll.disabled = false;
                saveAll.innerHTML = '<i class="fas fa-check"></i> حفظ التغييرات';
            }
        });
        paintDirty();
    }

    // Styles of the manager and of the Settings section.
    const css = document.createElement('style');
    css.textContent = `
        .hth-list{display:grid;gap:8px}
        .hth-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;border:1.5px solid var(--hacc-border);background:var(--hacc-bg);color:var(--hacc-text);font:inherit;text-align:start;cursor:pointer;transition:border-color .2s,box-shadow .2s}
        .hth-item[aria-pressed="true"]{border-color:var(--hacc-accent);box-shadow:0 0 0 3px var(--hacc-accent-soft)}
        .hth-item:disabled{opacity:.55;cursor:not-allowed}
        .hth-swatch{width:42px;height:42px;flex:none;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25),0 2px 8px rgba(0,0,0,.15)}
        .hth-default{background:linear-gradient(135deg,#0B7A6E,#5EE0C8 55%,#EEF2EF)}
        .hth-name{display:grid;gap:2px;min-width:0}.hth-name b{font-size:.86rem}.hth-name small{font-size:.72rem;color:var(--hacc-muted)}
        .hth-forced{display:flex;gap:10px;align-items:center;padding:10px 12px;margin-bottom:8px;border-radius:14px;background:rgba(183,121,31,.1);border:1px solid rgba(183,121,31,.35)}
        .hth-forced>span{font-size:1.4rem}.hth-forced b{display:block;font-size:.84rem}.hth-forced small{color:var(--hacc-muted);font-size:.72rem}
        .hth-note{margin:6px 0 0;font-size:.74rem;color:var(--hacc-muted);line-height:1.7}
        .hth-mgr{display:grid;gap:12px}.hth-top{display:grid;gap:6px}.hth-upload{cursor:pointer;justify-self:start}
        .hth-card{display:grid;gap:10px;padding:12px;border-radius:18px;border:1px solid var(--hacc-border);background:var(--hacc-bg)}
        .hth-card header{display:flex;align-items:center;gap:10px}.hth-title{flex:1;min-width:0;display:grid}.hth-title b{font-size:.9rem}.hth-title small{font-size:.7rem;color:var(--hacc-muted)}
        .hth-badge{font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap}
        .hth-badge.on{background:rgba(31,169,113,.14);color:#1FA971}.hth-badge.off{background:var(--hacc-surface);color:var(--hacc-muted)}.hth-badge.wait{background:rgba(232,162,58,.15);color:#B7791F}
        .hth-modes{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:3px;border-radius:12px;background:var(--hacc-surface)}
        .hth-modes button{border:0;background:none;padding:8px 2px;border-radius:9px;font:inherit;font-size:.72rem;font-weight:800;color:var(--hacc-muted);cursor:pointer}
        .hth-modes button[aria-pressed="true"]{background:var(--hacc-bg);color:var(--hacc-accent);box-shadow:0 1px 4px rgba(0,0,0,.1)}
        .hth-modes button[data-mode="forced"][aria-pressed="true"]{color:#B7791F}
        .hth-period{display:grid;grid-template-columns:1fr 1fr;gap:8px}.hth-period label{display:grid;gap:4px;font-size:.72rem;font-weight:700;color:var(--hacc-muted)}
        .hth-period input{font:inherit;font-size:.76rem;padding:8px;border-radius:10px;border:1px solid var(--hacc-border);background:var(--hacc-surface);color:var(--hacc-text);min-width:0}
        .hth-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
        .hth-edited{display:none;margin-inline-end:auto;font-size:.7rem;font-weight:800;color:#B7791F}
        .hth-card.dirty{border-color:rgba(183,121,31,.6);box-shadow:0 0 0 3px rgba(183,121,31,.12)}
        .hth-card.dirty .hth-edited{display:inline}
        .hth-savebar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:4px;border-radius:16px;background:var(--hacc-bg);border:1px solid var(--hacc-border);box-shadow:0 -6px 24px rgba(0,0,0,.12)}
        .hth-savebar [data-role="dirty-count"]{flex:1;font-size:.78rem;font-weight:800;color:var(--hacc-muted)}
        .hth-mgr.has-dirty .hth-savebar{border-color:rgba(183,121,31,.6)}
        .hth-mgr.has-dirty .hth-savebar [data-role="dirty-count"]{color:#B7791F}
        .hth-manage{width:100%;margin-top:10px;justify-content:center;display:inline-flex;align-items:center;gap:8px}
        .hth-manage-host{margin-top:12px}
        @media (max-width:380px){.hth-modes{grid-template-columns:1fr 1fr}.hth-period{grid-template-columns:1fr}}`;
    document.head.appendChild(css);

    window.HubThemes = { evaluate, renderUserSection, renderManager, compile };

    // Start: apply what is in force (hub-core already applied the last one from this device).
    const go = () => evaluate(false).catch(() => {});
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    // Signing in / out, or another page changing the choice: look again.
    window.addEventListener('hub:auth-changed', () => evaluate(true).catch(() => {}));
    window.addEventListener('storage', e => { if (e.key === LIVE_KEY) applyLive(read(LIVE_KEY, null)); });
})(window, document);
