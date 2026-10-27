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

    function documentHtml(hospId, data) {
        const { hosp, list, inactive } = data;
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
@page { size: A4 portrait; margin: 13mm 12mm 15mm; }
* { box-sizing: border-box; }
body { font-family: 'Amiri', 'Traditional Arabic', 'Times New Roman', serif; color: #111; font-size: 11.5pt; margin: 0; padding-bottom: 7mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
th, td { border: 0.6pt solid #7d8b99; padding: 3pt 5pt; text-align: center; vertical-align: middle; }
th { background: #e6edf5; color: #0f2a4a; font-size: 10pt; font-weight: 700; }
td { font-size: 10.5pt; }
td.name { text-align: right; font-weight: 700; }
td.num { width: 22pt; color: #555; }
td.ph { direction: ltr; unicode-bidi: isolate; font-family: 'Times New Roman', serif; font-size: 10pt; white-space: nowrap; }
td.muted, .muted { color: #8a8a8a; }
tr { page-break-inside: avoid; break-inside: avoid; }
thead { display: table-header-group; }
tbody tr:nth-child(even) td { background: #f7f9fb; }
.summary td:first-child { text-align: right; font-weight: 700; }
.summary tfoot td { font-weight: 700; background: #e6edf5; }
.note { font-size: 9.5pt; color: #444; margin: 6pt 0 0; line-height: 1.6; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20pt; margin-top: 30pt; page-break-inside: avoid; break-inside: avoid; }
.sign div { border-top: 0.8pt solid #222; padding-top: 4pt; text-align: center; font-size: 10.5pt; font-weight: 700; }
.sign small { display: block; font-weight: 400; color: #666; font-size: 9pt; margin-top: 2pt; }
footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 8.5pt; color: #666; display: flex; justify-content: space-between; border-top: 0.5pt solid #b8c4d0; padding-top: 2pt; background: #fff; }
</style></head><body>
<div class="head">
    <div class="gov"><span>جمهورية العراق</span>وزارة الصحة<br>${esc(hospName)}</div>
    <div class="title"><h1>إحصائية الأطباء المقيمين</h1><div>حسب الاختصاص · المرحلة · نوع البورد</div></div>
    <div class="ref"><b>التاريخ:</b> ${esc(dateText)}<br><b>العدد الكلي:</b> ${total} طبيباً مقيماً<br><b>عدد الاختصاصات:</b> ${list.length}</div>
</div>

<h2>أولاً: الخلاصة</h2>
<table class="summary"><thead><tr><th>الاختصاص</th><th>العدد</th><th>${BOARDS.iraqi}</th><th>${BOARDS.arab}</th><th>${BOARDS.other}</th><th>${BOARDS.none}</th><th>غير محدد</th></tr></thead>
<tbody>${list.map(g => `<tr><td>${esc(g.name)}</td><td>${g.rows.length}</td><td>${count(g.rows, 'iraqi') || '—'}</td><td>${count(g.rows, 'arab') || '—'}</td><td>${count(g.rows, 'other') || '—'}</td><td>${count(g.rows, 'none') || '—'}</td><td>${count(g.rows, null) || '—'}</td></tr>`).join('')}</tbody>
<tfoot><tr><td>المجموع</td><td>${total}</td><td>${count(allRows, 'iraqi')}</td><td>${count(allRows, 'arab')}</td><td>${count(allRows, 'other')}</td><td>${count(allRows, 'none')}</td><td>${count(allRows, null)}</td></tr></tfoot></table>
${stages.length ? `<table class="summary" style="margin-top:6pt"><thead><tr><th>المرحلة</th>${stages.map(s => `<th>${esc(STAGES[s] || s)}</th>`).join('')}<th>غير محددة</th></tr></thead>
<tbody><tr><td>عدد المقيمين</td>${stages.map(s => `<td>${allRows.filter(r => r.stage === s).length}</td>`).join('')}<td>${allRows.filter(r => r.stage == null).length}</td></tr></tbody></table>` : ''}
<p class="note">الترتيب داخل كل اختصاص: المرحلة (الأعلى أولاً)، ثم نوع البورد (العراقي، العربي، الآخر)، ثم الاسم أبجدياً. نوع البورد والمرحلة من الملفات الشخصية لحسابات المقيمين في الموقع؛ ويظهر «غير محدد» لمن لا يملك حساباً أو لم يُكمل ملفه.${inactive ? ` لا تشمل الإحصائية ${inactive} من المقيمين غير الفعّالين.` : ''}</p>

<h2>ثانياً: قوائم المقيمين حسب الاختصاص</h2>
${list.map(g => `
<h2>${g.icon ? esc(g.icon) + ' ' : ''}${esc(g.name)}<small>${g.rows.length} ${g.rows.length === 1 ? 'مقيم' : 'مقيمين'}</small></h2>
<table><thead><tr><th>ت</th><th>الاسم</th><th>نوع البورد</th><th>المرحلة</th><th>اختصاص البورد</th><th>رقم الهاتف</th></tr></thead><tbody>
${g.rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td class="name">${esc(r.name)}</td><td class="${r.board ? '' : 'muted'}">${esc(BOARDS[r.board] || 'غير محدد')}</td><td class="${r.stage == null ? 'muted' : ''}">${esc(r.stage == null ? 'غير محددة' : (STAGES[r.stage] || r.stage))}</td><td class="${r.specialty ? '' : 'muted'}">${esc(r.specialty || '—')}</td><td class="ph">${esc(phoneText(r.phone))}</td></tr>`).join('')}
</tbody></table>`).join('')}

<div class="sign"><div>مسؤول الأطباء المقيمين<small>&nbsp;</small></div><div>معاون المدير للشؤون الطبية<small>&nbsp;</small></div><div>مدير المستشفى<small>&nbsp;</small></div></div>
<footer><span>بوابة المستشفيات · إحصائية الأطباء المقيمين · ${esc(hospName)}</span><span>طُبعت في ${esc(dateText)}${printedBy ? ' · ' + esc(printedBy) : ''}</span></footer>
</body></html>`;
    }

    /** Builds and prints the census of `hospId` (the print dialog saves it as PDF). */
    async function print(hospId, toast = () => {}) {
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
        f.contentDocument.write(documentHtml(hospId, data));
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

    window.HubCensus = { print, compare, groups, documentHtml };
})();
