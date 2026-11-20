/**
 * The site's built-in theme effects (window.HubFX): one canvas behind the page's content (z-index -1,
 * like the living background), never in the way of taps. A theme names the effects it wants:
 *
 *   { type: 'snow' | 'rain' | 'lightning' | 'wind' | 'fireworks' | 'confetti' | 'hearts' | 'lanterns' |
 *           'stars' | 'leaves' | 'petals' | 'balloons' | 'bubbles' | 'embers' | 'dust' | 'fog' |
 *           'sunrays' | 'aurora' | 'glow' | 'crescent' | 'butterflies' | 'particles',
 *     intensity: 0..1 (how much), speed: 0.2..3, colors: ['#hex', ...], opacity: 0..1,
 *     only: 'light' | 'dark' (run in that mode only),
 *     // 'particles' (and every particle effect, to adjust it): shape, emoji, image (data: URI),
 *     // from: 'top' | 'bottom' | 'left' | 'right' | 'anywhere', size: [min, max], spin, sway, twinkle, fade }
 *
 * Off when the device asks for reduced motion, when the user switched effects off (localStorage
 * hub_fx_off = '1'), and while the page is hidden. Lightning is soft and spaced (never a strobe).
 */
(function (window, document) {
    'use strict';

    const OFF_KEY = 'hub_fx_off';
    const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const userOff = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; } };
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = list => list[Math.floor(Math.random() * list.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    let canvas = null, ctx = null, W = 0, H = 0, DPR = 1, raf = 0, last = 0, layers = [], running = false;
    const world = { wind: 0, windTarget: 0, gust: 0, flash: 0 };

    // -------------------------------------------------------------------------------------------
    // Shapes
    // -------------------------------------------------------------------------------------------
    const sprites = new Map();
    /** An emoji or an image drawn once on its own small canvas (fast to stamp each frame). */
    function sprite(key, draw, size) {
        if (sprites.has(key)) return sprites.get(key);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        draw(c.getContext('2d'), size);
        sprites.set(key, c);
        return c;
    }
    function emojiSprite(e) {
        return sprite('e:' + e, (g, s) => { g.font = `${s * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, s / 2, s / 2 + s * 0.05); }, 64);
    }
    const images = new Map();
    function imageOf(src) {
        if (!/^data:image\//.test(src || '')) return null;
        if (!images.has(src)) { const im = new Image(); im.src = src; images.set(src, im); }
        const im = images.get(src);
        return im.complete && im.naturalWidth ? im : null;
    }

    function heart(g, r) {
        g.beginPath();
        g.moveTo(0, r * 0.35);
        g.bezierCurveTo(-r * 1.1, -r * 0.35, -r * 0.55, -r * 1.1, 0, -r * 0.45);
        g.bezierCurveTo(r * 0.55, -r * 1.1, r * 1.1, -r * 0.35, 0, r * 0.35);
        g.fill();
    }
    function star(g, r, points = 5, inner = 0.45) {
        g.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const rr = i % 2 ? r * inner : r, a = (i * Math.PI) / points - Math.PI / 2;
            g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath(); g.fill();
    }
    function flake(g, r) {
        g.lineWidth = Math.max(1, r * 0.16); g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
            g.save(); g.rotate((i * Math.PI) / 3);
            g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r);
            g.moveTo(0, -r * 0.55); g.lineTo(-r * 0.25, -r * 0.78); g.moveTo(0, -r * 0.55); g.lineTo(r * 0.25, -r * 0.78);
            g.stroke(); g.restore();
        }
    }
    function leaf(g, r) {
        g.beginPath(); g.moveTo(0, -r);
        g.quadraticCurveTo(r * 0.9, -r * 0.2, 0, r); g.quadraticCurveTo(-r * 0.9, -r * 0.2, 0, -r); g.fill();
        g.globalAlpha *= 0.5; g.lineWidth = Math.max(1, r * 0.08); g.strokeStyle = 'rgba(0,0,0,.35)';
        g.beginPath(); g.moveTo(0, -r * 0.9); g.lineTo(0, r * 0.95); g.stroke();
    }
    function petal(g, r) { g.beginPath(); g.ellipse(0, 0, r * 0.55, r, 0, 0, Math.PI * 2); g.fill(); }
    function balloon(g, r, color) {
        g.beginPath(); g.ellipse(0, 0, r * 0.8, r, 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha *= 0.35; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-r * 0.3, -r * 0.35, r * 0.18, r * 0.3, -0.4, 0, Math.PI * 2); g.fill();
        g.globalAlpha /= 0.35; g.fillStyle = color;
        g.beginPath(); g.moveTo(-r * 0.12, r * 0.98); g.lineTo(r * 0.12, r * 0.98); g.lineTo(0, r * 1.12); g.fill();
        g.strokeStyle = 'rgba(120,120,120,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, r * 1.12);
        g.quadraticCurveTo(r * 0.3, r * 1.6, 0, r * 2.2); g.stroke();
    }
    function lantern(g, r, color) {
        // a Ramadan lantern: cap, glowing body with a frame, a ring, on a thin string
        g.strokeStyle = 'rgba(210,170,80,.75)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, -r * 2.6); g.lineTo(0, -r * 1.25); g.stroke();
        const glow = g.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.9);
        glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.save(); g.globalAlpha *= 0.35; g.fillStyle = glow; g.beginPath(); g.arc(0, 0, r * 1.9, 0, Math.PI * 2); g.fill(); g.restore();
        g.fillStyle = '#C9972F';
        g.beginPath(); g.moveTo(-r * 0.45, -r * 0.85); g.lineTo(r * 0.45, -r * 0.85); g.lineTo(0, -r * 1.3); g.closePath(); g.fill();
        g.fillStyle = color;
        g.beginPath(); g.moveTo(-r * 0.5, -r * 0.8); g.lineTo(r * 0.5, -r * 0.8); g.lineTo(r * 0.62, r * 0.55); g.lineTo(0, r * 0.95); g.lineTo(-r * 0.62, r * 0.55); g.closePath(); g.fill();
        g.strokeStyle = '#C9972F'; g.lineWidth = Math.max(1, r * 0.08);
        g.beginPath(); g.moveTo(0, -r * 0.8); g.lineTo(0, r * 0.95); g.moveTo(-r * 0.56, -r * 0.1); g.lineTo(r * 0.56, -r * 0.1); g.stroke();
    }
    function crescent(g, r) {
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(r * 0.42, -r * 0.18, r * 0.86, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
    }
    function butterfly(g, r, color, t) {
        const flap = 0.35 + Math.abs(Math.sin(t * 9)) * 0.65;
        g.save(); g.scale(flap, 1);
        g.beginPath(); g.ellipse(-r * 0.55, -r * 0.25, r * 0.55, r * 0.42, -0.5, 0, Math.PI * 2); g.ellipse(r * 0.55, -r * 0.25, r * 0.55, r * 0.42, 0.5, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(-r * 0.38, r * 0.32, r * 0.32, r * 0.26, 0.4, 0, Math.PI * 2); g.ellipse(r * 0.38, r * 0.32, r * 0.32, r * 0.26, -0.4, 0, Math.PI * 2); g.fill();
        g.restore();
        g.fillStyle = 'rgba(40,30,30,.8)'; g.beginPath(); g.ellipse(0, 0, r * 0.08, r * 0.5, 0, 0, Math.PI * 2); g.fill();
    }

    // -------------------------------------------------------------------------------------------
    // Particle effects (each preset is a particle recipe; 'particles' is the theme's own recipe)
    // -------------------------------------------------------------------------------------------
    const PRESETS = {
        snow: { shape: 'flake', from: 'top', count: 70, size: [3, 9], speed: [25, 70], sway: 30, spin: 0.6, colors: ['#ffffff'], opacity: [0.55, 0.95], windTaken: 1 },
        rain: { shape: 'drop', from: 'top', count: 110, size: [10, 22], speed: [520, 820], sway: 0, colors: ['#AFC8E8'], opacity: [0.25, 0.55], windTaken: 1.6 },
        hearts: { shape: 'heart', from: 'bottom', count: 22, size: [6, 14], speed: [18, 45], sway: 26, spin: 0.25, colors: ['#FF4D7E', '#FF8FAB', '#E5484D', '#FFB3C6'], opacity: [0.45, 0.85], fade: true },
        lanterns: { shape: 'lantern', from: 'hang', count: 7, size: [10, 18], speed: [0, 0], sway: 0, colors: ['#FFC94D', '#FF9F43', '#FFE08A'], opacity: [0.8, 1] },
        stars: { shape: 'star', from: 'anywhere', count: 55, size: [1.2, 3.6], speed: [0, 0], sway: 0, colors: ['#FFFFFF', '#FFE9A8', '#BFE8FF'], opacity: [0.3, 1], twinkle: true },
        leaves: { shape: 'leaf', from: 'top', count: 24, size: [7, 14], speed: [35, 80], sway: 60, spin: 2, colors: ['#D9822B', '#C0392B', '#E3A72F', '#8E5B2E', '#B5651D'], opacity: [0.7, 0.95], windTaken: 1.3 },
        petals: { shape: 'petal', from: 'top', count: 30, size: [4, 8], speed: [30, 65], sway: 50, spin: 1.6, colors: ['#FFC0D3', '#FFD6E2', '#FFFFFF', '#F7A1C4'], opacity: [0.55, 0.9], windTaken: 1.2 },
        balloons: { shape: 'balloon', from: 'bottom', count: 9, size: [12, 20], speed: [28, 55], sway: 22, spin: 0.15, colors: ['#E5484D', '#2EC4AC', '#E8A23A', '#6D5DD3', '#1FA971', '#FF7AB6'], opacity: [0.75, 0.95] },
        bubbles: { shape: 'bubble', from: 'bottom', count: 26, size: [4, 14], speed: [20, 50], sway: 22, colors: ['#BFE8FF'], opacity: [0.35, 0.7] },
        embers: { shape: 'dot', from: 'bottom', count: 40, size: [1.5, 3.5], speed: [30, 80], sway: 30, colors: ['#FFB347', '#FF7A3D', '#FFD27F'], opacity: [0.5, 1], fade: true, glow: true },
        dust: { shape: 'dot', from: 'right', count: 90, size: [1, 3], speed: [140, 320], sway: 12, colors: ['#D8B98A', '#C9A36A', '#E6CFA4'], opacity: [0.25, 0.6], windTaken: 1.4 },
        confetti: { shape: 'confetti', from: 'top', count: 60, size: [5, 9], speed: [60, 130], sway: 40, spin: 4, colors: ['#E5484D', '#2EC4AC', '#E8A23A', '#6D5DD3', '#1FA971', '#FF7AB6', '#5EE0C8'], opacity: [0.8, 1], windTaken: 1 },
        crescent: { shape: 'crescent', from: 'anywhere', count: 6, size: [6, 12], speed: [0, 0], sway: 0, colors: ['#FFE08A', '#FFFFFF'], opacity: [0.55, 0.9], twinkle: true, drift: 6 },
        butterflies: { shape: 'butterfly', from: 'left', count: 9, size: [8, 13], speed: [30, 60], sway: 40, colors: ['#FF9F43', '#6D5DD3', '#2EC4AC', '#FF7AB6', '#FFD166'], opacity: [0.8, 1] },
    };

    function particleLayer(cfg) {
        const base = Object.assign({}, PRESETS[cfg.type] || PRESETS.snow, cfg.type === 'particles' ? {} : {});
        const o = Object.assign({}, base, cfg);
        const intensity = clamp(cfg.intensity == null ? 0.6 : Number(cfg.intensity), 0.05, 1);
        const speedK = clamp(cfg.speed == null ? 1 : Number(cfg.speed), 0.2, 3);
        const area = clamp((W * H) / (420 * 900), 0.5, 2.2);
        const n = Math.round(clamp(o.count * intensity * 1.5 * area, 2, 180));
        const opa = Array.isArray(o.opacity) ? o.opacity : [o.opacity || 0.8, o.opacity || 0.8];
        const size = Array.isArray(o.size) ? o.size : [o.size || 6, o.size || 6];
        const spd = Array.isArray(o.speed) ? o.speed : [base.speed[0], base.speed[1]];
        const colors = Array.isArray(o.colors) && o.colors.length ? o.colors : ['#ffffff'];
        const ps = [];
        const spawn = (p, initial) => {
            p.size = rand(size[0], size[1]);
            p.v = rand(spd[0], spd[1]) * speedK;
            p.color = pick(colors);
            p.a = rand(opa[0], opa[1]);
            p.rot = rand(0, Math.PI * 2);
            p.vr = rand(-1, 1) * (o.spin || 0);
            p.phase = rand(0, Math.PI * 2);
            p.life = 0;
            p.emoji = o.emoji ? (Array.isArray(o.emoji) ? pick(o.emoji) : o.emoji) : null;
            p.image = o.image ? (Array.isArray(o.image) ? pick(o.image) : o.image) : null;
            const m = 40;
            switch (o.from) {
                case 'bottom': p.x = rand(0, W); p.y = initial ? rand(0, H) : H + m; break;
                case 'left': p.x = initial ? rand(0, W) : -m; p.y = rand(0, H * 0.85); break;
                case 'right': p.x = initial ? rand(0, W) : W + m; p.y = rand(0, H); break;
                case 'anywhere': p.x = rand(0, W); p.y = rand(0, H * (o.shape === 'star' ? 0.75 : 1)); break;
                case 'hang': p.x = rand(W * 0.04, W * 0.96); p.y = rand(30, 120); break;
                default: p.x = rand(-40, W + 40); p.y = initial ? rand(-H * 0.1, H) : -m;
            }
            return p;
        };
        for (let i = 0; i < n; i++) ps.push(spawn({}, true));
        // hanging lanterns sit spread along the top
        if (o.from === 'hang') ps.forEach((p, i) => { p.x = ((i + 0.5) / n) * W + rand(-20, 20); p.y = rand(40, 110); p.len = p.y; });
        return {
            only: cfg.only,
            update(dt, t) {
                for (const p of ps) {
                    p.life += dt;
                    const sway = Math.sin(t * 1.3 + p.phase) * (o.sway || 0);
                    const wind = world.wind * (o.windTaken || 0.5);
                    switch (o.from) {
                        case 'bottom': p.y -= p.v * dt; p.x += (sway * 0.6 + wind * 0.4) * dt; break;
                        case 'left': p.x += p.v * dt; p.y += Math.sin(t * 2 + p.phase) * 25 * dt; break;
                        case 'right': p.x -= p.v * dt - wind * dt; p.y += (sway * 0.3) * dt + Math.sin(t + p.phase) * 8 * dt; break;
                        case 'anywhere': if (o.drift) p.x += Math.sin(t * 0.2 + p.phase) * o.drift * dt; break;
                        case 'hang': break;
                        default: p.y += p.v * dt; p.x += (sway + wind) * dt;
                    }
                    p.rot += p.vr * dt;
                    const out = p.y > H + 60 || p.y < -80 || p.x < -90 || p.x > W + 90;
                    if (out && o.from !== 'anywhere' && o.from !== 'hang') spawn(p, false);
                }
            },
            draw(g, t) {
                for (const p of ps) {
                    let a = p.a * (o.globalOpacity || 1);
                    if (o.twinkle) a *= 0.45 + 0.55 * Math.abs(Math.sin(t * (0.7 + (p.phase % 1.3)) + p.phase));
                    if (o.fade && o.from === 'bottom') a *= clamp(p.y / (H * 0.9), 0, 1);
                    if (a <= 0.01) continue;
                    g.save();
                    g.globalAlpha = a;
                    g.translate(p.x, p.y);
                    if (o.from === 'hang') g.rotate(Math.sin(t * 0.9 + p.phase) * 0.12);
                    else g.rotate(p.rot);
                    g.fillStyle = p.color; g.strokeStyle = p.color;
                    const r = p.size;
                    if (o.glow) { g.shadowColor = p.color; g.shadowBlur = r * 4; }
                    if (p.image) { const im = imageOf(p.image); if (im) g.drawImage(im, -r * 1.4, -r * 1.4, r * 2.8, r * 2.8); }
                    else if (p.emoji) g.drawImage(emojiSprite(p.emoji), -r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
                    else switch (o.shape) {
                        case 'flake': r > 5 ? flake(g, r) : (g.beginPath(), g.arc(0, 0, r * 0.55, 0, Math.PI * 2), g.fill()); break;
                        case 'drop': g.rotate(-p.rot + Math.atan2(world.wind * (o.windTaken || 1) * 0.0018, 1)); g.lineWidth = 1.3; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, r); g.stroke(); break;
                        case 'heart': heart(g, r); break;
                        case 'star': r > 2.4 ? star(g, r, 4, 0.35) : (g.beginPath(), g.arc(0, 0, r, 0, Math.PI * 2), g.fill()); break;
                        case 'leaf': leaf(g, r); break;
                        case 'petal': petal(g, r); break;
                        case 'balloon': g.rotate(-p.rot * 0.7); balloon(g, r, p.color); break;
                        case 'bubble': g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = a * 0.5; g.fillStyle = '#fff'; g.beginPath(); g.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2); g.fill(); break;
                        case 'confetti': g.fillRect(-r * 0.5, -r * 0.25, r, r * 0.5 * (0.4 + Math.abs(Math.sin(t * 6 + p.phase)))); break;
                        case 'lantern': lantern(g, r, p.color); break;
                        case 'crescent': g.rotate(-p.rot - 0.5); crescent(g, r); break;
                        case 'butterfly': g.rotate(-p.rot); butterfly(g, r, p.color, t + p.phase); break;
                        default: g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
                    }
                    g.restore();
                }
            },
        };
    }

    // -------------------------------------------------------------------------------------------
    // Atmosphere effects
    // -------------------------------------------------------------------------------------------
    function windLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.6 : Number(cfg.intensity), 0.05, 1);
        const dir = cfg.direction === 'left' ? -1 : 1;
        const streaks = [];
        const n = Math.round(10 + 26 * intensity);
        for (let i = 0; i < n; i++) streaks.push({ x: rand(0, W), y: rand(0, H), len: rand(40, 140), v: rand(300, 700), a: rand(0.05, 0.16) });
        let next = 0;
        return {
            only: cfg.only,
            update(dt, t) {
                if (t > next) { world.windTarget = dir * rand(40, 220) * intensity * (Math.random() < 0.3 ? 2 : 1); next = t + rand(2, 6); }
                world.wind += (world.windTarget - world.wind) * Math.min(1, dt * 0.8);
                for (const s of streaks) {
                    s.x += (s.v * dir + world.wind) * dt * (0.4 + Math.abs(world.wind) / 250);
                    if (s.x > W + 200) { s.x = -s.len; s.y = rand(0, H); }
                    if (s.x < -200) { s.x = W + s.len; s.y = rand(0, H); }
                }
            },
            draw(g) {
                if (cfg.streaks === false) return;
                g.save(); g.strokeStyle = cfg.color || (document.documentElement.classList.contains('dark') ? '#ffffff' : '#7a8a86'); g.lineWidth = 1; g.lineCap = 'round';
                const k = clamp(Math.abs(world.wind) / 200, 0.2, 1);
                for (const s of streaks) { g.globalAlpha = s.a * k; g.beginPath(); g.moveTo(s.x, s.y); g.quadraticCurveTo(s.x + s.len * 0.5 * dir, s.y - 6, s.x + s.len * dir, s.y); g.stroke(); }
                g.restore();
            },
        };
    }

    function lightningLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.5 : Number(cfg.intensity), 0.05, 1);
        let next = rand(2.5, 6), bolt = null, flash = 0, second = 0;
        const makeBolt = () => {
            const pts = []; let x = rand(W * 0.15, W * 0.85), y = -10;
            const end = rand(H * 0.35, H * 0.7);
            while (y < end) { pts.push([x, y]); x += rand(-38, 38); y += rand(18, 46); }
            const branch = pts.length > 4 ? pts.slice(Math.floor(pts.length / 2)).map(([bx, by], i) => [bx + i * rand(8, 22), by + i * 6]) : [];
            return { pts, branch, life: 0.26 };
        };
        return {
            only: cfg.only,
            update(dt, t) {
                // Soft and spaced: one flash (sometimes a second, softer one) every few seconds; never a strobe.
                if (t > next) {
                    flash = 0.16 + 0.22 * intensity;
                    second = Math.random() < 0.5 ? t + rand(0.18, 0.32) : 0;
                    bolt = Math.random() < 0.75 ? makeBolt() : null;
                    next = t + rand(3.5, 9) / (0.5 + intensity * 0.7);
                }
                if (second && t > second) { flash = Math.max(flash, 0.08 + 0.1 * intensity); second = 0; }
                flash = Math.max(0, flash - dt * 0.9);
                if (bolt) { bolt.life -= dt; if (bolt.life <= 0) bolt = null; }
            },
            draw(g) {
                if (flash > 0) { g.save(); g.globalAlpha = flash; g.fillStyle = cfg.color || '#E8F0FF'; g.fillRect(0, 0, W, H); g.restore(); }
                if (bolt) {
                    g.save(); g.globalAlpha = clamp(bolt.life / 0.26, 0, 1) * 0.9;
                    g.strokeStyle = '#F4F8FF'; g.shadowColor = '#9EC5FF'; g.shadowBlur = 18; g.lineWidth = 2.2; g.lineJoin = 'round';
                    g.beginPath(); bolt.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
                    if (bolt.branch.length) { g.lineWidth = 1.2; g.beginPath(); bolt.branch.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
                    g.restore();
                }
            },
        };
    }

    function fireworksLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.6 : Number(cfg.intensity), 0.05, 1);
        const colors = Array.isArray(cfg.colors) && cfg.colors.length ? cfg.colors : ['#FFD166', '#EF476F', '#06D6A0', '#5EE0C8', '#FF9F1C', '#C77DFF', '#FFFFFF'];
        const rockets = [], sparks = [];
        let next = 0.5;
        return {
            only: cfg.only,
            update(dt, t) {
                if (t > next && rockets.length < 3) {
                    rockets.push({ x: rand(W * 0.12, W * 0.88), y: H + 10, vy: -rand(H * 0.75, H * 1.05), vx: rand(-30, 30), target: rand(H * 0.12, H * 0.45), color: pick(colors) });
                    next = t + rand(0.7, 2.2) / (0.4 + intensity);
                }
                for (let i = rockets.length - 1; i >= 0; i--) {
                    const r = rockets[i];
                    r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 220 * dt;
                    if (r.y <= r.target || r.vy >= -40) {
                        const count = Math.round(40 + 50 * intensity), round = Math.random() < 0.6;
                        for (let k = 0; k < count; k++) {
                            const a = (k / count) * Math.PI * 2 + rand(-0.05, 0.05), sp = round ? rand(90, 150) : rand(30, 170);
                            sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(1.1, 1.9), max: 1.9, color: Math.random() < 0.8 ? r.color : pick(colors) });
                        }
                        rockets.splice(i, 1);
                    }
                }
                for (let i = sparks.length - 1; i >= 0; i--) {
                    const s = sparks[i];
                    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * dt; s.vx *= 1 - dt * 0.9; s.vy *= 1 - dt * 0.6; s.life -= dt;
                    if (s.life <= 0) sparks.splice(i, 1);
                }
                if (sparks.length > 700) sparks.splice(0, sparks.length - 700);
            },
            draw(g) {
                g.save(); g.globalCompositeOperation = 'lighter';
                for (const r of rockets) { g.globalAlpha = 0.9; g.fillStyle = r.color; g.beginPath(); g.arc(r.x, r.y, 2, 0, Math.PI * 2); g.fill(); g.globalAlpha = 0.25; g.fillRect(r.x - 0.7, r.y, 1.4, 22); }
                for (const s of sparks) { g.globalAlpha = clamp(s.life / s.max, 0, 1); g.fillStyle = s.color; g.beginPath(); g.arc(s.x, s.y, 1.7, 0, Math.PI * 2); g.fill(); }
                g.restore();
            },
        };
    }

    function fogLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.5 : Number(cfg.intensity), 0.05, 1);
        const color = cfg.color || (document.documentElement.classList.contains('dark') ? '200,215,225' : '255,255,255');
        const rgb = /^#/.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).join(',') : color;
        const blobs = Array.from({ length: 6 }, () => ({ x: rand(0, W), y: rand(H * 0.2, H), r: rand(W * 0.35, W * 0.8), v: rand(6, 18) * (Math.random() < 0.5 ? -1 : 1), a: rand(0.05, 0.12) * intensity * 1.6 }));
        return {
            only: cfg.only,
            update(dt) { for (const b of blobs) { b.x += (b.v + world.wind * 0.1) * dt; if (b.x - b.r > W) b.x = -b.r; if (b.x + b.r < 0) b.x = W + b.r; } },
            draw(g) {
                for (const b of blobs) {
                    const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
                    gr.addColorStop(0, `rgba(${rgb},${b.a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
                    g.fillStyle = gr; g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
                }
            },
        };
    }

    function sunraysLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.5 : Number(cfg.intensity), 0.05, 1);
        const color = cfg.color || '#FFE6A8';
        const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).join(',');
        const left = cfg.corner === 'left';
        return {
            only: cfg.only,
            update() {},
            draw(g, t) {
                const ox = left ? -W * 0.1 : W * 1.1, oy = -H * 0.12, n = 9;
                g.save();
                for (let i = 0; i < n; i++) {
                    const a0 = (left ? 0.15 : Math.PI - 1.35) + i * 0.13 + Math.sin(t * 0.15 + i) * 0.03;
                    const len = Math.hypot(W, H) * 1.2;
                    const gr = g.createLinearGradient(ox, oy, ox + Math.cos(a0) * len, oy + Math.sin(a0) * len);
                    const al = (0.05 + 0.05 * Math.sin(t * 0.4 + i * 1.7)) * intensity * 1.4;
                    gr.addColorStop(0, `rgba(${rgb},${al})`); gr.addColorStop(1, `rgba(${rgb},0)`);
                    g.fillStyle = gr; g.beginPath(); g.moveTo(ox, oy);
                    g.lineTo(ox + Math.cos(a0) * len, oy + Math.sin(a0) * len); g.lineTo(ox + Math.cos(a0 + 0.06) * len, oy + Math.sin(a0 + 0.06) * len);
                    g.closePath(); g.fill();
                }
                g.restore();
            },
        };
    }

    function glowLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.5 : Number(cfg.intensity), 0.05, 1);
        const colors = Array.isArray(cfg.colors) && cfg.colors.length ? cfg.colors : ['#FF7AB6', '#6D5DD3'];
        const orbs = colors.map((c, i) => ({ c, x: rand(0, W), y: rand(0, H), r: rand(W * 0.4, W * 0.7), p: i * 2 }));
        return {
            only: cfg.only,
            update() {},
            draw(g, t) {
                for (const o of orbs) {
                    const x = o.x + Math.sin(t * 0.12 + o.p) * W * 0.12, y = o.y + Math.cos(t * 0.1 + o.p) * H * 0.08;
                    const rgb = [1, 3, 5].map(i => parseInt(o.c.slice(i, i + 2), 16)).join(',');
                    const gr = g.createRadialGradient(x, y, 0, x, y, o.r);
                    gr.addColorStop(0, `rgba(${rgb},${0.16 * intensity})`); gr.addColorStop(1, `rgba(${rgb},0)`);
                    g.fillStyle = gr; g.fillRect(x - o.r, y - o.r, o.r * 2, o.r * 2);
                }
            },
        };
    }

    function auroraLayer(cfg) {
        const intensity = clamp(cfg.intensity == null ? 0.6 : Number(cfg.intensity), 0.05, 1);
        const colors = Array.isArray(cfg.colors) && cfg.colors.length ? cfg.colors : ['#5EE0C8', '#7CFFB2', '#8E7CFF'];
        return {
            only: cfg.only,
            update() {},
            draw(g, t) {
                g.save(); g.globalCompositeOperation = 'lighter';
                colors.forEach((c, k) => {
                    const rgb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(',');
                    const base = H * (0.14 + k * 0.07);
                    const gr = g.createLinearGradient(0, base - 90, 0, base + 120);
                    gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(0.45, `rgba(${rgb},${0.13 * intensity})`); gr.addColorStop(1, `rgba(${rgb},0)`);
                    g.fillStyle = gr; g.beginPath(); g.moveTo(0, base + 120);
                    for (let x = 0; x <= W; x += 16) g.lineTo(x, base + Math.sin(x * 0.006 + t * (0.25 + k * 0.08) + k) * 40 + Math.sin(x * 0.013 - t * 0.2) * 18);
                    g.lineTo(W, base + 120); g.closePath(); g.fill();
                });
                g.restore();
            },
        };
    }

    const BUILD = { wind: windLayer, lightning: lightningLayer, fireworks: fireworksLayer, fog: fogLayer, sunrays: sunraysLayer, aurora: auroraLayer, glow: glowLayer };

    // -------------------------------------------------------------------------------------------
    // The loop
    // -------------------------------------------------------------------------------------------
    let wanted = [];
    // Inside the app every page is a frame; the hidden ones stay rendered, so only the page on screen animates.
    const myFrame = (() => { try { return window.frameElement; } catch (e) { return null; } })();
    const frameHidden = () => !!(myFrame && myFrame.classList.contains('app-view') && !myFrame.classList.contains('active'));
    if (myFrame && window.MutationObserver) new MutationObserver(() => { if (frameHidden()) stopLoop(); else startLoop(); }).observe(myFrame, { attributes: true, attributeFilter: ['class'] });
    function resize() {
        if (!canvas) return;
        DPR = Math.min(window.devicePixelRatio || 1, 1.5);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function build() {
        world.wind = 0; world.windTarget = 0;
        layers = wanted.map(cfg => (BUILD[cfg.type] ? BUILD[cfg.type](cfg) : particleLayer(cfg)));
    }
    function frame(ts) {
        if (!running) return;
        raf = requestAnimationFrame(frame);
        const t = ts / 1000;
        const dt = Math.min(0.05, last ? t - last : 0.016);
        last = t;
        ctx.clearRect(0, 0, W, H);
        const dark = document.documentElement.classList.contains('dark');
        for (const l of layers) {
            if (l.only && (l.only === 'dark') !== dark) continue;
            l.update(dt, t);
            l.draw(ctx, t);
        }
    }
    function stopLoop() { running = false; cancelAnimationFrame(raf); raf = 0; last = 0; if (ctx) ctx.clearRect(0, 0, W, H); }
    function startLoop() {
        if (running || !wanted.length || reduced() || userOff() || document.hidden || frameHidden()) return;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'hub-fx';
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;';
            (document.body || document.documentElement).appendChild(canvas);
            ctx = canvas.getContext('2d');
            window.addEventListener('resize', () => { resize(); build(); });
        }
        resize(); build();
        running = true;
        raf = requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); });

    window.HubFX = {
        /** Runs these effects (a theme's list); [] stops them. */
        set(effects) {
            wanted = Array.isArray(effects) ? effects.filter(e => e && typeof e === 'object' && e.type) : [];
            stopLoop();
            if (!wanted.length) { if (canvas) { canvas.remove(); canvas = null; ctx = null; } return; }
            if (document.body) startLoop(); else document.addEventListener('DOMContentLoaded', startLoop, { once: true });
        },
        /** The user's "reduce effects" switch. */
        setOff(off) {
            try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch (e) {}
            if (off) stopLoop(); else startLoop();
        },
        isOff: userOff,
        EFFECTS: ['snow', 'rain', 'lightning', 'wind', 'fireworks', 'confetti', 'hearts', 'lanterns', 'stars', 'leaves', 'petals', 'balloons', 'bubbles', 'embers', 'dust', 'fog', 'sunrays', 'aurora', 'glow', 'crescent', 'butterflies', 'particles'],
    };
})(window, document);
