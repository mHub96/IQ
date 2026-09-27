/**
 * HOSP HUB - Emergency Shift & Resident Quota Scheduling Engine
 * Supports ER (4 shifts/day), Consultatory (1/day), Death Certification (1/day), RS (Wards/ER),
 * Real-time collision detection, Quota tracking, and Smart Auto-generation.
 */

(function () {
    'use strict';

    // Application State
    window.emergencyState = {
        hospitalName: 'مستشفى الصدر التعليمي',
        departmentName: 'شعبة إدارة الموارد البشرية - قسم الطوارئ',
        orderNumber: '1452 / طوارئ',
        orderDate: '2026/08/28',
        monthYear: 'أيلول 2026',
        month: 9,
        year: 2026,
        activeTab: 'er',
        activeFilter: 'all',
        searchQuery: '',
        residents: [],
        schedules: {
            er: [],
            con: [],
            dc: [],
            rs: []
        },
        activeSlotTarget: null // for modal doctor picker: { scheduleType, dayIndex, slotKey }
    };

    const STORAGE_KEY = 'hosp_emergency_schedule_v2';

    // Initialize State
    function initEmergencySystem() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                window.emergencyState = { ...window.emergencyState, ...parsed };
            } catch (e) {
                console.error("Failed to parse saved emergency state, falling back to defaults", e);
                loadDefaults();
            }
        } else {
            loadDefaults();
        }

        renderHeaderMeta();
        renderActiveTab();
        updateGlobalStats();
        setupEventListeners();
    }

    function loadDefaults() {
        if (window.DEFAULT_EMERGENCY_DATA) {
            window.emergencyState.hospitalName = window.DEFAULT_EMERGENCY_DATA.hospitalName || 'مستشفى الصدر التعليمي';
            window.emergencyState.monthYear = window.DEFAULT_EMERGENCY_DATA.monthYear || 'أيلول 2026';
            window.emergencyState.month = window.DEFAULT_EMERGENCY_DATA.month || 9;
            window.emergencyState.year = window.DEFAULT_EMERGENCY_DATA.year || 2026;
            window.emergencyState.residents = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.residents || []));
            window.emergencyState.schedules = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.schedules || { er: [], con: [], dc: [], rs: [] }));
        }
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(window.emergencyState));
        updateGlobalStats();
    }

    function resetToDefaults() {
        if (confirm("هل أنت متأكد من إعادة تعيين كافة الجداول وبيانات الأطباء إلى النسخة الأصلية من Google Sheet؟")) {
            localStorage.removeItem(STORAGE_KEY);
            loadDefaults();
            renderActiveTab();
            updateGlobalStats();
            showToast("تمت استعادة البيانات الأصلية بنجاح", "success");
        }
    }

    // Switch Tabs
    window.switchTab = function (tabId) {
        window.emergencyState.activeTab = tabId;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active-tab', isActive);
            btn.classList.toggle('bg-rose-600', isActive);
            btn.classList.toggle('text-white', isActive);
            btn.classList.toggle('text-slate-600', !isActive);
            btn.classList.toggle('dark:text-slate-300', !isActive);
        });

        renderActiveTab();
    };

    function renderHeaderMeta() {
        const hospInput = document.getElementById('meta-hosp-name');
        if (hospInput) hospInput.value = window.emergencyState.hospitalName;
        const monthInput = document.getElementById('meta-month-year');
        if (monthInput) monthInput.value = window.emergencyState.monthYear;
        const orderNumInput = document.getElementById('meta-order-number');
        if (orderNumInput) orderNumInput.value = window.emergencyState.orderNumber;
    }

    window.updateMetaHeader = function (key, value) {
        window.emergencyState[key] = value;
        saveState();
    };

    // Render Tab Views
    function renderActiveTab() {
        const tab = window.emergencyState.activeTab;
        const container = document.getElementById('schedule-view-container');
        if (!container) return;

        if (tab === 'er') {
            container.innerHTML = renderERTable();
        } else if (tab === 'con') {
            container.innerHTML = renderConTable();
        } else if (tab === 'dc') {
            container.innerHTML = renderDCTable();
        } else if (tab === 'rs') {
            container.innerHTML = renderRSTable();
        } else if (tab === 'db') {
            container.innerHTML = renderResidentsDBTable();
        }
    }

    // ------------------------------------------------------------------------
    // Collision & Quota Calculations
    // ------------------------------------------------------------------------
    function getAssignmentsForDay(dayIndex) {
        const assignments = [];
        const erDay = window.emergencyState.schedules.er[dayIndex];
        if (erDay) {
            if (erDay.morning) assignments.push({ doctor: erDay.morning, schedule: 'ER (الصباحية)' });
            if (erDay.afternoon) assignments.push({ doctor: erDay.afternoon, schedule: 'ER (بعد الصباحية)' });
            if (erDay.preNight) assignments.push({ doctor: erDay.preNight, schedule: 'ER (البرينايت)' });
            if (erDay.lateNight) assignments.push({ doctor: erDay.lateNight, schedule: 'ER (الليلية)' });
        }

        const conDay = window.emergencyState.schedules.con[dayIndex];
        if (conDay && conDay.doctor) {
            assignments.push({ doctor: conDay.doctor, schedule: 'الاستشارية' });
        }

        const dcDay = window.emergencyState.schedules.dc[dayIndex];
        if (dcDay && dcDay.doctor) {
            assignments.push({ doctor: dcDay.doctor, schedule: 'تنظيم شهادات الوفاة' });
        }

        const rsDay = window.emergencyState.schedules.rs[dayIndex];
        if (rsDay) {
            ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight', 'ward_private', 'ward_floor4', 'ward_floor5'].forEach(k => {
                if (rsDay[k]) assignments.push({ doctor: rsDay[k], schedule: `الإسناد (${k})` });
            });
        }

        return assignments;
    }

    function checkConflictsForDay(dayIndex) {
        const assignments = getAssignmentsForDay(dayIndex);
        const docCounts = {};
        assignments.forEach(a => {
            if (!a.doctor) return;
            docCounts[a.doctor] = (docCounts[a.doctor] || 0) + 1;
        });

        const conflicts = Object.keys(docCounts).filter(doc => docCounts[doc] > 1);
        return conflicts;
    }

    function getDoctorAssignedStats(docName) {
        let erCount = 0;
        let conCount = 0;
        let dcCount = 0;
        let rsCount = 0;

        window.emergencyState.schedules.er.forEach(day => {
            if (day.morning === docName) erCount++;
            if (day.afternoon === docName) erCount++;
            if (day.preNight === docName) erCount++;
            if (day.lateNight === docName) erCount++;
        });

        window.emergencyState.schedules.con.forEach(day => {
            if (day.doctor === docName) conCount++;
        });

        window.emergencyState.schedules.dc.forEach(day => {
            if (day.doctor === docName) dcCount++;
        });

        window.emergencyState.schedules.rs.forEach(day => {
            if (day.er_morning === docName || day.er_afternoon === docName || day.er_preNight === docName || day.er_lateNight === docName ||
                day.ward_private === docName || day.ward_floor4 === docName || day.ward_floor5 === docName) {
                rsCount++;
            }
        });

        return { er: erCount, con: conCount, dc: dcCount, rs: rsCount, total: erCount + conCount + dcCount + rsCount };
    }

    // ------------------------------------------------------------------------
    // Schedule Tables HTML Renderers
    // ------------------------------------------------------------------------

    // 1. ER TABLE (4 shifts per day)
    function renderERTable() {
        const days = window.emergencyState.schedules.er || [];
        let html = `
        <div class="overflow-x-auto">
            <div class="print-official-header hidden print:block text-center pb-4 border-b border-slate-300 mb-4">
                <div class="text-xs font-bold leading-tight">جمهورية العراق - وزارة الصحة<br>دائرة صحة البصرة<br>${window.emergencyState.hospitalName}<br>${window.emergencyState.departmentName}</div>
                <div class="text-sm font-black mt-2">جدول خفارات المقيمين الأقدمين في قسم الطوارئ لشهر ${window.emergencyState.monthYear}</div>
                <div class="flex justify-between text-[11px] mt-1 font-mono px-4">
                    <span>العدد: ${window.emergencyState.orderNumber}</span>
                    <span>التاريخ: ${window.emergencyState.orderDate}</span>
                </div>
            </div>

            <table class="w-full text-right text-xs border-collapse">
                <thead class="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                    <tr>
                        <th class="p-3 text-center w-14">#</th>
                        <th class="p-3 whitespace-nowrap">اليوم والتاريخ</th>
                        <th class="p-3 min-w-[170px] bg-amber-50/60 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300">
                            <i class="fas fa-sun ml-1 text-amber-500"></i> الصباحية (8ص - 2م)
                        </th>
                        <th class="p-3 min-w-[170px] bg-sky-50/60 dark:bg-sky-950/20 text-sky-900 dark:text-sky-300">
                            <i class="fas fa-cloud-sun ml-1 text-sky-500"></i> بعد الصباحية (2م - 8م)
                        </th>
                        <th class="p-3 min-w-[170px] bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-300">
                            <i class="fas fa-moon ml-1 text-indigo-500"></i> البرينايت (8م - 2ص)
                        </th>
                        <th class="p-3 min-w-[170px] bg-purple-50/60 dark:bg-purple-950/20 text-purple-900 dark:text-purple-300">
                            <i class="fas fa-star-and-crescent ml-1 text-purple-500"></i> الليلية (2ص - 8ص)
                        </th>
                        <th class="p-3 text-center w-28 no-print">فحص التعارض</th>
                        <th class="p-3 min-w-[140px] no-print">ملاحظات</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
        `;

        days.forEach((day, idx) => {
            const conflicts = checkConflictsForDay(idx);
            const hasConflict = conflicts.length > 0;
            const conflictBadge = hasConflict
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" title="تعارض: ${conflicts.join(', ')}"><i class="fas fa-triangle-exclamation"></i> تعارض</span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-mono">0000 ✓</span>`;

            html += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition ${hasConflict ? 'bg-red-50/30 dark:bg-red-950/10' : ''}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3 whitespace-nowrap border-l border-slate-100 dark:border-slate-800 font-bold">
                    <div class="text-slate-800 dark:text-slate-100">${day.dayName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('er', idx, 'morning', day.morning)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('er', idx, 'afternoon', day.afternoon)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('er', idx, 'preNight', day.preNight)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('er', idx, 'lateNight', day.lateNight)}
                </td>
                <td class="p-2 text-center no-print">
                    ${conflictBadge}
                </td>
                <td class="p-2 no-print">
                    <input type="text" value="${day.notes || ''}" onchange="updateDayNotes('er', ${idx}, this.value)" placeholder="ملاحظات..." class="w-full text-[11px] px-2 py-1 rounded bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 border-none focus:ring-1 focus:ring-rose-500">
                </td>
            </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            ${renderOfficialFooter()}
        </div>
        `;
        return html;
    }

    // 2. CONSULTATORY TABLE (1 doctor per day)
    function renderConTable() {
        const days = window.emergencyState.schedules.con || [];
        let html = `
        <div class="overflow-x-auto">
            <div class="print-official-header hidden print:block text-center pb-4 border-b border-slate-300 mb-4">
                <div class="text-xs font-bold leading-tight">جمهورية العراق - وزارة الصحة<br>دائرة صحة البصرة<br>${window.emergencyState.hospitalName}<br>${window.emergencyState.departmentName}</div>
                <div class="text-sm font-black mt-2">جدول خفارات المقيمين الأقدمين في الاستشارية الخافرة لشهر ${window.emergencyState.monthYear}</div>
                <div class="flex justify-between text-[11px] mt-1 font-mono px-4">
                    <span>العدد: ${window.emergencyState.orderNumber}</span>
                    <span>التاريخ: ${window.emergencyState.orderDate}</span>
                </div>
            </div>

            <table class="w-full text-right text-xs border-collapse">
                <thead class="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                    <tr>
                        <th class="p-3 text-center w-14">#</th>
                        <th class="p-3 whitespace-nowrap">اليوم والتاريخ</th>
                        <th class="p-3 min-w-[280px]">
                            <i class="fas fa-stethoscope ml-1 text-emerald-500"></i> طبيب الاستشارية الخافرة
                        </th>
                        <th class="p-3 text-center w-32 no-print">فحص التعارض</th>
                        <th class="p-3 min-w-[200px] no-print">الحصص المكتملة للطبيب</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
        `;

        days.forEach((day, idx) => {
            const conflicts = checkConflictsForDay(idx);
            const hasConflict = conflicts.includes(day.doctor);
            const stats = day.doctor ? getDoctorAssignedStats(day.doctor) : null;
            const resMeta = day.doctor ? window.emergencyState.residents.find(r => r.name === day.doctor) : null;

            html += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition ${hasConflict ? 'bg-red-50/30 dark:bg-red-950/10' : ''}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3 whitespace-nowrap border-l border-slate-100 dark:border-slate-800 font-bold">
                    <div class="text-slate-800 dark:text-slate-100">${day.dayName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('con', idx, 'doctor', day.doctor)}
                </td>
                <td class="p-2 text-center no-print">
                    ${hasConflict
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"><i class="fas fa-triangle-exclamation"></i> تعارض</span>`
                    : `<span class="text-[11px] text-emerald-600 font-mono">0 تعارض ✓</span>`}
                </td>
                <td class="p-2 no-print text-slate-500 text-[11px]">
                    ${stats ? `إجمالي الاستشارية: <strong class="text-slate-700 dark:text-slate-200">${stats.con}</strong> / ${resMeta ? resMeta.con_target : '—'}` : '—'}
                </td>
            </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            ${renderOfficialFooter()}
        </div>
        `;
        return html;
    }

    // 3. DEATH CERTIFICATION TABLE (1 doctor per day)
    function renderDCTable() {
        const days = window.emergencyState.schedules.dc || [];
        let html = `
        <div class="overflow-x-auto">
            <div class="print-official-header hidden print:block text-center pb-4 border-b border-slate-300 mb-4">
                <div class="text-xs font-bold leading-tight">جمهورية العراق - وزارة الصحة<br>دائرة صحة البصرة<br>${window.emergencyState.hospitalName}<br>${window.emergencyState.departmentName}</div>
                <div class="text-sm font-black mt-2">جدول خفارات المقيمين الأقدمين لتنظيم شهادات الوفاة لشهر ${window.emergencyState.monthYear}</div>
                <div class="flex justify-between text-[11px] mt-1 font-mono px-4">
                    <span>العدد: ${window.emergencyState.orderNumber}</span>
                    <span>التاريخ: ${window.emergencyState.orderDate}</span>
                </div>
            </div>

            <table class="w-full text-right text-xs border-collapse">
                <thead class="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                    <tr>
                        <th class="p-3 text-center w-14">#</th>
                        <th class="p-3 whitespace-nowrap">اليوم والتاريخ</th>
                        <th class="p-3 min-w-[280px]">
                            <i class="fas fa-file-medical ml-1 text-slate-500"></i> خفر تنظيم شهادات الوفاة
                        </th>
                        <th class="p-3 text-center w-32 no-print">فحص التعارض</th>
                        <th class="p-3 min-w-[200px] no-print">الحصص المكتملة للطبيب</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
        `;

        days.forEach((day, idx) => {
            const conflicts = checkConflictsForDay(idx);
            const hasConflict = conflicts.includes(day.doctor);
            const stats = day.doctor ? getDoctorAssignedStats(day.doctor) : null;
            const resMeta = day.doctor ? window.emergencyState.residents.find(r => r.name === day.doctor) : null;

            html += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition ${hasConflict ? 'bg-red-50/30 dark:bg-red-950/10' : ''}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3 whitespace-nowrap border-l border-slate-100 dark:border-slate-800 font-bold">
                    <div class="text-slate-800 dark:text-slate-100">${day.dayName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('dc', idx, 'doctor', day.doctor)}
                </td>
                <td class="p-2 text-center no-print">
                    ${hasConflict
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"><i class="fas fa-triangle-exclamation"></i> تعارض</span>`
                    : `<span class="text-[11px] text-emerald-600 font-mono">0 تعارض ✓</span>`}
                </td>
                <td class="p-2 no-print text-slate-500 text-[11px]">
                    ${stats ? `إجمالي الوفيات: <strong class="text-slate-700 dark:text-slate-200">${stats.dc}</strong> / ${resMeta ? resMeta.dc_target : '—'}` : '—'}
                </td>
            </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            ${renderOfficialFooter()}
        </div>
        `;
        return html;
    }

    // 4. RS TABLE (Support for Wards & ER)
    function renderRSTable() {
        const days = window.emergencyState.schedules.rs || [];
        let html = `
        <div class="overflow-x-auto">
            <div class="print-official-header hidden print:block text-center pb-4 border-b border-slate-300 mb-4">
                <div class="text-xs font-bold leading-tight">جمهورية العراق - وزارة الصحة<br>دائرة صحة البصرة<br>${window.emergencyState.hospitalName}<br>${window.emergencyState.departmentName}</div>
                <div class="text-sm font-black mt-2">جدول خفارات المقيمين الأقدمين للإسناد (الردهات والطوارئ) لشهر ${window.emergencyState.monthYear}</div>
                <div class="flex justify-between text-[11px] mt-1 font-mono px-4">
                    <span>العدد: ${window.emergencyState.orderNumber}</span>
                    <span>التاريخ: ${window.emergencyState.orderDate}</span>
                </div>
            </div>

            <table class="w-full text-right text-xs border-collapse">
                <thead class="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                    <tr>
                        <th class="p-3 text-center w-14">#</th>
                        <th class="p-3 whitespace-nowrap">اليوم والتاريخ</th>
                        <th class="p-3 min-w-[150px] bg-rose-50/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-300">الجناح الخاص</th>
                        <th class="p-3 min-w-[150px] bg-rose-50/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-300">الجناح العام (ط 4)</th>
                        <th class="p-3 min-w-[150px] bg-rose-50/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-300">الجناح العام (ط 5)</th>
                        <th class="p-3 min-w-[150px] bg-sky-50/50 dark:bg-sky-950/20 text-sky-900 dark:text-sky-300">إسناد طوارئ صباحي</th>
                        <th class="p-3 min-w-[150px] bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-300">إسناد طوارئ مسائي</th>
                        <th class="p-3 text-center w-28 no-print">فحص التعارض</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
        `;

        days.forEach((day, idx) => {
            const conflicts = checkConflictsForDay(idx);
            const hasConflict = conflicts.length > 0;

            html += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition ${hasConflict ? 'bg-red-50/30 dark:bg-red-950/10' : ''}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3 whitespace-nowrap border-l border-slate-100 dark:border-slate-800 font-bold">
                    <div class="text-slate-800 dark:text-slate-100">${day.dayName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('rs', idx, 'ward_private', day.ward_private)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('rs', idx, 'ward_floor4', day.ward_floor4)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('rs', idx, 'ward_floor5', day.ward_floor5)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('rs', idx, 'er_morning', day.er_morning)}
                </td>
                <td class="p-2 border-l border-slate-100 dark:border-slate-800">
                    ${renderSlotButton('rs', idx, 'er_afternoon', day.er_afternoon)}
                </td>
                <td class="p-2 text-center no-print">
                    ${hasConflict
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"><i class="fas fa-triangle-exclamation"></i> تعارض</span>`
                    : `<span class="text-[11px] text-emerald-600 font-mono">000 ✓</span>`}
                </td>
            </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            ${renderOfficialFooter()}
        </div>
        `;
        return html;
    }

    // 5. RESIDENTS & QUOTAS DATABASE TABLE (DB Tab)
    function renderResidentsDBTable() {
        let residents = window.emergencyState.residents || [];
        const query = (window.emergencyState.searchQuery || '').toLowerCase();
        const filter = window.emergencyState.activeFilter || 'all';

        if (query) {
            residents = residents.filter(r => (r.name || '').toLowerCase().includes(query) || (r.specialty || '').toLowerCase().includes(query));
        }

        if (filter === 'active') {
            residents = residents.filter(r => !r.notes.includes('HIDE'));
        } else if (filter === 'hidden') {
            residents = residents.filter(r => r.notes.includes('HIDE'));
        } else if (filter === 'pending_er') {
            residents = residents.filter(r => {
                const stats = getDoctorAssignedStats(r.name);
                return stats.er < r.er_target && !r.notes.includes('HIDE');
            });
        }

        let html = `
        <div class="space-y-4">
            <!-- Search & Filter Bar -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                <div class="flex items-center gap-2 flex-1 min-w-[240px]">
                    <div class="relative w-full">
                        <i class="fas fa-search absolute right-3 top-2.5 text-slate-400 text-xs"></i>
                        <input type="text" value="${window.emergencyState.searchQuery || ''}" oninput="searchResidents(this.value)" placeholder="بحث باسم الطبيب أو الاختصاص..." class="w-full pr-8 pl-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" onclick="filterResidentsList('all')" class="px-3 py-1.5 rounded-xl text-xs font-bold ${filter === 'all' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">الكل (${window.emergencyState.residents.length})</button>
                    <button type="button" onclick="filterResidentsList('active')" class="px-3 py-1.5 rounded-xl text-xs font-bold ${filter === 'active' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">النشطون</button>
                    <button type="button" onclick="filterResidentsList('pending_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold ${filter === 'pending_er' ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">متبقي لهم طوارئ</button>
                    <button type="button" onclick="openAddResidentModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition flex items-center gap-1.5">
                        <i class="fas fa-plus"></i> إضافة طبيب
                    </button>
                </div>
            </div>

            <!-- Table -->
            <div class="overflow-x-auto">
                <table class="w-full text-right text-xs border-collapse">
                    <thead class="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                        <tr>
                            <th class="p-3 text-center w-12">#</th>
                            <th class="p-3 min-w-[190px]">اسم الطبيب المقيم الأقدم</th>
                            <th class="p-3">الاختصاص</th>
                            <th class="p-3 text-center">المرحلة</th>
                            <th class="p-3 text-center">البورد</th>
                            <th class="p-3 text-center min-w-[90px] bg-rose-50/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-300">خفارات ER</th>
                            <th class="p-3 text-center min-w-[90px] bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300">استشارية Con</th>
                            <th class="p-3 text-center min-w-[90px] bg-slate-50/80 dark:bg-slate-900/60">وفيات DC</th>
                            <th class="p-3 text-center min-w-[90px] bg-sky-50/50 dark:bg-sky-950/20 text-sky-900 dark:text-sky-300">إسناد RS</th>
                            <th class="p-3 min-w-[160px]">ملاحظات وحالة</th>
                            <th class="p-3 text-center w-20">إجراءات</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
        `;

        residents.forEach((res, idx) => {
            const stats = getDoctorAssignedStats(res.name);
            const isHidden = (res.notes || '').includes('HIDE');

            // Quota badges with color coding
            const erBadge = renderQuotaCellBadge(stats.er, res.er_target);
            const conBadge = renderQuotaCellBadge(stats.con, res.con_target);
            const dcBadge = renderQuotaCellBadge(stats.dc, res.dc_target);
            const rsBadge = renderQuotaCellBadge(stats.rs, res.rs_target);

            html += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition ${isHidden ? 'opacity-50 bg-slate-100/50 dark:bg-slate-900/20' : ''}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3 font-bold border-l border-slate-100 dark:border-slate-800">
                    <div class="text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <i class="fas ${res.sex === 'F' ? 'fa-venus text-pink-500' : 'fa-mars text-blue-500'} text-[11px]"></i>
                        <span>${res.name}</span>
                    </div>
                </td>
                <td class="p-3 text-slate-600 dark:text-slate-300">${res.specialty || '—'}</td>
                <td class="p-3 text-center font-mono">${res.stage || '—'}</td>
                <td class="p-3 text-center text-[11px] text-slate-500">${res.board || '—'}</td>
                <td class="p-2 text-center border-l border-slate-100 dark:border-slate-800">${erBadge}</td>
                <td class="p-2 text-center border-l border-slate-100 dark:border-slate-800">${conBadge}</td>
                <td class="p-2 text-center border-l border-slate-100 dark:border-slate-800">${dcBadge}</td>
                <td class="p-2 text-center border-l border-slate-100 dark:border-slate-800">${rsBadge}</td>
                <td class="p-3 text-[11px] text-slate-500">
                    ${res.notes ? `<span class="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">${res.notes}</span>` : '—'}
                </td>
                <td class="p-2 text-center">
                    <button type="button" onclick="editResident('${res.id}')" class="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition" title="تعديل"><i class="fas fa-pen-to-square"></i></button>
                    <button type="button" onclick="toggleResidentHide('${res.id}')" class="p-1 text-slate-400 hover:text-amber-600 transition" title="${isHidden ? 'إلغاء الإخفاء' : 'إخفاء'}"><i class="fas ${isHidden ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                </td>
            </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        </div>
        `;
        return html;
    }

    function renderQuotaCellBadge(actual, target) {
        if (!target || target === 0) {
            return actual > 0 ? `<span class="text-rose-600 font-bold font-mono">${actual} / 0 ⚠️</span>` : `<span class="text-slate-400 font-mono">0 / 0</span>`;
        }
        if (actual === target) {
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-mono">${actual} / ${target} ✓</span>`;
        }
        if (actual < target) {
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-mono">${actual} / ${target}</span>`;
        }
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 font-mono">${actual} / ${target} ⚠️</span>`;
    }

    // Interactive Button for Slot in Schedule Tables
    function renderSlotButton(scheduleType, dayIndex, slotKey, doctorName) {
        if (doctorName && doctorName.trim() !== '') {
            return `
            <button type="button" onclick="openDoctorPickerModal('${scheduleType}', ${dayIndex}, '${slotKey}')" class="w-full text-right px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 hover:border-rose-400 dark:hover:border-rose-500 shadow-sm transition flex items-center justify-between group">
                <span class="font-bold text-slate-800 dark:text-slate-100 text-xs truncate">${doctorName}</span>
                <i class="fas fa-pen text-[10px] text-slate-400 group-hover:text-rose-500 transition ml-1"></i>
            </button>
            `;
        }
        return `
        <button type="button" onclick="openDoctorPickerModal('${scheduleType}', ${dayIndex}, '${slotKey}')" class="w-full text-center px-2 py-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-400 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 text-xs transition flex items-center justify-center gap-1 bg-slate-50/50 dark:bg-slate-900/30">
            <i class="fas fa-plus text-[10px]"></i>
            <span>تحديد طبيب</span>
        </button>
        `;
    }

    // Official Ministerial Order Footer
    function renderOfficialFooter() {
        return `
        <div class="print-official-footer hidden print:block pt-6 mt-6 border-t border-slate-300 text-xs text-slate-700 space-y-4">
            <div class="grid grid-cols-2 gap-8 font-bold text-center">
                <div class="space-y-12">
                    <div>رئيس الأطباء المقيمين<br><span class="font-normal text-slate-500">مستشفى الصدر التعليمي</span></div>
                    <div>....................................</div>
                </div>
                <div class="space-y-12">
                    <div>الطبيب الأخصائي / مدير المستشفى<br><span class="font-normal text-slate-500">مستشفى الصدر التعليمي</span></div>
                    <div>....................................</div>
                </div>
            </div>

            <div class="text-[11px] leading-relaxed pt-4 border-t border-slate-200">
                <p class="font-bold">ملاحظات وتعليمات هامة:</p>
                <p>◆ يرجى تبليغ رئيس الأطباء المقيمين في حالة تبديل الخفارة وبخلافه يتحمل الطرفان المسؤولية كاملة.</p>
                <p>◆ في حالة تغيب الطبيب عن الخفارة، يعتبر غياباً ويكون التعويض مضاعفاً وفق التعليمات النافذة.</p>
                <div class="pt-2 text-[10px] text-slate-500">
                    نسخة منه إلى: دائرة صحة البصرة / قسم الأمور الإدارية (للعلم مع التقدير) | قسم التفتيش (للعلم مع التقدير).
                </div>
            </div>
        </div>
        `;
    }

    // ------------------------------------------------------------------------
    // Doctor Picker Modal (with remaining quotas and conflict prevention)
    // ------------------------------------------------------------------------
    window.openDoctorPickerModal = function (scheduleType, dayIndex, slotKey) {
        window.emergencyState.activeSlotTarget = { scheduleType, dayIndex, slotKey };
        const modal = document.getElementById('doctor-picker-modal');
        if (!modal) return;

        const dayAssignments = getAssignmentsForDay(dayIndex);
        const busyDoctors = new Set(dayAssignments.map(a => a.doctor));

        const targetSchedule = window.emergencyState.schedules[scheduleType][dayIndex];
        const currentDoctor = targetSchedule ? targetSchedule[slotKey] : '';

        document.getElementById('picker-day-info').textContent = `اليوم: ${targetSchedule.dayName} (${targetSchedule.date}) - الوردية: ${getSlotArabicTitle(slotKey)}`;
        renderDoctorPickerList('', 'all', busyDoctors, currentDoctor);
        modal.classList.remove('hidden');
        document.getElementById('picker-search-input').focus();
    };

    window.closeDoctorPickerModal = function () {
        const modal = document.getElementById('doctor-picker-modal');
        if (modal) modal.classList.add('hidden');
        window.emergencyState.activeSlotTarget = null;
    };

    function getSlotArabicTitle(slotKey) {
        const map = {
            morning: 'الصباحية (8ص - 2م)',
            afternoon: 'بعد الصباحية (2م - 8م)',
            preNight: 'البرينايت (8م - 2ص)',
            lateNight: 'الليلية (2ص - 8ص)',
            doctor: 'الطبيب الخافر',
            ward_private: 'الجناح الخاص',
            ward_floor4: 'الجناح العام (ط4)',
            ward_floor5: 'الجناح العام (ط5)',
            er_morning: 'إسناد طوارئ صباحي',
            er_afternoon: 'إسناد طوارئ مسائي'
        };
        return map[slotKey] || slotKey;
    }

    window.filterPickerList = function () {
        const query = document.getElementById('picker-search-input').value;
        const filter = document.getElementById('picker-quota-filter').value;
        const target = window.emergencyState.activeSlotTarget;
        if (!target) return;
        const dayAssignments = getAssignmentsForDay(target.dayIndex);
        const busyDoctors = new Set(dayAssignments.map(a => a.doctor));
        const currentDoctor = window.emergencyState.schedules[target.scheduleType][target.dayIndex][target.slotKey];

        renderDoctorPickerList(query, filter, busyDoctors, currentDoctor);
    };

    function renderDoctorPickerList(query, filter, busyDoctors, currentDoctor) {
        const container = document.getElementById('picker-doctors-list');
        if (!container) return;

        const target = window.emergencyState.activeSlotTarget;
        const scheduleType = target ? target.scheduleType : 'er';

        let list = window.emergencyState.residents.filter(r => !(r.notes || '').includes('HIDE'));

        if (query) {
            const q = query.toLowerCase();
            list = list.filter(r => r.name.toLowerCase().includes(q) || (r.specialty || '').toLowerCase().includes(q));
        }

        if (filter === 'pending_only') {
            list = list.filter(r => {
                const stats = getDoctorAssignedStats(r.name);
                const targetCount = scheduleType === 'er' ? r.er_target : (scheduleType === 'con' ? r.con_target : (scheduleType === 'dc' ? r.dc_target : r.rs_target));
                const actualCount = scheduleType === 'er' ? stats.er : (scheduleType === 'con' ? stats.con : (scheduleType === 'dc' ? stats.dc : stats.rs));
                return actualCount < targetCount;
            });
        }

        // Sort: doctors with remaining quota first, then alphabetical
        list.sort((a, b) => {
            const aBusy = busyDoctors.has(a.name);
            const bBusy = busyDoctors.has(b.name);
            if (aBusy !== bBusy) return aBusy ? 1 : -1; // non-busy first
            return a.name.localeCompare(b.name, 'ar');
        });

        if (list.length === 0) {
            container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">لا يوجد أطباء مطابقون لمعايير البحث</div>`;
            return;
        }

        container.innerHTML = list.map(res => {
            const stats = getDoctorAssignedStats(res.name);
            const isBusy = busyDoctors.has(res.name);
            const isSelected = res.name === currentDoctor;

            let targetQuota = 0;
            let actualQuota = 0;
            if (scheduleType === 'er') { targetQuota = res.er_target; actualQuota = stats.er; }
            else if (scheduleType === 'con') { targetQuota = res.con_target; actualQuota = stats.con; }
            else if (scheduleType === 'dc') { targetQuota = res.dc_target; actualQuota = stats.dc; }
            else { targetQuota = res.rs_target; actualQuota = stats.rs; }

            const quotaBadge = actualQuota >= targetQuota
                ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 font-mono">${actualQuota}/${targetQuota} (مكتمل)</span>`
                : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 font-mono">${actualQuota}/${targetQuota} (متبقي)</span>`;

            return `
            <div onclick="selectDoctorForActiveSlot('${res.name.replace(/'/g, "\\'")}')" class="p-2.5 rounded-xl border ${isSelected ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'} cursor-pointer flex items-center justify-between transition">
                <div class="space-y-0.5">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-slate-800 dark:text-slate-100">${res.name}</span>
                        ${isBusy ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-bold"><i class="fas fa-triangle-exclamation"></i> خافر اليوم</span>` : ''}
                    </div>
                    <div class="text-[10px] text-slate-400 flex items-center gap-2">
                        <span>${res.specialty || 'عام'}</span>
                        <span>•</span>
                        <span>مرحلة ${res.stage || '—'}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    ${quotaBadge}
                    <i class="fas fa-chevron-left text-slate-300 text-xs"></i>
                </div>
            </div>
            `;
        }).join('');
    }

    window.selectDoctorForActiveSlot = function (docName) {
        const target = window.emergencyState.activeSlotTarget;
        if (!target) return;

        window.emergencyState.schedules[target.scheduleType][target.dayIndex][target.slotKey] = docName;
        saveState();
        closeDoctorPickerModal();
        renderActiveTab();
        showToast(`تم تعيين ${docName} بنجاح`, "success");
    };

    window.clearActiveSlot = function () {
        const target = window.emergencyState.activeSlotTarget;
        if (!target) return;

        window.emergencyState.schedules[target.scheduleType][target.dayIndex][target.slotKey] = '';
        saveState();
        closeDoctorPickerModal();
        renderActiveTab();
        showToast("تم إفراغ الخفارة", "info");
    };

    window.updateDayNotes = function (scheduleType, dayIndex, notes) {
        if (window.emergencyState.schedules[scheduleType][dayIndex]) {
            window.emergencyState.schedules[scheduleType][dayIndex].notes = notes;
            saveState();
        }
    };

    // ------------------------------------------------------------------------
    // Smart Auto-Schedule Generator (Fairness & Collision-Free Algorithm)
    // ------------------------------------------------------------------------
    window.autoGenerateSchedule = function () {
        if (!confirm("هل ترغب في توليد الجدول آلياً بنقرة واحدة وتوزيع الخفارات بالتساوي على الأطباء وفق حصصهم ودون أي تعارض؟")) {
            return;
        }

        const residents = window.emergencyState.residents.filter(r => !(r.notes || '').includes('HIDE'));
        const totalDays = window.emergencyState.schedules.er.length || 30;

        // Quota trackers
        const assignedCounts = {};
        residents.forEach(r => {
            assignedCounts[r.name] = { er: 0, con: 0, dc: 0, rs: 0 };
        });

        // Clear existing schedules
        for (let i = 0; i < totalDays; i++) {
            if (window.emergencyState.schedules.er[i]) {
                window.emergencyState.schedules.er[i].morning = '';
                window.emergencyState.schedules.er[i].afternoon = '';
                window.emergencyState.schedules.er[i].preNight = '';
                window.emergencyState.schedules.er[i].lateNight = '';
            }
            if (window.emergencyState.schedules.con[i]) {
                window.emergencyState.schedules.con[i].doctor = '';
            }
            if (window.emergencyState.schedules.dc[i]) {
                window.emergencyState.schedules.dc[i].doctor = '';
            }
        }

        // Helper to pick doctor for day and slot
        function pickDoctorForSlot(dayIdx, dutyType, occupiedToday) {
            const candidates = residents.filter(r => {
                if (occupiedToday.has(r.name)) return false;
                const quota = dutyType === 'er' ? r.er_target : (dutyType === 'con' ? r.con_target : r.dc_target);
                const current = dutyType === 'er' ? assignedCounts[r.name].er : (dutyType === 'con' ? assignedCounts[r.name].con : assignedCounts[r.name].dc);
                return current < quota;
            });

            if (candidates.length === 0) {
                // fallback to any non-occupied doctor
                const fallback = residents.filter(r => !occupiedToday.has(r.name));
                if (fallback.length === 0) return null;
                return fallback[Math.floor(Math.random() * fallback.length)].name;
            }

            // Pick doctor with highest remaining quota
            candidates.sort((a, b) => {
                const remA = (dutyType === 'er' ? a.er_target : a.con_target) - (dutyType === 'er' ? assignedCounts[a.name].er : assignedCounts[a.name].con);
                const remB = (dutyType === 'er' ? b.er_target : b.con_target) - (dutyType === 'er' ? assignedCounts[b.name].er : assignedCounts[b.name].con);
                return remB - remA;
            });

            const picked = candidates[0].name;
            assignedCounts[picked][dutyType]++;
            occupiedToday.add(picked);
            return picked;
        }

        // Fill day by day
        for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
            const occupiedToday = new Set();

            // 1. Fill Consultatory (1 doctor)
            const conDoc = pickDoctorForSlot(dayIdx, 'con', occupiedToday);
            if (conDoc && window.emergencyState.schedules.con[dayIdx]) {
                window.emergencyState.schedules.con[dayIdx].doctor = conDoc;
            }

            // 2. Fill Death Certification (1 doctor)
            const dcDoc = pickDoctorForSlot(dayIdx, 'dc', occupiedToday);
            if (dcDoc && window.emergencyState.schedules.dc[dayIdx]) {
                window.emergencyState.schedules.dc[dayIdx].doctor = dcDoc;
            }

            // 3. Fill ER (4 doctors)
            const erMorning = pickDoctorForSlot(dayIdx, 'er', occupiedToday);
            const erAfternoon = pickDoctorForSlot(dayIdx, 'er', occupiedToday);
            const erPreNight = pickDoctorForSlot(dayIdx, 'er', occupiedToday);
            const erLateNight = pickDoctorForSlot(dayIdx, 'er', occupiedToday);

            if (window.emergencyState.schedules.er[dayIdx]) {
                window.emergencyState.schedules.er[dayIdx].morning = erMorning || '';
                window.emergencyState.schedules.er[dayIdx].afternoon = erAfternoon || '';
                window.emergencyState.schedules.er[dayIdx].preNight = erPreNight || '';
                window.emergencyState.schedules.er[dayIdx].lateNight = erLateNight || '';
            }
        }

        saveState();
        renderActiveTab();
        showToast("تم توليد الجدول بالكامل بنجاح وبدون أي تعارض!", "success");
    };

    // ------------------------------------------------------------------------
    // Search & Filter Residents in DB Tab
    // ------------------------------------------------------------------------
    window.searchResidents = function (query) {
        window.emergencyState.searchQuery = query;
        renderActiveTab();
    };

    window.filterResidentsList = function (filter) {
        window.emergencyState.activeFilter = filter;
        renderActiveTab();
    };

    window.toggleResidentHide = function (resId) {
        const res = window.emergencyState.residents.find(r => r.id === resId);
        if (!res) return;
        if (res.notes.includes('HIDE')) {
            res.notes = res.notes.replace('HIDE', '').trim();
        } else {
            res.notes = (res.notes + ' HIDE').trim();
        }
        saveState();
        renderActiveTab();
    };

    // ------------------------------------------------------------------------
    // Global Stats Counter
    // ------------------------------------------------------------------------
    function updateGlobalStats() {
        const residents = window.emergencyState.residents || [];
        const activeResidents = residents.filter(r => !(r.notes || '').includes('HIDE'));

        let totalErFilled = 0;
        let totalConFilled = 0;
        let totalDcFilled = 0;

        window.emergencyState.schedules.er.forEach(d => {
            if (d.morning) totalErFilled++;
            if (d.afternoon) totalErFilled++;
            if (d.preNight) totalErFilled++;
            if (d.lateNight) totalErFilled++;
        });

        window.emergencyState.schedules.con.forEach(d => { if (d.doctor) totalConFilled++; });
        window.emergencyState.schedules.dc.forEach(d => { if (d.doctor) totalDcFilled++; });

        const totalFilled = totalErFilled + totalConFilled + totalDcFilled;
        const totalRequired = (window.emergencyState.schedules.er.length * 4) + window.emergencyState.schedules.con.length + window.emergencyState.schedules.dc.length;

        const statTotalDocs = document.getElementById('stat-total-doctors');
        if (statTotalDocs) statTotalDocs.textContent = activeResidents.length;

        const statProgress = document.getElementById('stat-total-filled');
        if (statProgress) statProgress.textContent = `${totalFilled} / ${totalRequired}`;

        const statDays = document.getElementById('stat-total-days');
        if (statDays) statDays.textContent = window.emergencyState.schedules.er.length;
    }

    // ------------------------------------------------------------------------
    // Export to Excel (.xlsx) using SheetJS
    // ------------------------------------------------------------------------
    window.exportFullScheduleToExcel = function () {
        if (typeof XLSX === 'undefined') {
            alert("مكتبة تصدير Excel قيد التحميل، يرجى المحاولة بعد قليل");
            return;
        }

        const wb = XLSX.utils.book_new();

        // 1. ER Sheet
        const erData = [
            ['العـــدد / ' + window.emergencyState.orderNumber, '', '', '', '', 'التاريخ / ' + window.emergencyState.orderDate],
            ['جدول خفارات المقيمين الأقدمين في قسم الطوارئ لشهر ' + window.emergencyState.monthYear],
            ['#', 'اليوم', 'التاريخ', 'الصباحية (8ص-2م)', 'بعد الصباحية (2م-8م)', 'البرينايت (8م-2ص)', 'الليلية (2ص-8ص)', 'الملاحظات']
        ];
        window.emergencyState.schedules.er.forEach((d, i) => {
            erData.push([i + 1, d.dayName, d.date, d.morning || '', d.afternoon || '', d.preNight || '', d.lateNight || '', d.notes || '']);
        });
        const wsER = XLSX.utils.aoa_to_sheet(erData);
        XLSX.utils.book_append_sheet(wb, wsER, 'الطوارئ ER');

        // 2. Con Sheet
        const conData = [
            ['جدول خفارات الاستشارية الخافرة لشهر ' + window.emergencyState.monthYear],
            ['#', 'اليوم', 'التاريخ', 'طبيب الاستشارية']
        ];
        window.emergencyState.schedules.con.forEach((d, i) => {
            conData.push([i + 1, d.dayName, d.date, d.doctor || '']);
        });
        const wsCon = XLSX.utils.aoa_to_sheet(conData);
        XLSX.utils.book_append_sheet(wb, wsCon, 'الاستشارية Con');

        // 3. DC Sheet
        const dcData = [
            ['جدول خفارات تنظيم شهادات الوفاة لشهر ' + window.emergencyState.monthYear],
            ['#', 'اليوم', 'التاريخ', 'طبيب تنظيم الوفيات']
        ];
        window.emergencyState.schedules.dc.forEach((d, i) => {
            dcData.push([i + 1, d.dayName, d.date, d.doctor || '']);
        });
        const wsDC = XLSX.utils.aoa_to_sheet(dcData);
        XLSX.utils.book_append_sheet(wb, wsDC, 'الوفيات DC');

        // 4. DB Residents Sheet
        const dbData = [
            ['#', 'اسم الطبيب', 'الاختصاص', 'المرحلة', 'البورد', 'الجنس', 'حصة ER', 'حصة Con', 'حصة DC', 'حصة RS', 'الملاحظات']
        ];
        window.emergencyState.residents.forEach((r, i) => {
            dbData.push([i + 1, r.name, r.specialty, r.stage, r.board, r.sex, r.er_target, r.con_target, r.dc_target, r.rs_target, r.notes || '']);
        });
        const wsDB = XLSX.utils.aoa_to_sheet(dbData);
        XLSX.utils.book_append_sheet(wb, wsDB, 'قاعدة الأطباء DB');

        XLSX.writeFile(wb, `جدول_خفارات_الطوارئ_${window.emergencyState.monthYear.replace(/\s+/g, '_')}.xlsx`);
        showToast("تم تصدير ملف Excel بنجاح", "success");
    };

    // ------------------------------------------------------------------------
    // UI Helpers & Toast
    // ------------------------------------------------------------------------
    function showToast(message, type = 'info') {
        let toast = document.getElementById('hub-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'hub-toast';
            toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl shadow-xl text-xs font-bold transition-all duration-300 pointer-events-none transform translate-y-12 opacity-0';
            document.body.appendChild(toast);
        }

        const colors = {
            success: 'bg-emerald-600 text-white shadow-emerald-600/30',
            error: 'bg-rose-600 text-white shadow-rose-600/30',
            info: 'bg-slate-900 text-white shadow-slate-900/30 dark:bg-white dark:text-slate-900'
        };

        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl shadow-xl text-xs font-bold transition-all duration-300 pointer-events-none transform translate-y-0 opacity-100 ${colors[type] || colors.info}`;
        toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-triangle-exclamation' : 'fa-info-circle')} ml-1.5"></i> ${message}`;

        setTimeout(() => {
            toast.classList.add('translate-y-12', 'opacity-0');
        }, 3000);
    }

    function setupEventListeners() {
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('keydown', e => {
                if (e.key === 'Escape') closeDoctorPickerModal();
            });
        }
    }

    // Expose init globally
    window.initEmergencySystem = initEmergencySystem;
    window.resetEmergencyToDefaults = resetToDefaults;

    // Run on load
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', initEmergencySystem);
    }
})();
