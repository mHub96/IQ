/**
 * The ER page's structure editor (window.ERStructure): per hospital, the ER's sectors (men's,
 * women's, children's…), for each shift the divisions of each sector (Green / Yellow / any name),
 * the branch each division prefers (surgical / medical) and how many residents it has; the daily
 * duties of the consultation clinic and of death certificates with their hours; and the hospital's
 * short code for file names. See emergency-layout.js for the model.
 */
(function (window, document) {
    'use strict';

    const core = () => window.EmergencyCore;
    const S = () => core().state();
    const L = () => window.ERLayout;
    const notify = (msg, type) => { try { core().showNotification(msg, type || 'info'); } catch (e) {} };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clone = o => JSON.parse(JSON.stringify(o));
    const newId = () => 's' + Math.random().toString(36).slice(2, 7);

    const SECTOR_PRESETS = ['طوارئ الرجال', 'طوارئ النساء', 'طوارئ الأطفال'];
    const DIVISION_PRESETS = [['الطوارئ الخضراء', 'surgical'], ['الطوارئ الصفراء', 'medical']];

    let draft = null;

    function normalize(struct) {
        const d = clone(struct || L().CLASSIC);
        d.sectors = Array.isArray(d.sectors) ? d.sectors : [];
        d.shifts = d.shifts && typeof d.shifts === 'object' ? d.shifts : {};
        L().SHIFTS.forEach(sh => { if (!Array.isArray(d.shifts[sh])) d.shifts[sh] = []; });
        d.con = Array.isArray(d.con) ? d.con : [];
        d.dc = Array.isArray(d.dc) ? d.dc : [];
        return d;
    }

    /** Basra Teaching Hospital's layout: men / women, Green and Yellow in the two middle shifts. */
    function basraPreset() {
        const men = { id: newId(), name: 'طوارئ الرجال' }, women = { id: newId(), name: 'طوارئ النساء' };
        const single = id => ({ sector: id, divisions: [{ name: '', branch: '', count: 1 }] });
        const split = id => ({ sector: id, divisions: DIVISION_PRESETS.map(([name, branch]) => ({ name, branch, count: 1 })) });
        return {
            sectors: [women, men],
            shifts: {
                morning: [single(women.id), single(men.id)],
                afternoon: [split(women.id), split(men.id)],
                preNight: [split(women.id), split(men.id)],
                lateNight: [single(women.id), single(men.id)],
            },
            con: [], dc: [], code: draft ? draft.code : '',
        };
    }

    // ------------------------------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------------------------------
    function entryOf(shift, sectorId) { return draft.shifts[shift].find(e => e.sector === sectorId) || null; }
    const shiftCount = shift => L().layoutFrom(draft).er.filter(p => p.shift === shift).length;

    function sectorsHtml() {
        return `<section class="erst-sec">
            <h4><i class="fas fa-hospital"></i> أقسام الطوارئ</h4>
            <p class="erst-hint">بدون أقسام: مقيم واحد في كل وجبة (النظام الحالي). أضف الأقسام ثم حدّد لكل وجبة شُعب كل قسم وعدد مقيميها.</p>
            <div class="erst-list">${draft.sectors.map((sec, i) => `
                <div class="erst-row">
                    <input class="erst-in" data-sector-name="${i}" value="${esc(sec.name)}" placeholder="اسم القسم" maxlength="40">
                    <button type="button" class="erst-x" data-act="del-sector" data-i="${i}" title="حذف القسم"><i class="fas fa-trash-can"></i></button>
                </div>`).join('') || '<div class="erst-empty">لا توجد أقسام</div>'}</div>
            <div class="erst-chips">${SECTOR_PRESETS.filter(n => !draft.sectors.some(s => s.name === n)).map(n => `<button type="button" class="erst-chip" data-act="add-sector" data-name="${esc(n)}"><i class="fas fa-plus"></i> ${esc(n)}</button>`).join('')}
                <button type="button" class="erst-chip" data-act="add-sector" data-name=""><i class="fas fa-plus"></i> قسم آخر</button></div>
        </section>`;
    }

    function shiftHtml(shift) {
        const info = L().SHIFT_INFO[shift];
        const n = shiftCount(shift);
        const body = draft.sectors.length ? draft.sectors.map(sec => {
            const e = entryOf(shift, sec.id);
            return `<div class="erst-sector ${e ? '' : 'off'}">
                <label class="erst-check"><input type="checkbox" data-act="toggle-sector" data-shift="${shift}" data-sector="${sec.id}" ${e ? 'checked' : ''}> <b>${esc(sec.name || 'قسم')}</b></label>
                ${e ? `<div class="erst-divs">${e.divisions.map((dv, j) => `
                    <div class="erst-div">
                        <input class="erst-in" list="erst-div-names" data-div="name" data-shift="${shift}" data-sector="${sec.id}" data-j="${j}" value="${esc(dv.name)}" placeholder="${e.divisions.length > 1 ? 'اسم الشعبة' : 'بلا شُعب'}" maxlength="40">
                        <select class="erst-in sm" data-div="branch" data-shift="${shift}" data-sector="${sec.id}" data-j="${j}" title="الفرع المفضّل في هذه الشعبة">
                            <option value="" ${!dv.branch ? 'selected' : ''}>أي فرع</option>
                            <option value="surgical" ${dv.branch === 'surgical' ? 'selected' : ''}>الفروع الجراحية</option>
                            <option value="medical" ${dv.branch === 'medical' ? 'selected' : ''}>الفروع الباطنية</option>
                        </select>
                        <select class="erst-in xs" data-div="count" data-shift="${shift}" data-sector="${sec.id}" data-j="${j}" title="عدد المقيمين">
                            ${[1, 2, 3, 4].map(c => `<option value="${c}" ${Number(dv.count) === c ? 'selected' : ''}>${c} ${c === 1 ? 'مقيم' : 'مقيمين'}</option>`).join('')}
                        </select>
                        ${e.divisions.length > 1 ? `<button type="button" class="erst-x" data-act="del-div" data-shift="${shift}" data-sector="${sec.id}" data-j="${j}" title="حذف الشعبة"><i class="fas fa-xmark"></i></button>` : ''}
                    </div>`).join('')}
                    <div class="erst-chips">
                        ${DIVISION_PRESETS.filter(([name]) => !e.divisions.some(d => d.name === name)).map(([name, branch]) => `<button type="button" class="erst-chip" data-act="add-div" data-shift="${shift}" data-sector="${sec.id}" data-name="${esc(name)}" data-branch="${branch}"><i class="fas fa-plus"></i> ${esc(name)}</button>`).join('')}
                        <button type="button" class="erst-chip" data-act="add-div" data-shift="${shift}" data-sector="${sec.id}" data-name="" data-branch=""><i class="fas fa-plus"></i> شعبة أخرى</button>
                    </div></div>` : ''}
            </div>`;
        }).join('') : '<div class="erst-empty">مقيم واحد (لا توجد أقسام)</div>';
        return `<section class="erst-sec erst-shift">
            <h4><i class="fas ${info.icon}"></i> ${info.name} <small>${info.time}</small><span class="erst-n">${n} ${n === 1 ? 'مقيم' : 'مقيمين'}</span></h4>
            ${body}
            ${draft.sectors.length ? `<button type="button" class="erst-link" data-act="copy-shift" data-shift="${shift}"><i class="fas fa-copy"></i> نسخ هذه الوجبة إلى الوجبات الأخرى</button>` : ''}
        </section>`;
    }

    function timesHtml(kind) {
        const list = draft[kind];
        const title = kind === 'dc' ? 'شهادات الوفاة' : 'الاستشارية الخافرة';
        const problems = L().checkTimes(list, kind === 'dc');
        return `<section class="erst-sec">
            <h4><i class="fas ${kind === 'dc' ? 'fa-file-medical' : 'fa-user-doctor'}"></i> ${title}</h4>
            <p class="erst-hint">${kind === 'dc' ? 'بلا خفارات = مقيم واحد 24 ساعة. أو قسّم اليوم إلى خفارات تغطي الـ 24 ساعة كاملة بلا فجوات ولا تداخل (مثل 8ص-8م و8م-8ص).' : 'بلا خفارات = مقيم واحد في اليوم. أو حدّد خفارات اليوم بأوقاتها (مثل 4م-7م و7م-12ص)، بلا تداخل.'} كل خفارة تُحسب خفارة كاملة من نصاب ${kind === 'dc' ? 'شهادات الوفاة' : 'الاستشارية'}.</p>
            <div class="erst-list">${list.map((p, i) => `
                <div class="erst-row">
                    <span class="erst-num">${i + 1}</span>
                    <label class="erst-time">من <input type="time" class="erst-in" data-time="start" data-kind="${kind}" data-i="${i}" value="${esc(p.start || '')}"></label>
                    <label class="erst-time">إلى <input type="time" class="erst-in" data-time="end" data-kind="${kind}" data-i="${i}" value="${esc(p.end || '')}"></label>
                    <span class="erst-span">${p.start && p.end ? Math.round(L().spanMin(p) / 6) / 10 + ' س' : ''}</span>
                    <button type="button" class="erst-x" data-act="del-time" data-kind="${kind}" data-i="${i}" title="حذف"><i class="fas fa-trash-can"></i></button>
                </div>`).join('') || '<div class="erst-empty">مقيم واحد في اليوم</div>'}</div>
            ${problems.length ? `<div class="erst-warn"><i class="fas fa-triangle-exclamation"></i> ${problems.map(esc).join('<br>')}</div>` : ''}
            <button type="button" class="erst-chip" data-act="add-time" data-kind="${kind}"><i class="fas fa-plus"></i> إضافة خفارة</button>
        </section>`;
    }

    function render() {
        const modal = document.getElementById('er-structure-modal');
        if (!modal) return;
        const st = S();
        const keep = (modal.querySelector('.erst-body') || {}).scrollTop || 0;
        const hosp = window.Hub && window.Hub.getHospital ? window.Hub.getHospital(st.hospitalId) : null;
        modal.innerHTML = `<div class="erst-panel" role="dialog" aria-modal="true" aria-label="هيكلية الطوارئ">
            <header class="erst-head">
                <div><h3><i class="fas fa-sitemap"></i> هيكلية الخفارات</h3><p>${esc((hosp && (hosp.name_ar || hosp.hospitalName)) || st.hospitalName || '')} · لكل مستشفى هيكليته</p></div>
                <button type="button" class="erst-x big" data-act="close" aria-label="إغلاق"><i class="fas fa-xmark"></i></button>
            </header>
            <div class="erst-body">
                <div class="erst-presets">
                    <button type="button" class="erst-chip" data-act="preset-basra"><i class="fas fa-wand-magic-sparkles"></i> نموذج: رجال / نساء + خضراء وصفراء</button>
                    <button type="button" class="erst-chip" data-act="preset-classic"><i class="fas fa-rotate-left"></i> النظام الحالي (مقيم واحد لكل وجبة)</button>
                </div>
                ${sectorsHtml()}
                <h3 class="erst-group">وجبات الطوارئ</h3>
                <div class="erst-shifts">${L().SHIFTS.map(shiftHtml).join('')}</div>
                <h3 class="erst-group">الاستشارية وشهادات الوفاة</h3>
                <div class="erst-shifts">${timesHtml('con')}${timesHtml('dc')}</div>
                <section class="erst-sec">
                    <h4><i class="fas fa-file-pdf"></i> اسم ملف الطباعة</h4>
                    <div class="erst-row"><span class="erst-hint" dir="ltr">${esc(L().fileName('dc'))}</span></div>
                    <p class="erst-hint">اسم المستشفى ثم الجدول ثم الشهر، لملفات الطباعة وCSV وExcel.</p>
                </section>
                <datalist id="erst-div-names">${DIVISION_PRESETS.map(([n]) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
            </div>
            <footer class="erst-foot">
                <span class="erst-note"><i class="fas fa-circle-info"></i> تُطبّق على الأشهر الجديدة، ويمكنك تطبيقها على الشهر الحالي عند الحفظ.</span>
                <button type="button" class="erst-btn" data-act="close">إلغاء</button>
                <button type="button" class="erst-btn primary" data-act="save"><i class="fas fa-check"></i> حفظ</button>
            </footer>
        </div>`;
        const body = modal.querySelector('.erst-body');
        if (body) body.scrollTop = keep;
    }

    // ------------------------------------------------------------------------------------------
    // Editing
    // ------------------------------------------------------------------------------------------
    function onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || b.tagName === 'INPUT' && b.type !== 'checkbox') return;
        const a = b.dataset.act;
        const shift = b.dataset.shift, sector = b.dataset.sector, j = Number(b.dataset.j), i = Number(b.dataset.i);
        if (a === 'close') return close();
        if (a === 'save') return save();
        if (a === 'preset-basra') { if (draft.sectors.length && !confirm('استبدال الهيكلية الحالية بالنموذج؟')) return; draft = normalize(basraPreset()); }
        else if (a === 'preset-classic') { if (!confirm('العودة إلى مقيم واحد لكل وجبة ولكل خفارة؟')) return; draft = normalize({ code: draft.code }); }
        else if (a === 'add-sector') {
            const sec = { id: newId(), name: b.dataset.name || 'قسم جديد' };
            draft.sectors.push(sec);
            // A new sector works every shift with one resident until changed.
            L().SHIFTS.forEach(sh => draft.shifts[sh].push({ sector: sec.id, divisions: [{ name: '', branch: '', count: 1 }] }));
        } else if (a === 'del-sector') {
            const sec = draft.sectors[i];
            if (!confirm(`حذف «${sec.name}» من كل الوجبات؟`)) return;
            draft.sectors.splice(i, 1);
            L().SHIFTS.forEach(sh => { draft.shifts[sh] = draft.shifts[sh].filter(x => x.sector !== sec.id); });
        } else if (a === 'toggle-sector') {
            const list = draft.shifts[shift];
            const at = list.findIndex(x => x.sector === sector);
            if (at >= 0) list.splice(at, 1);
            else list.push({ sector, divisions: [{ name: '', branch: '', count: 1 }] });
            // Keep the sectors' order.
            draft.shifts[shift] = draft.sectors.map(s => list.find(x => x.sector === s.id)).filter(Boolean);
        } else if (a === 'add-div') {
            const ent = entryOf(shift, sector);
            // The unnamed division (the sector itself) becomes the first named one.
            if (ent.divisions.length === 1 && !ent.divisions[0].name) ent.divisions = [];
            ent.divisions.push({ name: b.dataset.name || 'شعبة', branch: b.dataset.branch || '', count: 1 });
        } else if (a === 'del-div') {
            const ent = entryOf(shift, sector);
            ent.divisions.splice(j, 1);
            if (!ent.divisions.length) ent.divisions.push({ name: '', branch: '', count: 1 });
        } else if (a === 'copy-shift') {
            if (!confirm(`نسخ توزيع «${L().SHIFT_INFO[shift].name}» إلى الوجبات الثلاث الأخرى؟`)) return;
            L().SHIFTS.forEach(sh => { if (sh !== shift) draft.shifts[sh] = clone(draft.shifts[shift]); });
        } else if (a === 'add-time') {
            const list = draft[b.dataset.kind];
            const last = list[list.length - 1];
            list.push({ start: last ? last.end : '08:00', end: last ? '' : '20:00' });
        } else if (a === 'del-time') {
            draft[b.dataset.kind].splice(i, 1);
        } else return;
        render();
    }

    function onInput(e) {
        const t = e.target;
        if (t.dataset.sectorName !== undefined) { draft.sectors[Number(t.dataset.sectorName)].name = t.value; return; }
        if (t.dataset.act === 'code') { draft.code = t.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase(); return; }
        if (t.dataset.div) {
            const ent = entryOf(t.dataset.shift, t.dataset.sector);
            const dv = ent && ent.divisions[Number(t.dataset.j)];
            if (!dv) return;
            if (t.dataset.div === 'count') dv.count = Number(t.value) || 1;
            else dv[t.dataset.div] = t.value;
            // A division picked from the list brings its branch along.
            if (t.dataset.div === 'name') { const pre = DIVISION_PRESETS.find(([n]) => n === t.value.trim()); if (pre && !dv.branch) dv.branch = pre[1]; }
            if (e.type === 'change') render();
            return;
        }
        if (t.dataset.time) {
            draft[t.dataset.kind][Number(t.dataset.i)][t.dataset.time] = t.value;
            if (e.type === 'change') render();
        }
    }

    function clean(d) {
        const out = normalize(d);
        out.sectors = out.sectors.map(s => ({ id: s.id, name: String(s.name || '').trim() || 'قسم' }));
        L().SHIFTS.forEach(sh => {
            out.shifts[sh] = out.shifts[sh].filter(e => out.sectors.some(s => s.id === e.sector)).map(e => ({
                sector: e.sector,
                divisions: e.divisions.map(dv => ({ name: String(dv.name || '').trim(), branch: ['surgical', 'medical'].includes(dv.branch) ? dv.branch : '', count: Math.max(1, Math.min(4, Number(dv.count) || 1)) })),
            }));
        });
        ['con', 'dc'].forEach(k => { out[k] = out[k].filter(p => p.start && p.end).map(p => ({ start: p.start, end: p.end })); });
        out.code = String(out.code || '').trim();
        return out;
    }

    function save() {
        const next = clean(draft);
        for (const [kind, title] of [['con', 'الاستشارية'], ['dc', 'شهادات الوفاة']]) {
            const problems = L().checkTimes(next[kind], kind === 'dc');
            if (problems.length) { notify(`${title}: ${problems[0]}`, 'error'); return; }
        }
        const st = S();
        core().pushScheduleHistory('تعديل هيكلية الخفارات');
        L().setStructure(st.hospitalId, next);
        // The month on screen: an empty one takes the structure at once; one with duties only if confirmed.
        const lost = L().applyToMonth(true);
        const hasDuties = ['er', 'con', 'dc', 'rs'].some(t => (st.schedules[t] || []).some(d => Object.keys(d).some(k => !['dayNumber', 'date', 'dayName', 'notes'].includes(k) && d[k] && String(d[k]).trim())));
        let applied = false;
        if (!hasDuties) { L().applyToMonth(false); applied = true; }
        else if (confirm(`تطبيق الهيكلية الجديدة على جدول ${st.monthYear || 'هذا الشهر'} أيضاً؟\n\n${lost.length ? `سيُحذف ${lost.length} اسماً من خانات لم تعد موجودة، وتبقى بقية الأسماء في أماكنها.` : 'تبقى كل الأسماء الحالية في أماكنها.'}\n\nإلغاء = يبقى هذا الشهر على هيكليته، وتُطبّق الجديدة على الأشهر القادمة.`)) {
            L().applyToMonth(false); applied = true;
        }
        core().ensureScheduleIntegrity();
        core().saveState();
        core().renderActiveTab();
        close();
        notify(applied ? 'تم حفظ هيكلية الخفارات وتطبيقها على هذا الشهر ✓' : 'تم حفظ الهيكلية، وستُطبّق على الأشهر الجديدة ✓', 'success');
    }

    function open() {
        const modal = document.getElementById('er-structure-modal');
        if (!modal || !core() || !core().ready()) return;
        draft = normalize(L().structureOf());
        modal.classList.remove('hidden');
        document.documentElement.classList.add('erst-open');
        render();
    }
    function close() {
        const modal = document.getElementById('er-structure-modal');
        if (modal) modal.classList.add('hidden');
        document.documentElement.classList.remove('erst-open');
        draft = null;
    }

    function start() {
        const modal = document.getElementById('er-structure-modal');
        if (!modal) return;
        modal.addEventListener('click', e => { if (e.target === modal) close(); else onClick(e); });
        modal.addEventListener('input', onInput);
        modal.addEventListener('change', onInput);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    }

    window.ERStructure = { open, close };
    window.openErStructureModal = open;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
