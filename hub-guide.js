/*
 * The Basra clinics guide (دليل البصرة الطبي): private clinics of specialist doctors, their addresses,
 * working times and booking numbers, plus centres, labs, pharmacies and other services.
 * Opened from the Specialists page (HubGuide.open()); loaded there on first use with hub-guide.css.
 *
 * Data: GET /api/guide (worker/src/guide.js), signed-in users only. The page keeps its copy in the
 * Cache Storage and asks the server at most every 6 hours whether a newer one was uploaded (one
 * row read), so opening the guide costs nothing most of the time. The owner uploads a new copy
 * (guide.json from tools/guide/pdf_to_guide.py) with the upload button in the guide's top bar.
 */
(function () {
    'use strict';
    if (window.HubGuide) return;

    const CACHE = 'hub-guide-v1';
    const CACHE_URL = new URL('./__hub_guide__.json', location.href).href;
    const META_KEY = 'hub_guide_meta';           // { v, at, n }: version, last check, number of entries
    const CHECK_MS = 6 * 60 * 60 * 1000;
    const PAGE = 40;

    // Areas: the first part of an address, with the guide's spellings brought together.
    const AREAS = [
        ['بريهة', /^(بريهه|بيهه|بر)$|^بريهه/], ['العباسية', /^العباسيه/], ['الزبير', /^الزبير/], ['الجنينة', /^الجنينه/],
        ['الجزائر', /^(تقاطع |تثاطع )?الجزائر/], ['العشار', /^ال?عشار/], ['خمسة ميل', /^خم[سي]ه ميل/], ['شارع السعدي', /^(شارع|شلرع) السعدي/],
        ['القرنة', /^القرنه/], ['التنومة', /^(ال)?تن?ومه/], ['القبلة', /^القبله/], ['الطويسة', /^الطويسه/],
        ['أبو الخصيب', /^(ابي|ابو) الخصيب/], ['الجمهورية', /^(تقاطع )?الجمهوريه/], ['الحيانية', /^الحيانيه/], ['كرمة علي', /^(كرمه علي|الكرمه)/],
        ['البصرة القديمة', /^البصره القديمه/], ['الدير', /^الدير$/], ['المطيحة', /^المطيحه/], ['الجبيلة', /^الجبيله/],
        ['الجزيرة', /^الجزيره/], ['الجمعيات', /^الجمعيات|^حي الخليج/], ['المدينة', /^(قضاء )?المدينه/], ['الحكيمية', /^الحكيميه/],
        ['مناوي باشا', /^مناوي باشا/], ['المعقل', /^المعقل/], ['ياسين خريبط', /^ياسين خريبط/], ['حي الحسين', /حي الحسين/],
        ['البراضعية', /^(ال)?براضعيه/], ['المشراق', /^(تقاطع )?المشراق/], ['الأصمعي', /^الاصمعي/], ['الفاو', /^الفاو/],
        ['شط العرب', /^شط العرب/], ['الساعي', /^الساعي/], ['التحسينية', /^التحسينيه/], ['حي الخضراء', /^حي الخضراء/],
        ['العالية', /^العاليه/], ['مجمع الأمل السكني', /^(مجمع|مدينه) الامل/], ['الأربع شوارع', /^الاربع شوارع/], ['سفوان', /^سفوان/],
        ['أم قصر', /^ام قصر/], ['الهارثة', /^الهارثه/], ['حي الجامعة', /^حي الجامعه/], ['الأبلة', /^الابله/],
    ];

    // ------------------------------------------------------------------ helpers
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
    /** Search form of Arabic text: no diacritics or tatweel, one form of alef / ta marbuta / yaa. */
    function norm(s) {
        return String(s || '').toLowerCase()
            .replace(/[ً-ٰٟـ]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
            .replace(/[٠-٩۰-۹]/g, d => DIGITS[d])
            .replace(/\s+/g, ' ').trim();
    }
    const fmtN = n => Number(n).toLocaleString('en-US');
    const PHONE_RE = /(?<!\d)0?7\d{9}(?!\d)/g;
    const telOf = p => (p.startsWith('0') ? p : '0' + p);
    const waOf = p => 'https://wa.me/964' + telOf(p).slice(1);
    function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { return null; } }
    function writeMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {} }
    const isOwner = () => { try { return !!(window.Hub && Hub.auth && Hub.auth.isOwner && Hub.auth.isOwner()); } catch (e) { return false; } };

    // ------------------------------------------------------------------ data
    let G = null;          // the guide: { title, edition, ..., cats, secs, items }
    let ENTRIES = [];      // prepared items
    let loading = null;

    async function cacheRead() {
        try {
            if (!('caches' in window)) return null;
            const c = await caches.open(CACHE);
            const res = await c.match(CACHE_URL);
            return res ? await res.json() : null;
        } catch (e) { return null; }
    }
    async function cacheWrite(obj) {
        try {
            if (!('caches' in window)) return;
            const c = await caches.open(CACHE);
            await c.put(CACHE_URL, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }));
        } catch (e) {}
    }

    function areaOf(addr) {
        const first = norm(String(addr || '').split(/\s*[-–]\s*|\s+\.\s+/)[0]);
        for (const [name, re] of AREAS) if (re.test(first)) return name;
        return '';
    }

    function prepare(g) {
        G = g;
        const secs = g.secs || [], cats = g.cats || [];
        ENTRIES = (g.items || []).map((it, i) => {
            const sec = secs[it[0]] || [0, '', 'd', '', 0];
            const cat = cats[sec[0]] || ['', '', ''];
            const name = it[1] || '', addr = it[2] || '', note = it[4] || '';
            const phones = (it[3] || '').split(/\s+/).filter(Boolean);
            const fem = sec[3] === 'f' || /^(دكتوره|دكتورة|الدكتورة|طبيبة)\s/.test(name);
            const area = areaOf(addr);
            const notePhones = (note.match(PHONE_RE) || []).map(telOf);
            return {
                i, sec: it[0], cat: sec[0], kind: sec[2], sub: !!sec[4], fem, name, addr, note, phones, area,
                label: sec[1], catName: cat[1],
                nName: norm(name),
                nAll: norm([name, sec[1], cat[1], addr, area, note].join(' ')) + ' ' + phones.concat(notePhones).join(' ') + ' '
                    + phones.concat(notePhones).map(p => p.slice(1)).join(' '),
            };
        });
    }

    /** The guide from the device's copy, then from the server when the copy is old or missing. */
    async function load(force) {
        if (loading) return loading;
        loading = (async () => {
            if (!G) {
                const c = await cacheRead();
                if (c && c.guide) prepare(c.guide);
            }
            const meta = readMeta() || {};
            const stale = force || !G || !meta.at || Date.now() - meta.at > CHECK_MS;
            if (!stale) return;
            try {
                const res = await Hub.api('GET', '/api/guide?v=' + encodeURIComponent(G ? (meta.v || 0) : 0), undefined, { retries: 1 });
                if (res && res.none) { writeMeta({ v: 0, at: 0, n: 0 }); return; }
                if (res && res.guide) {
                    prepare(res.guide);
                    await cacheWrite({ v: res.v, guide: res.guide });
                }
                writeMeta({ v: res && res.v || meta.v || 0, at: Date.now(), n: ENTRIES.length });
            } catch (e) {
                if (!G) throw e;   // offline with a copy: show the copy
            }
        })().finally(() => { loading = null; });
        return loading;
    }

    // ------------------------------------------------------------------ state + view
    const st = { q: '', kind: 'all', cat: -1, sec: -1, area: '', fem: false, shown: PAGE };
    let root = null, els = {}, results = [], observer = null, searchTimer = 0;

    function build() {
        root = document.createElement('div');
        root.className = 'hgd';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'دليل العيادات الطبية');
        root.innerHTML = `
            <header class="hgd-top">
                <button type="button" class="hgd-icon-btn" data-close aria-label="إغلاق الدليل"><i class="fas fa-arrow-right"></i></button>
                <div class="hgd-titles"><h2>دليل العيادات الطبية · البصرة</h2><p data-sub>جاري التحميل…</p></div>
                <button type="button" class="hgd-icon-btn" data-upload title="رفع نسخة جديدة من الدليل" hidden><i class="fas fa-upload"></i></button>
                <input type="file" accept=".json,application/json" data-file hidden>
            </header>
            <div class="hgd-tools">
                <div class="hgd-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input type="search" data-q enterkeyhint="search" autocomplete="off" placeholder="ابحث باسم الطبيب، الاختصاص، المنطقة أو الرقم">
                    <button type="button" class="hgd-clear" data-clearq aria-label="مسح البحث"><i class="fas fa-circle-xmark"></i></button>
                </div>
                <div class="hgd-row">
                    <div class="hgd-seg" data-kind>
                        <button type="button" data-k="all" class="on">الكل</button>
                        <button type="button" data-k="d">الأطباء</button>
                        <button type="button" data-k="p">المراكز والخدمات</button>
                    </div>
                </div>
                <div class="hgd-row">
                    <select class="hgd-select" data-area aria-label="المنطقة" style="flex:1;max-width:none"><option value="">كل المناطق</option></select>
                    <button type="button" class="hgd-toggle" data-fem aria-pressed="false"><i class="fas fa-venus"></i> طبيبات فقط</button>
                </div>
                <div class="hgd-chips" data-chips></div>
            </div>
            <div class="hgd-body" data-body><div class="hgd-wrap" data-wrap></div></div>`;
        document.body.appendChild(root);
        const $ = s => root.querySelector(s);
        els = { sub: $('[data-sub]'), q: $('[data-q]'), search: $('.hgd-search'), area: $('[data-area]'), fem: $('[data-fem]'),
            chips: $('[data-chips]'), body: $('[data-body]'), wrap: $('[data-wrap]'), kind: $('[data-kind]'),
            upload: $('[data-upload]'), file: $('[data-file]') };

        $('[data-close]').addEventListener('click', close);
        els.q.addEventListener('input', () => {
            els.search.classList.toggle('has', !!els.q.value);
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { st.q = els.q.value; st.shown = PAGE; render(true); }, 140);
        });
        els.q.addEventListener('keydown', e => { if (e.key === 'Enter') els.q.blur(); });
        $('[data-clearq]').addEventListener('click', () => { els.q.value = ''; els.search.classList.remove('has'); st.q = ''; st.shown = PAGE; render(true); els.q.focus(); });
        els.kind.addEventListener('click', e => {
            const b = e.target.closest('[data-k]'); if (!b) return;
            st.kind = b.dataset.k; st.cat = -1; st.sec = -1; st.shown = PAGE;
            if (st.kind === 'p') st.fem = false;
            render(true);
        });
        els.area.addEventListener('change', () => { st.area = els.area.value; st.shown = PAGE; render(true); });
        els.fem.addEventListener('click', () => { st.fem = !st.fem; if (st.fem && st.kind === 'p') st.kind = 'all'; st.shown = PAGE; render(true); });
        els.chips.addEventListener('click', e => {
            const b = e.target.closest('[data-chip]'); if (!b) return;
            const [t, v] = b.dataset.chip.split(':');
            if (t === 'home') { st.cat = -1; st.sec = -1; }
            else if (t === 'cat') { st.cat = +v; st.sec = -1; }
            else if (t === 'sec') { st.sec = +v === st.sec ? -1 : +v; }
            st.shown = PAGE; render(true);
        });
        els.wrap.addEventListener('click', e => {
            const t = e.target.closest('[data-cat]');
            if (t) { st.cat = +t.dataset.cat; st.sec = -1; st.shown = PAGE; render(true); return; }
            if (e.target.closest('[data-reset]')) { resetFilters(); render(true); return; }
            if (e.target.closest('[data-retry]')) { start(true); }
        });
        els.upload.addEventListener('click', () => els.file.click());
        els.file.addEventListener('change', upload);
        root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    }

    function resetFilters() {
        Object.assign(st, { q: '', kind: 'all', cat: -1, sec: -1, area: '', fem: false, shown: PAGE });
        els.q.value = ''; els.search.classList.remove('has');
    }

    function fillAreas() {
        const counts = new Map();
        ENTRIES.forEach(e => { if (e.area) counts.set(e.area, (counts.get(e.area) || 0) + 1); });
        const list = [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
        els.area.innerHTML = '<option value="">كل المناطق</option>' + list.map(([a, n]) => `<option value="${esc(a)}">${esc(a)} (${n})</option>`).join('');
        els.area.value = st.area;
    }

    function subtitle() {
        if (!G) return '';
        const docs = ENTRIES.filter(e => e.kind === 'd').length;
        return `${fmtN(docs)} طبيب · ${fmtN(ENTRIES.length - docs)} مركز وخدمة` + (G.edition ? ` · تحديث ${esc(G.edition)}` : '');
    }

    function filtered() {
        const toks = norm(st.q).split(' ').filter(Boolean);
        const out = [];
        for (const e of ENTRIES) {
            if (st.kind !== 'all' && e.kind !== st.kind) continue;
            if (st.cat >= 0 && e.cat !== st.cat) continue;
            if (st.sec >= 0 && e.sec !== st.sec) continue;
            if (st.area && e.area !== st.area) continue;
            if (st.fem && !e.fem) continue;
            let score = 0, ok = true;
            for (const t of toks) {
                if (!e.nAll.includes(t)) { ok = false; break; }
                score += e.nName.includes(t) ? 3 : 1;
            }
            if (ok) out.push([score, e]);
        }
        if (toks.length) out.sort((a, b) => b[0] - a[0] || a[1].i - b[1].i);
        return out.map(x => x[1]);
    }

    function chipsHtml() {
        if (st.cat < 0) return '';
        const secs = new Map();
        ENTRIES.forEach(e => { if (e.cat === st.cat) secs.set(e.sec, (secs.get(e.sec) || 0) + 1); });
        const cat = G.cats[st.cat] || [];
        let h = `<button type="button" class="hgd-chip back" data-chip="home"><i class="fas fa-chevron-right"></i> كل الأقسام</button>`
            + `<button type="button" class="hgd-chip ${st.sec < 0 ? 'on' : ''}" data-chip="cat:${st.cat}"><i class="fas ${esc(cat[2] || 'fa-notes-medical')}"></i> ${esc(cat[1])}</button>`;
        if (secs.size > 1) {
            for (const [s, n] of secs) {
                const sec = G.secs[s];
                h += `<button type="button" class="hgd-chip ${st.sec === s ? 'on' : ''}" data-chip="sec:${s}">${esc(sec[1])} <span class="n">${n}</span></button>`;
            }
        }
        return h;
    }

    function homeHtml() {
        const n = new Map();
        ENTRIES.forEach(e => n.set(e.cat, (n.get(e.cat) || 0) + 1));
        const kindOf = ci => { const s = G.secs.find(s => s[0] === ci); return s ? s[2] : 'd'; };
        const tile = (c, ci) => `<button type="button" class="hgd-tile ${kindOf(ci)}" data-cat="${ci}"><i class="fas ${esc(c[2] || 'fa-notes-medical')}"></i><span><b>${esc(c[1])}</b><small>${fmtN(n.get(ci) || 0)} ${kindOf(ci) === 'd' ? 'طبيب' : 'عنوان'}</small></span></button>`;
        const docs = G.cats.map((c, i) => [c, i]).filter(([, i]) => n.get(i) && kindOf(i) === 'd' && (st.kind !== 'p'));
        const places = G.cats.map((c, i) => [c, i]).filter(([, i]) => n.get(i) && kindOf(i) === 'p' && (st.kind !== 'd'));
        let h = '';
        if (docs.length) h += `<div class="hgd-h">الأطباء حسب الاختصاص</div><div class="hgd-grid">${docs.map(x => tile(...x)).join('')}</div>`;
        if (places.length) h += `<div class="hgd-h">المراكز والخدمات الطبية</div><div class="hgd-grid">${places.map(x => tile(...x)).join('')}</div>`;
        return h + aboutHtml();
    }

    function aboutHtml() {
        const contact = G.contact ? `<a href="${esc(waOf(G.contact))}" target="_blank" rel="noopener" style="color:inherit;font-weight:800;direction:ltr;unicode-bidi:isolate">${esc(G.contact)}</a>` : '';
        return `<div class="hgd-about">
            <b>المصدر:</b> ${esc(G.title || 'دليل البصرة الطبي')}${G.edition ? ' (آخر تحديث ' + esc(G.edition) + ')' : ''}${G.org ? ' — ' + esc(G.org) : ''}${G.author ? '، إعداد ' + esc(G.author) : ''}.<br>
            ${contact ? 'للإضافة أو الحذف أو تصحيح معلومة: مراسلة معدّ الدليل على الواتساب ' + contact + '.<br>' : ''}
            <span class="warn">الأرقام والأوقات كما وردت في الدليل وقد تتغير؛ يُستحسن الاتصال قبل الذهاب.</span>
        </div>`;
    }

    function hl(text, toks) {
        let h = esc(text);
        if (!toks.length) return h;
        // highlight the plain (unnormalised) words that start a query word; good enough for names
        for (const t of toks) {
            if (t.length < 2 || !/[ء-ي]/.test(t)) continue;
            const re = new RegExp('(' + [...t].map(ch => {
                const alts = { 'ا': '[اأإآٱ]', 'ه': '[هة]', 'ي': '[يىئ]', 'و': '[وؤ]' }[ch];
                return alts || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }).join('\\u0640?') + ')', 'g');
            h = h.replace(re, '<mark class="hgd-hl">$1</mark>');
        }
        return h;
    }

    function noteHtml(note) {
        let h = esc(note);
        h = h.replace(/(?<!\d)0?7\d{9}(?!\d)/g, p => `<a href="tel:${telOf(p)}">${telOf(p)}</a>`);
        h = h.replace(/((?:(?:يوم|أيام|ايام)\s)?(?:ال)?(?:سبت|احد|أحد|اثنين|الاثنين|ثلاثاء|اربعاء|أربعاء|خميس|جمعة)(?:\s?(?:و|و\s)(?:ال)?(?:سبت|احد|أحد|اثنين|ثلاثاء|اربعاء|أربعاء|خميس|جمعة))*\s+عطلة(?:\s+العيادة)?)/g, '<span class="off">$1</span>');
        return h;
    }

    function cardHtml(e, toks) {
        const icon = e.kind === 'p' ? `fas ${esc((G.cats[e.cat] || [])[2] || 'fa-house-medical')}` : (e.fem ? 'fas fa-user-nurse' : 'fas fa-user-doctor');
        const spec = esc(e.label === e.catName || e.label.includes(e.catName) ? e.label : e.catName + ' · ' + e.label);
        const phones = e.phones.length
            ? e.phones.map(p => `<span class="hgd-ph"><a class="hgd-call" href="tel:${esc(p)}"><i class="fas fa-phone"></i><span>${esc(p)}</span></a><a class="hgd-wa" href="${esc(waOf(p))}" target="_blank" rel="noopener" aria-label="واتساب ${esc(p)}"><i class="fab fa-whatsapp"></i></a></span>`).join('')
            : '<span class="hgd-nophone"><i class="fas fa-phone-slash"></i> لا يوجد رقم في الدليل</span>';
        return `<article class="hgd-card">
            <div class="hgd-head">
                <div class="hgd-av ${e.kind === 'p' ? 'p' : e.fem ? 'f' : ''}"><i class="${icon}"></i></div>
                <div style="min-width:0"><h3 class="hgd-name">${hl(e.name, toks)}</h3>
                <div class="hgd-spec">${spec}${e.sub ? '<span class="hgd-badge">اختصاص دقيق</span>' : ''}</div></div>
            </div>
            ${e.addr ? `<div class="hgd-addr"><i class="fas fa-location-dot"></i><div>${hl(e.addr, toks)}</div></div>` : ''}
            ${e.note ? `<div class="hgd-note">${noteHtml(e.note)}</div>` : ''}
            <div class="hgd-actions">${phones}</div>
        </article>`;
    }

    function render(resetScroll) {
        if (!root) return;
        els.sub.textContent = subtitle();
        els.kind.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === st.kind));
        els.fem.classList.toggle('on', st.fem);
        els.fem.setAttribute('aria-pressed', String(st.fem));
        els.area.value = st.area;
        els.upload.hidden = !isOwner();
        if (resetScroll) els.body.scrollTop = 0;
        if (observer) { observer.disconnect(); observer = null; }
        if (!G || !ENTRIES.length) { els.chips.innerHTML = ''; return; }
        els.chips.innerHTML = chipsHtml();
        const home = !st.q.trim() && st.cat < 0 && !st.area && !st.fem;
        if (home) { els.wrap.innerHTML = homeHtml(); return; }
        results = filtered();
        if (!results.length) {
            els.wrap.innerHTML = `<div class="hgd-empty"><i class="fas fa-magnifying-glass"></i>لا توجد نتائج مطابقة.<br>جرّب كلمة أقصر أو امسح بعض الفلاتر.<br><button type="button" class="hgd-btn" data-reset>مسح الفلاتر</button></div>`;
            return;
        }
        const toks = norm(st.q).split(' ').filter(Boolean);
        const list = results.slice(0, st.shown);
        els.wrap.innerHTML = `<div class="hgd-count">${fmtN(results.length)} نتيجة</div><div class="hgd-list">${list.map(e => cardHtml(e, toks)).join('')}</div>`
            + (results.length > st.shown ? '<div class="hgd-more" data-more></div>' : `<div class="hgd-foot">— نهاية النتائج —</div>`);
        const more = els.wrap.querySelector('[data-more]');
        if (more && 'IntersectionObserver' in window) {
            observer = new IntersectionObserver(ents => {
                if (!ents.some(x => x.isIntersecting)) return;
                observer.disconnect(); observer = null;
                appendMore(toks);
            }, { root: els.body, rootMargin: '600px' });
            observer.observe(more);
        }
    }

    function appendMore(toks) {
        const from = st.shown;
        st.shown += PAGE;
        const list = els.wrap.querySelector('.hgd-list');
        const more = els.wrap.querySelector('[data-more]');
        if (!list || !more) return;
        list.insertAdjacentHTML('beforeend', results.slice(from, st.shown).map(e => cardHtml(e, toks)).join(''));
        if (results.length > st.shown) {
            observer = new IntersectionObserver(ents => {
                if (!ents.some(x => x.isIntersecting)) return;
                observer.disconnect(); observer = null;
                appendMore(toks);
            }, { root: els.body, rootMargin: '600px' });
            observer.observe(more);
        } else {
            more.outerHTML = '<div class="hgd-foot">— نهاية النتائج —</div>';
        }
    }

    function message(html) {
        els.chips.innerHTML = '';
        els.wrap.innerHTML = `<div class="hgd-empty">${html}</div>`;
    }

    async function start(force) {
        if (!G) message('<i class="fas fa-spinner fa-spin"></i>جاري تحميل الدليل…');
        try {
            await load(force);
            if (!G || !ENTRIES.length) {
                els.sub.textContent = '';
                els.upload.hidden = !isOwner();
                message('<i class="fas fa-book-medical"></i>لم يُرفع الدليل بعد.' + (isOwner() ? '<br>ارفع ملف guide.json من زر الرفع في الأعلى.' : ''));
                return;
            }
            fillAreas();
            render(false);
        } catch (e) {
            message('<i class="fas fa-wifi"></i>تعذّر تحميل الدليل. تحقق من الاتصال.<br><button type="button" class="hgd-btn" data-retry>إعادة المحاولة</button>');
        }
    }

    async function upload() {
        const f = els.file.files && els.file.files[0];
        els.file.value = '';
        if (!f) return;
        let guide;
        try { guide = JSON.parse(await f.text()); } catch (e) { alert('الملف ليس JSON صالحاً.'); return; }
        if (!guide || !Array.isArray(guide.items)) { alert('هذا ليس ملف الدليل (guide.json).'); return; }
        if (!confirm(`رفع نسخة جديدة من الدليل فيها ${fmtN(guide.items.length)} عنواناً؟ ستحل محل النسخة الحالية لكل المستخدمين.`)) return;
        els.upload.disabled = true;
        try {
            const res = await Hub.api('POST', '/api/guide', { guide }, { retries: 0 });
            writeMeta({ v: 0, at: 0, n: res.items || 0 });
            G = null; ENTRIES = [];
            await start(true);
            alert(`تم رفع الدليل: ${fmtN(res.items || 0)} عنواناً.`);
        } catch (e) {
            alert('تعذّر رفع الدليل: ' + (e && e.message || e));
        } finally { els.upload.disabled = false; }
    }

    function open(opts) {
        if (!root) build();
        if (opts && opts.q != null) { st.q = String(opts.q); els.q.value = st.q; els.search.classList.toggle('has', !!st.q); }
        root.classList.add('open');
        document.documentElement.classList.add('hgd-lock');
        render(false);
        start(false);
    }
    function close() {
        if (!root) return;
        root.classList.remove('open');
        document.documentElement.classList.remove('hgd-lock');
        if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
    }

    window.HubGuide = { open, close, meta: readMeta };
})();
