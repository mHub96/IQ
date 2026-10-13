/**
 * Cartoon avatars drawn as inline SVG (no image files). An avatar is a small object of option
 * indexes, e.g. { s: 2, h: 3, hc: 1, ... }, saved with the account (a few dozen bytes).
 * HubAvatar.svg(config, size) returns the markup; HubAvatar.forAccount(acc) falls back to a stable
 * default figure for accounts that never chose one.
 */
(function (window) {
    'use strict';

    // ------------------------------------------------------------------
    // Palettes
    // ------------------------------------------------------------------
    const SKIN = ['#FCE0CF', '#F6D0B1', '#E8B48F', '#D29B6C', '#B57A50', '#8D5A3A', '#5E3A26'];
    const HAIR_COLOR = ['#1B1B1F', '#3B2417', '#5E3B24', '#8A5A33', '#C79A55', '#E8C77A', '#A8432E', '#9A9A9F', '#E9E9EC', '#4B5D9B'];
    const EYE_COLOR = ['#3B2417', '#1B1B1F', '#7A5A2E', '#4E7A3A', '#3D6FB2', '#6E7F8F', '#2F8F8A'];
    const CLOTH_COLOR = ['#0F766E', '#1D4ED8', '#334155', '#7C3AED', '#BE185D', '#0E7490', '#B45309', '#15803D'];
    const HAT_COLOR = ['#1F2937', '#0F766E', '#1D4ED8', '#BE123C', '#F5F5F4', '#6D28D9', '#B45309', '#0E7490'];
    const BG = ['#CCFBF1', '#DBEAFE', '#FCE7F3', '#FEF3C7', '#E0E7FF', '#DCFCE7', '#FFE4E6', '#E2E8F0'];

    const shade = (hex, amt) => {
        const n = parseInt(hex.slice(1), 16);
        const c = v => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
        return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c).map(v => v.toString(16).padStart(2, '0')).join('');
    };

    // ------------------------------------------------------------------
    // Parts (viewBox 0 0 100 100; face centred at 50,46)
    // ------------------------------------------------------------------
    const HAIR = [
        { name: 'أصلع' },
        { name: 'قصير', front: 'M27 42C27 21 39 15 50 15C62 15 74 21 73 42C68 31 59 26 50 26C41 26 32 31 27 42Z' },
        { name: 'قصير جداً', front: 'M28 40C28 23 39 17 50 17C61 17 72 23 72 40C67 31 59 28 50 28C41 28 33 31 28 40Z', op: 0.55 },
        { name: 'فرق جانبي', front: 'M26 44C25 21 39 14 52 14C65 14 75 22 74 41C70 32 63 27 57 27C51 33 39 35 26 44Z' },
        { name: 'مموج', front: 'M27 42C24 33 28 22 35 19C38 13 46 12 50 15C55 11 63 13 66 19C73 21 77 31 73 42C69 33 64 30 59 31C55 27 45 27 41 31C36 30 30 34 27 42Z' },
        { name: 'مرفوع', front: 'M27 40L29 24L35 29L39 16L45 26L50 12L55 25L61 15L65 28L71 22L73 40C66 31 34 31 27 40Z' },
        { name: 'كيرلي', curls: true },
        { name: 'أفرو', back: 'M50 6C72 6 84 20 82 40C82 54 76 60 72 60L28 60C24 60 18 54 18 40C16 20 28 6 50 6Z', front: 'M26 42C26 26 36 19 50 19C64 19 74 26 74 42C70 34 62 30 50 30C38 30 30 34 26 42Z' },
        { name: 'طويل', back: 'M25 40C25 19 37 12 50 12C63 12 75 19 75 40L77 80C71 83 64 81 62 76L38 76C36 81 29 83 23 80Z', front: 'M27 44C27 25 39 18 50 18C61 18 73 25 73 44C66 33 57 26 47 28C40 30 33 36 27 44Z' },
        { name: 'بوب', back: 'M24 42C24 19 37 12 50 12C63 12 76 19 76 42L76 64C70 66 66 62 66 58L34 58C34 62 30 66 24 64Z', front: 'M27 44C27 25 39 18 50 18C61 18 73 25 73 44C70 34 62 27 50 27C38 27 30 34 27 44Z' },
        { name: 'ذيل حصان', back: 'M70 30C84 34 86 52 80 66C77 72 72 70 73 64C76 52 74 42 68 36Z', front: 'M27 42C27 22 39 15 50 15C62 15 74 22 73 42C68 30 59 25 50 25C41 25 32 30 27 42Z' },
        { name: 'كعكة', bun: true, front: 'M27 42C27 22 39 15 50 15C62 15 74 22 73 42C68 30 59 25 50 25C41 25 32 30 27 42Z' },
        { name: 'طويل مموج', back: 'M24 40C22 18 37 11 50 11C63 11 78 18 76 40C80 50 76 58 80 66C76 76 66 78 62 74L38 74C34 78 24 76 20 66C24 58 20 50 24 40Z', front: 'M27 44C26 26 38 18 50 18C62 18 74 26 73 44C68 36 62 30 55 30C51 34 44 33 40 31C34 33 30 38 27 44Z' },
    ];
    const EYES = ['عادية', 'واسعة', 'مبتسمة', 'ناعسة', 'غمزة', 'لوزية'];
    const BROWS = ['عادية', 'كثيفة', 'مقوسة', 'مستقيمة', 'مرفوعة', 'رفيعة'];
    const MOUSTACHE = ['بدون', 'كلاسيكي', 'كثيف', 'معقوف', 'رفيع'];
    const BEARD = ['بدون', 'خفيفة', 'قصيرة', 'كاملة', 'سكسوكة', 'عارضين'];
    const NOSE = ['صغير', 'دائري', 'مدبب', 'عريض'];
    const MOUTH = ['ابتسامة', 'ضحكة', 'محايد', 'قهقهة', 'ابتسامة جانبية'];
    const GLASSES = ['بدون', 'دائرية', 'مستطيلة', 'شمسية', 'نصف إطار'];
    const HATS = ['بدون', 'كاب', 'قبعة صوف', 'غطاء عمليات', 'حجاب', 'يشماغ'];
    const CLOTHES = ['سكراب', 'صدرية بيضاء', 'قميص'];

    // Picker definition: [key, label, options or count, colour key, colour palette, male only]
    const PARTS = [
        { key: 's', label: 'البشرة', colors: SKIN },
        { key: 'h', label: 'الشعر', options: HAIR.map(x => x.name), color: 'hc', palette: HAIR_COLOR },
        { key: 'e', label: 'العيون', options: EYES, color: 'ec', palette: EYE_COLOR },
        { key: 'b', label: 'الحواجب', options: BROWS, color: 'bc', palette: HAIR_COLOR },
        { key: 'm', label: 'الشارب', options: MOUSTACHE, color: 'mc', palette: HAIR_COLOR, male: true },
        { key: 'd', label: 'اللحية', options: BEARD, color: 'dc', palette: HAIR_COLOR, male: true },
        { key: 'n', label: 'الأنف', options: NOSE },
        { key: 'o', label: 'الفم', options: MOUTH },
        { key: 'g', label: 'النظارات', options: GLASSES },
        { key: 't', label: 'غطاء الرأس', options: HATS, color: 'tc', palette: HAT_COLOR },
        { key: 'c', label: 'الملابس', options: CLOTHES, color: 'cc', palette: CLOTH_COLOR },
        { key: 'k', label: 'الخلفية', colors: BG },
    ];
    const LIMITS = {
        s: SKIN.length, h: HAIR.length, hc: HAIR_COLOR.length, e: EYES.length, ec: EYE_COLOR.length, b: BROWS.length, bc: HAIR_COLOR.length,
        m: MOUSTACHE.length, mc: HAIR_COLOR.length, d: BEARD.length, dc: HAIR_COLOR.length, n: NOSE.length, o: MOUTH.length,
        g: GLASSES.length, t: HATS.length, tc: HAT_COLOR.length, c: CLOTHES.length, cc: CLOTH_COLOR.length, k: BG.length,
    };

    /** Keeps only known keys with in-range integer values. */
    function clean(cfg, sex) {
        const out = {};
        for (const [k, n] of Object.entries(LIMITS)) {
            const v = Math.floor(Number(cfg && cfg[k]));
            out[k] = Number.isFinite(v) && v >= 0 && v < n ? v : 0;
        }
        if (sex === 'f') { out.m = 0; out.d = 0; }
        return out;
    }

    function hashCode(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    /** A stable default figure for an account that never designed one. */
    function defaultFor(seed, sex) {
        let h = hashCode(String(seed || 'x'));
        const next = n => { const v = h % n; h = Math.floor(h / n) ^ (h << 7 >>> 0); h >>>= 0; return v; };
        const female = sex === 'f';
        const femaleHair = [8, 9, 10, 11, 12];
        const maleHair = [1, 2, 3, 4, 5];
        return clean({
            s: next(5) + 1, h: female ? femaleHair[next(5)] : maleHair[next(5)], hc: next(4), e: next(2), ec: next(3),
            b: female ? 2 : next(2), bc: 0, m: 0, mc: 0, d: female ? 0 : [0, 1, 2][next(3)], dc: 0, n: next(2), o: next(2),
            g: next(5) === 0 ? 1 : 0, t: female && next(3) === 0 ? 4 : 0, tc: next(8), c: next(2), cc: next(8), k: next(8),
        }, sex);
    }

    // ------------------------------------------------------------------
    // Drawing
    // ------------------------------------------------------------------
    function eyes(type, color, skin) {
        const one = (cx, kind) => {
            if (kind === 'closed') return `<path d="M${cx - 4} 46Q${cx} 42 ${cx + 4} 46" stroke="#1B1B1F" stroke-width="2" fill="none" stroke-linecap="round"/>`;
            const rx = kind === 'wide' ? 4.6 : kind === 'almond' ? 4.6 : 4;
            const ry = kind === 'wide' ? 4.6 : kind === 'almond' ? 2.6 : 3.4;
            const pr = kind === 'wide' ? 2.6 : 2.1;
            let lid = '';
            if (kind === 'sleepy') lid = `<path d="M${cx - 4.6} 45.2H${cx + 4.6}" stroke="#1B1B1F" stroke-width="1.6" stroke-linecap="round"/><path d="M${cx - 4.4} 45.2Q${cx} 41.6 ${cx + 4.4} 45.2Z" fill="${skin}"/>`;
            return `<ellipse cx="${cx}" cy="46" rx="${rx}" ry="${ry}" fill="#fff"/><circle cx="${cx}" cy="46.3" r="${pr}" fill="${color}"/><circle cx="${cx}" cy="46.3" r="${pr * 0.45}" fill="#0b0b0d"/><circle cx="${cx + 0.9}" cy="45.3" r="0.7" fill="#fff"/>${lid}`;
        };
        const map = { 0: ['n', 'n'], 1: ['wide', 'wide'], 2: ['closed', 'closed'], 3: ['sleepy', 'sleepy'], 4: ['n', 'closed'], 5: ['almond', 'almond'] }[type] || ['n', 'n'];
        return one(41, map[0]) + one(59, map[1]);
    }

    function brows(type, color) {
        const w = { 0: 2.2, 1: 3.4, 2: 2.2, 3: 2.6, 4: 2.4, 5: 1.4 }[type] || 2.2;
        const paths = {
            0: ['M36 39Q41 36 46 38', 'M54 38Q59 36 64 39'],
            1: ['M35 39Q41 35 47 38', 'M53 38Q59 35 65 39'],
            2: ['M36 40Q40 34 46 37', 'M54 37Q60 34 64 40'],
            3: ['M36 38.5L46 38', 'M54 38L64 38.5'],
            4: ['M36 38Q41 33 46 36', 'M54 38.5Q59 36.5 64 39'],
            5: ['M36 39Q41 36.5 46 38', 'M54 38Q59 36.5 64 39'],
        }[type] || [];
        return paths.map(d => `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`).join('');
    }

    function nose(type, skin) {
        const c = shade(skin, -0.28);
        return ({
            0: `<path d="M50 49Q48.5 53 50.5 54" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
            1: `<ellipse cx="50" cy="53" rx="3.2" ry="2.4" fill="${c}" opacity=".45"/>`,
            2: `<path d="M50 47L47.5 54L51 54" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
            3: `<path d="M46 53Q50 56 54 53" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="47" cy="52.6" r="1" fill="${c}"/><circle cx="53" cy="52.6" r="1" fill="${c}"/>`,
        })[type] || '';
    }

    function mouth(type) {
        return ({
            0: '<path d="M44 59Q50 64 56 59" stroke="#7A2E2E" stroke-width="2" fill="none" stroke-linecap="round"/>',
            1: '<path d="M43 58Q50 66 57 58Z" fill="#7A2E2E"/><path d="M44.4 58.6L55.6 58.6L54.6 60.4L45.4 60.4Z" fill="#fff"/>',
            2: '<path d="M45 60.5H55" stroke="#7A2E2E" stroke-width="2" stroke-linecap="round"/>',
            3: '<path d="M42.5 57.5Q50 69 57.5 57.5Z" fill="#7A2E2E"/><path d="M45 62.5Q50 66 55 62.5Q50 64 45 62.5Z" fill="#E86A6A"/>',
            4: '<path d="M45 60Q51 62.5 56 57.5" stroke="#7A2E2E" stroke-width="2" fill="none" stroke-linecap="round"/>',
        })[type] || '';
    }

    function moustache(type, color) {
        return ({
            1: `<path d="M42 57.5Q46 54 50 56Q54 54 58 57.5Q54 57.4 50 57.6Q46 57.4 42 57.5Z" fill="${color}"/>`,
            2: `<path d="M40 58.5Q45 52.5 50 55Q55 52.5 60 58.5Q55 58.2 50 58.2Q45 58.2 40 58.5Z" fill="${color}"/>`,
            3: `<path d="M42 57Q46 54 50 56Q54 54 58 57Q61 57 62 54Q63 59 58 58.6Q54 57.6 50 57.8Q46 57.6 42 58.6Q37 59 38 54Q39 57 42 57Z" fill="${color}"/>`,
            4: `<path d="M43.5 56.8Q50 55.4 56.5 56.8" stroke="${color}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
        })[type] || '';
    }

    function beard(type, color) {
        return ({
            1: `<path d="M28 46C28 64 38 73 50 73C62 73 72 64 72 46C69 58 60 63 50 63C40 63 31 58 28 46Z" fill="${color}" opacity=".32"/>`,
            2: `<path d="M28 46C28 65 38 74 50 74C62 74 72 65 72 46C70 56 63 60 57 60Q50 57 43 60C37 60 30 56 28 46Z" fill="${color}"/>`,
            3: `<path d="M27 44C26 68 38 80 50 80C62 80 74 68 73 44C71 56 64 60 57 60Q50 57 43 60C36 60 29 56 27 44Z" fill="${color}"/>`,
            4: `<path d="M44 63Q50 61 56 63Q56 72 50 73Q44 72 44 63Z" fill="${color}"/>`,
            5: `<path d="M28 44C28 64 38 73 50 73C62 73 72 64 72 44C71 56 64 66 50 67C36 66 29 56 28 44Z" fill="${color}"/>`,
        })[type] || '';
    }

    function glasses(type) {
        return ({
            1: '<g fill="none" stroke="#1F2937" stroke-width="1.6"><circle cx="41" cy="46" r="6.2"/><circle cx="59" cy="46" r="6.2"/><path d="M47.2 46H52.8M34.8 45L28 43M65.2 45L72 43"/></g>',
            2: '<g fill="none" stroke="#1F2937" stroke-width="1.6"><rect x="34" y="41" width="13.5" height="9.5" rx="2"/><rect x="52.5" y="41" width="13.5" height="9.5" rx="2"/><path d="M47.5 45.5H52.5M34 44.5L28 43M66 44.5L72 43"/></g>',
            3: '<g><path d="M33 41H47.5V47Q47 52 41 52Q34 52 33 47Z" fill="#111827"/><path d="M52.5 41H67V47Q66 52 59 52Q53 52 52.5 47Z" fill="#111827"/><path d="M47.5 43H52.5M33 42L28 41M67 42L72 41" stroke="#111827" stroke-width="1.6" fill="none"/></g>',
            4: '<g fill="none" stroke="#1F2937" stroke-width="1.8"><path d="M34 42.5H47.5M52.5 42.5H66M47.5 43.5H52.5M34 42.5L28 41.5M66 42.5L72 41.5"/><path d="M34.5 43Q35 50 41 50Q47 50 47.4 43M52.6 43Q53 50 59 50Q65 50 65.5 43" stroke-width="1" opacity=".7"/></g>',
        })[type] || '';
    }

    function hat(type, color) {
        const dark = shade(color, -0.25);
        return ({
            1: `<path d="M26 34C26 18 38 12 50 12C62 12 74 18 74 34Z" fill="${color}"/><path d="M50 12V34" stroke="${dark}" stroke-width="1"/><path d="M24 34H86Q84 39 74 38H24Z" fill="${dark}"/><circle cx="50" cy="12.5" r="2" fill="${dark}"/>`,
            2: `<path d="M25 36C25 15 38 9 50 9C62 9 75 15 75 36Z" fill="${color}"/><rect x="23.5" y="31" width="53" height="9" rx="4" fill="${dark}"/><circle cx="50" cy="8" r="4.5" fill="${dark}"/>`,
            3: `<path d="M24 38C21 20 34 10 50 10C66 10 79 20 76 38C72 33 62 31 50 31C38 31 28 33 24 38Z" fill="${color}"/><path d="M30 26Q50 20 70 26" stroke="${dark}" stroke-width="1" fill="none" opacity=".6"/>`,
            5: `<path d="M22 44C20 20 35 10 50 10C65 10 80 20 78 44L82 84C70 88 62 80 60 74C66 66 70 56 70 44C66 32 58 28 50 28C42 28 34 32 30 44C30 56 34 66 40 74C38 80 30 88 18 84Z" fill="#F5F5F4"/>
                <path d="M22 44C20 20 35 10 50 10C65 10 80 20 78 44" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 3"/>
                <path d="M30 30Q50 20 70 30" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="2.5 2.5"/>
                <ellipse cx="50" cy="14" rx="20" ry="4" fill="#111827"/>`,
        })[type] || '';
    }

    function hijab(color) {
        const dark = shade(color, -0.2);
        return {
            back: `<path d="M20 48C18 22 34 9 50 9C66 9 82 22 80 48C82 64 80 78 72 88L28 88C20 78 18 64 20 48Z" fill="${color}"/>`,
            front: `<path d="M20 48C18 22 34 9 50 9C66 9 82 22 80 48C80 60 76 70 70 76C76 66 76 56 73 44C70 30 61 23 50 23C39 23 30 30 27 44C24 56 24 66 30 76C24 70 20 60 20 48Z" fill="${color}"/><path d="M27 44C30 30 39 23 50 23C61 23 70 30 73 44" fill="none" stroke="${dark}" stroke-width="1.4" opacity=".7"/>`,
        };
    }

    function clothes(type, color, skin) {
        const neck = `<path d="M42 60H58V76H42Z" fill="${shade(skin, -0.12)}"/>`;
        if (type === 1) {
            // White coat over scrubs, stethoscope.
            return `${neck}<path d="M12 100C13 82 28 72 42 70L50 82L58 70C72 72 87 82 88 100Z" fill="${color}"/>
                <path d="M12 100C13 82 27 72 40 69L46 100Z" fill="#F8FAFC"/><path d="M88 100C87 82 73 72 60 69L54 100Z" fill="#F8FAFC"/>
                <path d="M40 69L46 84L42 86L46 100" fill="none" stroke="#CBD5E1" stroke-width="1"/><path d="M60 69L54 84L58 86L54 100" fill="none" stroke="#CBD5E1" stroke-width="1"/>
                <path d="M41 72Q36 86 44 90Q50 92 54 86" fill="none" stroke="#334155" stroke-width="1.6"/><circle cx="54.5" cy="86" r="2.6" fill="#94A3B8" stroke="#334155" stroke-width="1"/>`;
        }
        if (type === 2) {
            return `${neck}<path d="M12 100C13 82 28 72 42 70H58C72 72 87 82 88 100Z" fill="${color}"/>
                <path d="M42 70L50 78L58 70L56 68L50 73L44 68Z" fill="#F8FAFC"/><circle cx="50" cy="84" r="1" fill="${shade(color, -0.3)}"/><circle cx="50" cy="92" r="1" fill="${shade(color, -0.3)}"/>`;
        }
        return `${neck}<path d="M12 100C13 82 28 72 42 70L50 80L58 70C72 72 87 82 88 100Z" fill="${color}"/>
            <path d="M42 70L50 80L58 70" fill="none" stroke="${shade(color, -0.25)}" stroke-width="1.6"/><rect x="61" y="84" width="9" height="7" rx="1.2" fill="${shade(color, -0.12)}"/>`;
    }

    function hairCurls(color, long) {
        const pts = long
            ? [[30, 30], [38, 21], [50, 18], [62, 21], [70, 30], [26, 42], [74, 42], [24, 54], [76, 54], [26, 66], [74, 66]]
            : [[30, 32], [36, 24], [44, 19], [52, 18], [60, 20], [67, 25], [71, 33], [28, 40], [72, 40]];
        return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${color}"/>`).join('');
    }

    function svg(config, size = 40, sex) {
        const c = clean(config, sex);
        const skin = SKIN[c.s];
        const hairColor = HAIR_COLOR[c.hc];
        const hairDef = HAIR[c.h];
        const hijabOn = c.t === 4;
        const shemagh = c.t === 5;
        const hj = hijabOn ? hijab(HAT_COLOR[c.tc]) : null;
        const ears = hijabOn || shemagh ? '' : `<circle cx="27.5" cy="47" r="4.6" fill="${skin}"/><circle cx="72.5" cy="47" r="4.6" fill="${skin}"/>`;
        let hairBack = '', hairFront = '';
        if (!hijabOn && !shemagh) {
            if (hairDef.back) hairBack = `<path d="${hairDef.back}" fill="${hairColor}"/>`;
            if (hairDef.bun) hairBack += `<circle cx="50" cy="11" r="8" fill="${hairColor}"/>`;
            if (hairDef.curls) hairFront = hairCurls(hairColor, false);
            if (hairDef.front) hairFront += `<path d="${hairDef.front}" fill="${hairColor}"${hairDef.op ? ` opacity="${hairDef.op}"` : ''}/>`;
        }
        // Square drawing; the round crop comes from CSS (.hav-wrap), so no SVG ids can clash.
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false" class="hav">
            <rect width="100" height="100" fill="${BG[c.k]}"/>
            ${hj ? hj.back : ''}${hairBack}
            ${clothes(c.c, CLOTH_COLOR[c.cc], skin)}
            ${ears}
            <ellipse cx="50" cy="47" rx="22.5" ry="25.5" fill="${skin}"/>
            ${beard(c.d, HAIR_COLOR[c.dc])}
            ${hairFront}
            ${eyes(c.e, EYE_COLOR[c.ec], skin)}
            ${brows(c.b, HAIR_COLOR[c.bc])}
            ${nose(c.n, skin)}
            ${mouth(c.o)}
            ${moustache(c.m, HAIR_COLOR[c.mc])}
            ${glasses(c.g)}
            ${hj ? hj.front : hat(c.t, HAT_COLOR[c.tc])}
            </svg>`;
    }

    /** Parsed avatar of an account (or its default figure). */
    function forAccount(acc) {
        if (!acc) return null;
        let cfg = acc.avatar;
        if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
        return cfg && typeof cfg === 'object' ? clean(cfg, acc.sex) : defaultFor(acc.id || acc.username || acc.name, acc.sex);
    }

    function random(sex) {
        const r = n => Math.floor(Math.random() * n);
        const cfg = {};
        for (const [k, n] of Object.entries(LIMITS)) cfg[k] = r(n);
        if (sex === 'f') { cfg.h = [8, 9, 10, 11, 12, 7, 6][r(7)]; cfg.t = [0, 0, 4, 4, 1, 2][r(6)]; }
        else { cfg.h = r(8); if (cfg.t === 4) cfg.t = 0; }
        cfg.g = r(3) === 0 ? 1 + r(4) : 0;
        if (cfg.t === 5 && r(2)) cfg.t = 0;
        return clean(cfg, sex);
    }

    window.HubAvatar = { svg, forAccount, defaultFor, clean, random, PARTS, LIMITS, palettes: { SKIN, HAIR_COLOR, EYE_COLOR, CLOTH_COLOR, HAT_COLOR, BG } };
})(window);
