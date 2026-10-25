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
    const RULES = [['📞', 'تواصل زميل معك', 'visit'], ['🩺', 'خفارة أدّيتها', 'duty'], ['🩸', 'يوم في صالة العمليات', 'theatre'], ['🚑', 'يوم خرجت فيه لاستشارة', 'consult'],
        ['⚡', 'طلب تواصل أجبته', 'answered'], ['🤝', 'خفارة تسلّمتها عن زميل', 'exchange'], ['🌟', 'يوم كنت فيه الأكثر نشاطاً', 'topDay'], ['👑', 'شهر كنت فيه مقيم الشهر', 'monthTop'],
        ['❤️', 'إعجاب على بطاقتك', 'like'], ['💬', 'تعليق على بطاقتك', 'comment'], ['💖', 'شهر كنت فيه الأكثر شعبية', 'popular']];
    const STAT = { duties: ['🩺', 'خفارات'], visits: ['📞', 'تواصل'], likes: ['❤️', 'إعجابات'], comments: ['💬', 'تعليقات'], exchanges: ['🤝', 'تبديلات'], answered: ['⚡', 'طلبات أُجيبت'], theatre: ['🩸', 'أيام عمليات'], consults: ['🚑', 'استشارات'], topDays: ['🌟', 'نجم اليوم'], monthTops: ['👑', 'مقيم الشهر'], populars: ['💖', 'الأكثر شعبية'] };
    const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const monthName = ym => MONTHS[Number(String(ym).slice(5, 7)) - 1] || '';
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
    .xp-star { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 12px; border-radius: 16px; color: #78350f;
        background: linear-gradient(135deg, #fef3c7, #fde68a 55%, #fbbf24); box-shadow: 0 6px 20px rgba(217,119,6,.25); }
    .xp-star-i { font-size: 1.9rem; filter: drop-shadow(0 2px 4px rgba(146,64,14,.35)); }
    .xp-star b { display: block; font-size: .98rem; font-weight: 900; }
    .xp-star small { display: block; font-size: .7rem; font-weight: 700; opacity: .8; }
    .roster-card.xp-month-star .card-front { box-shadow: 0 0 0 2px #fbbf24, 0 0 18px rgba(251,191,36,.55); }
    .xp-month-badge { position: absolute; top: 8px; inset-inline-start: 8px; z-index: 3; padding: 2px 8px; border-radius: 999px; font-size: .62rem; font-weight: 900;
        color: #78350f; background: linear-gradient(135deg, #fde68a, #fbbf24); box-shadow: 0 2px 8px rgba(217,119,6,.35); pointer-events: none; }
    .xp-tro { font: inherit; color: inherit; cursor: pointer; width: 100%; }
    .xp-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; justify-content: inherit; }
    .xp-pod .xp-badges { justify-content: center; }
    .xp-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px; font-size: .58rem; font-weight: 900; white-space: nowrap; }
    .xp-badge.b-likes { background: #ffe4e6; color: #be123c; } .xp-badge.b-comments { background: #e0f2fe; color: #0369a1; }
    .xp-badge.b-popular { background: #fce7f3; color: #9d174d; } .xp-badge.b-star { background: #fef3c7; color: #92400e; }
    .xp-me { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 12px; border-radius: 18px; position: sticky; top: 0; z-index: 2;
        background: linear-gradient(135deg, var(--k1, #334155), var(--k2, #64748b)); color: #fff; box-shadow: 0 8px 22px rgba(0,0,0,.18); animation: xpIn .35s ease both; }
    .xp-me.none { background: rgba(142,142,147,.14); color: inherit; box-shadow: none; position: static; }
    .xp-me-rank { min-width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; font-size: 1.15rem; font-weight: 900; background: rgba(255,255,255,.2); }
    .xp-me.none .xp-me-rank { background: rgba(142,142,147,.2); }
    .xp-me-mid { flex: 1; min-width: 0; }
    .xp-me b { display: block; font-size: .9rem; font-weight: 900; }
    .xp-me small { display: block; font-size: .7rem; font-weight: 700; opacity: .9; line-height: 1.5; }
    .xp-me .xp-badge { background: rgba(255,255,255,.92); }
    .xp-me .xp-score { text-align: center; font: 900 1rem inherit; font-family: inherit; color: #fff; }
    .xp-me .xp-score small { display: block; font-size: .58rem; opacity: .8; }
    .xp-tro.sel { border-color: #0A84FF; box-shadow: 0 0 0 3px rgba(10,132,255,.18); }
    .xp-how { margin: -4px 0 14px; padding: 12px 14px; border-radius: 16px; background: rgba(10,132,255,.07); border: 1px solid rgba(10,132,255,.25); animation: xpIn .3s ease both; }
    .xp-how-h { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .xp-how-i { font-size: 1.6rem; }
    .xp-how-h b { display: block; font-size: .9rem; font-weight: 900; }
    .xp-how-h small, .xp-how-n { display: block; font-size: .7rem; font-weight: 700; opacity: .75; }
    .xp-how p { margin: 0 0 8px; font-size: .78rem; font-weight: 700; line-height: 1.6; }
    .xp-how-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
    .xp-how-steps span { text-align: center; padding: 6px 4px; border-radius: 10px; background: rgba(142,142,147,.1); font-size: .66rem; font-weight: 800; opacity: .6; }
    .xp-how-steps span.on { opacity: 1; background: rgba(250,204,21,.22); }
    .xp-how-steps b { display: block; font-size: .8rem; }
    .xp-rules-note { margin: 6px 0; font-size: .72rem; font-weight: 700; opacity: .8; line-height: 1.6; }
    .xp-star.xp-pop { color: #831843; background: linear-gradient(135deg, #fce7f3, #fbcfe8 55%, #f9a8d4); box-shadow: 0 6px 20px rgba(219,39,119,.22); }
    .xp-pop-badge { position: absolute; top: 8px; inset-inline-start: 8px; z-index: 3; padding: 2px 8px; border-radius: 999px; font-size: .62rem; font-weight: 900;
        color: #831843; background: linear-gradient(135deg, #fbcfe8, #f472b6); box-shadow: 0 2px 8px rgba(219,39,119,.35); pointer-events: none; }
    .roster-card.xp-month-star .xp-pop-badge { top: 30px; }
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
            <details class="xp-rules"><summary>كيف أكسب نقاط الخبرة (XP)؟</summary><p class="xp-rules-note">النشاط أولاً: تواصل الزملاء معك يُحسب أكثر قليلاً من الخفارة نفسها، والإعجابات والتعليقات تُحسب قليلاً فقط. مقيم اليوم والشهر هو الأكثر نشاطاً.</p><ul data-role="rules"></ul></details>`;
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

    // Social and title badges, on any row (not only the podium).
    const BADGE = { likes: ['❤️', 'الأكثر إعجاباً', 'الأكثر إعجاباً في هذه الفترة'], comments: ['💬', 'الأكثر تعليقاً', 'الأكثر تعليقاً على بطاقاته في هذه الفترة'],
        popular: ['💖', 'الأكثر شعبية', 'الأكثر شعبية الشهر الماضي'], star: ['👑', 'مقيم الشهر', 'الأكثر نشاطاً الشهر الماضي'] };
    const badgesHtml = r => (r.badges || []).map(b => `<span class="xp-badge b-${b}" title="${esc(BADGE[b][2])}">${BADGE[b][0]} ${esc(BADGE[b][1])}</span>`).join('');
    const PERIOD = { today: 'اليوم', month: 'هذا الشهر', all: 'كل الأوقات' };
    function rankCard(data) {
        const m = data.mine;
        if (!m) return '';
        if (m.none) return `<div class="xp-me none"><span class="xp-me-rank">—</span><div><b>ترتيبك ${PERIOD[data.period] || ''}</b><small>لا نقاط لك في هذه الفترة بعد. التواصل معك أثناء خفاراتك هو أسرع طريق للصعود.</small></div></div>`;
        const medal = m.rank <= 3 ? ['🥇', '🥈', '🥉'][m.rank - 1] : '';
        return `<div class="xp-me" style="${tierVars(m.tier)}">
            <span class="xp-me-rank">${medal || '#' + m.rank}</span>
            <div class="xp-me-mid"><b>ترتيبك ${PERIOD[data.period] || ''}: ${m.rank} من ${m.of}</b>
                <small>${m.rank === 1 ? 'أنت في الصدارة 🎉' : `أعلى من ${m.beats}% من الزملاء · تحتاج <bdi dir="ltr">${fmt(m.gap)} XP</bdi> لتتجاوز ${esc(String(m.aboveName || '').replace(/^د\.?\s*/, ''))}`}</small>
                ${badgesHtml(m) ? `<div class="xp-badges">${badgesHtml(m)}</div>` : ''}</div>
            <div class="xp-score">${fmt(m.xp)}<small>XP</small></div></div>`;
    }

    function paint(board, data, hosp) {
        const rows = data.rows || [];
        if (!rows.length) { board.innerHTML = rankCard(data) + '<div class="xp-empty"><div style="font-size:2rem">🏆</div>لا توجد نقاط في هذه الفترة بعد.</div>'; return; }
        const top = rows.slice(0, 3);
        const order = [top[1], top[0], top[2]];
        const pod = order.map((r, i) => r ? `<div class="xp-pod p${[2, 1, 3][i]}" style="${tierVars(r.tier)}">
                <div class="xp-av">${[2, 1, 3][i] === 1 ? '<span class="xp-crown">👑</span>' : ''}${avatar(r, [2, 1, 3][i] === 1 ? 64 : 52)}</div>
                <div class="xp-pn">${esc(r.name.replace(/^د\.?\s*/, ''))}</div>${r.badges ? `<div class="xp-badges">${badgesHtml(r)}</div>` : ''}
                <div class="xp-px">${xpText(r.xp)}</div>
                <div class="xp-step">${[2, 1, 3][i]}</div></div>` : '<div></div>').join('');
        const row = (r, i) => {
            const span = levelSpan(r.level);
            const pct = Math.min(100, Math.round((r.total - span.start) / (span.next - span.start) * 100));
            return `<div class="xp-row ${r.key === 'me' ? 'me' : ''}" style="${tierVars(r.tier)};animation-delay:${Math.min(i, 12) * 35}ms" data-i="${i}">
                <span class="xp-rank">#${r.rank}</span>${avatar(r, 40)}
                <div class="xp-mid"><span class="xp-nm">${esc(r.name)}${r.key === 'me' ? ' (أنت)' : ''}</span>
                    <span class="xp-sub"><span class="xp-lv">Lv ${r.level} · ${esc((TIER[r.tier] || {}).name || '')}</span>${r.trophies ? `🏆 ${r.trophies}` : ''}<span>${esc(specName(r.spec, hosp))}</span></span>
                    ${r.badges ? `<div class="xp-badges">${badgesHtml(r)}</div>` : ''}
                    <div class="xp-bar"><i style="width:${pct}%"></i></div></div>
                <div class="xp-score">${fmt(r.xp)}<small>XP</small></div></div>`;
        };
        const rest = rows.slice(3);
        const star = (data.star ? `<div class="xp-star"><span class="xp-star-i">👑</span><div><small>مقيم شهر ${esc(monthName(data.star.ym))} · الأكثر نشاطاً</small>
                <b>${esc(data.star.name)}</b><small>${xpText(data.star.xp)} من النشاط في الشهر</small></div></div>` : '')
            + (data.popular ? `<div class="xp-star xp-pop"><span class="xp-star-i">💖</span><div><small>الأكثر شعبية في ${esc(monthName(data.popular.ym))}</small>
                <b>${esc(data.popular.name)}</b><small>${fmt(data.popular.count)} إعجاباً وتعليقاً</small></div></div>` : '');
        board.innerHTML = `${rankCard(data)}${star}<div class="xp-podium">${pod}</div>${rest.map((r, i) => row(r, i)).join('')}${data.me ? `<div class="xp-pin">${row(data.me, 0)}</div>` : ''}`;
        // Tap a row: what the points came from.
        board.querySelectorAll('.xp-row').forEach(el => el.addEventListener('click', () => {
            const r = el.closest('.xp-pin') ? data.me : rest[Number(el.dataset.i)];
            const open = el.querySelector('.xp-detail');
            if (open) { open.remove(); return; }
            const d = document.createElement('div');
            d.className = 'xp-detail';
            d.innerHTML = Object.entries(r.stats || {}).filter(([k, v]) => v && STAT[k]).map(([k, v]) => `<span>${STAT[k][0]} ${fmt(v)} ${STAT[k][1]}</span>`).join('') || '<span>—</span>';
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
            <div class="xp-shelf">${me.trophies.map((t, i) => `<button type="button" class="xp-tro t${t.tier}" data-i="${i}" style="animation-delay:${i * 40}ms" aria-label="${esc(t.name)}: كيف أحصل عليها؟">
                <div class="xp-ti">${t.icon}</div><b>${esc(t.name)}</b>
                <small>${t.tier ? esc(t.tierName) : ''}${t.next ? `${t.tier ? ' · ' : ''}${fmt(t.value)}/${fmt(t.next)}` : ' · مكتملة ✓'}</small></button>`).join('')}</div>
            <div class="xp-how" data-role="how" hidden></div>`;
        // Tap a trophy: how it is earned, its levels and the progress.
        const how = host.querySelector('[data-role="how"]');
        host.querySelectorAll('.xp-tro').forEach(btn => btn.addEventListener('click', () => {
            const t = me.trophies[Number(btn.dataset.i)];
            const open = !how.hidden && how.dataset.i === btn.dataset.i;
            host.querySelectorAll('.xp-tro').forEach(b => b.classList.toggle('sel', !open && b === btn));
            if (open) { how.hidden = true; return; }
            how.dataset.i = btn.dataset.i;
            how.hidden = false;
            const pct = t.next ? Math.min(100, Math.round(t.value / t.next * 100)) : 100;
            how.innerHTML = `<div class="xp-how-h"><span class="xp-how-i">${t.icon}</span><div><b>${esc(t.name)}</b><small>${esc(t.desc)}: ${fmt(t.value)}</small></div></div>
                <p>${esc(t.how || '')}</p>
                <div class="xp-how-steps">${(t.steps || []).map((n, k) => `<span class="${t.tier > k ? 'on' : ''}">${['🥉', '🥈', '🥇'][k]} ${['برونزية', 'فضية', 'ذهبية'][k]}<b>${fmt(n)}</b></span>`).join('')}</div>
                <div class="xp-bar"><i style="width:${pct}%"></i></div>
                <small class="xp-how-n">${t.next ? `باقٍ ${fmt(t.next - t.value)} للمستوى التالي` : 'حصلت على أعلى مستوى ✓'}${t.xp ? ` · كل واحدة = <bdi dir="ltr">+${t.xp} XP</bdi>` : ''}</small>`;
            how.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }));
    }

    // ------------------------------------------------------------------
    // Resident of the month: a crown on their duty card (Home)
    // ------------------------------------------------------------------
    const stars = new Map();
    /** cards: [{ wrapper, h, n }]. */
    async function markStar(cards) {
        const byHosp = new Map();
        cards.forEach(c => { if (!byHosp.has(c.h)) byHosp.set(c.h, []); byHosp.get(c.h).push(c); });
        for (const [h, list] of byHosp) {
            let hit = stars.get(h);
            if (!hit || Date.now() - hit.t > 600000) {
                try { const r = await Hub.api('GET', `/api/leaderboard/star?h=${encodeURIComponent(h)}`, undefined, { retries: 1 }); hit = { t: Date.now(), v: r.star, p: r.popular }; stars.set(h, hit); }
                catch (e) { continue; }
            }
            const star = hit.v, pop = hit.p;
            list.forEach(c => {
                const card = c.wrapper && c.wrapper.querySelector('.roster-card');
                if (!card) return;
                const on = !!pop && Hub.nameKey(c.n) === pop.key;
                let badge = card.querySelector('.xp-pop-badge');
                if (!on) { if (badge) badge.remove(); return; }
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'xp-pop-badge';
                    (card.querySelector('.card-front') || card).appendChild(badge);
                }
                badge.textContent = '💖 الأكثر شعبية';
                badge.title = `أكثر الإعجابات والتعليقات في ${monthName(pop.ym)}`;
            });
            list.forEach(c => {
                const card = c.wrapper && c.wrapper.querySelector('.roster-card');
                if (!card) return;
                const on = !!star && Hub.nameKey(c.n) === star.key;
                card.classList.toggle('xp-month-star', on);
                let badge = card.querySelector('.xp-month-badge');
                if (!on) { if (badge) badge.remove(); return; }
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'xp-month-badge';
                    (card.querySelector('.card-front') || card).appendChild(badge);
                }
                badge.textContent = '👑 مقيم الشهر';
                badge.title = `الأكثر نشاطاً في ${monthName(star.ym)}`;
            });
        }
    }

    window.HubXP = { leaderboard, profileCard, markStar };
})(window, document);
