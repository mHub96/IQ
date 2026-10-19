/**
 * The ER page's official printed sheet and its print settings panel.
 *
 * - One builder makes the sheet's HTML; the live preview shows exactly that HTML, so what you see
 *   is what prints.
 * - The chosen font reaches every word on the paper (a page-wide font rule used to override it),
 *   and printing waits until the font has loaded.
 * - Fonts: a catalogue of Arabic fonts (loaded on demand), the computer's own fonts, and fonts
 *   uploaded to the server: shared by everyone who prints here, kept until deleted.
 * - Table themes plus free choice of colours, lines, sizes, spacing, digits and weekend days;
 *   your own styles can be saved as themes.
 * The settings live in the ER state (state.printOptions, state.printThemes) like before, so they
 * follow the schedules to every device. The defaults print the same sheet as before.
 */
(function (window, document) {
    'use strict';

    const core = () => window.EmergencyCore;
    const S = () => core().state();
    const notify = (msg, type) => { try { core().showNotification(msg, type || 'info'); } catch (e) {} };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isColor = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));

    // ------------------------------------------------------------------------------------------
    // Fonts
    // ------------------------------------------------------------------------------------------
    // [family, Arabic label, group, Google weights ('' = not on Google Fonts), generic]
    const FONT_LIST = [
        ['Cairo', 'كايرو', 'modern', '400;700;900', 'sans-serif'],
        ['Amiri', 'أميري', 'naskh', '400;700', 'serif'],
        ['Noto Naskh Arabic', 'نوتو نسخ', 'naskh', '400;700', 'serif'],
        ['Scheherazade New', 'شهرزاد', 'naskh', '400;700', 'serif'],
        ['Markazi Text', 'مركزي', 'naskh', '400;700', 'serif'],
        ['Lateef', 'لطيف', 'naskh', '400;700', 'serif'],
        ['Harmattan', 'هرمتان', 'naskh', '400;700', 'sans-serif'],
        ['Mirza', 'ميرزا', 'naskh', '400;700', 'serif'],
        ['Tajawal', 'تجوال', 'modern', '400;700;900', 'sans-serif'],
        ['Almarai', 'المراعي', 'modern', '400;700;800', 'sans-serif'],
        ['Alexandria', 'الإسكندرية', 'modern', '400;700;900', 'sans-serif'],
        ['IBM Plex Sans Arabic', 'آي بي إم بلكس', 'modern', '400;700', 'sans-serif'],
        ['Noto Sans Arabic', 'نوتو سانس', 'modern', '400;700;900', 'sans-serif'],
        ['Noto Kufi Arabic', 'نوتو كوفي', 'kufi', '400;700;900', 'sans-serif'],
        ['Readex Pro', 'ريدكس برو', 'modern', '400;700', 'sans-serif'],
        ['Vazirmatn', 'وزيرمتن', 'modern', '400;700;900', 'sans-serif'],
        ['Rubik', 'روبيك', 'modern', '400;700;900', 'sans-serif'],
        ['Mada', 'مدى', 'modern', '400;700;900', 'sans-serif'],
        ['Changa', 'تشانجا', 'kufi', '400;700', 'sans-serif'],
        ['El Messiri', 'المسيري', 'modern', '400;700', 'sans-serif'],
        ['Baloo Bhaijaan 2', 'بالو بهيجان', 'modern', '400;700', 'sans-serif'],
        ['Reem Kufi', 'ريم كوفي', 'kufi', '400;700', 'sans-serif'],
        ['Kufam', 'كوفام', 'kufi', '400;700;900', 'sans-serif'],
        ['Lemonada', 'ليمونادة', 'display', '400;700', 'sans-serif'],
        ['Aref Ruqaa', 'عارف رقعة', 'display', '400;700', 'serif'],
        ['Lalezar', 'لاله زار', 'display', '400', 'sans-serif'],
        ['Rakkas', 'رقّاص', 'display', '400', 'serif'],
        ['Katibeh', 'كاتبة', 'display', '400', 'serif'],
        ['Traditional Arabic', 'العربي التقليدي (ويندوز)', 'system', '', 'serif'],
        ['Simplified Arabic', 'العربي المبسط (ويندوز)', 'system', '', 'sans-serif'],
        ['Sakkal Majalla', 'سكّال مجلة (ويندوز)', 'system', '', 'serif'],
        ['Arabic Typesetting', 'التنضيد العربي (ويندوز)', 'system', '', 'serif'],
        ['Tahoma', 'تاهوما', 'system', '', 'sans-serif'],
        ['Arial', 'Arial', 'system', '', 'sans-serif'],
        ['Times New Roman', 'Times New Roman', 'system', '', 'serif'],
    ];
    const FONT_GROUPS = { naskh: 'نسخ رسمية', modern: 'حديثة إدارية', kufi: 'كوفية', display: 'زخرفية للعناوين', system: 'خطوط الجهاز', uploaded: 'خطوط مرفوعة', legacy: 'خط مرفوع سابقاً' };
    const cssOf = (family, generic) => `'${family}', ${generic || 'sans-serif'}`;
    const familyOf = css => (String(css || '').match(/^\s*['"]?([^'",]+)['"]?/) || [])[1] || 'Cairo';
    const DEFAULT_FONT = "'Cairo', sans-serif";

    // family -> a promise that settles once its stylesheet is in (until then the browser has no such
    // font to load, and a print would quietly use a fallback).
    const PAGE_LINKED = ['Cairo', 'Amiri', 'Noto Naskh Arabic', 'Scheherazade New', 'Tajawal', 'Almarai', 'Alexandria', 'IBM Plex Sans Arabic'];
    const googleLinks = {};
    function ensureGoogleFont(family) {
        const f = FONT_LIST.find(x => x[0] === family);
        if (!f || !f[3] || PAGE_LINKED.includes(family)) return Promise.resolve();
        if (googleLinks[family]) return googleLinks[family];
        googleLinks[family] = new Promise(resolve => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${f[3]}&display=swap`;
            link.onload = link.onerror = () => resolve();
            document.head.appendChild(link);
        });
        return googleLinks[family];
    }

    // Fonts uploaded to the server.
    let uploaded = [];       // [{ id, name, file_name, format, size }]
    let uploadedLoaded = false;
    const upFamily = id => `ERF_${id}`;
    const apiBase = () => (window.Hub && Hub.CONFIG && Hub.CONFIG.apiBase) || '';
    // The server keeps each font as base64 text; here it becomes a font of this page (FontFace).
    // The browser caches the text for good, so a font is downloaded once per device.
    const faceLoads = {};
    function registerUploaded(f) {
        if (faceLoads[f.id]) return faceLoads[f.id];
        faceLoads[f.id] = fetch(`${apiBase()}/api/er-fonts/file/${f.id}`)
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
            .then(b64 => {
                const bin = atob(b64.trim());
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return new FontFace(upFamily(f.id), bytes.buffer).load();
            })
            .then(face => { document.fonts.add(face); return true; })
            .catch(() => { delete faceLoads[f.id]; return false; });
        return faceLoads[f.id];
    }
    const readBase64 = file => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
    const MAX_FONT = 1400 * 1024;
    async function loadUploaded(force) {
        if (uploadedLoaded && !force) return uploaded;
        try {
            const r = await Hub.api('GET', '/api/er-fonts', undefined, { retries: 1 });
            uploaded = (r && r.fonts) || [];
            uploaded.forEach(registerUploaded);
            uploadedLoaded = true;
        } catch (e) { /* offline: the list stays as it was */ }
        return uploaded;
    }
    const legacyFont = () => { try { const d = localStorage.getItem('emergency_custom_font_data'); return d ? { data: d, name: localStorage.getItem('emergency_custom_font_name') || 'خط مخصص' } : null; } catch (e) { return null; } };

    /** Makes sure a CSS font value is usable now (Google link / uploaded face). */
    function prepareFont(css) {
        const fam = familyOf(css);
        if (/^ERF_/.test(fam)) { const f = uploaded.find(x => upFamily(x.id) === fam); if (f) registerUploaded(f); }
        else ensureGoogleFont(fam);
        return fam;
    }
    function fontLabel(css) {
        const fam = familyOf(css);
        if (/^ERF_/.test(fam)) { const f = uploaded.find(x => upFamily(x.id) === fam); return f ? f.name : 'خط مرفوع (محذوف)'; }
        if (fam === 'CustomPrintFont') return (legacyFont() || {}).name || 'خط مرفوع سابقاً';
        const f = FONT_LIST.find(x => x[0] === fam);
        return f ? f[1] : fam;
    }
    /** Waits (up to 5 s) until the fonts the sheet uses can draw Arabic, so the paper gets them. */
    async function fontsReady(families) {
        const tasks = [];
        [...new Set(families)].forEach(fam => {
            if (!fam || !document.fonts || !document.fonts.load) return;
            if (/^ERF_/.test(fam)) { const f = uploaded.find(x => upFamily(x.id) === fam); if (f) tasks.push(registerUploaded(f)); return; }
            // The stylesheet first, then the font's Arabic and Latin files in both weights the sheet uses.
            tasks.push(ensureGoogleFont(fam).then(() => Promise.all(['400', '700'].map(w => document.fonts.load(`${w} 12pt "${fam}"`, 'ابتثجح 0123').catch(() => {})))));
        });
        await Promise.race([Promise.all(tasks).then(() => document.fonts.ready), new Promise(r => setTimeout(r, 8000))]);
    }

    // ------------------------------------------------------------------------------------------
    // Options & themes
    // ------------------------------------------------------------------------------------------
    // Style keys a theme sets (fonts stay the user's choice).
    const STYLE_KEYS = ['headerBg', 'headerText', 'weekendBg', 'weekendText', 'borderColor', 'bodyBg', 'bodyText', 'zebra', 'zebraBg', 'grid', 'borderWidth', 'borderStyle', 'density', 'headerWeight'];
    const DEFAULTS = {
        theme: 'official',
        fontFamily: DEFAULT_FONT, tableFont: '', dateFont: 'latin', digits: 'latin',
        headerBg: '#000000', headerText: '#ffffff', weekendBg: '#5ea37d', weekendText: '#000000', borderColor: '#000000',
        bodyBg: '#ffffff', bodyText: '#000000', zebra: false, zebraBg: '#f1f5f9',
        grid: 'all', borderWidth: 1, borderStyle: 'solid', density: 'normal', headerWeight: 900,
        tableSize: 7.2, docScale: 1, nameWeight: 'auto', weekendBold: true, weekendDays: 'fri_sat', align: 'center',
    };
    const base = { bodyBg: '#ffffff', bodyText: '#000000', zebra: false, zebraBg: '#f1f5f9', grid: 'all', borderWidth: 1, borderStyle: 'solid', density: 'normal', headerWeight: 900 };
    const THEMES = {
        official: { name: 'النموذج الوزاري', note: 'ترويسة سوداء وعطلة خضراء (الأصلي)', ...base, headerBg: '#000000', headerText: '#ffffff', weekendBg: '#5ea37d', weekendText: '#000000', borderColor: '#000000' },
        bw: { name: 'أبيض وأسود كلاسيكي', note: 'اقتصادي للطابعات الليزرية', ...base, headerBg: '#e2e8f0', headerText: '#000000', weekendBg: '#f1f5f9', weekendText: '#000000', borderColor: '#000000' },
        navy: { name: 'كحلي ملكي', note: 'ترويسة كحلية وعطلة زرقاء', ...base, headerBg: '#1e3a8a', headerText: '#ffffff', weekendBg: '#bfdbfe', weekendText: '#1e3a8a', borderColor: '#1e3a8a' },
        emerald: { name: 'أخضر زمردي', note: 'طابع صحي', ...base, headerBg: '#065f46', headerText: '#ffffff', weekendBg: '#a7f3d0', weekendText: '#064e3b', borderColor: '#065f46' },
        burgundy: { name: 'عنابي الطوارئ', note: 'لون الطوارئ الرسمي', ...base, headerBg: '#881337', headerText: '#ffffff', weekendBg: '#fecdd3', weekendText: '#881337', borderColor: '#881337' },
        graphite: { name: 'غرافيت حديث', note: 'رمادي داكن مع صفوف متناوبة', ...base, headerBg: '#1f2937', headerText: '#f9fafb', weekendBg: '#e5e7eb', weekendText: '#111827', borderColor: '#9ca3af', zebra: true, zebraBg: '#f9fafb', borderWidth: 0.75 },
        minimal: { name: 'خطوط أفقية فقط', note: 'بسيط وأنيق بلا خطوط عمودية', ...base, headerBg: '#ffffff', headerText: '#111827', weekendBg: '#f3f4f6', weekendText: '#111827', borderColor: '#374151', grid: 'rows', borderWidth: 0.75 },
        executive: { name: 'تنفيذي ذهبي', note: 'أسود مع عطلة ذهبية', ...base, headerBg: '#111111', headerText: '#f5d77a', weekendBg: '#f7ecc9', weekendText: '#3d2e05', borderColor: '#8a6d1c' },
        sand: { name: 'رملي هادئ', note: 'ألوان دافئة مريحة', ...base, headerBg: '#7c5a3a', headerText: '#fffaf0', weekendBg: '#f3e5cf', weekendText: '#4a3420', borderColor: '#a07850', zebra: true, zebraBg: '#fcf8f1' },
        teal: { name: 'فيروزي سريري', note: 'نظيف بطابع المستشفيات', ...base, headerBg: '#0f766e', headerText: '#ffffff', weekendBg: '#ccfbf1', weekendText: '#134e4a', borderColor: '#0f766e', borderWidth: 0.75 },
        royal: { name: 'بنفسجي ملكي', note: 'ترويسة بنفسجية', ...base, headerBg: '#4c1d95', headerText: '#ffffff', weekendBg: '#ede9fe', weekendText: '#4c1d95', borderColor: '#5b21b6' },
        ocean: { name: 'أزرق سماوي', note: 'فاتح ومريح للقراءة', ...base, headerBg: '#0369a1', headerText: '#ffffff', weekendBg: '#e0f2fe', weekendText: '#0c4a6e', borderColor: '#7dd3fc', zebra: true, zebraBg: '#f0f9ff', borderWidth: 0.75 },
        olive: { name: 'زيتوني رسمي', note: 'هادئ ومحافظ', ...base, headerBg: '#3f4f24', headerText: '#ffffff', weekendBg: '#e4ebd3', weekendText: '#2b3618', borderColor: '#55652f' },
        crimsonline: { name: 'خطوط قرمزية', note: 'خلفية بيضاء وخطوط ملونة', ...base, headerBg: '#ffffff', headerText: '#9f1239', weekendBg: '#fff1f2', weekendText: '#881337', borderColor: '#be123c', grid: 'rows', borderWidth: 1.25 },
        saver: { name: 'موفّر للحبر', note: 'بدون تعبئة، خطوط رمادية رفيعة', ...base, headerBg: '#ffffff', headerText: '#000000', weekendBg: '#ffffff', weekendText: '#000000', borderColor: '#6b7280', borderWidth: 0.5, headerWeight: 800 },
        contrast: { name: 'تباين عالٍ', note: 'خطوط سميكة للوضوح', ...base, headerBg: '#000000', headerText: '#ffffff', weekendBg: '#d4d4d4', weekendText: '#000000', borderColor: '#000000', borderWidth: 1.5 },
    };

    function opts() {
        const st = S();
        const o = Object.assign({}, DEFAULTS, st.printOptions || {});
        ['headerBg', 'headerText', 'weekendBg', 'weekendText', 'borderColor', 'bodyBg', 'bodyText', 'zebraBg'].forEach(k => { if (!isColor(o[k])) o[k] = DEFAULTS[k]; });
        o.tableSize = Math.min(12, Math.max(5, Number(o.tableSize) || DEFAULTS.tableSize));
        o.docScale = Math.min(1.4, Math.max(0.8, Number(o.docScale) || 1));
        o.borderWidth = Math.min(3, Math.max(0, Number(o.borderWidth)));
        if (!isFinite(o.borderWidth)) o.borderWidth = 1;
        o.headerWeight = [400, 700, 800, 900].includes(Number(o.headerWeight)) ? Number(o.headerWeight) : 900;
        if (!o.fontFamily) o.fontFamily = DEFAULT_FONT;
        return o;
    }
    function setOpt(patch, keepTheme) {
        const st = S();
        st.printOptions = Object.assign({}, opts(), patch);
        if (!keepTheme && Object.keys(patch).some(k => STYLE_KEYS.includes(k))) st.printOptions.theme = 'custom';
        queueSave();
    }
    let saveTimer = null;
    function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { core().saveState(); } catch (e) {} }, 500); }
    function savedThemes() { const t = S().printThemes; return Array.isArray(t) ? t : []; }

    // ------------------------------------------------------------------------------------------
    // The sheet
    // ------------------------------------------------------------------------------------------
    const SHEET_TITLES = { er: 'في الطوارئ', con: 'في الاستشارية', dc: 'لشهادات الوفاة', rs_er: 'في إضراب طوارئ الإسناد (RS)', rs_wards: 'في إضراب ردهات الإسناد (RS)' };
    const SHEET_SHORT = { er: 'الطوارئ', con: 'الاستشارية', dc: 'شهادات الوفاة', rs_er: 'إسناد الطوارئ', rs_wards: 'إسناد الردهات' };
    const ER_SHIFTS = ['الصباحية 8ص-2م', 'بعدالصباحية 2م-8م', 'البرينايت 8م-2ص', 'الليلية 2ص-8ص'];
    function sheetSpec(sheet) {
        const st = S();
        const dim = new Date(st.year, st.month, 0).getDate();
        const range = () => {
            const a = parseInt(String(st.rsStartDate || '').split('-')[2], 10) || 1;
            const b = parseInt(String(st.rsEndDate || '').split('-')[2], 10) || dim;
            return d => d.dayNumber >= a && d.dayNumber <= b;
        };
        switch (sheet) {
            case 'con': return { widths: [100, 110], cols: ['طبيب الاستشارية الخافرة'], keys: ['doctor'], rows: st.schedules.con || [], pad: [2.5, 4], bold: true };
            case 'dc': return { widths: [100, 110], cols: ['طبيب شهادات الوفاة المكلف'], keys: ['doctor'], rows: st.schedules.dc || [], pad: [2.5, 4], bold: true };
            case 'rs_er': return { widths: [70, 80], cols: ER_SHIFTS, keys: ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight'], rows: (st.schedules.rs || []).filter(range()), pad: [2.2, 3.5] };
            case 'rs_wards': return { widths: [70, 80], cols: ['الجناح الخاص', 'الجناح العام / طابق 4', 'الجناح العام / طابق 5'], keys: ['ward_private', 'ward_floor4', 'ward_floor5'], rows: (st.schedules.rs || []).filter(range()), pad: [2.2, 3.5] };
            default: return { widths: [70, 80], cols: ER_SHIFTS, keys: ['morning', 'afternoon', 'preNight', 'lateNight'], rows: st.schedules.er || [], pad: [2.2, 3.5] };
        }
    }
    const dmy = s => { const p = String(s || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(s || ''); };
    const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
    const digitsOf = (o, s) => o.digits === 'arabic' ? String(s).replace(/[0-9]/g, d => AR_DIGITS[d]) : String(s);

    /** The sheet's HTML (scoped styles included). */
    function buildSheet(sheet, o) {
        o = o || opts();
        const st = S();
        const spec = sheetSpec(sheet);
        const title = SHEET_TITLES[sheet] || SHEET_TITLES.er;
        const docFont = o.fontFamily || DEFAULT_FONT;
        const tableFont = o.tableFont || docFont;
        const dateFont = o.dateFont === 'same' ? tableFont : 'Arial, sans-serif';
        const k = { compact: 0.55, normal: 1, relaxed: 1.7, airy: 2.4 }[o.density] || 1;
        const pad = (v, side) => `${(v * k).toFixed(2)}px ${(side).toFixed(2)}px`;
        const bw = o.borderWidth, bc = o.borderColor, bs = o.borderStyle === 'dashed' || o.borderStyle === 'dotted' ? o.borderStyle : 'solid';
        const line = `${bw}px ${bs} ${bc}`;
        const vert = o.grid === 'all' ? line : 'none';
        const outer = o.grid === 'minimal' ? 'none' : line;
        const fs = n => `${(n * o.docScale).toFixed(2)}pt`;
        const weekendSet = o.weekendDays === 'none' ? [] : o.weekendDays === 'fri' ? ['الجمعة'] : ['الجمعة', 'السبت'];
        const nameBold = o.nameWeight === 'bold' || (o.nameWeight === 'auto' && spec.bold);

        let rows = '';
        spec.rows.forEach((day, i) => {
            const wk = weekendSet.includes(day.dayName);
            const cls = [wk ? 'wk' : '', !wk && o.zebra && i % 2 === 1 ? 'zb' : ''].filter(Boolean).join(' ');
            rows += `<tr${cls ? ` class="${cls}"` : ''}><td class="b">${esc(day.dayName)}</td><td class="erp-date">${esc(digitsOf(o, dmy(day.date)))}</td>${spec.keys.map(key => `<td class="nm">${esc(day[key] || '')}</td>`).join('')}</tr>`;
        });
        const head = `<tr><th style="width:${spec.widths[0]}px">اليوم</th><th style="width:${spec.widths[1]}px">التاريخ</th>${spec.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;

        const orderDate = digitsOf(o, dmy(st.orderDate || new Date().toISOString().split('T')[0]));
        const blank = '<span style="border-bottom: 1.5px dotted #000; display: inline-block; min-width: 125px; height: 13px; vertical-align: baseline;"></span>';
        const num = st.clearPrintMeta ? blank : `<span>${esc(digitsOf(o, st.orderNumber || ''))}</span>`;
        const date = st.clearPrintMeta ? blank : `<span>${esc(orderDate)}</span>`;
        const headRes = st.headOfResidents || (st.hospitalId === 'iraqi' ? 'د. محمد راضي خضر' : '');
        const headHosp = st.headOfHospital || (st.hospitalId === 'iraqi' ? 'د. علي عبد معن' : '');

        const css = `
            .erp-sheet, .erp-sheet * { font-family: ${docFont} !important; box-sizing: border-box; }
            .erp-sheet { direction: rtl; color: #000; width: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .erp-sheet .erp-table, .erp-sheet .erp-table * { font-family: ${tableFont} !important; }
            .erp-sheet .erp-table td.erp-date { font-family: ${dateFont} !important; font-weight: bold; }
            .erp-sheet .erp-table { width: 100% !important; border-collapse: collapse !important; font-size: ${o.tableSize}pt !important; line-height: 1.15 !important; border: ${outer} !important; }
            .erp-sheet .erp-table th { background: ${o.headerBg} !important; color: ${o.headerText} !important; font-weight: ${o.headerWeight} !important; padding: ${pad(2.5, 3.5)} !important; text-align: center !important;
                border: none !important; border-bottom: ${line} !important; border-left: ${vert} !important; }
            .erp-sheet .erp-table td { background: ${o.bodyBg} !important; color: ${o.bodyText} !important; padding: ${pad(spec.pad[0], spec.pad[1])} !important; text-align: ${o.align === 'right' ? 'right' : 'center'} !important;
                border: none !important; border-bottom: ${line} !important; border-left: ${vert} !important; }
            .erp-sheet .erp-table td.b, .erp-sheet .erp-table td.erp-date { text-align: center !important; }
            .erp-sheet .erp-table th:last-child, .erp-sheet .erp-table td:last-child { border-left: ${o.grid === 'all' ? line : 'none'} !important; }
            .erp-sheet .erp-table td.b { font-weight: bold; }
            .erp-sheet .erp-table td.nm { font-weight: ${nameBold ? 'bold' : 'normal'}; }
            .erp-sheet .erp-table tr.zb td { background: ${o.zebraBg} !important; }
            .erp-sheet .erp-table tr.wk td { background: ${o.weekendBg} !important; color: ${o.weekendText} !important; ${o.weekendBold ? 'font-weight: 700;' : ''} }
            .erp-sheet .erp-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }`;

        return `<style>${css}</style>
            <div class="erp-sheet">
                <div style="text-align: center; line-height: 1.25; margin-bottom: 5px;">
                    <div style="font-size: ${fs(10.5)}; font-weight: bold;">جمهورية العراق</div>
                    <div style="font-size: ${fs(10.5)}; font-weight: bold;">وزارة الصحة</div>
                    <div style="font-size: ${fs(10.5)}; font-weight: bold;">دائرة صحة البصرة</div>
                    <div style="font-size: ${fs(10.5)}; font-weight: bold;">${esc(st.hospitalName)}</div>
                    <div style="font-size: ${fs(10)}; font-weight: bold;">شعبة ادارة الموارد البشرية</div>
                </div>
                <div style="display: flex; justify-content: flex-start; direction: ltr; margin-bottom: 6px; padding-left: 15px;">
                    <div style="direction: rtl; text-align: right; font-size: ${fs(9)}; font-weight: bold; line-height: 1.45;">
                        <div style="display: flex; align-items: baseline; gap: 4px;"><span style="display: inline-block; min-width: 52px; text-align: right;">العدد /</span>${num}</div>
                        <div style="display: flex; align-items: baseline; gap: 4px;"><span style="display: inline-block; min-width: 52px; text-align: right;">التاريخ /</span>${date}</div>
                    </div>
                </div>
                <div style="text-align: center; margin-bottom: 5px;">
                    <div style="font-size: ${fs(11.5)}; font-weight: 900; margin-bottom: 2px;">امر اداري</div>
                    <div style="font-size: ${fs(9)}; font-weight: bold;">تقرر ان يكون جدول خفارات المقيمين الاقدمين ${esc(title)} لشهر <u>${esc(digitsOf(o, st.monthYear || ''))}</u> كما مبين ادناه: -</div>
                </div>
                <table class="erp-table"><thead>${head}</thead><tbody>${rows}</tbody></table>
                <div style="margin-top: 5px; font-size: ${fs(7.5)}; font-weight: bold; line-height: 1.35; text-align: right;">
                    <div>◆ يرجى تبليغ رئيس الاطباء المقيمين في حالة تبديل الخفارة وبخلافه يتحمل الطرفين المسؤولية.</div>
                    <div>◆ في حالة تغيب الطبيب عن الخفارة، يعتبر غياب ويكون التعويض مضاعف.</div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px; font-size: ${fs(8.5)};">
                    <div style="width: 45%; text-align: center;">
                        <div style="height: 52px; min-height: 50px;"></div>
                        <div style="font-weight: bold; font-size: ${fs(9)};">${esc(headRes)}</div>
                        <div style="font-weight: bold; font-size: ${fs(8)}; margin-top: 1px;">رئيس الأطباء المقيمين</div>
                    </div>
                    <div style="width: 45%; text-align: center;">
                        <div style="height: 52px; min-height: 50px;"></div>
                        <div style="font-size: ${fs(7.5)}; font-weight: bold;">الطبيب الاخصائي</div>
                        <div style="font-weight: bold; font-size: ${fs(9)};">${esc(headHosp)}</div>
                        <div style="font-weight: bold; font-size: ${fs(8)}; margin-top: 1px;">مدير ${esc(st.hospitalName || 'المستشفى')}</div>
                    </div>
                </div>
                <div style="margin-top: 6px; font-size: ${fs(7)}; font-weight: bold; line-height: 1.25; text-align: right;">
                    <div>نسخه منه الى: -</div>
                    <div>◆ دائرة صحة البصرة / قسم الامور الإدارية / للعلم مع التقدير</div>
                    <div>◆ دائرة صحة البصرة / قسم التفتيش / للعلم مع التقدير</div>
                    <div>◆ دائرة صحة البصرة / قسم العمليات الطبية والخدمات المتخصصة / للعلم مع التقدير</div>
                    <div>◆ مكتب مدير المستشفى / للعلم مع التقدير</div>
                    <div>◆ رئيس الاطباء المقيمين / شعبة الطوارئ / لوحة الاعلانات – وحدة المتابعة</div>
                    <div>◆ الاوراق مع الاوليات</div>
                </div>
            </div>`;
    }

    /** Fills the print area and prints once the sheet's fonts are ready. */
    async function print(sheet) {
        const area = document.getElementById('official-print-area');
        if (!area) return;
        const o = opts();
        if (/ERF_/.test(o.fontFamily + o.tableFont)) await loadUploaded();
        const fams = [prepareFont(o.fontFamily), prepareFont(o.tableFont || o.fontFamily)];
        if (o.dateFont !== 'same') fams.push('Arial');
        area.innerHTML = buildSheet(sheet, o);
        await fontsReady(fams);
        window.print();
    }

    // ------------------------------------------------------------------------------------------
    // The settings panel
    // ------------------------------------------------------------------------------------------
    let panelSheet = 'er';
    let panelTab = 'theme';
    let fontTarget = 'fontFamily'; // which font the list sets: fontFamily (document) | tableFont
    let fontQuery = '';
    let previewZoom = 'fit';

    const sheetsAvailable = () => S().rsEnabled ? ['er', 'con', 'dc', 'rs_er', 'rs_wards'] : ['er', 'con', 'dc'];

    function open(sheet) {
        const st = S();
        panelSheet = sheet || (st.activeTab === 'rs' ? 'rs_er' : st.activeTab) || 'er';
        if (!sheetsAvailable().includes(panelSheet)) panelSheet = 'er';
        const modal = document.getElementById('print-options-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.documentElement.classList.add('erp-open');
        render();
        loadUploaded().then(() => { render(); });
    }
    function close() {
        const modal = document.getElementById('print-options-modal');
        if (modal) modal.classList.add('hidden');
        document.documentElement.classList.remove('erp-open');
        try { core().saveState(); } catch (e) {}
        try { if (window.updatePrintPreview) window.updatePrintPreview(); } catch (e) {}
    }

    function swatches(t) {
        return `<span class="erp-sw"><i style="background:${t.headerBg}"></i><i style="background:${t.weekendBg}"></i><i style="background:${t.borderColor}"></i></span>`;
    }
    function themeCard(key, t, active, custom) {
        // A tiny table drawn in the theme.
        const ln = `${Math.max(0.5, Math.min(1.5, t.borderWidth))}px solid ${t.borderColor}`;
        const v = t.grid === 'all' ? ln : 'none';
        const cell = (bg, fg) => `<td style="background:${bg};color:${fg};border-bottom:${ln};border-left:${v}"></td>`;
        const row = (bg, fg) => `<tr>${cell(bg, fg)}${cell(bg, fg)}${cell(bg, fg)}</tr>`;
        return `<button type="button" class="erp-theme${active ? ' on' : ''}" data-theme="${esc(key)}"${custom ? ' data-custom="1"' : ''}>
            <table class="erp-mini" style="border:${t.grid === 'minimal' ? 'none' : ln}"><tr><td colspan="3" style="background:${t.headerBg};border-bottom:${ln};height:9px"></td></tr>
                ${row(t.bodyBg || '#fff', t.bodyText || '#000')}${row(t.zebra ? t.zebraBg : (t.bodyBg || '#fff'), '#000')}${row(t.weekendBg, t.weekendText)}${row(t.bodyBg || '#fff', '#000')}</table>
            <span class="erp-theme-name">${esc(t.name)}</span>
            ${t.note ? `<span class="erp-theme-note">${esc(t.note)}</span>` : ''}
            ${custom ? `<span class="erp-theme-del" data-del-theme="${esc(key)}" role="button" title="حذف النمط"><i class="fas fa-trash-can"></i></span>` : ''}
        </button>`;
    }

    function tabTheme(o) {
        const mine = savedThemes();
        return `
            <div class="erp-sec"><h4>أنماط الجدول الجاهزة</h4>
                <div class="erp-themes">${Object.entries(THEMES).map(([k, t]) => themeCard(k, t, o.theme === k)).join('')}</div>
            </div>
            <div class="erp-sec"><h4>أنماطي المحفوظة</h4>
                ${mine.length ? `<div class="erp-themes">${mine.map(t => themeCard(t.id, Object.assign({}, base, t.style, { name: t.name }), o.theme === t.id, true)).join('')}</div>` : '<p class="erp-hint">احفظ تنسيقك الحالي (الألوان والخطوط والجدول) كنمط لتعود إليه بضغطة واحدة. الأنماط المحفوظة مشتركة بين أجهزة الطوارئ.</p>'}
                <div class="erp-row"><input type="text" class="erp-input" id="erp-theme-name" maxlength="40" placeholder="اسم النمط الجديد…"><button type="button" class="erp-btn" data-act="save-theme"><i class="fas fa-bookmark"></i> حفظ كنمط</button></div>
            </div>`;
    }

    function fontItem(css, label, sample, group, extra) {
        const o = opts();
        const cur = fontTarget === 'tableFont' ? (o.tableFont || '') : o.fontFamily;
        const on = cur === css;
        return `<button type="button" class="erp-font${on ? ' on' : ''}" data-font="${esc(css)}">
            <span class="erp-font-sample" style="font-family:${esc(css)}">${esc(sample)}</span>
            <span class="erp-font-meta"><b>${esc(label)}</b><small>${esc(group)}</small></span>
            ${extra || ''}
            ${on ? '<i class="fas fa-circle-check erp-font-check"></i>' : ''}
        </button>`;
    }
    function tabFonts(o) {
        const q = fontQuery.trim().toLowerCase();
        const match = (a, b) => !q || String(a).toLowerCase().includes(q) || String(b).toLowerCase().includes(q);
        const sample = 'جدول خفارات المقيمين ١٢٣';
        let list = '';
        if (fontTarget === 'tableFont') list += `<button type="button" class="erp-font${!o.tableFont ? ' on' : ''}" data-font=""><span class="erp-font-sample">مثل خط الورقة</span><span class="erp-font-meta"><b>نفس خط الورقة</b><small>${esc(fontLabel(o.fontFamily))}</small></span>${!o.tableFont ? '<i class="fas fa-circle-check erp-font-check"></i>' : ''}</button>`;
        const ups = uploaded.filter(f => match(f.name, f.file_name));
        if (ups.length) list += `<div class="erp-font-group">${FONT_GROUPS.uploaded}</div>` + ups.map(f => fontItem(cssOf(upFamily(f.id), 'sans-serif'), f.name, sample, `${f.file_name} · ${Math.round(f.size / 1024)} KB`,
            `<span class="erp-font-del" role="button" data-del-font="${esc(f.id)}" title="حذف الخط من الخادم"><i class="fas fa-trash-can"></i></span>`)).join('');
        const legacy = legacyFont();
        if (legacy && match(legacy.name, '')) list += `<div class="erp-font-group">${FONT_GROUPS.legacy}</div>` + fontItem("'CustomPrintFont', sans-serif", legacy.name, sample, 'محفوظ على هذا الجهاز فقط',
            `<span class="erp-font-up" role="button" data-act="migrate-legacy" title="رفعه للخادم ليبقى ويظهر على كل الأجهزة"><i class="fas fa-cloud-arrow-up"></i></span>`);
        Object.keys(FONT_GROUPS).forEach(g => {
            const items = FONT_LIST.filter(f => f[2] === g && match(f[0], f[1]));
            if (!items.length) return;
            list += `<div class="erp-font-group">${FONT_GROUPS[g]}</div>` + items.map(f => fontItem(cssOf(f[0], f[4]), f[1], sample, f[0])).join('');
        });
        return `
            <div class="erp-sec">
                <div class="erp-seg" role="tablist">
                    <button type="button" class="${fontTarget === 'fontFamily' ? 'on' : ''}" data-font-target="fontFamily">خط الورقة<small>${esc(fontLabel(o.fontFamily))}</small></button>
                    <button type="button" class="${fontTarget === 'tableFont' ? 'on' : ''}" data-font-target="tableFont">خط الجدول<small>${esc(o.tableFont ? fontLabel(o.tableFont) : 'مثل الورقة')}</small></button>
                </div>
            </div>
            <div class="erp-sec erp-upload">
                <div><b><i class="fas fa-cloud-arrow-up"></i> رفع خط جديد</b><small>TTF أو OTF أو WOFF/WOFF2، حتى 1.4 ميغابايت. يُحفظ على الخادم ويبقى لكل أجهزة الطوارئ حتى تحذفه.</small></div>
                <div class="erp-row"><input type="text" class="erp-input" id="erp-font-name" maxlength="60" placeholder="اسم الخط (اختياري)">
                <label class="erp-btn primary"><i class="fas fa-file-arrow-up"></i> اختيار ملف<input type="file" id="erp-font-file" accept=".ttf,.otf,.woff,.woff2" hidden></label></div>
                <div class="erp-progress" id="erp-upload-status" hidden></div>
            </div>
            <div class="erp-sec">
                <div class="erp-search"><i class="fas fa-magnifying-glass"></i><input type="search" id="erp-font-q" placeholder="بحث في الخطوط…" value="${esc(fontQuery)}"></div>
                <div class="erp-fonts" id="erp-font-list">${list || '<p class="erp-hint">لا توجد خطوط مطابقة</p>'}</div>
            </div>`;
    }

    const rangeRow = (label, key, min, max, step, val, unit) => `
        <label class="erp-field"><span>${label}<b class="erp-val">${val}${unit || ''}</b></span>
            <input type="range" data-opt="${key}" data-num="1" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
    const segRow = (label, key, val, items) => `
        <div class="erp-field"><span>${label}</span><div class="erp-seg sm">${items.map(([v, t]) => `<button type="button" class="${String(val) === String(v) ? 'on' : ''}" data-opt="${key}" data-val="${esc(v)}">${t}</button>`).join('')}</div></div>`;
    const toggleRow = (label, key, val, note) => `
        <div class="erp-field erp-toggle-row"><span>${label}${note ? `<small>${note}</small>` : ''}</span>
            <button type="button" class="erp-toggle" role="switch" aria-checked="${val ? 'true' : 'false'}" data-opt="${key}" data-bool="1"><i></i></button></div>`;

    function tabTable(o) {
        return `
            <div class="erp-sec"><h4>الحجم والتباعد</h4>
                ${rangeRow('حجم خط الجدول', 'tableSize', 5, 12, 0.1, o.tableSize, 'pt')}
                ${rangeRow('حجم نصوص الورقة (الترويسة والتواقيع)', 'docScale', 0.8, 1.4, 0.05, o.docScale, '×')}
                ${segRow('تباعد الصفوف', 'density', o.density, [['compact', 'مضغوط'], ['normal', 'عادي'], ['relaxed', 'مريح'], ['airy', 'واسع']])}
            </div>
            <div class="erp-sec"><h4>الخطوط والحدود</h4>
                ${segRow('شكل الشبكة', 'grid', o.grid, [['all', 'شبكة كاملة'], ['rows', 'أفقية + إطار'], ['minimal', 'أفقية فقط']])}
                ${rangeRow('سماكة الخطوط', 'borderWidth', 0, 3, 0.25, o.borderWidth, 'px')}
                ${segRow('نوع الخط', 'borderStyle', o.borderStyle, [['solid', 'متصل'], ['dashed', 'متقطع'], ['dotted', 'منقّط']])}
            </div>
            <div class="erp-sec"><h4>النصوص</h4>
                ${segRow('وزن الترويسة', 'headerWeight', o.headerWeight, [[700, 'عريض'], [800, 'أعرض'], [900, 'أسود'], [400, 'عادي']])}
                ${segRow('أسماء الأطباء', 'nameWeight', o.nameWeight, [['auto', 'تلقائي'], ['normal', 'عادي'], ['bold', 'عريض']])}
                ${segRow('محاذاة الأسماء', 'align', o.align, [['center', 'وسط'], ['right', 'يمين']])}
                ${segRow('الأرقام', 'digits', o.digits, [['latin', '0123'], ['arabic', '٠١٢٣']])}
                ${segRow('خط التاريخ في الجدول', 'dateFont', o.dateFont, [['latin', 'Arial (الأصلي)'], ['same', 'خط الجدول']])}
            </div>
            <div class="erp-sec"><h4>العطل</h4>
                ${segRow('أيام العطلة المميزة', 'weekendDays', o.weekendDays, [['fri_sat', 'الجمعة والسبت'], ['fri', 'الجمعة فقط'], ['none', 'بلا تمييز']])}
                ${toggleRow('صفوف العطلة بخط عريض', 'weekendBold', o.weekendBold)}
            </div>`;
    }

    const colorRow = (label, key, val) => `<label class="erp-color"><span>${label}</span><span class="erp-color-in"><code>${esc(val)}</code><input type="color" data-opt="${key}" value="${esc(val)}"></span></label>`;
    function tabColors(o) {
        return `
            <div class="erp-sec"><h4>الترويسة</h4><div class="erp-colors">${colorRow('خلفية الترويسة', 'headerBg', o.headerBg)}${colorRow('نص الترويسة', 'headerText', o.headerText)}</div></div>
            <div class="erp-sec"><h4>الصفوف</h4><div class="erp-colors">${colorRow('خلفية الصفوف', 'bodyBg', o.bodyBg)}${colorRow('نص الصفوف', 'bodyText', o.bodyText)}${colorRow('خلفية العطلة', 'weekendBg', o.weekendBg)}${colorRow('نص العطلة', 'weekendText', o.weekendText)}</div>
                ${toggleRow('صفوف متناوبة الألوان', 'zebra', o.zebra, 'تلوين صف وترك صف لتسهيل القراءة')}
                ${o.zebra ? `<div class="erp-colors">${colorRow('لون الصف المتناوب', 'zebraBg', o.zebraBg)}</div>` : ''}</div>
            <div class="erp-sec"><h4>الحدود</h4><div class="erp-colors">${colorRow('لون الخطوط والحدود', 'borderColor', o.borderColor)}</div></div>`;
    }

    function tabPaper() {
        const st = S();
        return `
            <div class="erp-sec"><h4>بيانات الأمر الإداري</h4>
                ${toggleRow('تفريغ العدد والتاريخ', 'clearPrintMeta', !!st.clearPrintMeta, 'سطر منقّط بجانب «العدد /» و«التاريخ /» للكتابة بالقلم')}
                <p class="erp-hint">رقم الأمر وتاريخه والتواقيع تُعدّل من بطاقة «بيانات الأمر الإداري» في الصفحة.</p>
            </div>
            <div class="erp-sec"><h4>إعادة الضبط</h4>
                <p class="erp-hint">يعيد كل خيارات الطباعة إلى النموذج الوزاري الأصلي بخط كايرو.</p>
                <button type="button" class="erp-btn danger" data-act="reset"><i class="fas fa-rotate-left"></i> استعادة الإعدادات الأصلية</button>
            </div>`;
    }

    const TABS = [['theme', 'الأنماط', 'fa-swatchbook'], ['fonts', 'الخطوط', 'fa-font'], ['table', 'الجدول', 'fa-table-cells'], ['colors', 'الألوان', 'fa-palette'], ['paper', 'الورقة', 'fa-file-lines']];

    function render() {
        const modal = document.getElementById('print-options-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        const o = opts();
        prepareFont(o.fontFamily);
        if (o.tableFont) prepareFont(o.tableFont);
        const body = { theme: tabTheme, fonts: tabFonts, table: tabTable, colors: tabColors, paper: tabPaper }[panelTab](o);
        const scrollEl = modal.querySelector('.erp-controls-body');
        const keep = scrollEl ? scrollEl.scrollTop : 0;
        const keepFonts = (modal.querySelector('#erp-font-list') || {}).scrollTop || 0;
        modal.innerHTML = `
            <div class="erp-panel" role="dialog" aria-modal="true" aria-label="خيارات الطباعة">
                <header class="erp-head">
                    <div class="erp-title"><span class="erp-ic"><i class="fas fa-print"></i></span><div><h3>خيارات الطباعة الرسمية</h3><p>الخط والنمط والجدول · المعاينة مطابقة للورقة المطبوعة</p></div></div>
                    <button type="button" class="erp-x" data-act="close" aria-label="إغلاق"><i class="fas fa-xmark"></i></button>
                </header>
                <div class="erp-main">
                    <section class="erp-controls">
                        <nav class="erp-tabs">${TABS.map(([k, t, ic]) => `<button type="button" class="${panelTab === k ? 'on' : ''}" data-tab="${k}"><i class="fas ${ic}"></i><span>${t}</span></button>`).join('')}</nav>
                        <div class="erp-controls-body">${body}</div>
                    </section>
                    <section class="erp-preview">
                        <div class="erp-preview-bar">
                            <div class="erp-seg sm">${sheetsAvailable().map(s => `<button type="button" class="${panelSheet === s ? 'on' : ''}" data-sheet="${s}">${SHEET_SHORT[s]}</button>`).join('')}</div>
                            <span class="erp-fit" id="erp-fit"></span>
                        </div>
                        <div class="erp-paper-wrap" id="erp-paper-wrap"><div class="erp-paper-box" id="erp-paper-box"><div class="erp-paper" id="erp-paper"><div class="erp-paper-in">${buildSheet(panelSheet, o)}</div></div></div></div>
                    </section>
                </div>
                <footer class="erp-foot">
                    <span class="erp-foot-note"><i class="fas fa-cloud"></i> تُحفظ الخيارات تلقائياً وتظهر على كل الأجهزة</span>
                    <button type="button" class="erp-btn" data-act="close">إغلاق</button>
                    <button type="button" class="erp-btn primary" data-act="print"><i class="fas fa-print"></i> طباعة ${esc(SHEET_SHORT[panelSheet])}</button>
                </footer>
            </div>`;
        const nb = modal.querySelector('.erp-controls-body');
        if (nb) nb.scrollTop = keep;
        const fl = modal.querySelector('#erp-font-list');
        if (fl) fl.scrollTop = keepFonts;
        fitPreview();
    }

    /** Scales the A4 page to the preview area and says whether the sheet fits on one page. */
    function fitPreview() {
        const wrap = document.getElementById('erp-paper-wrap');
        const paper = document.getElementById('erp-paper');
        if (!wrap || !paper) return;
        const box = document.getElementById('erp-paper-box');
        paper.style.transform = 'none';
        const w = paper.offsetWidth, h = paper.offsetHeight;
        const k = Math.min(1, (wrap.clientWidth - 24) / w);
        paper.style.transform = `scale(${k})`;
        if (box) { box.style.width = Math.floor(w * k) + 'px'; box.style.height = Math.ceil(h * k) + 'px'; }
        const inner = paper.querySelector('.erp-paper-in');
        const pageH = paper.offsetHeight;
        const over = inner && inner.scrollHeight > pageH - 4;
        const fit = document.getElementById('erp-fit');
        if (fit) fit.innerHTML = over ? '<i class="fas fa-triangle-exclamation"></i> أطول من صفحة A4 واحدة: صغّر الخط أو التباعد' : '<i class="fas fa-circle-check"></i> صفحة A4 واحدة';
        if (fit) fit.className = 'erp-fit ' + (over ? 'warn' : 'ok');
        // Fonts arriving later change the size: measure again.
        if (document.fonts && !fitPreview.waiting) { fitPreview.waiting = true; document.fonts.ready.then(() => { fitPreview.waiting = false; requestAnimationFrame(fitPreviewOnly); }); }
    }
    function fitPreviewOnly() { if (document.getElementById('erp-paper')) { fitPreview.waiting = true; fitPreview(); fitPreview.waiting = false; } }

    function refreshPreview() {
        const inner = document.querySelector('#erp-paper .erp-paper-in');
        if (!inner) return render();
        inner.innerHTML = buildSheet(panelSheet, opts());
        fitPreview();
    }

    async function uploadFont(file) {
        const status = document.getElementById('erp-upload-status');
        const say = (html, cls) => { if (status) { status.hidden = false; status.className = 'erp-progress ' + (cls || ''); status.innerHTML = html; } };
        if (!file) return;
        if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { say('<i class="fas fa-triangle-exclamation"></i> الملف ليس خطاً (TTF / OTF / WOFF / WOFF2)', 'err'); return; }
        if (file.size > MAX_FONT) { say(`<i class="fas fa-triangle-exclamation"></i> حجم الخط ${(file.size / 1048576).toFixed(1)} ميغابايت، والحد 1.4 ميغابايت`, 'err'); return; }
        const nameEl = document.getElementById('erp-font-name');
        const name = (nameEl && nameEl.value.trim()) || file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
        say('<i class="fas fa-spinner fa-spin"></i> جارٍ رفع الخط…');
        try {
            const r = await Hub.api('POST', '/api/er-fonts', { name, file: file.name, data: await readBase64(file) }, { retries: 0 });
            uploaded.push(r.font);
            registerUploaded(r.font);
            fontQuery = ''; // the new font must show in the list
            setOpt({ [fontTarget]: cssOf(upFamily(r.font.id), 'sans-serif') }, true);
            notify(`تم رفع الخط «${r.font.name}» وحفظه على الخادم ✓`, 'success');
            render();
        } catch (e) {
            const why = { too_large: 'الحجم أكبر من 1.4 ميغابايت', not_a_font: 'الملف ليس خطاً صالحاً', too_many: 'وصلت الخطوط المرفوعة إلى الحد الأقصى، احذف خطاً أولاً', forbidden: 'الرفع للمالك ومدراء المستشفيات' }[e && e.message] || 'تعذّر الاتصال بالخادم';
            say(`<i class="fas fa-triangle-exclamation"></i> لم يُرفع الخط: ${why}`, 'err');
        }
    }

    async function deleteFont(id) {
        const f = uploaded.find(x => x.id === id);
        if (!f || !confirm(`حذف الخط «${f.name}» من الخادم؟ سيختفي من كل الأجهزة.`)) return;
        try {
            await Hub.api('POST', '/api/er-fonts/delete', { id });
            uploaded = uploaded.filter(x => x.id !== id);
            const o = opts(), css = cssOf(upFamily(id), 'sans-serif'), patch = {};
            if (o.fontFamily === css) patch.fontFamily = DEFAULT_FONT;
            if (o.tableFont === css) patch.tableFont = '';
            if (Object.keys(patch).length) setOpt(patch, true);
            notify('تم حذف الخط', 'info');
            render();
        } catch (e) { notify('تعذّر حذف الخط', 'error'); }
    }

    async function migrateLegacy() {
        const lf = legacyFont();
        if (!lf) return;
        try {
            const fileName = /\.(ttf|otf|woff2?)$/i.test(lf.name) ? lf.name : lf.name + '.ttf';
            const r = await Hub.api('POST', '/api/er-fonts', { name: lf.name.replace(/\.(ttf|otf|woff2?)$/i, ''), file: fileName, data: String(lf.data).split(',')[1] || '' }, { retries: 0 });
            uploaded.push(r.font);
            registerUploaded(r.font);
            const o = opts(), css = cssOf(upFamily(r.font.id), 'sans-serif'), patch = {};
            if (familyOf(o.fontFamily) === 'CustomPrintFont') patch.fontFamily = css;
            if (familyOf(o.tableFont) === 'CustomPrintFont') patch.tableFont = css;
            if (Object.keys(patch).length) setOpt(patch, true);
            try { localStorage.removeItem('emergency_custom_font_data'); localStorage.removeItem('emergency_custom_font_name'); } catch (e) {}
            notify('تم رفع الخط للخادم ✓ صار متاحاً على كل الأجهزة', 'success');
            render();
        } catch (e) { notify('تعذّر رفع الخط: ' + ((e && e.message) || ''), 'error'); }
    }

    function applyTheme(key) {
        const t = THEMES[key] || (savedThemes().find(x => x.id === key) || {}).style;
        if (!t) return;
        const patch = { theme: key };
        STYLE_KEYS.forEach(k => { if (t[k] !== undefined) patch[k] = t[k]; else if (base[k] !== undefined) patch[k] = base[k]; });
        const saved = savedThemes().find(x => x.id === key);
        if (saved) ['fontFamily', 'tableFont', 'tableSize', 'docScale', 'nameWeight', 'weekendBold', 'weekendDays', 'align', 'digits', 'dateFont'].forEach(k => { if (saved.style[k] !== undefined) patch[k] = saved.style[k]; });
        setOpt(patch, true);
        render();
    }
    function saveTheme() {
        const input = document.getElementById('erp-theme-name');
        const name = (input && input.value.trim()) || `نمطي ${savedThemes().length + 1}`;
        const o = opts();
        const style = {};
        STYLE_KEYS.concat(['fontFamily', 'tableFont', 'tableSize', 'docScale', 'nameWeight', 'weekendBold', 'weekendDays', 'align', 'digits', 'dateFont']).forEach(k => { style[k] = o[k]; });
        const id = 'my_' + Date.now().toString(36);
        S().printThemes = savedThemes().concat([{ id, name: name.slice(0, 40), style }]);
        setOpt({ theme: id }, true);
        notify(`تم حفظ النمط «${name}»`, 'success');
        render();
    }
    function deleteTheme(id) {
        const t = savedThemes().find(x => x.id === id);
        if (!t || !confirm(`حذف النمط «${t.name}»؟`)) return;
        S().printThemes = savedThemes().filter(x => x.id !== id);
        if (opts().theme === id) setOpt({ theme: 'custom' }, true); else queueSave();
        render();
    }

    function bind() {
        const modal = document.getElementById('print-options-modal');
        if (!modal || modal.dataset.erpBound) return;
        modal.dataset.erpBound = '1';
        modal.addEventListener('click', e => {
            if (e.target === modal) return close();
            const t = e.target.closest('[data-act],[data-tab],[data-sheet],[data-theme],[data-del-theme],[data-font],[data-del-font],[data-font-target],[data-opt]');
            if (!t || t.tagName === 'INPUT') return;
            if (t.dataset.delTheme) { e.stopPropagation(); return deleteTheme(t.dataset.delTheme); }
            if (t.dataset.delFont) { e.stopPropagation(); return deleteFont(t.dataset.delFont); }
            const act = t.dataset.act;
            if (act === 'close') return close();
            if (act === 'print') { const sheet = panelSheet; close(); return window.prepareOfficialPrint(sheet); }
            if (act === 'save-theme') return saveTheme();
            if (act === 'migrate-legacy') { e.stopPropagation(); return migrateLegacy(); }
            if (act === 'reset') { if (confirm('استعادة إعدادات الطباعة الأصلية؟')) { S().printOptions = Object.assign({}, DEFAULTS); queueSave(); render(); } return; }
            if (t.dataset.tab) { panelTab = t.dataset.tab; return render(); }
            if (t.dataset.sheet) { panelSheet = t.dataset.sheet; return render(); }
            if (t.dataset.theme) return applyTheme(t.dataset.theme);
            if (t.dataset.fontTarget) { fontTarget = t.dataset.fontTarget; return render(); }
            if (t.dataset.font !== undefined) { prepareFont(t.dataset.font || opts().fontFamily); setOpt({ [fontTarget]: t.dataset.font }, true); return render(); }
            if (t.dataset.opt) {
                const key = t.dataset.opt;
                if (key === 'clearPrintMeta') { S().clearPrintMeta = !S().clearPrintMeta; queueSave(); try { window.updateClearPrintMetaUI && window.updateClearPrintMetaUI(); } catch (err) {} return render(); }
                if (t.dataset.bool) { setOpt({ [key]: !opts()[key] }); return render(); }
                if (t.dataset.val !== undefined) { const v = t.dataset.val; setOpt({ [key]: /^\d+$/.test(v) ? Number(v) : v }); return render(); }
            }
        });
        modal.addEventListener('input', e => {
            const t = e.target;
            if (t.id === 'erp-font-q') {
                fontQuery = t.value;
                const pos = t.selectionStart;
                render();
                const n = document.getElementById('erp-font-q');
                if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) {} }
                return;
            }
            if (!t.dataset || !t.dataset.opt) return;
            const key = t.dataset.opt;
            const val = t.dataset.num ? Number(t.value) : t.value;
            setOpt({ [key]: val });
            const lab = t.closest('.erp-field') && t.closest('.erp-field').querySelector('.erp-val');
            if (lab) lab.textContent = val + ({ tableSize: 'pt', docScale: '×', borderWidth: 'px' }[key] || '');
            const code = t.closest('.erp-color') && t.closest('.erp-color').querySelector('code');
            if (code) code.textContent = val;
            refreshPreview();
            modal.querySelectorAll('.erp-theme.on').forEach(x => x.classList.remove('on'));
        });
        modal.addEventListener('change', e => {
            if (e.target.id === 'erp-font-file') { uploadFont(e.target.files && e.target.files[0]); e.target.value = ''; }
        });
        window.addEventListener('resize', () => { if (!modal.classList.contains('hidden')) fitPreview(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    }

    function start() {
        bind();
        // The chosen fonts are ready before the first print.
        const wait = () => {
            if (!core() || !core().ready || !core().ready()) return setTimeout(wait, 400);
            const o = opts();
            if (/^'?ERF_/.test(o.fontFamily) || /^'?ERF_/.test(o.tableFont)) loadUploaded();
            prepareFont(o.fontFamily);
            if (o.tableFont) prepareFont(o.tableFont);
        };
        wait();
    }

    window.ERPrint = { open, close, print, buildSheet, opts, THEMES, FONT_LIST, DEFAULTS };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
