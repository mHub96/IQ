/**
 * The ER page's duty structure, per hospital (window.ERLayout).
 *
 * A hospital's structure (state.erStructures[hospitalId], edited in emergency-structure.js):
 *   sectors: [{ id, name }]                         e.g. طوارئ الرجال, طوارئ النساء, طوارئ الأطفال
 *   shifts:  { morning|afternoon|preNight|lateNight: [{ sector, divisions: [{ name, branch, count }] }] }
 *            a division without a name is the sector itself; branch '' | 'surgical' | 'medical'
 *            (who the generator prefers there); count = residents in it at the same time
 *   con:     [{ start, end }]  the consultation clinic's duties of a day ('HH:MM'; gaps allowed)
 *   dc:      [{ start, end }]  the death-certificate duties of a day (together exactly 24 hours)
 *   code:    the hospital's short name on file names (BTH, ITH…); default: its English initials
 * No sectors = one resident per shift; one (or no) con / dc duty = one resident a day: the classic
 * layout every hospital had before structures existed.
 *
 * Each month keeps the layout it was built with (state.schedules.layout, a flat list of positions),
 * so changing a structure never reshapes a month that has duties in it. A month without a layout is
 * classic. A position's key is the shift itself for the first resident of a shift ('morning'; the
 * classic key) and 'morning.1', 'morning.2'… for the others; 'doctor', 'doctor.1'… for con / dc.
 * The strike's ER sheet uses the ER positions with 'er_' in front of the key.
 */
(function (window) {
    'use strict';

    const SHIFTS = ['morning', 'afternoon', 'preNight', 'lateNight'];
    const SHIFT_INFO = {
        morning: { name: 'الصباحية', time: '8ص - 2م', start: 8, hours: 6, icon: 'fa-sun', color: 'text-amber-500' },
        afternoon: { name: 'بعد الصباحية', time: '2م - 8م', start: 14, hours: 6, icon: 'fa-cloud-sun', color: 'text-orange-500' },
        preNight: { name: 'البرينايت', time: '8م - 2ص', start: 20, hours: 6, icon: 'fa-moon', color: 'text-indigo-500' },
        lateNight: { name: 'الليلية', time: '2ص - 8ص', start: 2, hours: 6, icon: 'fa-star-and-crescent', color: 'text-purple-500' },
    };
    const BRANCHES = { surgical: 'الفروع الجراحية', medical: 'الفروع الباطنية' };
    const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const core = () => window.EmergencyCore;
    const S = () => core().state();

    // ------------------------------------------------------------------------------------------
    // Times
    // ------------------------------------------------------------------------------------------
    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const toMin = t => { const m = TIME_RE.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    /** '16:00' -> '4م', '07:30' -> '7:30ص', '00:00' -> '12ص' */
    function timeAr(t) {
        const m = toMin(t);
        if (m === null) return '';
        const h = Math.floor(m / 60), mm = m % 60;
        return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'ص' : 'م'}`;
    }
    const rangeAr = p => (p && p.start && p.end ? `${timeAr(p.start)} - ${timeAr(p.end)}` : '');
    /** Minutes a duty lasts (end before start = past midnight; equal = 24 hours). */
    const spanMin = p => { const a = toMin(p.start), b = toMin(p.end); if (a === null || b === null) return 0; return ((b - a + 1440) % 1440) || 1440; };

    /**
     * Problems with a list of daily duties: overlapping ones (both lists), and for death certificates
     * anything but exactly 24 hours without gaps. Returns Arabic messages ([] = fine).
     */
    function checkTimes(list, mustCover) {
        const out = [];
        if (!list || list.length <= 1) {
            if (list && list.length === 1 && mustCover && spanMin(list[0]) !== 1440) out.push('خفارة واحدة يجب أن تغطي 24 ساعة (البداية = النهاية).');
            return out;
        }
        for (const p of list) if (toMin(p.start) === null || toMin(p.end) === null) { out.push('أكمل وقت البداية والنهاية لكل خفارة.'); return out; }
        // Each duty as a set of minutes on the day's clock.
        const used = new Array(1440).fill(-1);
        list.forEach((p, i) => {
            const a = toMin(p.start), n = spanMin(p);
            for (let k = 0; k < n; k++) {
                const m = (a + k) % 1440;
                if (used[m] !== -1 && used[m] !== i && !out.length) out.push(`الخفارة ${used[m] + 1} والخفارة ${i + 1} متداخلتان في الوقت.`);
                used[m] = i;
            }
        });
        if (mustCover && !out.length && used.some(x => x === -1)) out.push('خفارات شهادات الوفاة يجب أن تغطي اليوم كله (24 ساعة) بلا فجوات.');
        return out;
    }

    // ------------------------------------------------------------------------------------------
    // Structures and month layouts
    // ------------------------------------------------------------------------------------------
    const CLASSIC = { sectors: [], shifts: {}, con: [], dc: [] };
    const clone = o => JSON.parse(JSON.stringify(o));

    function hospitalId() { return S().hospitalId; }
    function structureOf(hospId) {
        const all = S().erStructures || {};
        const s = all[hospId || hospitalId()];
        return s && typeof s === 'object' ? s : CLASSIC;
    }
    function setStructure(hospId, struct) {
        const st = S();
        if (!st.erStructures) st.erStructures = {};
        st.erStructures[hospId || hospitalId()] = clone(struct);
    }

    /** The flat positions of a structure (what a month keeps). */
    function layoutFrom(struct) {
        struct = struct || CLASSIC;
        const sectors = Array.isArray(struct.sectors) ? struct.sectors : [];
        const er = [];
        SHIFTS.forEach(shift => {
            const entries = sectors.length ? ((struct.shifts || {})[shift] || []) : [];
            const list = [];
            sectors.forEach(sec => {
                const entry = entries.find(e => e && e.sector === sec.id);
                if (!entry) return;
                const divs = Array.isArray(entry.divisions) && entry.divisions.length ? entry.divisions : [{ name: '', branch: '', count: 1 }];
                divs.forEach(div => {
                    const count = Math.max(1, Math.min(6, Number(div.count) || 1));
                    for (let n = 1; n <= count; n++) {
                        list.push({ shift, sector: sec.name || '', sectorId: sec.id, division: div.name || '', branch: div.branch || '', n, of: count });
                    }
                });
            });
            if (!list.length) list.push({ shift, sector: '', sectorId: '', division: '', branch: '', n: 1, of: 1 });
            list.forEach((p, i) => er.push({ key: i === 0 ? shift : `${shift}.${i}`, ...p }));
        });
        const timed = list => {
            const l = Array.isArray(list) ? list.filter(p => p && toMin(p.start) !== null && toMin(p.end) !== null) : [];
            if (l.length <= 1) return [{ key: 'doctor', start: l[0] ? l[0].start : '', end: l[0] ? l[0].end : '' }];
            return l.map((p, i) => ({ key: i === 0 ? 'doctor' : `doctor.${i}`, start: p.start, end: p.end }));
        };
        return { v: 1, er, con: timed(struct.con), dc: timed(struct.dc) };
    }
    const CLASSIC_LAYOUT = layoutFrom(CLASSIC);
    const isClassic = layout => layout.er.length === 4 && layout.con.length === 1 && layout.dc.length === 1 && !layout.er.some(p => p.sector);

    /** The layout of the month on screen. */
    function monthLayout() {
        const sch = S().schedules || {};
        const l = sch.layout;
        return l && Array.isArray(l.er) && l.er.length ? l : CLASSIC_LAYOUT;
    }

    /** Positions of a sheet: 'er' | 'rs_er' | 'con' | 'dc' | 'rs_wards'. */
    function positions(type, layout) {
        layout = layout || monthLayout();
        if (type === 'er') return layout.er;
        if (type === 'rs_er') return layout.er.map(p => ({ ...p, key: 'er_' + p.key }));
        if (type === 'con' || type === 'dc') return layout[type];
        if (type === 'rs_wards') return [{ key: 'ward_private', label: 'الجناح الخاص' }, { key: 'ward_floor4', label: 'الجناح العام / طابق 4' }, { key: 'ward_floor5', label: 'الجناح العام / طابق 5' }];
        return [];
    }
    const keys = (type, layout) => positions(type, layout).map(p => p.key);
    /** Every key of a schedule ('rs' = both strike sheets). */
    const allKeys = (sched, layout) => sched === 'rs' ? keys('rs_er', layout).concat(keys('rs_wards', layout)) : keys(sched, layout);
    function position(type, key, layout) {
        return positions(type, layout).find(p => p.key === key) || null;
    }
    /** 'afternoon.2' / 'er_afternoon.2' -> 'afternoon' */
    function shiftOf(key) {
        const k = String(key || '').replace(/^er_/, '').split('.')[0];
        return SHIFTS.includes(k) ? k : null;
    }
    const positionsOfShift = (type, shift, layout) => positions(type, layout).filter(p => shiftOf(p.key) === shift);
    const perDay = (type, layout) => positions(type, layout).length;

    /** "طوارئ النساء · الخضراء 2" (the place within the shift; '' in the classic layout). */
    function placeLabel(p) {
        if (!p) return '';
        return [p.sector, p.division, p.of > 1 ? String(p.n) : ''].filter(Boolean).join(' · ');
    }
    /** A position's full name: "الصباحية (8ص - 2م) · طوارئ النساء", "الاستشارية 4م - 7م"… */
    function label(type, key, layout) {
        const src = type === 'rs' ? (String(key).startsWith('ward_') ? 'rs_wards' : 'rs_er') : type;
        const p = position(src, key, layout);
        if (src === 'er' || src === 'rs_er') {
            const sh = SHIFT_INFO[shiftOf(key)];
            if (!sh) return key;
            const place = placeLabel(p);
            return `${sh.name} (${sh.time})${place ? ' · ' + place : ''}`;
        }
        if (src === 'con' || src === 'dc') {
            const many = positions(src, layout).length > 1;
            return many && p ? rangeAr(p) : '';
        }
        return p ? p.label : key;
    }

    // ------------------------------------------------------------------------------------------
    // Month set-up
    // ------------------------------------------------------------------------------------------
    /**
     * Called whenever a month is (re)built: a month without duties takes the hospital's current
     * structure; a month with duties keeps the layout it has (none = classic).
     */
    function ensureMonthLayout() {
        const st = S();
        const sch = st.schedules || (st.schedules = {});
        if (sch.layout && Array.isArray(sch.layout.er) && sch.layout.er.length) return;
        const filled = ['er', 'con', 'dc', 'rs'].some(t => (sch[t] || []).some(d => d && Object.keys(d).some(k => !['dayNumber', 'date', 'dayName', 'notes'].includes(k) && d[k] && String(d[k]).trim())));
        if (filled) return;
        const layout = layoutFrom(structureOf());
        if (!isClassic(layout)) sch.layout = layout;
    }

    /**
     * Gives the month on screen the hospital's current structure. Names stay where the same key still
     * exists; returns the names that had to go (for the confirmation).
     */
    function applyToMonth(dryRun) {
        const st = S();
        const sch = st.schedules || {};
        const next = layoutFrom(structureOf());
        const keep = {
            er: new Set(keys('er', next)), con: new Set(keys('con', next)), dc: new Set(keys('dc', next)),
            rs: new Set(allKeys('rs', next)),
        };
        const lost = [];
        ['er', 'con', 'dc', 'rs'].forEach(t => (sch[t] || []).forEach(d => {
            Object.keys(d).forEach(k => {
                if (['dayNumber', 'date', 'dayName', 'notes'].includes(k) || keep[t].has(k)) return;
                if (d[k] && String(d[k]).trim()) lost.push({ type: t, day: d.dayNumber, key: k, name: d[k] });
                if (!dryRun) delete d[k];
            });
        }));
        if (!dryRun) {
            if (isClassic(next)) delete sch.layout; else sch.layout = next;
            if (st.prefOverrides) Object.keys(st.prefOverrides).forEach(id => { const k = id.split('_').slice(2).join('_'); if (k && !keep.er.has(k) && !keep.rs.has(k)) delete st.prefOverrides[id]; });
        }
        return lost;
    }

    // ------------------------------------------------------------------------------------------
    // Names
    // ------------------------------------------------------------------------------------------
    /** BTH for "Basra Teaching Hospital" (the structure's own code first). */
    function hospitalCode(hospId, ignoreOwn) {
        const id = hospId || hospitalId();
        const own = ignoreOwn ? '' : String((structureOf(id) || {}).code || '').trim();
        if (own) return own;
        const h = window.Hub && window.Hub.getHospital ? window.Hub.getHospital(id) : null;
        const en = String((h && h.hospitalName) || '').replace(/[^A-Za-z\s-]/g, ' ').split(/[\s-]+/).filter(w => w && !/^(of|the|and|al|el)$/i.test(w));
        return en.length ? en.map(w => w[0].toUpperCase()).join('') : String(id || 'ER').toUpperCase();
    }
    const SHEET_NAMES = { er: 'ER', con: 'Consultation Clinic', dc: 'Death Certificates', rs_er: 'RS ER', rs_wards: 'RS Wards', all: 'ER Schedules' };
    /** The hospital's English name ("Iraqi Teaching Hospital"); its Arabic name or id when it has none. */
    function hospitalFileName(hospId) {
        const id = hospId || hospitalId();
        const h = window.Hub && window.Hub.getHospital ? window.Hub.getHospital(id) : null;
        const en = String((h && h.hospitalName) || '').replace(/\s+/g, ' ').trim();
        return en || String((h && h.name_ar) || id || 'Hospital').trim();
    }
    /**
     * "Iraqi Teaching Hospital Death Certificates Nov.26": the name of every file of a table (print,
     * CSV, Excel), set by the user on 2026-10-31. sheet: er | con | dc | rs_er | rs_wards | all.
     */
    function fileName(sheet, year, month) {
        const st = S();
        const y = Number(year || st.year), m = Number(month || st.month) || 1;
        return `${hospitalFileName()} ${SHEET_NAMES[sheet] || 'ER'} ${MONTHS_EN[m - 1]}.${String(y % 100).padStart(2, '0')}`
            .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /** Surgical / medical branch of a resident of the ER list ('' when unknown). */
    function residentBranch(r) {
        if (!r) return '';
        if (r.branch === 'surgical' || r.branch === 'medical') return r.branch;
        const spec = r.specialty || r.spec || '';
        return window.Hub && window.Hub.getSpecialtyBranch ? window.Hub.getSpecialtyBranch(spec) : '';
    }

    window.ERLayout = {
        SHIFTS, SHIFT_INFO, BRANCHES, CLASSIC, CLASSIC_LAYOUT,
        toMin, timeAr, rangeAr, spanMin, checkTimes,
        structureOf, setStructure, layoutFrom, isClassic, monthLayout,
        positions, keys, allKeys, position, shiftOf, positionsOfShift, perDay, placeLabel, label,
        ensureMonthLayout, applyToMonth, hospitalCode, hospitalFileName, fileName, residentBranch,
    };
})(window);
