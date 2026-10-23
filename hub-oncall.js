/**
 * On-call status of surgical residents' duty cards, and contact requests.
 *
 * - The resident on duty (their own card, surgical branches) taps the status button (where the ICU
 *   card has its bed counter): the card flips to the status options — in the operating theatre, away
 *   for a consultation, no status, or a custom one with a skin of their choice. Tapping outside, or
 *   the ×, flips it back.
 * - Everyone sees the status chip and the card's skin. Contacting a busy resident (WhatsApp / Call)
 *   first shows a warning: contact anyway, or leave a contact request (the holder is notified).
 * - The holder's requests panel lists who asked, with their contact buttons and a "done" button;
 *   requests left open when the duty day ends are marked missed (worker/src/oncall.js).
 *
 * Loaded by Home.html (cards) and on demand by hub-accounts.js (the requests panel).
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    const A = window.HubAccounts;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, t) => (A && A.toast ? A.toast(m, t) : null);

    // The status options are the owner's (GET /api/duty-status/options); these are the defaults.
    let OPTS = {
        options: [
            { id: 'or', icon: '🩸', label: 'في صالة العمليات', chip: 'في العمليات', skin: 'or', busy: true },
            { id: 'consult', icon: '🚑', label: 'خارج القسم لاستشارة', chip: 'استشارة', skin: 'consult', busy: true },
        ],
        allowCustom: true, autoClearHours: 6,
    };
    let optsLoading = null;
    function loadOptions(force) {
        if (!optsLoading || force) {
            optsLoading = Hub.api('GET', '/api/duty-status/options', undefined, { retries: 1 })
                .then(r => { if (r && Array.isArray(r.options)) OPTS = r; return OPTS; })
                .catch(() => { optsLoading = null; return OPTS; });
        }
        return optsLoading;
    }
    const optionOf = id => OPTS.options.find(o => o.id === id);
    const SKINS = [
        { id: 'night', name: 'كاربون' }, { id: 'ocean', name: 'محيط' }, { id: 'emerald', name: 'زمرد' },
        { id: 'violet', name: 'مجرة' }, { id: 'gold', name: 'ذهبي' }, { id: 'rose', name: 'وردي' },
        { id: 'or', name: 'عمليات' }, { id: 'consult', name: 'إسعاف' },
    ];
    const statusText = st => !st || !st.s ? '' : ((optionOf(st.s) || {}).label || st.l || 'مشغول');
    const statusChip = st => !st || !st.s ? '' : `${st.i || (optionOf(st.s) || {}).icon || '⏳'} ${st.l || (optionOf(st.s) || {}).chip || 'مشغول'}`;
    const isBusy = st => !!(st && st.s && st.b !== false);

    // ------------------------------------------------------------------
    // Styles: the skins (every element of the card stays clearly readable, day and night)
    // ------------------------------------------------------------------
    const DRIPS = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%23b91c1c' d='M0 0h400v14c-8 0-10 22-17 22s-6-18-14-18-9 34-18 34-8-30-17-30-6 10-14 10-8-16-16-16-10 40-20 40-9-38-18-38-7 12-15 12-9-20-17-20-11 28-20 28-8-26-16-26-6 8-13 8-9-18-18-18-10 30-20 30-9-28-17-28-7 10-14 10-8-14-16-14-10 24-19 24-8-22-16-22-7 6-14 6-8-16-16-16-11 36-20 36-9-34-17-34L0 14z'/%3E%3C/svg%3E\")";
    const CSS = `
    .roster-card .card-duty-status { gap: .3rem; }
    .roster-card .card-duty-status.oc-idle { background: rgba(142,142,147,.12); border-color: rgba(142,142,147,.35); color: #636366; }
    body.dark .roster-card .card-duty-status.oc-idle { color: #C7C7CC; }
    .roster-card .card-duty-status.oc-busy { background: #fff; color: #991b1b; border-color: rgba(255,255,255,.7); animation: ocPulse 2.2s ease-in-out infinite; }
    .roster-card .card-duty-status.oc-mine::after { content: '✎'; font-size: .62rem; opacity: .7; }
    .roster-card .card-duty-status .oc-wait { min-width: 1.15rem; height: 1.15rem; border-radius: 999px; background: #dc2626; color: #fff; display: inline-grid; place-items: center; font-size: .62rem; }
    @keyframes ocPulse { 0%,100% { box-shadow: -5px 5px 14px rgba(0,0,0,.18); } 50% { box-shadow: -5px 5px 22px rgba(255,255,255,.55); } }

    /* Skins: background, then every text and control in the card forced to its readable colours. */
    .roster-card-wrapper[class*="oc-skin-"] .roster-card { border: none !important; position: relative; isolation: isolate; }
    .roster-card-wrapper[class*="oc-skin-"] .roster-card .card-front { position: relative; z-index: 1; }
    .roster-card-wrapper.oc-dark-text .roster-card .resident-name { color: #111827 !important; }
    .roster-card-wrapper.oc-dark-text .roster-card .resident-phone { color: #374151 !important; opacity: 1 !important; }
    .roster-card-wrapper.oc-light-text .roster-card .resident-name { color: #ffffff !important; text-shadow: 0 1px 2px rgba(0,0,0,.45); }
    .roster-card-wrapper.oc-light-text .roster-card .resident-phone { color: rgba(255,255,255,.88) !important; opacity: 1 !important; }
    .roster-card-wrapper.oc-light-text .roster-card .divider { background: rgba(255,255,255,.22) !important; }
    .roster-card-wrapper.oc-dark-text .roster-card .divider { background: rgba(17,24,39,.15) !important; }
    .roster-card-wrapper.oc-light-text .roster-card .specialty-bubble { background: rgba(0,0,0,.28) !important; color: #fff !important; border-color: rgba(255,255,255,.28) !important; }
    .roster-card-wrapper.oc-dark-text .roster-card .specialty-bubble { background: rgba(255,255,255,.75) !important; color: #111827 !important; border-color: rgba(17,24,39,.18) !important; }
    .roster-card-wrapper[class*="oc-skin-"] .roster-card .action-btn-sm { background: rgba(255,255,255,.94) !important; border-color: rgba(255,255,255,.95) !important; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
    .roster-card-wrapper[class*="oc-skin-"] .roster-card .action-btn-sm.wa { color: #047857 !important; }
    .roster-card-wrapper[class*="oc-skin-"] .roster-card .action-btn-sm.call { color: #1d4ed8 !important; }
    .roster-card-wrapper.oc-light-text .roster-card .card-status { background: rgba(0,0,0,.3) !important; color: #fff !important; border-color: rgba(255,255,255,.3) !important; }
    .roster-card-wrapper.oc-light-text .roster-card .hacc-act { color: #fff !important; background: rgba(0,0,0,.25) !important; border-color: rgba(255,255,255,.25) !important; }
    .roster-card-wrapper.oc-dark-text .roster-card .hacc-act { color: #111827 !important; background: rgba(255,255,255,.7) !important; }

    /* 🩸 Operating theatre: a blood skin (dripping top edge, splatter, slow heartbeat glow). */
    .roster-card-wrapper.oc-skin-or .roster-card {
        background:
            radial-gradient(circle at 16% 34%, rgba(220,38,38,.55) 0 7px, transparent 8px),
            radial-gradient(circle at 21% 41%, rgba(185,28,28,.65) 0 3px, transparent 4px),
            radial-gradient(circle at 11% 46%, rgba(239,68,68,.45) 0 2px, transparent 3px),
            radial-gradient(ellipse 34px 22px at 88% 70%, rgba(220,38,38,.35), transparent 70%),
            radial-gradient(circle at 92% 58%, rgba(254,202,202,.25) 0 2px, transparent 3px),
            linear-gradient(160deg, #3f0a0d 0%, #6f1214 52%, #8f1a1a 100%) !important;
        box-shadow: 0 10px 28px rgba(127,29,29,.45), inset 0 0 0 1px rgba(254,202,202,.12) !important;
        animation: ocHeartbeat 2.6s ease-in-out infinite;
    }
    .roster-card-wrapper.oc-skin-or .roster-card::before {
        content: ''; position: absolute; inset: 0 0 auto 0; height: 34px; z-index: 0; pointer-events: none; border-radius: 1.5rem 1.5rem 0 0;
        background: ${DRIPS} top / 100% 100% no-repeat; opacity: .95;
    }
    .roster-card-wrapper.oc-skin-or .roster-card::after {
        content: '\\f0f1'; font-family: 'Font Awesome 6 Free'; font-weight: 900; position: absolute; left: 14px; bottom: 54px; z-index: 0;
        font-size: 3.4rem; color: rgba(254,202,202,.08); transform: rotate(-18deg); pointer-events: none;
    }
    @keyframes ocHeartbeat { 0%,100% { box-shadow: 0 10px 28px rgba(127,29,29,.45); } 14% { box-shadow: 0 10px 34px rgba(220,38,38,.7); } 28% { box-shadow: 0 10px 28px rgba(127,29,29,.45); } 42% { box-shadow: 0 10px 34px rgba(220,38,38,.6); } }

    /* 🚑 Away for a consultation: ambulance livery (white body, red band, blue / red beacon). */
    .roster-card-wrapper.oc-skin-consult .roster-card {
        background:
            linear-gradient(180deg, transparent 0 62%, #dc2626 62% 70%, transparent 70%),
            repeating-linear-gradient(135deg, rgba(220,38,38,.07) 0 10px, transparent 10px 20px),
            linear-gradient(180deg, #ffffff, #f3f4f6) !important;
        box-shadow: 0 10px 26px rgba(15,23,42,.18), inset 0 0 0 1px rgba(220,38,38,.25) !important;
    }
    body.dark .roster-card-wrapper.oc-skin-consult .roster-card {
        background:
            linear-gradient(180deg, transparent 0 62%, #b91c1c 62% 70%, transparent 70%),
            repeating-linear-gradient(135deg, rgba(248,113,113,.08) 0 10px, transparent 10px 20px),
            linear-gradient(180deg, #111827, #0b1220) !important;
        box-shadow: 0 10px 26px rgba(0,0,0,.45), inset 0 0 0 1px rgba(248,113,113,.25) !important;
    }
    .roster-card-wrapper.oc-skin-consult .roster-card::before {
        content: ''; position: absolute; top: -6px; left: 50%; width: 46px; height: 10px; transform: translateX(-50%); border-radius: 6px 6px 3px 3px; z-index: 2;
        background: linear-gradient(90deg, #2563eb 0 50%, #dc2626 50% 100%); animation: ocBeacon .9s steps(2) infinite;
    }
    @keyframes ocBeacon { 0% { box-shadow: -14px -2px 18px rgba(37,99,235,.9); } 50% { box-shadow: 14px -2px 18px rgba(220,38,38,.9); } }

    /* Custom skins. */
    .roster-card-wrapper.oc-skin-night .roster-card { background: repeating-linear-gradient(45deg, #111 0 4px, #1a1a1a 4px 8px), #111 !important; box-shadow: 0 10px 26px rgba(0,0,0,.45), inset 0 0 0 1px rgba(34,211,238,.45) !important; }
    .roster-card-wrapper.oc-skin-ocean .roster-card { background: radial-gradient(120% 60% at 50% 120%, rgba(56,189,248,.35), transparent 60%), linear-gradient(160deg, #082f49, #0c4a6e 55%, #0369a1) !important; box-shadow: 0 10px 26px rgba(3,105,161,.4) !important; }
    .roster-card-wrapper.oc-skin-emerald .roster-card { background: radial-gradient(circle at 85% 15%, rgba(110,231,183,.3), transparent 45%), linear-gradient(160deg, #022c22, #065f46 55%, #047857) !important; box-shadow: 0 10px 26px rgba(4,120,87,.4) !important; }
    .roster-card-wrapper.oc-skin-violet .roster-card {
        background: radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1.5px 1.5px at 85% 65%, #e9d5ff, transparent), radial-gradient(1px 1px at 35% 80%, #fff, transparent),
            radial-gradient(circle at 75% 30%, rgba(192,132,252,.45), transparent 50%), linear-gradient(160deg, #1e1b4b, #4c1d95 60%, #6d28d9) !important;
        box-shadow: 0 10px 26px rgba(76,29,149,.45) !important;
    }
    .roster-card-wrapper.oc-skin-rose .roster-card { background: radial-gradient(circle at 15% 20%, rgba(255,255,255,.25), transparent 40%), linear-gradient(160deg, #831843, #be185d 55%, #db2777) !important; box-shadow: 0 10px 26px rgba(190,24,93,.4) !important; }
    .roster-card-wrapper.oc-skin-gold .roster-card {
        background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.55) 45%, transparent 60%) -200% 0 / 250% 100% no-repeat, linear-gradient(160deg, #fde68a, #f59e0b 55%, #d97706) !important;
        box-shadow: 0 10px 26px rgba(217,119,6,.4) !important; animation: ocShine 3.2s ease-in-out infinite;
    }
    @keyframes ocShine { to { background-position: 200% 0, 0 0; } }
    @media (prefers-reduced-motion: reduce) { .roster-card-wrapper[class*="oc-skin-"] .roster-card, .roster-card-wrapper[class*="oc-skin-"] .roster-card::before { animation: none !important; } }

    /* The status options (the card's back face). */
    .oc-back { gap: .5rem; }
    .oc-back h4 { margin: 0; font-size: .85rem; font-weight: 900; }
    .oc-opts { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
    .oc-opt { display: flex; align-items: center; gap: .4rem; padding: .5rem .6rem; border-radius: .85rem; border: 1.5px solid rgba(142,142,147,.25); background: rgba(142,142,147,.07); font: 800 .74rem inherit; font-family: inherit; color: inherit; cursor: pointer; text-align: start; transition: transform .15s, border-color .15s, background .15s; }
    .oc-opt:active { transform: scale(.97); }
    .oc-opt.on { border-color: #0A84FF; background: rgba(10,132,255,.12); }
    .oc-opt .oc-ic { font-size: 1.05rem; }
    .oc-custom { display: grid; gap: .4rem; }
    .oc-custom[hidden] { display: none; }
    .oc-custom input { width: 100%; padding: .45rem .6rem; border-radius: .7rem; border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; font: 700 .78rem inherit; font-family: inherit; }
    .oc-swatches { display: flex; gap: .35rem; flex-wrap: wrap; }
    .oc-swatch { width: 30px; height: 30px; border-radius: 9px; border: 2px solid transparent; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
    .oc-swatch.on { border-color: #0A84FF; transform: scale(1.08); }
    .oc-swatch[data-skin="night"] { background: repeating-linear-gradient(45deg, #111 0 3px, #222 3px 6px); }
    .oc-swatch[data-skin="ocean"] { background: linear-gradient(160deg, #082f49, #0369a1); }
    .oc-swatch[data-skin="emerald"] { background: linear-gradient(160deg, #022c22, #047857); }
    .oc-swatch[data-skin="violet"] { background: linear-gradient(160deg, #1e1b4b, #6d28d9); }
    .oc-swatch[data-skin="gold"] { background: linear-gradient(160deg, #fde68a, #d97706); }
    .oc-swatch[data-skin="rose"] { background: linear-gradient(160deg, #831843, #db2777); }
    .oc-swatch[data-skin="or"] { background: linear-gradient(160deg, #3f0a0d, #8f1a1a); }
    .oc-swatch[data-skin="consult"] { background: linear-gradient(180deg, #fff 0 60%, #dc2626 60% 72%, #fff 72%); }
    .oc-note { font-size: .64rem; font-weight: 700; opacity: .65; }
    .oc-save { padding: .5rem; border-radius: .8rem; border: 0; background: linear-gradient(135deg, #007AFF, #0A84FF); color: #fff; font: 800 .76rem inherit; font-family: inherit; cursor: pointer; }

    /* The warning before contacting a busy resident (an app pop-up, not the browser's). */
    .hub-pop { position: fixed; inset: 0; z-index: 2147482000; display: flex; align-items: flex-end; justify-content: center; padding: 16px; background: rgba(15,23,42,0); transition: background .25s ease; }
    .hub-pop.open { background: rgba(15,23,42,.55); backdrop-filter: blur(6px); }
    .hub-pop .hub-pop-card { width: 100%; max-width: 400px; border-radius: 26px; padding: 22px 20px 16px; text-align: center; background: #fff; color: #111827; box-shadow: 0 24px 60px rgba(0,0,0,.35);
        transform: translateY(40px) scale(.96); opacity: 0; transition: transform .32s cubic-bezier(.2,.9,.25,1.15), opacity .2s ease; }
    .hub-pop.open .hub-pop-card { transform: none; opacity: 1; }
    html.dark .hub-pop .hub-pop-card, body.dark .hub-pop .hub-pop-card { background: #1c1c1e; color: #f2f2f7; }
    @media (min-width: 640px) { .hub-pop { align-items: center; } }
    .hub-pop .hub-pop-icon { width: 64px; height: 64px; margin: -54px auto 8px; border-radius: 22px; display: grid; place-items: center; font-size: 2rem; box-shadow: 0 10px 24px rgba(0,0,0,.25); animation: ocIconIn .5s cubic-bezier(.2,.9,.25,1.3) both; }
    .hub-pop .hub-pop-icon.or { background: linear-gradient(160deg, #3f0a0d, #b91c1c); }
    .hub-pop .hub-pop-icon.consult { background: linear-gradient(180deg, #fff 0 58%, #dc2626 58% 74%, #fff 74%); }
    .hub-pop .hub-pop-icon.custom { background: linear-gradient(160deg, #1e1b4b, #6d28d9); }
    @keyframes ocIconIn { from { transform: scale(.4) rotate(-12deg); opacity: 0; } }
    .hub-pop h3 { margin: 4px 0 6px; font-size: 1.05rem; font-weight: 900; }
    .hub-pop p { margin: 0 0 14px; font-size: .84rem; line-height: 1.7; opacity: .8; }
    .hub-pop .hub-pop-acts { display: grid; gap: 8px; }
    .hub-pop button { padding: 12px; border-radius: 14px; border: 0; font: 800 .86rem inherit; font-family: inherit; cursor: pointer; transition: transform .12s; }
    .hub-pop button:active { transform: scale(.98); }
    .hub-pop .p-primary { background: linear-gradient(135deg, #007AFF, #0A84FF); color: #fff; }
    .hub-pop .p-warn { background: rgba(220,38,38,.1); color: #b91c1c; }
    html.dark .hub-pop .p-warn, body.dark .hub-pop .p-warn { color: #fca5a5; background: rgba(248,113,113,.14); }
    .hub-pop .p-ghost { background: transparent; color: inherit; opacity: .7; }
    @media (prefers-reduced-motion: reduce) { .hub-pop, .hub-pop .hub-pop-card, .hub-pop .hub-pop-icon { transition: none; animation: none; } }

    /* The holder's requests panel. */
    .oc-req { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--hacc-border, rgba(142,142,147,.2)); }
    .oc-req:last-child { border-bottom: 0; }
    .oc-req .oc-req-main { flex: 1; min-width: 0; display: grid; gap: 2px; font-size: .82rem; }
    .oc-req .oc-req-main small { opacity: .7; font-weight: 600; }
    .oc-req .oc-req-acts { display: flex; gap: 6px; flex-shrink: 0; }
    .oc-req .oc-req-acts a, .oc-req .oc-req-acts button { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; border: 1px solid rgba(142,142,147,.3); background: transparent; color: inherit; cursor: pointer; text-decoration: none; }
    .oc-req .oc-req-acts .wa { color: #047857; background: rgba(5,150,105,.1); border-color: rgba(5,150,105,.25); }
    .oc-req .oc-req-acts .call { color: #1d4ed8; background: rgba(37,99,235,.08); border-color: rgba(37,99,235,.2); }
    .oc-req .oc-req-acts .done { color: #fff; background: #10b981; border-color: #10b981; }
    .oc-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .68rem; font-weight: 800; }
    .oc-chip.done { background: rgba(16,185,129,.14); color: #047857; }
    .oc-chip.missed { background: rgba(220,38,38,.12); color: #b91c1c; }
    .oc-empty { text-align: center; padding: 18px; opacity: .65; font-size: .84rem; }
    .oc-ed { padding: 10px; border-radius: 14px; border: 1px solid rgba(142,142,147,.25); margin-bottom: 8px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; position: relative; min-width: 0; }
    .oc-ed > * { min-width: 0; }
    .oc-ed-top, .oc-ed-row { display: flex; gap: 6px; }
    .oc-ed input:not([type=checkbox]), .oc-ed select, .oc-ed-row select { flex: 1; min-width: 0; min-height: 40px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; font: 700 .82rem inherit; font-family: inherit; }
    .oc-ed input:not([type=checkbox]), .oc-ed select { width: auto; max-width: none; margin: 0; box-sizing: border-box; }
    .oc-ed input.oc-ed-icon { flex: 0 0 48px; width: 48px; text-align: center; font-size: 1.2rem; padding: 0; }
    .oc-ed-x { flex: 0 0 40px; width: 40px; border: 0; border-radius: 10px; background: rgba(220,38,38,.1); color: #dc2626; cursor: pointer; }
    .oc-ed-chk { display: flex; align-items: center; gap: 8px; font-size: .76rem; font-weight: 700; }
    .oc-ed-chk input { width: 18px; height: 18px; }
    .oc-ed-move { display: flex; gap: 4px; justify-content: flex-end; }
    .oc-ed-move button { width: 32px; height: 28px; border-radius: 8px; border: 1px solid rgba(142,142,147,.3); background: transparent; color: inherit; cursor: pointer; }
    .oc-ed-move button:disabled { opacity: .3; }
    .oc-dir-chip { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; padding: 4px 10px; border-radius: 999px; font-size: .7rem; font-weight: 900; color: #fff;
        background: linear-gradient(135deg, #3f0a0d, #b91c1c); box-shadow: 0 4px 12px rgba(185,28,28,.25); animation: ocChipIn .35s cubic-bezier(.2,1.3,.4,1) both; }
    .oc-dir-chip.oc-dir-consult { background: linear-gradient(135deg, #1d4ed8, #dc2626); }
    .oc-dir-chip.oc-dir-ocean { background: linear-gradient(135deg, #082f49, #0369a1); } .oc-dir-chip.oc-dir-emerald { background: linear-gradient(135deg, #022c22, #047857); }
    .oc-dir-chip.oc-dir-violet { background: linear-gradient(135deg, #1e1b4b, #6d28d9); } .oc-dir-chip.oc-dir-night { background: linear-gradient(135deg, #111, #374151); }
    .oc-dir-chip.oc-dir-rose { background: linear-gradient(135deg, #831843, #db2777); } .oc-dir-chip.oc-dir-gold { background: linear-gradient(135deg, #b45309, #f59e0b); }
    .oc-dir-dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: ocDot 1.4s ease-in-out infinite; }
    @keyframes ocDot { 50% { opacity: .25; transform: scale(.7); } }
    @keyframes ocChipIn { from { transform: scale(.6); opacity: 0; } }
    .doctor-card.oc-dir-busy { box-shadow: 0 0 0 2px rgba(220,38,38,.45), 0 10px 26px rgba(220,38,38,.12) !important; }
    .oc-h { font-size: .8rem; font-weight: 900; margin: 12px 0 2px; opacity: .8; }
    `;
    if (!document.getElementById('hub-oncall-css')) {
        const style = document.createElement('style');
        style.id = 'hub-oncall-css';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // Cards
    // ------------------------------------------------------------------
    const DARK_TEXT = ['consult', 'gold'];
    function paintSkin(wrapper, st) {
        [...wrapper.classList].filter(c => c.startsWith('oc-')).forEach(c => wrapper.classList.remove(c));
        if (!st || !st.s) return;
        const skin = st.k || (optionOf(st.s) || {}).skin || 'night';
        wrapper.classList.add('oc-skin-' + skin);
        // The ambulance skin is dark at night: light text there.
        const dark = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
        wrapper.classList.add(DARK_TEXT.includes(skin) && !(skin === 'consult' && dark) ? 'oc-dark-text' : 'oc-light-text');
    }

    /** cards: [{ wrapper, h, d, n, surgical, mine }] (Home.html, after each render). */
    async function decorate(cards) {
        if (!A || !A.cardSummary || !cards.length) return;
        await loadOptions();
        const groups = new Map();
        cards.forEach(c => { const k = c.h + '|' + c.d; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
        for (const [k, list] of groups) {
            const [h, d] = k.split('|');
            let res = null;
            try { res = await A.cardSummary(h, d, list.map(c => c.n)); } catch (e) { continue; }
            list.forEach(c => { if (c.wrapper.isConnected) paintCard(c, ((res.cards || {})[c.n] || {}).st || null); });
        }
    }

    function paintCard(c, st) {
        const card = c.wrapper.querySelector('.roster-card');
        const front = card && card.querySelector('.card-front');
        if (!front || card.querySelector('.card-icu-status:not(.card-duty-status)')) return;   // ICU cards keep their bed counter
        c.st = st;
        paintSkin(c.wrapper, st);
        let btn = front.querySelector('.card-duty-status');
        // The holder sets their own status; the owner can set any surgical resident's.
        c.edit = c.mine || !!(Hub.auth.isOwner && Hub.auth.isOwner());
        const show = c.surgical && (c.edit || (st && st.s));
        if (!show) { if (btn) btn.remove(); return; }
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'card-icu-status card-duty-status';
            btn.addEventListener('click', e => {
                e.stopPropagation(); e.preventDefault();
                if (!c.edit) { toast(statusText(c.st) ? `${c.n}: ${statusText(c.st)}` : 'لا توجد حالة', 'info'); return; }
                openOptions(c);
            });
            front.appendChild(btn);
        }
        btn.classList.toggle('oc-busy', !!(st && st.s));
        btn.classList.toggle('oc-idle', !(st && st.s));
        btn.classList.toggle('oc-mine', !!c.edit);
        const wait = c.mine && st && st.w ? `<span class="oc-wait" title="طلبات تواصل بانتظارك">${st.w}</span>` : '';
        btn.innerHTML = st && st.s ? `<span>${esc(statusChip(st))}</span>${wait}` : `<i class="fas fa-circle-dot"></i><span>الحالة</span>${wait}`;
        btn.title = c.mine ? 'اضغط لتغيير حالتك في الخفارة' : c.edit ? `اضغط لتغيير حالة ${c.n} في الخفارة` : statusText(st);
        // A busy resident: WhatsApp / Call ask first.
        if (!c.wrapper._ocGuard) {
            c.wrapper._ocGuard = true;
            c.wrapper.addEventListener('click', e => {
                const a = e.target.closest && e.target.closest('.card-actions .action-btn-sm');
                if (!a || c.mine || !isBusy(c.st) || c.wrapper._ocAllow) return;
                e.preventDefault(); e.stopPropagation();
                busyWarning(c, a);
            }, true);
        }
    }

    // ------------------------------------------------------------------
    // The holder's status options (the card flips, as the ICU card does)
    // ------------------------------------------------------------------
    function openOptions(c) {
        const card = c.wrapper.querySelector('.roster-card');
        let back = card.querySelector('.oc-back');
        if (!back) {
            back = document.createElement('div');
            back.className = 'card-face card-back oc-back';
            back.addEventListener('click', e => e.stopPropagation());
            card.appendChild(back);
        }
        card.classList.add('icu-flip-card');
        const st = c.st || {};
        const cur = st.s || '';
        back.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
                <h4>🩺 ${c.mine ? 'حالتي في الخفارة' : 'حالة ' + esc(c.n)}</h4>
                <button type="button" class="icu-back-close-btn" data-oc="close" title="إغلاق"><i class="fas fa-times"></i></button>
            </div>
            <div class="oc-opts">
                ${OPTS.options.map(o => `<button type="button" class="oc-opt ${cur === o.id ? 'on' : ''}" data-set="${esc(o.id)}"><span class="oc-ic">${esc(o.icon)}</span>${esc(o.label)}</button>`).join('')}
                <button type="button" class="oc-opt ${!cur ? 'on' : ''}" data-set=""><span class="oc-ic">✅</span>بلا حالة</button>
                ${OPTS.allowCustom ? `<button type="button" class="oc-opt ${cur === 'custom' ? 'on' : ''}" data-set="custom"><span class="oc-ic">✏️</span>حالة مخصصة</button>` : ''}
            </div>
            ${OPTS.autoClearHours ? `<div class="oc-note">تُزال الحالة تلقائياً بعد ${hoursText(OPTS.autoClearHours)}.</div>` : ''}
            <div class="oc-custom" ${cur === 'custom' && OPTS.allowCustom ? '' : 'hidden'}>
                <input type="text" maxlength="40" placeholder="مثال: في ردهة الطوارئ" value="${esc(st.l || '')}" aria-label="نص الحالة">
                <div class="oc-swatches">${SKINS.map(s => `<button type="button" class="oc-swatch ${(st.k || 'night') === s.id ? 'on' : ''}" data-skin="${s.id}" title="${esc(s.name)}" aria-label="${esc(s.name)}"></button>`).join('')}</div>
                <button type="button" class="oc-save" data-oc="save-custom">حفظ الحالة المخصصة</button>
            </div>`;
        const flip = () => { if (typeof window.toggleIcuCardFlip === 'function') window.toggleIcuCardFlip(null, back); else card.classList.toggle('flipped'); };
        back.querySelector('[data-oc="close"]').addEventListener('click', e => { e.stopPropagation(); flip(); });
        back.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            const s = b.dataset.set;
            if (s === 'custom') { back.querySelector('.oc-custom').hidden = false; back.querySelectorAll('.oc-opt').forEach(x => x.classList.toggle('on', x === b)); return; }
            save(c, s ? { status: s } : { status: '' }).then(ok => { if (ok) flip(); });
        }));
        back.querySelectorAll('.oc-swatch').forEach(sw => sw.addEventListener('click', e => {
            e.stopPropagation();
            back.querySelectorAll('.oc-swatch').forEach(x => x.classList.toggle('on', x === sw));
        }));
        back.querySelector('[data-oc="save-custom"]').addEventListener('click', e => {
            e.stopPropagation();
            const label = back.querySelector('.oc-custom input').value.trim();
            const skin = (back.querySelector('.oc-swatch.on') || {}).dataset?.skin || 'night';
            save(c, { status: 'custom', label: label || 'مشغول', skin }).then(ok => { if (ok) flip(); });
        });
        if (!card.classList.contains('flipped')) flip();
    }

    async function save(c, body) {
        try {
            const res = await Hub.api('POST', '/api/duty-status', { h: c.h, d: c.d, n: c.n, ...body }, { retries: 0 });
            const st = res.status ? { ...res.status, w: c.st && c.st.w } : (c.st && c.st.w ? { w: c.st.w } : null);
            if (A.setCardStatus) A.setCardStatus(c.h, c.d, c.n, res.status || null);
            paintCard(c, st);
            if (navigator.vibrate) navigator.vibrate(15);
            toast(res.status ? `${c.mine ? 'حالتك' : 'حالة ' + c.n} الآن: ${statusText(res.status)}` : 'أُزيلت الحالة', 'success');
            return true;
        } catch (err) {
            const code = err && err.data && err.data.error;
            toast(({ not_on_duty: c.mine ? 'تُحدَّد الحالة أثناء خفارتك فقط.' : 'تُحدَّد الحالة أثناء خفارة اليوم فقط.', not_your_card: 'هذه ليست بطاقتك.', rate_limited: 'تغييرات كثيرة، انتظر قليلاً.' })[code] || (A.errorText ? A.errorText(err) : 'تعذر الحفظ'), 'error');
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Contacting a busy resident
    // ------------------------------------------------------------------
    function popup({ icon, iconClass, title, text, actions }) {
        return new Promise(resolve => {
            const el = document.createElement('div');
            el.className = 'hub-pop';
            el.innerHTML = `<div class="hub-pop-card" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
                <div class="hub-pop-icon ${iconClass || ''}">${icon}</div>
                <h3>${esc(title)}</h3><p>${text}</p>
                <div class="hub-pop-acts">${actions.map((a, i) => `<button type="button" class="${a.cls}" data-i="${i}">${a.label}</button>`).join('')}</div></div>`;
            let done = false;
            const close = v => {
                if (done) return; done = true;
                el.classList.remove('open');
                setTimeout(() => el.remove(), 280);
                document.removeEventListener('keydown', onKey);
                resolve(v);
            };
            const onKey = e => { if (e.key === 'Escape') close(null); };
            el.addEventListener('click', e => { if (e.target === el) close(null); });
            el.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => close(actions[Number(b.dataset.i)].value)));
            document.addEventListener('keydown', onKey);
            // The app's back button closes it (app-view.js counts it as a pop-up).
            el.setAttribute('data-close', '');
            document.body.appendChild(el);
            requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
        });
    }

    async function busyWarning(c, anchor) {
        const st = c.st;
        const choice = await popup({
            icon: st.i || '⏳',
            iconClass: ['or', 'consult'].includes(st.k) ? st.k : 'custom',
            title: `${c.n} مشغول الآن`,
            text: `<b>${esc(statusText(st))}</b>. قد لا يتمكن من الرد في هذه اللحظة. يمكنك ترك طلب تواصل ليصله إشعار ويتواصل معك حين يتفرغ.`,
            actions: [
                { label: '📨 إرسال طلب تواصل', cls: 'p-primary', value: 'queue' },
                { label: 'التواصل الآن على أي حال', cls: 'p-warn', value: 'go' },
                { label: 'إلغاء', cls: 'p-ghost', value: null },
            ],
        });
        if (choice === 'go') {
            c.wrapper._ocAllow = true;
            try { anchor.click(); } finally { setTimeout(() => { c.wrapper._ocAllow = false; }, 0); }
        } else if (choice === 'queue') {
            if (!A.account || !A.account()) { toast('طلب التواصل يحتاج حساباً شخصياً.', 'error'); return; }
            try {
                const res = await Hub.api('POST', '/api/contact-requests', { h: c.h, d: c.d, n: c.n }, { retries: 0 });
                toast(res.already ? 'طلبك السابق ما زال بانتظاره ✓' : 'أُرسل طلب التواصل. سيصله إشعار ✓', 'success');
            } catch (err) {
                const code = err && err.data && err.data.error;
                toast(({ own_card: 'هذه بطاقتك.', not_on_duty: 'انتهت هذه الخفارة.', rate_limited: 'طلبات كثيرة، انتظر قليلاً.' })[code] || (A.errorText ? A.errorText(err) : 'تعذر الإرسال'), 'error');
            }
        }
    }

    // ------------------------------------------------------------------
    // The holder's contact requests
    // ------------------------------------------------------------------
    const hospitalName = id => { const h = Hub.getHospital && Hub.getHospital(id); return h ? (h.name_ar || h.hospitalName) : (id || ''); };
    const waHref = p => { const d = String(p || '').replace(/\D/g, ''); return d ? 'whatsapp://send?phone=' + (d.startsWith('964') ? d : '964' + d.replace(/^0/, '')) : ''; };
    const telHref = p => { const d = String(p || '').replace(/\D/g, ''); return d ? 'tel:+' + (d.startsWith('964') ? d : '964' + d.replace(/^0/, '')) : ''; };

    /** The holder's requests: in their own sheet, or inside `host` (the account panel). */
    async function openRequests(host) {
        let list;
        if (host) {
            host.innerHTML = '<div data-role="list"><div class="oc-empty">جاري التحميل…</div></div>';
            list = host.querySelector('[data-role="list"]');
        } else {
            const sheet = A.openSheet(`<header class="hacc-sheet-head"><h2>📞 طلبات التواصل</h2>
                    <button type="button" class="hacc-icon-btn" data-act="close" aria-label="إغلاق">✕</button></header>
                <div class="hacc-sheet-body" data-role="list"><div class="oc-empty">جاري التحميل…</div></div>`, { label: 'طلبات التواصل', tall: true });
            sheet.querySelector('[data-act="close"]').addEventListener('click', A.closeSheet);
            list = sheet.querySelector('[data-role="list"]');
        }
        const paint = data => {
            const row = (r, open) => `<div class="oc-req" data-id="${r.id}">
                ${A.avatarHtml ? A.avatarHtml({ name: r.by, avatar: r.avatar, sex: r.sex }, 40) : ''}
                <div class="oc-req-main"><b>${esc(r.by || 'زميل')}</b>
                    <small>${esc(r.date)} · ${esc(hospitalName(r.hosp))} · ${esc(A.timeAgo ? A.timeAgo(r.at) : '')}</small>
                    ${r.note ? `<small>«${esc(r.note)}»</small>` : ''}
                    ${!open ? `<span><span class="oc-chip ${r.status}">${r.status === 'done' ? '✓ تم التواصل' : '✗ فائت'}</span></span>` : ''}</div>
                <div class="oc-req-acts">
                    ${r.byPhone ? `<a class="wa" href="${waHref(r.byPhone)}" title="واتساب" aria-label="واتساب"><i class="fab fa-whatsapp"></i></a>
                    <a class="call" href="${telHref(r.byPhone)}" title="اتصال" aria-label="اتصال"><i class="fas fa-phone"></i></a>` : ''}
                    ${open || r.status === 'missed' ? `<button type="button" class="done" data-done="${r.id}" title="تم" aria-label="تم"><i class="fas fa-check"></i></button>` : ''}
                </div></div>`;
            list.innerHTML = `<div class="oc-h">بانتظارك (${data.pending.length})</div>
                ${data.pending.length ? data.pending.map(r => row(r, true)).join('') : '<div class="oc-empty">لا توجد طلبات معلقة 🎉</div>'}
                ${data.past.length ? `<div class="oc-h">سابقة</div>${data.past.map(r => row(r, false)).join('')}` : ''}`;
            list.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', async () => {
                b.disabled = true;
                try {
                    await Hub.api('POST', '/api/contact-requests/done', { id: Number(b.dataset.done) }, { retries: 0 });
                    const r = [...data.pending, ...data.past].find(x => x.id === Number(b.dataset.done));
                    if (r) { r.status = 'done'; data.pending = data.pending.filter(x => x !== r); data.past = [r, ...data.past.filter(x => x !== r)]; }
                    paint(data);
                    toast('تم ✓', 'success');
                } catch (err) { b.disabled = false; toast(A.errorText ? A.errorText(err) : 'تعذر الحفظ', 'error'); }
            }));
        };
        try { paint(await Hub.api('GET', '/api/contact-requests', undefined, { retries: 1 })); }
        catch (err) { list.innerHTML = `<div class="oc-empty">${esc(A.errorText ? A.errorText(err) : 'تعذر التحميل')}</div>`; }
    }

    // ------------------------------------------------------------------
    // The owner: the status options and the auto-clear time (account panel → administration)
    // ------------------------------------------------------------------
    const SKIN_NAMES = { or: 'عمليات (دم)', consult: 'إسعاف', night: 'كاربون', ocean: 'محيط', emerald: 'زمرد', violet: 'مجرة', gold: 'ذهبي', rose: 'وردي' };
    async function editor(host) {
        host.innerHTML = '<div class="oc-empty">جاري التحميل…</div>';
        const data = JSON.parse(JSON.stringify(await loadOptions(true)));
        const paint = () => {
            host.innerHTML = `
                <p class="hacc-muted" style="margin:0 0 10px">الحالات التي يختار منها مقيمو الفروع الجراحية أثناء خفاراتهم. يعدّلها مالك المنظومة فقط.</p>
                <div class="oc-ed-list">${data.options.map((o, i) => `<div class="oc-ed" data-i="${i}">
                    <div class="oc-ed-top">
                        <input class="oc-ed-icon" data-f="icon" value="${esc(o.icon)}" maxlength="4" aria-label="الأيقونة">
                        <input data-f="label" value="${esc(o.label)}" maxlength="40" placeholder="اسم الحالة" aria-label="اسم الحالة">
                        <button type="button" class="oc-ed-x" data-act="del" aria-label="حذف">✕</button>
                    </div>
                    <div class="oc-ed-row">
                        <input data-f="chip" value="${esc(o.chip)}" maxlength="20" placeholder="نص قصير على البطاقة" aria-label="النص على البطاقة">
                        <select data-f="skin" aria-label="مظهر البطاقة">${SKINS.map(k => `<option value="${k.id}" ${o.skin === k.id ? 'selected' : ''}>${esc(SKIN_NAMES[k.id] || k.name)}</option>`).join('')}</select>
                    </div>
                    <label class="oc-ed-chk"><input type="checkbox" data-f="busy" ${o.busy !== false ? 'checked' : ''}> تنبيه قبل التواصل معه (مشغول)</label>
                    <div class="oc-ed-move"><button type="button" data-act="up" ${i ? '' : 'disabled'}>↑</button><button type="button" data-act="down" ${i < data.options.length - 1 ? '' : 'disabled'}>↓</button></div>
                </div>`).join('')}</div>
                <button type="button" class="hacc-btn btn-block" data-act="add" ${data.options.length >= 12 ? 'disabled' : ''}><i class="fas fa-plus"></i> إضافة حالة</button>
                <label class="oc-ed-chk" style="margin-top:12px"><input type="checkbox" data-g="allowCustom" ${data.allowCustom ? 'checked' : ''}> السماح للمقيم بكتابة حالة مخصصة</label>
                <div class="oc-ed-row" style="margin-top:8px;align-items:center">
                    <span style="font-size:.8rem;font-weight:800">الإزالة التلقائية للحالة بعد</span>
                    <select data-g="autoClearHours">${[0, 1, 2, 3, 4, 6, 8, 12, 24].map(h => `<option value="${h}" ${Number(data.autoClearHours) === h ? 'selected' : ''}>${h ? hoursText(h) : 'لا تُزال'}</option>`).join('')}</select>
                </div>
                <button type="button" class="hacc-btn primary btn-block" data-act="save" style="margin-top:14px">حفظ حالات الخفارة</button>`;
            host.querySelectorAll('.oc-ed').forEach(row => {
                const o = data.options[Number(row.dataset.i)];
                row.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
                    o[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value;
                }));
                row.querySelector('[data-act="del"]').addEventListener('click', () => { data.options.splice(Number(row.dataset.i), 1); paint(); });
                row.querySelector('[data-act="up"]').addEventListener('click', () => { const i = Number(row.dataset.i); [data.options[i - 1], data.options[i]] = [data.options[i], data.options[i - 1]]; paint(); });
                row.querySelector('[data-act="down"]').addEventListener('click', () => { const i = Number(row.dataset.i); [data.options[i + 1], data.options[i]] = [data.options[i], data.options[i + 1]]; paint(); });
            });
            host.querySelectorAll('[data-g]').forEach(inp => inp.addEventListener('change', () => { data[inp.dataset.g] = inp.type === 'checkbox' ? inp.checked : Number(inp.value); }));
            host.querySelector('[data-act="add"]').addEventListener('click', () => {
                data.options.push({ id: 's' + Date.now().toString(36).slice(-6), icon: '⏳', label: '', chip: '', skin: 'night', busy: true });
                paint();
                const last = host.querySelector('.oc-ed:last-child [data-f="label"]');
                if (last) last.focus();
            });
            host.querySelector('[data-act="save"]').addEventListener('click', async e => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                    const res = await Hub.api('POST', '/api/duty-status/options', data, { retries: 0 });
                    Object.assign(data, res);
                    OPTS = { options: res.options, allowCustom: res.allowCustom, autoClearHours: res.autoClearHours };
                    toast('حُفظت حالات الخفارة ✓', 'success');
                    paint();
                } catch (err) { btn.disabled = false; toast(A.errorText ? A.errorText(err) : 'تعذر الحفظ', 'error'); }
            });
        };
        paint();
    }

    // ------------------------------------------------------------------
    // The residents page: who is busy on duty right now (a chip on their card)
    // ------------------------------------------------------------------
    let dirCache = null;
    /** "ساعة" / "ساعتين" / "N ساعات" / "N ساعة". */
    const hoursText = h => h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${h} ساعات` : `${h} ساعة`;

    async function markDirectory(grid) {
        if (!grid || !Hub.getHospitals) return;
        const ids = Hub.getHospitals().map(h => h.id).filter(Boolean);
        if (!ids.length) return;
        if (!dirCache || Date.now() - dirCache.at > 60000) {
            const q = new URLSearchParams();
            ids.forEach(h => q.append('h', h));
            try { dirCache = { at: Date.now(), list: (await Hub.api('GET', '/api/duty-status/today?' + q, undefined, { retries: 1 })).statuses || [] }; }
            catch (e) { return; }
        }
        const busy = dirCache.list.filter(isBusy);
        const db = Hub.getDatabase ? Hub.getDatabase() : null;
        grid.querySelectorAll('[data-resident-name]').forEach(card => {
            // Same name and one of the resident's hospitals (a namesake elsewhere is someone else).
            const rec = db && (db.residents || []).find(r => r && r.id === card.dataset.residentId);
            const key = Hub.nameKey(card.dataset.residentName);
            const st = busy.find(x => x.key === key && (!rec || !Array.isArray(rec.hospitals) || rec.hospitals.includes(x.hosp)));
            card.querySelectorAll('.oc-dir-chip').forEach(c => c.remove());
            card.classList.toggle('oc-dir-busy', !!st);
            if (!st) return;
            const name = card.querySelector('.doctor-name');
            if (!name) return;
            const chip = document.createElement('div');
            chip.className = 'oc-dir-chip oc-dir-' + (st.k || 'night');
            chip.innerHTML = `<span class="oc-dir-dot"></span>${esc(statusChip(st))} · الآن`;
            chip.title = statusText(st);
            name.parentElement.appendChild(chip);
        });
    }

    window.HubOnCall = { decorate, openRequests, statusText, statusChip, loadOptions, editor, markDirectory };
})(window, document);
