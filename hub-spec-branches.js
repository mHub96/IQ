/**
 * Branches in the general store of specialties (e.g. ICU / theatre / labour-room anaesthesia under
 * Anaesthesia, referrals under Rotators). A branch is a specialty whose parentSpec is another store
 * specialty: the store lists it under its parent, not as a specialty of its own, and the parent's edit
 * dialog adds, edits and removes its branches. Used by the store screens of index.html and admin.html,
 * which both define openGlobalSpecEditModal(id, presetParent) and deleteGlobalSpec(id, name).
 */
(function () {
    'use strict';
    const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const jsArg = t => esc(JSON.stringify(String(t == null ? '' : t)));

    const isBranch = (s, specs) => !!(s && s.parentSpec && s.parentSpec !== s.id && specs.some(p => p.id === s.parentSpec));
    const branchesOf = (id, specs) => specs.filter(b => b.parentSpec === id && b.id !== id);

    /** The store's top-level specialties to list (a search also finds a parent through its branches). */
    function topLevel(specs, query) {
        const q = String(query || '').trim().toLowerCase();
        const hit = s => !q || [s.id, s.name_ar, s.name_en].some(v => String(v || '').toLowerCase().includes(q));
        return specs.filter(s => !isBranch(s, specs) && (hit(s) || branchesOf(s.id, specs).some(hit)));
    }

    /** Badges for a parent's branches in the store list; each opens that branch. */
    function chips(parent, specs) {
        const list = branchesOf(parent.id, specs);
        if (!list.length) return '';
        return `<div class="flex items-center gap-1 flex-wrap mt-1">
            <span class="text-[10px] font-bold text-purple-700 dark:text-purple-300"><i class="fas fa-diagram-project"></i> الفروع:</span>
            ${list.map(b => `<button type="button" onclick="openGlobalSpecEditModal(${jsArg(b.id)})" title="تعديل الفرع"
                class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">${esc(b.icon || '↳')} ${esc(b.name_ar || b.id)}</button>`).join('')}
        </div>`;
    }

    /**
     * The branches section of a store specialty's edit dialog. `parentId` null = a new specialty (saved
     * first). Also locks the parent picker of a specialty that has branches (one level only).
     */
    function editor(host, parentId, parentSelect) {
        if (!host) return;
        const specs = (window.Hub && Hub.getGlobalSpecialties) ? Hub.getGlobalSpecialties() : [];
        const current = parentId ? specs.find(s => s.id === parentId) : null;
        const list = parentId ? branchesOf(parentId, specs) : [];
        if (parentSelect) {
            parentSelect.disabled = list.length > 0;
            parentSelect.title = list.length ? 'لهذا التخصص فروع، فلا يكون فرعاً لتخصص آخر.' : '';
        }
        if (current && isBranch(current, specs)) {
            host.innerHTML = `<div class="text-[11px] text-slate-500 dark:text-slate-400"><i class="fas fa-diagram-project"></i> هذا فرع من «${esc((specs.find(p => p.id === current.parentSpec) || {}).name_ar || current.parentSpec)}». الفروع تكون للتخصصات الرئيسية فقط.</div>`;
            return;
        }
        host.innerHTML = `
            <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-bold text-purple-700 dark:text-purple-300"><i class="fas fa-diagram-project"></i> فروع التخصص</span>
                ${parentId ? `<button type="button" data-act="add" class="text-[10px] font-bold px-2 py-1 rounded-lg bg-purple-600 text-white"><i class="fas fa-plus"></i> إضافة فرع</button>` : ''}
            </div>
            <p class="text-[10.5px] text-slate-500 dark:text-slate-400 mb-1.5">الفرع لا يملك مقيمين خاصين به، بل يسحبهم من التخصص الرئيسي (ويمكن لكل مستشفى تعديل مصادر السحب). عند إضافة التخصص الرئيسي لمستشفى تُضاف فروعه معه.</p>
            ${!parentId ? '<div class="text-[11px] text-slate-400">احفظ التخصص أولاً، ثم أضف فروعه.</div>'
                : list.length ? list.map(b => `
                <div class="flex items-center justify-between gap-2 p-1.5 rounded-lg border border-purple-200/70 dark:border-purple-800/60 bg-purple-50/50 dark:bg-purple-950/20 mb-1">
                    <span class="text-xs font-bold truncate">${esc(b.icon || '↳')} ${esc(b.name_ar || b.id)} <span class="text-[10px] font-mono text-slate-400" dir="ltr">${esc(b.id)}</span></span>
                    <span class="flex gap-1 flex-shrink-0">
                        <button type="button" data-act="edit" data-id="${esc(b.id)}" class="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-purple-300 text-purple-700 dark:text-purple-300"><i class="fas fa-pen"></i> تعديل</button>
                        <button type="button" data-act="remove" data-id="${esc(b.id)}" class="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-red-200 text-red-600"><i class="fas fa-trash"></i> حذف</button>
                    </span>
                </div>`).join('') : '<div class="text-[11px] text-slate-400">لا توجد فروع.</div>'}`;
        host.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            if (btn.dataset.act === 'add') window.openGlobalSpecEditModal(null, parentId);
            else if (btn.dataset.act === 'edit') window.openGlobalSpecEditModal(id);
            else if (btn.dataset.act === 'remove') {
                const b = specs.find(s => s.id === id);
                if (typeof window.closeGlobalSpecEditModal === 'function') window.closeGlobalSpecEditModal();
                window.deleteGlobalSpec(id, b ? b.name_ar : id);
            }
        }));
    }

    window.HubSpecBranches = { isBranch, branchesOf, topLevel, chips, editor };
})();
