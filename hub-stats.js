/**
 * Website statistics in the account panel's administrative tab (stats.js on the server).
 *   dashboard(host)  counters of a hospital (its admins) or of any hospital / the whole site (the owner)
 *   advanced(host)   the owner's analytics: growth, activity, active users, peak hours, devices,
 *                    accounts, feature adoption, hospitals side by side, and notes for planning
 * Charts are drawn here as SVG (no library): lines and bars with the values on touch, donuts,
 * horizontal bars and a weekday × hour heat map.
 */
(function (window, document) {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const fmt = n => Number(n || 0).toLocaleString('en-US');
    /** "+5" kept together inside right-to-left text. */
    const plus = n => `<bdi dir="ltr">+${fmt(n)}</bdi>`;
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const api = (path) => Hub.api('GET', path, undefined, { retries: 1 });
    const errText = e => (e && e.data && e.data.error === 'forbidden') ? 'غير مسموح.' : 'تعذر التحميل. تحقق من الاتصال.';
    const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const shortDay = d => { const [, m, day] = d.split('-').map(Number); return `${day}/${m}`; };
    const longDay = d => { const [y, m, day] = d.split('-').map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };
    const hourText = h => `${h % 12 || 12} ${h < 12 ? 'ص' : 'م'}`;
    const C = { blue: '#0a84ff', green: '#30b158', orange: '#ff9f0a', pink: '#ff375f', purple: '#8e5cf7', teal: '#2bb3c0', gray: '#8e8e93', indigo: '#5856d6', red: '#ff453a', yellow: '#e6b800' };
    const ROLE_AR = { owner: 'المالك', admin: 'مدير مستشفى', anaesthesia: 'مقيم تخدير', user: 'مقيم', rotator: 'روتيتر', aa_user: 'موظف إداري', aa_admin: 'مدير إداري' };
    const BOARD_AR = { iraqi: 'البورد العراقي', arab: 'البورد العربي', other: 'بورد آخر', none: 'بدون بورد', unset: 'غير محدد' };
    const STAGE_AR = { 1: 'الأولى', 2: 'الثانية', 3: 'الثالثة', 4: 'الرابعة', 5: 'الخامسة', 6: 'السادسة', unset: 'غير محددة' };
    const NOTE_AR = {
        comment: 'تعليق', reply: 'رد على تعليق', like: 'إعجاب', signup_request: 'طلب حساب', account_approved: 'قبول حساب', reset_request: 'طلب كلمة مرور',
        reset_approved: 'السماح بكلمة مرور', duty_reminder: 'تذكير بالخفارة', contact_request: 'طلب تواصل', exchange_request: 'طلب تبديل',
        exchange_decided: 'قرار تبديل', role_changed: 'تغيير الصلاحية', profile_set: 'تعديل الملف', er_portal: 'بوابة رغبات الطوارئ',
        opioid_used: 'استخدام مخدر', opioid_low: 'مخدر قارب على النفاد', opioid_empty: 'مخدر نفد', opioid_assigned: 'تسليم ذمة', opioid_handed_off: 'تسليم ذمة لآخر',
        opioid_replenished: 'تعبئة ذمة', opioid_stock: 'تعديل مخزون', comments_barred: 'منع التعليق', comments_allowed: 'السماح بالتعليق', comment_warned: 'إنذار تعليق',
    };

    const CSS = `
    .hst { --hst-card: var(--hacc-surface, #f2f2f7); --hst-text: var(--hacc-text, #1c1c1e); --hst-muted: var(--hacc-muted, #8a8a8e); --hst-line: var(--hacc-border, rgba(142,142,147,.35)); color: var(--hst-text); }
    .hst-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 2px 0 10px; }
    .hst-head h3 { margin: 0; font-size: .98rem; font-weight: 900; flex: 1; min-width: 140px; }
    .hst-head select, .hst-seg { font: inherit; font-size: .76rem; font-weight: 800; }
    .hst-head select { padding: 6px 10px; border-radius: 12px; border: 1px solid var(--hst-line); background: var(--hst-card); color: inherit; max-width: 100%; }
    .hst-when { font-size: .66rem; color: var(--hst-muted); font-weight: 700; width: 100%; }
    .hst-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    @media (min-width: 560px) { .hst-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); } .hst-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .hst-kpi { background: var(--hst-card); border-radius: 16px; padding: 11px 12px; min-width: 0; }
    .hst-kpi small { display: block; font-size: .68rem; font-weight: 800; color: var(--hst-muted); }
    .hst-kpi b { display: block; font-size: 1.35rem; font-weight: 900; margin-top: 2px; letter-spacing: -.3px; direction: ltr; text-align: right; }
    .hst-kpi span { display: block; font-size: .66rem; font-weight: 700; color: var(--hst-muted); margin-top: 1px; }
    .hst-kpi.link { cursor: pointer; text-decoration: none; color: inherit; border: 1.5px solid transparent; }
    .hst-kpi.warn { border-color: rgba(255,159,10,.5); }
    .hst-bar { height: 6px; border-radius: 6px; background: var(--hst-line); overflow: hidden; margin-top: 6px; }
    .hst-bar i { display: block; height: 100%; border-radius: 6px; background: ${C.green}; }
    .hst-act { background: var(--hst-card); border-radius: 14px; padding: 9px 11px; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .hst-act .ic { font-size: 1.05rem; }
    .hst-act div { flex: 1; min-width: 0; }
    .hst-act small { display: block; font-size: .66rem; font-weight: 800; color: var(--hst-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hst-act b { font-size: 1rem; font-weight: 900; }
    .hst-trend { font-size: .64rem; font-weight: 900; padding: 2px 6px; border-radius: 8px; direction: ltr; white-space: nowrap; }
    .hst-trend.up { color: ${C.green}; background: rgba(48,177,88,.12); } .hst-trend.down { color: ${C.red}; background: rgba(255,69,58,.1); } .hst-trend.flat { color: var(--hst-muted); background: var(--hst-line); }
    .hst-sec { margin: 16px 0 6px; font-size: .78rem; font-weight: 900; display: flex; align-items: center; gap: 6px; }
    .hst-sec small { font-weight: 700; color: var(--hst-muted); font-size: .66rem; }
    .hst-card { background: var(--hst-card); border-radius: 18px; padding: 12px; margin-bottom: 8px; }
    .hst-card h4 { margin: 0 0 8px; font-size: .82rem; font-weight: 900; }
    .hst-card h4 small { font-weight: 700; color: var(--hst-muted); font-size: .66rem; margin-inline-start: 4px; }
    .hst-chart { position: relative; direction: ltr; }
    .hst-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
    .hst-chart text { font-family: inherit; fill: var(--hst-muted); font-size: 10px; font-weight: 700; }
    .hst-tip { position: absolute; top: 0; pointer-events: none; background: rgba(28,28,30,.92); color: #fff; border-radius: 10px; padding: 6px 8px; font-size: .68rem; font-weight: 700; direction: rtl; text-align: right; white-space: nowrap; transform: translateX(-50%); display: none; z-index: 2; }
    .hst-tip i { display: inline-block; width: 8px; height: 8px; border-radius: 3px; margin-inline-end: 4px; }
    .hst-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; direction: rtl; }
    .hst-legend button { font: inherit; font-size: .68rem; font-weight: 800; padding: 4px 9px; border-radius: 10px; border: 1px solid var(--hst-line); background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
    .hst-legend button i { width: 9px; height: 9px; border-radius: 3px; }
    .hst-legend button.off { opacity: .4; }
    .hst-seg { display: inline-flex; background: var(--hst-card); border-radius: 12px; padding: 3px; gap: 2px; }
    .hst-seg button { font: inherit; font-size: .72rem; font-weight: 800; border: 0; background: transparent; color: inherit; padding: 5px 10px; border-radius: 9px; cursor: pointer; }
    .hst-seg button.on { background: var(--hacc-bg, #fff); box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    .hst-donut { display: flex; align-items: center; gap: 12px; }
    .hst-donut svg { width: 104px; height: 104px; flex: none; }
    .hst-donut ul { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0; display: grid; gap: 4px; }
    .hst-donut li { display: flex; align-items: center; gap: 6px; font-size: .72rem; font-weight: 700; }
    .hst-donut li i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .hst-donut li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hst-donut li b { font-weight: 900; direction: ltr; }
    .hst-hbars { display: grid; gap: 7px; }
    .hst-hbar { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; align-items: center; gap: 8px; font-size: .72rem; font-weight: 700; }
    .hst-hbar .t { height: 10px; border-radius: 6px; background: var(--hst-line); overflow: hidden; }
    .hst-hbar .t i { display: block; height: 100%; border-radius: 6px; }
    .hst-hbar b { font-weight: 900; direction: ltr; min-width: 36px; text-align: left; }
    .hst-heat { display: grid; grid-template-columns: 52px repeat(24, minmax(0, 1fr)); gap: 2px; direction: ltr; font-size: .58rem; font-weight: 700; color: var(--hst-muted); }
    .hst-heat span { text-align: right; direction: rtl; padding-right: 4px; white-space: nowrap; }
    .hst-heat i { aspect-ratio: 1; border-radius: 3px; background: rgba(10,132,255,var(--a)); min-height: 8px; }
    .hst-heat em { font-style: normal; text-align: center; }
    .hst-table { width: 100%; border-collapse: collapse; font-size: .72rem; }
    .hst-table th { text-align: right; font-weight: 900; color: var(--hst-muted); padding: 6px 4px; border-bottom: 1px solid var(--hst-line); white-space: nowrap; font-size: .66rem; }
    .hst-table td { padding: 7px 4px; border-bottom: 1px solid var(--hst-line); font-weight: 700; white-space: nowrap; }
    .hst-table td:first-child { white-space: normal; font-weight: 800; min-width: 120px; line-height: 1.4; }
    .hst-table .num { direction: ltr; text-align: right; }
    .hst-scroll { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
    .hst-cov { display: flex; align-items: center; gap: 6px; min-width: 90px; }
    .hst-cov .t { flex: 1; height: 7px; border-radius: 5px; background: var(--hst-line); overflow: hidden; }
    .hst-cov .t i { display: block; height: 100%; }
    .hst-notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .hst-notes li { display: flex; gap: 10px; align-items: flex-start; background: var(--hst-card); border-radius: 14px; padding: 10px 12px; font-size: .76rem; font-weight: 700; line-height: 1.6; }
    .hst-notes li .ic { font-size: 1.05rem; line-height: 1.4; }
    .hst-notes li.warn { box-shadow: inset 3px 0 0 ${C.orange}; } .hst-notes li.good { box-shadow: inset 3px 0 0 ${C.green}; } .hst-notes li.idea { box-shadow: inset 3px 0 0 ${C.blue}; }
    .hst-more { display: flex; align-items: center; gap: 10px; width: 100%; margin: 12px 0 4px; padding: 12px 14px; border-radius: 18px; border: 0; cursor: pointer; font: inherit; color: #fff; text-align: start;
        background: linear-gradient(135deg, #0a84ff, #5856d6); box-shadow: 0 6px 18px rgba(10,132,255,.28); }
    .hst-more > i:first-child { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; background: rgba(255,255,255,.18); font-size: 1rem; flex: none; }
    .hst-more span { flex: 1; } .hst-more b { display: block; font-size: .88rem; font-weight: 900; } .hst-more small { display: block; font-size: .68rem; font-weight: 700; opacity: .85; margin-top: 1px; }
    .hst-empty { text-align: center; padding: 18px 10px; color: var(--hst-muted); font-size: .76rem; font-weight: 700; }
    .hst-note { font-size: .68rem; color: var(--hst-muted); font-weight: 700; margin: 6px 2px 0; line-height: 1.6; }
    .hst-skel { height: 64px; border-radius: 16px; background: linear-gradient(90deg, var(--hst-card), var(--hst-line), var(--hst-card)); background-size: 200% 100%; animation: hst-sk 1.2s linear infinite; }
    @keyframes hst-sk { from { background-position: 200% 0; } to { background-position: -200% 0; } }`;
    function css() {
        if (document.getElementById('hst-css')) return;
        const st = document.createElement('style');
        st.id = 'hst-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------
    // Charts
    // ------------------------------------------------------------------
    const niceMax = v => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

    /**
     * Time chart: `series` [{ name, color, values, type: 'line' | 'bar' | 'area' }] over `labels`
     * (YYYY-MM-DD or text). The values of a day show under the finger / pointer.
     */
    function timeChart(host, { labels, series, height = 170, legend = true, tipLabel = longDay }) {
        const W = 600, H = height, L = 34, R = 8, T = 10, B = 22;
        const hidden = new Set();
        const wrap = document.createElement('div');
        wrap.className = 'hst-chart';
        host.appendChild(wrap);
        let legendEl = null;
        if (legend && series.length > 1) {
            legendEl = document.createElement('div');
            legendEl.className = 'hst-legend';
            legendEl.innerHTML = series.map((s, i) => `<button type="button" data-i="${i}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('');
            host.appendChild(legendEl);
            legendEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
                const i = Number(b.dataset.i);
                if (hidden.has(i)) hidden.delete(i); else if (hidden.size < series.length - 1) hidden.add(i);
                b.classList.toggle('off', hidden.has(i));
                draw();
            }));
        }
        const n = labels.length;
        const x = i => L + (n <= 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
        function draw() {
            const shown = series.filter((s, i) => !hidden.has(i));
            const max = niceMax(Math.max(1, ...shown.flatMap(s => s.values)));
            const y = v => T + (H - T - B) * (1 - v / max);
            const step = (W - L - R) / Math.max(1, n);
            const bars = shown.filter(s => s.type === 'bar');
            const bw = Math.max(1.5, Math.min(14, step * 0.7 / Math.max(1, bars.length)));
            let g = '';
            for (let k = 0; k <= 4; k++) {
                const v = max * k / 4, yy = y(v);
                g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".12"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${fmt(Math.round(v))}</text>`;
            }
            const every = Math.max(1, Math.ceil(n / 6));
            for (let i = 0; i < n; i += every) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(/^\d{4}-/.test(labels[i]) ? shortDay(labels[i]) : labels[i])}</text>`;
            bars.forEach((s, bi) => {
                s.values.forEach((v, i) => {
                    if (!v) return;
                    const xx = x(i) - (bars.length * bw) / 2 + bi * bw;
                    g += `<rect x="${xx}" y="${y(v)}" width="${bw - 0.6}" height="${Math.max(0, y(0) - y(v))}" rx="${Math.min(3, bw / 3)}" fill="${s.color}" fill-opacity=".85"/>`;
                });
            });
            shown.filter(s => s.type !== 'bar').forEach(s => {
                const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
                if (s.type === 'area') g += `<path d="M${x(0)},${y(0)} L${pts.join(' L')} L${x(n - 1)},${y(0)} Z" fill="${s.color}" fill-opacity=".12"/>`;
                g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
                if (n <= 40) s.values.forEach((v, i) => { g += `<circle cx="${x(i)}" cy="${y(v)}" r="2.2" fill="${s.color}"/>`; });
            });
            g += `<line class="hst-cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3" style="display:none"/>`;
            wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join('، '))}">${g}</svg><div class="hst-tip"></div>`;
            const svg = wrap.querySelector('svg'), tip = wrap.querySelector('.hst-tip'), cur = wrap.querySelector('.hst-cursor');
            const at = e => {
                const r = svg.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width * W;
                const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / Math.max(1e-9, (W - L - R) / Math.max(1, n - 1)))));
                cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i)); cur.style.display = '';
                tip.innerHTML = `<div style="margin-bottom:3px;opacity:.75">${esc(tipLabel(labels[i]))}</div>` + shown.map(s => `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${fmt(s.values[i])}</b></div>`).join('');
                tip.style.display = 'block';
                const left = x(i) / W * r.width;
                tip.style.left = Math.max(tip.offsetWidth / 2, Math.min(r.width - tip.offsetWidth / 2, left)) + 'px';
            };
            const off = () => { tip.style.display = 'none'; cur.style.display = 'none'; };
            svg.addEventListener('pointermove', at);
            svg.addEventListener('pointerdown', at);
            svg.addEventListener('pointerleave', off);
        }
        draw();
    }

    function donut(host, items, { center = '' } = {}) {
        const total = items.reduce((n, it) => n + it.value, 0);
        if (!total) { host.insertAdjacentHTML('beforeend', '<div class="hst-empty">لا توجد بيانات بعد.</div>'); return; }
        const R = 40, CIRC = 2 * Math.PI * R;
        let off = 0, arcs = '';
        items.filter(it => it.value).forEach(it => {
            const len = it.value / total * CIRC;
            arcs += `<circle cx="52" cy="52" r="${R}" fill="none" stroke="${it.color}" stroke-width="16" stroke-dasharray="${len} ${CIRC - len}" stroke-dashoffset="${-off}" transform="rotate(-90 52 52)"/>`;
            off += len;
        });
        host.insertAdjacentHTML('beforeend', `<div class="hst-donut"><svg viewBox="0 0 104 104">${arcs}
            <text x="52" y="50" text-anchor="middle" style="font-size:15px;font-weight:900;fill:currentColor">${fmt(total)}</text>
            <text x="52" y="64" text-anchor="middle" style="font-size:8px;font-weight:700;fill:currentColor;opacity:.6">${esc(center)}</text></svg>
            <ul>${items.filter(it => it.value).map(it => `<li><i style="background:${it.color}"></i><span>${esc(it.label)}</span><b>${pct(it.value, total)}%</b></li>`).join('')}</ul></div>`);
    }

    function hbars(host, items, { max, suffix = '', color = C.blue } = {}) {
        const m = max || Math.max(1, ...items.map(i => i.value));
        host.insertAdjacentHTML('beforeend', `<div class="hst-hbars">${items.map(it => `<div class="hst-hbar"><span>${esc(it.label)}</span>
            <div class="t"><i style="width:${Math.min(100, it.value / m * 100)}%;background:${it.color || color}"></i></div><b>${it.text != null ? esc(it.text) : fmt(it.value) + suffix}</b></div>`).join('')}</div>`);
    }

    function heatmap(host, cells) {
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
        cells.forEach(c => { if (grid[c.wd]) grid[c.wd][c.hr] = c.n; });
        const max = Math.max(1, ...grid.flat());
        let h = '<span></span>' + Array.from({ length: 24 }, (_, i) => `<em>${i % 3 === 0 ? i : ''}</em>`).join('');
        // Iraq's week starts on Saturday.
        [6, 0, 1, 2, 3, 4, 5].forEach(d => {
            h += `<span>${WEEKDAYS[d]}</span>` + grid[d].map((v, hr) => `<i style="--a:${v ? (0.12 + 0.88 * v / max).toFixed(2) : 0.04}" title="${WEEKDAYS[d]} ${hourText(hr)}: ${v}"></i>`).join('');
        });
        host.insertAdjacentHTML('beforeend', `<div class="hst-heat">${h}</div>`);
    }

    const trend = ({ now, prev }) => {
        if (!prev && !now) return '<span class="hst-trend flat">—</span>';
        if (!prev) return '<span class="hst-trend up">جديد</span>';
        const p = Math.round((now - prev) / prev * 100);
        return `<span class="hst-trend ${p > 0 ? 'up' : p < 0 ? 'down' : 'flat'}">${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p)}%</span>`;
    };

    // ------------------------------------------------------------------
    // The dashboard (administrative tab)
    // ------------------------------------------------------------------
    /** Fills `box`; `onAdvanced`: the owner's button to the analytics view. */
    async function dashboard(box, { onAdvanced } = {}) {
        css();
        const owner = Hub.auth.isOwner();
        const mine = Hub.auth.getAdminHospitalIds ? Hub.auth.getAdminHospitalIds() || [] : [];
        const hospitals = (Hub.getHospitals ? Hub.getHospitals() : []).filter(h => owner || mine.includes('*') || mine.includes(h.id));
        let scope = (() => { try { return localStorage.getItem('hub_stats_scope') || ''; } catch (e) { return ''; } })();
        if (owner && !(scope === '*' || hospitals.some(h => h.id === scope))) scope = '*';
        if (!owner && !hospitals.some(h => h.id === scope)) scope = (hospitals[0] || {}).id || '';
        box.classList.add('hst', 'hp-section');
        const paint = async () => {
            const options = owner ? [['*', 'كل المستشفيات'], ...hospitals.map(h => [h.id, h.name_ar || h.hospitalName || h.id])] : hospitals.map(h => [h.id, h.name_ar || h.hospitalName || h.id]);
            box.innerHTML = `<div class="hst-head"><h3>📊 لوحة الإحصائيات</h3>${options.length > 1 ? `<select aria-label="المستشفى">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === scope ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}</div>
                <div class="hst-grid"><div class="hst-skel"></div><div class="hst-skel"></div><div class="hst-skel"></div><div class="hst-skel"></div></div>`;
            const sel = box.querySelector('select');
            if (sel) sel.addEventListener('change', () => { scope = sel.value; try { localStorage.setItem('hub_stats_scope', scope); } catch (e) {} paint(); });
            let s;
            try { s = await api('/api/stats/summary?h=' + encodeURIComponent(scope || '*')); }
            catch (e) { box.querySelector('.hst-grid').outerHTML = `<div class="hst-empty">${esc(errText(e))}</div>`; return; }
            if (!box.isConnected) return;
            const a = s.accounts, r = s.residents, act = s.activity, f = s.features;
            const cov = pct(r.linked, r.active);
            const when = new Date(s.at).toLocaleTimeString('ar-IQ-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
            box.innerHTML = box.querySelector('.hst-head').outerHTML + `
                <div class="hst-when">آخر تحديث ${esc(when)} · تتحدث كل 10 دقائق</div>
                <div class="hst-grid four" style="margin-top:6px">
                    <div class="hst-kpi"><small>الحسابات الفعّالة</small><b>${fmt(a.active)}</b><span>${plus(a.new7)} هذا الأسبوع · ${plus(a.new30)} هذا الشهر</span></div>
                    <div class="hst-kpi"><small>النشطون</small><b>${fmt(a.dau)}</b><span>اليوم · ${fmt(a.wau)} الأسبوع · ${fmt(a.mau)} الشهر</span></div>
                    <div class="hst-kpi"><small>المقيمون لديهم حسابات</small><b>${cov}%</b><span>${fmt(r.linked)} من ${fmt(r.active)} مقيماً في القاعدة</span><div class="hst-bar"><i style="width:${cov}%"></i></div></div>
                    <a class="hst-kpi link ${a.pending ? 'warn' : ''}" href="./account.html#manage"><small>بانتظار الموافقة</small><b>${fmt(a.pending)}</b><span>${a.pending ? 'افتح طلبات الحسابات ←' : 'لا طلبات معلقة ✓'}</span></a>
                </div>
                <div class="hst-sec">التفاعل خلال 30 يوماً <small>مقارنة بالثلاثين يوماً التي قبلها</small></div>
                <div class="hst-grid three">
                    ${[['💬', 'تعليقات', act.comments], ['❤️', 'إعجابات', act.likes], ['📞', 'طلبات تواصل', act.contacts], ['🩺', 'حالات خفارة', act.statuses], ['🔁', 'طلبات تبديل', act.exchanges], ['💉', 'استخدام مخدرات', act.opioids]]
                        .map(([ic, l, v]) => `<div class="hst-act"><span class="ic">${ic}</span><div><small>${l}</small><b>${fmt(v.now)}</b></div>${trend(v)}</div>`).join('')}
                </div>
                <div class="hst-card" style="margin-top:8px"><h4>آخر 30 يوماً <small>التفاعلات اليومية والحسابات الجديدة</small></h4><div data-role="spark"></div></div>
                <div class="hst-grid three">
                    <div class="hst-kpi"><small>الإشعارات مفعّلة</small><b>${pct(f.push, a.active)}%</b><span>${fmt(f.push)} حساباً</span></div>
                    <div class="hst-kpi"><small>تذكير الخفارات</small><b>${pct(f.reminders, a.active)}%</b><span>${fmt(f.reminders)} حساباً</span></div>
                    <div class="hst-kpi"><small>ملفات البورد مكتملة</small><b>${pct(f.profiles, f.residentAccounts)}%</b><span>${fmt(f.profiles)} من ${fmt(f.residentAccounts)} مقيماً</span></div>
                </div>
                ${owner ? `<button type="button" class="hst-more" data-act="advanced"><i class="fas fa-chart-line"></i><span><b>التحليلات المتقدمة ومخططات النمو</b><small>النمو، أوقات الذروة، الأجهزة، اعتماد الميزات، مقارنة المستشفيات، وملاحظات للتطوير</small></span><i class="fas fa-chevron-left"></i></button>` : ''}`;
            const sel2 = box.querySelector('select');
            if (sel2) sel2.addEventListener('change', () => { scope = sel2.value; try { localStorage.setItem('hub_stats_scope', scope); } catch (e) {} paint(); });
            timeChart(box.querySelector('[data-role="spark"]'), { labels: s.series.days, height: 130, series: [
                { name: 'التفاعلات', color: C.blue, values: s.series.interactions, type: 'area' },
                { name: 'حسابات جديدة', color: C.green, values: s.series.signups, type: 'bar' },
            ] });
            const more = box.querySelector('[data-act="advanced"]');
            if (more && onAdvanced) more.addEventListener('click', onAdvanced);
        };
        paint();
    }

    // ------------------------------------------------------------------
    // The owner's analytics
    // ------------------------------------------------------------------
    /** Weekly sums when the range is long, so the lines stay readable. */
    function bucket(days, series, size) {
        if (size <= 1) return { labels: days, series };
        const labels = [], out = Object.fromEntries(Object.keys(series).map(k => [k, []]));
        for (let i = 0; i < days.length; i += size) {
            labels.push(days[i]);
            for (const k of Object.keys(series)) out[k].push(series[k].slice(i, i + size).reduce((a, b) => a + b, 0));
        }
        return { labels, series: out };
    }

    function deviceParts(devices) {
        const os = {}, how = { app: 0, browser: 0 }, browsers = {};
        devices.forEach(({ label, n }) => {
            const [o = 'أخرى', rest = ''] = String(label || '').split(' · ');
            const app = /التطبيق/.test(rest);
            const br = rest.replace(/\s*\(التطبيق\)\s*/, '').trim() || 'غير معروف';
            os[o] = (os[o] || 0) + n;
            how[app ? 'app' : 'browser'] += n;
            browsers[br] = (browsers[br] || 0) + n;
        });
        return { os, how, browsers };
    }

    function insights(g, s) {
        const out = [];
        const a = s.accounts, r = s.residents, b = g.breakdown, ad = g.adoption;
        const active = b.total || a.active || 0;
        const cov = pct(r.linked, r.active);
        if (a.pending) out.push(['warn', '⏳', `${a.pending} طلب حساب بانتظار الموافقة. الرد السريع يرفع نسبة التسجيل.`]);
        if (cov < 60) {
            const low = (g.hospitals || []).filter(h => h.residents >= 10).sort((p, q) => pct(p.linked, p.residents) - pct(q.linked, q.residents))[0];
            out.push(['idea', '👥', `${cov}% فقط من المقيمين في القاعدة لديهم حسابات${low ? `؛ أقلّها ${esc(low.name)} (${pct(low.linked, low.residents)}%)` : ''}. حملة تسجيل هناك (رسالة في مجموعة المستشفى مع رابط التسجيل) هي أسرع طريق للنمو.`]);
        } else out.push(['good', '✅', `${cov}% من المقيمين في القاعدة لديهم حسابات.`]);
        const dormant = b.recency.older || 0;
        if (dormant) out.push(['idea', '💤', `${dormant} حساباً لم يُفتح منذ أكثر من 90 يوماً. تذكير أو إشعار بميزة جديدة قد يعيدهم.`]);
        if (a.mau) {
            const stick = pct(a.dau, a.mau);
            out.push([stick >= 30 ? 'good' : 'idea', '📈', `نسبة الاستخدام اليومي إلى الشهري ${stick}%${stick >= 30 ? ': عادة يومية قوية.' : '. ميزات يومية (تذكير الخفارة، حالة الخفارة) ترفعها.'}`]);
        }
        const pushPct = pct(ad.push, active);
        if (pushPct < 60) out.push(['idea', '🔔', `الإشعارات مفعّلة عند ${pushPct}% فقط. بدونها لا تصل طلبات التواصل والتبديل في وقتها؛ دعوة لتفعيلها بعد أول دخول قد تفيد.`]);
        const dev = deviceParts(g.devices);
        const devTotal = Object.values(dev.os).reduce((x, y) => x + y, 0);
        if (devTotal) {
            const iphone = pct(dev.os.iPhone || 0, devTotal), appPct = pct(dev.how.app, devTotal);
            out.push(['idea', '📱', `${iphone}% من الأجهزة iPhone، و${appPct}% يستخدمون التطبيق المثبت. اختبر كل إصدار على Safari في iPhone أولاً${appPct < 50 ? '، وشجّع تثبيت التطبيق (إشعارات iPhone لا تعمل إلا منه)' : ''}.`]);
        }
        if (g.hours.length) {
            const byHour = Array(24).fill(0);
            g.hours.forEach(c => { byHour[c.hr] += c.n; });
            const peak = byHour.indexOf(Math.max(...byHour));
            let quiet = 0;
            byHour.forEach((v, i) => { if (v < byHour[quiet]) quiet = i; });
            const byDay = Array(7).fill(0);
            g.hours.forEach(c => { byDay[c.wd] += c.n; });
            out.push(['idea', '🕒', `ذروة الاستخدام حوالي الساعة ${hourText(peak)}، وأكثر الأيام نشاطاً ${WEEKDAYS[byDay.indexOf(Math.max(...byDay))]}. أنسب وقت لنشر التحديثات حوالي ${hourText(quiet)}.`]);
        }
        const stages = Object.entries(b.stages).filter(([k]) => k !== 'n/a');
        const unset = (b.stages.unset || 0), resTotal = stages.reduce((x, [, v]) => x + v, 0);
        if (resTotal && pct(unset, resTotal) > 30) out.push(['idea', '🎓', `${pct(unset, resTotal)}% من حسابات المقيمين بلا مرحلة بورد؛ إحصائية المقيمين تحتاجها. تذكير بإكمال الملف الشخصي يحسّنها.`]);
        const inter = ['comments', 'likes', 'contacts', 'statuses'].reduce((x, k) => x + s.activity[k].now, 0);
        const interPrev = ['comments', 'likes', 'contacts', 'statuses'].reduce((x, k) => x + s.activity[k].prev, 0);
        if (interPrev) {
            const p = Math.round((inter - interPrev) / interPrev * 100);
            out.push([p >= 0 ? 'good' : 'warn', p >= 0 ? '🚀' : '📉', `التفاعل خلال 30 يوماً ${p >= 0 ? 'ارتفع' : 'انخفض'} ${Math.abs(p)}% عن الثلاثين يوماً السابقة.`]);
        }
        const unused = [['طلبات التبديل', ad.exchangers], ['ذمة المخدرات', ad.opioidUsers], ['طلبات التواصل', ad.requesters]].filter(([, v]) => !v).map(([l]) => l);
        if (unused.length) out.push(['idea', '🧭', `لم تُستخدم خلال 90 يوماً: ${unused.join('، ')}. ربما تحتاج تعريفاً بها أو إعادة نظر في مكانها.`]);
        const empty = (g.hospitals || []).filter(h => !h.active && h.residents);
        if (empty.length) out.push(['warn', '🏥', `مستشفيات بلا أي حساب فعّال: ${empty.map(h => esc(h.name)).join('، ')}.`]);
        return out;
    }

    async function advanced(host) {
        css();
        let days = 90;
        const root = document.createElement('div');
        root.className = 'hst';
        host.appendChild(root);
        const paint = async () => {
            root.innerHTML = `<div class="hst-head"><h3>📅 المدة</h3>
                <div class="hst-seg" role="group" aria-label="المدة">${[30, 90, 180, 365].map(d => `<button type="button" data-d="${d}" class="${d === days ? 'on' : ''}">${d === 365 ? 'سنة' : d + ' يوماً'}</button>`).join('')}</div></div>
                <div class="hst-grid"><div class="hst-skel"></div><div class="hst-skel"></div><div class="hst-skel"></div><div class="hst-skel"></div></div>`;
            root.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { days = Number(b.dataset.d); paint(); }));
            let g, s;
            try { [g, s] = await Promise.all([api('/api/stats/growth?days=' + days), api('/api/stats/summary?h=*')]); }
            catch (e) { root.querySelector('.hst-grid').outerHTML = `<div class="hst-empty">${esc(errText(e))}</div>`; return; }
            if (!root.isConnected) return;
            const head = root.querySelector('.hst-head').outerHTML;
            const a = s.accounts, b = g.breakdown, ad = g.adoption;
            const total = b.total || 1;
            const size = days > 120 ? 7 : 1;
            const signupsTotal = g.series.signups.reduce((x, y) => x + y, 0);
            root.innerHTML = head + `
                <div class="hst-when">بتوقيت العراق · ${esc(longDay(g.days[0]))} ← ${esc(longDay(g.days[g.days.length - 1]))}${size > 1 ? ' · المخططات بمجاميع أسبوعية' : ''}</div>
                <div class="hst-grid four" style="margin-top:6px">
                    <div class="hst-kpi"><small>الحسابات الفعّالة</small><b>${fmt(a.active)}</b><span>${plus(signupsTotal)} خلال المدة</span></div>
                    <div class="hst-kpi"><small>نشطون هذا الشهر</small><b>${fmt(a.mau)}</b><span>${pct(a.mau, a.active)}% من الحسابات</span></div>
                    <div class="hst-kpi"><small>نشطون هذا الأسبوع</small><b>${fmt(a.wau)}</b><span>${fmt(a.dau)} اليوم</span></div>
                    <div class="hst-kpi"><small>المقيمون لديهم حسابات</small><b>${pct(s.residents.linked, s.residents.active)}%</b><span>${fmt(s.residents.linked)} من ${fmt(s.residents.active)}</span></div>
                </div>
                <div class="hst-sec">💡 ملاحظات للتطوير</div><ul class="hst-notes" data-role="notes"></ul>
                <div class="hst-sec">النمو</div>
                <div class="hst-card"><h4>عدد الحسابات <small>التراكمي والجديد</small></h4><div data-role="growth"></div></div>
                <div class="hst-card"><h4>المستخدمون النشطون <small>لقطة كل ليلة</small></h4><div data-role="active"></div></div>
                <div class="hst-sec">النشاط</div>
                <div class="hst-card"><h4>التفاعل ${size > 1 ? 'الأسبوعي' : 'اليومي'} <small>اضغط على الأسماء لإخفائها أو إظهارها</small></h4><div data-role="activity"></div></div>
                <div class="hst-card"><h4>أوقات الذروة <small>آخر 90 يوماً · بتوقيت العراق</small></h4><div data-role="heat"></div></div>
                <div class="hst-card"><h4>اعتماد الميزات <small>نسبة الحسابات الفعّالة التي استخدمتها خلال 90 يوماً</small></h4><div data-role="adoption"></div></div>
                <div class="hst-sec">الأجهزة</div>
                <div class="hst-grid"><div class="hst-card"><h4>نظام التشغيل</h4><div data-role="os"></div></div><div class="hst-card"><h4>طريقة الاستخدام</h4><div data-role="how"></div></div></div>
                <div class="hst-card"><h4>المتصفحات</h4><div data-role="browsers"></div></div>
                <div class="hst-sec">الحسابات</div>
                <div class="hst-grid"><div class="hst-card"><h4>الأدوار</h4><div data-role="roles"></div></div><div class="hst-card"><h4>نوع البورد</h4><div data-role="boards"></div></div></div>
                <div class="hst-grid"><div class="hst-card"><h4>المراحل</h4><div data-role="stages"></div></div><div class="hst-card"><h4>آخر ظهور</h4><div data-role="recency"></div></div></div>
                <div class="hst-grid"><div class="hst-card"><h4>الجنس</h4><div data-role="sex"></div></div><div class="hst-card"><h4>لغة الاسم المستعار</h4><div data-role="lang"></div></div></div>
                <div class="hst-sec">المستشفيات</div>
                <div class="hst-card"><div class="hst-scroll" data-role="hosp"></div><div class="hst-note">التغطية: نسبة المقيمين الفعّالين في قاعدة المستشفى الذين لديهم حسابات. النشاط: نشطو الشهر من حسابات المستشفى.</div></div>
                <div class="hst-card"><h4>الإشعارات المرسلة <small>آخر 30 يوماً، حسب النوع</small></h4><div data-role="notifs"></div></div>
                <a class="hst-more" href="./account.html#manage-stats" style="background:linear-gradient(135deg,#30b158,#2bb3c0);box-shadow:0 6px 18px rgba(48,177,88,.25);text-decoration:none"><i class="fas fa-database"></i><span><b>استهلاك قاعدة البيانات اليوم</b><small>القراءات والكتابات والطلبات مقابل الحد المجاني اليومي</small></span><i class="fas fa-chevron-left"></i></a>`;
            root.querySelectorAll('[data-d]').forEach(b2 => b2.addEventListener('click', () => { days = Number(b2.dataset.d); paint(); }));
            const $ = k => root.querySelector(`[data-role="${k}"]`);

            $('notes').innerHTML = insights(g, s).map(([k, ic, t]) => `<li class="${k}"><span class="ic">${ic}</span><span>${t}</span></li>`).join('');

            // Growth: accounts over time (from sign-up dates) and new accounts.
            let run = g.accountsBefore;
            const cumulative = g.series.signups.map(v => (run += v));
            const gb = bucket(g.days, { signups: g.series.signups }, size);
            const cumB = size > 1 ? gb.labels.map((d, i) => cumulative[Math.min(cumulative.length - 1, i * size + size - 1)]) : cumulative;
            timeChart($('growth'), { labels: gb.labels, series: [
                { name: 'كل الحسابات', color: C.blue, values: cumB, type: 'area' },
                { name: 'حسابات جديدة', color: C.green, values: gb.series.signups, type: 'bar' },
            ] });
            $('growth').insertAdjacentHTML('beforeend', '<div class="hst-note">من تواريخ إنشاء الحسابات الموجودة اليوم (المحذوفة لا تُحسب).</div>');

            if (g.snapshots.length >= 2) {
                timeChart($('active'), { labels: g.snapshots.map(x => x.day), series: [
                    { name: 'شهرياً', color: C.purple, values: g.snapshots.map(x => x.mau || 0), type: 'line' },
                    { name: 'أسبوعياً', color: C.blue, values: g.snapshots.map(x => x.wau || 0), type: 'line' },
                    { name: 'يومياً', color: C.orange, values: g.snapshots.map(x => x.dau || 0), type: 'area' },
                ] });
            } else {
                $('active').innerHTML = `<div class="hst-empty">بدأ تسجيل النشاط اليومي${g.snapshots.length ? ` في ${esc(longDay(g.snapshots[0].day))}` : ' الليلة'}: يُحفظ كل ليلة عدد النشطين في اليوم والأسبوع والشهر، ويظهر المخطط بعد ليلتين.<br>اليوم: ${fmt(a.dau)} · الأسبوع: ${fmt(a.wau)} · الشهر: ${fmt(a.mau)}</div>`;
            }

            const ab = bucket(g.days, g.series, size);
            timeChart($('activity'), { labels: ab.labels, series: [
                { name: 'إعجابات', color: C.pink, values: ab.series.likes, type: 'line' },
                { name: 'تعليقات', color: C.blue, values: ab.series.comments, type: 'line' },
                { name: 'طلبات تواصل', color: C.orange, values: ab.series.contacts, type: 'line' },
                { name: 'حالات خفارة', color: C.teal, values: ab.series.statuses, type: 'line' },
                { name: 'طلبات تبديل', color: C.purple, values: ab.series.exchanges, type: 'line' },
                { name: 'استخدام مخدرات', color: C.indigo, values: ab.series.opioids, type: 'line' },
                { name: 'تعديلات البيانات', color: C.gray, values: ab.series.edits, type: 'bar' },
            ] });

            heatmap($('heat'), g.hours);
            $('heat').insertAdjacentHTML('beforeend', '<div class="hst-note">الإعجابات والتعليقات وطلبات التواصل وحالات الخفارة وتعديلات البيانات، حسب اليوم والساعة. الأغمق = أكثر.</div>');

            hbars($('adoption'), [
                ['🔔 الإشعارات', ad.push], ['⏰ تذكير الخفارات', ad.reminders], ['🖼️ صورة شخصية', b.avatars], ['❤️ الإعجاب', ad.likers], ['💬 التعليق', ad.commenters],
                ['📞 طلب تواصل', ad.requesters], ['🩺 حالة الخفارة', ad.statusSetters], ['🔁 طلب تبديل', ad.exchangers], ['💉 ذمة المخدرات', ad.opioidUsers],
            ].map(([l, v]) => ({ label: l, value: pct(v, total), text: `${pct(v, total)}% · ${fmt(v)}` })).sort((p, q) => q.value - p.value), { max: 100, color: C.blue });
            if (ad.allComments) $('adoption').insertAdjacentHTML('beforeend', `<div class="hst-note">${pct(ad.anonComments, ad.allComments)}% من التعليقات خلال 90 يوماً بالاسم المستعار.</div>`);

            const dev = deviceParts(g.devices);
            const palette = [C.blue, C.green, C.orange, C.purple, C.teal, C.pink, C.gray, C.yellow];
            const toItems = (obj, names = {}) => Object.entries(obj).sort((p, q) => q[1] - p[1]).map(([k, v], i) => ({ label: names[k] || k, value: v, color: palette[i % palette.length] }));
            donut($('os'), toItems(dev.os), { center: 'جهاز' });
            donut($('how'), toItems(dev.how, { app: 'التطبيق المثبت', browser: 'المتصفح' }), { center: 'جهاز' });
            hbars($('browsers'), toItems(dev.browsers).map(x => ({ ...x, text: `${fmt(x.value)}` })));
            $('browsers').insertAdjacentHTML('beforeend', '<div class="hst-note">الأجهزة التي فُتح منها حساب خلال آخر 90 يوماً.</div>');

            donut($('roles'), toItems(b.roles, ROLE_AR), { center: 'حساب' });
            const boards = Object.fromEntries(Object.entries(b.boards).filter(([k]) => k !== 'n/a'));
            donut($('boards'), toItems(boards, BOARD_AR), { center: 'مقيم' });
            const stages = Object.entries(b.stages).filter(([k]) => k !== 'n/a').sort((p, q) => (p[0] === 'unset') - (q[0] === 'unset') || Number(p[0]) - Number(q[0]));
            hbars($('stages'), stages.map(([k, v]) => ({ label: 'المرحلة ' + (STAGE_AR[k] || k), value: v, color: k === 'unset' ? C.gray : C.purple })).map(x => x.label === 'المرحلة غير محددة' ? { ...x, label: 'غير محددة' } : x));
            const rec = b.recency;
            hbars($('recency'), [['اليوم', rec.d1, C.green], ['هذا الأسبوع', rec.d7, C.teal], ['هذا الشهر', rec.d30, C.blue], ['خلال 90 يوماً', rec.d90, C.orange], ['أقدم', rec.older, C.gray]]
                .map(([l, v, c]) => ({ label: l, value: v || 0, color: c })));
            donut($('sex'), toItems(b.sex, { m: 'ذكور', f: 'إناث', unknown: 'غير محدد' }), { center: 'حساب' });
            donut($('lang'), toItems(b.lang, { ar: 'العربية', en: 'الإنجليزية' }), { center: 'حساب' });

            const hs = g.hospitals || [];
            $('hosp').innerHTML = hs.length ? `<table class="hst-table"><thead><tr><th>المستشفى</th><th>التغطية</th><th>الحسابات</th><th>نشطون/شهر</th><th>نشطون/أسبوع</th><th>معلّقة</th><th>تعليقات 30ي</th><th>تواصل 30ي</th></tr></thead><tbody>
                ${hs.map(h => { const c = pct(h.linked, h.residents); return `<tr><td>${esc(h.name)}</td>
                    <td><div class="hst-cov"><div class="t"><i style="width:${c}%;background:${c >= 60 ? C.green : c >= 30 ? C.orange : C.red}"></i></div><span class="num">${c}%</span></div></td>
                    <td class="num">${fmt(h.active)}</td><td class="num">${fmt(h.mau)}</td><td class="num">${fmt(h.wau)}</td><td class="num">${h.pending ? `<b style="color:${C.orange}">${fmt(h.pending)}</b>` : '0'}</td>
                    <td class="num">${fmt(h.comments)}</td><td class="num">${fmt(h.contacts)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="hst-empty">لا توجد مستشفيات.</div>';

            hbars($('notifs'), (g.notifications || []).map(x => ({ label: NOTE_AR[x.type] || x.type, value: x.n, color: C.indigo })));
            if (!(g.notifications || []).length) $('notifs').innerHTML = '<div class="hst-empty">لا إشعارات خلال 30 يوماً.</div>';
        };
        paint();
    }

    window.HubStats = { dashboard, advanced, insights };
})(window, document);
