/**
 * Cartoon avatars drawn as inline SVG (no image files), version 2.
 *
 * Every part is built on one head template (viewBox 0 0 200 200), so hair, hats, beards and
 * glasses always sit on the head:
 *   skull ellipse  centre (100, 98), rx 44, ry 64      -> crown at y 34, temples at x 56 / 144
 *   jaw            temples (56/144, 92) -> chin (100, 166)
 *   ears           (52 / 148, 106)
 *   eyes           (80 / 120, 104), brows y ~ 86, nose 100..124, mouth (100, 140)
 *   neck / body    neck x 80..120 from y 140, shoulders from y 166
 *
 * An avatar is { v: 2, s, h, hc, e, ec, b, bc, m, mc, d, dc, n, o, g, t, tc, c, cc, k } (option indexes).
 * HubAvatar.svg(config, size, sex) returns markup; HubAvatar.forAccount(acc) gives a stable default
 * figure for accounts that never designed one.
 */
(function (window) {
    'use strict';

    let uidCounter = 0;
    const uid = () => 'hv' + (++uidCounter).toString(36) + Math.random().toString(36).slice(2, 5);

    // ------------------------------------------------------------------
    // Colour helpers and palettes (20 each)
    // ------------------------------------------------------------------
    const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    const shade = (hex, amt) => { const [r, g, b] = hexToRgb(hex); return amt < 0 ? rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt)) : rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt); };
    const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };

    const SKIN = ['#FFE7DA', '#FDDCC8', '#F8D2B8', '#F3C6A5', '#EDBB98', '#E8B08A', '#E2A57C', '#D99A70', '#CF8E63', '#C4835A',
        '#B87750', '#AB6B47', '#9E603F', '#8F5538', '#804A31', '#713F2A', '#633624', '#542D1E', '#F2D3B1', '#C99B77'];
    const HAIR_COLOR = ['#14110F', '#2B2220', '#3B2A20', '#4E3426', '#6A4430', '#83573A', '#A06F48', '#C08A55', '#D9AE6E', '#EBD39A',
        '#F2E6C9', '#8E3B22', '#B5542C', '#CF7A3C', '#7D7D80', '#B9B9BE', '#EDEDF0', '#2F5DAA', '#7B3FB0', '#D9468F'];
    const EYE_COLOR = ['#3B2314', '#5A3A22', '#7A5230', '#8C6A3A', '#A27A3E', '#6E7A3A', '#4F7F3E', '#3F8F6A', '#2F7F8A', '#3D6FB2',
        '#5A86C8', '#7FA6D6', '#6E7F8F', '#8F9AA6', '#2B2B2B', '#7B3FB0', '#B0306A', '#C9A227', '#D04A2A', '#1E9C9C'];
    const CLOTH_COLOR = ['#0F766E', '#14B8A6', '#1D4ED8', '#3B82F6', '#1E3A8A', '#334155', '#64748B', '#111827', '#F8FAFC', '#7C3AED',
        '#A855F7', '#BE185D', '#EC4899', '#B91C1C', '#EA580C', '#CA8A04', '#15803D', '#65A30D', '#78350F', '#0E7490'];
    const HAT_COLOR = ['#111827', '#374151', '#9CA3AF', '#F5F5F4', '#0F766E', '#14B8A6', '#1D4ED8', '#60A5FA', '#1E3A8A', '#7C3AED',
        '#BE185D', '#F472B6', '#B91C1C', '#EA580C', '#FACC15', '#15803D', '#78350F', '#D6B98C', '#0E7490', '#F1E3D3'];
    const BG = ['#CCFBF1', '#DBEAFE', '#E0E7FF', '#EDE9FE', '#FCE7F3', '#FFE4E6', '#FEF3C7', '#FEF9C3', '#DCFCE7', '#D1FAE5',
        '#E2E8F0', '#F1F5F9', '#FFEDD5', '#CFFAFE', '#1E293B', '#0F766E', '#312E81', '#831843', '#14532D', '#7C2D12'];

    // ------------------------------------------------------------------
    // Geometry helpers
    // ------------------------------------------------------------------
    const CX = 100, CY = 98, RX = 44, RY = 64;
    const f = n => Math.round(n * 10) / 10;
    /** Point on the skull ellipse grown by `grow` units; theta from PI (left) to 0 (right) over the crown. */
    const onSkull = (theta, grow = 0, sy = 1) => [f(CX + (RX + grow) * Math.cos(theta)), f(CY - (RY + grow) * sy * Math.sin(theta))];

    /** Smooth crown outline from the left temple to the right temple. */
    function crown(grow = 6, lift = 0, startY = 98) {
        const L = f(CX - RX - grow * 0.7), R = f(CX + RX + grow * 0.7), T = f(CY - RY - grow - lift);
        return `M${L} ${startY}C${f(L - 1)} ${f(56 - grow)} ${f(70 - grow * 0.5)} ${T} ${CX} ${T}C${f(130 + grow * 0.5)} ${T} ${f(R + 1)} ${f(56 - grow)} ${R} ${startY}`;
    }

    /** Crown with spikes / tufts / curls: n bumps of amplitude amp, sharp (spikes) or rounded. */
    function bumpyCrown(grow, n, amp, sharp, jitter = 0, startTheta = Math.PI, endTheta = 0) {
        const pts = [];
        for (let i = 0; i <= n * 2; i++) {
            const t = startTheta + (endTheta - startTheta) * (i / (n * 2));
            const j = jitter ? Math.sin(i * 12.9898) * jitter : 0;
            const g = i % 2 ? grow + amp + j : grow;
            pts.push(onSkull(t, g));
        }
        let d = `M${pts[0][0]} ${Math.max(pts[0][1], 96)}`;
        for (let i = 1; i < pts.length; i++) {
            const [x, y] = pts[i];
            if (sharp) d += `L${x} ${y}`;
            else {
                const [px, py] = pts[i - 1];
                const mx = (px + x) / 2, my = (py + y) / 2;
                const t = startTheta + (endTheta - startTheta) * ((i - 0.5) / (n * 2));
                const [ox, oy] = onSkull(t, grow + amp * 1.4);
                d += `Q${f(i % 2 ? ox : mx)} ${f(i % 2 ? oy : my)} ${x} ${y}`;
            }
        }
        return d;
    }

    // Hairline shapes, drawn from the right temple (140, 90) across the forehead to the left temple (60, 90).
    const FRINGE = {
        high: 'C134 64 118 56 100 57C82 56 66 64 60 90',
        classic: 'C136 70 118 61 100 62C82 61 64 70 60 90',
        side: 'C139 72 126 62 110 62C96 62 86 70 74 68C67 70 62 79 60 90',
        sweep: 'C134 70 116 64 98 70C83 76 69 86 60 100',
        bangs: 'C141 82 134 80 122 81L78 81C66 80 59 82 60 90',
        curtain: 'C137 79 121 63 103 66L100 72L97 66C79 63 63 79 60 90',
        spiky: 'L134 74L127 86L119 70L110 85L100 68L90 85L81 70L73 86L66 74L60 90',
        anime: 'L137 100L130 72L122 96L112 66L102 94L92 64L83 94L74 70L66 100L60 90',
        wave: 'C138 78 131 71 122 75C114 68 106 73 100 69C94 73 86 68 78 75C69 71 62 78 60 90',
        curly: 'Q137 71 129 77Q122 66 114 75Q107 64 100 73Q93 64 86 75Q78 66 71 77Q63 71 60 90',
        receding: 'C139 66 128 52 116 56C110 64 90 64 84 56C72 52 61 66 60 90',
        pixie: 'C136 74 124 68 112 70L105 82L98 70C87 74 76 82 70 92L64 84L60 90',
        flat: 'C139 76 126 70 100 70C74 70 61 76 60 90',
        messy: 'L133 78L128 72L122 82L114 70L108 80L100 70L93 82L86 72L79 82L72 74L66 84L60 90',
    };

    /** Hair cap: crown outline + right side (with optional sideburn) + fringe + left side. */
    function cap(outer, fringe, { sideburn = false, grow = 6 } = {}) {
        const L = f(CX - RX - grow * 0.7), R = f(CX + RX + grow * 0.7);
        const right = sideburn ? `L${R} 104L145 116L140 116L140 90` : `L${R} 96L140 90`;
        const left = sideburn ? `L60 116L55 116L${L} 104` : `L${L} 96`;
        return `${outer}${right}${FRINGE[fringe]}${left}Z`;
    }

    /** Long hair behind the head down to `len`; end: straight | wavy | points | curls | flick. */
    function backHair(len, width = 4, end = 'straight', top = 8) {
        const L = 52 - width, R = 148 + width;
        let bottom;
        const span = R - L;
        if (end === 'wavy') {
            bottom = ''; for (let i = 5; i >= 0; i--) { const x = L + span * i / 6, x2 = L + span * (i + 0.5) / 6; bottom += `Q${f(x2)} ${f(len + (i % 2 ? 7 : -5))} ${f(x)} ${f(len)}`; }
        } else if (end === 'points') {
            bottom = ''; for (let i = 7; i >= 0; i--) { const x = L + span * i / 8, x2 = L + span * (i + 0.5) / 8; bottom += `L${f(x2)} ${f(len + 12)}L${f(x)} ${f(len - 4)}`; }
        } else if (end === 'curls') {
            bottom = ''; for (let i = 6; i >= 0; i--) { const x = L + span * i / 7, x2 = L + span * (i + 0.5) / 7; bottom += `Q${f(x2)} ${f(len + 14)} ${f(x)} ${f(len)}`; }
        } else if (end === 'flick') {
            bottom = `C${R + 10} ${len + 6} ${R - 6} ${len + 8} ${R - 14} ${len}L${L + 14} ${len}C${L + 6} ${len + 8} ${L - 10} ${len + 6} ${L} ${len}`;
        } else bottom = `L${L} ${len}`;
        const T = CY - RY - top;
        return `M${L} ${len}C${L - 4} ${len - 40} ${L - 6} 110 ${L + 2} 84C${L + 6} ${T + 20} 72 ${T} 100 ${T}C128 ${T} ${R - 6} ${T + 20} ${R - 2} 84C${R + 6} 110 ${R + 4} ${len - 40} ${R} ${len}${end === 'straight' ? `L${L} ${len}` : bottom}Z`;
    }

    /** Locks of hair falling in front of the shoulders on both sides of the face. */
    function sideLocks(len, w = 12, pointed = false) {
        const tipL = pointed ? `L${50} ${len + 8}` : `Q${54} ${len + 6} ${58} ${len}`;
        const tipR = pointed ? `L${150} ${len + 8}` : `Q${146} ${len + 6} ${142} ${len}`;
        return `M60 88C50 110 48 ${len - 30} 50 ${len}${tipL}L${58 + w} ${len - 6}C${56 + w} ${len - 40} 58 112 64 96Z` +
            `M140 88C150 110 152 ${len - 30} 150 ${len}${tipR}L${142 - w} ${len - 6}C${144 - w} ${len - 40} 142 112 136 96Z`;
    }

    // ------------------------------------------------------------------
    // Hairstyles (26): front = cap over the forehead, back = behind the head, extra = drawn in front of body
    // ------------------------------------------------------------------
    const HAIR = [
        { name: 'أصلع', draw: () => ({ shine: true }) },
        { name: 'حلاقة صفر', draw: () => ({ front: cap(crown(1), 'classic', { grow: 1, sideburn: true }), buzz: true }) },
        { name: 'قصة عسكرية', draw: () => ({ front: cap(crown(3), 'high', { grow: 3, sideburn: true }), strands: 'up' }) },
        { name: 'فرق جانبي رسمي', draw: () => ({ front: cap(crown(6, 2), 'side', { grow: 6, sideburn: true }), strands: 'side' }) },
        { name: 'مسرّح للخلف', draw: () => ({ front: cap(crown(6, 4), 'high', { grow: 6, sideburn: true }), strands: 'back', gloss: true }) },
        { name: 'بومبادور', draw: () => ({ front: cap(crown(7, 14), 'high', { grow: 7, sideburn: true }), strands: 'back', gloss: true }) },
        { name: 'كويف حديث', draw: () => ({ front: cap(bumpyCrown(5, 4, 6, false, 0, 2.6, 0.5) + `L${f(CX + RX + 4)} 96`, 'classic', { grow: 5, sideburn: true }), strands: 'up' }) },
        { name: 'قصة مموجة قصيرة', draw: () => ({ front: cap(bumpyCrown(5, 7, 3, false), 'wave', { grow: 5, sideburn: true }), strands: 'side' }) },
        { name: 'مجعد قصير', draw: () => ({ front: cap(bumpyCrown(7, 10, 5, false), 'curly', { grow: 7, sideburn: true }), curls: 1 }) },
        { name: 'أفرو', draw: () => ({ back: 'M100 4C150 4 174 34 172 74C171 104 160 118 148 120L52 120C40 118 29 104 28 74C26 34 50 4 100 4Z', front: cap(bumpyCrown(10, 12, 4, false), 'curly', { grow: 10 }), curls: 2 }) },
        { name: 'مموج متوسط', draw: () => ({ cover: true, back: backHair(132, 4, 'wavy'), front: cap(crown(7, 2), 'curtain', { grow: 7 }), strands: 'part' }) },
        { name: 'كعكة رجالية', draw: () => ({ bun: [100, 22, 15], front: cap(crown(4), 'high', { grow: 4, sideburn: true }), strands: 'back' }) },
        { name: 'موهوك', draw: () => ({ front: 'M84 74C76 52 78 26 88 10L92 26L96 2L100 22L104 2L108 26L112 10C122 26 124 52 116 74C110 68 90 68 84 74Z', shaved: true, strands: 'up' }) },
        { name: 'مولِت', draw: () => ({ back: backHair(150, 0, 'flick', 4), front: cap(crown(5), 'spiky', { grow: 5, sideburn: true }), strands: 'up' }) },
        { name: 'منكوش جامح', draw: () => ({ front: cap(bumpyCrown(7, 11, 12, true, 4), 'messy', { grow: 7 }), strands: 'wild' }) },
        { name: 'أنمي شائك', draw: () => ({ front: cap(bumpyCrown(8, 8, 28, true, 3), 'spiky', { grow: 8 }), strands: 'up', gloss: true }) },
        { name: 'أنمي بغرة طويلة', draw: () => ({ cover: true, back: backHair(150, 6, 'points'), front: cap(crown(8, 2), 'anime', { grow: 8 }), extra: sideLocks(148, 12, true), gloss: true }) },
        { name: 'طويل ناعم', draw: () => ({ cover: true, back: backHair(184, 6, 'straight'), front: cap(crown(7, 2), 'curtain', { grow: 7 }), extra: sideLocks(176, 12), strands: 'part', gloss: true }) },
        { name: 'بوب', draw: () => ({ cover: true, back: backHair(142, 6, 'straight', 10), front: cap(crown(9, 4), 'bangs', { grow: 9 }), extra: sideLocks(140, 9), strands: 'part', gloss: true }) },
        { name: 'ذيل حصان', draw: () => ({ back: 'M140 54C168 62 176 100 168 140C164 158 154 160 150 150C158 120 156 92 136 74Z', front: cap(crown(5, 2), 'high', { grow: 5 }), strands: 'back', gloss: true }) },
        { name: 'كعكة علوية', draw: () => ({ bun: [100, 18, 19], front: cap(crown(5, 2), 'high', { grow: 5 }), strands: 'back', gloss: true }) },
        { name: 'طويل مموج', draw: () => ({ cover: true, back: backHair(186, 10, 'wavy'), front: cap(crown(8, 2), 'side', { grow: 8 }), extra: sideLocks(170, 13), strands: 'side', gloss: true }) },
        { name: 'مجعد طويل', draw: () => ({ cover: true, back: backHair(176, 16, 'curls', 14), front: cap(bumpyCrown(10, 11, 5, false), 'curly', { grow: 10 }), curls: 3 }) },
        { name: 'ذيلان أنمي', draw: () => ({ back: 'M52 64C24 70 14 120 22 168C26 182 40 180 40 166C34 128 38 96 60 80ZM148 64C176 70 186 120 178 168C174 182 160 180 160 166C166 128 162 96 140 80Z', front: cap(crown(7, 3), 'anime', { grow: 7 }), gloss: true }) },
        { name: 'بيكسي', draw: () => ({ front: cap(crown(5, 3), 'pixie', { grow: 5, sideburn: true }), strands: 'side', gloss: true }) },
        { name: 'ضفائر / دريدلوكس', draw: () => ({ cover: true, back: backHair(172, 10, 'straight'), front: cap(crown(7, 2), 'flat', { grow: 7 }), locs: true, strands: 'part' }) },
    ];

    function hairStrands(kind, dark, light, clip) {
        const lines = [];
        const add = d => lines.push(`<path d="${d}" stroke="${dark}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".6"/>`);
        if (kind === 'side') for (let i = 0; i < 9; i++) add(`M${68 + i * 9} ${46 + Math.abs(4 - i) * 2}Q${80 + i * 7} ${58} ${62 + i * 9} ${74 + (i % 3) * 3}`);
        if (kind === 'back') for (let i = 0; i < 9; i++) add(`M${64 + i * 9} ${70}Q${70 + i * 8} ${44} ${100 + (i - 4) * 4} ${34}`);
        if (kind === 'up') for (let i = 0; i < 10; i++) add(`M${62 + i * 8.5} ${76}L${64 + i * 8.5} ${50 - Math.abs(4.5 - i) * -1.5}`);
        if (kind === 'part') for (let i = 0; i < 10; i++) { const l = i < 5; add(`M100 40Q${l ? 84 - i * 4 : 116 + (i - 5) * 4} ${50} ${l ? 64 + i * 5 : 106 + (i - 5) * 7} ${82}`); }
        if (kind === 'wild') for (let i = 0; i < 12; i++) add(`M${60 + i * 7} ${80}Q${66 + i * 6} ${40 + (i % 3) * 6} ${56 + i * 8} ${22 + (i % 2) * 10}`);
        const hl = `<path d="M70 52Q100 30 130 52" stroke="${light}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".28"/>`;
        return `<g clip-path="url(#${clip})">${lines.join('')}${kind ? hl : ''}</g>`;
    }

    // ------------------------------------------------------------------
    // Eyes (21)
    // ------------------------------------------------------------------
    const EYES = [
        { name: 'طبيعية', w: 12, h: 5.4, r: 5.8 },
        { name: 'مستديرة', w: 11, h: 6.8, r: 6.2 },
        { name: 'لوزية', w: 13, h: 4.6, r: 5.4, tilt: 5 },
        { name: 'ضيقة', w: 12, h: 3.2, r: 4.4 },
        { name: 'متفاجئة', w: 12, h: 8, r: 4.6, lower: true },
        { name: 'ناعسة', w: 12, h: 5.4, r: 5.6, lid: 0.5 },
        { name: 'متعبة', w: 12, h: 5, r: 5.4, lid: 0.25, bags: true },
        { name: 'مبتسمة مغمضة', closed: 'happy' },
        { name: 'غمزة', w: 12, h: 5.4, r: 5.8, wink: true },
        { name: 'نظرة جانبية', w: 12, h: 5.4, r: 5.6, gaze: 3.5 },
        { name: 'حادة', w: 13, h: 4.4, r: 5.4, tilt: 9, flatLid: true },
        { name: 'حزينة', w: 12, h: 5, r: 5.6, tilt: -7 },
        { name: 'رموش كثيفة', w: 12, h: 5.6, r: 5.8, lashes: 3 },
        { name: 'كحل مجنّح', w: 12.5, h: 5, r: 5.6, liner: true, lashes: 1 },
        { name: 'أنمي واسعة', w: 13, h: 9.5, r: 8.6, anime: true },
        { name: 'أنمي حادة', w: 14, h: 6, r: 6.4, tilt: 8, anime: true, flatLid: true },
        { name: 'نقطية', dot: true },
        { name: 'قلوب', shape: 'heart' },
        { name: 'نجوم', shape: 'star' },
        { name: 'مغمضة هادئة', closed: 'calm' },
        { name: 'جفن أحادي', w: 12, h: 3.8, r: 4.8, mono: true },
    ];

    function eyePair(type, color, skin) {
        const E = EYES[type] || EYES[0];
        const ink = '#2A1D17';
        const one = (cx, side, forceClosed) => {
            const y = 104;
            if (E.closed === 'happy' || forceClosed) return `<path d="M${cx - 11} ${y + 2}Q${cx} ${y - 8} ${cx + 11} ${y + 2}" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
            if (E.closed === 'calm') return `<path d="M${cx - 11} ${y}Q${cx} ${y + 6} ${cx + 11} ${y}" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M${cx + 8 * side} ${y + 3}l${3 * side} 2" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>`;
            if (E.dot) return `<ellipse cx="${cx}" cy="${y}" rx="3.6" ry="4.6" fill="${ink}"/><circle cx="${cx + 1.2}" cy="${y - 1.6}" r="1.2" fill="#fff"/>`;
            if (E.shape === 'heart') return `<path d="M${cx} ${y + 7}C${cx - 13} ${y - 2} ${cx - 7} ${y - 12} ${cx} ${y - 4}C${cx + 7} ${y - 12} ${cx + 13} ${y - 2} ${cx} ${y + 7}Z" fill="#E2365B"/><circle cx="${cx - 4}" cy="${y - 4}" r="1.6" fill="#fff" opacity=".8"/>`;
            if (E.shape === 'star') {
                let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4 : 9.5; d += `${i ? 'L' : 'M'}${f(cx + r * Math.cos(a))} ${f(y + r * Math.sin(a))}`; }
                return `<path d="${d}Z" fill="#F6C343" stroke="#B7791F" stroke-width="1"/>`;
            }
            const w = E.w, h = E.h, tilt = (E.tilt || 0) * side * -1;
            const clip = uid();
            const top = E.flatLid ? `M${cx - w} ${y}L${cx - w * 0.3} ${y - h * 1.3}Q${cx + w * 0.5} ${y - h * 1.5} ${cx + w} ${y - h * 0.2}` : `M${cx - w} ${y}Q${cx} ${y - h * 1.9} ${cx + w} ${y}`;
            const sclera = `${top}Q${cx} ${y + h * (E.mono ? 0.9 : 1.25)} ${cx - w} ${y}Z`;
            const gx = (E.gaze || 0);
            const r = E.r;
            const irisDark = shade(color, -0.45);
            let s = `<g transform="rotate(${tilt} ${cx} ${y})"><clipPath id="${clip}"><path d="${sclera}"/></clipPath>`;
            s += `<path d="${sclera}" fill="#FBFBF8"/>`;
            s += `<g clip-path="url(#${clip})"><circle cx="${cx + gx}" cy="${y - 0.4}" r="${r}" fill="${color}"/><circle cx="${cx + gx}" cy="${y - 0.4}" r="${r}" fill="none" stroke="${irisDark}" stroke-width="1.2"/>`;
            s += `<circle cx="${cx + gx}" cy="${y - 0.4}" r="${f(r * (E.anime ? 0.5 : 0.46))}" fill="#0C0A09"/>`;
            if (E.anime) s += `<ellipse cx="${cx + gx - r * 0.35}" cy="${y - r * 0.45}" rx="${f(r * 0.32)}" ry="${f(r * 0.42)}" fill="#fff"/><circle cx="${cx + gx + r * 0.4}" cy="${y + r * 0.35}" r="${f(r * 0.16)}" fill="#fff" opacity=".9"/>`;
            else s += `<circle cx="${cx + gx + r * 0.35}" cy="${y - r * 0.45}" r="${f(r * 0.3)}" fill="#fff"/>`;
            if (E.lid) s += `<rect x="${cx - w - 2}" y="${y - h * 2.2}" width="${w * 2 + 4}" height="${f(h * 2.2 * E.lid + h * 0.8)}" fill="${skin}"/><path d="M${cx - w} ${f(y - h * 2.2 + h * 2.2 * E.lid + h * 0.8)}H${cx + w}" stroke="${shade(skin, -0.3)}" stroke-width="1.2"/>`;
            s += `<path d="M${cx - w} ${y}Q${cx} ${y - h * 0.25} ${cx + w} ${y}" stroke="${shade(skin, -0.15)}" stroke-width="2" fill="none" opacity=".35"/></g>`;
            s += `<path d="${top}" stroke="${ink}" stroke-width="${E.anime || E.mono ? 3.2 : 2.4}" fill="none" stroke-linecap="round"/>`;
            if (E.lower) s += `<path d="M${cx - w * 0.8} ${y + h * 0.9}Q${cx} ${y + h * 1.4} ${cx + w * 0.8} ${y + h * 0.9}" stroke="${ink}" stroke-width="1" fill="none" opacity=".5"/>`;
            if (E.liner) s += `<path d="M${cx + w * side} ${y - 0.5}l${6 * side} -4" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
            for (let i = 0; i < (E.lashes || 0); i++) s += `<path d="M${f(cx + side * (w - 1 - i * 4))} ${f(y - h * 1.1 + i)}l${2.5 * side} -4" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
            if (E.bags) s += `<path d="M${cx - w * 0.7} ${y + 6}Q${cx} ${y + 10} ${cx + w * 0.7} ${y + 6}" stroke="${shade(skin, -0.28)}" stroke-width="1.3" fill="none"/>`;
            return s + '</g>';
        };
        return one(80, -1, false) + one(120, 1, !!E.wink);
    }

    // ------------------------------------------------------------------
    // Eyebrows (21): [inner y, peak x offset, peak y, outer x, outer y, thick inner, thick outer]
    // ------------------------------------------------------------------
    const BROWS = [
        { name: 'طبيعي', p: [90, 13, 85, 66, 89, 3.8, 2.2] },
        { name: 'كثيف', p: [90, 13, 84, 65, 89, 6, 4] },
        { name: 'رفيع', p: [89, 13, 85, 66, 88, 2.2, 1.2] },
        { name: 'مقوس', p: [90, 12, 81, 66, 88, 3.6, 2] },
        { name: 'قوس عالٍ', p: [89, 13, 78, 67, 86, 3.2, 1.8] },
        { name: 'مستقيم', p: [88, 13, 87, 66, 88, 4, 2.6] },
        { name: 'زاوية حادة', p: [90, 18, 81, 66, 89, 4, 2], sharp: true },
        { name: 'مستدير ناعم', p: [91, 13, 84, 67, 91, 3.6, 2.4] },
        { name: 'كث غير مرتب', p: [90, 13, 84, 64, 89, 6.5, 4.5], rough: true },
        { name: 'حاجب موحّد', p: [89, 13, 84, 66, 89, 4.6, 2.6], uni: true },
        { name: 'مرفوع واحد', p: [90, 13, 85, 66, 89, 3.8, 2.2], raise: true },
        { name: 'قلق', p: [83, 13, 85, 66, 91, 3.6, 2.2] },
        { name: 'غاضب', p: [95, 13, 88, 66, 84, 4.4, 2.6] },
        { name: 'مريّش', p: [90, 13, 84, 65, 89, 5, 3], rough: true, feather: true },
        { name: 'قصير', p: [89, 9, 86, 75, 88, 4.4, 3.4] },
        { name: 'طويل مدبب', p: [90, 15, 84, 61, 91, 4, 1] },
        { name: 'أنمي رفيع', p: [84, 13, 81, 67, 83, 2, 1] },
        { name: 'حاد حديث', p: [89, 16, 83, 64, 87, 4.6, 1.4], sharp: true },
        { name: 'بشق', p: [90, 13, 85, 66, 89, 4, 2.4], slit: true },
        { name: 'خفيف', p: [90, 13, 85, 66, 89, 3.6, 2.2], soft: true },
        { name: 'كثيف مستقيم', p: [88, 13, 86, 65, 87, 6, 4.2] },
    ];

    function browPair(type, color) {
        const B = BROWS[type] || BROWS[0];
        const one = (side, lift) => {
            const [iy, pxo, py, ox, oy, ti, to] = B.p;
            const m = x => side < 0 ? x : 200 - x;
            const ix = 93, px = 93 - pxo;
            const iy2 = iy - lift, py2 = py - lift, oy2 = oy - lift;
            const d = B.sharp
                ? `M${m(ix)} ${iy2 - ti / 2}L${m(px)} ${py2 - ti / 2}L${m(ox)} ${oy2}L${m(px)} ${py2 + to / 2 + 1}L${m(ix)} ${iy2 + ti / 2}Z`
                : `M${m(ix)} ${iy2 - ti / 2}Q${m(px)} ${py2 - (ti + to) / 2} ${m(ox)} ${oy2}Q${m(px)} ${py2 + (to) / 2 + 1} ${m(ix)} ${iy2 + ti / 2}Z`;
            let s = `<path d="${d}" fill="${color}"${B.soft ? ' opacity=".55"' : ''}/>`;
            if (B.rough) for (let i = 0; i < 7; i++) s += `<path d="M${m(ix - i * 4)} ${iy2 - ti / 2 + 1 + (i % 2)}l${side < 0 ? -3 : 3} -${2 + (i % 3)}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`;
            if (B.slit) s += `<path d="M${m(77)} ${py2 - 6}L${m(80)} ${py2 + 5}" style="stroke:var(--hv-skin)" stroke-width="2.2"/>`;
            return s;
        };
        let out = one(-1, 0) + one(1, B.raise ? 5 : 0);
        if (B.uni) out += `<path d="M92 ${B.p[0] - 1}Q100 ${B.p[0] + 1} 108 ${B.p[0] - 1}" stroke="${color}" stroke-width="3" fill="none"/>`;
        return out;
    }

    // ------------------------------------------------------------------
    // Noses (20)
    // ------------------------------------------------------------------
    const NOSES = [
        { name: 'صغير', k: 'small' }, { name: 'زر', k: 'button' }, { name: 'مستقيم', k: 'straight' }, { name: 'روماني', k: 'roman' },
        { name: 'معقوف', k: 'hook' }, { name: 'عريض', k: 'wide' }, { name: 'مرفوع', k: 'up' }, { name: 'أفطس', k: 'snub' },
        { name: 'طويل', k: 'long' }, { name: 'مستدير', k: 'round' }, { name: 'مدبب', k: 'pointy' }, { name: 'نوبي', k: 'nubian' },
        { name: 'إغريقي', k: 'greek' }, { name: 'ممتلئ', k: 'bulb' }, { name: 'نحيف', k: 'thin' }, { name: 'أنمي خط', k: 'line' },
        { name: 'أنمي نقطة', k: 'dot' }, { name: 'مثلث كرتوني', k: 'tri' }, { name: 'مع نمش', k: 'freckles' }, { name: 'محمرّ', k: 'red' },
    ];

    function nose(type, skin) {
        const k = (NOSES[type] || NOSES[0]).k;
        const c = shade(skin, -0.32), s = shade(skin, -0.14);
        const nostrils = (w, y) => `<path d="M${100 - w} ${y}q2 2 5 1M${100 + w} ${y}q-2 2 -5 1" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
        const shadow = (d) => `<path d="${d}" fill="${s}" opacity=".45"/>`;
        switch (k) {
            case 'small': return `<path d="M97 108Q95 118 98 121Q100 122 103 121" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
            case 'button': return `${shadow('M93 118a7 5 0 0 0 14 0a7 5 0 0 0 -14 0Z')}${nostrils(5, 121)}`;
            case 'straight': return `${shadow('M98 100L95 120L101 122Z')}<path d="M98 100L95 119Q100 124 105 120" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
            case 'roman': return `<path d="M99 100Q94 110 93 118Q96 124 101 122Q105 124 107 120" stroke="${c}" stroke-width="1.9" fill="none" stroke-linecap="round"/>${nostrils(6, 121)}`;
            case 'hook': return `<path d="M99 100Q92 112 94 120Q97 126 101 121Q102 126 107 121" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
            case 'wide': return `${shadow('M90 118Q100 128 110 118Q104 112 100 112Q96 112 90 118Z')}<path d="M89 117Q92 123 97 121M111 117Q108 123 103 121M99 102Q97 112 97 116" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
            case 'up': return `<path d="M98 102Q95 114 96 118Q100 116 104 118" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>${nostrils(4, 118)}`;
            case 'snub': return `${shadow('M94 116a6 4 0 0 0 12 0a6 4 0 0 0 -12 0Z')}<path d="M94 118q6 3 12 0" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
            case 'long': return `<path d="M98 98L95 124Q100 128 105 124" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${nostrils(6, 125)}`;
            case 'round': return `${shadow('M92 119a8 6 0 0 0 16 0a8 6 0 0 0 -16 0Z')}<path d="M93 119a7 5 0 0 0 14 0" stroke="${c}" stroke-width="1.6" fill="none"/>`;
            case 'pointy': return `<path d="M99 100L93 121L101 121" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
            case 'nubian': return `${shadow('M91 119Q100 127 109 119Q100 113 91 119Z')}<path d="M99 104Q96 114 92 118Q96 123 100 121Q104 123 108 118" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
            case 'greek': return `<path d="M100 96L96 119Q100 123 104 120" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>${nostrils(5, 121)}`;
            case 'bulb': return `${shadow('M90 118a10 7 0 0 0 20 0a10 7 0 0 0 -20 0Z')}<path d="M98 102Q96 110 95 112" stroke="${c}" stroke-width="1.6" fill="none"/>${nostrils(7, 122)}`;
            case 'thin': return `<path d="M99 100L97 120Q100 122 102 120" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
            case 'line': return `<path d="M100 112L97 118L101 118" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
            case 'dot': return `<ellipse cx="100" cy="117" rx="2.2" ry="1.6" fill="${c}"/>`;
            case 'tri': return `<path d="M100 108L95 120L105 120Z" fill="${s}" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/>`;
            case 'freckles': {
                let d = '<path d="M97 106Q95 117 98 120Q100 121 103 120" stroke="' + c + '" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
                [[82, 116], [86, 119], [79, 120], [88, 114], [118, 116], [114, 119], [121, 120], [112, 114]].forEach(([x, y]) => { d += `<circle cx="${x}" cy="${y}" r="1.1" fill="${shade(skin, -0.38)}" opacity=".7"/>`; });
                return d;
            }
            case 'red': return `<ellipse cx="100" cy="119" rx="7" ry="5" fill="#E8705F" opacity=".55"/><path d="M98 104Q95 115 97 119Q100 121 103 119" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
        }
        return '';
    }

    // ------------------------------------------------------------------
    // Mouths (20)
    // ------------------------------------------------------------------
    const MOUTHS = ['ابتسامة', 'ابتسامة عريضة', 'ضحكة بالأسنان', 'محايد', 'قهقهة', 'ابتسامة جانبية', 'ابتسامة صغيرة', 'تبويز', 'متفاجئ',
        'لسان', 'حزين', 'جاد', 'أسنان مشدودة', 'قبلة', 'أحمر شفاه', 'ابتسامة واثقة', 'فم قطة (أنمي)', 'ناب', 'عض الشفة', 'صفير'];

    function mouth(type, skin) {
        const lip = mix(skin, '#B4475B', 0.5), dark = '#5B1F24', line = shade(lip, -0.35);
        const teeth = '#FBFBF7';
        switch (type) {
            case 0: return `<path d="M88 138Q100 147 112 138" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M93 143Q100 146 107 143" stroke="${lip}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`;
            case 1: return `<path d="M84 136Q100 152 116 136Q100 141 84 136Z" fill="${dark}"/><path d="M87 137Q100 141 113 137L112 139Q100 143 88 139Z" fill="${teeth}"/>`;
            case 2: return `<path d="M86 136Q100 154 114 136Z" fill="${dark}"/><path d="M87 136.5H113L111.5 141H88.5Z" fill="${teeth}"/><path d="M93 136.5V141M100 136.5V141.5M107 136.5V141" stroke="#E5E2DA" stroke-width=".8"/><path d="M92 147Q100 151 108 147" stroke="#E86A6A" stroke-width="3" stroke-linecap="round" opacity=".8"/>`;
            case 3: return `<path d="M90 140H110" stroke="${line}" stroke-width="2.4" stroke-linecap="round"/><path d="M94 144Q100 145.5 106 144" stroke="${lip}" stroke-width="2" fill="none" opacity=".55"/>`;
            case 4: return `<path d="M84 134Q100 160 116 134Z" fill="${dark}"/><path d="M86 135H114L112 139H88Z" fill="${teeth}"/><path d="M90 150Q100 157 110 150Q100 146 90 150Z" fill="#E86A6A"/>`;
            case 5: return `<path d="M88 141Q100 144 113 135" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M111 133l3 3" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`;
            case 6: return `<path d="M93 139Q100 144 107 139" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
            case 7: return `<ellipse cx="100" cy="140" rx="6" ry="5" fill="${lip}"/><path d="M96 140H104" stroke="${line}" stroke-width="1.2"/>`;
            case 8: return `<ellipse cx="100" cy="141" rx="6" ry="8" fill="${dark}"/><ellipse cx="100" cy="146" rx="4" ry="2.5" fill="#E86A6A" opacity=".8"/>`;
            case 9: return `<path d="M88 137Q100 147 112 137" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M95 141Q95 152 101 152Q107 151 106 141Z" fill="#E86A6A"/><path d="M100.5 142V149" stroke="#C94F55" stroke-width="1"/>`;
            case 10: return `<path d="M89 145Q100 135 111 145" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
            case 11: return `<path d="M89 140Q100 138 111 140" stroke="${line}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
            case 12: return `<rect x="87" y="135" width="26" height="10" rx="4" fill="${teeth}" stroke="${line}" stroke-width="2"/><path d="M87 140H113M94 135V145M100 135V145M106 135V145" stroke="#CFCBC2" stroke-width="1"/>`;
            case 13: return `<path d="M95 134Q100 131 105 134Q109 139 105 143Q100 147 95 143Q91 139 95 134Z" fill="${lip}"/><path d="M95 139Q100 141 105 139" stroke="${line}" stroke-width="1.2" fill="none"/>`;
            case 14: return `<path d="M86 138Q93 132 100 136Q107 132 114 138Q100 150 86 138Z" fill="#C81E4E"/><path d="M87 138.5Q100 141 113 138.5" stroke="#8E0F33" stroke-width="1.3" fill="none"/><path d="M93 135Q96 134 98 135.5" stroke="#fff" stroke-width="1" opacity=".5"/>`;
            case 15: return `<path d="M86 139Q99 147 114 136" stroke="${line}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M85 137l2 3M114 134l1 3" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`;
            case 16: return `<path d="M88 137Q94 144 100 138Q106 144 112 137" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
            case 17: return `<path d="M86 137Q100 150 114 137Q100 141 86 137Z" fill="${dark}"/><path d="M88 137.5Q100 141 112 137.5L111 139Q100 142 89 139Z" fill="${teeth}"/><path d="M107 138.5L109 143L111 138.5Z" fill="${teeth}"/>`;
            case 18: return `<path d="M88 138Q100 145 112 138" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M94 139.5H106V142.5Q100 144 94 142.5Z" fill="${teeth}"/>`;
            case 19: return `<ellipse cx="102" cy="140" rx="4.5" ry="4" fill="${lip}"/><circle cx="102" cy="140" r="2" fill="${dark}"/><path d="M110 134q4 -2 6 -6M114 138q5 -1 7 -4" stroke="#94A3B8" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
        }
        return '';
    }

    // ------------------------------------------------------------------
    // Moustaches (21) and beards (21): hair-textured shapes around the mouth and jaw
    // ------------------------------------------------------------------
    const MOUSTACHE = ['بدون', 'قلم رفيع', 'شيفرون', 'والروس', 'مقود (هاندلبار)', 'حدوة حصان', 'إنجليزي', 'دالي', 'فو مانشو', 'فرشاة قصيرة',
        'كثيف طبيعي', 'مقود صغير', 'إمبريال', 'هرمي', 'زابا', 'خفيف', 'فرشاة الرسام', 'منشاري', 'مموج أنمي', 'لولبي كرتوني', 'مشذب حديث'];

    function texture(d, color, n = 14, dir = 1) {
        let s = '';
        const dark = shade(color, -0.35);
        for (let i = 0; i < n * 2; i++) s += `<path d="M${f(76 + i * (48 / (n * 2)))} ${f(124 + (i % 3) * 2)}l${(i < n ? -0.8 : 0.8) * dir} ${4 + (i % 3)}" stroke="${dark}" stroke-width="1" opacity=".6"/>`;
        return s;
    }

    function moustache(type, color) {
        const dark = shade(color, -0.3);
        const P = {
            1: 'M88 132.5Q100 129 112 132.5Q100 131.5 88 132.5Z',
            2: 'M84 135Q88 127 100 128Q112 127 116 135Q108 132 100 133Q92 132 84 135Z',
            3: 'M80 140Q82 125 100 126Q118 125 120 140Q114 134 108 136Q100 132 92 136Q86 134 80 140Z',
            4: 'M88 133Q94 127 100 129Q106 127 112 133Q117 133 120 127Q123 136 114 136Q107 134 100 134Q93 134 86 136Q77 136 80 127Q83 133 88 133Z',
            5: 'M84 134Q88 126 100 127Q112 126 116 134L117 156L111 156L110 136Q100 133 90 136L89 156L83 156Z',
            6: 'M80 133Q90 127 100 130Q110 127 120 133Q110 133 100 134Q90 133 80 133Z',
            7: 'M90 132Q95 128 100 130Q105 128 110 132Q118 128 122 118Q121 132 110 134Q100 133 90 134Q79 132 78 118Q82 128 90 132Z',
            8: 'M86 133Q92 127 100 129Q108 127 114 133L116 162L112 162L110 136Q100 133 90 136L88 162L84 162Z',
            9: 'M92 128H108V134H92Z',
            10: 'M82 137Q83 125 100 126Q117 125 118 137Q110 133 100 134Q90 133 82 137Z',
            11: 'M88 133Q94 128 100 129.5Q106 128 112 133Q115 133 117 130Q117 135 112 135.5Q100 133 88 135.5Q83 135 83 130Q85 133 88 133Z',
            12: 'M86 131Q93 125 100 128Q107 125 114 131Q118 127 122 128Q118 134 110 134Q100 132 90 134Q82 134 78 128Q82 127 86 131Z',
            13: 'M95 127H105L113 135Q100 132 87 135Z',
            14: 'M78 140Q78 124 100 125Q122 124 122 140Q116 132 108 135Q100 131 92 135Q84 132 78 140Z',
            15: 'M86 133Q100 128 114 133Q100 131.5 86 133Z',
            16: 'M86 134Q90 128 100 129Q110 128 114 134L111 136Q100 132 89 136Z',
            17: 'M83 135L86 129L89 133L92 127L95 132L98 126L100 131L102 126L105 132L108 127L111 133L114 129L117 135Q100 131 83 135Z',
            18: 'M86 133Q93 127 100 131Q107 127 114 133Q110 131 106 134Q100 131 94 134Q90 131 86 133Z',
            19: 'M90 132Q96 127 100 130Q104 127 110 132Q118 128 117 122Q114 119 112 123Q115 124 113 127Q110 131 100 133Q90 131 87 127Q85 124 88 123Q86 119 83 122Q82 128 90 132Z',
            20: 'M85 133.5Q92 128.5 100 130Q108 128.5 115 133.5Q108 132.5 100 133.3Q92 132.5 85 133.5Z',
        }[type];
        if (!P) return '';
        const mc = uid();
        return `<clipPath id="${mc}"><path d="${P}"/></clipPath><path d="${P}" fill="${color}"/><g clip-path="url(#${mc})">${texture(P, color, 18)}</g><path d="${P}" fill="none" stroke="${dark}" stroke-width=".8" opacity=".6"/>`;
    }

    const BEARD = ['بدون', 'شعيرات خفيفة', 'ظل لحية', 'لحية خط الفك', 'سكسوكة', 'فان دايك', 'دائرية', 'مرساة', 'بالبو', 'مربعة قصيرة',
        'كاملة متوسطة', 'كاملة طويلة', 'غاريبالدي', 'مدببة', 'بوكس حديثة', 'سوالف عريضة', 'خصلة تحت الشفة', 'ستارة الذقن', 'جامحة كثيفة', 'أنمي مدببة', 'إمبريال'];

    const JAW = 'M57 104C58 126 66 144 80 156C88 163 94 166 100 166C106 166 112 163 120 156C134 144 142 126 143 104';
    const MOUTH_HOLE = 'C140 120 128 130 116 132C110 144 90 144 84 132C72 130 60 120 57 104Z';

    function beard(type, color, skin) {
        const dark = shade(color, -0.3), light = shade(color, 0.18);
        const full = (drop, width = 0, point = 0) => `M${57 - width} 102C${57 - width} 128 ${64 - width} ${150 + drop * 0.4} ${78 - width * 0.4} ${162 + drop * 0.6}C${88} ${170 + drop} ${96 - point * 0.4} ${172 + drop + point} 100 ${172 + drop + point}C${104 + point * 0.4} ${172 + drop + point} 112 ${170 + drop} ${122 + width * 0.4} ${162 + drop * 0.6}C${136 + width} ${150 + drop * 0.4} ${143 + width} 128 ${143 + width} 102` + MOUTH_HOLE.replace('C140', `C${140 + width}`).replace('57 104Z', `${57 - width} 104Z`);
        const P = {
            3: `${JAW}L137 104C136 124 128 142 116 153C110 158 105 160 100 160C95 160 90 158 84 153C72 142 64 124 63 104Z`,
            4: 'M88 146Q100 141 112 146Q113 162 100 166Q87 162 88 146Z',
            5: 'M89 146Q100 141 111 146Q111 160 100 168Q89 160 89 146Z',
            6: 'M84 132C80 148 88 164 100 166C112 164 120 148 116 132C112 144 88 144 84 132Z',
            7: 'M80 150Q90 162 100 166Q110 162 120 150Q113 148 108 154Q100 158 92 154Q87 148 80 150Z',
            8: 'M82 140C80 156 90 168 100 169C110 168 120 156 118 140C112 148 88 148 82 140Z',
            9: full(0, 0),
            10: full(8, 2),
            11: full(30, 4, 6),
            12: full(22, 8),
            13: full(18, 2, 16),
            14: full(4, 1),
            15: 'M56 96L57 104C58 126 66 140 78 146C82 140 80 128 74 120C68 112 66 104 66 96ZM144 96L143 104C142 126 134 140 122 146C118 140 120 128 126 120C132 112 134 104 134 96Z',
            16: 'M96 146H104L102 154H98Z',
            17: `${JAW}L139 104C138 126 130 144 118 154C110 161 105 163 100 163C95 163 90 161 82 154C70 144 62 126 61 104Z`,
            18: full(34, 10, 4),
            19: full(14, 0, 30),
            20: 'M95 145H105L102 166H98Z',
        }[type];
        if (type === 1) {
            const sc = uid();
            let s = `<clipPath id="${sc}"><path d="${full(0)}"/></clipPath><path d="${full(0)}" fill="${color}" opacity=".18"/><g clip-path="url(#${sc})">`;
            for (let i = 0; i < 60; i++) { const a = i * 2.39996, r = 8 + (i % 13) * 2.6; const x = 100 + Math.cos(a) * r * 1.6, y = 150 + Math.sin(a) * r * 0.7; s += `<circle cx="${f(x)}" cy="${f(y)}" r=".7" fill="${dark}" opacity=".5"/>`; }
            return s + '</g>';
        }
        if (type === 2) return `<path d="${full(0)}" fill="${color}" opacity=".32"/>`;
        if (!P) return '';
        const bc = uid();
        let s = `<clipPath id="${bc}"><path d="${P}"/></clipPath><path d="${P}" fill="${color}"/><g clip-path="url(#${bc})">`;
        // Hair texture: short strokes following the beard direction.
        for (let i = 0; i < 46; i++) {
            const x = 56 + (i * 37) % 90, y = 100 + ((i * 53) % 100);
            s += `<path d="M${x} ${y}q1 3 ${x < 100 ? -1 : 1} 6" stroke="${i % 3 ? dark : light}" stroke-width="1.1" fill="none" opacity=".6"/>`;
        }
        s += '</g>';
        return `<g>${s}<path d="${P}" fill="none" stroke="${dark}" stroke-width=".8" opacity=".5"/></g>`;
    }

    // ------------------------------------------------------------------
    // Glasses (21)
    // ------------------------------------------------------------------
    const GLASSES = ['بدون', 'دائرية', 'مستطيلة', 'بيضاوية', 'عين القطة', 'أفياتور', 'وايفيرر', 'نصف إطار', 'بدون إطار', 'شمسية سوداء',
        'شمسية دائرية', 'رياضية', 'قراءة منخفضة', 'براولاين', 'سداسية', 'قلوب', 'نجوم', 'نظارة واقية', 'مونوكل', 'أنمي لامعة', 'ملونة شفافة'];

    function glasses(type, color) {
        if (!type) return '';
        const frame = '#1F2937';
        const temples = (y = 101) => `<path d="M64 ${y}L54 ${y - 2}M136 ${y}L146 ${y - 2}" stroke="${frame}" stroke-width="2.4" stroke-linecap="round"/>`;
        const pair = (shape, opts = {}) => {
            const { fill = 'rgba(255,255,255,.12)', sw = 2.6, stroke = frame, bridge = 'M95 102Q100 99 105 102' } = opts;
            return `<g>${shape(80, -1, fill, stroke, sw)}${shape(120, 1, fill, stroke, sw)}<path d="${bridge}" stroke="${stroke}" stroke-width="${sw}" fill="none"/>${temples()}</g>`;
        };
        const round = (cx, s, fill, st, sw) => `<circle cx="${cx}" cy="104" r="13" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
        const rect = (cx, s, fill, st, sw) => `<rect x="${cx - 15}" y="95" width="30" height="20" rx="4" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
        const oval = (cx, s, fill, st, sw) => `<ellipse cx="${cx}" cy="104" rx="15" ry="10.5" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
        switch (type) {
            case 1: return pair(round);
            case 2: return pair(rect);
            case 3: return pair(oval);
            case 4: return pair((cx, s, fill, st, sw) => `<path d="M${cx - 15 * s} 97Q${cx} 93 ${cx + 15 * s} 93L${cx + 17 * s} 99Q${cx + 12 * s} 114 ${cx} 114Q${cx - 14 * s} 113 ${cx - 15 * s} 97Z" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`);
            case 5: return pair((cx, s, fill, st, sw) => `<path d="M${cx - 15} 96H${cx + 15}Q${cx + 16} 116 ${cx} 116Q${cx - 16} 116 ${cx - 15} 96Z" fill="rgba(60,70,80,.55)" stroke="#B08D57" stroke-width="2"/>`, { stroke: '#B08D57', sw: 2, bridge: 'M95 97H105M95 101H105' });
            case 6: return pair((cx, s, fill, st, sw) => `<path d="M${cx - 16} 95H${cx + 16}L${cx + 14} 112Q${cx} 116 ${cx - 14} 112Z" fill="${fill}" stroke="${st}" stroke-width="3.2"/>`);
            case 7: return `<g><path d="M65 96H95M105 96H135" stroke="${frame}" stroke-width="3.4" stroke-linecap="round"/><path d="M65 97Q66 114 80 114Q94 114 95 97M105 97Q106 114 120 114Q134 114 135 97" stroke="${frame}" stroke-width="1.1" fill="none" opacity=".65"/><path d="M95 98Q100 96 105 98" stroke="${frame}" stroke-width="2"/>${temples(97)}</g>`;
            case 8: return `<g opacity=".8"><rect x="65" y="96" width="30" height="18" rx="7" fill="rgba(255,255,255,.18)" stroke="#94A3B8" stroke-width="1"/><rect x="105" y="96" width="30" height="18" rx="7" fill="rgba(255,255,255,.18)" stroke="#94A3B8" stroke-width="1"/><path d="M95 102Q100 100 105 102M65 101L54 99M135 101L146 99" stroke="#94A3B8" stroke-width="1.6"/></g>`;
            case 9: return pair(rect, { fill: '#111827' }) + '<path d="M70 99L76 97M110 99L116 97" stroke="#fff" stroke-width="1.6" opacity=".4"/>';
            case 10: return pair(round, { fill: '#1F2937' }) + '<path d="M72 98L78 96M112 98L118 96" stroke="#fff" stroke-width="1.6" opacity=".45"/>';
            case 11: return `<g><path d="M62 98Q100 88 138 98L136 108Q120 116 104 108L100 106L96 108Q80 116 64 108Z" fill="${color}" opacity=".85" stroke="${frame}" stroke-width="2"/>${temples(99)}<path d="M70 100L84 99" stroke="#fff" stroke-width="1.6" opacity=".6"/></g>`;
            case 12: return `<g><rect x="66" y="106" width="28" height="12" rx="3" fill="rgba(255,255,255,.15)" stroke="${frame}" stroke-width="2.2"/><rect x="106" y="106" width="28" height="12" rx="3" fill="rgba(255,255,255,.15)" stroke="${frame}" stroke-width="2.2"/><path d="M94 109Q100 107 106 109M66 110L54 104M134 110L146 104" stroke="${frame}" stroke-width="2"/></g>`;
            case 13: return `<g><path d="M64 98Q80 93 96 98" stroke="${frame}" stroke-width="5" stroke-linecap="round"/><path d="M104 98Q120 93 136 98" stroke="${frame}" stroke-width="5" stroke-linecap="round"/><path d="M65 99Q66 115 80 115Q95 115 95 99M105 99Q105 115 120 115Q134 115 135 99" stroke="#B08D57" stroke-width="1.4" fill="none"/><path d="M95 100Q100 98 105 100" stroke="#B08D57" stroke-width="1.6"/>${temples(98)}</g>`;
            case 14: return pair((cx, s, fill, st, sw) => { let d = ''; for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; d += `${i ? 'L' : 'M'}${f(cx + 15 * Math.cos(a))} ${f(104 + 13 * Math.sin(a))}`; } return `<path d="${d}Z" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`; });
            case 15: return pair((cx, s, fill, st, sw) => `<path d="M${cx} 117C${cx - 20} 104 ${cx - 12} 88 ${cx} 98C${cx + 12} 88 ${cx + 20} 104 ${cx} 117Z" fill="#E2365B" opacity=".85" stroke="#9F1239" stroke-width="2"/>`, { stroke: '#9F1239' });
            case 16: return pair((cx, s, fill, st, sw) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 7 : 16; d += `${i ? 'L' : 'M'}${f(cx + r * Math.cos(a))} ${f(104 + r * Math.sin(a))}`; } return `<path d="${d}Z" fill="#F6C343" opacity=".9" stroke="#B7791F" stroke-width="2"/>`; }, { stroke: '#B7791F' });
            case 17: return `<g><path d="M52 92Q100 80 148 92V112Q124 122 104 112H96Q76 122 52 112Z" fill="rgba(125,211,252,.45)" stroke="${color}" stroke-width="4" stroke-linejoin="round"/><path d="M52 98L46 96M148 98L154 96" stroke="${color}" stroke-width="5"/><path d="M62 96L78 94" stroke="#fff" stroke-width="2" opacity=".7"/></g>`;
            case 18: return `<g><circle cx="120" cy="104" r="13" fill="rgba(255,255,255,.15)" stroke="#B08D57" stroke-width="2.6"/><path d="M128 114Q134 140 124 160" stroke="#B08D57" stroke-width="1.2" fill="none"/></g>`;
            case 19: return pair(round, { fill: 'rgba(255,255,255,.88)', sw: 3 }) + '<path d="M70 98L86 110M110 98L126 110" stroke="#93C5FD" stroke-width="3" opacity=".8"/>';
            case 20: return pair(oval, { fill: `${color}66`, stroke: shade(color, -0.3) });
        }
        return '';
    }

    // ------------------------------------------------------------------
    // Headwear (21): built on the skull so it fits (crown y 34, temples x 56 / 144)
    // ------------------------------------------------------------------
    const HATS = ['بدون', 'كاب', 'كاب مقلوب', 'قبعة صوف', 'قبعة صوف بكرة', 'غطاء عمليات', 'غطاء عمليات منقوش', 'باندانا', 'عصابة رأس', 'حجاب',
        'حجاب ملفوف (توربان)', 'يشماغ وعقال', 'طاقية', 'فيدورا', 'بيريه', 'قبعة صياد', 'قبعة كاوبوي', 'تاج', 'سماعات رأس', 'آذان قطة (أنمي)', 'قبعة تخرج'];
    // Headwear that hides the hair entirely / the ears.
    const HIDES_HAIR = new Set([9, 10, 11]);
    const HIDES_EARS = new Set([9, 10, 11]);

    function hat(type, color) {
        const dark = shade(color, -0.25), light = shade(color, 0.25);
        const capCrown = `M54 88C52 50 72 28 100 28C128 28 148 50 146 88Q100 80 54 88Z`;
        switch (type) {
            case 1: return `<path d="${capCrown}" fill="${color}"/><path d="M100 28V84M74 34Q86 60 84 84M126 34Q114 60 116 84" stroke="${dark}" stroke-width="1.2" fill="none" opacity=".7"/><path d="M54 86Q100 76 146 86Q176 88 182 98Q150 92 100 92Q66 92 54 92Z" fill="${dark}"/><circle cx="100" cy="29" r="3.5" fill="${dark}"/>`;
            case 2: return `<path d="${capCrown}" fill="${color}"/><path d="M100 28V84" stroke="${dark}" stroke-width="1.2" opacity=".7"/><path d="M54 86Q100 76 146 86V92Q100 86 54 92Z" fill="${dark}"/><path d="M86 84Q100 74 114 84" fill="${light}" stroke="${dark}" stroke-width="1"/><circle cx="100" cy="29" r="3.5" fill="${dark}"/>`;
            case 3: case 4: {
                let s = `<path d="M52 92C50 46 72 22 100 22C128 22 150 46 148 92Z" fill="${color}"/>`;
                for (let i = 0; i < 9; i++) s += `<path d="M${64 + i * 9} 80Q${66 + i * 8.5} 44 ${82 + i * 4.5} 26" stroke="${dark}" stroke-width="1.3" fill="none" opacity=".5"/>`;
                s += `<rect x="50" y="78" width="100" height="18" rx="8" fill="${dark}"/>`;
                for (let i = 0; i < 16; i++) s += `<path d="M${54 + i * 6} 80V94" stroke="${shade(color, -0.4)}" stroke-width="1" opacity=".45"/>`;
                if (type === 4) s += `<circle cx="100" cy="16" r="11" fill="${light}"/><circle cx="100" cy="16" r="11" fill="none" stroke="${dark}" stroke-width="1" stroke-dasharray="2 2"/>`;
                return s;
            }
            case 5: return `<path d="M50 90C44 52 66 22 100 22C134 22 156 52 150 90C138 80 118 76 100 76C82 76 62 80 50 90Z" fill="${color}"/><path d="M60 54Q100 40 140 54M56 70Q100 58 144 70" stroke="${dark}" stroke-width="1" fill="none" opacity=".5"/><path d="M50 90C62 80 82 76 100 76C118 76 138 80 150 90" stroke="${dark}" stroke-width="3" fill="none"/>`;
            case 6: {
                let s = `<path d="M52 88C50 50 72 26 100 26C128 26 150 50 148 88Q100 78 52 88Z" fill="${color}"/>`;
                for (let i = 0; i < 18; i++) { const x = 62 + (i * 23) % 76, y = 38 + (i * 17) % 40; s += `<circle cx="${x}" cy="${y}" r="3" fill="${light}" opacity=".9"/>`; }
                return s + `<path d="M52 88Q100 78 148 88" stroke="${dark}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
            }
            case 7: return `<path d="M52 84C50 48 72 28 100 28C128 28 150 48 148 84Q100 74 52 84Z" fill="${color}"/><path d="M146 80L162 96L154 100L144 88Z" fill="${dark}"/><g fill="${light}" opacity=".8"><circle cx="76" cy="52" r="2.4"/><circle cx="96" cy="42" r="2.4"/><circle cx="118" cy="48" r="2.4"/><circle cx="130" cy="66" r="2.4"/><circle cx="88" cy="66" r="2.4"/><circle cx="108" cy="62" r="2.4"/></g>`;
            case 8: return `<path d="M54 74Q100 58 146 74L147 84Q100 68 53 84Z" fill="${color}"/><path d="M60 74Q100 62 140 74" stroke="${light}" stroke-width="1.4" fill="none" opacity=".7"/>`;
            case 12: return `<path d="M58 70C58 44 76 34 100 34C124 34 142 44 142 70Q100 62 58 70Z" fill="${color}"/><path d="M62 64Q100 54 138 64M66 52Q100 42 134 52" stroke="${light}" stroke-width="1.2" fill="none" stroke-dasharray="3 3" opacity=".8"/>`;
            case 13: return `<path d="M64 76C62 48 78 38 100 38C122 38 138 48 136 76Z" fill="${color}"/><path d="M80 44Q100 54 120 44" stroke="${dark}" stroke-width="2" fill="none"/><rect x="62" y="66" width="76" height="10" fill="${dark}"/><path d="M32 82Q100 64 168 82Q150 90 100 88Q50 90 32 82Z" fill="${color}" stroke="${dark}" stroke-width="1.2"/>`;
            case 14: return `<path d="M50 74C40 50 66 30 104 32C142 34 160 52 148 70C136 80 66 84 50 74Z" fill="${color}"/><path d="M58 72Q100 82 144 70" stroke="${dark}" stroke-width="2.4" fill="none"/><circle cx="104" cy="31" r="3" fill="${dark}"/>`;
            case 15: return `<path d="M62 76C60 46 78 32 100 32C122 32 140 46 138 76Z" fill="${color}"/><path d="M40 86Q44 74 62 74H138Q156 74 160 86Q140 80 100 80Q60 80 40 86Z" fill="${dark}"/><path d="M64 60Q100 52 136 60" stroke="${dark}" stroke-width="1" fill="none" opacity=".6"/>`;
            case 16: return `<path d="M66 74C64 48 80 30 92 40Q100 46 108 40C120 30 136 48 134 74Z" fill="${color}"/><rect x="66" y="64" width="68" height="8" fill="${dark}"/><path d="M24 76Q30 62 48 72Q100 86 152 72Q170 62 176 76Q160 90 100 90Q40 90 24 76Z" fill="${color}" stroke="${dark}" stroke-width="1.4"/>`;
            case 17: return `<path d="M62 70L66 36L80 54L92 28L100 50L108 28L120 54L134 36L138 70Z" fill="#F6C343" stroke="#B7791F" stroke-width="2" stroke-linejoin="round"/><circle cx="92" cy="30" r="3" fill="#E2365B"/><circle cx="108" cy="30" r="3" fill="#2F7F8A"/><rect x="62" y="64" width="76" height="8" rx="2" fill="#E8B23A"/><circle cx="100" cy="68" r="3" fill="#E2365B"/>`;
            case 18: return `<path d="M52 104C46 52 70 24 100 24C130 24 154 52 148 104" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="38" y="90" width="20" height="30" rx="9" fill="${color}"/><rect x="142" y="90" width="20" height="30" rx="9" fill="${color}"/><rect x="42" y="95" width="10" height="20" rx="5" fill="${dark}"/><rect x="148" y="95" width="10" height="20" rx="5" fill="${dark}"/>`;
            case 19: return `<path d="M58 66L62 26L88 46Z" fill="${color}"/><path d="M142 66L138 26L112 46Z" fill="${color}"/><path d="M64 56L66 36L80 48Z" fill="#F9A8D4"/><path d="M136 56L134 36L120 48Z" fill="#F9A8D4"/>`;
            case 20: return `<path d="M64 66C64 46 80 38 100 38C120 38 136 46 136 66Z" fill="${color}"/><path d="M40 46L100 26L160 46L100 66Z" fill="${color}" stroke="${dark}" stroke-width="1.4"/><path d="M100 46L140 54V82" stroke="#F6C343" stroke-width="2" fill="none"/><circle cx="140" cy="84" r="3" fill="#F6C343"/>`;
        }
        return '';
    }

    function hijab(type, color) {
        const dark = shade(color, -0.22), light = shade(color, 0.18);
        if (type === 11) { // shemagh (red / white check) with black agal
            const check = uid();
            return {
                back: `<defs><pattern id="${check}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#F5F5F4"/><path d="M0 0H4V4H0ZM4 4H8V8H4Z" fill="${color}" opacity=".55"/></pattern></defs><path d="M40 98C36 50 64 22 100 22C136 22 164 50 160 98L168 186C150 196 126 192 118 176L82 176C74 192 50 196 32 186Z" fill="url(#${check})"/>`,
                front: `<path d="M40 98C36 50 64 22 100 22C136 22 164 50 160 98C160 118 154 136 146 150C150 128 150 108 146 92C140 62 122 50 100 50C78 50 60 62 54 92C50 108 50 128 54 150C46 136 40 118 40 98Z" fill="url(#${check})"/><path d="M50 52Q100 30 150 52" fill="none" stroke="#111827" stroke-width="8" stroke-linecap="round"/><path d="M52 60Q100 40 148 60" fill="none" stroke="#111827" stroke-width="7" stroke-linecap="round"/><path d="M50 52Q100 30 150 52M52 60Q100 40 148 60" fill="none" stroke="#4B5563" stroke-width="1.4"/>`,
            };
        }
        if (type === 10) { // turban-style wrap
            return {
                back: '',
                front: `<path d="M50 92C40 44 70 18 100 18C130 18 160 44 150 92C140 72 122 62 100 62C78 62 60 72 50 92Z" fill="${color}"/><path d="M54 80Q90 40 146 70M52 66Q100 30 144 54M70 40Q110 34 140 44" stroke="${dark}" stroke-width="3" fill="none" opacity=".55"/><path d="M58 60Q100 40 140 58" stroke="${light}" stroke-width="2" fill="none" opacity=".6"/>`,
            };
        }
        return { // hijab around the face, over the shoulders
            back: `<path d="M38 104C34 50 64 20 100 20C136 20 166 50 162 104C166 132 170 160 176 200H24C30 160 34 132 38 104Z" fill="${color}"/>`,
            front: `<path d="M38 104C34 50 64 20 100 20C136 20 166 50 162 104C162 132 152 156 132 172C146 148 150 124 146 98C142 62 124 46 100 46C76 46 58 62 54 98C50 124 54 148 68 172C48 156 38 132 38 104Z" fill="${color}"/><path d="M54 98C58 62 76 46 100 46C124 46 142 62 146 98" fill="none" stroke="${dark}" stroke-width="2" opacity=".6"/><path d="M60 40Q100 26 140 40" stroke="${light}" stroke-width="3" fill="none" opacity=".5"/><path d="M66 172Q100 190 134 172" stroke="${dark}" stroke-width="2" fill="none" opacity=".5"/>`,
        };
    }

    // ------------------------------------------------------------------
    // Clothes (20)
    // ------------------------------------------------------------------
    const CLOTHES = ['سكراب', 'سكراب بجيب', 'صدرية بيضاء وسماعة', 'صدرية بيضاء وربطة عنق', 'قميص بياقة', 'قميص وربطة عنق', 'بولو', 'تيشيرت',
        'هودي', 'ياقة عالية', 'سترة صوف', 'بدلة رسمية', 'بليزر مفتوح', 'دشداشة', 'عباءة', 'رداء عمليات', 'صدرية مختبر وبطاقة', 'جاكيت بسحاب', 'صدرية فوق قميص', 'كيمونو (أنمي)'];

    function clothes(type, color, skin) {
        const dark = shade(color, -0.25), light = shade(color, 0.3);
        const body = `M14 200C16 178 40 166 78 162H122C160 166 184 178 186 200Z`;
        const neckSkin = `<path d="M80 136V170Q100 180 120 170V136Z" fill="${shade(skin, -0.1)}"/><path d="M80 150Q100 162 120 150" stroke="${shade(skin, -0.24)}" stroke-width="3" fill="none" opacity=".45"/>`;
        const coat = (inner) => `<path d="${body}" fill="${inner}"/><path d="M14 200C16 178 40 166 76 162L92 200Z" fill="#F8FAFC"/><path d="M186 200C184 178 160 166 124 162L108 200Z" fill="#F8FAFC"/><path d="M76 162L92 182L86 186L92 200M124 162L108 182L114 186L108 200" stroke="#CBD5E1" stroke-width="1.5" fill="none"/>`;
        const steth = `<path d="M82 166Q70 192 90 196Q104 198 108 186" fill="none" stroke="#334155" stroke-width="2.6"/><circle cx="109" cy="185" r="5" fill="#94A3B8" stroke="#334155" stroke-width="1.6"/>`;
        const collar = c => `<path d="M80 162L100 178L120 162L114 158L100 170L86 158Z" fill="${c}"/>`;
        const tie = c => `<path d="M96 176H104L106 182L102 200H98L94 182Z" fill="${c}"/><path d="M96 176H104L102 172H98Z" fill="${shade(c, -0.2)}"/>`;
        switch (type) {
            case 0: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M80 162L100 186L120 162" fill="none" stroke="${dark}" stroke-width="2.4"/>`;
            case 1: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M80 162L100 186L120 162" fill="none" stroke="${dark}" stroke-width="2.4"/><rect x="128" y="182" width="18" height="14" rx="2" fill="${dark}"/><path d="M134 182V176" stroke="#1F2937" stroke-width="2"/>`;
            case 2: return `${neckSkin}${coat(color)}<path d="M80 162L100 182L120 162" fill="none" stroke="${dark}" stroke-width="2"/>${steth}`;
            case 3: return `${neckSkin}${coat('#F1F5F9')}${collar('#FFFFFF')}${tie(color)}`;
            case 4: return `${neckSkin}<path d="${body}" fill="${color}"/>${collar(light)}<path d="M100 178V200" stroke="${dark}" stroke-width="1.4"/><circle cx="100" cy="186" r="1.4" fill="${dark}"/><circle cx="100" cy="195" r="1.4" fill="${dark}"/>`;
            case 5: return `${neckSkin}<path d="${body}" fill="#F8FAFC"/>${collar('#FFFFFF')}${tie(color)}`;
            case 6: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M84 162L100 172L116 162L112 158L100 166L88 158Z" fill="${light}"/><path d="M100 170V186" stroke="${dark}" stroke-width="1.4"/><circle cx="100" cy="176" r="1.3" fill="${dark}"/><circle cx="100" cy="182" r="1.3" fill="${dark}"/>`;
            case 7: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M82 163Q100 174 118 163" stroke="${dark}" stroke-width="3" fill="none"/>`;
            case 8: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M70 164Q100 196 130 164Q118 158 100 162Q82 158 70 164Z" fill="${dark}"/><path d="M92 176L90 194M108 176L110 194" stroke="${light}" stroke-width="2" stroke-linecap="round"/><path d="M76 196H124" stroke="${dark}" stroke-width="1.4" opacity=".6"/>`;
            case 9: return `<path d="M80 136V170Q100 180 120 170V136Z" fill="${shade(skin, -0.1)}"/><path d="M80 146Q100 156 120 146V170H80Z" fill="${color}"/><path d="M80 152Q100 160 120 152M80 158Q100 166 120 158M80 164Q100 172 120 164" stroke="${dark}" stroke-width="1.2" fill="none" opacity=".6"/><path d="${body}" fill="${color}"/>`;
            case 10: {
                let s = `${neckSkin}<path d="${body}" fill="${color}"/><path d="M82 163Q100 172 118 163" stroke="${dark}" stroke-width="4" fill="none"/>`;
                for (let i = 0; i < 8; i++) s += `<path d="M${30 + i * 20} 196Q${36 + i * 20} 186 ${42 + i * 20} 196" stroke="${light}" stroke-width="1.6" fill="none" opacity=".6"/>`;
                return s;
            }
            case 11: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M84 162L100 200L116 162Z" fill="#F8FAFC"/>${tie('#7F1D1D')}<path d="M78 162L96 200M122 162L104 200" stroke="${dark}" stroke-width="2.4"/><path d="M84 162L92 176L80 172ZM116 162L108 176L120 172Z" fill="${dark}"/>`;
            case 12: return `${neckSkin}<path d="${body}" fill="#E2E8F0"/><path d="M14 200C16 178 40 166 78 162L90 200ZM186 200C184 178 160 166 122 162L110 200Z" fill="${color}"/><path d="M78 162L88 180L82 184L90 200M122 162L112 180L118 184L110 200" stroke="${dark}" stroke-width="1.6" fill="none"/>`;
            case 13: return `${neckSkin}<path d="${body}" fill="#F8FAFC"/><path d="M84 160Q100 170 116 160L116 166Q100 176 84 166Z" fill="#E2E8F0"/><path d="M100 170V200" stroke="#CBD5E1" stroke-width="1.6"/><circle cx="100" cy="180" r="1.6" fill="#94A3B8"/><circle cx="100" cy="190" r="1.6" fill="#94A3B8"/>`;
            case 14: return `${neckSkin}<path d="${body}" fill="#111827"/><path d="M82 162Q100 176 118 162" stroke="${color}" stroke-width="3" fill="none"/><path d="M100 172V200" stroke="${color}" stroke-width="2" opacity=".6"/>`;
            case 15: return `${neckSkin}<path d="${body}" fill="${light}"/><path d="M80 162Q100 172 120 162" stroke="${dark}" stroke-width="3" fill="none"/><path d="M40 186L60 180M160 186L140 180" stroke="${dark}" stroke-width="2" opacity=".5"/>`;
            case 16: return `${neckSkin}${coat(color)}<path d="M80 162L100 182L120 162" fill="none" stroke="${dark}" stroke-width="2"/><rect x="124" y="176" width="22" height="16" rx="2" fill="#E2E8F0" stroke="#64748B"/><rect x="127" y="179" width="8" height="10" rx="1" fill="#93C5FD"/><path d="M138 181H144M138 185H144" stroke="#64748B" stroke-width="1.2"/>`;
            case 17: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M82 160Q100 170 118 160L118 168Q100 178 82 168Z" fill="${dark}"/><path d="M100 170V200" stroke="#D1D5DB" stroke-width="2.6"/><rect x="98" y="176" width="4" height="7" rx="1" fill="#D1D5DB"/>`;
            case 18: return `${neckSkin}<path d="${body}" fill="#F8FAFC"/>${collar('#FFFFFF')}<path d="M14 200C16 178 40 166 80 162L96 200ZM186 200C184 178 160 166 120 162L104 200Z" fill="${color}"/><circle cx="92" cy="188" r="1.6" fill="${dark}"/>`;
            case 19: return `${neckSkin}<path d="${body}" fill="${color}"/><path d="M78 162L112 200H96L84 176ZM122 162L104 200" fill="${light}"/><path d="M78 162L112 200M122 162L100 190" stroke="${dark}" stroke-width="2.4" fill="none"/><rect x="40" y="190" width="120" height="10" fill="${dark}"/>`;
        }
        return neckSkin;
    }

    // ------------------------------------------------------------------
    // Parts list used by the editor
    // ------------------------------------------------------------------
    const PARTS = [
        { key: 's', label: 'البشرة', colors: SKIN },
        { key: 'h', label: 'الشعر', options: HAIR.map(x => x.name), color: 'hc', palette: HAIR_COLOR },
        { key: 'e', label: 'العيون', options: EYES.map(x => x.name), color: 'ec', palette: EYE_COLOR },
        { key: 'b', label: 'الحواجب', options: BROWS.map(x => x.name), color: 'bc', palette: HAIR_COLOR },
        { key: 'm', label: 'الشارب', options: MOUSTACHE, color: 'mc', palette: HAIR_COLOR, male: true },
        { key: 'd', label: 'اللحية', options: BEARD, color: 'dc', palette: HAIR_COLOR, male: true },
        { key: 'n', label: 'الأنف', options: NOSES.map(x => x.name) },
        { key: 'o', label: 'الفم', options: MOUTHS },
        { key: 'g', label: 'النظارات', options: GLASSES, color: 'gc', palette: HAT_COLOR },
        { key: 't', label: 'غطاء الرأس', options: HATS, color: 'tc', palette: HAT_COLOR },
        { key: 'c', label: 'الملابس', options: CLOTHES, color: 'cc', palette: CLOTH_COLOR },
        { key: 'k', label: 'الخلفية', colors: BG },
    ];
    const LIMITS = {
        s: SKIN.length, h: HAIR.length, hc: HAIR_COLOR.length, e: EYES.length, ec: EYE_COLOR.length, b: BROWS.length, bc: HAIR_COLOR.length,
        m: MOUSTACHE.length, mc: HAIR_COLOR.length, d: BEARD.length, dc: HAIR_COLOR.length, n: NOSES.length, o: MOUTHS.length,
        g: GLASSES.length, gc: HAT_COLOR.length, t: HATS.length, tc: HAT_COLOR.length, c: CLOTHES.length, cc: CLOTH_COLOR.length, k: BG.length,
    };
    const VERSION = 2;

    /** Keeps only known keys with in-range integer values. */
    function clean(cfg, sex) {
        const out = { v: VERSION };
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

    /** A stable, professional-looking default figure for an account that never designed one. */
    function defaultFor(seed, sex) {
        let h = hashCode(String(seed || 'x'));
        const next = n => { const v = h % n; h = (Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) || 1; return v; };
        const female = sex === 'f';
        return clean({
            s: next(16), h: female ? [17, 18, 19, 20, 21, 24][next(6)] : [2, 3, 4, 6, 7, 8][next(6)], hc: next(7), e: [0, 1, 2, 12][next(4)], ec: next(10),
            b: female ? [2, 3, 4][next(3)] : [0, 1, 5, 7][next(4)], bc: 0, m: 0, mc: 0, d: female ? 0 : [0, 0, 2, 9, 14, 3][next(6)], dc: 0, n: next(14), o: [0, 1, 6, 15][next(4)],
            g: next(4) === 0 ? [1, 2, 3][next(3)] : 0, gc: 0, t: female && next(3) === 0 ? 9 : 0, tc: next(20), c: [0, 1, 2, 4][next(4)], cc: next(10), k: next(14),
        }, sex);
    }

    function svg(config, size = 40, sex) {
        const c = clean(config, sex);
        if (c.hc === undefined) return '';
        const skin = SKIN[c.s];
        const hairColor = HAIR_COLOR[c.hc];
        const hidesHair = HIDES_HAIR.has(c.t);
        const hidesEars = HIDES_EARS.has(c.t);
        const scarf = hidesHair ? hijab(c.t, HAT_COLOR[c.tc]) : null;
        const hair = hidesHair ? {} : HAIR[c.h].draw();
        const clip = uid();
        const darkHair = shade(hairColor, -0.38), lightHair = shade(hairColor, 0.32);
        const skinShadow = shade(skin, -0.12), skinDeep = shade(skin, -0.22);

        const ears = hidesEars || hair.cover ? '' :
            `<path d="M58 96C46 92 42 106 46 116C49 124 56 126 59 120Z" fill="${skin}"/><path d="M55 102C49 102 49 112 54 116" stroke="${skinDeep}" stroke-width="1.6" fill="none"/>` +
            `<path d="M142 96C154 92 158 106 154 116C151 124 144 126 141 120Z" fill="${skin}"/><path d="M145 102C151 102 151 112 146 116" stroke="${skinDeep}" stroke-width="1.6" fill="none"/>`;

        const face = 'M56 92C56 56 74 36 100 36C126 36 144 56 144 92C144 116 138 134 126 148C116 159 108 166 100 166C92 166 84 159 74 148C62 134 56 116 56 92Z';
        let hairBack = '', hairFront = '', hairExtra = '';
        if (hair.back) {
            const bclip = uid();
            let bs = '';
            for (let i = 0; i < 16; i++) bs += `<path d="M${30 + i * 9} 70Q${28 + i * 9.4} 130 ${26 + i * 9.6} 200" stroke="${i % 4 ? darkHair : lightHair}" stroke-width="${i % 4 ? 1.4 : 2}" fill="none" opacity="${i % 4 ? 0.45 : 0.3}"/>`;
            hairBack += `<clipPath id="${bclip}"><path d="${hair.back}"/></clipPath><path d="${hair.back}" fill="${shade(hairColor, -0.12)}"/><g clip-path="url(#${bclip})">${bs}</g>`;
        }
        if (hair.bun) { const [bx, by, br] = hair.bun; hairBack += `<circle cx="${bx}" cy="${by}" r="${br}" fill="${hairColor}"/><path d="M${bx - br * 0.7} ${by}Q${bx} ${by - br * 0.9} ${bx + br * 0.7} ${by}M${bx - br * 0.5} ${by + br * 0.4}Q${bx} ${by - br * 0.3} ${bx + br * 0.5} ${by + br * 0.4}" stroke="${darkHair}" stroke-width="1.3" fill="none" opacity=".6"/>`; }
        if (hair.front) {
            hairFront = `<clipPath id="${clip}"><path d="${hair.front}"/></clipPath><path d="${hair.front}" fill="${hairColor}"/>`;
            if (hair.buzz) {
                // Very short hair: mostly scalp colour with a fine stubble texture.
                let dots = '';
                for (let i = 0; i < 220; i++) { const t = Math.PI * (i % 22) / 21, rr = 2 + Math.floor(i / 22) * 2.3; const [x, y] = onSkull(t, -rr); dots += `<circle cx="${x}" cy="${y}" r=".9" fill="${darkHair}"/>`; }
                hairFront += `<path d="${hair.front}" fill="${skin}" opacity=".55"/><g clip-path="url(#${clip})" opacity=".7">${dots}</g>`;
            }
            hairFront += hairStrands(hair.strands, darkHair, lightHair, clip);
            hairFront += `<path d="${hair.front}" fill="none" stroke="${darkHair}" stroke-width="1.4" stroke-linejoin="round" opacity=".7"/>`;
            if (hair.curls) {
                let curls = '';
                for (let i = 0; i < 26; i++) { const t = Math.PI - (i / 25) * Math.PI; const [x, y] = onSkull(t, hair.curls === 2 ? 4 : 2, 0.9); curls += `<circle cx="${x}" cy="${f(y + 6)}" r="${hair.curls === 2 ? 5 : 4}" fill="none" stroke="${darkHair}" stroke-width="1.2" opacity=".5"/>`; }
                hairFront += `<g clip-path="url(#${clip})">${curls}</g>`;
            }
            if (hair.locs) [44, 51, 58, 142, 149, 156].forEach((x, i) => {
                const end = 150 + (i % 3) * 12;
                hairExtra += `<path d="M${x} 84Q${x + (x < 100 ? -3 : 3)} 120 ${x} ${end}" stroke="${hairColor}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M${x} 88Q${x + (x < 100 ? -3 : 3)} 120 ${x} ${end - 4}" stroke="${darkHair}" stroke-width="1.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`;
            });
            if (hair.gloss) hairFront += `<path d="M76 50Q94 40 112 44" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".28"/>`;
        }
        if (hair.shaved) hairFront = `<path d="${crown(1)}L140 90${FRINGE.high}L60 90Z" fill="${hairColor}" opacity=".3"/>` + hairFront;
        if (hair.shine) hairFront += `<path d="M80 50Q96 42 110 46" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".35"/>`;
        if (hair.extra) {
            const xclip = uid();
            let xs = '';
            for (let i = 0; i < 6; i++) xs += `<path d="M${52 + i * 3} 90Q${48 + i * 3} 140 ${52 + i * 3} 190M${148 - i * 3} 90Q${152 - i * 3} 140 ${148 - i * 3} 190" stroke="${darkHair}" stroke-width="1.2" fill="none" opacity=".5"/>`;
            hairExtra += `<clipPath id="${xclip}"><path d="${hair.extra}"/></clipPath><path d="${hair.extra}" fill="${hairColor}"/><g clip-path="url(#${xclip})">${xs}</g><path d="${hair.extra}" fill="none" stroke="${darkHair}" stroke-width="1" opacity=".6"/>`;
        }

        const female = sex === 'f';
        const blush = `<ellipse cx="72" cy="124" rx="9" ry="5" fill="#F28B82" opacity="${female ? 0.28 : 0.14}"/><ellipse cx="128" cy="124" rx="9" ry="5" fill="#F28B82" opacity="${female ? 0.28 : 0.14}"/>`;
        // Shadow cast by the hair / headwear on the forehead, and under the jaw on the neck.
        const foreheadShade = (hair.front && !hair.buzz && !hidesHair) ? `<path d="M62 84Q100 70 138 84" stroke="${skinShadow}" stroke-width="6" fill="none" opacity=".35"/>` : '';

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" aria-hidden="true" focusable="false" class="hav" style="--hv-skin:${skin}">
            <rect width="200" height="200" fill="${BG[c.k]}"/>
            ${scarf ? scarf.back : ''}${hairBack}
            ${clothes(c.c, CLOTH_COLOR[c.cc], skin)}
            ${ears}
            <path d="${face}" fill="${skin}"/>
            <path d="M74 148C84 159 92 166 100 166C108 166 116 159 126 148C118 156 108 160 100 160C92 160 82 156 74 148Z" fill="${skinShadow}" opacity=".5"/>
            ${blush}${foreheadShade}
            ${beard(c.d, HAIR_COLOR[c.dc], skin)}
            ${eyePair(c.e, EYE_COLOR[c.ec], skin)}
            ${browPair(c.b, HAIR_COLOR[c.bc])}
            ${nose(c.n, skin)}
            ${mouth(c.o, skin)}
            ${moustache(c.m, HAIR_COLOR[c.mc])}
            ${hairFront}${hairExtra}
            ${glasses(c.g, HAT_COLOR[c.gc])}
            ${scarf ? scarf.front : hat(c.t, HAT_COLOR[c.tc])}
            </svg>`;
    }

    /** Parsed avatar of an account (or its default figure). Version-1 designs are replaced by the default. */
    function forAccount(acc) {
        if (!acc) return null;
        let cfg = acc.avatar;
        if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
        return cfg && typeof cfg === 'object' && cfg.v === VERSION ? clean(cfg, acc.sex) : defaultFor(acc.name || acc.username || acc.id, acc.sex);
    }

    function random(sex) {
        const r = n => Math.floor(Math.random() * n);
        const cfg = {};
        for (const [k, n] of Object.entries(LIMITS)) cfg[k] = r(n);
        if (sex === 'f') { cfg.h = [16, 17, 18, 19, 20, 21, 22, 23, 24, 9, 10][r(11)]; if (cfg.t === 11) cfg.t = 9; }
        else if ([9, 10].includes(cfg.t)) cfg.t = 0;
        if (r(3)) cfg.t = 0;
        if (r(2)) cfg.g = 0;
        if (r(2)) { cfg.m = 0; cfg.d = 0; }
        cfg.e = r(3) ? r(14) : cfg.e;
        cfg.bc = cfg.hc; cfg.mc = cfg.hc; cfg.dc = cfg.hc;
        return clean(cfg, sex);
    }

    window.HubAvatar = { svg, forAccount, defaultFor, clean, random, PARTS, LIMITS, VERSION, palettes: { SKIN, HAIR_COLOR, EYE_COLOR, CLOTH_COLOR, HAT_COLOR, BG } };
})(window);
