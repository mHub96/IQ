/**
 * EMERGENCY SHIFT & ON-CALL ROSTER MANAGEMENT SYSTEM
 * HOSP HUB — Full Feature Implementation V2
 * 
 * Features:
 * - Search & Header-based filter in all schedules
 * - Direct in-database editing without prompts
 * - Isolated inactive residents section with confirmation & zeroing allocations
 * - Optional expiry month per resident
 * - Board stage advancement (+1)
 * - Separate automatic distribution per schedule with existing-entries prompt
 * - Gender-prioritized ER shift allocation algorithm (Morning/Post-morning: Females, Pre-night: Males with multiple, Night: Males single)
 * - Duty preferences (preferred days & shifts) with override indication
 * - Conflict explanation on click with empty button
 * - Death Certificate multi-duty conflict checking
 * - Hide fulfilled residents from picker
 * - Color system in DB (Green fulfilled, Red unfulfilled, Orange badge for extra/RS)
 * - Strict Single A4 page formal printout with ministerial header & footer
 * - Full validation on resident export to hospital (phone required)
 */

(function(window) {
    'use strict';

    const STATE_KEY = 'hosp_hub_emergency_state_v3';
    const DB_FILE = './emergency-db.json';

    let state = {
        hospitalId: 'iraqi',
        hospitalName: 'مستشفى الصدر التعليمي',
        monthYear: 'أيلول 2026',
        month: 9,
        year: 2026,
        orderNumber: '4821',
        orderDate: '2026-09-01',
        headOfResidents: 'د. محمد راضي خضر',
        headOfHospital: 'د. علي عبد معن',
        rsEnabled: true,
        rsStartDate: '2026-09-15',
        rsEndDate: '2026-09-20',
        activeTab: 'er',
        showInactiveInDB: false,
        // Schedule search & filter states
        scheduleSearchQuery: '',
        scheduleDoctorFilter: '',
        scheduleEmptyOnly: false,
        scheduleConflictOnly: false,
        dbSearchQuery: '',
        scheduleShiftFilter: 'all',
        scheduleDayFilter: 'all',
        scheduleStatusFilter: 'all',
        // In-schedule preference override notes
        prefOverrides: {},
        residents: [],
        schedules: {
            er: [],
            con: [],
            dc: [],
            rs: []
        }
    };

    let activeSlot = null; // currently opened slot in picker
    let pendingConflictData = null; // slot data for conflict explanation modal
    let pendingAutoGenerateType = null; // schedule type for auto generate modal

    // Days in current month
    function getDaysInMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    // Arabic day name
    function getArabicDayName(year, month, day) {
        const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const d = new Date(year, month - 1, day);
        return days[d.getDay()];
    }

    // Format date string YYYY-MM-DD
    function formatDateStr(year, month, day) {
        const m = String(month).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        return `${year}-${m}-${d}`;
    }

    // Format date string DD/MM/YYYY
    function formatHospitalDateStr(year, month, day) {
        const m = String(month).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        return `${d}/${m}/${year}`;
    }

    // Normalize Arabic text for fuzzy matching
    function normalizeArabic(text) {
        if (!text) return '';
        return String(text)
            .replace(/^د[\.\s]+/, '')
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/[\u064B-\u065F]/g, '')
            .replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ')
            .trim();
    }

    // Check if a resident is expired for the current month/year
    function isResidentExpired(resident, year, month) {
        if (!resident || !resident.expiryMonth) return false;
        const [expY, expM] = resident.expiryMonth.split('-').map(Number);
        if (!expY || !expM) return false;
        if (year > expY) return true;
        if (year === expY && month >= expM) return true;
        return false;
    }

    // =========================================================================
    // INITIALIZATION & STATE PERSISTENCE
    // =========================================================================

    async function initEmergencyApp() {
        console.log('Initializing Emergency System V2...');

        // 1. Load from localStorage if present
        const saved = localStorage.getItem(STATE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                state = Object.assign(state, parsed);
            } catch (e) {
                console.warn('Failed to parse saved emergency state, falling back to defaults', e);
            }
        }

        // 2. Fallback to DEFAULT_EMERGENCY_DATA if residents or schedules empty
        if (!state.residents || state.residents.length === 0) {
            if (window.DEFAULT_EMERGENCY_DATA && window.DEFAULT_EMERGENCY_DATA.residents) {
                state.residents = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.residents));
                state.schedules = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.schedules));
                state.hospitalName = window.DEFAULT_EMERGENCY_DATA.hospitalName || state.hospitalName;
                state.monthYear = window.DEFAULT_EMERGENCY_DATA.monthYear || state.monthYear;
                state.orderNumber = window.DEFAULT_EMERGENCY_DATA.orderNumber || state.orderNumber;
                state.orderDate = window.DEFAULT_EMERGENCY_DATA.orderDate || state.orderDate;
                state.headOfResidents = window.DEFAULT_EMERGENCY_DATA.headOfResidents || state.headOfResidents;
                state.headOfHospital = window.DEFAULT_EMERGENCY_DATA.headOfHospital || state.headOfHospital;
                state.rsStartDate = window.DEFAULT_EMERGENCY_DATA.rsStartDate || state.rsStartDate;
                state.rsEndDate = window.DEFAULT_EMERGENCY_DATA.rsEndDate || state.rsEndDate;
            }
        }

        // 3. Try to fetch emergency-db.json asynchronously if fresh
        try {
            const resp = await fetch(DB_FILE);
            if (resp.ok) {
                const dbJson = await resp.json();
                if (dbJson && Array.isArray(dbJson.residents) && dbJson.residents.length > 0) {
                    if (!saved) {
                        state.residents = dbJson.residents;
                        state.headOfResidents = dbJson.headOfResidents || state.headOfResidents;
                        state.headOfHospital = dbJson.headOfHospital || state.headOfHospital;
                    }
                }
            }
        } catch (err) {
            console.log('Using bundled state');
        }

        // 4. Ensure schedule integrity
        ensureScheduleIntegrity();

        // 5. Initialize Hospital Selector from Hub
        initHospitalSelector();

        // 6. Sync UI inputs with state
        syncMetaInputsWithState();

        // 7. Render UI
        updateDutyDashboard();
        renderActiveTab();
        updateRsVisibilityUI();
        initAutoModalListeners();
    }

    function ensureScheduleIntegrity() {
        const daysCount = getDaysInMonth(state.year, state.month);
        
        ['er', 'con', 'dc', 'rs'].forEach(type => {
            if (!Array.isArray(state.schedules[type])) {
                state.schedules[type] = [];
            }
            for (let d = 1; d <= daysCount; d++) {
                const dateStr = formatDateStr(state.year, state.month, d);
                const dayName = getArabicDayName(state.year, state.month, d);
                let entry = state.schedules[type].find(s => s.dayNumber === d);
                
                if (!entry) {
                    if (type === 'er') {
                        entry = { dayNumber: d, date: dateStr, dayName, morning: '', afternoon: '', preNight: '', lateNight: '', notes: '' };
                    } else if (type === 'con' || type === 'dc') {
                        entry = { dayNumber: d, date: dateStr, dayName, doctor: '' };
                    } else if (type === 'rs') {
                        entry = { dayNumber: d, date: dateStr, dayName, er_morning: '', er_afternoon: '', er_preNight: '', er_lateNight: '', ward_private: '', ward_floor4: '', ward_floor5: '' };
                    }
                    state.schedules[type].push(entry);
                } else {
                    entry.date = dateStr;
                    entry.dayName = dayName;
                }
            }
            state.schedules[type].sort((a, b) => a.dayNumber - b.dayNumber);
        });
    }

    function saveState() {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        updateDutyDashboard();
    }

    function resetEmergencyToDefaults() {
        if (!confirm('هل أنت متأكد من استعادة النسخة الأصلية للجدول وقاعدة الأطباء؟')) return;
        localStorage.removeItem(STATE_KEY);
        if (window.DEFAULT_EMERGENCY_DATA) {
            state.residents = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.residents));
            state.schedules = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.schedules));
            state.hospitalName = window.DEFAULT_EMERGENCY_DATA.hospitalName || 'مستشفى الصدر التعليمي';
            state.monthYear = window.DEFAULT_EMERGENCY_DATA.monthYear || 'أيلول 2026';
            state.orderNumber = window.DEFAULT_EMERGENCY_DATA.orderNumber || '4821';
            state.orderDate = window.DEFAULT_EMERGENCY_DATA.orderDate || '2026-09-01';
            state.headOfResidents = window.DEFAULT_EMERGENCY_DATA.headOfResidents || 'د. محمد راضي خضر';
            state.headOfHospital = window.DEFAULT_EMERGENCY_DATA.headOfHospital || 'د. علي عبد معن';
            state.rsEnabled = true;
            state.rsStartDate = window.DEFAULT_EMERGENCY_DATA.rsStartDate || '2026-09-15';
            state.rsEndDate = window.DEFAULT_EMERGENCY_DATA.rsEndDate || '2026-09-20';
        }
        ensureScheduleIntegrity();
        saveState();
        syncMetaInputsWithState();
        renderActiveTab();
        showNotification('تمت استعادة النسخة الأصلية بنجاح', 'success');
    }

    // =========================================================================
    // HOSPITAL HUB INTEGRATION & SELECTORS
    // =========================================================================

    function initHospitalSelector() {
        const selectEl = document.getElementById('meta-hosp-select');
        if (!selectEl) return;

        let hospitals = [];
        if (window.Hub && typeof window.Hub.getHospitals === 'function') {
            hospitals = window.Hub.getHospitals() || [];
        }

        if (hospitals.length === 0) {
            hospitals = [
                { id: 'iraqi', name_ar: 'مستشفى الصدر التعليمي' },
                { id: 'basra', name_ar: 'مستشفى البصرة التعليمي' },
                { id: 'mawani', name_ar: 'مستشفى الموانئ التعليمي' }
            ];
        }

        selectEl.innerHTML = '';
        hospitals.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h.id;
            opt.textContent = h.name_ar || h.hospitalName || h.id;
            if (h.id === state.hospitalId) opt.selected = true;
            selectEl.appendChild(opt);
        });

        const activeHosp = hospitals.find(h => h.id === state.hospitalId);
        if (activeHosp) {
            state.hospitalName = activeHosp.name_ar || activeHosp.hospitalName || state.hospitalName;
        }
    }

    function onHospitalChange(hospId) {
        state.hospitalId = hospId;
        let hospName = hospId;
        if (window.Hub && typeof window.Hub.getHospital === 'function') {
            const h = window.Hub.getHospital(hospId);
            if (h) hospName = h.name_ar || h.hospitalName || hospId;
        } else {
            const selectEl = document.getElementById('meta-hosp-select');
            if (selectEl && selectEl.selectedOptions[0]) {
                hospName = selectEl.selectedOptions[0].textContent;
            }
        }
        state.hospitalName = hospName;
        saveState();
        renderActiveTab();
        showNotification(`تم التبديل إلى: ${hospName}`, 'info');
    }

    function onMonthYearChange(monthVal, yearVal) {
        state.month = parseInt(monthVal) || state.month;
        state.year = parseInt(yearVal) || state.year;
        
        const monthNames = [
            'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
            'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الآخر', 'كانون الأول'
        ];
        state.monthYear = `${monthNames[state.month - 1]} ${state.year}`;
        
        ensureScheduleIntegrity();
        saveState();
        syncMetaInputsWithState();
        renderActiveTab();
    }

    function onOrderNumberChange(val) {
        state.orderNumber = val.trim();
        saveState();
    }

    function onOrderDateChange(val) {
        state.orderDate = val;
        saveState();
    }

    function onHeadOfResidentsChange(val) {
        state.headOfResidents = val.trim();
        saveState();
    }

    function onHeadOfHospitalChange(val) {
        state.headOfHospital = val.trim();
        saveState();
    }

    function suggestSequentialOrderNumber() {
        const currentNum = parseInt(state.orderNumber) || 4820;
        const nextNum = currentNum + 1;
        state.orderNumber = String(nextNum);
        const input = document.getElementById('meta-order-number');
        if (input) input.value = state.orderNumber;
        saveState();
        showNotification(`تم اقتراح الرقم الإداري المتسلسل: ${state.orderNumber}`, 'success');
    }

    function onRsDateChange(field, val) {
        state[field] = val;
        saveState();
        updateDutyDashboard();
        if (state.activeTab === 'rs_er' || state.activeTab === 'rs_wards') {
            renderActiveTab();
        }
    }

    function toggleRotatorsStrike() {
        state.rsEnabled = !state.rsEnabled;
        saveState();
        updateRsVisibilityUI();
        if (!state.rsEnabled && (state.activeTab === 'rs_er' || state.activeTab === 'rs_wards')) {
            switchTab('er');
        } else {
            renderActiveTab();
        }
        showNotification(state.rsEnabled ? 'تم تفعيل حالة إضراب المقيمين الدوريين (RS)' : 'تم إخفاء وتعطيل إضراب المقيمين (RS)', 'info');
    }

    function updateRsVisibilityUI() {
        const rsBadge = document.getElementById('rs-toggle-badge');
        const rsSettingsBar = document.getElementById('rs-settings-bar');
        const rsErTabBtn = document.getElementById('tab-btn-rs-er');
        const rsWardsTabBtn = document.getElementById('tab-btn-rs-wards');

        if (rsBadge) {
            rsBadge.textContent = state.rsEnabled ? 'مفعّل' : 'معطّل';
            rsBadge.className = state.rsEnabled 
                ? 'text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold'
                : 'text-[10px] bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-2 py-0.5 rounded-full font-bold';
        }

        if (rsSettingsBar) {
            rsSettingsBar.style.display = state.rsEnabled ? 'flex' : 'none';
        }
        if (rsErTabBtn) {
            rsErTabBtn.style.display = state.rsEnabled ? 'flex' : 'none';
        }
        if (rsWardsTabBtn) {
            rsWardsTabBtn.style.display = state.rsEnabled ? 'flex' : 'none';
        }
    }

    function syncMetaInputsWithState() {
        const hospSelect = document.getElementById('meta-hosp-select');
        if (hospSelect) hospSelect.value = state.hospitalId;

        const monthSelect = document.getElementById('meta-month-select');
        if (monthSelect) monthSelect.value = state.month;

        const yearInput = document.getElementById('meta-year-input');
        if (yearInput) yearInput.value = state.year;

        const orderInput = document.getElementById('meta-order-number');
        if (orderInput) orderInput.value = state.orderNumber;

        const orderDateInput = document.getElementById('meta-order-date');
        if (orderDateInput) orderDateInput.value = state.orderDate || '2026-09-01';

        const headResInput = document.getElementById('meta-head-residents');
        if (headResInput) headResInput.value = state.headOfResidents || 'د. محمد راضي خضر';

        const headHospInput = document.getElementById('meta-head-hospital');
        if (headHospInput) headHospInput.value = state.headOfHospital || 'د. علي عبد معن';

        const rsStartInput = document.getElementById('meta-rs-start');
        if (rsStartInput) rsStartInput.value = state.rsStartDate;

        const rsEndInput = document.getElementById('meta-rs-end');
        if (rsEndInput) rsEndInput.value = state.rsEndDate;
    }

    // =========================================================================
    // CONFLICT ENGINE & HOSPITAL LOOKUP
    // =========================================================================

    function getDoctorDutiesOnDate(doctorName, dateStr) {
        if (!doctorName || !doctorName.trim()) return [];
        const cleanTarget = normalizeArabic(doctorName);
        const duties = [];

        const parts = dateStr.split('-');
        const dayNumber = parseInt(parts[2], 10);

        // 1. ER Schedule
        const erDay = (state.schedules.er || []).find(s => s.dayNumber === dayNumber);
        if (erDay) {
            const slots = [
                { key: 'morning', label: 'طوارئ: الصباحية (8ص-2م)' },
                { key: 'afternoon', label: 'طوارئ: بعد الصباحية (2م-8م)' },
                { key: 'preNight', label: 'طوارئ: البرينايت (8م-2ص)' },
                { key: 'lateNight', label: 'طوارئ: الليلية (2ص-8ص)' }
            ];
            slots.forEach(s => {
                if (erDay[s.key] && normalizeArabic(erDay[s.key]) === cleanTarget) {
                    duties.push({ type: 'er', slotKey: s.key, label: s.label });
                }
            });
        }

        // 2. Consultation Clinic (Con)
        const conDay = (state.schedules.con || []).find(s => s.dayNumber === dayNumber);
        if (conDay && conDay.doctor && normalizeArabic(conDay.doctor) === cleanTarget) {
            duties.push({ type: 'con', slotKey: 'doctor', label: 'الاستشارية الخافرة' });
        }

        // 3. Death Certificates (DC)
        const dcDay = (state.schedules.dc || []).find(s => s.dayNumber === dayNumber);
        if (dcDay && dcDay.doctor && normalizeArabic(dcDay.doctor) === cleanTarget) {
            duties.push({ type: 'dc', slotKey: 'doctor', label: 'شهادات الوفاة' });
        }

        // 4. Rotators Strike (RS)
        if (state.rsEnabled) {
            const rsDay = (state.schedules.rs || []).find(s => s.dayNumber === dayNumber);
            if (rsDay) {
                const rsSlots = [
                    { key: 'er_morning', label: 'إضراب طوارئ: صباحية' },
                    { key: 'er_afternoon', label: 'إضراب طوارئ: بعد الصباحية' },
                    { key: 'er_preNight', label: 'إضراب طوارئ: برينايت' },
                    { key: 'er_lateNight', label: 'إضراب طوارئ: ليلية' },
                    { key: 'ward_private', label: 'إضراب ردهات: الجناح الخاص' },
                    { key: 'ward_floor4', label: 'إضراب ردهات: طابق 4' },
                    { key: 'ward_floor5', label: 'إضراب ردهات: طابق 5' }
                ];
                rsSlots.forEach(s => {
                    if (rsDay[s.key] && normalizeArabic(rsDay[s.key]) === cleanTarget) {
                        duties.push({ type: 'rs', slotKey: s.key, label: s.label });
                    }
                });
            }
        }

        // 5. Hospital On-Call Duty (h.schedule)
        const hospDuties = getHospitalDutiesForDoctor(doctorName, dateStr);
        hospDuties.forEach(hd => {
            duties.push({
                type: 'hospital',
                slotKey: hd.specCode,
                label: `خفارة اختصاص في المستشفى: ${hd.specName}`
            });
        });

        return duties;
    }

    function getHospitalDutiesForDoctor(doctorName, dateStr) {
        if (!window.Hub || typeof window.Hub.getHospital !== 'function') return [];
        const hosp = window.Hub.getHospital(state.hospitalId);
        if (!hosp || !Array.isArray(hosp.schedule)) return [];

        const parts = dateStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const hospDateStr = formatHospitalDateStr(y, m, d);

        const cleanTarget = normalizeArabic(doctorName);
        const matched = [];

        hosp.schedule.forEach(item => {
            if (item.date === hospDateStr && item.name && normalizeArabic(item.name) === cleanTarget) {
                const specName = (window.Hub.getSpecialtyName && window.Hub.getSpecialtyName(item.specCode)) || item.specCode;
                matched.push({
                    specCode: item.specCode,
                    specName: specName,
                    name: item.name
                });
            }
        });

        return matched;
    }

    function getAllHospitalOnCallDoctors(dateStr) {
        if (!window.Hub || typeof window.Hub.getHospital !== 'function') return [];
        const hosp = window.Hub.getHospital(state.hospitalId);
        if (!hosp || !Array.isArray(hosp.schedule)) return [];

        const parts = dateStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const hospDateStr = formatHospitalDateStr(y, m, d);

        const onCall = [];
        hosp.schedule.forEach(item => {
            if (item.date === hospDateStr && item.name && item.name.trim()) {
                const specName = (window.Hub.getSpecialtyName && window.Hub.getSpecialtyName(item.specCode)) || item.specCode;
                onCall.push({
                    name: item.name,
                    cleanName: normalizeArabic(item.name),
                    specCode: item.specCode,
                    specName: specName
                });
            }
        });
        return onCall;
    }

    /**
     * Conflict Check:
     * - For Death Certificates (DC): Hospital specialty on-call is EXPECTED and VALID (green).
     *   However, if doctor has OTHER duties in ER, Con, or RS on that day, it IS a conflict!
     */
    function evaluateCellConflict(doctorName, dateStr, currentSlotType, currentSlotKey) {
        if (!doctorName || !doctorName.trim()) {
            return { hasConflict: false, isDcHospitalDuty: false, conflicts: [] };
        }

        const allDuties = getDoctorDutiesOnDate(doctorName, dateStr);
        const otherDuties = allDuties.filter(d => !(d.type === currentSlotType && d.slotKey === currentSlotKey));

        if (currentSlotType === 'dc') {
            // For DC: Check for other shifts apart from hospital specialty duty
            const nonHospitalConflicts = otherDuties.filter(d => d.type !== 'hospital');
            const hospDuty = otherDuties.find(d => d.type === 'hospital');

            if (nonHospitalConflicts.length > 0) {
                // Real conflict: doctor has ER, Con, or RS duty as well!
                return {
                    hasConflict: true,
                    isDcHospitalDuty: !!hospDuty,
                    hospDutyName: hospDuty ? hospDuty.label : '',
                    conflicts: nonHospitalConflicts
                };
            }

            if (hospDuty) {
                return {
                    hasConflict: false,
                    isDcHospitalDuty: true,
                    hospDutyName: hospDuty.label,
                    conflicts: []
                };
            }

            return { hasConflict: false, isDcHospitalDuty: false, conflicts: [] };
        }

        // For non-DC slots: any other duty is a conflict
        const hasConflict = otherDuties.length > 0;
        return {
            hasConflict,
            isDcHospitalDuty: false,
            conflicts: otherDuties
        };
    }

    // =========================================================================
    // CONFLICT MODAL (CLICK-TO-EXPLAIN WITH EMPTY OPTION)
    // =========================================================================

    function openConflictExplanation(tableType, dayNumber, dateStr, slotKey, doctorName, event) {
        if (event) event.stopPropagation();

        const conflictInfo = evaluateCellConflict(doctorName, dateStr, tableType, slotKey);
        pendingConflictData = { tableType, dayNumber, slotKey, doctorName };

        const modal = document.getElementById('conflict-modal');
        const detailsEl = document.getElementById('conflict-modal-details');
        const emptyBtn = document.getElementById('conflict-modal-empty-btn');

        if (!modal || !detailsEl) return;

        detailsEl.innerHTML = `
            <div class="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 space-y-1">
                <div>طبيب الخفارة: <strong class="text-slate-800 dark:text-slate-100">${doctorName}</strong></div>
                <div>اليوم والتاريخ: <span class="font-mono">${dateStr}</span></div>
                <div>الخفارة المحددة هنا: <span class="text-rose-600 font-bold">${getSlotHumanLabel(tableType, slotKey)}</span></div>
            </div>

            <div class="space-y-1 pt-1">
                <span class="font-bold text-slate-700 dark:text-slate-300 block">الخفارات المتعارضة المسجلة لنفس الطبيب في هذا اليوم:</span>
                <ul class="space-y-1 pr-4 list-disc text-amber-700 dark:text-amber-400 font-medium">
                    ${conflictInfo.conflicts.map(c => `<li>${c.label}</li>`).join('')}
                </ul>
            </div>

            <p class="text-[11px] text-slate-400 pt-1">
                يمكنك إبقاء الخفارة كما هي، أو إفراغ هذه الخانة فقط وإعادة تعيين طبيب آخر.
            </p>
        `;

        emptyBtn.onclick = function() {
            clearCellOnly(pendingConflictData.tableType, pendingConflictData.dayNumber, pendingConflictData.slotKey);
            closeConflictModal();
        };

        modal.classList.remove('hidden');
    }

    function closeConflictModal() {
        const modal = document.getElementById('conflict-modal');
        if (modal) modal.classList.add('hidden');
        pendingConflictData = null;
    }

    function clearCellOnly(tableType, dayNumber, slotKey) {
        const dayEntry = (state.schedules[tableType] || []).find(s => s.dayNumber === dayNumber);
        if (!dayEntry) return;

        dayEntry[slotKey] = '';
        saveState();
        renderActiveTab();
        showNotification('تم إفراغ الخلية في هذا الجدول بنجاح', 'info');
    }

    // =========================================================================
    // MONTHLY DUTY COUNTING DASHBOARD
    // =========================================================================

    function updateDutyDashboard() {
        const daysCount = getDaysInMonth(state.year, state.month);

        const activeDocs = (state.residents || []).filter(r => r.active && !isResidentExpired(r, state.year, state.month));
        const totalDocsCount = (state.residents || []).length;
        const totalDocEl = document.getElementById('stat-total-doctors');
        if (totalDocEl) totalDocEl.textContent = `${activeDocs.length} / ${totalDocsCount}`;

        // 1. ER Duties
        const erRequired = daysCount * 4;
        const erAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.er_target) || 0), 0);
        let erScheduled = 0;
        (state.schedules.er || []).forEach(day => {
            if (day.morning && day.morning.trim()) erScheduled++;
            if (day.afternoon && day.afternoon.trim()) erScheduled++;
            if (day.preNight && day.preNight.trim()) erScheduled++;
            if (day.lateNight && day.lateNight.trim()) erScheduled++;
        });

        // 2. Con Duties
        const conRequired = daysCount * 1;
        const conAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.con_target) || 0), 0);
        let conScheduled = 0;
        (state.schedules.con || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) conScheduled++;
        });

        // 3. DC Duties
        const dcRequired = daysCount * 1;
        const dcAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.dc_target) || 0), 0);
        let dcScheduled = 0;
        (state.schedules.dc || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) dcScheduled++;
        });

        // 4. RS Duties
        let rsDaysCount = 0;
        let rsErScheduled = 0;
        let rsWardsScheduled = 0;
        let rsAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.rs_target) || 0), 0);

        if (state.rsEnabled && state.rsStartDate && state.rsEndDate) {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || daysCount;
            rsDaysCount = Math.max(0, endDay - startDay + 1);

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    if (day.er_morning && day.er_morning.trim()) rsErScheduled++;
                    if (day.er_afternoon && day.er_afternoon.trim()) rsErScheduled++;
                    if (day.er_preNight && day.er_preNight.trim()) rsErScheduled++;
                    if (day.er_lateNight && day.er_lateNight.trim()) rsErScheduled++;
                    if (day.ward_private && day.ward_private.trim()) rsWardsScheduled++;
                    if (day.ward_floor4 && day.ward_floor4.trim()) rsWardsScheduled++;
                    if (day.ward_floor5 && day.ward_floor5.trim()) rsWardsScheduled++;
                }
            });
        }

        const container = document.getElementById('duty-dashboard-grid');
        if (!container) return;

        const makeBalancePill = (scheduled, required) => {
            const diff = scheduled - required;
            if (diff === 0) {
                return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">مكتمل تماماً</span>`;
            } else if (diff < 0) {
                return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">نقص (${diff})</span>`;
            } else {
                return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">زيادة (+${diff})</span>`;
            }
        };

        const makeAllocatedPill = (allocated, required) => {
            const diff = allocated - required;
            if (diff === 0) {
                return `<span class="text-emerald-600 font-bold">مطابق للمطلوب (${allocated})</span>`;
            } else if (diff < 0) {
                return `<span class="text-rose-500 font-bold">عجز في الأنصبة (${allocated} / ${required})</span>`;
            } else {
                return `<span class="text-amber-500 font-bold">فائض أنصبة (${allocated} / ${required})</span>`;
            }
        };

        container.innerHTML = `
            <!-- ER Card -->
            <div class="glass-panel rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-900 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-rose-600">
                        <i class="fas fa-truck-medical"></i>
                        <span>خفارات الطوارئ (ER)</span>
                    </span>
                    ${makeBalancePill(erScheduled, erRequired)}
                </div>
                <div class="flex items-baseline justify-between mt-2">
                    <div class="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-100">
                        ${erScheduled} <span class="text-xs font-normal text-slate-400">/ ${erRequired} مطلوب</span>
                    </div>
                </div>
                <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>الأنصبة المخصصة:</span>
                    ${makeAllocatedPill(erAllocated, erRequired)}
                </div>
            </div>

            <!-- Con Card -->
            <div class="glass-panel rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-900 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-sky-600">
                        <i class="fas fa-stethoscope"></i>
                        <span>الاستشارية الخافرة (Con)</span>
                    </span>
                    ${makeBalancePill(conScheduled, conRequired)}
                </div>
                <div class="flex items-baseline justify-between mt-2">
                    <div class="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-100">
                        ${conScheduled} <span class="text-xs font-normal text-slate-400">/ ${conRequired} مطلوب</span>
                    </div>
                </div>
                <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>الأنصبة المخصصة:</span>
                    ${makeAllocatedPill(conAllocated, conRequired)}
                </div>
            </div>

            <!-- DC Card -->
            <div class="glass-panel rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-900 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-emerald-600">
                        <i class="fas fa-file-medical"></i>
                        <span>شهادات الوفاة (DC)</span>
                    </span>
                    ${makeBalancePill(dcScheduled, dcRequired)}
                </div>
                <div class="flex items-baseline justify-between mt-2">
                    <div class="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-100">
                        ${dcScheduled} <span class="text-xs font-normal text-slate-400">/ ${dcRequired} مطلوب</span>
                    </div>
                </div>
                <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>الأنصبة المخصصة:</span>
                    ${makeAllocatedPill(dcAllocated, dcRequired)}
                </div>
            </div>

            <!-- RS Summary Card -->
            ${state.rsEnabled ? `
            <div class="glass-panel rounded-2xl p-3.5 border border-amber-200/80 dark:border-amber-900/60 bg-amber-500/5 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-amber-600">
                        <i class="fas fa-bed-pulse"></i>
                        <span>إضراب المقيمين الدوريين (RS)</span>
                    </span>
                    <span class="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-full">${rsDaysCount} يوم إضراب</span>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <div class="bg-white/60 dark:bg-slate-900/60 p-2 rounded-xl text-center">
                        <div class="text-[10px] font-bold text-slate-500">طوارئ الإضراب</div>
                        <div class="text-base font-black font-mono text-slate-800 dark:text-slate-100">${rsErScheduled} / ${rsDaysCount * 4}</div>
                    </div>
                    <div class="bg-white/60 dark:bg-slate-900/60 p-2 rounded-xl text-center">
                        <div class="text-[10px] font-bold text-slate-500">ردهات الإضراب</div>
                        <div class="text-base font-black font-mono text-slate-800 dark:text-slate-100">${rsWardsScheduled} / ${rsDaysCount * 3}</div>
                    </div>
                </div>
            </div>
            ` : ''}
        `;
    }

    // =========================================================================
    // TAB SWITCHING & RENDERING
    // =========================================================================

    function switchTab(tabId) {
        state.activeTab = tabId;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const isTarget = btn.getAttribute('data-tab') === tabId;
            if (isTarget) {
                btn.className = 'tab-btn active-tab flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 bg-rose-600 text-white shadow-sm';
            } else {
                btn.className = 'tab-btn flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:white';
            }
        });

        // Reset schedule search/filter on tab change
        state.scheduleSearchQuery = '';
        state.scheduleShiftFilter = 'all';
        state.scheduleDayFilter = 'all';
        state.scheduleStatusFilter = 'all';

        renderActiveTab();
    }

    function renderActiveTab() {
        const container = document.getElementById('schedule-view-container');
        if (!container) return;

        switch (state.activeTab) {
            case 'er':
                renderERView(container);
                break;
            case 'con':
                renderConView(container);
                break;
            case 'dc':
                renderDCView(container);
                break;
            case 'rs_er':
                renderRSERView(container);
                break;
            case 'rs_wards':
                renderRSWardsView(container);
                break;
            case 'db':
                renderDBView(container);
                break;
            default:
                renderERView(container);
        }
    }

    // =========================================================================
    // SEARCH & FILTER BAR FOR SCHEDULES (REAL-TIME NO-FOCUS-LOSS FILTERING)
    // =========================================================================

    function renderScheduleFilterBar(type, shiftOptions) {
        const eligibleDocs = (state.residents || [])
            .filter(r => r.active && !isResidentExpired(r, state.year, state.month))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

        return `
            <div class="p-3 mb-4 rounded-2xl bg-slate-100/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs no-print">
                <!-- Search input (Real-time live filtering without re-rendering) -->
                <div class="relative flex-1 min-w-[220px]">
                    <i class="fas fa-search absolute right-3 top-2.5 text-slate-400 text-xs"></i>
                    <input type="text" id="sched-search-input" value="${escapeForInline(state.scheduleSearchQuery || '')}" 
                        oninput="applyScheduleLiveFilter(this.value)" 
                        placeholder="بحث باسم الطبيب في الجدول أو اليوم..." 
                        class="w-full pr-8 pl-8 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 font-bold">
                    ${state.scheduleSearchQuery ? `
                        <button type="button" onclick="clearScheduleSearch()" class="absolute left-2.5 top-2 text-slate-400 hover:text-rose-600 text-xs" title="مسح البحث">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                    <!-- Doctor Selector Dropdown -->
                    <select id="sched-doctor-filter" onchange="onScheduleDoctorFilter(this.value)" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                        <option value="">-- تصفية بحسب الطبيب --</option>
                        ${eligibleDocs.map(d => `<option value="${escapeForInline(d.name)}" ${state.scheduleDoctorFilter === d.name ? 'selected' : ''}>${d.name} (${d.specialty || 'مقيم'})</option>`).join('')}
                    </select>

                    <!-- Shift Filter -->
                    ${shiftOptions ? `
                    <select id="sched-shift-filter" onchange="onScheduleShiftFilter(this.value)" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                        <option value="all" ${state.scheduleShiftFilter === 'all' ? 'selected' : ''}>كافة الوجبات</option>
                        ${shiftOptions.map(s => `<option value="${s.key}" ${state.scheduleShiftFilter === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                    ` : ''}

                    <!-- Day Filter -->
                    <select id="sched-day-filter" onchange="onScheduleDayFilter(this.value)" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                        <option value="all" ${state.scheduleDayFilter === 'all' ? 'selected' : ''}>جميع الأيام</option>
                        <option value="weekend" ${state.scheduleDayFilter === 'weekend' ? 'selected' : ''}>عطل نهاية الأسبوع (الجمعة/السبت)</option>
                        <option value="weekday" ${state.scheduleDayFilter === 'weekday' ? 'selected' : ''}>أيام الدوام الرسمي (أحد - خميس)</option>
                    </select>

                    <!-- Empty Slots Only Toggle -->
                    <label class="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 select-none text-xs font-bold px-1.5 py-1 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800/50">
                        <input type="checkbox" id="sched-empty-filter" ${state.scheduleEmptyOnly ? 'checked' : ''} onchange="onScheduleEmptyToggle(this.checked)" class="rounded text-rose-600">
                        <span>خانات شاغرة</span>
                    </label>

                    <!-- Conflict Slots Only Toggle -->
                    <label class="flex items-center gap-1.5 cursor-pointer text-amber-700 dark:text-amber-400 select-none text-xs font-bold px-1.5 py-1 rounded-lg hover:bg-amber-100/50 dark:hover:bg-amber-950/30">
                        <input type="checkbox" id="sched-conflict-filter" ${state.scheduleConflictOnly ? 'checked' : ''} onchange="onScheduleConflictToggle(this.checked)" class="rounded text-amber-600">
                        <span>التعارضات ⚠️</span>
                    </label>

                    <!-- Reset Filters Button -->
                    <button type="button" onclick="resetScheduleFilters('${type}')" class="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition">
                        إعادة ضبط
                    </button>

                    <!-- Live Counter Badge -->
                    <span id="sched-filter-count-badge" class="hidden text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"></span>
                </div>
            </div>
        `;
    }

    function onScheduleDoctorFilter(val) {
        state.scheduleDoctorFilter = val;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    function onScheduleShiftFilter(val) {
        state.scheduleShiftFilter = val;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    function onScheduleDayFilter(val) {
        state.scheduleDayFilter = val;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    function onScheduleEmptyToggle(checked) {
        state.scheduleEmptyOnly = checked;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    function onScheduleConflictToggle(checked) {
        state.scheduleConflictOnly = checked;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    function quickFilterByShift(shiftKey) {
        if (state.scheduleShiftFilter === shiftKey) {
            state.scheduleShiftFilter = 'all';
        } else {
            state.scheduleShiftFilter = shiftKey;
        }
        const shiftSelect = document.getElementById('sched-shift-filter');
        if (shiftSelect) shiftSelect.value = state.scheduleShiftFilter;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    function clearScheduleSearch() {
        state.scheduleSearchQuery = '';
        state.scheduleDoctorFilter = '';
        const searchInput = document.getElementById('sched-search-input');
        if (searchInput) searchInput.value = '';
        const docSelect = document.getElementById('sched-doctor-filter');
        if (docSelect) docSelect.value = '';
        applyScheduleLiveFilter('');
    }

    function resetScheduleFilters(type) {
        state.scheduleSearchQuery = '';
        state.scheduleDoctorFilter = '';
        state.scheduleShiftFilter = 'all';
        state.scheduleDayFilter = 'all';
        state.scheduleEmptyOnly = false;
        state.scheduleConflictOnly = false;

        const searchInput = document.getElementById('sched-search-input');
        if (searchInput) searchInput.value = '';
        const docSelect = document.getElementById('sched-doctor-filter');
        if (docSelect) docSelect.value = '';
        const shiftSelect = document.getElementById('sched-shift-filter');
        if (shiftSelect) shiftSelect.value = 'all';
        const daySelect = document.getElementById('sched-day-filter');
        if (daySelect) daySelect.value = 'all';
        const emptyCheck = document.getElementById('sched-empty-filter');
        if (emptyCheck) emptyCheck.checked = false;
        const conflictCheck = document.getElementById('sched-conflict-filter');
        if (conflictCheck) conflictCheck.checked = false;

        applyScheduleLiveFilter('');
    }

    // High performance live DOM filter for schedule table (NO FOCUS LOSS)
    function applyScheduleLiveFilter(queryVal) {
        if (queryVal !== undefined) {
            state.scheduleSearchQuery = queryVal.trim();
        } else {
            const input = document.getElementById('sched-search-input');
            if (input) state.scheduleSearchQuery = input.value.trim();
        }
        const cleanQ = normalizeArabic(state.scheduleSearchQuery).toLowerCase();

        const tableBody = document.querySelector('#schedule-view-container tbody');
        if (!tableBody) return;

        const rows = tableBody.querySelectorAll('tr[data-day]');
        let matchedDays = 0;
        let matchedDuties = 0;

        rows.forEach(tr => {
            const dayName = tr.getAttribute('data-dayname') || '';
            const dateStr = tr.getAttribute('data-date') || '';
            const isWeekend = dayName === 'الجمعة' || dayName === 'السبت';

            // 1. Day of week filter
            if (state.scheduleDayFilter === 'weekend' && !isWeekend) { tr.style.display = 'none'; return; }
            if (state.scheduleDayFilter === 'weekday' && isWeekend) { tr.style.display = 'none'; return; }

            const cells = tr.querySelectorAll('td[data-slot]');
            let hasEmpty = false;
            let hasConflict = false;
            let hasNameMatch = false;

            cells.forEach(td => {
                const slotKey = td.getAttribute('data-slot');
                const docName = td.getAttribute('data-doc') || '';
                const isConflicted = td.getAttribute('data-conflict') === 'true';

                if (!docName.trim()) hasEmpty = true;
                if (isConflicted) hasConflict = true;

                const isShiftEligible = (state.scheduleShiftFilter === 'all' || state.scheduleShiftFilter === slotKey);

                const docSpan = td.querySelector('.doc-name-span');
                if (cleanQ && isShiftEligible && docName && normalizeArabic(docName).toLowerCase().includes(cleanQ)) {
                    hasNameMatch = true;
                    matchedDuties++;
                    if (docSpan) {
                        docSpan.classList.add('bg-rose-100', 'dark:bg-rose-950', 'text-rose-800', 'dark:text-rose-200', 'ring-2', 'ring-rose-500', 'px-1.5', 'py-0.5', 'rounded-md', 'font-black');
                    }
                } else {
                    if (docSpan) {
                        docSpan.classList.remove('bg-rose-100', 'dark:bg-rose-950', 'text-rose-800', 'dark:text-rose-200', 'ring-2', 'ring-rose-500', 'px-1.5', 'py-0.5', 'rounded-md', 'font-black');
                    }
                }
            });

            // Doctor dropdown filter
            if (state.scheduleDoctorFilter) {
                const cleanDocFilter = normalizeArabic(state.scheduleDoctorFilter).toLowerCase();
                let matchesDoc = false;
                cells.forEach(td => {
                    const docName = td.getAttribute('data-doc') || '';
                    if (docName && normalizeArabic(docName).toLowerCase() === cleanDocFilter) {
                        matchesDoc = true;
                    }
                });
                if (!matchesDoc) { tr.style.display = 'none'; return; }
            }

            // Empty filter
            if (state.scheduleEmptyOnly && !hasEmpty) { tr.style.display = 'none'; return; }

            // Conflict filter
            if (state.scheduleConflictOnly && !hasConflict) { tr.style.display = 'none'; return; }

            // Shift filter
            if (state.scheduleShiftFilter !== 'all') {
                const targetTd = tr.querySelector(`td[data-slot="${state.scheduleShiftFilter}"]`);
                if (!targetTd) { tr.style.display = 'none'; return; }
            }

            // Search query matching
            if (cleanQ) {
                const matchesDayOrDate = normalizeArabic(dayName).toLowerCase().includes(cleanQ) || dateStr.includes(cleanQ);
                if (!hasNameMatch && !matchesDayOrDate) {
                    tr.style.display = 'none';
                    return;
                }
            }

            tr.style.display = '';
            matchedDays++;
        });

        // Live counter badge update
        const badge = document.getElementById('sched-filter-count-badge');
        if (badge) {
            const hasAnyActiveFilter = cleanQ || state.scheduleDoctorFilter || state.scheduleShiftFilter !== 'all' || state.scheduleDayFilter !== 'all' || state.scheduleEmptyOnly || state.scheduleConflictOnly;
            if (hasAnyActiveFilter) {
                badge.textContent = cleanQ 
                    ? `تم العثور على ${matchedDuties} خفارة في ${matchedDays} يوم` 
                    : `معروض ${matchedDays} يوم`;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    // =========================================================================
    // 1. ER VIEW (خفارات الطوارئ: 4 وجبات يومياً)
    // =========================================================================

    function renderERView(container) {
        const shifts = [
            { key: 'morning', label: 'الصباحية (8ص - 2م)', icon: 'fa-sun', color: 'text-amber-500' },
            { key: 'afternoon', label: 'بعد الصباحية (2م - 8م)', icon: 'fa-cloud-sun', color: 'text-orange-500' },
            { key: 'preNight', label: 'البرينايت (8م - 2ص)', icon: 'fa-moon', color: 'text-indigo-500' },
            { key: 'lateNight', label: 'الليلية (2ص - 8ص)', icon: 'fa-star-and-crescent', color: 'text-purple-500' }
        ];

        const shiftKeys = shifts.map(s => s.key);
        const filteredDays = (state.schedules.er || []).filter(d => filterDayRow(d, 'er', shiftKeys));

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-truck-medical text-rose-600"></i>
                        <span>جدول خفارات قسم الطوارئ (ER)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">4 وجبات خفارة يومياً · المقيمين الأقدمين</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="triggerScheduleAutoGenerate('er')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد خفارات الطوارئ آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('er', shifts)}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-28 font-bold">اليوم والتاريخ</th>
                            ${shifts.map(s => `
                                <th onclick="quickFilterByShift('${s.key}')" class="py-3 px-3 font-bold cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition select-none ${state.scheduleShiftFilter !== 'all' && state.scheduleShiftFilter !== s.key ? 'opacity-40' : ''}" title="انقر لتصفية الجدول بهذه الوجبة">
                                    <div class="flex items-center gap-1.5">
                                        <i class="fas ${s.icon} ${s.color}"></i>
                                        <span>${s.label}</span>
                                    </div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        if (filteredDays.length === 0) {
            html += `
                <tr>
                    <td colspan="6" class="py-8 text-center text-slate-400 text-xs">
                        لا توجد أيام تطابق شروط البحث والفلترة
                    </td>
                </tr>
            `;
        } else {
            filteredDays.forEach(day => {
                const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
                html += `
                    <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}">
                        <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                        <td class="py-2.5 px-3 whitespace-nowrap">
                            <div class="font-bold text-slate-800 dark:text-slate-100">${day.dayName}</div>
                            <div class="text-[11px] font-mono text-slate-400">${day.date}</div>
                        </td>
                        ${shifts.map(s => renderShiftCellHTML('er', day.dayNumber, day.date, s.key, day[s.key])).join('')}
                    </tr>
                `;
            });
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    // =========================================================================
    // 2. CONSULTATION CLINIC VIEW (الاستشارية الخافرة)
    // =========================================================================

    function renderConView(container) {
        const shifts = [{ key: 'doctor', label: 'طبيب الاستشارية الخافرة' }];
        const filteredDays = (state.schedules.con || []).filter(d => filterDayRow(d, 'con', ['doctor']));

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-stethoscope text-sky-600"></i>
                        <span>جدول خفارات الاستشارية الخافرة (Con)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">طبيب مقيم أقدم واحد يومياً</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="triggerScheduleAutoGenerate('con')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد خفارات الاستشارية آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('con')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('con', null)}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-3xl">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-3 px-3 w-14 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-36 font-bold">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold">طبيب الاستشارية الخافرة</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        filteredDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${day.dayName}</div>
                        <div class="text-[11px] font-mono text-slate-400">${day.date}</div>
                    </td>
                    ${renderShiftCellHTML('con', day.dayNumber, day.date, 'doctor', day.doctor)}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    // =========================================================================
    // 3. DEATH CERTIFICATES VIEW (شهادات الوفاة)
    // =========================================================================

    function renderDCView(container) {
        const filteredDays = (state.schedules.dc || []).filter(d => filterDayRow(d, 'dc', ['doctor']));

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-file-medical text-emerald-600"></i>
                        <span>جدول خفارات شهادات الوفاة (DC)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        طبيب مقيم أقدم واحد يومياً · <span class="text-emerald-600 dark:text-emerald-400 font-bold">خفارة المستشفى متوافقة وخضراء · الخفارات الأخرى بالـ ER والاستشارية تعتبر تعارضاً</span>
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="triggerScheduleAutoGenerate('dc')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد شهادات الوفاة آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('dc')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('dc', null)}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-4xl">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-3 px-3 w-14 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-36 font-bold">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold">طبيب شهادات الوفاة</th>
                            <th class="py-3 px-3 w-64 font-bold text-slate-500">حالة الخفارة في المستشفى</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        filteredDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            const hospDuties = day.doctor ? getHospitalDutiesForDoctor(day.doctor, day.date) : [];
            const hasHospDuty = hospDuties.length > 0;

            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${day.dayName}</div>
                        <div class="text-[11px] font-mono text-slate-400">${day.date}</div>
                    </td>
                    ${renderShiftCellHTML('dc', day.dayNumber, day.date, 'doctor', day.doctor)}
                    <td class="py-2.5 px-3 text-slate-500">
                        ${hasHospDuty ? `
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                <i class="fas fa-circle-check text-emerald-500"></i>
                                <span>خافر في المستشفى: ${hospDuties.map(h => h.specName).join(' + ')}</span>
                            </span>
                        ` : `
                            <span class="text-[11px] text-slate-400">لا توجد خفارة اختصاص متزامنة</span>
                        `}
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    // =========================================================================
    // 4. ROTATORS STRIKE - ER VIEW
    // =========================================================================

    function renderRSERView(container) {
        const shifts = [
            { key: 'er_morning', label: 'الصباحية (8ص - 2م)', icon: 'fa-sun', color: 'text-amber-500' },
            { key: 'er_afternoon', label: 'بعد الصباحية (2م - 8م)', icon: 'fa-cloud-sun', color: 'text-orange-500' },
            { key: 'er_preNight', label: 'البرينايت (8م - 2ص)', icon: 'fa-moon', color: 'text-indigo-500' },
            { key: 'er_lateNight', label: 'الليلية (2ص - 8ص)', icon: 'fa-star-and-crescent', color: 'text-purple-500' }
        ];

        const shiftKeys = shifts.map(s => s.key);
        const filteredDays = (state.schedules.rs || []).filter(d => filterDayRow(d, 'rs', shiftKeys));

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <i class="fas fa-truck-medical"></i>
                        <span>إضراب المقيمين الدوريين — طوارئ الإسناد (RS - ER)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        فترة الإضراب: من <strong>${state.rsStartDate || '---'}</strong> إلى <strong>${state.rsEndDate || '---'}</strong>
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="triggerScheduleAutoGenerate('rs_er')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد طوارئ الإضراب آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('rs_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('rs', shifts)}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-amber-100/60 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 text-slate-800 dark:text-slate-200">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-28 font-bold">اليوم والتاريخ</th>
                            ${shifts.map(s => `
                                <th onclick="quickFilterByShift('${s.key}')" class="py-3 px-3 font-bold cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition select-none ${state.scheduleShiftFilter !== 'all' && state.scheduleShiftFilter !== s.key ? 'opacity-40' : ''}" title="انقر لتصفية الجدول بهذه الوجبة">
                                    <div class="flex items-center gap-1.5">
                                        <i class="fas ${s.icon} ${s.color}"></i>
                                        <span>${s.label}</span>
                                    </div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        filteredDays.forEach(day => {
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            const hasNames = shifts.some(s => day[s.key] && day[s.key].trim());
            const rowClass = inRsPeriod 
                ? (hasNames ? 'bg-amber-50/50 dark:bg-amber-950/20 font-medium' : 'bg-slate-50/30 dark:bg-slate-800/20') 
                : 'opacity-40 bg-slate-50/10';

            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-amber-50/80 dark:hover:bg-amber-950/40 transition ${rowClass}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">
                        ${day.dayNumber}
                        ${inRsPeriod ? '<span class="block w-1.5 h-1.5 rounded-full bg-amber-500 mx-auto mt-0.5"></span>' : ''}
                    </td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${day.dayName}</div>
                        <div class="text-[11px] font-mono text-slate-400">${day.date}</div>
                    </td>
                    ${shifts.map(s => renderShiftCellHTML('rs', day.dayNumber, day.date, s.key, day[s.key])).join('')}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    // =========================================================================
    // 5. ROTATORS STRIKE - WARDS VIEW
    // =========================================================================

    function renderRSWardsView(container) {
        const wards = [
            { key: 'ward_private', label: 'الجناح الخاص', icon: 'fa-bed', color: 'text-rose-500' },
            { key: 'ward_floor4', label: 'الجناح العام / طابق 4', icon: 'fa-hospital-user', color: 'text-indigo-500' },
            { key: 'ward_floor5', label: 'الجناح العام / طابق 5', icon: 'fa-hospital-user', color: 'text-sky-500' }
        ];

        const wardKeys = wards.map(w => w.key);
        const filteredDays = (state.schedules.rs || []).filter(d => filterDayRow(d, 'rs', wardKeys));

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <i class="fas fa-bed-pulse"></i>
                        <span>إضراب المقيمين الدوريين — ردهات الإسناد (RS - Wards)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        الجناح الخاص وطابق 4 وطابق 5
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="triggerScheduleAutoGenerate('rs_wards')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد ردهات الإضراب آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('rs_wards')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('rs', wards)}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-amber-100/60 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 text-slate-800 dark:text-slate-200">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-28 font-bold">اليوم والتاريخ</th>
                            ${wards.map(w => `
                                <th class="py-3 px-3 font-bold ${state.scheduleShiftFilter !== 'all' && state.scheduleShiftFilter !== w.key ? 'opacity-40' : ''}">
                                    <div class="flex items-center gap-1.5">
                                        <i class="fas ${w.icon} ${w.color}"></i>
                                        <span>${w.label}</span>
                                    </div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        filteredDays.forEach(day => {
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            const hasNames = wards.some(w => day[w.key] && day[w.key].trim());
            const rowClass = inRsPeriod 
                ? (hasNames ? 'bg-amber-50/50 dark:bg-amber-950/20 font-medium' : 'bg-slate-50/30 dark:bg-slate-800/20') 
                : 'opacity-40 bg-slate-50/10';

            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-amber-50/80 dark:hover:bg-amber-950/40 transition ${rowClass}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">
                        ${day.dayNumber}
                        ${inRsPeriod ? '<span class="block w-1.5 h-1.5 rounded-full bg-amber-500 mx-auto mt-0.5"></span>' : ''}
                    </td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${day.dayName}</div>
                        <div class="text-[11px] font-mono text-slate-400">${day.date}</div>
                    </td>
                    ${wards.map(w => renderShiftCellHTML('rs', day.dayNumber, day.date, w.key, day[w.key])).join('')}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    // =========================================================================
    // CELL RENDERER WITH EXPLANATION ON CLICK & CLEAR BUTTON
    // =========================================================================

    function renderShiftCellHTML(tableType, dayNumber, dateStr, slotKey, assignedDoctor) {
        if (!assignedDoctor || !assignedDoctor.trim()) {
            return `
                <td class="py-2 px-3" data-slot="${slotKey}" data-doc="" data-conflict="false" data-outside-pref="false">
                    <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" 
                        class="w-full text-right py-1.5 px-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-400 dark:hover:border-rose-600 text-slate-400 hover:text-rose-600 text-[11px] transition flex items-center justify-between group">
                        <span>+ تعيين خافر</span>
                        <i class="fas fa-plus text-[10px] opacity-0 group-hover:opacity-100 transition"></i>
                    </button>
                </td>
            `;
        }

        const conflictInfo = evaluateCellConflict(assignedDoctor, dateStr, tableType, slotKey);
        const cellSlotId = `${tableType}_${dayNumber}_${slotKey}`;
        const hasPrefOverride = state.prefOverrides && state.prefOverrides[cellSlotId];

        let badgeHTML = '';
        if (tableType === 'dc' && conflictInfo.isDcHospitalDuty && !conflictInfo.hasConflict) {
            badgeHTML = `
                <span class="inline-flex items-center text-emerald-600 dark:text-emerald-400 ml-1.5" title="خافر في المستشفى بنفس اليوم (${conflictInfo.hospDutyName}) - موصى به لشهادات الوفاة">
                    <i class="fas fa-circle-check text-xs"></i>
                </span>
            `;
        } else if (conflictInfo.hasConflict) {
            // Click opens conflict explanation modal
            badgeHTML = `
                <button type="button" 
                    onclick="openConflictExplanation('${tableType}', ${dayNumber}, '${dateStr}', '${slotKey}', '${escapeForInline(assignedDoctor)}', event)"
                    title="⚠️ يوجد تعارض خفارة! انقر لعرض التفاصيل وخيار الإفراغ"
                    class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 hover:bg-rose-100 text-amber-700 hover:text-rose-700 text-[10px] font-black transition ml-1.5 shadow-xs animate-pulse">
                    ⚠️
                </button>
            `;
        }

        let overrideBadge = '';
        if (hasPrefOverride) {
            overrideBadge = `
                <button type="button" onclick="alert('ℹ️ تم تعيين هذه الخفارة خارج رغبة الطبيب المحددة لعدم توفر شواغر مطابقة في جدول الشهر.')" 
                    title="تم التعيين خارج رغبة الطبيب (انقر للتوضيح)" class="text-blue-500 hover:text-blue-600 text-[11px] ml-1">
                    <i class="fas fa-circle-info"></i>
                </button>
            `;
        }

        return `
            <td class="py-2 px-3" data-slot="${slotKey}" data-doc="${escapeForInline(assignedDoctor)}" data-conflict="${conflictInfo.hasConflict ? 'true' : 'false'}" data-outside-pref="${hasPrefOverride ? 'true' : 'false'}">
                <div class="flex items-center justify-between group py-1 px-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 hover:border-slate-400 transition">
                    <div class="flex items-center truncate cursor-pointer flex-1" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')">
                        <span class="doc-name-span font-bold text-slate-800 dark:text-slate-100 truncate">${assignedDoctor}</span>
                        ${badgeHTML}
                        ${overrideBadge}
                    </div>
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition no-print">
                        <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center" title="تعديل الخافر">
                            <i class="fas fa-pencil text-[10px]"></i>
                        </button>
                        <button type="button" onclick="clearCellOnly('${tableType}', ${dayNumber}, '${slotKey}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center justify-center" title="إفراغ الخلية">
                            <i class="fas fa-times text-[10px]"></i>
                        </button>
                    </div>
                </div>
            </td>
        `;
    }

    // =========================================================================
    // 6. RESIDENT DATABASE TAB (DB) WITH DIRECT IN-TABLE EDITING & ISOLATED INACTIVE SECTION
    // =========================================================================

    function renderDBView(container) {
        const residents = state.residents || [];
        const scheduledCounts = getScheduledCountsMap();

        // Separate Active and Inactive Residents
        const activeList = residents.filter(r => r.active);
        const inactiveList = residents.filter(r => !r.active);

        let html = `
            <div class="space-y-5">
                <!-- DB Header Actions & Controls -->
                <div class="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <div>
                        <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <i class="fas fa-users-gear text-rose-600"></i>
                            <span>قاعدة المقيمين الأقدمين والأنصبة (DB)</span>
                        </h2>
                        <p class="text-xs text-slate-500 mt-0.5">
                            التعديل مباشر وفوري في الجدول · يتم حفظ التغييرات تلقائياً بمجرد الخروج من الحقل
                        </p>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <!-- Advance Board Stage Button -->
                        <button type="button" onclick="advanceBoardResidentsStage()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition flex items-center gap-1.5 shadow-xs" title="تقديم مرحلة جميع أطباء البورد النشطين بمقدار مرحلة واحدة">
                            <i class="fas fa-graduation-cap"></i>
                            <span>ترفيع مرحلة البورد (+1)</span>
                        </button>

                        <!-- Toggle Show/Hide Inactive Button -->
                        <button type="button" onclick="toggleShowInactiveInDB()" class="px-3 py-1.5 rounded-xl text-xs font-bold ${state.showInactiveInDB ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'} hover:bg-slate-200 transition flex items-center gap-1.5">
                            <i class="fas ${state.showInactiveInDB ? 'fa-eye' : 'fa-eye-slash'}"></i>
                            <span>${state.showInactiveInDB ? 'إخفاء غير النشطين' : `إظهار غير النشطين (${inactiveList.length})`}</span>
                        </button>

                        <button type="button" onclick="openHospitalSyncModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 transition flex items-center gap-1.5">
                            <i class="fas fa-arrows-rotate"></i>
                            <span>مطابقة مع المستشفى</span>
                        </button>

                        <button type="button" onclick="openAddResidentModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                            <i class="fas fa-user-plus"></i>
                            <span>إضافة طبيب جديد</span>
                        </button>

                        <button type="button" onclick="downloadEmergencyDbJson()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5" title="تنزيل ملف emergency-db.json">
                            <i class="fas fa-download text-emerald-500"></i>
                            <span>حفظ JSON</span>
                        </button>
                    </div>
                </div>

                <!-- Search Bar & Filters (Real-Time Live Filtering without Re-rendering) -->
                <div class="p-3 rounded-2xl bg-slate-100/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs no-print">
                    <div class="relative flex-1 min-w-[200px]">
                        <i class="fas fa-search absolute right-3 top-2.5 text-slate-400 text-xs"></i>
                        <input type="text" id="db-search-input" value="${escapeForInline(state.dbSearchQuery || '')}" 
                            oninput="applyDBLiveFilter(this.value)" 
                            placeholder="بحث باسم الطبيب، الاختصاص، أو الملاحظات..." 
                            class="w-full pr-8 pl-8 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20 font-bold">
                        ${state.dbSearchQuery ? `
                            <button type="button" onclick="clearDBSearch()" class="absolute left-2.5 top-2 text-slate-400 hover:text-rose-600 text-xs" title="مسح">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <!-- Sex Filter -->
                        <select id="db-filter-sex" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">الجنس: الكل</option>
                            <option value="M">ذكر</option>
                            <option value="F">أنثى</option>
                        </select>

                        <!-- Board Filter -->
                        <select id="db-filter-board" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">البورد: الكل</option>
                            <option value="Arabic">عربي</option>
                            <option value="Iraqi">عراقي</option>
                            <option value="None">بدون بورد</option>
                        </select>

                        <!-- Stage Filter -->
                        <select id="db-filter-stage" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">المرحلة: الكل</option>
                            <option value="الأولى">الأولى</option>
                            <option value="الثانية">الثانية</option>
                            <option value="الثالثة">الثالثة</option>
                            <option value="الرابعة">الرابعة</option>
                            <option value="الخامسة">الخامسة</option>
                            <option value="السادسة">السادسة</option>
                            <option value="بدون">بدون</option>
                        </select>

                        <!-- Quota Filter -->
                        <select id="db-filter-quota" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">حالة النصاب: الكل</option>
                            <option value="fulfilled">مكتمل النصاب</option>
                            <option value="unfulfilled">غير مكتمل النصاب</option>
                            <option value="extra">لديه إسناد إضافي (RS)</option>
                        </select>

                        <button type="button" onclick="resetDBFilters()" class="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition">
                            إعادة ضبط
                        </button>

                        <span id="db-filter-count-badge" class="hidden text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"></span>
                    </div>
                </div>

                <!-- 1. ACTIVE RESIDENTS SECTION -->
                <div class="space-y-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <h3 class="text-sm font-black text-slate-800 dark:text-slate-100">الأطباء النشطون المشمولون بالخفارات (<span id="active-res-count">${activeList.length}</span>)</h3>
                    </div>

                    <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <table class="w-full text-right border-collapse text-xs">
                            <thead>
                                <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    <th class="py-3 px-2 w-10 text-center font-bold">#</th>
                                    <th class="py-3 px-3 font-bold w-48">اسم المقيم الأقدم</th>
                                    <th class="py-3 px-2 w-16 text-center font-bold">الجنس</th>
                                    <th class="py-3 px-3 font-bold w-36">الاختصاص</th>
                                    <th class="py-3 px-2 w-24 text-center font-bold">البورد</th>
                                    <th class="py-3 px-2 w-20 text-center font-bold">المرحلة</th>
                                    <th class="py-3 px-2 w-16 text-center font-bold text-rose-600">نصاب ER</th>
                                    <th class="py-3 px-2 w-16 text-center font-bold text-sky-600">نصاب Con</th>
                                    <th class="py-3 px-2 w-16 text-center font-bold text-emerald-600">نصاب DC</th>
                                    <th class="py-3 px-2 w-16 text-center font-bold text-amber-600">نصاب RS</th>
                                    <th class="py-3 px-2 w-32 font-bold">حالة النصاب</th>
                                    <th class="py-3 px-2 w-28 font-bold">شهر الانتهاء</th>
                                    <th class="py-3 px-2 w-20 text-center font-bold">الرغبات</th>
                                    <th class="py-3 px-2 w-14 text-center font-bold">تعطيل</th>
                                    <th class="py-3 px-2 w-20 text-center font-bold">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
                                ${activeList.map((r, idx) => renderResidentRowHTML(r, idx + 1, scheduledCounts, false)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 2. INACTIVE RESIDENTS ISOLATED SECTION (Shown when toggled) -->
                ${state.showInactiveInDB ? `
                <div class="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                        <h3 class="text-sm font-black text-slate-500 dark:text-slate-400">الأطباء غير النشطين / المعطلين (${inactiveList.length})</h3>
                        <span class="text-[11px] text-slate-400">(تم تصفير أنصبتهم ومستبعدون تماماً من جداول الخفارات)</span>
                    </div>

                    <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm opacity-80">
                        <table class="w-full text-right border-collapse text-xs bg-slate-50/50 dark:bg-slate-900/20">
                            <thead>
                                <tr class="bg-slate-200/60 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                                    <th class="py-2.5 px-2 w-10 text-center font-bold">#</th>
                                    <th class="py-2.5 px-3 font-bold w-48">اسم المقيم الأقدم</th>
                                    <th class="py-2.5 px-2 w-16 text-center font-bold">الجنس</th>
                                    <th class="py-2.5 px-3 font-bold w-36">الاختصاص</th>
                                    <th class="py-2.5 px-2 w-24 text-center font-bold">البورد</th>
                                    <th class="py-2.5 px-2 w-20 text-center font-bold">المرحلة</th>
                                    <th class="py-2.5 px-2 w-16 text-center font-bold">نصاب ER</th>
                                    <th class="py-2.5 px-2 w-16 text-center font-bold">نصاب Con</th>
                                    <th class="py-2.5 px-2 w-16 text-center font-bold">نصاب DC</th>
                                    <th class="py-2.5 px-2 w-16 text-center font-bold">نصاب RS</th>
                                    <th class="py-2.5 px-2 w-32 font-bold">الحالة</th>
                                    <th class="py-2.5 px-2 w-28 font-bold">شهر الانتهاء</th>
                                    <th class="py-2.5 px-2 w-20 text-center font-bold">تنشيط</th>
                                    <th class="py-2.5 px-2 w-20 text-center font-bold">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60">
                                ${inactiveList.map((r, idx) => renderResidentRowHTML(r, idx + 1, scheduledCounts, true)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                ` : ''}

            </div>
        `;

        container.innerHTML = html;
        if (state.dbSearchQuery) applyDBLiveFilter(state.dbSearchQuery);
    }

    function applyDBLiveFilter(queryVal) {
        if (queryVal !== undefined) {
            state.dbSearchQuery = queryVal.trim();
        } else {
            const input = document.getElementById('db-search-input');
            if (input) state.dbSearchQuery = input.value.trim();
        }
        const cleanQ = normalizeArabic(state.dbSearchQuery || '').toLowerCase();

        const sexFilter = document.getElementById('db-filter-sex')?.value || 'all';
        const boardFilter = document.getElementById('db-filter-board')?.value || 'all';
        const stageFilter = document.getElementById('db-filter-stage')?.value || 'all';
        const quotaFilter = document.getElementById('db-filter-quota')?.value || 'all';

        const rows = document.querySelectorAll('#schedule-view-container tr[data-resident-id]');
        let visibleCount = 0;

        rows.forEach(tr => {
            const name = tr.getAttribute('data-name') || '';
            const sex = tr.getAttribute('data-sex') || '';
            const board = tr.getAttribute('data-board') || '';
            const stage = tr.getAttribute('data-stage') || '';
            const quotaStatus = tr.getAttribute('data-quota-status') || '';
            const hasExtra = tr.getAttribute('data-has-extra') === 'true';

            if (sexFilter !== 'all' && sex !== sexFilter) { tr.style.display = 'none'; return; }
            if (boardFilter !== 'all' && board !== boardFilter) { tr.style.display = 'none'; return; }
            if (stageFilter !== 'all' && stage !== stageFilter) { tr.style.display = 'none'; return; }
            if (quotaFilter === 'fulfilled' && quotaStatus !== 'fulfilled') { tr.style.display = 'none'; return; }
            if (quotaFilter === 'unfulfilled' && quotaStatus !== 'unfulfilled') { tr.style.display = 'none'; return; }
            if (quotaFilter === 'extra' && !hasExtra) { tr.style.display = 'none'; return; }

            if (cleanQ) {
                const cleanName = normalizeArabic(name).toLowerCase();
                const spec = (tr.getAttribute('data-spec') || '').toLowerCase();
                if (!cleanName.includes(cleanQ) && !spec.includes(cleanQ)) {
                    tr.style.display = 'none';
                    return;
                }
            }

            tr.style.display = '';
            visibleCount++;
        });

        const countBadge = document.getElementById('db-filter-count-badge');
        if (countBadge) {
            const hasFilter = cleanQ || sexFilter !== 'all' || boardFilter !== 'all' || stageFilter !== 'all' || quotaFilter !== 'all';
            if (hasFilter) {
                countBadge.textContent = `معروض ${visibleCount} طبيب`;
                countBadge.classList.remove('hidden');
            } else {
                countBadge.classList.add('hidden');
            }
        }
    }

    function clearDBSearch() {
        state.dbSearchQuery = '';
        const input = document.getElementById('db-search-input');
        if (input) input.value = '';
        applyDBLiveFilter('');
    }

    function resetDBFilters() {
        state.dbSearchQuery = '';
        const input = document.getElementById('db-search-input');
        if (input) input.value = '';
        const sSex = document.getElementById('db-filter-sex');
        if (sSex) sSex.value = 'all';
        const sBoard = document.getElementById('db-filter-board');
        if (sBoard) sBoard.value = 'all';
        const sStage = document.getElementById('db-filter-stage');
        if (sStage) sStage.value = 'all';
        const sQuota = document.getElementById('db-filter-quota');
        if (sQuota) sQuota.value = 'all';
        applyDBLiveFilter('');
    }

    // Render individual resident row with direct editable inputs & coloring system
    function renderResidentRowHTML(r, rowNum, scheduledCounts, isInactiveSection) {
        const cleanName = normalizeArabic(r.name);
        const stats = scheduledCounts[cleanName] || { normalScheduled: 0, extraScheduled: 0, erFilled: 0 };
        const normalTarget = (Number(r.er_target) || 0) + (Number(r.con_target) || 0) + (Number(r.dc_target) || 0);

        // Color System:
        // 1. Fulfilled (Green)
        // 2. Unfulfilled (Red)
        // 3. Extra Duties (Orange dot beside the name - NO comments included)
        const isFulfilled = (stats.normalScheduled >= normalTarget) && normalTarget > 0;
        const isExpired = isResidentExpired(r, state.year, state.month);

        let rowBgClass = '';
        let statusBadge = '';

        if (isInactiveSection) {
            rowBgClass = 'bg-slate-100/40 dark:bg-slate-900/40 text-slate-500';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">معطّل</span>`;
        } else if (isExpired) {
            rowBgClass = 'bg-amber-50/20 text-slate-500';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">منتهي الصلاحية</span>`;
        } else if (isFulfilled) {
            rowBgClass = 'bg-emerald-50/40 dark:bg-emerald-950/15 border-l-4 border-l-emerald-500';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">مكتمل (${stats.normalScheduled}/${normalTarget})</span>`;
        } else {
            rowBgClass = 'bg-rose-50/30 dark:bg-rose-950/10 border-l-4 border-l-rose-400';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">غير مكتمل (${stats.normalScheduled}/${normalTarget})</span>`;
        }

        // Orange badge beside name (Pure dot badge, no comment text included)
        const extraDot = stats.extraScheduled > 0 ? `
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shrink-0 ring-2 ring-white dark:ring-slate-900 shadow-xs" title="خفارات إسناد إضافية (RS: ${stats.extraScheduled})"></span>
        ` : '';

        const arabicStages = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'بدون'];

        return `
            <tr data-resident-id="${r.id}" 
                data-name="${escapeForInline(r.name)}" 
                data-sex="${r.sex}" 
                data-board="${r.board || 'None'}" 
                data-stage="${r.stage || ''}" 
                data-quota-status="${isFulfilled ? 'fulfilled' : 'unfulfilled'}" 
                data-has-extra="${stats.extraScheduled > 0 ? 'true' : 'false'}" 
                data-spec="${escapeForInline(r.specialty || '')}"
                class="hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition ${rowBgClass}">
                <td class="py-1 px-2 text-center font-mono text-slate-400 text-xs">${rowNum}</td>
                
                <!-- Name with Orange Dot Badge (if extra RS duties) -->
                <td class="py-1 px-2">
                    <div class="flex items-center gap-1.5 flex-1 min-w-[150px]">
                        ${extraDot}
                        <input type="text" value="${escapeForInline(r.name)}" onblur="onResidentFieldChange('${r.id}', 'name', this.value)" class="db-cell-input font-bold text-slate-800 dark:text-slate-100 flex-1">
                    </div>
                </td>

                <!-- Sex (Direct select) -->
                <td class="py-1 px-2 text-center">
                    <select onchange="onResidentFieldChange('${r.id}', 'sex', this.value)" class="db-cell-input text-center font-bold ${r.sex === 'F' ? 'text-pink-600' : 'text-blue-600'}">
                        <option value="M" ${r.sex === 'M' ? 'selected' : ''}>ذكر</option>
                        <option value="F" ${r.sex === 'F' ? 'selected' : ''}>أنثى</option>
                    </select>
                </td>

                <!-- Specialty (Direct input) -->
                <td class="py-1 px-2">
                    <input type="text" value="${escapeForInline(r.specialty || 'General')}" onblur="onResidentFieldChange('${r.id}', 'specialty', this.value)" class="db-cell-input text-slate-600 dark:text-slate-300">
                </td>

                <!-- Board (Direct select) -->
                <td class="py-1 px-2 text-center">
                    <select onchange="onResidentFieldChange('${r.id}', 'board', this.value)" class="db-cell-input text-center font-bold">
                        <option value="Arabic" ${r.board === 'Arabic' ? 'selected' : ''}>عربي</option>
                        <option value="Iraqi" ${r.board === 'Iraqi' ? 'selected' : ''}>عراقي</option>
                        <option value="None" ${r.board === 'None' || !r.board ? 'selected' : ''}>بدون</option>
                    </select>
                </td>

                <!-- Stage (Selection from الأولى to السادسة) -->
                <td class="py-1 px-2 text-center">
                    <select onchange="onResidentFieldChange('${r.id}', 'stage', this.value)" class="db-cell-input text-center font-bold">
                        ${arabicStages.map(st => `<option value="${st}" ${r.stage === st ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                </td>

                <!-- ER Target (Direct number input) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" value="${r.er_target || 0}" onblur="onResidentTargetChange('${r.id}', 'er_target', this.value)" class="db-cell-input text-center font-mono font-black text-rose-600">
                </td>

                <!-- Con Target (Direct number input) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" value="${r.con_target || 0}" onblur="onResidentTargetChange('${r.id}', 'con_target', this.value)" class="db-cell-input text-center font-mono font-black text-sky-600">
                </td>

                <!-- DC Target (Direct number input) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" value="${r.dc_target || 0}" onblur="onResidentTargetChange('${r.id}', 'dc_target', this.value)" class="db-cell-input text-center font-mono font-black text-emerald-600">
                </td>

                <!-- RS Target (Direct number input) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" value="${r.rs_target || 0}" onblur="onResidentTargetChange('${r.id}', 'rs_target', this.value)" class="db-cell-input text-center font-mono font-black text-amber-600">
                </td>

                <!-- Status Badge -->
                <td class="py-1 px-2">
                    <div>${statusBadge}</div>
                </td>

                <!-- Expiry Month (Direct month picker) -->
                <td class="py-1 px-2">
                    <input type="month" value="${r.expiryMonth || ''}" onchange="onResidentFieldChange('${r.id}', 'expiryMonth', this.value)" class="db-cell-input text-[11px] font-mono text-slate-500">
                </td>

                <!-- Preferences Button (if active) / Reactivate Button (if inactive) -->
                ${!isInactiveSection ? `
                <td class="py-1 px-2 text-center">
                    <button type="button" onclick="openResidentPrefsModal('${r.id}')" class="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 transition" title="تحديد رغبات الخفارات">
                        <i class="fas fa-sliders text-rose-500 ml-0.5"></i>
                        <span>رغبات</span>
                    </button>
                </td>
                <td class="py-1 px-2 text-center">
                    <button type="button" onclick="deactivateResidentWithConfirmation('${r.id}')" class="w-7 h-7 rounded-xl flex items-center justify-center mx-auto text-emerald-600 bg-emerald-50 hover:bg-rose-50 hover:text-rose-600 transition" title="تعطيل الطبيب وتصفير أنصبته">
                        <i class="fas fa-toggle-on text-base"></i>
                    </button>
                </td>
                ` : `
                <td class="py-1 px-2 text-center">
                    <button type="button" onclick="reactivateResident('${r.id}')" class="px-2 py-1 rounded-xl text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition" title="إعادة تنشيط الطبيب">
                        <i class="fas fa-rotate-left ml-0.5"></i> تنشيط
                    </button>
                </td>
                `}

                <!-- Actions: Export to Hosp & Delete -->
                <td class="py-1 px-2 text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button type="button" onclick="openExportResidentModal('${r.id}')" class="w-6 h-6 rounded-lg text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950 flex items-center justify-center transition" title="تصدير للمستشفى">
                            <i class="fas fa-file-export text-xs"></i>
                        </button>
                        <button type="button" onclick="deleteResident('${r.id}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 flex items-center justify-center transition" title="حذف نهائي">
                            <i class="fas fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function escapeForInline(str) {
        if (!str) return '';
        return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    function getScheduledCountsMap() {
        const counts = {};
        const getEntry = (name) => {
            const c = normalizeArabic(name);
            if (!counts[c]) counts[c] = { normalScheduled: 0, extraScheduled: 0, erFilled: 0, conFilled: 0, dcFilled: 0, rsErFilled: 0, rsWardsFilled: 0 };
            return counts[c];
        };

        // ER
        (state.schedules.er || []).forEach(day => {
            ['morning', 'afternoon', 'preNight', 'lateNight'].forEach(k => {
                if (day[k]) {
                    const e = getEntry(day[k]);
                    e.erFilled++;
                    e.normalScheduled++;
                }
            });
        });

        // Con
        (state.schedules.con || []).forEach(day => {
            if (day.doctor) {
                const e = getEntry(day.doctor);
                e.conFilled++;
                e.normalScheduled++;
            }
        });

        // DC
        (state.schedules.dc || []).forEach(day => {
            if (day.doctor) {
                const e = getEntry(day.doctor);
                e.dcFilled++;
                e.normalScheduled++;
            }
        });

        // RS
        (state.schedules.rs || []).forEach(day => {
            ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight'].forEach(k => {
                if (day[k]) {
                    const e = getEntry(day[k]);
                    e.rsErFilled++;
                    e.extraScheduled++;
                }
            });
            ['ward_private', 'ward_floor4', 'ward_floor5'].forEach(k => {
                if (day[k]) {
                    const e = getEntry(day[k]);
                    e.rsWardsFilled++;
                    e.extraScheduled++;
                }
            });
        });

        return counts;
    }

    // Direct in-database field changes
    function onResidentFieldChange(resId, field, newVal) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (res) {
            const oldVal = res[field];
            res[field] = newVal.trim();
            saveState();

            // If name changed, update schedules
            if (field === 'name' && oldVal !== res.name) {
                ['er', 'con', 'dc', 'rs'].forEach(type => {
                    (state.schedules[type] || []).forEach(day => {
                        Object.keys(day).forEach(k => {
                            if (day[k] === oldVal) day[k] = res.name;
                        });
                    });
                });
                saveState();
            }
        }
    }

    function onResidentTargetChange(resId, targetField, newVal) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (res) {
            res[targetField] = Math.max(0, parseInt(newVal, 10) || 0);
            saveState();
            updateDutyDashboard();
        }
    }

    function toggleShowInactiveInDB() {
        state.showInactiveInDB = !state.showInactiveInDB;
        renderDBView(document.getElementById('schedule-view-container'));
    }

    // Deactivation with confirmation and resetting duty allocations to zero + removing from schedules
    function deactivateResidentWithConfirmation(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        const confirmMsg = `هل أنت متأكد من إلغاء تنشيط الطبيب (${res.name})؟\n\nتنبيه إداري: سيتم تصفير كافة أنصبته (إلى صفر) وإزالة اسمه من جميع جداول الخفارات تلقائياً.`;
        if (!confirm(confirmMsg)) return;

        // Reset quotas to zero
        res.active = false;
        res.er_target = 0;
        res.con_target = 0;
        res.dc_target = 0;
        res.rs_target = 0;

        // Remove name from all schedules
        const docName = res.name;
        ['er', 'con', 'dc', 'rs'].forEach(type => {
            (state.schedules[type] || []).forEach(day => {
                Object.keys(day).forEach(k => {
                    if (day[k] === docName) day[k] = '';
                });
            });
        });

        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(`تم إلغاء تنشيط الطبيب (${docName}) وتصفير أنصبته وإزالته من الجداول`, 'info');
    }

    function reactivateResident(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        res.active = true;
        res.er_target = 2; // initial default
        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(`تمت إعادة تنشيط الطبيب (${res.name}) بنجاح`, 'success');
    }

    // Advance stage of all Board residents (+1)
    function advanceBoardResidentsStage() {
        const ARABIC_STAGES = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];
        const boardResidents = (state.residents || []).filter(r => r.active && (r.board === 'Arabic' || r.board === 'Iraqi'));
        if (boardResidents.length === 0) {
            alert('لا يوجد أطباء مسجلون في البورد العربي أو العراقي نشطون في القاعدة.');
            return;
        }

        const msg = `هل ترغب في ترقية مرحلة جميع أطباء البورد (العربي والعراقي) بمقدار مرحلة واحدة (+1)؟\nعدد الأطباء المشمولين بالترقية: ${boardResidents.length} طبيب. (الأطباء بدون بورد لن يتم ترفيعهم)`;
        if (!confirm(msg)) return;

        let count = 0;
        boardResidents.forEach(r => {
            const curIdx = ARABIC_STAGES.indexOf(r.stage);
            if (curIdx >= 0 && curIdx < ARABIC_STAGES.length - 1) {
                r.stage = ARABIC_STAGES[curIdx + 1];
                count++;
            } else if (curIdx === -1) {
                r.stage = 'الأولى';
                count++;
            }
        });

        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(`تمت ترقية مرحلة ${count} طبيب بورد بنجاح (+1)`, 'success');
    }

    function deleteResident(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;
        if (!confirm(`هل أنت متأكد من حذف الطبيب: "${res.name}" نهائياً من قاعدة الطوارئ؟`)) return;
        state.residents = state.residents.filter(r => r.id !== resId);
        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification('تم حذف الطبيب من قاعدة الطوارئ', 'info');
    }

    function downloadEmergencyDbJson() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
            version: '1.0',
            updatedAt: new Date().toISOString(),
            headOfResidents: state.headOfResidents,
            headOfHospital: state.headOfHospital,
            totalResidents: (state.residents || []).length,
            residents: state.residents
        }, null, 2));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", "emergency-db.json");
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        showNotification('تم تنزيل ملف emergency-db.json بنجاح', 'success');
    }

    // =========================================================================
    // RESIDENT DUTY PREFERENCES MODAL
    // =========================================================================

    let activePrefsResId = null;

    function openResidentPrefsModal(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        activePrefsResId = resId;
        const modal = document.getElementById('resident-prefs-modal');
        const nameEl = document.getElementById('prefs-modal-docname');

        if (!modal) return;
        nameEl.textContent = `${res.name} (${res.specialty || 'عام'})`;

        // Populate checkboxes
        const prefShifts = res.prefShifts || [];
        const prefDays = res.prefDays || [];

        modal.querySelectorAll('.pref-shift-cb').forEach(cb => {
            cb.checked = prefShifts.includes(cb.value);
        });

        modal.querySelectorAll('.pref-day-cb').forEach(cb => {
            cb.checked = prefDays.includes(cb.value);
        });

        modal.classList.remove('hidden');
    }

    function closeResidentPrefsModal() {
        const modal = document.getElementById('resident-prefs-modal');
        if (modal) modal.classList.add('hidden');
        activePrefsResId = null;
    }

    function saveResidentPreferences() {
        if (!activePrefsResId) return;
        const res = (state.residents || []).find(r => r.id === activePrefsResId);
        if (!res) return;

        const modal = document.getElementById('resident-prefs-modal');
        const shifts = [];
        const days = [];

        modal.querySelectorAll('.pref-shift-cb:checked').forEach(cb => shifts.push(cb.value));
        modal.querySelectorAll('.pref-day-cb:checked').forEach(cb => days.push(cb.value));

        res.prefShifts = shifts;
        res.prefDays = days;

        saveState();
        closeResidentPrefsModal();
        showNotification(`تم حفظ رغبات الخفارة للطبيب (${res.name}) بنجاح`, 'success');
    }

    // =========================================================================
    // EXPORT RESIDENT TO HOSPITAL (STRICT VALIDATION: PHONE REQUIRED)
    // =========================================================================

    function openExportResidentModal(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        let modal = document.getElementById('export-resident-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'export-resident-modal';
            modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">تصدير طبيب إلى قاعدة المستشفى الرسمية</h3>
                        <p class="text-[11px] text-slate-500">المستشفى الهدف: <strong>${state.hospitalName}</strong></p>
                    </div>
                    <button type="button" onclick="closeExportResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleConfirmExportResident('${resId}', event)" class="p-5 space-y-3 text-xs">
                    <p class="text-slate-600 dark:text-slate-300">
                        يشترط تعبئة كافة الحقول المطلوبة لقاعدة المستشفى الرسمية (رقم الهاتف إلزامي):
                    </p>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاسم الكامل <span class="text-rose-500">*</span>:</label>
                        <input type="text" id="exp-res-name" value="${escapeForInline(res.name)}" required class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاختصاص الطبي <span class="text-rose-500">*</span>:</label>
                        <input type="text" id="exp-res-spec" value="${escapeForInline(res.specialty || 'General')}" required class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">رقم الهاتف <span class="text-rose-500">* (حقل إلزامي)</span>:</label>
                        <input type="tel" id="exp-res-phone" value="${escapeForInline(res.phone || '')}" required placeholder="مثال: 07701234567" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div class="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900/60 text-[11px] text-blue-800 dark:text-blue-300">
                        <i class="fas fa-circle-info ml-1 text-blue-500"></i>
                        سيتم حفظ رقم الهاتف في قاعدة الطوارئ وتصدير الطبيب لقائمة أطباء المستشفى.
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                        <button type="button" onclick="closeExportResidentModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                            إلغاء
                        </button>
                        <button type="submit" class="px-5 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-md transition flex items-center gap-1.5">
                            <i class="fas fa-check"></i>
                            <span>تأكيد التصدير للمستشفى</span>
                        </button>
                    </div>
                </form>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeExportResidentModal() {
        const modal = document.getElementById('export-resident-modal');
        if (modal) modal.classList.add('hidden');
    }

    async function handleConfirmExportResident(resId, e) {
        if (e) e.preventDefault();
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        const nameInput = document.getElementById('exp-res-name');
        const specInput = document.getElementById('exp-res-spec');
        const phoneInput = document.getElementById('exp-res-phone');

        const name = (nameInput?.value || '').trim();
        const spec = (specInput?.value || '').trim();
        const phone = (phoneInput?.value || '').trim();

        // Strict Phone Validation (Required, at least 10 digits)
        const cleanDigits = phone.replace(/[^0-9]/g, '');
        if (!phone || cleanDigits.length < 10) {
            alert('رقم الهاتف حقل إلزامي لتصدير الطبيب لقاعدة المستشفى الرسمية (يجب أن يتكون من 10 أرقام على الأقل).');
            if (phoneInput) phoneInput.focus();
            return;
        }

        res.name = name;
        res.specialty = spec;
        res.phone = phone;
        saveState();

        try {
            if (window.Hub && typeof window.Hub.getHospital === 'function') {
                const hosp = window.Hub.getHospital(state.hospitalId);
                if (hosp) {
                    if (!Array.isArray(hosp.names)) hosp.names = [];
                    const cleanRes = normalizeArabic(name);
                    const alreadyExists = hosp.names.some(n => normalizeArabic(n.name) === cleanRes);

                    if (alreadyExists) {
                        alert('هذا الطبيب موجود بالفعل في قائمة أطباء المستشفى المحددة.');
                        closeExportResidentModal();
                        return;
                    }

                    const newDoc = {
                        id: `res_exp_${Date.now()}`,
                        name: name.startsWith('د.') ? name : `د. ${name}`,
                        phone: phone,
                        spec: spec,
                        active: res.active,
                        hospitals: [state.hospitalId]
                    };

                    hosp.names.push(newDoc);
                    if (typeof window.Hub.saveDatabase === 'function') {
                        await window.Hub.saveDatabase(`Exported resident ${name} to ${state.hospitalName}`);
                    }
                }
            }

            closeExportResidentModal();
            showNotification(`تم تصدير الطبيب "${name}" إلى مستشفى "${state.hospitalName}" بنجاح!`, 'success');
        } catch (err) {
            console.error('Error exporting resident to hospital:', err);
            showNotification('حدث خطأ أثناء تصدير الطبيب للمستشفى', 'error');
        }
    }

    // =========================================================================
    // HOSPITAL RECONCILIATION MODAL
    // =========================================================================

    function openHospitalSyncModal() {
        let modal = document.getElementById('hospital-sync-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'hospital-sync-modal';
            modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        }

        let hospResidents = [];
        if (window.Hub && typeof window.Hub.getHospital === 'function') {
            const h = window.Hub.getHospital(state.hospitalId);
            if (h && Array.isArray(h.names)) hospResidents = h.names;
        }

        const erResidents = state.residents || [];
        const matched = [];
        const missingInEr = [];
        const erOnly = [];

        const hospCleanMap = new Map();
        hospResidents.forEach(h => hospCleanMap.set(normalizeArabic(h.name), h));

        const erCleanMap = new Map();
        erResidents.forEach(e => erCleanMap.set(normalizeArabic(e.name), e));

        erResidents.forEach(e => {
            const clean = normalizeArabic(e.name);
            if (hospCleanMap.has(clean)) {
                matched.push({ er: e, hosp: hospCleanMap.get(clean), matchType: 'exact' });
            } else {
                let foundFuzzy = null;
                for (let [hClean, hDoc] of hospCleanMap.entries()) {
                    if (hClean.includes(clean) || clean.includes(hClean)) {
                        foundFuzzy = hDoc;
                        break;
                    }
                }
                if (foundFuzzy) {
                    matched.push({ er: e, hosp: foundFuzzy, matchType: 'fuzzy' });
                } else {
                    erOnly.push(e);
                }
            }
        });

        hospResidents.forEach(h => {
            const clean = normalizeArabic(h.name);
            let inEr = erCleanMap.has(clean);
            if (!inEr) {
                for (let [eClean] of erCleanMap.entries()) {
                    if (eClean.includes(clean) || clean.includes(eClean)) {
                        inEr = true;
                        break;
                    }
                }
            }
            if (!inEr) {
                missingInEr.push(h);
            }
        });

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">مطابقة ومزامنة الأسماء مع ${state.hospitalName}</h3>
                        <p class="text-[11px] text-slate-500">مطابقة أطباء الطوارئ مع قاعدة المقيمين في المستشفى</p>
                    </div>
                    <button type="button" onclick="closeHospitalSyncModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div class="p-4 space-y-4 max-h-[480px] overflow-y-auto">
                    <!-- Summary Stats -->
                    <div class="grid grid-cols-3 gap-2 text-center text-xs">
                        <div class="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
                            <div class="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold">متطابقون</div>
                            <div class="text-xl font-black text-emerald-600 mt-0.5">${matched.length}</div>
                        </div>
                        <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                            <div class="text-[11px] text-amber-700 dark:text-amber-300 font-bold">مفقودون في الطوارئ</div>
                            <div class="text-xl font-black text-amber-600 mt-0.5">${missingInEr.length}</div>
                        </div>
                        <div class="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60">
                            <div class="text-[11px] text-blue-700 dark:text-blue-300 font-bold">خاص بالطوارئ (محفوظ)</div>
                            <div class="text-xl font-black text-blue-600 mt-0.5">${erOnly.length}</div>
                        </div>
                    </div>

                    <!-- Missing in ER Section -->
                    ${missingInEr.length > 0 ? `
                    <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-black text-slate-800 dark:text-slate-200">
                                أطباء موجودون في المستشفى وغير مدرجين في الطوارئ:
                            </span>
                            <button type="button" onclick="importAllMissingDoctorsToER()" class="px-2.5 py-1 rounded-xl text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition">
                                استيراد الكل إلى الطوارئ
                            </button>
                        </div>
                        <div class="max-h-36 overflow-y-auto space-y-1 text-xs">
                            ${missingInEr.map(h => `
                                <div class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60">
                                    <div>
                                        <span class="font-bold text-slate-800 dark:text-slate-100">${h.name}</span>
                                        <span class="text-[10px] text-slate-400 mr-2">(${h.spec || 'عام'})</span>
                                    </div>
                                    <button type="button" onclick="importSingleDoctorToER('${escapeForInline(h.name)}', '${escapeForInline(h.spec)}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold text-sky-600 bg-sky-50 dark:bg-sky-950 hover:bg-sky-100 transition">
                                        استيراد
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}

                    <!-- Fuzzy matches -->
                    <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                        <span class="text-xs font-black text-slate-800 dark:text-slate-200 block">
                            تحديث تهجئة الأسماء لتطابق قائمة المستشفى الرسمية:
                        </span>
                        <div class="max-h-36 overflow-y-auto space-y-1 text-xs">
                            ${matched.filter(m => m.matchType === 'fuzzy' && m.er.name !== m.hosp.name).map(m => `
                                <div class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60">
                                    <div class="space-y-0.5">
                                        <div class="text-[11px] text-slate-500">في الطوارئ: <strong class="text-slate-800 dark:text-slate-200">${m.er.name}</strong></div>
                                        <div class="text-[11px] text-emerald-600 font-bold">في المستشفى: ${m.hosp.name}</div>
                                    </div>
                                    <button type="button" onclick="syncDoctorNameSpelling('${m.er.id}', '${escapeForInline(m.hosp.name)}')" class="px-2.5 py-1 rounded-xl text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition">
                                        توحيد الاسم
                                    </button>
                                </div>
                            `).join('')}
                            ${matched.filter(m => m.matchType === 'fuzzy' && m.er.name !== m.hosp.name).length === 0 ? `
                                <div class="text-[11px] text-slate-400 py-1">جميع الأسماء المتطابقة موحدة الصياغة تماماً.</div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- ER-Only Notice -->
                    <div class="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-xs text-blue-800 dark:text-blue-300">
                        <i class="fas fa-shield-halved ml-1 text-blue-500"></i>
                        <strong>ملاحظة الأمان:</strong> يوجد <strong>${erOnly.length}</strong> طبيب مسجل في الطوارئ فقط غير متواجدين في هذه المستشفى، وتم الحفاظ عليهم بالكامل دون حذف أو مساس.
                    </div>
                </div>

                <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button type="button" onclick="closeHospitalSyncModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                        إغلاق
                    </button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeHospitalSyncModal() {
        const modal = document.getElementById('hospital-sync-modal');
        if (modal) modal.classList.add('hidden');
    }

    function syncDoctorNameSpelling(resId, officialName) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (res) {
            const oldName = res.name;
            res.name = officialName;

            ['er', 'con', 'dc', 'rs'].forEach(type => {
                (state.schedules[type] || []).forEach(day => {
                    Object.keys(day).forEach(k => {
                        if (day[k] === oldName) day[k] = officialName;
                    });
                });
            });

            saveState();
            openHospitalSyncModal();
            showNotification(`تم توحيد اسم الطبيب إلى: ${officialName}`, 'success');
        }
    }

    function importSingleDoctorToER(name, spec) {
        state.residents.push({
            id: `er_res_${Date.now()}`,
            name: name,
            sex: 'M',
            specialty: spec || 'General',
            board: 'None',
            stage: '1.0',
            er_target: 2,
            con_target: 0,
            dc_target: 0,
            rs_target: 0,
            phone: '',
            expiryMonth: '',
            prefDays: [],
            prefShifts: [],
            notes: 'Imported from hospital',
            active: true,
            hospitals: [state.hospitalId]
        });
        saveState();
        openHospitalSyncModal();
        showNotification(`تم استيراد الطبيب: ${name} إلى الطوارئ بنجاح`, 'success');
    }

    function importAllMissingDoctorsToER() {
        let hospResidents = [];
        if (window.Hub && typeof window.Hub.getHospital === 'function') {
            const h = window.Hub.getHospital(state.hospitalId);
            if (h && Array.isArray(h.names)) hospResidents = h.names;
        }

        const erCleanSet = new Set((state.residents || []).map(r => normalizeArabic(r.name)));
        let count = 0;

        hospResidents.forEach(h => {
            const clean = normalizeArabic(h.name);
            if (!erCleanSet.has(clean)) {
                state.residents.push({
                    id: `er_res_${Date.now()}_${count}`,
                    name: h.name,
                    sex: 'M',
                    specialty: h.spec || 'General',
                    board: 'None',
                    stage: '1.0',
                    er_target: 2,
                    con_target: 0,
                    dc_target: 0,
                    rs_target: 0,
                    phone: h.phone || '',
                    expiryMonth: '',
                    prefDays: [],
                    prefShifts: [],
                    notes: 'Imported from hospital',
                    active: true,
                    hospitals: [state.hospitalId]
                });
                count++;
            }
        });

        saveState();
        openHospitalSyncModal();
        showNotification(`تم استيراد ${count} طبيب إلى قاعدة الطوارئ بنجاح`, 'success');
    }

    // =========================================================================
    // 7. DOCTOR PICKER MODAL (STRICT: HIDES RESIDENTS WHO FULFILLED ALLOCATIONS)
    // =========================================================================

    function openDoctorPicker(type, dayNumber, slotKey, slotLabel) {
        const days = state.schedules[type] || [];
        const dayEntry = days.find(s => s.dayNumber === dayNumber);
        const dateStr = dayEntry ? dayEntry.date : formatDateStr(state.year, state.month, dayNumber);
        const dayName = dayEntry ? dayEntry.dayName : getArabicDayName(state.year, state.month, dayNumber);

        activeSlot = { type, dayNumber, slotKey, slotLabel, dateStr, dayName };

        const modal = document.getElementById('doctor-picker-modal');
        if (!modal) return;

        const infoEl = document.getElementById('picker-day-info');
        if (infoEl) {
            infoEl.textContent = `${dayName} (${dateStr}) · ${getSlotHumanLabel(type, slotKey)}`;
        }

        const searchInput = document.getElementById('picker-search-input');
        if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 50);
        }

        filterPickerList();
        modal.classList.remove('hidden');
    }

    function closeDoctorPickerModal() {
        const modal = document.getElementById('doctor-picker-modal');
        if (modal) modal.classList.add('hidden');
        activeSlot = null;
    }

    function getSlotHumanLabel(type, key) {
        const map = {
            morning: 'طوارئ: الصباحية (8ص - 2م)',
            afternoon: 'طوارئ: بعد الصباحية (2م - 8م)',
            preNight: 'طوارئ: البرينايت (8م - 2ص)',
            lateNight: 'طوارئ: الليلية (2ص - 8ص)',
            doctor: type === 'dc' ? 'شهادات الوفاة' : 'الاستشارية الخافرة',
            er_morning: 'إضراب طوارئ: صباحية',
            er_afternoon: 'إضراب طوارئ: بعد الصباحية',
            er_preNight: 'إضراب طوارئ: برينايت',
            er_lateNight: 'إضراب طوارئ: ليلية',
            ward_private: 'إضراب ردهات: الجناح الخاص',
            ward_floor4: 'إضراب ردهات: طابق 4',
            ward_floor5: 'إضراب ردهات: طابق 5'
        };
        return map[key] || key;
    }

    /**
     * Filter Picker List:
     * STRICT REQUIREMENT: Only show residents with available duties (hide fulfilled residents who reached target).
     */
    function filterPickerList() {
        if (!activeSlot) return;
        const listContainer = document.getElementById('picker-doctors-list');
        if (!listContainer) return;

        const searchInput = document.getElementById('picker-search-input');
        const query = (searchInput?.value || '').trim();
        const cleanQ = normalizeArabic(query);

        // 1. Get hospital on-call doctors
        const hospitalOnCall = getAllHospitalOnCallDoctors(activeSlot.dateStr);
        const hospDoctorMap = new Map();
        hospitalOnCall.forEach(hd => hospDoctorMap.set(hd.cleanName, hd));

        // 2. Count current scheduled duties for each resident across month for this type
        const scheduledCounts = countScheduledDutiesPerResident(activeSlot.type);

        const targetField = activeSlot.type === 'er' ? 'er_target' :
                            activeSlot.type === 'con' ? 'con_target' :
                            activeSlot.type === 'dc' ? 'dc_target' : 'rs_target';

        // 3. STRICT FILTER: Only show active, non-expired residents who have NOT yet fulfilled their quota!
        let residents = (state.residents || []).filter(r => {
            if (!r.active) return false;
            if (isResidentExpired(r, state.year, state.month)) return false;

            const target = Number(r[targetField]) || 0;
            if (target <= 0) return false;

            const cleanName = normalizeArabic(r.name);
            const filled = scheduledCounts[cleanName] || 0;

            // STRICT: The resident who fulfilled their allocated duties should NOT appear in selections
            return filled < target;
        });

        // Search query filter
        if (cleanQ) {
            residents = residents.filter(r => 
                normalizeArabic(r.name).includes(cleanQ) || 
                (r.specialty && r.specialty.toLowerCase().includes(query.toLowerCase()))
            );
        }

        // Enrich with conflict & hospital on-call priority
        const enriched = residents.map(r => {
            const cleanName = normalizeArabic(r.name);
            const filled = scheduledCounts[cleanName] || 0;
            const target = Number(r[targetField]) || 0;
            const remaining = target - filled;

            const isHospOnCall = hospDoctorMap.has(cleanName);
            const hospDuty = hospDoctorMap.get(cleanName);

            const conflictEval = evaluateCellConflict(r.name, activeSlot.dateStr, activeSlot.type, activeSlot.slotKey);

            return {
                resident: r,
                filled,
                target,
                remaining,
                isHospOnCall,
                hospDuty,
                hasConflict: conflictEval.hasConflict,
                conflicts: conflictEval.conflicts
            };
        });

        // Sorting: For DC, doctors with hospital duty ranked first!
        enriched.sort((a, b) => {
            if (activeSlot.type === 'dc') {
                if (a.isHospOnCall && !b.isHospOnCall) return -1;
                if (!a.isHospOnCall && b.isHospOnCall) return 1;
            }

            if (!a.hasConflict && b.hasConflict) return -1;
            if (a.hasConflict && !b.hasConflict) return 1;

            if (b.remaining !== a.remaining) {
                return b.remaining - a.remaining;
            }

            return a.resident.name.localeCompare(b.resident.name, 'ar');
        });

        if (enriched.length === 0) {
            listContainer.innerHTML = `
                <div class="py-8 text-center text-slate-400 text-xs space-y-1">
                    <i class="fas fa-check-circle text-emerald-500 text-2xl mb-1 block"></i>
                    <div class="font-bold text-slate-700 dark:text-slate-300">لا يوجد أطباء لديهم خفارات متبقية شاغرة لهذا القسم</div>
                    <div class="text-[11px]">جميع الأطباء استوفوا أنصبتهم المقررة بالكامل أو تم إخفاؤهم لعدم توفر رصيد خفارات.</div>
                </div>
            `;
            return;
        }

        let html = '';
        enriched.forEach(item => {
            const r = item.resident;
            const isDcTopChoice = activeSlot.type === 'dc' && item.isHospOnCall;

            let cardBorder = 'border-slate-200 dark:border-slate-800 hover:border-rose-400';
            let cardBg = 'bg-white dark:bg-slate-900/60';

            if (isDcTopChoice) {
                cardBorder = 'border-emerald-300 dark:border-emerald-800/80 ring-1 ring-emerald-500/20';
                cardBg = 'bg-emerald-50/40 dark:bg-emerald-950/20';
            } else if (item.hasConflict) {
                cardBorder = 'border-amber-300 dark:border-amber-800/80';
                cardBg = 'bg-amber-50/20 dark:bg-amber-950/10';
            }

            html += `
                <div onclick="selectDoctorForSlot('${escapeForInline(r.name)}')" 
                    class="p-3 rounded-2xl border ${cardBorder} ${cardBg} hover:shadow-md transition cursor-pointer flex items-center justify-between gap-3">
                    
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl ${isDcTopChoice ? 'bg-emerald-500 text-white' : item.hasConflict ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'} flex items-center justify-center font-bold text-xs shrink-0">
                            ${isDcTopChoice ? '<i class="fas fa-check"></i>' : item.hasConflict ? '⚠️' : '<i class="fas fa-user-doctor"></i>'}
                        </div>
                        <div>
                            <div class="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <span>${r.name}</span>
                                ${isDcTopChoice ? `
                                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                        خافر في المستشفى اليوم: ${item.hospDuty.specName}
                                    </span>
                                ` : ''}
                                ${item.hasConflict ? `
                                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                        ⚠️ مسجل اليوم في: ${item.conflicts.map(c => c.label).join('، ')}
                                    </span>
                                ` : ''}
                            </div>
                            <div class="text-[11px] text-slate-400 mt-0.5">
                                ${r.specialty || 'عام'} · الجنس: ${r.sex === 'F' ? 'أنثى' : 'ذكر'} · متبقي: <strong class="text-rose-600">${item.remaining}</strong> خفارات
                            </div>
                        </div>
                    </div>

                    <div class="text-left shrink-0 font-mono font-black text-xs text-emerald-600">
                        ${item.filled} / ${item.target}
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    }

    function countScheduledDutiesPerResident(type) {
        const counts = {};
        (state.schedules[type] || []).forEach(day => {
            Object.keys(day).forEach(k => {
                if (k !== 'dayNumber' && k !== 'date' && k !== 'dayName' && k !== 'notes') {
                    const doc = day[k];
                    if (doc && doc.trim()) {
                        const clean = normalizeArabic(doc);
                        counts[clean] = (counts[clean] || 0) + 1;
                    }
                }
            });
        });
        return counts;
    }

    function selectDoctorForSlot(doctorName) {
        if (!activeSlot) return;

        const dayEntry = (state.schedules[activeSlot.type] || []).find(s => s.dayNumber === activeSlot.dayNumber);
        if (dayEntry) {
            dayEntry[activeSlot.slotKey] = doctorName;
            saveState();
            renderActiveTab();
            closeDoctorPickerModal();
            showNotification(`تم تعيين ${doctorName} بنجاح`, 'success');
        }
    }

    function clearActiveSlot() {
        if (!activeSlot) return;
        const dayEntry = (state.schedules[activeSlot.type] || []).find(s => s.dayNumber === activeSlot.dayNumber);
        if (dayEntry) {
            dayEntry[activeSlot.slotKey] = '';
            saveState();
            renderActiveTab();
            closeDoctorPickerModal();
            showNotification('تم إفراغ الخفارة بنجاح', 'info');
        }
    }

    // =========================================================================
    // 8. ADD NEW RESIDENT MODAL
    // =========================================================================

    function openAddResidentModal() {
        let modal = document.getElementById('add-resident-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'add-resident-modal';
            modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">إضافة مقيم أقدم جديد</h3>
                        <p class="text-[11px] text-slate-500">إضافة الطبيب لقاعدة خفارات الطوارئ</p>
                    </div>
                    <button type="button" onclick="closeAddResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleSaveNewResident(event)" class="p-5 space-y-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الطبيب الرباعي <span class="text-rose-500">*</span>:</label>
                        <input type="text" id="new-res-name" required placeholder="د. الاسم الكامل..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الجنس:</label>
                            <select id="new-res-sex" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                                <option value="M">ذكر</option>
                                <option value="F">أنثى</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاختصاص:</label>
                            <input type="text" id="new-res-spec" placeholder="مثال: الجراحة العامة" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع البورد:</label>
                            <select id="new-res-board" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                                <option value="Arabic">عربي (Arabic)</option>
                                <option value="Iraqi">عراقي (Iraqi)</option>
                                <option value="None" selected>بدون بورد (None)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">المرحلة:</label>
                            <select id="new-res-stage" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                                <option value="الأولى" selected>الأولى</option>
                                <option value="الثانية">الثانية</option>
                                <option value="الثالثة">الثالثة</option>
                                <option value="الرابعة">الرابعة</option>
                                <option value="الخامسة">الخامسة</option>
                                <option value="السادسة">السادسة</option>
                                <option value="بدون">بدون</option>
                            </select>
                        </div>
                    </div>

                    <div class="grid grid-cols-4 gap-2 pt-1">
                        <div>
                            <label class="block text-[11px] font-bold text-rose-600 mb-1">نصاب ER:</label>
                            <input type="number" id="new-res-er" value="2" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-sky-600 mb-1">نصاب Con:</label>
                            <input type="number" id="new-res-con" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-emerald-600 mb-1">نصاب DC:</label>
                            <input type="number" id="new-res-dc" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-amber-600 mb-1">نصاب RS:</label>
                            <input type="number" id="new-res-rs" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">رقم الهاتف (اختياري / مطلوب للتصدير):</label>
                            <input type="tel" id="new-res-phone" placeholder="0770..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">شهر انتهاء الصلاحية (اختياري):</label>
                            <input type="month" id="new-res-expiry" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                        </div>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">ملاحظات إدارية:</label>
                        <input type="text" id="new-res-notes" placeholder="ملاحظات..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                        <button type="button" onclick="closeAddResidentModal()" class="px-4 py-2 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                            إلغاء
                        </button>
                        <button type="submit" class="px-5 py-2 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 transition">
                            حفظ وإضافة
                        </button>
                    </div>
                </form>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeAddResidentModal() {
        const modal = document.getElementById('add-resident-modal');
        if (modal) modal.classList.add('hidden');
    }

    function handleSaveNewResident(e) {
        e.preventDefault();
        const rawName = document.getElementById('new-res-name').value.trim();
        const formattedName = rawName.startsWith('د.') ? rawName : `د. ${rawName}`;
        const sex = document.getElementById('new-res-sex').value;
        const specialty = document.getElementById('new-res-spec').value.trim() || 'General';
        const board = document.getElementById('new-res-board').value;
        const stage = document.getElementById('new-res-stage').value.trim() || 'الأولى';
        const er_target = parseInt(document.getElementById('new-res-er').value, 10) || 0;
        const con_target = parseInt(document.getElementById('new-res-con').value, 10) || 0;
        const dc_target = parseInt(document.getElementById('new-res-dc').value, 10) || 0;
        const rs_target = parseInt(document.getElementById('new-res-rs').value, 10) || 0;
        const phone = document.getElementById('new-res-phone').value.trim();
        const expiryMonth = document.getElementById('new-res-expiry').value.trim();
        const notes = document.getElementById('new-res-notes').value.trim();

        const newDoc = {
            id: `er_res_${Date.now()}`,
            name: formattedName,
            sex,
            specialty,
            board,
            stage,
            er_target,
            con_target,
            dc_target,
            rs_target,
            phone,
            expiryMonth,
            prefDays: [],
            prefShifts: [],
            notes,
            active: true,
            hospitals: [state.hospitalId]
        };

        state.residents.push(newDoc);
        saveState();
        closeAddResidentModal();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(`تمت إضافة الطبيب "${formattedName}" بنجاح`, 'success');
    }

    // =========================================================================
    // 9. AUTOMATIC DISTRIBUTION PER SCHEDULE TAB (WITH ENTRY CHECK PROMPT)
    // =========================================================================

    function triggerScheduleAutoGenerate(type) {
        pendingAutoGenerateType = type;
        const schedule = state.schedules[type] || [];
        
        // Check if there are any existing filled entries
        let hasEntries = false;
        if (type === 'er') {
            hasEntries = schedule.some(d => d.morning || d.afternoon || d.preNight || d.lateNight);
        } else if (type === 'con' || type === 'dc') {
            hasEntries = schedule.some(d => d.doctor && d.doctor.trim());
        } else if (type === 'rs_er') {
            hasEntries = schedule.some(d => d.er_morning || d.er_afternoon || d.er_preNight || d.er_lateNight);
        } else if (type === 'rs_wards') {
            hasEntries = schedule.some(d => d.ward_private || d.ward_floor4 || d.ward_floor5);
        }

        if (hasEntries) {
            // Prompt modal
            const modal = document.getElementById('auto-generate-modal');
            const titleEl = document.getElementById('auto-modal-title');
            if (modal) {
                const titles = {
                    er: 'توليد خفارات قسم الطوارئ (ER)',
                    con: 'توليد خفارات الاستشارية (Con)',
                    dc: 'توليد خفارات شهادات الوفاة (DC)',
                    rs_er: 'توليد خفارات إضراب الطوارئ (RS - ER)',
                    rs_wards: 'توليد خفارات إضراب الردهات (RS - Wards)'
                };
                if (titleEl) titleEl.textContent = titles[type] || 'توليد الجدول آلياً';
                modal.classList.remove('hidden');
            }
        } else {
            // Empty schedule, run fresh generation immediately
            runAutoDistribution(type, 'fresh');
        }
    }

    function initAutoModalListeners() {
        const fillEmptyBtn = document.getElementById('auto-opt-fill-empty');
        const freshBtn = document.getElementById('auto-opt-fresh');

        if (fillEmptyBtn) {
            fillEmptyBtn.onclick = function() {
                closeAutoGenerateModal();
                if (pendingAutoGenerateType) runAutoDistribution(pendingAutoGenerateType, 'fill_empty');
            };
        }
        if (freshBtn) {
            freshBtn.onclick = function() {
                closeAutoGenerateModal();
                if (pendingAutoGenerateType) runAutoDistribution(pendingAutoGenerateType, 'fresh');
            };
        }
    }

    function closeAutoGenerateModal() {
        const modal = document.getElementById('auto-generate-modal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * Run Auto Distribution Algorithm with Gender Priorities & Preferences
     */
    function runAutoDistribution(type, mode) {
        const daysCount = getDaysInMonth(state.year, state.month);
        const activeDocs = (state.residents || []).filter(r => r.active && !isResidentExpired(r, state.year, state.month));

        if (activeDocs.length === 0) {
            alert('لا يوجد أطباء نشطون مؤهلون للتوزيع لهذا الشهر!');
            return;
        }

        if (type === 'er') {
            runAutoDistributionER(mode, daysCount, activeDocs);
        } else if (type === 'con') {
            runAutoDistributionCon(mode, daysCount, activeDocs);
        } else if (type === 'dc') {
            runAutoDistributionDC(mode, daysCount, activeDocs);
        } else if (type === 'rs_er') {
            runAutoDistributionRSER(mode, daysCount, activeDocs);
        } else if (type === 'rs_wards') {
            runAutoDistributionRSWards(mode, daysCount, activeDocs);
        }

        saveState();
        renderActiveTab();
        showNotification('تم اكتمال التوليد والتوزيع الآلي بنجاح!', 'success');
    }

    /**
     * ER SPECIFIC ALGORITHM:
     * 1- Morning (8AM-2PM): Utmost priority to females.
     * 2- Post-Morning (2PM-8PM): Priority to females, then males.
     * 3- Pre-Night (8PM-2AM): Priority to males with multiple duties (er_target > 1).
     * 4- Night (2AM-8AM): Priority to males with a single duty (er_target === 1).
     * 5- Shift diversity & resident preferences.
     */
    function runAutoDistributionER(mode, daysCount, activeDocs) {
        const schedule = state.schedules.er;
        const shifts = ['morning', 'afternoon', 'preNight', 'lateNight'];

        if (mode === 'fresh') {
            schedule.forEach(d => {
                shifts.forEach(s => d[s] = '');
            });
            state.prefOverrides = {};
        }

        // Track doctor assignments
        const assignedCount = {};
        const assignedShifts = {}; // doc => Set of shift names
        const assignedDays = {};   // dayNumber => Set of doc names

        for (let d = 1; d <= daysCount; d++) {
            assignedDays[d] = new Set();
        }

        // Initialize with existing entries if fill_empty
        activeDocs.forEach(r => {
            assignedCount[r.name] = 0;
            assignedShifts[r.name] = new Set();
        });

        schedule.forEach(day => {
            shifts.forEach(s => {
                if (day[s] && day[s].trim()) {
                    const doc = day[s].trim();
                    assignedCount[doc] = (assignedCount[doc] || 0) + 1;
                    if (!assignedShifts[doc]) assignedShifts[doc] = new Set();
                    assignedShifts[doc].add(s);
                    assignedDays[day.dayNumber].add(doc);
                }
            });
        });

        // Helper to check if doctor is available for slot
        function isAvailable(doc, dayNumber, shiftKey) {
            const r = activeDocs.find(x => x.name === doc);
            if (!r) return false;

            // Quota check
            if ((assignedCount[doc] || 0) >= (r.er_target || 0)) return false;

            // Day conflict check (already has duty today in ER or other schedules)
            if (assignedDays[dayNumber].has(doc)) return false;
            const dateStr = formatDateStr(state.year, state.month, dayNumber);
            const conflict = evaluateCellConflict(doc, dateStr, 'er', shiftKey);
            if (conflict.hasConflict) return false;

            return true;
        }

        // 1. FILL MORNING (8AM - 2PM): Utmost priority to females
        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.morning) {
                // Females first
                let candidates = activeDocs.filter(r => r.sex === 'F' && isAvailable(r.name, d, 'morning'));
                
                // Prioritize female whose preference matches morning or day
                let matchedPref = candidates.find(r => (r.prefShifts && r.prefShifts.includes('morning')) || (r.prefDays && r.prefDays.includes(dayEntry.dayName)));
                let chosen = matchedPref || candidates[0];

                // If no females left, males come in
                if (!chosen) {
                    const maleCandidates = activeDocs.filter(r => r.sex === 'M' && isAvailable(r.name, d, 'morning'));
                    chosen = maleCandidates[0];
                }

                if (chosen) {
                    assignSlotER(dayEntry, 'morning', chosen, d, assignedCount, assignedShifts, assignedDays);
                }
            }
        }

        // 2. FILL POST-MORNING / AFTERNOON (2PM - 8PM): Priority to females, then males
        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.afternoon) {
                let candidates = activeDocs.filter(r => r.sex === 'F' && isAvailable(r.name, d, 'afternoon'));
                let chosen = candidates[0];

                if (!chosen) {
                    const maleCandidates = activeDocs.filter(r => r.sex === 'M' && isAvailable(r.name, d, 'afternoon'));
                    // Diversity: prefer male who hasn't done afternoon yet
                    chosen = maleCandidates.find(m => !assignedShifts[m.name]?.has('afternoon')) || maleCandidates[0];
                }

                if (chosen) {
                    assignSlotER(dayEntry, 'afternoon', chosen, d, assignedCount, assignedShifts, assignedDays);
                }
            }
        }

        // 3. FILL PRE-NIGHT (8PM - 2AM): Priority to males with multiple duties (er_target > 1)
        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.preNight) {
                // Males with multiple duties
                let candidates = activeDocs.filter(r => r.sex === 'M' && (r.er_target > 1) && isAvailable(r.name, d, 'preNight'));
                
                // Diversity: hasn't done preNight yet
                let chosen = candidates.find(m => !assignedShifts[m.name]?.has('preNight')) || candidates[0];

                // Fallback to any available male
                if (!chosen) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && isAvailable(r.name, d, 'preNight'));
                    chosen = candidates[0];
                }
                // Fallback to any doctor
                if (!chosen) {
                    candidates = activeDocs.filter(r => isAvailable(r.name, d, 'preNight'));
                    chosen = candidates[0];
                }

                if (chosen) {
                    assignSlotER(dayEntry, 'preNight', chosen, d, assignedCount, assignedShifts, assignedDays);
                }
            }
        }

        // 4. FILL NIGHT (2AM - 8AM): Priority to males with a single duty (er_target === 1)
        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.lateNight) {
                // Males with single duty
                let candidates = activeDocs.filter(r => r.sex === 'M' && (r.er_target === 1) && isAvailable(r.name, d, 'lateNight'));
                let chosen = candidates[0];

                if (!chosen) {
                    // Males with remaining quota
                    candidates = activeDocs.filter(r => r.sex === 'M' && isAvailable(r.name, d, 'lateNight'));
                    chosen = candidates.find(m => !assignedShifts[m.name]?.has('lateNight')) || candidates[0];
                }
                if (!chosen) {
                    candidates = activeDocs.filter(r => isAvailable(r.name, d, 'lateNight'));
                    chosen = candidates[0];
                }

                if (chosen) {
                    assignSlotER(dayEntry, 'lateNight', chosen, d, assignedCount, assignedShifts, assignedDays);
                }
            }
        }
    }

    function assignSlotER(dayEntry, shiftKey, resident, dayNumber, assignedCount, assignedShifts, assignedDays) {
        dayEntry[shiftKey] = resident.name;
        assignedCount[resident.name] = (assignedCount[resident.name] || 0) + 1;
        if (!assignedShifts[resident.name]) assignedShifts[resident.name] = new Set();
        assignedShifts[resident.name].add(shiftKey);
        assignedDays[dayNumber].add(resident.name);

        // Preference Override Check
        const cellSlotId = `er_${dayNumber}_${shiftKey}`;
        if (resident.prefShifts && resident.prefShifts.length > 0) {
            if (!resident.prefShifts.includes(shiftKey)) {
                if (!state.prefOverrides) state.prefOverrides = {};
                state.prefOverrides[cellSlotId] = true;
            }
        }
    }

    /**
     * CON AUTOMATIC DISTRIBUTION
     */
    function runAutoDistributionCon(mode, daysCount, activeDocs) {
        const schedule = state.schedules.con;
        if (mode === 'fresh') {
            schedule.forEach(d => d.doctor = '');
        }

        const conCandidates = activeDocs.filter(r => (r.con_target || 0) > 0);
        const assigned = countScheduledDutiesPerResident('con');

        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                const dateStr = formatDateStr(state.year, state.month, d);
                const available = conCandidates.filter(r => {
                    const filled = assigned[normalizeArabic(r.name)] || 0;
                    if (filled >= r.con_target) return false;
                    const evalRes = evaluateCellConflict(r.name, dateStr, 'con', 'doctor');
                    return !evalRes.hasConflict;
                });

                if (available.length > 0) {
                    // Sort by highest remaining
                    available.sort((a, b) => ((b.con_target - (assigned[normalizeArabic(b.name)] || 0)) - (a.con_target - (assigned[normalizeArabic(a.name)] || 0))));
                    const chosen = available[0];
                    dayEntry.doctor = chosen.name;
                    assigned[normalizeArabic(chosen.name)] = (assigned[normalizeArabic(chosen.name)] || 0) + 1;
                }
            }
        }
    }

    /**
     * DC AUTOMATIC DISTRIBUTION (Prioritizes Hospital On-Call specialty doctors!)
     */
    function runAutoDistributionDC(mode, daysCount, activeDocs) {
        const schedule = state.schedules.dc;
        if (mode === 'fresh') {
            schedule.forEach(d => d.doctor = '');
        }

        const dcCandidates = activeDocs.filter(r => (r.dc_target || 0) > 0);
        const assigned = countScheduledDutiesPerResident('dc');

        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                const dateStr = formatDateStr(state.year, state.month, d);
                const hospOnCall = getAllHospitalOnCallDoctors(dateStr);
                const hospCleanSet = new Set(hospOnCall.map(h => h.cleanName));

                // 1. Doctors on-call in hospital on this date who still have DC quota
                let chosen = dcCandidates.find(r => {
                    const clean = normalizeArabic(r.name);
                    const filled = assigned[clean] || 0;
                    return (filled < r.dc_target) && hospCleanSet.has(clean);
                });

                // 2. Fallback to any candidate without ER/Con conflict
                if (!chosen) {
                    chosen = dcCandidates.find(r => {
                        const filled = assigned[normalizeArabic(r.name)] || 0;
                        if (filled >= r.dc_target) return false;
                        const evalRes = evaluateCellConflict(r.name, dateStr, 'dc', 'doctor');
                        return !evalRes.hasConflict;
                    });
                }

                if (chosen) {
                    dayEntry.doctor = chosen.name;
                    assigned[normalizeArabic(chosen.name)] = (assigned[normalizeArabic(chosen.name)] || 0) + 1;
                }
            }
        }
    }

    /**
     * RS ER AUTOMATIC DISTRIBUTION
     */
    function runAutoDistributionRSER(mode, daysCount, activeDocs) {
        const schedule = state.schedules.rs;
        const shifts = ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight'];
        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || daysCount;

        if (mode === 'fresh') {
            schedule.forEach(d => {
                if (d.dayNumber >= startDay && d.dayNumber <= endDay) {
                    shifts.forEach(s => d[s] = '');
                }
            });
        }

        const rsCandidates = activeDocs.filter(r => (r.rs_target || 0) > 0);
        const assigned = countScheduledDutiesPerResident('rs');

        for (let d = startDay; d <= endDay; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry) {
                const dateStr = formatDateStr(state.year, state.month, d);
                shifts.forEach(slot => {
                    if (!dayEntry[slot]) {
                        const available = rsCandidates.filter(r => {
                            const filled = assigned[normalizeArabic(r.name)] || 0;
                            if (filled >= r.rs_target) return false;
                            const evalRes = evaluateCellConflict(r.name, dateStr, 'rs', slot);
                            return !evalRes.hasConflict;
                        });
                        if (available.length > 0) {
                            const chosen = available[0];
                            dayEntry[slot] = chosen.name;
                            assigned[normalizeArabic(chosen.name)] = (assigned[normalizeArabic(chosen.name)] || 0) + 1;
                        }
                    }
                });
            }
        }
    }

    /**
     * RS WARDS AUTOMATIC DISTRIBUTION
     */
    function runAutoDistributionRSWards(mode, daysCount, activeDocs) {
        const schedule = state.schedules.rs;
        const wards = ['ward_private', 'ward_floor4', 'ward_floor5'];
        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || daysCount;

        if (mode === 'fresh') {
            schedule.forEach(d => {
                if (d.dayNumber >= startDay && d.dayNumber <= endDay) {
                    wards.forEach(w => d[w] = '');
                }
            });
        }

        const rsCandidates = activeDocs.filter(r => (r.rs_target || 0) > 0);
        const assigned = countScheduledDutiesPerResident('rs');

        for (let d = startDay; d <= endDay; d++) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry) {
                const dateStr = formatDateStr(state.year, state.month, d);
                wards.forEach(slot => {
                    if (!dayEntry[slot]) {
                        const available = rsCandidates.filter(r => {
                            const filled = assigned[normalizeArabic(r.name)] || 0;
                            if (filled >= r.rs_target) return false;
                            const evalRes = evaluateCellConflict(r.name, dateStr, 'rs', slot);
                            return !evalRes.hasConflict;
                        });
                        if (available.length > 0) {
                            const chosen = available[0];
                            dayEntry[slot] = chosen.name;
                            assigned[normalizeArabic(chosen.name)] = (assigned[normalizeArabic(chosen.name)] || 0) + 1;
                        }
                    }
                });
            }
        }
    }

    // =========================================================================
    // 10. OFFICIAL MINISTERIAL PRINTING LAYOUT (FITS STRICTLY ON A SINGLE A4 PAGE)
    // =========================================================================

    function prepareOfficialPrint(targetSheet) {
        const printContainer = document.getElementById('official-print-area');
        if (!printContainer) return;

        const sheetNames = {
            er: 'في الطوارئ',
            con: 'في الاستشارية',
            dc: 'لشهادات الوفاة',
            rs_er: 'في إضراب طوارئ الإسناد (RS)',
            rs_wards: 'في إضراب ردهات الإسناد (RS)'
        };

        const activeSheet = targetSheet || state.activeTab;
        const targetTitle = sheetNames[activeSheet] || 'في الطوارئ';

        // Prepare table rows depending on sheet (DAY NUMBER / ت COLUMN IS REMOVED AS REQUESTED)
        let tableHeaderHTML = '';
        let tableRowsHTML = '';

        if (activeSheet === 'er' || (!targetSheet && state.activeTab === 'er')) {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 70px;">اليوم</th>
                    <th style="width: 75px;">التاريخ</th>
                    <th>الصباحية (8ص - 2م)</th>
                    <th>بعد الصباحية (2م - 8م)</th>
                    <th>البرينايت (8م - 2ص)</th>
                    <th>الليلية (2ص - 8ص)</th>
                </tr>
            `;
            (state.schedules.er || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="font-weight: bold;">${day.dayName}</td>
                        <td style="font-family: Arial, sans-serif;">${formatArabicDateNumbers(day.date)}</td>
                        <td>${day.morning || ''}</td>
                        <td>${day.afternoon || ''}</td>
                        <td>${day.preNight || ''}</td>
                        <td>${day.lateNight || ''}</td>
                    </tr>
                `;
            });
        } else if (activeSheet === 'con') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 100px;">اليوم</th>
                    <th style="width: 100px;">التاريخ</th>
                    <th>طبيب الاستشارية الخافرة</th>
                </tr>
            `;
            (state.schedules.con || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="font-weight: bold;">${day.dayName}</td>
                        <td style="font-family: Arial, sans-serif;">${formatArabicDateNumbers(day.date)}</td>
                        <td style="font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (activeSheet === 'dc') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 100px;">اليوم</th>
                    <th style="width: 100px;">التاريخ</th>
                    <th>طبيب شهادات الوفاة المكلف</th>
                </tr>
            `;
            (state.schedules.dc || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="font-weight: bold;">${day.dayName}</td>
                        <td style="font-family: Arial, sans-serif;">${formatArabicDateNumbers(day.date)}</td>
                        <td style="font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (activeSheet === 'rs_er') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="width: 70px;">اليوم</th>
                    <th style="width: 75px;">التاريخ</th>
                    <th>الصباحية (8ص - 2م)</th>
                    <th>بعد الصباحية (2م - 8م)</th>
                    <th>البرينايت (8م - 2ص)</th>
                    <th>الليلية (2ص - 8ص)</th>
                </tr>
            `;

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    tableRowsHTML += `
                        <tr>
                            <td style="font-weight: bold;">${day.dayName}</td>
                            <td style="font-family: Arial, sans-serif;">${formatArabicDateNumbers(day.date)}</td>
                            <td>${day.er_morning || ''}</td>
                            <td>${day.er_afternoon || ''}</td>
                            <td>${day.er_preNight || ''}</td>
                            <td>${day.er_lateNight || ''}</td>
                        </tr>
                    `;
                }
            });
        } else if (activeSheet === 'rs_wards') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="width: 70px;">اليوم</th>
                    <th style="width: 75px;">التاريخ</th>
                    <th>الجناح الخاص</th>
                    <th>الجناح العام / طابق 4</th>
                    <th>الجناح العام / طابق 5</th>
                </tr>
            `;

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    tableRowsHTML += `
                        <tr>
                            <td style="font-weight: bold;">${day.dayName}</td>
                            <td style="font-family: Arial, sans-serif;">${formatArabicDateNumbers(day.date)}</td>
                            <td>${day.ward_private || ''}</td>
                            <td>${day.ward_floor4 || ''}</td>
                            <td>${day.ward_floor5 || ''}</td>
                        </tr>
                    `;
                }
            });
        }

        const arabicOrderDate = state.orderDate ? formatArabicDateNumbers(state.orderDate) : formatArabicDateNumbers(new Date().toISOString().split('T')[0]);

        printContainer.innerHTML = `
            <div style="font-family: 'Cairo', Arial, sans-serif; direction: rtl; color: #000; width: 100%; box-sizing: border-box;">
                
                <!-- 1. OFFICIAL CENTERED HEADER (MATCHING USER IMAGE 2) -->
                <div style="text-align: center; line-height: 1.25; margin-bottom: 6px;">
                    <div style="font-size: 10.5pt; font-weight: bold;">جمهورية العراق</div>
                    <div style="font-size: 10.5pt; font-weight: bold;">وزارة الصحة</div>
                    <div style="font-size: 10.5pt; font-weight: bold;">دائرة صحة البصرة</div>
                    <div style="font-size: 10.5pt; font-weight: bold;">${state.hospitalName}</div>
                    <div style="font-size: 10pt; font-weight: bold;">شعبة ادارة الموارد البشرية</div>
                </div>

                <!-- 2. ORDER NUMBER & DATE (ON RIGHT, MATCHING USER IMAGE 2) -->
                <div style="text-align: right; margin-bottom: 6px; font-size: 9pt; font-weight: bold; line-height: 1.3;">
                    <div>العـــدد / &nbsp; ${state.orderNumber || ''}</div>
                    <div>التاريخ / &nbsp; ${arabicOrderDate}</div>
                </div>

                <!-- 3. ORDER TITLE & INTRO (MATCHING USER IMAGE 2) -->
                <div style="text-align: center; margin-bottom: 6px;">
                    <div style="font-size: 11.5pt; font-weight: 900; margin-bottom: 2px;">امر اداري</div>
                    <div style="font-size: 9pt; font-weight: bold;">
                        تقرر ان يكون جدول خفارات المقيمين الاقدمين ${targetTitle} لشهر <u>${state.monthYear}</u> كما مبين ادناه: -
                    </div>
                </div>

                <!-- 4. FORMAL PRINT TABLE (DAY NUMBER 'ت' REMOVED, SINGLE A4 PAGE TUNED) -->
                <table class="print-table">
                    <thead style="background-color: #f1f5f9;">
                        ${tableHeaderHTML}
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>

                <!-- 5. INSTRUCTIONS (MATCHING USER IMAGE 1) -->
                <div style="margin-top: 5px; font-size: 7.5pt; font-weight: bold; line-height: 1.35; text-align: right;">
                    <div>◆ يرجى تبليغ رئيس الاطباء المقيمين في حالة تبديل الخفارة وبخلافه يتحمل الطرفين المسؤولية.</div>
                    <div>◆ في حالة تغيب الطبيب عن الخفارة، يعتبر غياب ويكون التعويض مضاعف.</div>
                </div>

                <!-- 6. SIGNATURES (MATCHING USER IMAGE 1: HEAD OF RESIDENTS RIGHT, HOSPITAL DIRECTOR LEFT) -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 10px; font-size: 8.5pt;">
                    <!-- Head of Residents (Right) -->
                    <div style="width: 45%; text-align: center;">
                        <div style="font-weight: bold; font-size: 9pt;">${state.headOfResidents || 'د. محمد راضي خضر'}</div>
                        <div style="font-weight: bold; font-size: 8pt; margin-top: 1px;">رئيس الأطباء المقيمين</div>
                    </div>

                    <!-- Hospital Director (Left) -->
                    <div style="width: 45%; text-align: center;">
                        <div style="font-size: 7.5pt; font-weight: bold;">الطبيب الاخصائي</div>
                        <div style="font-weight: bold; font-size: 9pt;">${state.headOfHospital || 'د. علي عبد معن'}</div>
                        <div style="font-weight: bold; font-size: 8pt; margin-top: 1px;">مدير ${state.hospitalName}</div>
                    </div>
                </div>

                <!-- 7. COPIES TO (MATCHING USER IMAGE 1) -->
                <div style="margin-top: 6px; font-size: 7pt; font-weight: bold; line-height: 1.25; text-align: right;">
                    <div>نسخه منه الى: -</div>
                    <div>◆ دائرة صحة البصرة / قسم الامور الإدارية / للعلم مع التقدير</div>
                    <div>◆ دائرة صحة البصرة / قسم التفتيش / للعلم مع التقدير</div>
                    <div>◆ دائرة صحة البصرة / قسم العمليات الطبية والخدمات المتخصصة / للعلم مع التقدير</div>
                    <div>◆ مكتب مدير المستشفى /للعلم مع التقدير</div>
                    <div>◆ رئيس الاطباء المقيمين / شعبة الطوارئ / لوحة الاعلانات – وحدة المتابعة</div>
                    <div>◆ الاوراق مع الأوليات</div>
                </div>

            </div>
        `;

        window.print();
    }

    function formatArabicDateNumbers(dateStr) {
        if (!dateStr) return '';
        // Convert YYYY-MM-DD to YYYY/MM/DD
        return dateStr.replace(/-/g, '/');
    }

    // =========================================================================
    // 11. EXCEL EXPORT
    // =========================================================================

    function exportFullScheduleToExcel() {
        if (typeof XLSX === 'undefined') {
            alert('مكتبة SheetJS غير محملة');
            return;
        }

        const wb = XLSX.utils.book_new();

        // 1. ER Sheet
        const erData = [
            ['اليوم', 'التاريخ', 'الصباحية', 'بعد الصباحية', 'البرينايت', 'الليلية'],
            ...(state.schedules.er || []).map(d => [d.dayName, d.date, d.morning, d.afternoon, d.preNight, d.lateNight])
        ];
        const wsEr = XLSX.utils.aoa_to_sheet(erData);
        XLSX.utils.book_append_sheet(wb, wsEr, 'ER');

        // 2. Con Sheet
        const conData = [
            ['اليوم', 'التاريخ', 'طبيب الاستشارية'],
            ...(state.schedules.con || []).map(d => [d.dayName, d.date, d.doctor])
        ];
        const wsCon = XLSX.utils.aoa_to_sheet(conData);
        XLSX.utils.book_append_sheet(wb, wsCon, 'Con');

        // 3. DC Sheet
        const dcData = [
            ['اليوم', 'التاريخ', 'طبيب شهادات الوفاة'],
            ...(state.schedules.dc || []).map(d => [d.dayName, d.date, d.doctor])
        ];
        const wsDc = XLSX.utils.aoa_to_sheet(dcData);
        XLSX.utils.book_append_sheet(wb, wsDc, 'DC');

        // 4. RS Sheet
        if (state.rsEnabled) {
            const rsData = [
                ['اليوم', 'التاريخ', 'طوارئ: صباحية', 'طوارئ: بعد الصباحية', 'طوارئ: برينايت', 'طوارئ: ليلية', 'الجناح الخاص', 'طابق 4', 'طابق 5'],
                ...(state.schedules.rs || []).map(d => [d.dayName, d.date, d.er_morning, d.er_afternoon, d.er_preNight, d.er_lateNight, d.ward_private, d.ward_floor4, d.ward_floor5])
            ];
            const wsRs = XLSX.utils.aoa_to_sheet(rsData);
            XLSX.utils.book_append_sheet(wb, wsRs, 'RS');
        }

        // 5. DB Sheet
        const dbData = [
            ['الاسم', 'الجنس', 'الاختصاص', 'نوع البورد', 'المرحلة', 'نصاب ER', 'نصاب Con', 'نصاب DC', 'نصاب RS', 'الحالة', 'شهر الانتهاء', 'الهاتف', 'ملاحظات'],
            ...(state.residents || []).map(r => [
                r.name, r.sex === 'F' ? 'أنثى' : 'ذكر', r.specialty, r.board, r.stage, r.er_target, r.con_target, r.dc_target, r.rs_target, r.active ? 'نشط' : 'متوقف', r.expiryMonth || '', r.phone || '', r.notes
            ])
        ];
        const wsDb = XLSX.utils.aoa_to_sheet(dbData);
        XLSX.utils.book_append_sheet(wb, wsDb, 'Residents_DB');

        XLSX.writeFile(wb, `جدول_خفارات_${state.hospitalId}_${state.month}_${state.year}.xlsx`);
        showNotification('تم تصدير ملف Excel بنجاح', 'success');
    }

    // =========================================================================
    // NOTIFICATIONS
    // =========================================================================

    function showNotification(msg, type = 'info') {
        let container = document.getElementById('hub-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'hub-toast-container';
            container.className = 'fixed bottom-5 left-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none no-print';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const bg = type === 'success' ? 'bg-emerald-600 text-white' :
                   type === 'error' ? 'bg-rose-600 text-white' :
                   'bg-slate-800 text-white';

        toast.className = `p-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-bold ${bg} animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto`;
        toast.innerHTML = `
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-info-circle'} text-sm"></i>
            <span class="flex-1">${msg}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    // =========================================================================
    // GLOBAL EXPORTS
    // =========================================================================

    window.EmergencyHub = {
        init: initEmergencyApp,
        getState: () => state,
        switchTab,
        onHospitalChange,
        onMonthYearChange,
        onOrderNumberChange,
        onOrderDateChange,
        onHeadOfResidentsChange,
        onHeadOfHospitalChange,
        suggestSequentialOrderNumber,
        onRsDateChange,
        toggleRotatorsStrike,
        openDoctorPicker,
        closeDoctorPickerModal,
        filterPickerList,
        selectDoctorForSlot,
        clearActiveSlot,
        clearCellOnly,
        openConflictExplanation,
        closeConflictModal,
        triggerScheduleAutoGenerate,
        closeAutoGenerateModal,
        runAutoDistribution,
        onScheduleSearchInput,
        onScheduleShiftFilterChange,
        onScheduleDayFilterChange,
        onScheduleStatusFilterChange,
        resetScheduleFilters,
        toggleShowInactiveInDB,
        onResidentFieldChange,
        onResidentTargetChange,
        deactivateResidentWithConfirmation,
        reactivateResident,
        advanceBoardResidentsStage,
        openResidentPrefsModal,
        closeResidentPrefsModal,
        saveResidentPreferences,
        deleteResident,
        downloadEmergencyDbJson,
        openExportResidentModal,
        closeExportResidentModal,
        handleConfirmExportResident,
        openHospitalSyncModal,
        closeHospitalSyncModal,
        syncDoctorNameSpelling,
        importSingleDoctorToER,
        importAllMissingDoctorsToER,
        openAddResidentModal,
        closeAddResidentModal,
        handleSaveNewResident,
        prepareOfficialPrint,
        exportFullScheduleToExcel,
        resetEmergencyToDefaults
    };

    // Global direct aliases for inline HTML attributes
    window.switchTab = switchTab;
    window.exportFullScheduleToExcel = exportFullScheduleToExcel;
    window.resetEmergencyToDefaults = resetEmergencyToDefaults;
    window.openDoctorPicker = openDoctorPicker;
    window.closeDoctorPickerModal = closeDoctorPickerModal;
    window.filterPickerList = filterPickerList;
    window.selectDoctorForSlot = selectDoctorForSlot;
    window.clearActiveSlot = clearActiveSlot;
    window.clearCellOnly = clearCellOnly;
    window.openConflictExplanation = openConflictExplanation;
    window.closeConflictModal = closeConflictModal;
    window.triggerScheduleAutoGenerate = triggerScheduleAutoGenerate;
    window.closeAutoGenerateModal = closeAutoGenerateModal;
    window.onScheduleSearchInput = onScheduleSearchInput;
    window.onScheduleShiftFilterChange = onScheduleShiftFilterChange;
    window.onScheduleDayFilterChange = onScheduleDayFilterChange;
    window.onScheduleStatusFilterChange = onScheduleStatusFilterChange;
    window.resetScheduleFilters = resetScheduleFilters;
    window.toggleRotatorsStrike = toggleRotatorsStrike;
    window.suggestSequentialOrderNumber = suggestSequentialOrderNumber;
    window.onHospitalChange = onHospitalChange;
    window.onMonthYearChange = onMonthYearChange;
    window.onOrderNumberChange = onOrderNumberChange;
    window.onOrderDateChange = onOrderDateChange;
    window.onHeadOfResidentsChange = onHeadOfResidentsChange;
    window.onHeadOfHospitalChange = onHeadOfHospitalChange;
    window.onRsDateChange = onRsDateChange;
    window.openHospitalSyncModal = openHospitalSyncModal;
    window.closeHospitalSyncModal = closeHospitalSyncModal;
    window.syncDoctorNameSpelling = syncDoctorNameSpelling;
    window.importSingleDoctorToER = importSingleDoctorToER;
    window.importAllMissingDoctorsToER = importAllMissingDoctorsToER;
    window.openExportResidentModal = openExportResidentModal;
    window.closeExportResidentModal = closeExportResidentModal;
    window.handleConfirmExportResident = handleConfirmExportResident;
    window.openAddResidentModal = openAddResidentModal;
    window.closeAddResidentModal = closeAddResidentModal;
    window.handleSaveNewResident = handleSaveNewResident;
    window.toggleShowInactiveInDB = toggleShowInactiveInDB;
    window.onResidentFieldChange = onResidentFieldChange;
    window.onResidentTargetChange = onResidentTargetChange;
    window.deactivateResidentWithConfirmation = deactivateResidentWithConfirmation;
    window.reactivateResident = reactivateResident;
    window.advanceBoardResidentsStage = advanceBoardResidentsStage;
    window.openResidentPrefsModal = openResidentPrefsModal;
    window.closeResidentPrefsModal = closeResidentPrefsModal;
    window.saveResidentPreferences = saveResidentPreferences;
    window.deleteResident = deleteResident;
    window.downloadEmergencyDbJson = downloadEmergencyDbJson;
    window.prepareOfficialPrint = prepareOfficialPrint;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEmergencyApp);
    } else {
        initEmergencyApp();
    }

})(window);
