/**
 * The opioids responsibility ("ذمة المخدرات"), worker/src/opioids.js.
 *  - manager(host):  the owner's / hospital admins' tab in the account panel (create, edit, confirm and
 *                    notify, replenish / withdraw, delete; every duty's live stock and records).
 *  - mine(host):     the holder's tab: live counters, alerts, a small dashboard and their own records.
 *  - homeButton(btn, hosp): the duty roster's button (the hospital's rotators, the holder, the owner)
 *                    that opens the form to record an ampoule used on a patient.
 */
(function (window, document) {
    'use strict';

    const Hub = window.Hub;
    const A = window.HubAccounts;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, k) => (A && A.toast ? A.toast(m, k) : alert(m));
    const fmt = n => Number(n || 0).toLocaleString('en-US');
    const ERR = {
        place_required: 'اكتب اسم المكان.', wards_required: 'أضف ردهة واحدة على الأقل.', holder_required: 'اختر المقيم المسؤول.',
        holder_not_resident: 'المقيم غير موجود في قاعدة بيانات المستشفى (أو أنه روتيتر).', items_required: 'أضف مادة مخدرة واحدة على الأقل.',
        qty_required: 'اكتب عدد الأمبولات لكل مادة.', item_not_empty: 'لا يمكن حذف مادة بقي منها شيء: اسحب المتبقي أولاً.',
        not_enough: 'العدد المطلوب أكثر من المتبقي.', patient_required: 'اكتب اسم المريض.', sex_required: 'اختر الجنس.',
        age_required: 'اكتب عمراً صحيحاً.', ward_required: 'اختر الردهة.', bad_date: 'التاريخ غير صحيح (لا يكون في المستقبل).',
        reason_required: 'اكتب سبب الإلغاء.', forbidden: 'لا تملك صلاحية لهذا.', rate_limited: 'محاولات كثيرة، انتظر قليلاً.',
        patient_three_names: 'اكتب اسم المريض الثلاثي (اسمه واسم أبيه وجده).', would_go_negative: 'لا يمكن الحذف: سيصبح المتبقي أقل من صفر.',
        not_editable: 'سجل الاستلام من المسؤول السابق لا يُعدَّل.', deleted: 'هذا السجل محذوف.', diagnosis_required: 'اكتب التشخيص.',
    };
    const errText = e => { const c = e && e.data && e.data.error; return (c === 'item_not_empty' && e.data.item ? `«${e.data.item}»: ` : '') + (ERR[c] || (A && A.errorText ? A.errorText(e) : 'تعذر الإتمام')); };
    const api = (method, path, body) => Hub.api(method, path, body, { retries: method === 'GET' ? 1 : 0 });
    const today = () => (Hub.getMedicalDate ? Hub.getMedicalDate() : '').split('/').reverse().join('-') || new Date().toISOString().slice(0, 10);
    const dateText = iso => iso ? iso.split('-').reverse().join('/') : '';
    const timeText = ms => ms ? new Date(ms).toLocaleString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' }) : '';
    const hospName = id => { const h = Hub.getHospital && Hub.getHospital(id); return h ? (h.name_ar || h.hospitalName || id) : id; };
    const level = (left, low) => left <= 0 ? 'out' : left <= low ? 'low' : 'ok';
    const SEX = { m: 'ذكر', f: 'أنثى' };
    const threeNames = n => String(n || '').trim().split(/\s+/).filter(w => w.replace(/[^\p{L}]/gu, '').length >= 2).length >= 3;
    const KIND = { issue: ['📦', 'استلام / تعويض'], use: ['💉', 'استخدام'], withdraw: ['↩️', 'سحب'], handover: ['🤝', 'استلام من المسؤول السابق'] };

    const CSS = `
    .opi { --opi1: #7c3aed; --opi2: #db2777; }
    .opi-top { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; }
    .opi-top select { min-height: 38px; border-radius: 10px; padding: 0 10px; border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; font: 700 .8rem inherit; font-family: inherit; }
    .opi-new { border: 0; border-radius: 12px; padding: 9px 14px; background: linear-gradient(135deg, var(--opi1), var(--opi2)); color: #fff; font: 800 .8rem inherit; font-family: inherit; cursor: pointer; box-shadow: 0 6px 16px rgba(124,58,237,.3); }
    .opi-card { border-radius: 18px; padding: 14px; margin-bottom: 12px; border: 1px solid rgba(142,142,147,.22); background: rgba(142,142,147,.05); position: relative; overflow: hidden; }
    .opi-card::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg, var(--opi1), var(--opi2)); }
    .opi-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    .opi-head h3 { margin: 0; font-size: 1rem; font-weight: 900; }
    .opi-sub { font-size: .72rem; font-weight: 700; opacity: .7; margin-top: 2px; }
    .opi-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: .66rem; font-weight: 900; white-space: nowrap; }
    .opi-chip.draft { background: rgba(142,142,147,.18); }
    .opi-chip.pending { background: #fef3c7; color: #92400e; }
    .opi-chip.active { background: #dcfce7; color: #166534; }
    .opi-wards { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
    .opi-wards span { padding: 3px 9px; border-radius: 999px; font-size: .68rem; font-weight: 800; background: rgba(124,58,237,.1); color: var(--opi1); }
    body.dark .opi-wards span { color: #c4b5fd; }
    .opi-holder { display: flex; align-items: center; gap: 8px; font-size: .78rem; font-weight: 800; margin: 6px 0 10px; flex-wrap: wrap; }
    .opi-holder .next { color: #b45309; }
    .opi-items { display: grid; gap: 8px; }
    .opi-item { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; padding: 9px 11px; border-radius: 14px; background: rgba(142,142,147,.08); }
    .opi-item b { font-size: .82rem; font-weight: 900; }
    .opi-num { font-size: 1.05rem; font-weight: 900; font-variant-numeric: tabular-nums; }
    .opi-item.low .opi-num { color: #d97706; } .opi-item.out .opi-num { color: #dc2626; } .opi-item.ok .opi-num { color: #16a34a; }
    .opi-bar { grid-column: 1 / -1; height: 6px; border-radius: 99px; background: rgba(142,142,147,.2); overflow: hidden; }
    .opi-bar i { display: block; height: 100%; border-radius: 99px; background: #22c55e; transition: width .5s; }
    .opi-item.low .opi-bar i { background: #f59e0b; } .opi-item.out .opi-bar i { background: #ef4444; }
    .opi-item-acts { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
    .opi-btn { border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; border-radius: 10px; padding: 6px 10px; font: 800 .72rem inherit; font-family: inherit; cursor: pointer; }
    .opi-btn.primary { border: 0; color: #fff; background: linear-gradient(135deg, var(--opi1), var(--opi2)); }
    .opi-btn.warn { border-color: #f59e0b; color: #b45309; }
    .opi-btn.danger { border-color: rgba(220,38,38,.4); color: #dc2626; }
    .opi-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
    .opi-confirm { width: 100%; margin-top: 10px; padding: 11px; border-radius: 14px; border: 0; font: 900 .85rem inherit; font-family: inherit; color: #fff; cursor: pointer;
        background: linear-gradient(135deg, #f59e0b, #ea580c); box-shadow: 0 6px 16px rgba(234,88,12,.3); animation: opiPulse 2.4s ease-in-out infinite; }
    @keyframes opiPulse { 50% { box-shadow: 0 6px 22px rgba(234,88,12,.55); } }
    .opi-form { display: grid; gap: 10px; }
    .opi-form label { display: grid; gap: 4px; font-size: .74rem; font-weight: 800; }
    .opi-form input, .opi-form select { min-height: 40px; border-radius: 10px; padding: 0 10px; border: 1px solid rgba(142,142,147,.35); background: transparent; color: inherit; font: 700 .82rem inherit; font-family: inherit; width: 100%; box-sizing: border-box; }
    .opi-row { display: flex; gap: 6px; align-items: center; }
    .opi-row > * { min-width: 0; }
    .opi-tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .opi-tags span { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px 4px 10px; border-radius: 999px; background: rgba(124,58,237,.12); font-size: .72rem; font-weight: 800; }
    .opi-tags button { border: 0; background: rgba(0,0,0,.12); color: inherit; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: .6rem; line-height: 1; }
    .opi-sugg { position: relative; }
    .opi-sugg-list { position: absolute; inset: 100% 0 auto 0; z-index: 20; margin-top: 4px; border-radius: 12px; overflow: hidden; background: #fff; color: #111827; box-shadow: 0 12px 30px rgba(0,0,0,.2); max-height: 240px; overflow-y: auto; }
    body.dark .opi-sugg-list { background: #1c1c1e; color: #f2f2f7; }
    .opi-sugg-list button { display: block; width: 100%; text-align: start; padding: 9px 12px; border: 0; background: transparent; color: inherit; font: 700 .8rem inherit; font-family: inherit; cursor: pointer; }
    .opi-sugg-list button:hover, .opi-sugg-list button.on { background: rgba(124,58,237,.12); }
    .opi-it-row { display: grid; grid-template-columns: 1fr 70px 64px 30px; gap: 6px; align-items: end; }
    .opi-it-row small { font-size: .62rem; opacity: .7; }
    .opi-x { border: 0; border-radius: 9px; height: 40px; background: rgba(220,38,38,.1); color: #dc2626; cursor: pointer; }
    .opi-log { margin-top: 10px; overflow-x: auto; border-radius: 12px; border: 1px solid rgba(142,142,147,.2); }
    .opi-log table { width: 100%; border-collapse: collapse; font-size: .7rem; min-width: 700px; }
    .opi-log th { background: rgba(142,142,147,.12); font-weight: 900; padding: 7px 6px; text-align: start; white-space: nowrap; }
    .opi-log td { padding: 7px 6px; border-top: 1px solid rgba(142,142,147,.15); font-weight: 700; vertical-align: top; }
    .opi-log tr.void td { text-decoration: line-through; opacity: .5; }
    .opi-log .k-issue { color: #16a34a; } .opi-log .k-withdraw { color: #b45309; } .opi-log .k-handover { color: #2563eb; }
    .opi-empty { text-align: center; padding: 26px 10px; font-weight: 800; opacity: .7; font-size: .82rem; }
    .opi-mine-head { border-radius: 20px; padding: 16px; color: #fff; background: linear-gradient(135deg, #5b21b6, #9d174d); margin-bottom: 12px; box-shadow: 0 10px 26px rgba(91,33,182,.3); }
    .opi-mine-head h3 { margin: 0 0 2px; font-size: 1.05rem; font-weight: 900; }
    .opi-mine-head .opi-wards span { background: rgba(255,255,255,.18); color: #fff; }
    .opi-counters { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .opi-counter { border-radius: 16px; padding: 12px; text-align: center; border: 1.5px solid; }
    .opi-counter.ok { border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.08); }
    .opi-counter.low { border-color: rgba(245,158,11,.6); background: rgba(245,158,11,.12); }
    .opi-counter.out { border-color: rgba(239,68,68,.6); background: rgba(239,68,68,.12); animation: opiOut 1.8s ease-in-out infinite; }
    @keyframes opiOut { 50% { background: rgba(239,68,68,.22); } }
    .opi-counter b { display: block; font-size: 1.9rem; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .opi-counter.ok b { color: #16a34a; } .opi-counter.low b { color: #d97706; } .opi-counter.out b { color: #dc2626; }
    .opi-counter span { font-size: .74rem; font-weight: 900; }
    .opi-counter small { display: block; font-size: .62rem; font-weight: 800; opacity: .75; margin-top: 3px; }
    .opi-alert { border-radius: 14px; padding: 10px 12px; margin-bottom: 8px; font-size: .78rem; font-weight: 800; display: flex; gap: 8px; align-items: center; }
    .opi-alert.low { background: #fef3c7; color: #92400e; } .opi-alert.out { background: #fee2e2; color: #991b1b; }
    .opi-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .opi-stat { border-radius: 14px; padding: 10px; text-align: center; background: rgba(142,142,147,.08); }
    .opi-stat b { display: block; font-size: 1.2rem; font-weight: 900; }
    .opi-stat small { font-size: .64rem; font-weight: 800; opacity: .7; }
    .opi-wardbars { display: grid; gap: 6px; margin-bottom: 12px; }
    .opi-wardbar { display: grid; grid-template-columns: 90px 1fr 28px; gap: 8px; align-items: center; font-size: .7rem; font-weight: 800; }
    .opi-wardbar div { height: 8px; border-radius: 99px; background: rgba(142,142,147,.18); overflow: hidden; }
    .opi-wardbar i { display: block; height: 100%; background: linear-gradient(90deg, var(--opi1), var(--opi2)); border-radius: 99px; }
    .opi-h4 { margin: 14px 0 8px; font-size: .84rem; font-weight: 900; }
    .opi-seg { display: inline-grid; grid-auto-flow: column; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(142,142,147,.14); }
    .opi-seg button { border: 0; padding: 7px 14px; border-radius: 9px; background: transparent; color: inherit; font: 800 .78rem inherit; font-family: inherit; cursor: pointer; }
    .opi-seg button.on { background: #fff; color: #111827; box-shadow: 0 2px 6px rgba(0,0,0,.12); }
    .opi-warn { color: #b45309 !important; font-weight: 800; }
    div.opi-warn { margin: -4px 0 10px; padding: 8px 10px; border-radius: 12px; background: #fef3c7; font-size: .74rem; line-height: 1.6; }
    .opi-noacc { color: #b45309; font-size: .66rem; font-weight: 800; }
    .opi-ed { font-size: .62rem; opacity: .75; }
    .opi-row-acts { white-space: nowrap; }
    .opi-row-acts .opi-btn { padding: 4px 7px; margin-inline-end: 3px; }
    .opi-editbox { padding: 12px; margin-bottom: 12px; border-radius: 16px; border: 1.5px solid #a78bfa; background: rgba(124,58,237,.06); animation: opiIn .25s ease both; }
    @keyframes opiIn { from { opacity: 0; transform: translateY(-6px); } }
    .opi-chk { display: flex !important; align-items: center; gap: 8px; grid-template-columns: none !important; }
    .opi-chk input { width: 18px !important; min-height: 0 !important; height: 18px; }
    .opi-refill { margin-top: 6px; font-size: .66rem; padding: 4px 8px; }
    /* The recording form (the duty roster's pop-up, and the holder's tab) */
    .opu { --o1: #6d28d9; --o2: #db2777; display: flex; flex-direction: column; min-height: 100%; }
    .opu-sheet { padding: 0 !important; overflow: hidden; }
    /* In the sheet (fixed height): the form scrolls between the header and the submit bar. */
    .opu-sheet .opu { flex: 1; min-height: 0; }
    .opu-sheet .opu-hero, .opu-sheet .opu-steps, .opu-sheet .opu-foot { flex: none; }
    .opu-sheet .opu-body { min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y; }
    .opu-hero { position: relative; display: flex; gap: 12px; align-items: center; padding: 18px 16px 16px; color: #fff; border-radius: 0 0 26px 26px;
        background: radial-gradient(120% 140% at 100% 0%, rgba(255,255,255,.18), transparent 50%), linear-gradient(135deg, #4c1d95, #7c3aed 55%, #db2777); box-shadow: 0 10px 28px rgba(109,40,217,.35); }
    .opu-ic { width: 48px; height: 48px; flex: none; border-radius: 16px; display: grid; place-items: center; font-size: 1.5rem; background: rgba(255,255,255,.18); backdrop-filter: blur(6px); }
    .opu-hero h2 { margin: 0; font-size: 1.02rem; font-weight: 900; }
    .opu-who { font-size: .72rem; font-weight: 700; opacity: .92; margin-top: 3px; }
    .opu-x { position: absolute; top: 12px; inset-inline-end: 12px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(255,255,255,.2); color: #fff; font-size: .95rem; cursor: pointer; }
    .opu-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 12px 14px 4px; }
    .opu-steps span { position: relative; text-align: center; padding: 7px 4px 7px 4px; border-radius: 12px; font-size: .68rem; font-weight: 900; background: rgba(142,142,147,.12); color: #8e8e93; transition: all .25s; }
    .opu-steps span::before { content: '○ '; }
    .opu-steps span.done { background: rgba(124,58,237,.12); color: var(--o1); }
    .opu-steps span.done::before { content: '✓ '; }
    body.dark .opu-steps span.done { color: #c4b5fd; }
    .opu-body { padding: 6px 14px 14px; flex: 1; }
    .opu-lab { margin: 12px 2px 6px; font-size: .72rem; font-weight: 900; opacity: .8; }
    .opu-place { margin-top: 8px; padding: 10px 12px; border-radius: 14px; background: rgba(124,58,237,.08); font-size: .8rem; font-weight: 900; }
    .opu-place span { font-weight: 700; opacity: .75; }
    .opu-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    .opu-card { text-align: start; padding: 11px 12px; border-radius: 16px; border: 1.5px solid rgba(142,142,147,.25); background: rgba(142,142,147,.06); color: inherit; font: inherit; cursor: pointer; transition: all .2s; }
    .opu-card b { display: block; font-size: .8rem; font-weight: 900; }
    .opu-card small { display: block; font-size: .66rem; font-weight: 800; margin-top: 3px; opacity: .75; }
    .opu-card.on { border-color: var(--o1); background: rgba(124,58,237,.1); box-shadow: 0 0 0 3px rgba(124,58,237,.18); }
    .opu-item.low small { color: #d97706; opacity: 1; } .opu-item.out small { color: #dc2626; opacity: 1; }
    .opu-card:disabled { opacity: .45; cursor: not-allowed; }
    .opu-step { display: grid; grid-template-columns: 52px 1fr 52px; gap: 6px; max-width: 260px; }
    .opu-step button { height: 48px; border-radius: 14px; border: 0; background: rgba(124,58,237,.12); color: var(--o1); font-size: 1.3rem; font-weight: 900; cursor: pointer; }
    body.dark .opu-step button { color: #c4b5fd; }
    .opu-step input { height: 48px; text-align: center; font-size: 1.2rem; font-weight: 900; }
    .opu-in, .opu-step input { width: 100%; box-sizing: border-box; min-height: 48px; border-radius: 14px; border: 1.5px solid rgba(142,142,147,.3); background: rgba(142,142,147,.05); color: inherit; padding: 0 12px; font: 800 .88rem inherit; font-family: inherit; transition: border-color .2s, box-shadow .2s; }
    .opu-in:focus, .opu-step input:focus { outline: none; border-color: var(--o1); box-shadow: 0 0 0 3px rgba(124,58,237,.18); }
    .opu-namecheck { margin: 5px 4px 0; font-size: .66rem; font-weight: 800; opacity: .7; }
    .opu-namecheck.ok { color: #16a34a; opacity: 1; } .opu-namecheck.bad { color: #d97706; opacity: 1; }
    .opu-two { display: grid; grid-template-columns: 1fr 110px; gap: 10px; }
    .opu-sex { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .opu-sex button, .opu-chips button, .opu-date button { min-height: 48px; border-radius: 14px; border: 1.5px solid rgba(142,142,147,.28); background: rgba(142,142,147,.06); color: inherit; font: 900 .8rem inherit; font-family: inherit; cursor: pointer; transition: all .2s; }
    .opu-sex button[data-sex="m"].on { border-color: #2563eb; background: rgba(37,99,235,.12); color: #1d4ed8; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
    .opu-sex button[data-sex="f"].on { border-color: #db2777; background: rgba(219,39,119,.12); color: #be185d; box-shadow: 0 0 0 3px rgba(219,39,119,.15); }
    .opu-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .opu-chips button { min-height: 42px; padding: 0 14px; }
    .opu-chips button.on { border-color: var(--o1); background: rgba(124,58,237,.12); color: var(--o1); box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
    body.dark .opu-chips button.on { color: #c4b5fd; }
    .opu-date { display: grid; grid-template-columns: 1fr 80px; gap: 6px; }
    .opu-sep { height: 1px; margin: 16px 0 4px; background: linear-gradient(90deg, transparent, rgba(142,142,147,.35), transparent); }
    .opu-foot { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 12px 14px calc(12px + env(safe-area-inset-bottom)); background: inherit;
        backdrop-filter: blur(10px); border-top: 1px solid rgba(142,142,147,.2); z-index: 2; }
    .opu-sum { flex: 1; font-size: .72rem; font-weight: 800; opacity: .85; line-height: 1.5; }
    .opu-sum .ok { color: #16a34a; } .opu-sum .low { color: #d97706; } .opu-sum .out { color: #dc2626; }
    .opu-go { min-width: 120px; height: 48px; border-radius: 16px; border: 0; color: #fff; font: 900 .9rem inherit; font-family: inherit; cursor: pointer;
        background: linear-gradient(135deg, var(--o1), var(--o2)); box-shadow: 0 8px 20px rgba(109,40,217,.35); transition: opacity .2s, transform .15s; }
    .opu-go:disabled { opacity: .4; box-shadow: none; cursor: not-allowed; }
    .opu-go:not(:disabled):active { transform: scale(.97); }
    .opu-go.busy { opacity: .7; }
    .opi-histbtn { display: flex; align-items: center; gap: 12px; width: 100%; margin: 0 0 14px; padding: 12px 14px; border-radius: 18px; border: 1.5px solid rgba(124,58,237,.3);
        background: linear-gradient(135deg, rgba(124,58,237,.08), rgba(219,39,119,.06)); color: inherit; font: inherit; text-align: start; cursor: pointer; }
    .opi-histbtn > span { width: 42px; height: 42px; flex: none; border-radius: 14px; display: grid; place-items: center; font-size: 1.3rem; background: linear-gradient(135deg, #7c3aed, #db2777); }
    .opi-histbtn div { flex: 1; min-width: 0; }
    .opi-histbtn b { display: block; font-size: .9rem; font-weight: 900; }
    .opi-histbtn small { display: block; font-size: .68rem; font-weight: 700; opacity: .75; margin-top: 2px; line-height: 1.5; }
    .opi-histbtn i { opacity: .5; }
    .opi-hist-t { border-radius: 16px; border: 1px solid rgba(142,142,147,.22); padding: 12px; margin-bottom: 10px; background: rgba(142,142,147,.04); }
    .opi-hist-t h4 { margin: 0; font-size: .88rem; font-weight: 900; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .opi-hist-t .opi-sub { margin-top: 3px; }
    .opi-hist-t.cur { border-color: #a78bfa; background: rgba(124,58,237,.05); }
    .opi-code { font: 900 1.4rem/1 ui-monospace, 'SFMono-Regular', Consolas, monospace; letter-spacing: .3em; text-align: center; padding: 12px; border-radius: 12px; background: #fee2e2; color: #991b1b; user-select: none; direction: ltr; }
    .opi-danger-box { border-color: #f87171 !important; background: rgba(239,68,68,.06) !important; }
    .nav-btn.nav-opi { background: linear-gradient(135deg, #7c3aed, #db2777) !important; color: #fff !important; border: 0 !important; box-shadow: 0 4px 14px rgba(124,58,237,.35) !important; }
    .nav-btn.nav-opi .opi-dot { width: 8px; height: 8px; border-radius: 50%; background: #fde047; box-shadow: 0 0 0 2px rgba(255,255,255,.5); }
    `;
    if (!document.getElementById('hub-opi-css')) {
        const st = document.createElement('style');
        st.id = 'hub-opi-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------
    // Shared pieces
    // ------------------------------------------------------------------
    function itemsHtml(items, acts) {
        if (!items.length) return '<div class="opi-sub">لا توجد مواد.</div>';
        const top = Math.max(...items.map(i => i.left), 1);
        return `<div class="opi-items">${items.map(i => `<div class="opi-item ${level(i.left, i.low)}" data-item="${i.id}">
                <b>💊 ${esc(i.name)}</b><span class="opi-num">${fmt(i.left)}</span>
                <div class="opi-bar"><i style="width:${Math.round(Math.min(1, i.left / top) * 100)}%"></i></div>
                ${acts ? `<div class="opi-item-acts"><button type="button" class="opi-btn" data-stock="issue">＋ تعويض</button><button type="button" class="opi-btn warn" data-stock="withdraw">－ سحب</button></div>` : ''}
            </div>`).join('')}</div>`;
    }
    function logTable(moves, { showHolder = false, canEdit = null } = {}) {
        if (!moves.length) return '<div class="opi-empty">لا توجد سجلات بعد.</div>';
        return `<div class="opi-log"><table><thead><tr><th>النوع</th><th>المادة</th><th>العدد</th><th>المريض</th><th>الرقم الإحصائي</th><th>التشخيص</th><th>الجنس</th><th>العمر</th><th>الردهة</th><th>التاريخ</th><th>سجّله</th>${showHolder ? '<th>المسؤول</th>' : ''}${canEdit ? '<th></th>' : ''}</tr></thead><tbody>
            ${moves.map(m => `<tr class="${m.voided ? 'void' : ''}" title="${m.voided ? `حذفه ${esc(m.voidedBy)}${m.voidReason && m.voidReason !== 'حُذف' ? ': ' + esc(m.voidReason) : ''}` : m.edited ? `عدّله ${esc(m.editedBy)} · ${esc(timeText(m.edited))}` : ''}">
                <td class="k-${m.kind}">${KIND[m.kind][0]} ${KIND[m.kind][1]}${m.note && m.kind !== 'use' ? `<br><small>${esc(m.note)}</small>` : ''}</td>
                <td>${esc(m.itemName)}</td><td>${m.kind === 'use' || m.kind === 'withdraw' ? '−' : '+'}${fmt(m.qty)}</td>
                <td>${esc(m.patient)}</td><td>${esc(m.patientNo)}</td><td>${esc(m.diagnosis)}</td><td>${SEX[m.sex] || ''}</td><td>${m.age != null && m.kind === 'use' ? m.age : ''}</td><td>${esc(m.ward)}</td>
                <td>${m.date ? dateText(m.date) : timeText(m.at)}</td><td>${esc(m.by)}${m.edited ? '<br><small class="opi-ed">✎ عُدّل</small>' : ''}${m.voided ? `<br><small class="opi-ed">🗑️ حذفه ${esc(m.voidedBy)}</small>` : ''}</td>
                ${showHolder ? `<td>${esc(m.holder)}</td>` : ''}
                ${canEdit ? `<td class="opi-row-acts">${m.kind !== 'handover' && !m.voided && canEdit(m) ? `<button type="button" class="opi-btn" data-edit="${m.id}" aria-label="تعديل">✏️</button><button type="button" class="opi-btn danger" data-del="${m.id}" aria-label="حذف">🗑️</button>` : ''}</td>` : ''}
            </tr>`).join('')}</tbody></table></div>`;
    }
    /** Edit / delete buttons of a log table. dutyOf(move) gives its duty (wards, items) for the edit form. */
    function bindRowActions(host, moves, dutyOf, after) {
        host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            const m = moves.find(x => x.id === Number(b.dataset.del));
            if (!confirm(`حذف هذا السجل (${KIND[m.kind][1]} · ${m.itemName} · ${m.qty})؟ يبقى ظاهراً مشطوباً مع اسم من حذفه${m.kind === 'use' ? '، ويعود العدد إلى المتبقي' : ''}.`)) return;
            const reason = prompt('سبب الحذف (اختياري):') || '';
            try { await api('POST', '/api/opioids/move', { id: m.id, action: 'delete', reason }); toast('حُذف السجل ✓', 'success'); after(); }
            catch (e) { toast(errText(e), 'error'); }
        }));
        host.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
            const m = moves.find(x => x.id === Number(b.dataset.edit));
            editEntry(host, m, dutyOf(m), after);
        }));
    }
    /** The edit form of a log entry, at the top of the tab (inside the panel). */
    function editEntry(host, m, duty, after) {
        const old = host.querySelector('.opi-editbox');
        if (old) old.remove();
        const box = document.createElement('div');
        box.className = 'opi-editbox opi-form';
        const st = { patient: m.patient, patientNo: m.patientNo, diagnosis: m.diagnosis, sex: m.sex, age: m.age == null ? '' : String(m.age), ward: m.ward, date: m.date, qty: m.qty, note: m.note };
        box.innerHTML = `<div class="opi-top" style="margin:0"><b>✏️ تعديل السجل · ${esc(m.itemName)}</b><button type="button" class="opi-btn" data-act="x">✕</button></div>
            ${m.kind === 'use' ? `
                <div class="opi-row"><label style="flex:1">اسم المريض الثلاثي<input data-f="patient" maxlength="80" value="${esc(st.patient)}"></label>
                    <label style="width:80px">العدد<input data-f="qty" type="number" min="1" max="10" value="${st.qty}"></label></div>
                <div class="opi-row"><label style="width:130px">الرقم الإحصائي (اختياري)<input data-f="patientNo" maxlength="30" inputmode="numeric" value="${esc(st.patientNo)}"></label>
                    <label style="flex:1">التشخيص<input data-f="diagnosis" maxlength="120" value="${esc(st.diagnosis)}"></label></div>
                <div class="opi-row"><label style="flex:1">الجنس<div class="opi-seg" style="display:grid;grid-template-columns:1fr 1fr"><button type="button" data-sex="m" class="${st.sex === 'm' ? 'on' : ''}">ذكر</button><button type="button" data-sex="f" class="${st.sex === 'f' ? 'on' : ''}">أنثى</button></div></label>
                    <label style="width:80px">العمر<input data-f="age" type="number" min="0" max="120" value="${esc(st.age)}"></label></div>
                <label>الردهة<select data-f="ward">${(duty ? duty.wards : [st.ward]).map(w => `<option ${w === st.ward ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
                <label>تاريخ الاستخدام<input data-f="date" type="date" max="${today()}" value="${esc(st.date)}"></label>`
            : `<div class="opi-row"><label style="width:100px">العدد<input data-f="qty" type="number" min="1" max="500" value="${st.qty}"></label>
                <label style="flex:1">ملاحظة<input data-f="note" maxlength="120" value="${esc(st.note)}"></label></div>`}
            <button type="button" class="opi-new" data-act="save">حفظ التعديل</button>`;
        const root = host.querySelector('.opi') || host;
        root.prepend(box);
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        box.querySelectorAll('[data-f]').forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => { st[i.dataset.f] = i.value; }));
        box.querySelectorAll('[data-sex]').forEach(b => b.addEventListener('click', () => { st.sex = b.dataset.sex; box.querySelectorAll('[data-sex]').forEach(x => x.classList.toggle('on', x === b)); }));
        box.querySelector('[data-act="x"]').addEventListener('click', () => box.remove());
        box.querySelector('[data-act="save"]').addEventListener('click', async e => {
            if (m.kind === 'use' && !threeNames(st.patient)) { toast(ERR.patient_three_names, 'error'); return; }
            if (m.kind === 'use' && m.diagnosis && !String(st.diagnosis || '').trim()) { toast(ERR.diagnosis_required, 'error'); return; }
            e.currentTarget.disabled = true;
            try { await api('POST', '/api/opioids/move', { id: m.id, action: 'edit', ...st, qty: Number(st.qty), age: st.age === '' ? '' : Number(st.age) }); toast('حُفظ التعديل ✓', 'success'); after(); }
            catch (err) { e.currentTarget.disabled = false; toast(errText(err), 'error'); }
        });
    }

    // ------------------------------------------------------------------
    // The admins: hand-off, delete (with a typed code), the full history
    // ------------------------------------------------------------------
    /** Holder suggestions on an input (the hospital's residents, not rotators). onPick(r) / onPick(null). */
    function holderPicker(inp, list, hosp, onPick) {
        let timer = null, found = [], idx = -1;
        const show = () => {
            list.hidden = !found.length;
            list.innerHTML = found.map((r, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-r="${i}">${esc(r.name)}${r.account ? '' : ' <small class="opi-noacc">لا يملك حساباً</small>'}</button>`).join('');
            list.querySelectorAll('[data-r]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); pick(found[Number(b.dataset.r)]); }));
        };
        const pick = r => { inp.value = r.name; list.hidden = true; onPick(r); };
        inp.addEventListener('input', () => {
            onPick(null);
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try { found = (await api('GET', `/api/opioids/residents?h=${encodeURIComponent(hosp)}&q=${encodeURIComponent(inp.value.trim())}`)).residents || []; idx = -1; show(); } catch (e) { /* offline */ }
            }, 200);
        });
        inp.addEventListener('focus', () => inp.dispatchEvent(new Event('input')));
        inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
        inp.addEventListener('keydown', e => {
            if (list.hidden) return;
            if (e.key === 'ArrowDown') { idx = Math.min(found.length - 1, idx + 1); show(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); show(); e.preventDefault(); }
            else if (e.key === 'Enter' && found[Math.max(0, idx)]) { e.preventDefault(); pick(found[Math.max(0, idx)]); }
        });
    }
    function topBox(host, html, cls = '') {
        const old = host.querySelector('.opi-editbox');
        if (old) old.remove();
        const box = document.createElement('div');
        box.className = 'opi-editbox opi-form ' + cls;
        box.innerHTML = html;
        (host.querySelector('.opi') || host).prepend(box);
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const x = box.querySelector('[data-act="x"]');
        if (x) x.addEventListener('click', () => box.remove());
        return box;
    }
    function handoffBox(host, d, done) {
        const box = topBox(host, `<div class="opi-top" style="margin:0"><b>🤝 تسليم ذمة ${esc(d.place)}</b><button type="button" class="opi-btn" data-act="x">✕</button></div>
            <div class="opi-sub">المسؤول الآن: <b>${esc(d.holder ? d.holder.name : '—')}</b>. يستلم المقيم الجديد ما تبقى (${d.items.map(i => `${esc(i.name)}: ${fmt(i.left)}`).join('، ')}) ويصله إشعار، ويُبلَّغ المسؤول الحالي بالتسليم.</div>
            <label>المقيم الذي يستلم الذمة
                <div class="opi-sugg"><input data-f="holder" autocomplete="off" placeholder="اكتب الاسم واختر من القائمة"><div class="opi-sugg-list" hidden></div></div>
                <small class="opi-sub" data-role="note">كل مقيمي المستشفى عدا الروتيترية.</small></label>
            <button type="button" class="opi-new" data-act="go" disabled>تسليم الذمة الآن</button>`);
        let chosen = null;
        const note = box.querySelector('[data-role="note"]');
        holderPicker(box.querySelector('[data-f="holder"]'), box.querySelector('.opi-sugg-list'), d.hosp, r => {
            chosen = r;
            box.querySelector('[data-act="go"]').disabled = !r;
            note.className = 'opi-sub' + (r && !r.account ? ' opi-warn' : '');
            note.textContent = !r ? 'اختر الاسم من القائمة.' : r.account ? `✓ ${r.name} (لديه حساب فعّال)` : `⚠️ ${r.name} لا يملك حساباً فعّالاً: لن يصله الإشعار ولن يرى الذمة حتى ينشئ حساباً.`;
        });
        box.querySelector('[data-act="go"]').addEventListener('click', async e => {
            if (!chosen) return;
            if (!chosen.account && !confirm(`${chosen.name} لا يملك حساباً فعّالاً، فلن يصله الإشعار. المتابعة؟`)) return;
            e.currentTarget.disabled = true;
            try {
                const r = await api('POST', '/api/opioids/handoff', { id: d.id, holder: { res: chosen.res, name: chosen.name } });
                toast(r.notified ? `سُلّمت الذمة إلى ${chosen.name} وأُبلغ ✓` : `سُلّمت الذمة إلى ${chosen.name} ✓ (لا يملك حساباً، فلن يصله إشعار)`, r.notified ? 'success' : 'info');
                done();
            } catch (err) { e.currentTarget.disabled = false; toast(err && err.data && err.data.error === 'same_holder' ? 'هذا المقيم هو المسؤول الحالي.' : errText(err), 'error'); }
        });
    }
    function deleteBox(host, d, done) {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
        const box = topBox(host, `<div class="opi-top" style="margin:0"><b style="color:#dc2626">🗑️ حذف ذمة ${esc(d.place)} نهائياً</b><button type="button" class="opi-btn" data-act="x">✕</button></div>
            <div class="opi-warn" style="margin:0">⚠️ سيُحذف هذا الإجراء الذمة <b>وكل سجلاتها</b> نهائياً: الاستلام والتعويض والاستخدام وكل المسؤولين السابقين. لا يمكن التراجع عنه، ولن تظهر هذه السجلات لأحد بعد الآن. اطبع السجل أولاً إن احتجت إليه.</div>
            <div class="opi-sub">للتأكيد اكتب الرمز التالي كما هو:</div>
            <div class="opi-code" aria-label="رمز التأكيد">${code}</div>
            <input data-f="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="اكتب الرمز هنا" style="text-align:center;letter-spacing:.2em;font-weight:900;direction:ltr">
            <button type="button" class="opi-new" data-act="go" disabled style="background:linear-gradient(135deg,#dc2626,#9f1239)">حذف الذمة وكل سجلاتها</button>`, 'opi-danger-box');
        const inp = box.querySelector('[data-f="code"]'), go = box.querySelector('[data-act="go"]');
        inp.addEventListener('input', () => { go.disabled = inp.value.trim().toUpperCase() !== code; });
        inp.focus();
        go.addEventListener('click', async () => {
            if (inp.value.trim().toUpperCase() !== code) return;
            go.disabled = true;
            try { const r = await api('POST', '/api/opioids/delete', { id: d.id, confirm: true }); toast(`حُذفت الذمة و${fmt(r.deleted ? r.deleted.moves : 0)} سجلاً ✓`, 'success'); done(); }
            catch (err) { go.disabled = false; toast(errText(err), 'error'); }
        });
    }
    /** Every holder of every duty of the hospital, with their period and their records (by name or by date). */
    async function historyView(host, hosp, done) {
        host.innerHTML = '<div class="opi"><div class="opi-empty">جاري تحميل السجل الكامل…</div></div>';
        let data;
        const load = () => api('GET', `/api/opioids/history?h=${encodeURIComponent(hosp)}`);
        try { data = await load(); }
        catch (e) { host.innerHTML = `<div class="opi"><div class="opi-top"><button type="button" class="opi-btn" data-act="back">→ رجوع</button></div><div class="opi-empty">${esc(errText(e))}</div></div>`; host.querySelector('[data-act="back"]').addEventListener('click', done); return; }
        let sort = 'name', place = '';
        const open = new Set();
        const dutyOf = id => { const x = data.duties.find(y => y.id === id); return x ? { ...x, hosp } : { id, hosp, place: '', wards: [] }; };
        const paint = () => {
            const ts = data.tenures.filter(t => !place || String(t.duty) === place)
                .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ar') || a.from - b.from : b.from - a.from);
            const period = t => `${new Date(t.from).toLocaleDateString('en-GB')} ← ${t.to ? new Date(t.to).toLocaleDateString('en-GB') : 'حتى الآن'}`;
            host.innerHTML = `<div class="opi">
                <div class="opi-top"><button type="button" class="opi-btn" data-act="back">→ رجوع</button><b>🕘 السجل الكامل · ${esc(hospName(hosp))}</b></div>
                <div class="opi-top"><div class="opi-seg"><button type="button" data-sort="name" class="${sort === 'name' ? 'on' : ''}">حسب اسم المسؤول</button><button type="button" data-sort="date" class="${sort === 'date' ? 'on' : ''}">حسب التاريخ</button></div>
                    ${data.duties.length > 1 ? `<select data-role="place" aria-label="الذمة"><option value="">كل الذمم</option>${data.duties.map(x => `<option value="${x.id}" ${String(x.id) === place ? 'selected' : ''}>${esc(x.place)}</option>`).join('')}</select>` : ''}
                    <span class="opi-sub">${ts.length} ${ts.length === 1 ? 'فترة' : 'فترات'} · ${ts.reduce((n, t) => n + t.moves.length, 0)} سجل</span></div>
                ${ts.length ? ts.map(t => {
                    const uses = t.moves.filter(m => m.kind === 'use' && !m.voided);
                    return `<div class="opi-hist-t ${t.to ? '' : 'cur'}" data-t="${t.id}">
                        <h4><span>👤 ${esc(t.name)} ${t.to ? '' : '<span class="opi-chip active">الحالي</span>'}</span><button type="button" class="opi-btn" data-open="${t.id}">${open.has(t.id) ? 'إخفاء' : 'عرض السجلات'}</button></h4>
                        <div class="opi-sub">📍 ${esc(t.place)} · 📅 ${esc(period(t))}</div>
                        <div class="opi-sub">${uses.length} استخدام (${uses.reduce((n, m) => n + m.qty, 0)} أمبولة) · ${t.moves.length} سجل</div>
                        ${open.has(t.id) ? `${logTable([...t.moves].reverse(), { canEdit: () => true })}<button type="button" class="opi-btn" data-print="${t.id}" style="margin-top:8px">🖨️ طباعة سجل هذه الفترة</button>` : ''}
                    </div>`;
                }).join('') : '<div class="opi-empty">لا توجد فترات بعد (لم تُؤكَّد أي ذمة).</div>'}
            </div>`;
            host.querySelector('[data-act="back"]').addEventListener('click', done);
            host.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { sort = b.dataset.sort; paint(); }));
            const ps = host.querySelector('[data-role="place"]');
            if (ps) ps.addEventListener('change', () => { place = ps.value; paint(); });
            host.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const id = Number(b.dataset.open); if (open.has(id)) open.delete(id); else open.add(id); paint(); }));
            host.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => {
                const t = data.tenures.find(x => x.id === Number(b.dataset.print));
                printLog({ ...dutyOf(t.duty), items: [] }, t.moves.filter(m => !m.voided), '', `${t.name} (${period(t)})`);
            }));
            const all = data.tenures.flatMap(t => t.moves);
            bindRowActions(host, all, m => dutyOf(m.duty), async () => { data = await load(); paint(); });
        };
        paint();
    }

    // ------------------------------------------------------------------
    // Printing the log (A4, through a hidden frame: stays inside the app)
    // ------------------------------------------------------------------
    function monthsOf(moves) { return [...new Set(moves.map(m => (m.date || new Date(m.at).toISOString().slice(0, 10)).slice(0, 7)))].sort().reverse(); }
    const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const monthText = ym => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
    /** The print options (a period), at the top of the tab, then the A4 page. */
    function printChooser(host, duty, moves, holderName) {
        const old = host.querySelector('.opi-editbox');
        if (old) old.remove();
        const months = monthsOf(moves);
        const box = document.createElement('div');
        box.className = 'opi-editbox opi-form';
        box.innerHTML = `<div class="opi-top" style="margin:0"><b>🖨️ طباعة سجل ${esc(duty.place)}</b><button type="button" class="opi-btn" data-act="x">✕</button></div>
            <label>الفترة<select data-f="period"><option value="">كل السجلات</option>${months.map(m => `<option value="${m}">${monthText(m)}</option>`).join('')}</select></label>
            <label class="opi-chk"><input type="checkbox" data-f="deleted"> إظهار السجلات المحذوفة (مشطوبة)</label>
            <button type="button" class="opi-new" data-act="print">طباعة (A4)</button>`;
        (host.querySelector('.opi') || host).prepend(box);
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        box.querySelector('[data-act="x"]').addEventListener('click', () => box.remove());
        box.querySelector('[data-act="print"]').addEventListener('click', () => {
            const ym = box.querySelector('[data-f="period"]').value;
            const withDeleted = box.querySelector('[data-f="deleted"]').checked;
            printLog(duty, moves.filter(m => (!ym || (m.date || new Date(m.at).toISOString().slice(0, 10)).startsWith(ym)) && (withDeleted || !m.voided)), ym, holderName);
            box.remove();
        });
    }
    function printLog(duty, moves, ym, holderName) {
        const hosp = hospName(duty.hosp);
        const rows = [...moves].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.at - b.at);
        const items = {};
        rows.filter(m => !m.voided).forEach(m => {
            const it = items[m.itemName] || (items[m.itemName] = { recv: 0, used: 0, out: 0 });
            if (m.kind === 'issue' || m.kind === 'handover') it.recv += m.qty; else if (m.kind === 'use') it.used += m.qty; else if (m.kind === 'withdraw') it.out += m.qty;
        });
        const left = Object.fromEntries((duty.items || []).map(i => [i.name, i.left]));
        const printedBy = (Hub.auth.getAccount() || {}).name || '';
        const now = new Date().toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Baghdad' });
        const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل ذمة المخدرات · ${esc(duty.place)}</title>
            <style>
            @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif; color: #111; font-size: 10.5pt; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5pt solid #4c1d95; padding-bottom: 6pt; margin-bottom: 8pt; }
            header h1 { margin: 0; font-size: 16pt; color: #4c1d95; }
            header .sub { font-size: 9.5pt; color: #444; margin-top: 2pt; }
            header .ref { text-align: left; font-size: 8.5pt; color: #555; line-height: 1.5; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4pt 10pt; border: 0.8pt solid #c4b5fd; background: #f5f3ff; border-radius: 4pt; padding: 6pt 8pt; margin-bottom: 8pt; font-size: 9.5pt; }
            .meta b { display: block; font-size: 8pt; color: #5b21b6; font-weight: 700; }
            h2 { font-size: 11pt; margin: 10pt 0 4pt; color: #4c1d95; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 0.6pt solid #999; padding: 3.5pt 4pt; text-align: center; vertical-align: middle; }
            th { background: #ede9fe; font-size: 9pt; }
            td { font-size: 8.6pt; }
            td.l { text-align: right; }
            tr { page-break-inside: avoid; }
            thead { display: table-header-group; }
            tr.void td { text-decoration: line-through; color: #888; }
            .k-issue { color: #15803d; font-weight: 700; } .k-withdraw { color: #b45309; font-weight: 700; } .k-handover { color: #1d4ed8; font-weight: 700; }
            .sum td:first-child { text-align: right; font-weight: 700; }
            .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18pt; margin-top: 26pt; page-break-inside: avoid; }
            .sign div { border-top: 0.8pt solid #333; padding-top: 4pt; text-align: center; font-size: 9.5pt; }
            .sign small { display: block; color: #555; font-size: 8pt; margin-top: 2pt; }
            footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 7.5pt; color: #666; display: flex; justify-content: space-between; border-top: 0.5pt solid #ccc; padding-top: 2pt; background: #fff; }
            body { padding-bottom: 8mm; }
            .empty { text-align: center; padding: 18pt; color: #666; border: 0.6pt dashed #999; }
            </style></head><body>
            <header><div><h1>سجل ذمة المخدرات</h1><div class="sub">${esc(hosp)}</div></div>
                <div class="ref">الفترة: ${ym ? esc(monthText(ym)) : 'كل السجلات'}<br>تاريخ الطباعة: ${esc(now)}<br>طبعه: ${esc(printedBy)}</div></header>
            <div class="meta">
                <div><b>المكان</b>${esc(duty.place)}</div>
                <div><b>الردهات</b>${esc((duty.wards || []).join('، '))}</div>
                <div><b>المقيم المسؤول</b>${esc(holderName || '')}</div>
                <div><b>عدد السجلات</b>${rows.filter(m => !m.voided).length}</div>
            </div>
            <h2>ملخص المواد</h2>
            <table class="sum"><thead><tr><th>المادة</th><th>المستلَم</th><th>المستخدَم</th><th>المسحوب</th><th>المتبقي حالياً</th></tr></thead><tbody>
                ${Object.keys(items).length ? Object.entries(items).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${v.recv}</td><td>${v.used}</td><td>${v.out}</td><td>${left[n] != null ? left[n] : '—'}</td></tr>`).join('') : '<tr><td colspan="5">—</td></tr>'}
            </tbody></table>
            <h2>السجل التفصيلي</h2>
            ${rows.length ? `<table><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>المادة</th><th>العدد</th><th>اسم المريض</th><th>الرقم الإحصائي</th><th>التشخيص</th><th>الجنس</th><th>العمر</th><th>الردهة</th><th>سجّله</th></tr></thead><tbody>
                ${rows.map((m, i) => `<tr class="${m.voided ? 'void' : ''}"><td>${i + 1}</td><td>${m.date ? dateText(m.date) : new Date(m.at).toLocaleDateString('en-GB')}</td>
                    <td class="k-${m.kind}">${KIND[m.kind][1]}</td><td>${esc(m.itemName)}</td><td>${m.kind === 'use' || m.kind === 'withdraw' ? '−' : '+'}${m.qty}</td>
                    <td class="l">${esc(m.patient)}</td><td>${esc(m.patientNo)}</td><td class="l">${esc(m.diagnosis)}</td><td>${SEX[m.sex] || ''}</td><td>${m.kind === 'use' && m.age != null ? m.age : ''}</td><td>${esc(m.ward)}</td><td>${esc(m.by)}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">لا توجد سجلات في هذه الفترة.</div>'}
            <div class="sign"><div>المقيم المسؤول<small>${esc(holderName || '')}</small></div><div>مسؤول الصيدلية<small>&nbsp;</small></div><div>مدير المستشفى / المسؤول الإداري<small>&nbsp;</small></div></div>
            <footer><span>بوابة المستشفيات · ذمة المخدرات · ${esc(duty.place)}</span><span>${esc(hosp)}</span></footer>
            </body></html>`;
        const f = document.createElement('iframe');
        f.setAttribute('aria-hidden', 'true');
        f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0;opacity:0';
        document.body.appendChild(f);
        f.contentDocument.open();
        f.contentDocument.write(html);
        f.contentDocument.close();
        setTimeout(() => {
            try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('تعذرت الطباعة على هذا الجهاز.', 'error'); }
            setTimeout(() => f.remove(), 60000);
        }, 300);
    }

    // ------------------------------------------------------------------
    // The owner / admins: every duty of their hospitals
    // ------------------------------------------------------------------
    async function manager(host) {
        host.innerHTML = '<div class="opi"><div class="opi-empty">جاري التحميل…</div></div>';
        let data;
        try { data = await api('GET', '/api/opioids'); }
        catch (e) { host.innerHTML = `<div class="opi-empty">${esc(errText(e))}</div>`; return; }
        const scope = data.scope.includes('*') ? (Hub.getHospitals ? Hub.getHospitals().map(h => h.id) : []) : data.scope;
        let hosp = host._opiHosp && (data.scope.includes('*') || scope.includes(host._opiHosp)) ? host._opiHosp : (scope[0] || '');
        const openLogs = host._opiLogs || (host._opiLogs = new Set());
        const movesOf = {};
        const paint = () => {
            host._opiHosp = hosp;
            const duties = data.duties.filter(d => !hosp || d.hosp === hosp);
            host.innerHTML = `<div class="opi">
                <div class="opi-top">
                    ${scope.length > 1 ? `<select data-role="hosp" aria-label="المستشفى">${scope.map(h => `<option value="${esc(h)}" ${h === hosp ? 'selected' : ''}>${esc(hospName(h))}</option>`).join('')}</select>` : `<b style="font-size:.85rem">${esc(hospName(hosp))}</b>`}
                    <button type="button" class="opi-new" data-act="new">＋ ذمة جديدة</button>
                </div>
                <button type="button" class="opi-histbtn" data-act="history"><span>🕘</span><div><b>السجل الكامل</b><small>كل المسؤولين السابقين والحاليين لكل ذمم ${esc(hospName(hosp))}، بفترات تغطيتهم وسجلاتهم</small></div><i class="fas fa-chevron-left"></i></button>
                ${duties.length ? duties.map(d => card(d)).join('') : '<div class="opi-empty">💊<br>لا توجد ذمم مخدرات في هذا المستشفى بعد.<br>أنشئ أول ذمة: المكان، الردهات، المقيم المسؤول، والمواد.</div>'}
            </div>`;
            const sel = host.querySelector('[data-role="hosp"]');
            if (sel) sel.addEventListener('change', () => { hosp = sel.value; paint(); });
            host.querySelector('[data-act="new"]').addEventListener('click', () => editor(host, { hosp }, () => manager(host)));
            host.querySelector('[data-act="history"]').addEventListener('click', () => historyView(host, hosp, () => manager(host)));
            host.querySelectorAll('.opi-card').forEach(el => {
                const d = data.duties.find(x => x.id === Number(el.dataset.duty));
                const moves = movesOf[d.id] || [];
                el.querySelector('[data-act="edit"]').addEventListener('click', () => editor(host, d, () => manager(host)));
                el.querySelector('[data-act="delete"]').addEventListener('click', () => deleteBox(host, d, () => manager(host)));
                const ho = el.querySelector('[data-act="handoff"]');
                if (ho) ho.addEventListener('click', () => handoffBox(host, d, () => manager(host)));
                const conf = el.querySelector('[data-act="confirm"]');
                if (conf) conf.addEventListener('click', async () => {
                    conf.disabled = true;
                    try {
                        const r = await api('POST', '/api/opioids/confirm', { id: d.id });
                        toast(r.notified ? `تم التأكيد وإشعار ${d.next.name} ✓` : `تم التأكيد. ${d.next.name} لا يملك حساباً بعد، فلن يصله إشعار حتى ينشئ حسابه.`, r.notified ? 'success' : 'info');
                        manager(host);
                    } catch (e) { conf.disabled = false; toast(errText(e), 'error'); }
                });
                el.querySelector('[data-act="log"]').addEventListener('click', () => { if (openLogs.has(d.id)) openLogs.delete(d.id); else openLogs.add(d.id); paint(); });
                el.querySelectorAll('[data-stock]').forEach(b => b.addEventListener('click', async () => {
                    const itemId = Number(b.closest('[data-item]').dataset.item);
                    const it = d.items.find(i => i.id === itemId);
                    const withdraw = b.dataset.stock === 'withdraw';
                    const n = Number(prompt(`${withdraw ? 'سحب' : 'تعويض'} «${it.name}»: كم أمبولة؟ (المتبقي ${it.left})`, withdraw ? '' : '5'));
                    if (!n || n < 1) return;
                    const note = withdraw ? (prompt('سبب السحب (اختياري):') || '') : '';
                    try { const r = await api('POST', '/api/opioids/stock', { item: itemId, qty: n, kind: withdraw ? 'withdraw' : 'issue', note }); toast(`${withdraw ? 'سُحب' : 'أُضيف'} ✓ · المتبقي ${r.left}`, 'success'); manager(host); }
                    catch (e) { toast(errText(e), 'error'); }
                }));
                bindRowActions(el, moves, () => d, () => manager(host));
                el.querySelector('[data-act="print"]').addEventListener('click', () => printChooser(host, d, moves, d.holder ? d.holder.name : (d.next ? d.next.name : '')));
            });
        };
        const card = d => {
            const status = d.status === 'draft' ? ['draft', 'مسودة · لم تُؤكد'] : d.pending ? ['pending', 'بانتظار تأكيد المسؤول الجديد'] : ['active', 'فعّالة'];
            const moves = data.moves.filter(m => m.duty === d.id);
            movesOf[d.id] = moves;
            return `<div class="opi-card" data-duty="${d.id}">
                <div class="opi-head"><div><h3>📍 ${esc(d.place)}</h3><div class="opi-sub">${data.owner || data.scope.length > 1 ? esc(hospName(d.hosp)) + ' · ' : ''}آخر تحديث ${esc(timeText(d.updated))}</div></div>
                    <span class="opi-chip ${status[0]}">${status[1]}</span></div>
                <div class="opi-wards">${d.wards.map(w => `<span>🛏️ ${esc(w)}</span>`).join('')}</div>
                <div class="opi-holder">👤 ${d.holder ? `المسؤول: ${esc(d.holder.name)} <span class="opi-sub">منذ ${esc(timeText(d.holder.since))}</span>` : 'لا يوجد مسؤول مؤكد بعد'}
                    ${d.pending && d.next && (!d.holder || d.holder.key !== d.next.key) ? `<span class="next">← ${esc(d.next.name)} (بانتظار التأكيد)</span>` : ''}</div>
                ${(d.next && d.next.account === false) || (!d.next && d.holder && d.holder.account === false) ? `<div class="opi-warn">⚠️ ${esc((d.next || d.holder).name)} لا يملك حساباً فعّالاً في الموقع: لن يصله الإشعار ولن يرى الذمة في حسابه حتى ينشئ حساباً وتتم الموافقة عليه.</div>` : ''}
                ${itemsHtml(d.items, d.status === 'active')}
                ${d.pending ? `<button type="button" class="opi-confirm" data-act="confirm">✅ تأكيد ${d.status === 'draft' ? 'الذمة' : 'التغيير'} وإشعار ${esc(d.next ? d.next.name : 'المقيم')}</button>` : ''}
                <div class="opi-acts">
                    ${d.status === 'active' ? '<button type="button" class="opi-btn primary" data-act="handoff">🤝 تسليم لمقيم آخر</button>' : ''}
                    <button type="button" class="opi-btn" data-act="edit">✏️ تعديل</button>
                    <button type="button" class="opi-btn" data-act="log">📋 السجل (${moves.length})</button>
                    <button type="button" class="opi-btn" data-act="print">🖨️ طباعة</button>
                    <button type="button" class="opi-btn danger" data-act="delete">🗑️ حذف</button>
                </div>
                ${openLogs.has(d.id) ? logTable(moves, { showHolder: true, canEdit: () => true }) : ''}
            </div>`;
        };
        paint();
    }

    /** Create / edit form (inside the same tab; "رجوع" returns to the list). */
    function editor(host, duty, done) {
        const isNew = !duty.id;
        const st = {
            place: duty.place || '', wards: [...(duty.wards || [])],
            holder: duty.next ? { ...duty.next } : duty.holder ? { res: duty.holder.res, name: duty.holder.name, key: duty.holder.key } : null,
            items: (duty.items || []).map(i => ({ id: i.id, name: i.name, low: i.low, left: i.left })),
        };
        if (!st.items.length) st.items.push({ name: '', qty: '', low: 2 });
        const draft = isNew || duty.status === 'draft';
        const paint = () => {
            host.innerHTML = `<div class="opi"><div class="opi-top"><button type="button" class="opi-btn" data-act="back">→ رجوع</button><b>${isNew ? 'ذمة مخدرات جديدة' : 'تعديل الذمة'} · ${esc(hospName(duty.hosp))}</b></div>
                <div class="opi-form">
                    <label>المكان<input data-f="place" maxlength="60" placeholder="مثال: الطابق الرابع" value="${esc(st.place)}"></label>
                    <label>الردهات التي تغطيها
                        <div class="opi-row"><input data-f="ward" maxlength="40" placeholder="اسم الردهة ثم «إضافة»"><button type="button" class="opi-btn primary" data-act="add-ward">إضافة</button></div>
                        <div class="opi-tags">${st.wards.map((w, i) => `<span>${esc(w)} <button type="button" data-del-ward="${i}" aria-label="حذف">✕</button></span>`).join('')}</div>
                    </label>
                    <label>المقيم المسؤول
                        <div class="opi-sugg"><input data-f="holder" autocomplete="off" placeholder="اكتب الاسم واختر من القائمة" value="${esc(st.holder ? st.holder.name : '')}"><div class="opi-sugg-list" hidden></div></div>
                        <small class="opi-sub ${st.holder && st.holder.account === false ? 'opi-warn' : ''}">${st.holder ? (st.holder.account === false ? `⚠️ ${esc(st.holder.name)} لا يملك حساباً فعّالاً في الموقع: لن يصله الإشعار ولن يرى الذمة حتى ينشئ حساباً.` : '✓ ' + esc(st.holder.name)) : 'كل مقيمي المستشفى عدا الروتيترية.'}</small>
                    </label>
                    <div><div class="opi-h4" style="margin-top:0">المواد المخدرة</div>
                        ${st.items.map((it, i) => `<div class="opi-it-row" data-i="${i}" style="margin-bottom:6px">
                            <label>اسم المادة<input data-it="name" maxlength="60" placeholder="مثال: Pethidine 100mg" value="${esc(it.name)}"></label>
                            ${it.id && !draft ? `<label>المتبقي<input value="${fmt(it.left)}" disabled></label>` : `<label>الأمبولات<input data-it="qty" type="number" min="1" max="500" inputmode="numeric" value="${esc(it.qty || '')}"></label>`}
                            <label><small>تنبيه عند</small><input data-it="low" type="number" min="0" max="100" inputmode="numeric" value="${esc(it.low != null ? it.low : 2)}"></label>
                            <button type="button" class="opi-x" data-del-item="${i}" aria-label="حذف المادة">✕</button>
                        </div>`).join('')}
                        <button type="button" class="opi-btn" data-act="add-item">＋ مادة أخرى</button>
                        ${!draft ? '<div class="opi-sub" style="margin-top:6px">عدد المواد الحالية يتغير من «تعويض» و«سحب» في بطاقة الذمة.</div>' : ''}
                    </div>
                    <button type="button" class="opi-new" data-act="save">${isNew ? 'إنشاء الذمة' : 'حفظ التعديلات'}</button>
                    <div class="opi-sub">${isNew ? 'بعد الإنشاء اضغط «تأكيد وإشعار» ليصل الإشعار إلى المقيم وتظهر الذمة في حسابه.' : 'إذا غيّرت المقيم المسؤول تُسلَّم الذمة له فور الحفظ ويصله إشعار، ويستلم ما تبقى.'}</div>
                </div></div>`;
            const $ = s => host.querySelector(s);
            $('[data-act="back"]').addEventListener('click', done);
            $('[data-f="place"]').addEventListener('input', e => { st.place = e.target.value; });
            const addWard = () => { const v = $('[data-f="ward"]').value.trim(); if (v && !st.wards.includes(v)) st.wards.push(v); paint(); host.querySelector('[data-f="ward"]').focus(); };
            $('[data-act="add-ward"]').addEventListener('click', addWard);
            $('[data-f="ward"]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addWard(); } });
            host.querySelectorAll('[data-del-ward]').forEach(b => b.addEventListener('click', () => { st.wards.splice(Number(b.dataset.delWard), 1); paint(); }));
            host.querySelectorAll('.opi-it-row').forEach(row => {
                const it = st.items[Number(row.dataset.i)];
                row.querySelectorAll('[data-it]').forEach(inp => inp.addEventListener('input', () => { it[inp.dataset.it] = inp.value; }));
            });
            host.querySelectorAll('[data-del-item]').forEach(b => b.addEventListener('click', () => { st.items.splice(Number(b.dataset.delItem), 1); if (!st.items.length) st.items.push({ name: '', qty: '', low: 2 }); paint(); }));
            $('[data-act="add-item"]').addEventListener('click', () => { st.items.push({ name: '', qty: '', low: 2 }); paint(); });
            // The holder: suggestions as the admin types (the hospital's residents, not rotators).
            const inp = $('[data-f="holder"]'), list = $('.opi-sugg-list');
            let timer = null, found = [], idx = -1;
            const show = () => {
                list.hidden = !found.length;
                list.innerHTML = found.map((r, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-r="${i}">${esc(r.name)}${r.account ? '' : ' <small class="opi-noacc">لا يملك حساباً</small>'}</button>`).join('');
                list.querySelectorAll('[data-r]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); choose(found[Number(b.dataset.r)]); }));
            };
            const note = () => {
                const el = host.querySelector('.opi-sugg + small');
                el.className = 'opi-sub' + (st.holder && st.holder.account === false ? ' opi-warn' : '');
                el.textContent = !st.holder ? 'اختر الاسم من القائمة.' : st.holder.account === false
                    ? `⚠️ ${st.holder.name} لا يملك حساباً فعّالاً في الموقع: لن يصله الإشعار ولن يرى الذمة حتى ينشئ حساباً.` : '✓ ' + st.holder.name + ' (لديه حساب فعّال)';
            };
            const choose = r => { st.holder = r; inp.value = r.name; list.hidden = true; note(); };
            inp.addEventListener('input', () => {
                st.holder = null;
                host.querySelector('.opi-sugg + small').textContent = 'اختر الاسم من القائمة.';
                clearTimeout(timer);
                const q = inp.value.trim();
                timer = setTimeout(async () => {
                    try { found = (await api('GET', `/api/opioids/residents?h=${encodeURIComponent(duty.hosp)}&q=${encodeURIComponent(q)}`)).residents || []; idx = -1; show(); } catch (e) { /* offline */ }
                }, 200);
            });
            inp.addEventListener('focus', () => inp.dispatchEvent(new Event('input')));
            inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
            inp.addEventListener('keydown', e => {
                if (list.hidden) return;
                if (e.key === 'ArrowDown') { idx = Math.min(found.length - 1, idx + 1); show(); e.preventDefault(); }
                else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); show(); e.preventDefault(); }
                else if (e.key === 'Enter' && found[Math.max(0, idx)]) { e.preventDefault(); choose(found[Math.max(0, idx)]); }
            });
            $('[data-act="save"]').addEventListener('click', async e => {
                const btn = e.currentTarget;
                if (!st.holder) { toast('اختر المقيم المسؤول من القائمة.', 'error'); inp.focus(); return; }
                if (st.holder.account === false && !confirm(`${st.holder.name} لا يملك حساباً فعّالاً في الموقع، فلن يصله الإشعار ولن يرى الذمة حتى ينشئ حساباً. المتابعة؟`)) return;
                btn.disabled = true;
                try {
                    const res = await api('POST', '/api/opioids/duty', {
                        id: duty.id || undefined, hosp: duty.hosp, place: st.place, wards: st.wards, holder: { res: st.holder.res, name: st.holder.name },
                        items: st.items.filter(i => String(i.name || '').trim()).map(i => ({ id: i.id, name: i.name, qty: Number(i.qty) || 0, low: Number(i.low) })),
                    });
                    const ap = res && res.applied;
                    toast(isNew ? 'أُنشئت الذمة. اضغط «تأكيد وإشعار» لإسنادها.' : ap && ap.changed
                        ? (ap.notified ? `حُفظت التعديلات ✓ · سُلّمت الذمة إلى ${st.holder.name} وأُبلغ.` : `حُفظت التعديلات ✓ · سُلّمت الذمة إلى ${st.holder.name} (لا يملك حساباً، فلن يصله إشعار).`)
                        : 'حُفظت التعديلات ✓', ap && ap.changed && !ap.notified ? 'info' : 'success');
                    done();
                } catch (err) { btn.disabled = false; toast(errText(err), 'error'); }
            });
        };
        paint();
        host.scrollIntoView && host.closest('[data-role="body"]') && (host.closest('[data-role="body"]').scrollTop = 0);
    }

    // ------------------------------------------------------------------
    // The holder: their tab
    // ------------------------------------------------------------------
    async function mine(host) {
        host.innerHTML = '<div class="opi"><div class="opi-empty">جاري التحميل…</div></div>';
        let data;
        try { data = await api('GET', '/api/opioids/mine'); }
        catch (e) { host.innerHTML = `<div class="opi-empty">${esc(errText(e))}</div>`; return; }
        if (!data.duties.length) { host.innerHTML = '<div class="opi"><div class="opi-empty">💊<br>لا توجد ذمة مخدرات باسمك.</div></div>'; return; }
        const holding = data.duties.filter(d => d.holding);
        const past = data.duties.filter(d => !d.holding);
        let sel = host._opiSel && data.duties.some(d => d.id === host._opiSel) ? host._opiSel : (holding[0] || data.duties[0]).id;
        const paint = () => {
            host._opiSel = sel;
            const d = data.duties.find(x => x.id === sel);
            const myTenures = new Set(d.tenures.map(t => t.id));
            const moves = data.moves.filter(m => m.duty === d.id && myTenures.has(m.tenure));
            const uses = moves.filter(m => m.kind === 'use' && !m.voided);
            const month = (data.today || today()).slice(0, 7);
            const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
            const byWard = {};
            uses.forEach(m => { byWard[m.ward] = (byWard[m.ward] || 0) + m.qty; });
            const topWard = Math.max(1, ...Object.values(byWard));
            const alerts = d.items.filter(i => level(i.left, i.low) !== 'ok');
            host.innerHTML = `<div class="opi">
                ${data.duties.length > 1 ? `<div class="opi-top"><div class="opi-seg">${data.duties.map(x => `<button type="button" data-sel="${x.id}" class="${x.id === sel ? 'on' : ''}">${esc(x.place)}${x.holding ? '' : ' (سابقة)'}</button>`).join('')}</div></div>` : ''}
                <div class="opi-mine-head"><h3>💊 ذمة المخدرات · ${esc(d.place)}</h3>
                    <div class="opi-sub" style="opacity:.85">${esc(hospName(d.hosp))}${d.holding ? ' · أنت المسؤول الآن' : ' · ذمة سابقة (سجلاتك فقط)'}</div>
                    <div class="opi-wards">${d.wards.map(w => `<span>🛏️ ${esc(w)}</span>`).join('')}</div></div>
                ${d.holding ? `
                    ${alerts.map(i => `<div class="opi-alert ${level(i.left, i.low)}">${i.left <= 0 ? '⛔' : '⚠️'} ${esc(i.name)}: ${i.left <= 0 ? 'نفد تماماً، اطلب التعويض من الإدارة.' : `بقي ${fmt(i.left)} فقط.`}</div>`).join('')}
                    <div class="opi-counters">${d.items.map(i => `<div class="opi-counter ${level(i.left, i.low)}"><span>💊 ${esc(i.name)}</span><b>${fmt(i.left)}</b><small>أمبولة متبقية${i.low ? ` · التنبيه عند ${i.low}` : ''}</small>
                        <button type="button" class="opi-btn opi-refill" data-refill="${i.id}">＋ تعويض</button></div>`).join('')}</div>
                    <button type="button" class="opi-new" data-act="log" style="width:100%;margin-bottom:12px">💉 تسجيل استخدام أمبولة</button>` : ''}
                <div class="opi-stats">
                    <div class="opi-stat"><b>${fmt(uses.filter(m => m.date >= weekAgo).reduce((n, m) => n + m.qty, 0))}</b><small>آخر 7 أيام</small></div>
                    <div class="opi-stat"><b>${fmt(uses.filter(m => (m.date || '').startsWith(month)).reduce((n, m) => n + m.qty, 0))}</b><small>هذا الشهر</small></div>
                    <div class="opi-stat"><b>${fmt(uses.reduce((n, m) => n + m.qty, 0))}</b><small>كل استخداماتك</small></div>
                </div>
                ${Object.keys(byWard).length ? `<div class="opi-h4">حسب الردهة</div><div class="opi-wardbars">${Object.entries(byWard).sort((a, b) => b[1] - a[1]).map(([w, n]) => `<div class="opi-wardbar"><span>${esc(w)}</span><div><i style="width:${Math.round(n / topWard * 100)}%"></i></div><b>${n}</b></div>`).join('')}</div>` : ''}
                <div class="opi-top" style="margin:14px 0 8px"><b class="opi-h4" style="margin:0">سجل الاستخدام (${fmt(moves.length)})</b><button type="button" class="opi-btn" data-act="print">🖨️ طباعة السجل</button></div>
                ${logTable(moves, { canEdit: () => true })}
                ${past.length && d.holding ? `<div class="opi-sub" style="margin-top:10px">لك ذمم سابقة: اخترها من الأعلى لعرض سجلاتك فيها.</div>` : ''}
            </div>`;
            host.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => { sel = Number(b.dataset.sel); paint(); }));
            const logBtn = host.querySelector('[data-act="log"]');
            if (logBtn) logBtn.addEventListener('click', () => useForm([{ id: d.id, place: d.place, wards: d.wards, items: d.items }], () => mine(host), host));
            bindRowActions(host, moves, () => d, () => mine(host));
            host.querySelector('[data-act="print"]').addEventListener('click', () => printChooser(host, d, moves, (Hub.auth.getAccount() || {}).name || ''));
            host.querySelectorAll('[data-refill]').forEach(b => b.addEventListener('click', async () => {
                const it = d.items.find(i => i.id === Number(b.dataset.refill));
                const n = Number(prompt(`تعويض «${it.name}»: كم أمبولة استلمت؟ (المتبقي ${it.left})`, ''));
                if (!n || n < 1) return;
                try { const r = await api('POST', '/api/opioids/stock', { item: it.id, qty: n, kind: 'issue', note: 'تعويض من المسؤول' }); toast(`أُضيف ✓ · المتبقي ${r.left}. أُبلغت الإدارة.`, 'success'); mine(host); }
                catch (e) { toast(errText(e), 'error'); }
            }));
        };
        paint();
    }

    // ------------------------------------------------------------------
    // Recording a use (a pop-up: the duty roster's button, or the holder's tab)
    // ------------------------------------------------------------------
    function useForm(duties, after, host) {
        if (!duties.length) return;
        const who = (Hub.auth.getAccount() || {}).name || '';
        // The duty roster's form shows no counts (the recorder picks the opioid; one that ran out is greyed
        // out); the holder's tab shows them.
        const counts = !!host;
        const isOut = i => i.out === true || (Number.isFinite(i.left) && i.left <= 0);
        const maxQty = it => counts && Number.isFinite(it.left) ? Math.min(10, it.left) : 10;
        let root, close;
        const shell = `<div class="opu">
            <div class="opu-hero"><span class="opu-ic">💉</span><div><h2>تسجيل استخدام مادة مخدرة</h2>
                <div class="opu-who"><i class="fas fa-user-pen"></i> يُسجَّل باسمك تلقائياً: <b>${esc(who)}</b></div></div>
                ${host ? '<button type="button" class="opu-x" data-act="back" aria-label="رجوع">→</button>' : '<button type="button" class="opu-x" data-act="close" aria-label="إغلاق">✕</button>'}</div>
            <div class="opu-steps"><span data-step="1">المادة</span><span data-step="2">المريض</span><span data-step="3">الاستخدام</span></div>
            <div class="opu-body" data-role="form"></div>
            <div class="opu-foot"><div class="opu-sum" data-role="sum">اختر المادة للبدء</div><button type="button" class="opu-go" data-act="submit" disabled>تسجيل</button></div>
        </div>`;
        if (host) {
            host.innerHTML = shell;
            root = host.querySelector('.opu');
            close = () => { if (after) after(); };
            root.querySelector('[data-act="back"]').addEventListener('click', close);
        } else {
            const sheet = A.openSheet(shell, { label: 'تسجيل استخدام مادة مخدرة', tall: true });
            sheet.classList.add('opu-sheet');
            root = sheet.querySelector('.opu');
            close = () => { A.closeSheet(); if (after) after(); };
            root.querySelector('[data-act="close"]').addEventListener('click', A.closeSheet);
        }
        const form = root.querySelector('[data-role="form"]');
        // Nothing is chosen for the recorder: every field is theirs to fill.
        const st = { duty: duties.length === 1 ? duties[0].id : null, item: null, qty: '', patient: '', patientNo: '', diagnosis: '', sex: '', age: '', ward: '', date: '' };
        const duty = () => duties.find(x => x.id === st.duty) || null;
        const item = () => (duty() ? duty().items.find(i => i.id === st.item) : null) || null;
        const valid = {
            1: () => !!duty() && !!item() && !isOut(item()) && Number(st.qty) >= 1 && Number(st.qty) <= maxQty(item()),
            2: () => threeNames(st.patient) && !!st.diagnosis.trim() && !!st.sex && st.age !== '' && Number(st.age) >= 0 && Number(st.age) <= 120,
            3: () => !!st.ward && !!st.date && st.date <= today(),
        };
        const refresh = () => {
            root.querySelectorAll('[data-step]').forEach(s => s.classList.toggle('done', valid[s.dataset.step]()));
            const it = item();
            const ok = valid[1]() && valid[2]() && valid[3]();
            root.querySelector('[data-act="submit"]').disabled = !ok;
            const missing = !valid[1]() ? 'اختر المادة والعدد' : !valid[2]() ? 'أكمل بيانات المريض (الاسم الثلاثي، التشخيص، الجنس، العمر)' : !valid[3]() ? 'اختر الردهة وتاريخ الاستخدام' : '';
            root.querySelector('[data-role="sum"]').innerHTML = ok
                ? `<b>${esc(it.name)} × ${Number(st.qty)}</b>${counts ? ` · سيتبقى <b class="${level(it.left - Number(st.qty), it.low || 0)}">${fmt(it.left - Number(st.qty))}</b>` : ''}`
                : esc(missing);
            const nameOk = form.querySelector('.opu-namecheck');
            if (nameOk) { nameOk.className = 'opu-namecheck ' + (threeNames(st.patient) ? 'ok' : st.patient ? 'bad' : ''); nameOk.textContent = threeNames(st.patient) ? '✓ اسم ثلاثي' : st.patient ? 'يحتاج اسم الأب والجد' : 'الاسم واسم الأب والجد'; }
        };
        const paint = () => {
            const d = duty();
            form.innerHTML = `
                ${duties.length > 1 ? `<div class="opu-lab">الذمة (المكان)</div>
                    <div class="opu-cards">${duties.map(x => `<button type="button" class="opu-card ${x.id === st.duty ? 'on' : ''}" data-duty="${x.id}"><b>📍 ${esc(x.place)}</b><small>${esc(x.holder || '')}</small></button>`).join('')}</div>` : `<div class="opu-place">📍 ${esc(d.place)}${d.holder ? ` · <span>المسؤول: ${esc(d.holder)}</span>` : ''}</div>`}
                ${d ? `<div class="opu-lab">المادة</div>
                    <div class="opu-cards">${d.items.map(i => `<button type="button" class="opu-card opu-item ${isOut(i) ? 'out' : counts ? level(i.left, i.low || 0) : ''} ${i.id === st.item ? 'on' : ''}" data-item="${i.id}" ${isOut(i) ? 'disabled' : ''}>
                        <b>💊 ${esc(i.name)}</b>${isOut(i) ? '<small>نفدت</small>' : counts ? `<small>المتبقي ${fmt(i.left)}</small>` : ''}</button>`).join('')}</div>
                    <div class="opu-lab">عدد الأمبولات</div>
                    <div class="opu-step"><button type="button" data-q="-1" aria-label="أقل">−</button><input data-f="qty" type="number" inputmode="numeric" min="1" max="10" placeholder="—" value="${esc(st.qty)}" aria-label="عدد الأمبولات"><button type="button" data-q="1" aria-label="أكثر">＋</button></div>` : ''}
                <div class="opu-sep"></div>
                <div class="opu-lab">اسم المريض الثلاثي</div>
                <input class="opu-in" data-f="patient" maxlength="80" autocomplete="off" placeholder="مثال: علي حسين كاظم" value="${esc(st.patient)}">
                <div class="opu-namecheck"></div>
                <div class="opu-lab">الرقم الإحصائي <span style="font-weight:700;opacity:.7">(اختياري)</span></div>
                <input class="opu-in" data-f="patientNo" maxlength="30" inputmode="numeric" autocomplete="off" placeholder="رقم المريض الإحصائي" value="${esc(st.patientNo)}">
                <div class="opu-lab">التشخيص</div>
                <input class="opu-in" data-f="diagnosis" maxlength="120" autocomplete="off" placeholder="مثال: ألم ما بعد العملية" value="${esc(st.diagnosis)}">
                <div class="opu-two">
                    <div><div class="opu-lab">الجنس</div><div class="opu-sex"><button type="button" data-sex="m" class="${st.sex === 'm' ? 'on' : ''}"><i class="fas fa-mars"></i> ذكر</button><button type="button" data-sex="f" class="${st.sex === 'f' ? 'on' : ''}"><i class="fas fa-venus"></i> أنثى</button></div></div>
                    <div><div class="opu-lab">العمر</div><input class="opu-in" data-f="age" type="number" inputmode="numeric" min="0" max="120" placeholder="بالسنوات" value="${esc(st.age)}"></div>
                </div>
                <div class="opu-sep"></div>
                ${d ? `<div class="opu-lab">الردهة</div><div class="opu-chips">${d.wards.map(w => `<button type="button" data-ward="${esc(w)}" class="${w === st.ward ? 'on' : ''}">🛏️ ${esc(w)}</button>`).join('')}</div>` : ''}
                <div class="opu-lab">تاريخ الاستخدام</div>
                <div class="opu-date"><input class="opu-in" data-f="date" type="date" max="${today()}" value="${esc(st.date)}"><button type="button" data-act="today">اليوم</button></div>`;
            form.querySelectorAll('[data-duty]').forEach(b => b.addEventListener('click', () => { st.duty = Number(b.dataset.duty); st.item = null; st.ward = ''; paint(); }));
            form.querySelectorAll('[data-item]').forEach(b => b.addEventListener('click', () => { st.item = Number(b.dataset.item); paint(); }));
            form.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
                const max = item() ? maxQty(item()) : 10;
                st.qty = String(Math.max(1, Math.min(max, (Number(st.qty) || 0) + Number(b.dataset.q))));
                form.querySelector('[data-f="qty"]').value = st.qty;
                refresh();
            }));
            form.querySelectorAll('[data-f]').forEach(i => i.addEventListener('input', () => { st[i.dataset.f] = i.value; refresh(); }));
            form.querySelectorAll('[data-sex]').forEach(b => b.addEventListener('click', () => { st.sex = b.dataset.sex; form.querySelectorAll('[data-sex]').forEach(x => x.classList.toggle('on', x === b)); refresh(); }));
            form.querySelectorAll('[data-ward]').forEach(b => b.addEventListener('click', () => { st.ward = b.dataset.ward; form.querySelectorAll('[data-ward]').forEach(x => x.classList.toggle('on', x === b)); refresh(); }));
            form.querySelector('[data-act="today"]').addEventListener('click', () => { st.date = today(); form.querySelector('[data-f="date"]').value = st.date; refresh(); });
            refresh();
        };
        root.querySelector('[data-act="submit"]').addEventListener('click', async e => {
            const btn = e.currentTarget;
            if (!(valid[1]() && valid[2]() && valid[3]())) return;
            btn.disabled = true;
            btn.classList.add('busy');
            try {
                const r = await api('POST', '/api/opioids/use', { duty: st.duty, item: st.item, qty: Number(st.qty), patient: st.patient.trim(), patientNo: st.patientNo.trim(), diagnosis: st.diagnosis.trim(), sex: st.sex, age: Number(st.age), ward: st.ward, date: st.date });
                const it = item();
                if (it && Number.isFinite(r.left)) it.left = r.left;
                if (counts && Number.isFinite(r.left)) toast(`سُجّل ✓ · المتبقي من ${it ? it.name : 'المادة'}: ${r.left}${r.low ? (r.left ? ' ⚠️ قارب على النفاد' : ' ⛔ نفد') : ''}`, r.low ? 'info' : 'success');
                else toast('سُجّل الاستخدام ✓', 'success');
                close();
            } catch (err) { btn.disabled = false; btn.classList.remove('busy'); toast(errText(err), 'error'); }
        });
        paint();
    }

    // ------------------------------------------------------------------
    // The duty roster's button (next to Rotation Heroes)
    // ------------------------------------------------------------------
    const targetCache = new Map();
    async function homeButton(btn, hosp) {
        if (!btn) return;
        btn.hidden = true;
        if (!hosp || !Hub.auth.isLoggedIn() || (Hub.aa && Hub.aa.active)) return;
        let hit = targetCache.get(hosp);
        if (!hit || Date.now() - hit.t > 120000) {
            try { hit = { t: Date.now(), v: await api('GET', `/api/opioids/targets?h=${encodeURIComponent(hosp)}`) }; targetCache.set(hosp, hit); }
            catch (e) { return; }
        }
        const duties = hit.v.duties || [];
        if (!duties.length) return;
        btn.hidden = false;
        const out = duties.some(d => d.items.some(i => i.out === true || i.left <= 0));
        btn.innerHTML = `<i class="fas fa-syringe"></i><span>ذمة المخدرات</span>${out ? '<span class="opi-dot" title="مادة نفدت"></span>' : ''}`;
        btn.onclick = e => {
            e.preventDefault();
            useForm(duties, () => targetCache.delete(hosp));
        };
    }

    // ------------------------------------------------------------------
    // For the account panel: does this resident hold (or has held) a duty? (cached briefly)
    // ------------------------------------------------------------------
    let mineAt = 0, mineHas = false;
    async function holds(fresh) {
        if (!fresh && Date.now() - mineAt < 60000) return mineHas;
        try { const r = await api('GET', '/api/opioids/mine'); mineHas = (r.duties || []).length > 0; mineAt = Date.now(); } catch (e) { /* keep the last answer */ }
        return mineHas;
    }

    window.HubOpioids = { manager, mine, homeButton, useForm, holds };
})(window, document);
