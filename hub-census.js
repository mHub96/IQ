/**
 * The residents census of a hospital, printed as a formal A4 document (saved as PDF from the print
 * dialog): a summary, then one table per specialty in the hospital's order. Within a specialty the
 * residents are sorted by stage (highest first), then board (Iraqi, Arab, other, none, not set), then
 * name. Board and stage come from the residents' accounts (/api/accounts/census); a resident without an
 * account is listed as not set.
 */
(function () {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const BOARDS = { iraqi: 'البورد العراقي', arab: 'البورد العربي', other: 'بورد آخر', none: 'بدون بورد' };
    const BOARD_RANK = { iraqi: 0, arab: 1, other: 2, none: 3 };
    const STAGES = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
    const TITLE_RE = /^(د\.|د|dr\.|dr)[\s:/]+/i;
    const bare = name => String(name || '').trim().replace(TITLE_RE, '').trim();
    const stageText = s => s == null ? 'غير محددة' : (STAGES[s] ? `المرحلة ${STAGES[s]}` : `المرحلة ${s}`);
    /** What the census can carry (the person printing picks; the name is always there). */
    const OPTIONS = [
        { key: 'board', label: 'نوع البورد', hint: 'العراقي، العربي، آخر، بدون', on: true },
        { key: 'stage', label: 'المرحلة', hint: 'المرحلة الحالية لكل مقيم', on: true },
        { key: 'specialty', label: 'اختصاص البورد', hint: 'كما في ملف المقيم', on: true },
        { key: 'phone', label: 'رقم الهاتف', hint: '', on: true },
        { key: 'notes', label: 'عمود ملاحظات فارغ', hint: 'للكتابة باليد بعد الطباعة', on: false },
        { key: 'signCol', label: 'عمود توقيع المقيم', hint: 'فارغ، لتوقيع كل مقيم', on: false },
        { key: 'summary', label: 'جدول الخلاصة', hint: 'الأعداد حسب الاختصاص', on: true, section: true },
        { key: 'sign', label: 'خانات توقيع الإدارة', hint: 'في نهاية الوثيقة', on: true, section: true },
    ];
    const DEFAULTS = Object.fromEntries(OPTIONS.map(o => [o.key, o.on]));
    /** Column widths in mm; the name takes the rest (at least NAME_MIN). */
    const COL_MM = { num: 10, board: 24, stage: 19, specialty: 38, phone: 27, notes: 32, signCol: 24 };
    const NAME_MIN = 55;
    /** A4 printable area (12 mm sides, 12 mm top, 16 mm bottom for the page footer). */
    const PAGE = { portrait: { w: 186, h: 269 }, landscape: { w: 273, h: 182 } };
    const ROW_MM = 8, OPENING_MM = 21; // a row; a specialty's title + the table's header row

    /** Portrait when the chosen columns leave the names enough room, otherwise landscape. */
    function layout(o) {
        const cols = ['board', 'stage', 'specialty', 'phone', 'notes', 'signCol'].filter(k => o[k]);
        const fixed = COL_MM.num + cols.reduce((n, k) => n + COL_MM[k], 0);
        const orient = fixed + NAME_MIN <= PAGE.portrait.w ? 'portrait' : 'landscape';
        const { w, h } = PAGE[orient];
        const pct = mm => (mm / w * 100).toFixed(2) + '%';
        const colgroup = `<colgroup><col style="width:${pct(COL_MM.num)}"><col style="width:${pct(w - fixed)}">${cols.map(k => `<col style="width:${pct(COL_MM[k])}">`).join('')}</colgroup>`;
        // A specialty starts only where its title and first rows (about a quarter page) fit together.
        const keep = Math.max(3, Math.floor((h / 4 - OPENING_MM) / ROW_MM));
        return { orient, colgroup, keep };
    }
    const cssText = t => '"' + String(t).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ') + '"';
    const SAVED_KEY = 'hub_census_options';
    const phoneText = raw => {
        const d = String(raw || '').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, '').replace(/^(00)?964/, '').replace(/^0/, '');
        return /^7\d{9}$/.test(d) ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : '—';
    };

    /** Highest stage first, then Iraqi / Arab / other / none / not set, then the name. */
    function compare(a, b) {
        const sa = a.stage == null ? -1 : a.stage, sb = b.stage == null ? -1 : b.stage;
        if (sa !== sb) return sb - sa;
        const ba = a.board in BOARD_RANK ? BOARD_RANK[a.board] : 9, bb = b.board in BOARD_RANK ? BOARD_RANK[b.board] : 9;
        if (ba !== bb) return ba - bb;
        return bare(a.name).localeCompare(bare(b.name), 'ar');
    }

    /** The hospital's residents grouped by specialty, in the hospital's order of specialties. */
    function groups(hospId, profiles) {
        const hosp = Hub.getHospital(hospId) || {};
        const db = Hub.getDatabase ? Hub.getDatabase() : null;
        const all = (db && Array.isArray(db.residents) ? db.residents : hosp.names || [])
            .filter(r => r && r.name && Array.isArray(r.hospitals) && r.hospitals.includes(hospId));
        const active = all.filter(r => r.active !== false);
        const byId = new Map(profiles.map(p => [p.resident_id, p]));
        const specs = (hosp.specialties || []).filter(s => s && s.id && !s.isClone);
        const nameOf = code => {
            if (code === 'RESERVE') return 'الاحتياط';
            const s = specs.find(x => x.id === code);
            return (s && (s.name_ar || s.name_en)) || (Hub.getSpecialtyName ? Hub.getSpecialtyName(code, hospId) : '') || code;
        };
        const iconOf = code => (specs.find(x => x.id === code) || {}).icon || '';
        const map = new Map();
        for (const r of active) {
            const code = r.dept || r.department || r.spec || r.tag || '—';
            const p = byId.get(r.id) || {};
            if (!map.has(code)) map.set(code, []);
            map.get(code).push({ name: r.name, phone: r.phone, board: p.board || null, stage: p.stage == null ? null : Number(p.stage), specialty: p.specialty || '', account: !!byId.get(r.id) });
        }
        const order = code => { const i = specs.findIndex(s => s.id === code); return code === 'RESERVE' ? 9998 : i < 0 ? 9000 : i; };
        const list = [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || nameOf(a[0]).localeCompare(nameOf(b[0]), 'ar'))
            .map(([code, rows]) => ({ code, name: nameOf(code), icon: iconOf(code), rows: rows.sort(compare) }));
        return { hosp, list, inactive: all.length - active.length };
    }

    function documentHtml(hospId, data, opts = DEFAULTS) {
        const o = { ...DEFAULTS, ...opts };
        const { hosp, list, inactive } = data;
        const lay = layout(o);
        const hospName = hosp.name_ar || hosp.hospitalName || hospId;
        const font = file => new URL('./fonts/' + file, location.href).href;
        const now = new Date();
        const dateText = now.toLocaleDateString('ar-IQ-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Baghdad' });
        const printedBy = (Hub.auth.getAccount && Hub.auth.getAccount() || {}).name || '';
        const total = list.reduce((n, g) => n + g.rows.length, 0);
        const count = (rows, board) => rows.filter(r => board === null ? !r.board : r.board === board).length;
        const allRows = list.flatMap(g => g.rows);
        const stages = [...new Set(allRows.map(r => r.stage).filter(s => s != null))].sort((a, b) => b - a);
        return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إحصائية الأطباء المقيمين · ${esc(hospName)}</title>
<style>
@font-face { font-family: 'Amiri'; src: url('${font('Amiri-Regular.ttf')}') format('truetype'); font-weight: 400; }
@font-face { font-family: 'Amiri'; src: url('${font('Amiri-Bold.ttf')}') format('truetype'); font-weight: 700; }
@page { size: A4 ${lay.orient}; margin: 12mm 12mm 16mm;
  @bottom-right { content: ${cssText('إحصائية الأطباء المقيمين · ' + hospName)}; font-family: 'Amiri', serif; font-size: 8.5pt; color: #666; vertical-align: top; padding-top: 3mm; }
  @bottom-center { content: ${cssText('طُبعت في ' + dateText)}; font-family: 'Amiri', serif; font-size: 8.5pt; color: #666; vertical-align: top; padding-top: 3mm; }
  @bottom-left { content: "صفحة " counter(page) " من " counter(pages); font-family: 'Amiri', serif; font-size: 8.5pt; color: #666; vertical-align: top; padding-top: 3mm; }
}
* { box-sizing: border-box; }
body { font-family: 'Amiri', 'Traditional Arabic', 'Times New Roman', serif; color: #111; font-size: 11.5pt; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8pt; padding-bottom: 6pt; border-bottom: 2.4pt double #0f2a4a; }
.head .gov { font-size: 11pt; font-weight: 700; line-height: 1.45; color: #0f2a4a; }
.head .gov span { display: block; font-size: 12.5pt; }
.head .title { text-align: center; }
.head .title h1 { margin: 0; font-size: 19pt; color: #0f2a4a; letter-spacing: .3pt; }
.head .title div { font-size: 10.5pt; color: #444; }
.head .ref { justify-self: end; font-size: 9.5pt; line-height: 1.6; color: #333; text-align: right; border: 0.7pt solid #9fb3c8; border-radius: 3pt; padding: 4pt 7pt; }
.head .ref b { color: #0f2a4a; }
h2 { font-size: 13pt; margin: 12pt 0 4pt; color: #0f2a4a; display: flex; justify-content: space-between; align-items: baseline; break-after: avoid; page-break-after: avoid; border-bottom: 0.8pt solid #0f2a4a; padding-bottom: 2pt; }
h2 small { font-size: 9.5pt; color: #555; font-weight: 400; }
table { width: 100%; border-collapse: collapse; }
table.list { table-layout: fixed; }
th, td { border: 0.6pt solid #7d8b99; padding: 2.5pt 4pt; text-align: center; vertical-align: middle; line-height: 1.35; overflow-wrap: anywhere; word-break: normal; }
th { background: #e6edf5; color: #0f2a4a; font-size: 10pt; font-weight: 700; }
td { font-size: 10.5pt; }
td.name { text-align: right; font-weight: 700; }
td.num { width: 22pt; color: #555; }
td.ph { direction: ltr; unicode-bidi: isolate; font-family: 'Times New Roman', serif; font-size: 10pt; white-space: nowrap; overflow-wrap: normal; }
td.muted, .muted { color: #8a8a8a; }
tr { page-break-inside: avoid; break-inside: avoid; }
/* A specialty's title, header row and first rows stay together: near the bottom of a page they all move on. */
h2.spec { break-after: avoid; page-break-after: avoid; }
tbody.open { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
tbody tr:nth-child(even) td { background: #f7f9fb; }
.summary td:first-child { text-align: right; font-weight: 700; }
.summary tfoot td { font-weight: 700; background: #e6edf5; }
.note { font-size: 9.5pt; color: #444; margin: 6pt 0 0; line-height: 1.6; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20pt; margin-top: 30pt; page-break-inside: avoid; break-inside: avoid; }
.sign div { border-top: 0.8pt solid #222; padding-top: 4pt; text-align: center; font-size: 10.5pt; font-weight: 700; }
.sign small { display: block; font-weight: 400; color: #666; font-size: 9pt; margin-top: 2pt; }
</style></head><body>
<div class="head">
    <div class="gov"><span>جمهورية العراق</span>وزارة الصحة<br>${esc(hospName)}</div>
    <div class="title"><h1>إحصائية الأطباء المقيمين</h1><div>حسب الاختصاص · المرحلة · نوع البورد</div></div>
    <div class="ref"><b>التاريخ:</b> ${esc(dateText)}<br><b>العدد الكلي:</b> ${total} طبيباً مقيماً<br><b>عدد الاختصاصات:</b> ${list.length}${printedBy ? `<br><b>أعدّها:</b> ${esc(printedBy)}` : ''}</div>
</div>

${o.summary ? `<h2>أولاً: الخلاصة</h2>
<table class="summary"><thead><tr><th>الاختصاص</th><th>العدد</th>${o.board ? `<th>${BOARDS.iraqi}</th><th>${BOARDS.arab}</th><th>${BOARDS.other}</th><th>${BOARDS.none}</th><th>غير محدد</th>` : ''}</tr></thead>
<tbody>${list.map(g => `<tr><td>${esc(g.name)}</td><td>${g.rows.length}</td>${o.board ? `<td>${count(g.rows, 'iraqi') || '—'}</td><td>${count(g.rows, 'arab') || '—'}</td><td>${count(g.rows, 'other') || '—'}</td><td>${count(g.rows, 'none') || '—'}</td><td>${count(g.rows, null) || '—'}</td>` : ''}</tr>`).join('')}</tbody>
<tfoot><tr><td>المجموع</td><td>${total}</td>${o.board ? `<td>${count(allRows, 'iraqi')}</td><td>${count(allRows, 'arab')}</td><td>${count(allRows, 'other')}</td><td>${count(allRows, 'none')}</td><td>${count(allRows, null)}</td>` : ''}</tr></tfoot></table>
${o.stage && stages.length ? `<table class="summary" style="margin-top:6pt"><thead><tr><th>المرحلة</th>${stages.map(s => `<th>${esc(STAGES[s] || s)}</th>`).join('')}<th>غير محددة</th></tr></thead>
<tbody><tr><td>عدد المقيمين</td>${stages.map(s => `<td>${allRows.filter(r => r.stage === s).length}</td>`).join('')}<td>${allRows.filter(r => r.stage == null).length}</td></tr></tbody></table>` : ''}
<p class="note">الترتيب داخل كل اختصاص: المرحلة (الأعلى أولاً)، ثم نوع البورد (العراقي، العربي، الآخر)، ثم الاسم أبجدياً. نوع البورد والمرحلة من الملفات الشخصية لحسابات المقيمين في الموقع؛ ويظهر «غير محدد» لمن لا يملك حساباً أو لم يُكمل ملفه.${inactive ? ` لا تشمل الإحصائية ${inactive} من المقيمين غير الفعّالين.` : ''}</p>
` : ''}
<h2>${o.summary ? 'ثانياً: ' : ''}قوائم المقيمين حسب الاختصاص</h2>
${list.map(g => `
<h2 class="spec">${g.icon ? esc(g.icon) + ' ' : ''}${esc(g.name)}<small>${g.rows.length} ${g.rows.length === 1 ? 'مقيم' : 'مقيمين'}</small></h2>
<table class="list">${lay.colgroup}<thead><tr><th>ت</th><th>الاسم</th>${o.board ? '<th>نوع البورد</th>' : ''}${o.stage ? '<th>المرحلة</th>' : ''}${o.specialty ? '<th>اختصاص البورد</th>' : ''}${o.phone ? '<th>رقم الهاتف</th>' : ''}${o.notes ? '<th class="blank">ملاحظات</th>' : ''}${o.signCol ? '<th class="blank">التوقيع</th>' : ''}</tr></thead>
${(() => {
    const row = (r, i) => `<tr><td class="num">${i + 1}</td><td class="name">${esc(r.name)}</td>${o.board ? `<td class="${r.board ? '' : 'muted'}">${esc(BOARDS[r.board] || 'غير محدد')}</td>` : ''}${o.stage ? `<td class="${r.stage == null ? 'muted' : ''}">${esc(r.stage == null ? 'غير محددة' : (STAGES[r.stage] || r.stage))}</td>` : ''}${o.specialty ? `<td class="${r.specialty ? '' : 'muted'}">${esc(r.specialty || '—')}</td>` : ''}${o.phone ? `<td class="ph">${esc(phoneText(r.phone))}</td>` : ''}${o.notes ? '<td></td>' : ''}${o.signCol ? '<td></td>' : ''}</tr>`;
    // A short specialty stays whole; a long one keeps its opening rows with its title, and its last
    // three rows together (no single row left alone on a page).
    const n = g.rows.length, k = n <= lay.keep + 3 ? n : lay.keep, tail = n - k >= 6 ? n - 3 : n;
    const part = (from, to, cls) => from < to ? `<tbody${cls ? ` class="${cls}"` : ''}>${g.rows.slice(from, to).map((r, i) => row(r, i + from)).join('')}</tbody>` : '';
    return part(0, k, 'open') + (tail < n ? part(k, tail) + part(tail, n, 'open') : part(k, n, k < n ? 'open' : ''));
})()}
</table>`).join('')}

${o.sign ? '<div class="sign"><div>مسؤول الأطباء المقيمين<small>&nbsp;</small></div><div>معاون المدير للشؤون الطبية<small>&nbsp;</small></div><div>مدير المستشفى<small>&nbsp;</small></div></div>' : ''}
</body></html>`;
    }

    const POP_CSS = `
    .hcen-back { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px; background: rgba(15,23,42,.45); backdrop-filter: blur(3px); }
    .hcen { width: min(420px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; border-radius: 22px; background: #fff; color: #0f172a; box-shadow: 0 24px 60px rgba(15,23,42,.3);
        direction: rtl; text-align: right; font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif; animation: hcen-in .22s ease-out; }
    @keyframes hcen-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
    .hcen-head { display: flex; gap: 10px; align-items: center; padding: 16px 16px 6px; }
    .hcen-head i { width: 40px; height: 40px; flex: none; border-radius: 13px; display: grid; place-items: center; background: #e0f2fe; color: #0369a1; font-size: 1.1rem; }
    .hcen-head b { display: block; font-size: .98rem; font-weight: 900; }
    .hcen-head small { display: block; font-size: .72rem; opacity: .65; font-weight: 700; margin-top: 2px; }
    .hcen-sec { margin: 12px 16px 6px; font-size: .7rem; font-weight: 900; opacity: .6; }
    .hcen-list { display: grid; gap: 6px; padding: 0 16px; }
    .hcen-opt { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 14px; border: 1.5px solid rgba(100,116,139,.22); cursor: pointer; transition: border-color .15s, background .15s; }
    .hcen-opt.on { border-color: #0284c7; background: rgba(2,132,199,.07); }
    .hcen-opt input { width: 18px; height: 18px; accent-color: #0284c7; flex: none; margin: 0; }
    .hcen-opt span { flex: 1; font-size: .84rem; font-weight: 800; }
    .hcen-opt small { display: block; font-size: .68rem; font-weight: 600; opacity: .6; margin-top: 1px; }
    .hcen-fixed { margin: 0 16px 6px; font-size: .7rem; font-weight: 700; opacity: .6; }
    .hcen-foot { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 14px 16px 16px; background: inherit; border-radius: 0 0 22px 22px; }
    .hcen-foot button { flex: 1; padding: 11px; border-radius: 14px; border: 0; font: inherit; font-weight: 900; font-size: .85rem; cursor: pointer; }
    .hcen-go { background: linear-gradient(135deg, #0369a1, #0284c7); color: #fff; }
    .hcen-cancel { background: rgba(100,116,139,.14); color: inherit; }
    html.dark .hcen, body.dark .hcen { background: #1c1c1e; color: #f1f5f9; }
    html.dark .hcen-head i, body.dark .hcen-head i { background: rgba(2,132,199,.2); color: #7dd3fc; }`;

    /** The options pop-up: which columns and sections the census carries (remembered on this device). */
    function print(hospId, toast = () => {}) {
        if (!hospId) return;
        if (!document.getElementById('hcen-css')) {
            const st = document.createElement('style');
            st.id = 'hcen-css';
            st.textContent = POP_CSS;
            document.head.appendChild(st);
        }
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}; } catch (e) {}
        const opts = { ...DEFAULTS, ...saved };
        const item = o => `<label class="hcen-opt ${opts[o.key] ? 'on' : ''}"><input type="checkbox" data-k="${o.key}" ${opts[o.key] ? 'checked' : ''}><span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span></label>`;
        const back = document.createElement('div');
        back.className = 'hcen-back';
        back.innerHTML = `<div class="hcen" role="dialog" aria-modal="true" aria-label="خيارات إحصائية المقيمين">
            <div class="hcen-head"><i class="fas fa-file-pdf"></i><div><b>إحصائية المقيمين (PDF)</b><small>اختر البيانات التي تظهر في الإحصائية</small></div></div>
            <div class="hcen-sec">الأعمدة</div>
            <div class="hcen-fixed">التسلسل واسم المقيم يظهران دائماً.</div>
            <div class="hcen-list">${OPTIONS.filter(o => !o.section).map(item).join('')}</div>
            <div class="hcen-sec">أقسام الوثيقة</div>
            <div class="hcen-list">${OPTIONS.filter(o => o.section).map(item).join('')}</div>
            <div class="hcen-foot"><button type="button" class="hcen-go" data-act="go"><i class="fas fa-print"></i> طباعة / حفظ PDF</button><button type="button" class="hcen-cancel" data-act="cancel">إلغاء</button></div>
        </div>`;
        back.querySelectorAll('[data-k]').forEach(i => i.addEventListener('change', () => i.closest('.hcen-opt').classList.toggle('on', i.checked)));
        const onKey = e => { if (e.key === 'Escape') close(); };
        const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
        document.addEventListener('keydown', onKey);
        back.addEventListener('click', e => { if (e.target === back) close(); });
        back.querySelector('[data-act="cancel"]').addEventListener('click', close);
        back.querySelector('[data-act="go"]').addEventListener('click', () => {
            const chosen = Object.fromEntries([...back.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.checked]));
            try { localStorage.setItem(SAVED_KEY, JSON.stringify(chosen)); } catch (e) {}
            close();
            make(hospId, toast, chosen);
        });
        document.body.appendChild(back);
        back.querySelector('[data-act="go"]').focus({ preventScroll: true });
    }

    /** Builds and prints the census of `hospId` with the chosen columns (the print dialog saves it as PDF). */
    async function make(hospId, toast = () => {}, opts = DEFAULTS) {
        if (!hospId) return;
        toast('جاري تجهيز إحصائية المقيمين…', 'info');
        let profiles = [];
        try { profiles = (await Hub.api('GET', '/api/accounts/census?h=' + encodeURIComponent(hospId), undefined, { retries: 1 })).profiles || []; }
        catch (e) { toast('تعذر جلب معلومات البورد من الخادم: تُطبع الإحصائية بدونها.', 'error'); }
        const data = groups(hospId, profiles);
        if (!data.list.length) { toast('لا يوجد مقيمون في قاعدة هذا المستشفى.', 'error'); return; }
        const f = document.createElement('iframe');
        f.setAttribute('aria-hidden', 'true');
        f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0;opacity:0';
        document.body.appendChild(f);
        f.contentDocument.open();
        f.contentDocument.write(documentHtml(hospId, data, opts));
        f.contentDocument.close();
        // The formal font first, so the PDF does not fall back to the system's.
        try {
            const fonts = f.contentDocument.fonts;
            await Promise.race([Promise.all([fonts.load("400 12pt Amiri"), fonts.load("700 12pt Amiri")]).then(() => fonts.ready), new Promise(r => setTimeout(r, 3000))]);
        } catch (e) {}
        setTimeout(() => {
            try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('تعذرت الطباعة على هذا الجهاز.', 'error'); }
            setTimeout(() => f.remove(), 60000);
        }, 250);
    }

    window.HubCensus = { print, make, compare, groups, documentHtml, layout, OPTIONS };
})();
