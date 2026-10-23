/**
 * Leaderboard (XP, levels, tiers, trophies) and the resident's XP card in their profile.
 * Data: GET /api/leaderboard?h=&p=today|month|all and GET /api/xp/me (worker/src/xp.js).
 * Used by Home.html (the leaderboard dialog) and hub-panel.js (the profile), which loads it on demand.
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    const A = window.HubAccounts;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const TIER = {
        bronze: { name: 'برونزي', c1: '#b45309', c2: '#f59e0b', k1: '#7c2d12', k2: '#c2410c' },
        silver: { name: 'فضي', c1: '#64748b', c2: '#cbd5e1', k1: '#334155', k2: '#64748b' },
        gold: { name: 'ذهبي', c1: '#d97706', c2: '#fde047', k1: '#92400e', k2: '#d97706' },
        platinum: { name: 'بلاتيني', c1: '#0891b2', c2: '#67e8f9', k1: '#155e75', k2: '#0891b2' },
        diamond: { name: 'ماسي', c1: '#6366f1', c2: '#c4b5fd', k1: '#3730a3', k2: '#6366f1' },
        legend: { name: 'أسطوري', c1: '#db2777', c2: '#f97316', k1: '#9d174d', k2: '#ea580c' },
    };
    const RULES = [['🩺', 'خفارة أدّيتها', 'duty'], ['📞', 'تواصل زميل معك', 'visit'], ['❤️', 'إعجاب على بطاقتك', 'like'], ['💬', 'تعليق على بطاقتك', 'comment'],
        ['🤝', 'خفارة تسلّمتها عن زميل', 'exchange'], ['⚡', 'طلب تواصل أجبته', 'answered'], ['🩸', 'يوم في صالة العمليات', 'theatre'], ['🌟', 'يوم كنت فيه الأكثر تواصلاً', 'topDay']];
    const STAT = { duties: ['🩺', 'خفارات'], visits: ['📞', 'تواصل'], likes: ['❤️', 'إعجابات'], comments: ['💬', 'تعليقات'], exchanges: ['🤝', 'تبديلات'], answered: ['⚡', 'طلبات أُجيبت'], theatre: ['🩸', 'أيام عمليات'], topDays: ['🌟', 'نجم اليوم'] };
    const fmt = n => Number(n || 0).toLocaleString('en-US');
    const levelSpan = l => ({ start: 100 * (l - 1) * l / 2, next: 100 * l * (l + 1) / 2 });

    const CSS = `
    .xp-tabs { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); padding: 4px; border-radius: 14px; background: rgba(142,142,147,.14); margin: 4px 0 12px; }
    .xp-tabs button { position: relative; z-index: 1; border: 0; background: transparent; padding: 8px 0; font: 800 .8rem inherit; font-family: inherit; color: inherit; cursor: pointer; opacity: .65; transition: opacity .2s; }
    .xp-tabs button.on { opacity: 1; }
    .xp-tabs .xp-pill { position: absolute; top: 4px; bottom: 4px; width: calc((100% - 8px) / 3); border-radius: 11px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.12); transition: transform .35s cubic-bezier(.3,1.3,.5,1); }
    body.dark .xp-tabs .xp-pill, html.dark .xp-tabs .xp-pill { background: #2c2c2e; }
    .xp-podium { display: grid; grid-template-columns: 1fr 1.15fr 1fr; align-items: end; gap: 8px; margin: 8px 0 14px; }
    .xp-pod { text-align: center; min-width: 0; }
    .xp-pod .xp-av { position: relative; display: inline-grid; place-items: center; padding: 3px; border-radius: 999px; background: conic-gradient(var(--c1), var(--c2), var(--c1)); animation: xpPop .6s cubic-bezier(.2,1.3,.4,1) both; }
    .xp-pod .xp-av > * { border: 2px solid #fff; border-radius: 999px; }
    body.dark .xp-pod .xp-av > *, html.dark .xp-pod .xp-av > * { border-color: #1c1c1e; }
    .xp-pod .xp-crown { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 1.3rem; animation: xpFloat 2.4s ease-in-out infinite; }
    .xp-pod .xp-pn { font: 800 .74rem/1.3 inherit; font-family: inherit; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xp-pod .xp-px { font: 900 .82rem inherit; font-family: inherit; color: var(--c1); }
    .xp-pod .xp-step { margin-top: 6px; border-radius: 14px 14px 6px 6px; display: grid; place-items: center; color: #fff; font: 900 1.4rem inherit; font-family: inherit;
        box-shadow: inset 0 -6px 0 rgba(0,0,0,.14), 0 8px 18px rgba(0,0,0,.12); transform-origin: bottom; animation: xpRise .7s cubic-bezier(.2,.9,.3,1.2) both; text-shadow: 0 1px 2px rgba(0,0,0,.3); }
    .xp-pod.p1 .xp-step { background: linear-gradient(180deg, #fcd34d, #d97706); }
    .xp-pod.p2 .xp-step { background: linear-gradient(180deg, #e2e8f0, #64748b); }
    .xp-pod.p3 .xp-step { background: linear-gradient(180deg, #fdba74, #b45309); }
    .xp-pod.p1 .xp-step { height: 86px; animation-delay: .15s; } .xp-pod.p2 .xp-step { height: 64px; } .xp-pod.p3 .xp-step { height: 48px; animation-delay: .3s; }
    @keyframes xpRise { from { transform: scaleY(0); } }
    @keyframes xpPop { from { transform: scale(.3); opacity: 0; } }
    @keyframes xpFloat { 50% { transform: translateX(-50%) translateY(-4px) rotate(-6deg); } }
    .xp-row { display: grid; grid-template-columns: 26px 40px 1fr auto; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 16px; background: rgba(142,142,147,.07); border: 1px solid rgba(142,142,147,.14); margin-bottom: 6px; cursor: pointer;
        animation: xpIn .35s ease both; transition: transform .15s; }
    .xp-row:active { transform: scale(.99); }
    .xp-row.me { border-color: #0A84FF; background: rgba(10,132,255,.1); }
    .xp-row .xp-rank { font: 900 .78rem 'JetBrains Mono', monospace; opacity: .55; text-align: center; }
    .xp-row .xp-mid { min-width: 0; display: grid; gap: 3px; }
    .xp-row .xp-nm { font: 800 .8rem inherit; font-family: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xp-row .xp-sub { display: flex; gap: 6px; align-items: center; font-size: .66rem; font-weight: 700; opacity: .75; }
    .xp-lv { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px; color: #fff; font: 900 .62rem inherit; font-family: inherit; background: linear-gradient(135deg, var(--k1), var(--k2)); }
    .xp-bar { height: 5px; border-radius: 99px; background: rgba(142,142,147,.2); overflow: hidden; }
    .xp-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--c1), var(--c2)); transform-origin: right; animation: xpFill .9s cubic-bezier(.2,.9,.3,1) both; }
    @keyframes xpFill { from { transform: scaleX(0); } }
    @keyframes xpIn { from { opacity: 0; transform: translateY(8px); } }
    .xp-row .xp-score { text-align: center; font: 900 .9rem inherit; font-family: inherit; color: var(--c1); }
    .xp-row .xp-score small { display: block; font-size: .58rem; opacity: .7; }
    .xp-detail { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 5px; padding-top: 6px; }
    .xp-detail span { padding: 3px 8px; border-radius: 999px; background: rgba(142,142,147,.12); font-size: .66rem; font-weight: 800; }
    .xp-pin { position: sticky; bottom: 0; padding-top: 6px; background: inherit; }
    .xp-rules { margin-top: 8px; font-size: .72rem; }
    .xp-rules summary { cursor: pointer; font-weight: 800; opacity: .75; }
    .xp-rules ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
    .xp-rules li { padding: 6px 8px; border-radius: 10px; background: rgba(142,142,147,.08); font-weight: 700; display: flex; justify-content: space-between; gap: 6px; }
    .xp-rules li b { color: #10b981; }
    .xp-empty { text-align: center; padding: 26px 10px; opacity: .65; font-weight: 700; font-size: .84rem; }

    /* Profile: the XP card and the trophy shelf. */
    .xp-card { position: relative; overflow: hidden; border-radius: 22px; padding: 16px; margin-bottom: 14px; color: #fff;
        background: radial-gradient(circle at 85% -10%, rgba(255,255,255,.22), transparent 45%), linear-gradient(135deg, var(--k1), var(--k2)); box-shadow: 0 12px 28px rgba(0,0,0,.2); animation: xpIn .4s ease both; }
    .xp-card .xp-top { display: flex; align-items: center; gap: 14px; }
    .xp-ring { --p: 0; width: 74px; height: 74px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
        background: conic-gradient(#fff calc(var(--p) * 1%), rgba(255,255,255,.25) 0); transition: --p 1s; }
    .xp-ring > div { width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; background: rgba(0,0,0,.18); text-align: center; line-height: 1; }
    .xp-ring b { font: 900 1.5rem inherit; font-family: inherit; } .xp-ring small { font-size: .55rem; font-weight: 800; opacity: .9; }
    .xp-card h3 { margin: 0; font: 900 1.05rem inherit; font-family: inherit; }
    .xp-card .xp-meta { font-size: .74rem; font-weight: 700; opacity: .92; margin-top: 2px; }
    .xp-card .xp-bar { margin-top: 10px; height: 8px; background: rgba(255,255,255,.28); }
    .xp-card .xp-bar i { background: #fff; }
    .xp-card .xp-nums { display: flex; justify-content: space-between; font-size: .66rem; font-weight: 800; margin-top: 5px; opacity: .92; }
    .xp-shelf-h { font: 900 .82rem inherit; font-family: inherit; margin: 4px 0 8px; }
    .xp-shelf { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .xp-tro { text-align: center; padding: 10px 4px 8px; border-radius: 16px; background: rgba(142,142,147,.08); border: 1.5px solid rgba(142,142,147,.16); animation: xpIn .4s ease both; }
    .xp-tro .xp-ti { width: 44px; height: 44px; margin: 0 auto 4px; border-radius: 14px; display: grid; place-items: center; font-size: 1.4rem; }
    .xp-tro.t1 .xp-ti { background: linear-gradient(135deg, #b45309, #f59e0b); }
    .xp-tro.t2 .xp-ti { background: linear-gradient(135deg, #64748b, #e2e8f0); }
    .xp-tro.t3 .xp-ti { background: linear-gradient(135deg, #d97706, #fde047); box-shadow: 0 0 16px rgba(253,224,71,.6); }
    .xp-tro.t0 { opacity: .55; } .xp-tro.t0 .xp-ti { background: rgba(142,142,147,.2); filter: grayscale(1); }
    .xp-tro b { display: block; font: 800 .62rem/1.25 inherit; font-family: inherit; }
    .xp-tro small { display: block; font-size: .56rem; font-weight: 700; opacity: .7; margin-top: 2px; }
    @media (max-width: 380px) { .xp-shelf { grid-template-columns: repeat(3, 1fr); } }
    @media (prefers-reduced-motion: reduce) { .xp-row, .xp-card, .xp-tro, .xp-pod .xp-step, .xp-pod .xp-av, .xp-bar i, .xp-pod .xp-crown { animation: none !important; } }
    `;
    if (!document.getElementById('hub-xp-css')) {
        const st = document.createElement('style');
        st.id = 'hub-xp-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    const tierVars = t => { const x = TIER[t] || TIER.bronze; return `--c1:${x.c1};--c2:${x.c2};--k1:${x.k1};--k2:${x.k2}`; };
    const xpText = n => `<bdi dir="ltr">${fmt(n)} XP</bdi>`;
    const avatar = (r, size) => (A && A.avatarHtml ? A.avatarHtml({ name: r.name, avatar: r.avatar, sex: r.sex }, size) : '');
    const specName = (code, hosp) => (Hub.getSpecialtyName ? Hub.getSpecialtyName(code, hosp) : code) || '';

    // ------------------------------------------------------------------
    // The leaderboard (inside a host element; Home.html's dialog)
    // ------------------------------------------------------------------
    const cache = new Map();
    async function leaderboard(host, hosp, period = 'month') {
        host.innerHTML = `<div class="xp-tabs" role="tablist"><span class="xp-pill"></span>
                ${[['today', 'اليوم'], ['month', 'هذا الشهر'], ['all', 'كل الأوقات']].map(([p, l]) => `<button type="button" role="tab" data-p="${p}">${l}</button>`).join('')}</div>
            <div data-role="board"><div class="xp-empty">جاري التحميل…</div></div>
            <details class="xp-rules"><summary>كيف أكسب نقاط الخبرة (XP)؟</summary><ul data-role="rules"></ul></details>`;
        const tabs = host.querySelector('.xp-tabs');
        const board = host.querySelector('[data-role="board"]');
        const select = async p => {
            const i = ['today', 'month', 'all'].indexOf(p);
            tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === p));
            tabs.querySelector('.xp-pill').style.transform = `translateX(${-i * 100}%)`;
            const key = hosp + '|' + p;
            let data = cache.get(key);
            if (!data || Date.now() - data.t > 60000) {
                board.style.opacity = '.5';
                try { data = { t: Date.now(), v: await Hub.api('GET', `/api/leaderboard?h=${encodeURIComponent(hosp)}&p=${p}`, undefined, { retries: 1 }) }; cache.set(key, data); }
                catch (e) { board.style.opacity = ''; board.innerHTML = `<div class="xp-empty">${esc(A && A.errorText ? A.errorText(e) : 'تعذر التحميل')}</div>`; return; }
                board.style.opacity = '';
            }
            paint(board, data.v, hosp);
            const rules = host.querySelector('[data-role="rules"]');
            if (data.v.xpRules) rules.innerHTML = RULES.map(([ic, t, k]) => `<li><span>${ic} ${t}</span><b>+${data.v.xpRules[k]}</b></li>`).join('');
        };
        tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => select(b.dataset.p)));
        await select(period);
    }

    function paint(board, data, hosp) {
        const rows = data.rows || [];
        if (!rows.length) { board.innerHTML = '<div class="xp-empty"><div style="font-size:2rem">🏆</div>لا توجد نقاط في هذه الفترة بعد.</div>'; return; }
        const top = rows.slice(0, 3);
        const order = [top[1], top[0], top[2]];
        const pod = order.map((r, i) => r ? `<div class="xp-pod p${[2, 1, 3][i]}" style="${tierVars(r.tier)}">
                <div class="xp-av">${[2, 1, 3][i] === 1 ? '<span class="xp-crown">👑</span>' : ''}${avatar(r, [2, 1, 3][i] === 1 ? 64 : 52)}</div>
                <div class="xp-pn">${esc(r.name.replace(/^د\.?\s*/, ''))}</div>
                <div class="xp-px">${xpText(r.xp)}</div>
                <div class="xp-step">${[2, 1, 3][i]}</div></div>` : '<div></div>').join('');
        const row = (r, i) => {
            const span = levelSpan(r.level);
            const pct = Math.min(100, Math.round((r.total - span.start) / (span.next - span.start) * 100));
            return `<div class="xp-row ${r.key === 'me' ? 'me' : ''}" style="${tierVars(r.tier)};animation-delay:${Math.min(i, 12) * 35}ms" data-i="${i}">
                <span class="xp-rank">#${r.rank}</span>${avatar(r, 40)}
                <div class="xp-mid"><span class="xp-nm">${esc(r.name)}${r.key === 'me' ? ' (أنت)' : ''}</span>
                    <span class="xp-sub"><span class="xp-lv">Lv ${r.level} · ${esc((TIER[r.tier] || {}).name || '')}</span>${r.trophies ? `🏆 ${r.trophies}` : ''}<span>${esc(specName(r.spec, hosp))}</span></span>
                    <div class="xp-bar"><i style="width:${pct}%"></i></div></div>
                <div class="xp-score">${fmt(r.xp)}<small>XP</small></div></div>`;
        };
        const rest = rows.slice(3);
        board.innerHTML = `<div class="xp-podium">${pod}</div>${rest.map((r, i) => row(r, i)).join('')}${data.me ? `<div class="xp-pin">${row(data.me, 0)}</div>` : ''}`;
        // Tap a row: what the points came from.
        board.querySelectorAll('.xp-row').forEach(el => el.addEventListener('click', () => {
            const r = el.closest('.xp-pin') ? data.me : rest[Number(el.dataset.i)];
            const open = el.querySelector('.xp-detail');
            if (open) { open.remove(); return; }
            const d = document.createElement('div');
            d.className = 'xp-detail';
            d.innerHTML = Object.entries(r.stats || {}).filter(([, v]) => v).map(([k, v]) => `<span>${STAT[k][0]} ${fmt(v)} ${STAT[k][1]}</span>`).join('') || '<span>—</span>';
            el.appendChild(d);
        }));
    }

    // ------------------------------------------------------------------
    // The profile: XP card and trophies
    // ------------------------------------------------------------------
    async function profileCard(host) {
        host.innerHTML = '<div class="xp-empty">جاري تحميل نقاطك…</div>';
        let me;
        try { me = await Hub.api('GET', '/api/xp/me', undefined, { retries: 1 }); }
        catch (e) { host.innerHTML = ''; return; }
        if (!me || me.none) { host.innerHTML = ''; return; }
        const pct = Math.min(100, Math.round((me.xp - me.levelStart) / Math.max(1, me.levelNext - me.levelStart) * 100));
        const earned = me.trophies.filter(t => t.tier).length;
        host.innerHTML = `<div class="xp-card" style="${tierVars(me.tier.id)}">
                <div class="xp-top"><div class="xp-ring" style="--p:${pct}"><div><b>${me.level}</b><small>المستوى</small></div></div>
                    <div><h3>${esc(me.tier.name)} · ${xpText(me.xp)}</h3>
                    <div class="xp-meta">هذا الشهر <bdi dir="ltr">+${fmt(me.monthXp)} XP</bdi> · ${earned} من ${me.trophies.length} كؤوس</div></div></div>
                <div class="xp-bar"><i style="width:${pct}%"></i></div>
                <div class="xp-nums"><span><bdi dir="ltr">${fmt(me.xp - me.levelStart)} / ${fmt(me.levelNext - me.levelStart)}</bdi></span><span>المستوى ${me.level + 1} بعد ${xpText(me.levelNext - me.xp)}</span></div>
            </div>
            <div class="xp-shelf-h">🏆 كؤوسي</div>
            <div class="xp-shelf">${me.trophies.map((t, i) => `<div class="xp-tro t${t.tier}" style="animation-delay:${i * 40}ms" title="${esc(t.desc)}: ${fmt(t.value)}">
                <div class="xp-ti">${t.icon}</div><b>${esc(t.name)}</b>
                <small>${t.tier ? esc(t.tierName) : ''}${t.next ? `${t.tier ? ' · ' : ''}${fmt(t.value)}/${fmt(t.next)}` : ' · مكتملة ✓'}</small></div>`).join('')}</div>`;
    }

    window.HubXP = { leaderboard, profileCard };
})(window, document);
