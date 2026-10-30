/**
 * ER preferences history: a resident's preferences month by month (with their note, and what they
 * sent on the old Google Form), 5 months per page, newest first. Shared by My Schedule (the
 * resident's own) and the ER page (the owner and the admins who use it).
 *
 * HubPrefHistory.mount(box, load) where load(before) resolves to { entries, more }: a page is
 * fetched only when shown (and kept), so reading costs a few rows per page.
 */
(function (window, document) {
    'use strict';

    const MONTHS = ['', 'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const SHIFTS = { morning: 'الصباحية', afternoon: 'بعد الصباحية', preNight: 'البرينايت', lateNight: 'الليلية' };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const monthTitle = ym => `${MONTHS[Number(ym.slice(5, 7))]} ${ym.slice(0, 4)}`;
    const day = iso => `${Number(String(iso).slice(8))}/${Number(String(iso).slice(5, 7))}`;

    /** Days preferred / off of an entry (older entries have one list and a mode). */
    function dayLists(p) {
        if (Array.isArray(p.daysPrefer) || Array.isArray(p.daysExclude)) return { prefer: p.daysPrefer || [], exclude: p.daysExclude || [] };
        const one = p.specificDays || [];
        return p.prefDaysMode === 'prefer' ? { prefer: one, exclude: [] } : { prefer: [], exclude: one };
    }

    function prefsHtml(p) {
        if (!p) return '';
        const out = [];
        const chip = (cls, icon, text) => out.push(`<span class="hph-chip ${cls}"><i class="fas ${icon}"></i> ${text}</span>`);
        if ((p.prefShifts || []).length) chip('sh', 'fa-clock', esc(p.prefShifts.map(s => SHIFTS[s] || s).join('، ')));
        if ((p.prefDays || []).length) chip('wd', 'fa-calendar-week', esc(p.prefDays.join('، ')));
        const d = dayLists(p);
        if (d.prefer.length) chip('pr', 'fa-check', 'أيام مفضلة: ' + esc(d.prefer.join('، ')));
        if (d.exclude.length) chip('ex', 'fa-ban', 'أيام مستبعدة: ' + esc(d.exclude.join('، ')));
        (p.excludedIntervals || []).forEach(iv => chip('iv', p.intervalMode === 'strictly_within' ? 'fa-bullseye' : 'fa-ban',
            `${p.intervalMode === 'strictly_within' ? 'حصراً' : 'استبعاد'} من ${esc(day(iv.start))} إلى ${esc(day(iv.end))}`));
        if (p.noConsecutiveDays === false) chip('', 'fa-repeat', 'يقبل أياماً متتالية');
        return out.length ? `<div class="hph-chips">${out.join('')}</div>` : '';
    }

    // A note's lines run on in one paragraph (a thin dot between them) to keep the entry short.
    const lines = t => String(t || '').split(/\s*\n+\s*/).filter(Boolean).map(esc).join('<i class="hph-sep">·</i>');

    /** The month, what was asked for, and the notes (the resident's own words, wherever they came from). */
    function entryHtml(e) {
        const notes = [];
        if (e.note) notes.push({ text: e.note });
        const items = e.imported && Array.isArray(e.imported.items) ? e.imported.items : [];
        items.forEach(([label, text]) => {
            // Several answers in one month carry their date ("… · 21/10/2026 19:30"): shown small.
            const d = String(label || '').match(/(\d{1,2})\/(\d{1,2})\/\d{4}/);
            notes.push({ text, when: items.length > 1 && d ? `${Number(d[1])}/${Number(d[2])}` : '' });
        });
        const [mName, year] = [MONTHS[Number(e.ym.slice(5, 7))], e.ym.slice(0, 4)];
        return `<article class="hph-entry">
            <div class="hph-month"><b>${esc(mName)}</b><span>${esc(year)}</span></div>
            <div class="hph-body">
                ${e.prefs ? prefsHtml(e.prefs) : ''}
                ${notes.map(n => `<p class="hph-text">${n.when ? `<time>${esc(n.when)}</time>` : ''}${lines(n.text)}</p>`).join('')}
            </div>
        </article>`;
    }

    function mount(box, load) {
        injectCss();
        const pages = [];      // { entries, more } per page number
        const cursors = [''];  // the `before` of each page
        let at = 0;
        const show = async n => {
            box.innerHTML = '<div class="hph"><div class="hph-muted hph-pad">جاري التحميل…</div></div>';
            try {
                if (!pages[n]) pages[n] = await load(cursors[n]);
            } catch (err) {
                box.innerHTML = `<div class="hph"><div class="hph-muted hph-pad">${esc((err && err.message) || 'تعذر التحميل')}</div></div>`;
                return;
            }
            at = n;
            const pg = pages[n];
            if (pg.more && pg.entries.length) cursors[n + 1] = pg.entries[pg.entries.length - 1].ym;
            box.innerHTML = `<div class="hph">
                ${pg.entries.length ? pg.entries.map(entryHtml).join('') : `<div class="hph-muted hph-pad">${n ? 'لا توجد أشهر أقدم.' : 'لا يوجد سجل رغبات بعد.'}</div>`}
                ${n || pg.more ? `<nav class="hph-nav">
                    <button type="button" data-go="${n - 1}" ${n ? '' : 'disabled'}><i class="fas fa-chevron-right"></i> الأحدث</button>
                    <span>صفحة ${n + 1}</span>
                    <button type="button" data-go="${n + 1}" ${pg.more ? '' : 'disabled'}>الأقدم <i class="fas fa-chevron-left"></i></button></nav>` : ''}
            </div>`;
            box.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(Number(b.dataset.go))));
        };
        show(0);
        return { reload: () => { pages.length = 0; show(0); }, page: () => at };
    }

    function injectCss() {
        if (document.getElementById('hub-prefhistory-css')) return;
        const st = document.createElement('style');
        st.id = 'hub-prefhistory-css';
        st.textContent = `
.hph { --hph-line: rgba(120, 128, 145, 0.25); --hph-soft: rgba(120, 128, 145, 0.07); display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; }
.hph-pad { padding: 18px 8px; text-align: center; }
.hph-muted { color: #8d94a3; font-size: 0.76rem; }
.hph-entry { display: grid; grid-template-columns: 62px 1fr; gap: 10px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--hph-line); background: var(--hph-soft); }
.hph-month { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 2px; border-inline-end: 1px solid var(--hph-line); padding-inline-end: 10px; }
.hph-month b { font-size: 0.78rem; font-weight: 800; line-height: 1.3; text-align: center; }
.hph-month span { font-size: 0.66rem; font-weight: 700; color: #8d94a3; }
.hph-body { min-width: 0; display: flex; flex-direction: column; gap: 6px; justify-content: center; }
.hph-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.hph-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 8px; font-size: 0.68rem; font-weight: 700; background: rgba(100, 116, 139, 0.12); color: inherit; line-height: 1.5; }
.hph-chip i { font-size: 0.6rem; opacity: 0.8; }
.hph-chip.sh { background: rgba(14, 165, 233, 0.12); color: #0369a1; }
.hph-chip.wd { background: rgba(20, 184, 166, 0.12); color: #0f766e; }
.hph-chip.pr { background: rgba(16, 185, 129, 0.14); color: #047857; }
.hph-chip.ex { background: rgba(225, 29, 72, 0.12); color: #be123c; }
.hph-chip.iv { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.hph-text { margin: 0; font-size: 0.78rem; line-height: 1.65; overflow-wrap: anywhere; }
.hph-sep { font-style: normal; color: #a1a8b5; margin: 0 5px; font-weight: 800; }
.hph-text + .hph-text { padding-top: 6px; border-top: 1px dashed var(--hph-line); }
.hph-text time { display: inline-block; margin-inline-end: 6px; padding: 0 6px; border-radius: 6px; background: rgba(100, 116, 139, 0.14); color: #8d94a3; font-size: 0.64rem; font-weight: 800; line-height: 1.6; vertical-align: 1px; }
.hph-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px; }
.hph-nav span { font-size: 0.72rem; font-weight: 800; color: #8d94a3; }
.hph-nav button { min-height: 38px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--hph-line); background: transparent; color: inherit; font: 800 0.76rem/1 inherit; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.hph-nav button:disabled { opacity: 0.4; cursor: default; }
html.dark .hph-chip.sh, body.dark .hph-chip.sh { color: #7dd3fc; } html.dark .hph-chip.wd, body.dark .hph-chip.wd { color: #5eead4; }
html.dark .hph-chip.pr, body.dark .hph-chip.pr { color: #6ee7b7; } html.dark .hph-chip.ex, body.dark .hph-chip.ex { color: #fda4af; }
html.dark .hph-chip.iv, body.dark .hph-chip.iv { color: #fcd34d; }
`;
        document.head.appendChild(st);
    }

    window.HubPrefHistory = { mount, prefsHtml, dayLists };
})(window, document);
