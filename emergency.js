/**
 * EMERGENCY SHIFT & ON-CALL ROSTER MANAGEMENT SYSTEM
 * HOSP HUB — Full Feature Implementation
 */

(function(window) {
    'use strict';

    // Global Emergency State
    const STATE_KEY = 'hosp_hub_emergency_state_v2';
    const DB_FILE = './emergency-db.json';

    let state = {
        hospitalId: 'iraqi',
        hospitalName: 'المستشفى العراقي التعليمي (الصدر التعليمي)',
        monthYear: 'أيلول 2026',
        month: 9,
        year: 2026,
        orderNumber: '4821',
        rsEnabled: true,
        rsStartDate: '2026-09-15',
        rsEndDate: '2026-09-20',
        activeTab: 'er',
        showInactiveInDB: false,
        showInactiveInPicker: false,
        pickerQuotaFilter: 'pending_only',
        residents: [],
        schedules: {
            er: [],
            con: [],
            dc: [],
            rs: []
        }
    };

    // Current active slot being edited in picker modal
    let activeSlot = null;

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

    // =========================================================================
    // INITIALIZATION & STATE PERSISTENCE
    // =========================================================================

    async function initEmergencyApp() {
        console.log('Initializing Emergency System...');

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
                state.rsStartDate = window.DEFAULT_EMERGENCY_DATA.rsStartDate || state.rsStartDate;
                state.rsEndDate = window.DEFAULT_EMERGENCY_DATA.rsEndDate || state.rsEndDate;
            }
        }

        // 3. Try to fetch emergency-db.json asynchronously to ensure synchronization
        try {
            const resp = await fetch(DB_FILE);
            if (resp.ok) {
                const dbJson = await resp.json();
                if (dbJson && Array.isArray(dbJson.residents) && dbJson.residents.length > 0) {
                    // Merge DB fields if not edited locally
                    if (!saved) {
                        state.residents = dbJson.residents;
                    }
                }
            }
        } catch (err) {
            console.log('Local fetch of emergency-db.json skipped (using bundled state)');
        }

        // 4. Ensure schedule days count matches month
        ensureScheduleIntegrity();

        // 5. Initialize Hospital Hub integration
        initHospitalSelector();

        // 6. Sync UI inputs with state
        syncMetaInputsWithState();

        // 7. Render UI
        updateDutyDashboard();
        renderActiveTab();
        updateRsVisibilityUI();
    }

    function ensureScheduleIntegrity() {
        const daysCount = getDaysInMonth(state.year, state.month);
        
        ['er', 'con', 'dc', 'rs'].forEach(type => {
            if (!Array.isArray(state.schedules[type])) {
                state.schedules[type] = [];
            }
            // Ensure every day 1..daysCount exists
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
            // Sort by day number
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
            state.hospitalName = window.DEFAULT_EMERGENCY_DATA.hospitalName || 'المستشفى العراقي التعليمي';
            state.monthYear = window.DEFAULT_EMERGENCY_DATA.monthYear || 'أيلول 2026';
            state.orderNumber = window.DEFAULT_EMERGENCY_DATA.orderNumber || '4821';
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

        // Fallback default hospitals if Hub not yet loaded
        if (hospitals.length === 0) {
            hospitals = [
                { id: 'iraqi', name_ar: 'المستشفى العراقي التعليمي (الصدر التعليمي)' },
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

    function suggestSequentialOrderNumber() {
        // Suggest a sequential order number based on current year or existing order
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
        const rsBtn = document.getElementById('rs-toggle-btn');
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

        const rsStartInput = document.getElementById('meta-rs-start');
        if (rsStartInput) rsStartInput.value = state.rsStartDate;

        const rsEndInput = document.getElementById('meta-rs-end');
        if (rsEndInput) rsEndInput.value = state.rsEndDate;
    }

    // =========================================================================
    // CONFLICT ENGINE & HOSPITAL SCHEDULE LOOKUP
    // =========================================================================

    /**
     * Get all duties a doctor has on dateStr across all systems
     * dateStr format: YYYY-MM-DD
     */
    function getDoctorDutiesOnDate(doctorName, dateStr) {
        if (!doctorName || !doctorName.trim()) return [];
        const cleanTarget = normalizeArabic(doctorName);
        const duties = [];

        // Parse date day number
        const parts = dateStr.split('-');
        const dayNumber = parseInt(parts[2], 10);

        // 1. Check ER Schedule
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

        // 2. Check Consultation Clinic (Con)
        const conDay = (state.schedules.con || []).find(s => s.dayNumber === dayNumber);
        if (conDay && conDay.doctor && normalizeArabic(conDay.doctor) === cleanTarget) {
            duties.push({ type: 'con', slotKey: 'doctor', label: 'الاستشارية الخافرة' });
        }

        // 3. Check Death Certificates (DC)
        const dcDay = (state.schedules.dc || []).find(s => s.dayNumber === dayNumber);
        if (dcDay && dcDay.doctor && normalizeArabic(dcDay.doctor) === cleanTarget) {
            duties.push({ type: 'dc', slotKey: 'doctor', label: 'شهادات الوفاة' });
        }

        // 4. Check Rotators Strike (RS) if enabled
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

        // 5. Check Hospital On-Call Schedule in hub-data.json
        const hospDuties = getHospitalDutiesForDoctor(doctorName, dateStr);
        hospDuties.forEach(hd => {
            duties.push({
                type: 'hospital',
                slotKey: hd.specCode,
                label: `خفارة مستشفى: ${hd.specName}`
            });
        });

        return duties;
    }

    /**
     * Get duties for doctor in the selected hospital schedule
     */
    function getHospitalDutiesForDoctor(doctorName, dateStr) {
        if (!window.Hub || typeof window.Hub.getHospital !== 'function') return [];
        const hosp = window.Hub.getHospital(state.hospitalId);
        if (!hosp || !Array.isArray(hosp.schedule)) return [];

        const parts = dateStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const hospDateStr = formatHospitalDateStr(y, m, d); // DD/MM/YYYY

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

    /**
     * Get ALL doctors having on-call hospital duty on dateStr (DD/MM/YYYY)
     */
    function getAllHospitalOnCallDoctors(dateStr) {
        if (!window.Hub || typeof window.Hub.getHospital !== 'function') return [];
        const hosp = window.Hub.getHospital(state.hospitalId);
        if (!hosp || !Array.isArray(hosp.schedule)) return [];

        const parts = dateStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const hospDateStr = formatHospitalDateStr(y, m, d); // DD/MM/YYYY

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
     * Conflict Check for a specific cell:
     * - Death Certificate (DC) is OK to overlap with hospital duty (GREEN FLAGGED).
     * - Other slots flag conflict (RED / AMBER FLAGGED) if more than 1 duty exists on the same day.
     */
    function evaluateCellConflict(doctorName, dateStr, currentSlotType, currentSlotKey) {
        if (!doctorName || !doctorName.trim()) {
            return { hasConflict: false, isDcHospitalDuty: false, conflicts: [] };
        }

        const allDuties = getDoctorDutiesOnDate(doctorName, dateStr);
        // Filter out the duty matching the current cell itself
        const otherDuties = allDuties.filter(d => !(d.type === currentSlotType && d.slotKey === currentSlotKey));

        if (currentSlotType === 'dc') {
            // For DC: Hospital duty overlap is fully allowed and recommended!
            const hospDuty = otherDuties.find(d => d.type === 'hospital');
            if (hospDuty) {
                return {
                    hasConflict: false,
                    isDcHospitalDuty: true,
                    hospDutyName: hospDuty.label,
                    conflicts: otherDuties
                };
            }
        }

        // For other tables, if other duties exist, it's a conflict
        const hasConflict = otherDuties.length > 0;
        return {
            hasConflict,
            isDcHospitalDuty: false,
            conflicts: otherDuties
        };
    }

    /**
     * Clear cell in current table ONLY when user clicks conflict badge
     */
    function clearCellOnly(tableType, dayNumber, slotKey, event) {
        if (event) event.stopPropagation();

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

        // 1. Active doctors count
        const activeDocs = (state.residents || []).filter(r => r.active);
        const totalDocsCount = (state.residents || []).length;
        const totalDocEl = document.getElementById('stat-total-doctors');
        if (totalDocEl) totalDocEl.textContent = `${activeDocs.length} / ${totalDocsCount}`;

        // 2. ER Duty Metrics
        const erRequired = daysCount * 4;
        const erAllocated = (state.residents || []).reduce((sum, r) => sum + (Number(r.er_target) || 0), 0);
        let erScheduled = 0;
        (state.schedules.er || []).forEach(day => {
            if (day.morning && day.morning.trim()) erScheduled++;
            if (day.afternoon && day.afternoon.trim()) erScheduled++;
            if (day.preNight && day.preNight.trim()) erScheduled++;
            if (day.lateNight && day.lateNight.trim()) erScheduled++;
        });

        // 3. Consultation Clinic (Con) Metrics
        const conRequired = daysCount * 1;
        const conAllocated = (state.residents || []).reduce((sum, r) => sum + (Number(r.con_target) || 0), 0);
        let conScheduled = 0;
        (state.schedules.con || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) conScheduled++;
        });

        // 4. Death Certificates (DC) Metrics
        const dcRequired = daysCount * 1;
        const dcAllocated = (state.residents || []).reduce((sum, r) => sum + (Number(r.dc_target) || 0), 0);
        let dcScheduled = 0;
        (state.schedules.dc || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) dcScheduled++;
        });

        // 5. Rotators Strike Metrics
        let rsDaysCount = 0;
        let rsErScheduled = 0;
        let rsWardsScheduled = 0;
        let rsAllocated = (state.residents || []).reduce((sum, r) => sum + (Number(r.rs_target) || 0), 0);

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

        // Render dashboard HTML inside stats container
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

            <!-- RS Summary Card (if enabled) -->
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

        // Update overall total filled in header
        const totalFilledEl = document.getElementById('stat-total-filled');
        if (totalFilledEl) {
            const grandTotalFilled = erScheduled + conScheduled + dcScheduled + (state.rsEnabled ? (rsErScheduled + rsWardsScheduled) : 0);
            const grandTotalRequired = erRequired + conRequired + dcRequired + (state.rsEnabled ? (rsDaysCount * 7) : 0);
            totalFilledEl.textContent = `${grandTotalFilled} / ${grandTotalRequired}`;
        }
    }

    // =========================================================================
    // TAB SWITCHING & RENDERING
    // =========================================================================

    function switchTab(tabId) {
        state.activeTab = tabId;
        
        // Update tab buttons styles
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const isTarget = btn.getAttribute('data-tab') === tabId;
            if (isTarget) {
                btn.className = 'tab-btn active-tab flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 bg-rose-600 text-white shadow-sm';
            } else {
                btn.className = 'tab-btn flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:white';
            }
        });

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
    // 1. ER VIEW (خفارات الطوارئ: 4 وجبات يومياً)
    // =========================================================================

    function renderERView(container) {
        const shifts = [
            { key: 'morning', label: 'الصباحية (8ص - 2م)', icon: 'fa-sun', color: 'text-amber-500' },
            { key: 'afternoon', label: 'بعد الصباحية (2م - 8م)', icon: 'fa-cloud-sun', color: 'text-orange-500' },
            { key: 'preNight', label: 'البرينايت (8م - 2ص)', icon: 'fa-moon', color: 'text-indigo-500' },
            { key: 'lateNight', label: 'الليلية (2ص - 8ص)', icon: 'fa-star-and-crescent', color: 'text-purple-500' }
        ];

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
                    <button type="button" onclick="autoGenerateSchedule()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توزيع آلي منصف</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية</span>
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-28 font-bold">اليوم والتاريخ</th>
                            ${shifts.map(s => `
                                <th class="py-3 px-3 font-bold">
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

        (state.schedules.er || []).forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            html += `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${day.dayName}</div>
                        <div class="text-[11px] font-mono text-slate-400">${day.date}</div>
                    </td>
                    ${shifts.map(s => renderShiftCellHTML('er', day.dayNumber, day.date, s.key, day[s.key])).join('')}
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
    // 2. CONSULTATION CLINIC VIEW (الاستشارية الخافرة: طبيب واحد يومياً)
    // =========================================================================

    function renderConView(container) {
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
                    <button type="button" onclick="prepareOfficialPrint('con')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية</span>
                    </button>
                </div>
            </div>

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

        (state.schedules.con || []).forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            html += `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}">
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
    // 3. DEATH CERTIFICATES VIEW (شهادات الوفاة: طبيب واحد يومياً + أولوية لخافري المستشفى)
    // =========================================================================

    function renderDCView(container) {
        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-file-medical text-emerald-600"></i>
                        <span>جدول خفارات شهادات الوفاة (DC)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        طبيب مقيم أقدم واحد يومياً · <span class="text-emerald-600 dark:text-emerald-400 font-bold">يسمح بالتداخل مع خفارة المستشفى (موصى به ومعلم بالأخضر)</span>
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="prepareOfficialPrint('dc')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية</span>
                    </button>
                </div>
            </div>

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

        (state.schedules.dc || []).forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            const hospDuties = day.doctor ? getHospitalDutiesForDoctor(day.doctor, day.date) : [];
            const hasHospDuty = hospDuties.length > 0;

            html += `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}">
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
                                <span>خافر في ${hospDuties.map(h => h.specName).join(' + ')}</span>
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
    // 4. ROTATORS STRIKE - ER VIEW (إضراب المقيمين الدوريين - الطوارئ)
    // =========================================================================

    function renderRSERView(container) {
        const shifts = [
            { key: 'er_morning', label: 'الصباحية (8ص - 2م)', icon: 'fa-sun', color: 'text-amber-500' },
            { key: 'er_afternoon', label: 'بعد الصباحية (2م - 8م)', icon: 'fa-cloud-sun', color: 'text-orange-500' },
            { key: 'er_preNight', label: 'البرينايت (8م - 2ص)', icon: 'fa-moon', color: 'text-indigo-500' },
            { key: 'er_lateNight', label: 'الليلية (2ص - 8ص)', icon: 'fa-star-and-crescent', color: 'text-purple-500' }
        ];

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <i class="fas fa-truck-medical"></i>
                        <span>إضراب المقيمين الدوريين — طوارئ الإسناد (RS - ER)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        فترة الإضراب المحددة: من <strong>${state.rsStartDate || '---'}</strong> إلى <strong>${state.rsEndDate || '---'}</strong>
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="prepareOfficialPrint('rs_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية لإضراب الطوارئ</span>
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-amber-100/60 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 text-slate-800 dark:text-slate-200">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-28 font-bold">اليوم والتاريخ</th>
                            ${shifts.map(s => `
                                <th class="py-3 px-3 font-bold">
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

        (state.schedules.rs || []).forEach(day => {
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            const hasNames = shifts.some(s => day[s.key] && day[s.key].trim());
            const rowClass = inRsPeriod 
                ? (hasNames ? 'bg-amber-50/50 dark:bg-amber-950/20 font-medium' : 'bg-slate-50/30 dark:bg-slate-800/20') 
                : 'opacity-50 bg-slate-50/10';

            html += `
                <tr class="hover:bg-amber-50/80 dark:hover:bg-amber-950/40 transition ${rowClass}">
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
    // 5. ROTATORS STRIKE - WARDS VIEW (إضراب المقيمين الدوريين - الردهات)
    // =========================================================================

    function renderRSWardsView(container) {
        const wards = [
            { key: 'ward_private', label: 'الجناح الخاص', icon: 'fa-bed', color: 'text-rose-500' },
            { key: 'ward_floor4', label: 'الجناح العام / طابق 4', icon: 'fa-hospital-user', color: 'text-indigo-500' },
            { key: 'ward_floor5', label: 'الجناح العام / طابق 5', icon: 'fa-hospital-user', color: 'text-sky-500' }
        ];

        let html = `
            <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <i class="fas fa-bed-pulse"></i>
                        <span>إضراب المقيمين الدوريين — ردهات الإسناد (RS - Wards)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        تغطية الردهات أثناء إضراب الدوريين · الجناح الخاص وطابق 4 وطابق 5
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="prepareOfficialPrint('rs_wards')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية لإضراب الردهات</span>
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-amber-100/60 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 text-slate-800 dark:text-slate-200">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-28 font-bold">اليوم والتاريخ</th>
                            ${wards.map(w => `
                                <th class="py-3 px-3 font-bold">
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

        (state.schedules.rs || []).forEach(day => {
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            const hasNames = wards.some(w => day[w.key] && day[w.key].trim());
            const rowClass = inRsPeriod 
                ? (hasNames ? 'bg-amber-50/50 dark:bg-amber-950/20 font-medium' : 'bg-slate-50/30 dark:bg-slate-800/20') 
                : 'opacity-50 bg-slate-50/10';

            html += `
                <tr class="hover:bg-amber-50/80 dark:hover:bg-amber-950/40 transition ${rowClass}">
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
    // CELL RENDERER WITH CLEAN CONFLICT BADGE & CLICK-TO-EMPTY
    // =========================================================================

    function renderShiftCellHTML(tableType, dayNumber, dateStr, slotKey, assignedDoctor) {
        if (!assignedDoctor || !assignedDoctor.trim()) {
            return `
                <td class="py-2 px-3">
                    <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" 
                        class="w-full text-right py-1.5 px-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-400 dark:hover:border-rose-600 text-slate-400 hover:text-rose-600 text-[11px] transition flex items-center justify-between group">
                        <span>+ تعيين خافر</span>
                        <i class="fas fa-plus text-[10px] opacity-0 group-hover:opacity-100 transition"></i>
                    </button>
                </td>
            `;
        }

        const conflictInfo = evaluateCellConflict(assignedDoctor, dateStr, tableType, slotKey);

        let badgeHTML = '';
        if (tableType === 'dc' && conflictInfo.isDcHospitalDuty) {
            // Green Flag for Death Certificate hospital duty overlap
            badgeHTML = `
                <span class="inline-flex items-center text-emerald-600 dark:text-emerald-400 ml-1.5" title="طبيب خافر في المستشفى اليوم (${conflictInfo.hospDutyName}) - موصى به ومتوافق لشهادات الوفاة">
                    <i class="fas fa-circle-check text-xs"></i>
                </span>
            `;
        } else if (conflictInfo.hasConflict) {
            // Amber / Red conflict indicator with hover explanation and click-to-empty
            const conflictLabels = conflictInfo.conflicts.map(c => c.label).join('، ');
            badgeHTML = `
                <button type="button" 
                    onclick="clearCellOnly('${tableType}', ${dayNumber}, '${slotKey}', event)"
                    title="⚠️ تعارض خفارة: مسجل في نفس اليوم في (${conflictLabels}). انقر هنا لإفراغ هذه الخلية في هذا الجدول فقط."
                    class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 hover:bg-rose-100 text-amber-700 hover:text-rose-700 text-[10px] font-black transition ml-1.5 shadow-xs">
                    ⚠️
                </button>
            `;
        }

        return `
            <td class="py-2 px-3">
                <div class="flex items-center justify-between group py-1 px-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 hover:border-slate-400 transition">
                    <div class="flex items-center truncate cursor-pointer flex-1" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')">
                        <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${assignedDoctor}</span>
                        ${badgeHTML}
                    </div>
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition no-print">
                        <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center" title="تعديل الخافر">
                            <i class="fas fa-pencil text-[10px]"></i>
                        </button>
                        <button type="button" onclick="clearCellOnly('${tableType}', ${dayNumber}, '${slotKey}', event)" class="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center justify-center" title="إفراغ الخلية">
                            <i class="fas fa-times text-[10px]"></i>
                        </button>
                    </div>
                </div>
            </td>
        `;
    }

    // =========================================================================
    // 6. RESIDENT DATABASE TAB (DB) WITH INLINE EDITING & HOSPITAL EXPORT
    // =========================================================================

    function renderDBView(container) {
        let residents = state.residents || [];

        // Filter inactive if toggled off
        if (!state.showInactiveInDB) {
            residents = residents.filter(r => r.active);
        }

        // Search query filter
        const query = (document.getElementById('db-search-input')?.value || '').trim();
        if (query) {
            const cleanQ = normalizeArabic(query);
            residents = residents.filter(r => 
                normalizeArabic(r.name).includes(cleanQ) || 
                (r.specialty && r.specialty.toLowerCase().includes(query.toLowerCase())) ||
                (r.notes && r.notes.toLowerCase().includes(query.toLowerCase()))
            );
        }

        let html = `
            <div class="space-y-4">
                <!-- DB Header Actions & Controls -->
                <div class="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <div>
                        <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <i class="fas fa-users-gear text-rose-600"></i>
                            <span>قاعدة المقيمين الأقدمين والأنصبة (DB)</span>
                        </h2>
                        <p class="text-xs text-slate-500 mt-0.5">
                            انقر مباشرة على أي رقم أو حقل للتعديل الفوري · يتم حفظ التعديلات تلقائياً
                        </p>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <button type="button" onclick="toggleShowInactiveInDB()" class="px-3 py-1.5 rounded-xl text-xs font-bold ${state.showInactiveInDB ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'} hover:bg-slate-200 transition flex items-center gap-1.5">
                            <i class="fas ${state.showInactiveInDB ? 'fa-eye' : 'fa-eye-slash'}"></i>
                            <span>${state.showInactiveInDB ? 'إخفاء غير النشطين' : 'إظهار غير النشطين (${(state.residents || []).filter(r => !r.active).length})'}</span>
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

                <!-- Search Bar -->
                <div class="flex items-center gap-3">
                    <div class="relative flex-1">
                        <i class="fas fa-search absolute right-3.5 top-3 text-slate-400 text-xs"></i>
                        <input type="text" id="db-search-input" value="${query}" oninput="renderDBView(document.getElementById('schedule-view-container'))" placeholder="بحث بالاسم أو الاختصاص أو الملاحظات..." class="w-full pr-9 pl-4 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20">
                    </div>
                    <div class="text-xs text-slate-500 font-bold whitespace-nowrap">
                        عرض: <span class="text-rose-600 font-black">${residents.length}</span> طبيب
                    </div>
                </div>

                <!-- Residents Table -->
                <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <table class="w-full text-right border-collapse text-xs">
                        <thead>
                            <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                <th class="py-3 px-3 w-10 text-center font-bold">#</th>
                                <th class="py-3 px-3 font-bold">اسم المقيم الأقدم</th>
                                <th class="py-3 px-3 w-16 text-center font-bold">الجنس</th>
                                <th class="py-3 px-3 font-bold">الاختصاص</th>
                                <th class="py-3 px-3 w-20 text-center font-bold">البورد</th>
                                <th class="py-3 px-3 w-14 text-center font-bold">المرحلة</th>
                                <th class="py-3 px-3 w-20 text-center font-bold text-rose-600">نصاب ER</th>
                                <th class="py-3 px-3 w-20 text-center font-bold text-sky-600">نصاب Con</th>
                                <th class="py-3 px-3 w-20 text-center font-bold text-emerald-600">نصاب DC</th>
                                <th class="py-3 px-3 w-20 text-center font-bold text-amber-600">نصاب RS</th>
                                <th class="py-3 px-3 font-bold">ملاحظات</th>
                                <th class="py-3 px-3 w-16 text-center font-bold">الحالة</th>
                                <th class="py-3 px-3 w-24 text-center font-bold">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        residents.forEach((r, idx) => {
            const boardColor = r.board === 'Arabic' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' :
                               r.board === 'Iraqi' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' :
                               'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';

            const boardLabel = r.board === 'Arabic' ? 'عربي' : r.board === 'Iraqi' ? 'عراقي' : 'بدون';
            const sexLabel = r.sex === 'F' ? 'أنثى' : 'ذكر';
            const sexColor = r.sex === 'F' ? 'text-pink-500' : 'text-blue-500';

            html += `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${!r.active ? 'opacity-40 bg-slate-100/30' : ''}">
                    <td class="py-2 px-3 text-center font-mono text-slate-400">${idx + 1}</td>
                    
                    <!-- Name (Click to edit) -->
                    <td class="py-2 px-3 font-bold text-slate-800 dark:text-slate-100">
                        <span class="hover:underline cursor-pointer" onclick="inlineEditResidentField('${r.id}', 'name', '${escapeForInline(r.name)}')">
                            ${r.name}
                        </span>
                    </td>

                    <!-- Sex (Click to toggle) -->
                    <td class="py-2 px-3 text-center">
                        <button type="button" onclick="cycleResidentSex('${r.id}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${sexColor} bg-slate-100 dark:bg-slate-800 hover:scale-105 transition" title="انقر للتبديل بين ذكر وأنثى">
                            ${sexLabel}
                        </button>
                    </td>

                    <!-- Specialty (Click to edit) -->
                    <td class="py-2 px-3 text-slate-600 dark:text-slate-300">
                        <span class="hover:underline cursor-pointer" onclick="inlineEditResidentField('${r.id}', 'specialty', '${escapeForInline(r.specialty)}')">
                            ${r.specialty || '-'}
                        </span>
                    </td>

                    <!-- Board (Click to cycle) -->
                    <td class="py-2 px-3 text-center">
                        <button type="button" onclick="cycleResidentBoard('${r.id}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${boardColor} hover:scale-105 transition" title="انقر للتبديل: عربي / عراقي / بدون">
                            ${boardLabel}
                        </button>
                    </td>

                    <!-- Stage -->
                    <td class="py-2 px-3 text-center font-mono">
                        <span class="hover:underline cursor-pointer" onclick="inlineEditResidentField('${r.id}', 'stage', '${escapeForInline(r.stage)}')">
                            ${r.stage || '-'}
                        </span>
                    </td>

                    <!-- ER Target (Clickable number) -->
                    <td class="py-2 px-3 text-center">
                        <span onclick="inlineEditResidentNumber('${r.id}', 'er_target', ${r.er_target})" class="inline-block px-2.5 py-1 rounded-xl font-mono font-black text-rose-600 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer transition shadow-xs" title="انقر لتعديل نصاب الطوارئ">
                            ${r.er_target}
                        </span>
                    </td>

                    <!-- Con Target (Clickable number) -->
                    <td class="py-2 px-3 text-center">
                        <span onclick="inlineEditResidentNumber('${r.id}', 'con_target', ${r.con_target})" class="inline-block px-2.5 py-1 rounded-xl font-mono font-black text-sky-600 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/60 cursor-pointer transition shadow-xs" title="انقر لتعديل نصاب الاستشارية">
                            ${r.con_target}
                        </span>
                    </td>

                    <!-- DC Target (Clickable number) -->
                    <td class="py-2 px-3 text-center">
                        <span onclick="inlineEditResidentNumber('${r.id}', 'dc_target', ${r.dc_target})" class="inline-block px-2.5 py-1 rounded-xl font-mono font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 cursor-pointer transition shadow-xs" title="انقر لتعديل نصاب شهادات الوفاة">
                            ${r.dc_target}
                        </span>
                    </td>

                    <!-- RS Target (Clickable number) -->
                    <td class="py-2 px-3 text-center">
                        <span onclick="inlineEditResidentNumber('${r.id}', 'rs_target', ${r.rs_target})" class="inline-block px-2.5 py-1 rounded-xl font-mono font-black text-amber-600 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 cursor-pointer transition shadow-xs" title="انقر لتعديل نصاب الإضراب">
                            ${r.rs_target}
                        </span>
                    </td>

                    <!-- Notes -->
                    <td class="py-2 px-3 text-[11px] text-slate-500 max-w-[140px] truncate">
                        <span class="hover:underline cursor-pointer" onclick="inlineEditResidentField('${r.id}', 'notes', '${escapeForInline(r.notes)}')">
                            ${r.notes || '-'}
                        </span>
                    </td>

                    <!-- Active Toggle -->
                    <td class="py-2 px-3 text-center">
                        <button type="button" onclick="toggleResidentActive('${r.id}')" class="w-7 h-7 rounded-xl flex items-center justify-center mx-auto ${r.active ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' : 'text-slate-400 bg-slate-100 dark:bg-slate-800'}" title="${r.active ? 'نشط في الجداول' : 'متوقف / غير مشمول'}">
                            <i class="fas ${r.active ? 'fa-check' : 'fa-ban'} text-xs"></i>
                        </button>
                    </td>

                    <!-- Actions: Export to Hosp & Delete -->
                    <td class="py-2 px-3 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" onclick="openExportResidentModal('${r.id}')" class="w-7 h-7 rounded-xl text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/40 flex items-center justify-center transition" title="تصدير هذا الطبيب إلى المستشفى المحددة">
                                <i class="fas fa-file-export text-xs"></i>
                            </button>
                            <button type="button" onclick="deleteResident('${r.id}')" class="w-7 h-7 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center transition" title="حذف من القاعدة">
                                <i class="fas fa-trash-can text-xs"></i>
                            </button>
                        </div>
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

        container.innerHTML = html;
    }

    function escapeForInline(str) {
        if (!str) return '';
        return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    function toggleShowInactiveInDB() {
        state.showInactiveInDB = !state.showInactiveInDB;
        renderDBView(document.getElementById('schedule-view-container'));
    }

    function inlineEditResidentNumber(resId, field, currentVal) {
        const fieldNames = {
            er_target: 'نصاب خفارات الطوارئ (ER)',
            con_target: 'نصاب خفارات الاستشارية (Con)',
            dc_target: 'نصاب خفارات شهادات الوفاة (DC)',
            rs_target: 'نصاب خفارات إضراب الدوريين (RS)'
        };
        const promptText = `أدخل ${fieldNames[field] || field}:`;
        const newVal = prompt(promptText, currentVal);
        if (newVal === null) return;
        const num = parseInt(newVal, 10);
        if (isNaN(num) || num < 0) {
            alert('الرجاء إدخال رقم صحيح');
            return;
        }

        const res = (state.residents || []).find(r => r.id === resId);
        if (res) {
            res[field] = num;
            saveState();
            renderDBView(document.getElementById('schedule-view-container'));
            showNotification(`تم تعديل ${fieldNames[field]} إلى: ${num}`, 'success');
        }
    }

    function inlineEditResidentField(resId, field, currentVal) {
        const fieldNames = {
            name: 'اسم المقيم الأقدم',
            specialty: 'الاختصاص الطبي',
            stage: 'المرحلة',
            notes: 'الملاحظات'
        };
        const promptText = `أدخل ${fieldNames[field] || field}:`;
        const newVal = prompt(promptText, currentVal);
        if (newVal === null) return;

        const res = (state.residents || []).find(r => r.id === resId);
        if (res) {
            res[field] = newVal.trim();
            saveState();
            renderDBView(document.getElementById('schedule-view-container'));
            showNotification(`تم تحديث ${fieldNames[field]} بنجاح`, 'success');
        }
    }

    function cycleResidentBoard(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;
        const order = ['Arabic', 'Iraqi', 'None'];
        const currentIdx = order.indexOf(res.board);
        const nextIdx = (currentIdx + 1) % order.length;
        res.board = order[nextIdx];
        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        const labels = { Arabic: 'عربي', Iraqi: 'عراقي', None: 'بدون' };
        showNotification(`تم تغيير نوع البورد إلى: ${labels[res.board]}`, 'info');
    }

    function cycleResidentSex(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;
        res.sex = res.sex === 'F' ? 'M' : 'F';
        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(`تم تغيير الجنس إلى: ${res.sex === 'F' ? 'أنثى' : 'ذكر'}`, 'info');
    }

    function toggleResidentActive(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;
        res.active = !res.active;
        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(res.active ? `تم تنشيط الطبيب: ${res.name}` : `تم إيقاف الطبيب: ${res.name}`, 'info');
    }

    function deleteResident(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;
        if (!confirm(`هل أنت متأكد من حذف الطبيب: "${res.name}" من قاعدة الطوارئ؟`)) return;
        state.residents = state.residents.filter(r => r.id !== resId);
        saveState();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification('تم حذف الطبيب من قاعدة الطوارئ', 'info');
    }

    function downloadEmergencyDbJson() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
            version: '1.0',
            updatedAt: new Date().toISOString(),
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
    // 7. EXPORT RESIDENT TO HOSPITAL (STRUCTURE & HUB SYNC)
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

        const hospName = state.hospitalName;
        const targetSpec = res.specialty || 'General';

        // Prepare structure expected by hospital
        const hospitalStructure = {
            id: `doc_${Date.now()}`,
            name: res.name.startsWith('د.') ? res.name : `د. ${res.name}`,
            phone: '---',
            spec: targetSpec,
            active: res.active,
            hospitals: [state.hospitalId]
        };

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">تصدير مقيم إلى المستشفى المحددة</h3>
                        <p class="text-[11px] text-slate-500">المستشفى الهدف: <strong>${hospName}</strong></p>
                    </div>
                    <button type="button" onclick="closeExportResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div class="p-5 space-y-4 text-xs">
                    <p class="text-slate-600 dark:text-slate-300">
                        سيتم إضافة هذا الطبيب إلى جدول أطباء المستشفى بالهيكلية الرسمية الخاصة بقاعدة بيانات المستشفى:
                    </p>

                    <div class="p-3 bg-slate-900 text-slate-100 font-mono rounded-xl text-[11px] overflow-x-auto" dir="ltr">
<pre>${JSON.stringify(hospitalStructure, null, 2)}</pre>
                    </div>

                    <div class="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900/60 text-[11px] text-blue-800 dark:text-blue-300">
                        <i class="fas fa-circle-info ml-1 text-blue-500"></i>
                        تبقى البيانات الإضافية (أنصبة الطوارئ، نوع البورد، والمرحلة) محفوظة ومخصصة لموقع الطوارئ فقط دون التأثير على بقية المستشفيات.
                    </div>
                </div>

                <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                    <button type="button" onclick="closeExportResidentModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                        إلغاء
                    </button>
                    <button type="button" onclick="confirmExportResidentToHospital('${resId}')" class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-md shadow-sky-600/20 transition flex items-center gap-1.5">
                        <i class="fas fa-check"></i>
                        <span>تأكيد التصدير للمستشفى</span>
                    </button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeExportResidentModal() {
        const modal = document.getElementById('export-resident-modal');
        if (modal) modal.classList.add('hidden');
    }

    async function confirmExportResidentToHospital(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        try {
            if (window.Hub && typeof window.Hub.getHospital === 'function') {
                const hosp = window.Hub.getHospital(state.hospitalId);
                if (hosp) {
                    if (!Array.isArray(hosp.names)) hosp.names = [];
                    
                    const cleanRes = normalizeArabic(res.name);
                    const alreadyExists = hosp.names.some(n => normalizeArabic(n.name) === cleanRes);
                    
                    if (alreadyExists) {
                        alert('هذا الطبيب موجود بالفعل في قائمة أطباء المستشفى المحددة.');
                        closeExportResidentModal();
                        return;
                    }

                    const newDoc = {
                        id: `res_exp_${Date.now()}`,
                        name: res.name.startsWith('د.') ? res.name : `د. ${res.name}`,
                        phone: '---',
                        spec: res.specialty || 'General',
                        active: res.active,
                        hospitals: [state.hospitalId]
                    };

                    hosp.names.push(newDoc);
                    if (typeof window.Hub.saveDatabase === 'function') {
                        await window.Hub.saveDatabase(`Exported resident ${res.name} to ${state.hospitalName}`);
                    }
                }
            }

            closeExportResidentModal();
            showNotification(`تم تصدير الطبيب "${res.name}" إلى مستشفى "${state.hospitalName}" بنجاح!`, 'success');
        } catch (err) {
            console.error('Error exporting resident to hospital:', err);
            showNotification('حدث خطأ أثناء تصدير الطبيب للمستشفى', 'error');
        }
    }

    // =========================================================================
    // 8. HOSPITAL RECONCILIATION & MATCHING MODAL
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

        // Match categorization
        const matched = [];
        const missingInEr = [];
        const erOnly = [];

        const hospCleanMap = new Map();
        hospResidents.forEach(h => hospCleanMap.set(normalizeArabic(h.name), h));

        const erCleanMap = new Map();
        erResidents.forEach(e => erCleanMap.set(normalizeArabic(e.name), e));

        // 1. Check ER against Hospital
        erResidents.forEach(e => {
            const clean = normalizeArabic(e.name);
            if (hospCleanMap.has(clean)) {
                matched.push({ er: e, hosp: hospCleanMap.get(clean), matchType: 'exact' });
            } else {
                // Check fuzzy
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

        // 2. Check Hospital against ER for missing in ER
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

                    <!-- Fuzzy matches / Spelling updates -->
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

            // Update in all schedules
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
        const newId = `er_res_${Date.now()}`;
        state.residents.push({
            id: newId,
            name: name,
            sex: 'M',
            specialty: spec || 'General',
            board: 'None',
            stage: '1.0',
            er_target: 2,
            con_target: 0,
            dc_target: 0,
            rs_target: 0,
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
    // 9. DOCTOR PICKER MODAL (PRIORITY FOR DC + CONFLICT RED FLAGGING)
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

    function filterPickerList() {
        if (!activeSlot) return;
        const listContainer = document.getElementById('picker-doctors-list');
        if (!listContainer) return;

        const searchInput = document.getElementById('picker-search-input');
        const query = (searchInput?.value || '').trim();
        const cleanQ = normalizeArabic(query);

        const quotaFilter = document.getElementById('picker-quota-filter')?.value || 'all';

        // 1. Get all hospital on-call doctors on this date
        const hospitalOnCall = getAllHospitalOnCallDoctors(activeSlot.dateStr);
        const hospDoctorMap = new Map();
        hospitalOnCall.forEach(hd => hospDoctorMap.set(hd.cleanName, hd));

        // 2. Count current scheduled duties for each resident across month for this type
        const scheduledCounts = countScheduledDutiesPerResident(activeSlot.type);

        let residents = (state.residents || []).slice();

        // Filter inactive
        if (!state.showInactiveInPicker) {
            residents = residents.filter(r => r.active);
        }

        // Search query filter
        if (cleanQ) {
            residents = residents.filter(r => 
                normalizeArabic(r.name).includes(cleanQ) || 
                (r.specialty && r.specialty.toLowerCase().includes(query.toLowerCase()))
            );
        }

        // Quota filter
        const targetField = activeSlot.type === 'er' ? 'er_target' :
                            activeSlot.type === 'con' ? 'con_target' :
                            activeSlot.type === 'dc' ? 'dc_target' : 'rs_target';

        if (quotaFilter === 'pending_only') {
            residents = residents.filter(r => {
                const filled = scheduledCounts[normalizeArabic(r.name)] || 0;
                const target = Number(r[targetField]) || 0;
                return filled < target;
            });
        }

        // Evaluate conflict and priority for sorting
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

        // SORTING LOGIC:
        // For DC: Doctors with hospital duty on that day are ranked FIRST at the top!
        // Otherwise: Sort by remaining quota descending, then non-conflicting first
        enriched.sort((a, b) => {
            if (activeSlot.type === 'dc') {
                if (a.isHospOnCall && !b.isHospOnCall) return -1;
                if (!a.isHospOnCall && b.isHospOnCall) return 1;
            }

            // Conflicts sorted to the bottom
            if (!a.hasConflict && b.hasConflict) return -1;
            if (a.hasConflict && !b.hasConflict) return 1;

            // Highest remaining quota first
            if (b.remaining !== a.remaining) {
                return b.remaining - a.remaining;
            }

            return a.resident.name.localeCompare(b.resident.name, 'ar');
        });

        if (enriched.length === 0) {
            listContainer.innerHTML = `
                <div class="py-8 text-center text-slate-400 text-xs">
                    <i class="fas fa-user-slash text-2xl mb-2 block"></i>
                    لا يوجد أطباء متاحون يطابقون شروط البحث
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
                                ${r.specialty || 'عام'} · بورد: ${r.board === 'Arabic' ? 'عربي' : r.board === 'Iraqi' ? 'عراقي' : 'بدون'}
                            </div>
                        </div>
                    </div>

                    <!-- Quota badge -->
                    <div class="text-left shrink-0">
                        <div class="text-xs font-mono font-black ${item.remaining > 0 ? 'text-emerald-600' : 'text-slate-400'}">
                            ${item.filled} / ${item.target}
                        </div>
                        <div class="text-[10px] text-slate-400 font-bold">
                            ${item.remaining > 0 ? `متبقي ${item.remaining}` : 'اكتمل النصاب'}
                        </div>
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
    // 10. ADD NEW RESIDENT MODAL
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
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الطبيب الرباعي:</label>
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
                            <input type="text" id="new-res-stage" placeholder="1.0" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
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

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">ملاحظات إدارية:</label>
                        <input type="text" id="new-res-notes" placeholder="ملاحظات..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div class="pt-2">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="new-res-export-hosp" checked class="w-4 h-4 rounded text-rose-600">
                            <span class="font-bold text-slate-700 dark:text-slate-300">تصدير الطبيب أيضاً إلى قاعدة المستشفى المحددة حالياً (${state.hospitalName})</span>
                        </label>
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

    async function handleSaveNewResident(e) {
        e.preventDefault();
        const rawName = document.getElementById('new-res-name').value.trim();
        const formattedName = rawName.startsWith('د.') ? rawName : `د. ${rawName}`;
        const sex = document.getElementById('new-res-sex').value;
        const specialty = document.getElementById('new-res-spec').value.trim() || 'General';
        const board = document.getElementById('new-res-board').value;
        const stage = document.getElementById('new-res-stage').value.trim() || '1.0';
        const er_target = parseInt(document.getElementById('new-res-er').value, 10) || 0;
        const con_target = parseInt(document.getElementById('new-res-con').value, 10) || 0;
        const dc_target = parseInt(document.getElementById('new-res-dc').value, 10) || 0;
        const rs_target = parseInt(document.getElementById('new-res-rs').value, 10) || 0;
        const notes = document.getElementById('new-res-notes').value.trim();
        const exportToHosp = document.getElementById('new-res-export-hosp').checked;

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
            notes,
            active: true,
            hospitals: [state.hospitalId]
        };

        state.residents.push(newDoc);
        saveState();

        if (exportToHosp) {
            await confirmExportResidentToHospital(newDoc.id);
        }

        closeAddResidentModal();
        renderDBView(document.getElementById('schedule-view-container'));
        showNotification(`تمت إضافة الطبيب "${formattedName}" بنجاح`, 'success');
    }

    // =========================================================================
    // 11. AUTO GENERATE SCHEDULE (SMART BALANCED DISTRIBUTION)
    // =========================================================================

    function autoGenerateSchedule() {
        if (!confirm('هل ترغب في توليد وتوزيع خفارات الشهر آلياً بحسب الأنصبة المخصصة لكل طبيب وتجنب التعارضات؟')) return;

        const activeDocs = (state.residents || []).filter(r => r.active);
        if (activeDocs.length === 0) {
            alert('لا يوجد أطباء نشطون في القاعدة للتوزيع!');
            return;
        }

        const daysCount = getDaysInMonth(state.year, state.month);

        // Track doctor assignments per day to prevent duplicate daily duties
        const dayAssignments = {};
        for (let d = 1; d <= daysCount; d++) {
            dayAssignments[d] = new Set();
        }

        // 1. First Pass: Death Certificates (DC) - Prioritize Hospital On-Call residents!
        for (let d = 1; d <= daysCount; d++) {
            const dateStr = formatDateStr(state.year, state.month, d);
            const hospDoctors = getAllHospitalOnCallDoctors(dateStr);
            
            let chosen = null;
            // Look for hospital doctor who has DC target
            for (let hd of hospDoctors) {
                const resident = activeDocs.find(r => normalizeArabic(r.name) === hd.cleanName && (r.dc_target > 0));
                if (resident) {
                    chosen = resident.name;
                    break;
                }
            }

            // Fallback to any active doctor with DC target
            if (!chosen) {
                const candidates = activeDocs.filter(r => (r.dc_target > 0) && !dayAssignments[d].has(r.name));
                if (candidates.length > 0) {
                    chosen = candidates[Math.floor(Math.random() * candidates.length)].name;
                }
            }

            if (chosen) {
                const dcEntry = state.schedules.dc.find(s => s.dayNumber === d);
                if (dcEntry) dcEntry.doctor = chosen;
                // Note: DC overlap is allowed, but we record assignment
            }
        }

        // 2. Second Pass: Consultation Clinic (Con)
        const conPool = [];
        activeDocs.forEach(r => {
            for (let i = 0; i < (r.con_target || 0); i++) conPool.push(r.name);
        });
        // Shuffle
        conPool.sort(() => Math.random() - 0.5);

        for (let d = 1; d <= daysCount; d++) {
            const conEntry = state.schedules.con.find(s => s.dayNumber === d);
            if (conEntry) {
                let chosen = null;
                for (let i = 0; i < conPool.length; i++) {
                    const candidate = conPool[i];
                    if (!dayAssignments[d].has(candidate)) {
                        chosen = candidate;
                        conPool.splice(i, 1);
                        break;
                    }
                }
                if (!chosen && activeDocs.length > 0) {
                    chosen = activeDocs[Math.floor(Math.random() * activeDocs.length)].name;
                }
                conEntry.doctor = chosen || '';
                if (chosen) dayAssignments[d].add(chosen);
            }
        }

        // 3. Third Pass: Main ER Shifts (Morning, Afternoon, PreNight, LateNight)
        const erSlots = ['morning', 'afternoon', 'preNight', 'lateNight'];
        const erPool = [];
        activeDocs.forEach(r => {
            for (let i = 0; i < (r.er_target || 0); i++) erPool.push(r.name);
        });
        erPool.sort(() => Math.random() - 0.5);

        for (let d = 1; d <= daysCount; d++) {
            const erEntry = state.schedules.er.find(s => s.dayNumber === d);
            if (erEntry) {
                erSlots.forEach(slot => {
                    let chosen = null;
                    for (let i = 0; i < erPool.length; i++) {
                        const candidate = erPool[i];
                        if (!dayAssignments[d].has(candidate)) {
                            chosen = candidate;
                            erPool.splice(i, 1);
                            break;
                        }
                    }
                    if (!chosen) {
                        const available = activeDocs.filter(r => !dayAssignments[d].has(r.name));
                        if (available.length > 0) {
                            chosen = available[Math.floor(Math.random() * available.length)].name;
                        } else {
                            chosen = activeDocs[Math.floor(Math.random() * activeDocs.length)].name;
                        }
                    }
                    erEntry[slot] = chosen || '';
                    if (chosen) dayAssignments[d].add(chosen);
                });
            }
        }

        saveState();
        renderActiveTab();
        showNotification('تم توليد وتوزيع الجدول آلياً بنجاح!', 'success');
    }

    // =========================================================================
    // 12. OFFICIAL MINISTERIAL PRINTING LAYOUT
    // =========================================================================

    function prepareOfficialPrint(targetSheet) {
        const printContainer = document.getElementById('official-print-area');
        if (!printContainer) return;

        const sheetNames = {
            er: 'لقسم الطوارئ (ER)',
            con: 'للاشتشارية الخافرة (Con)',
            dc: 'لشهادات الوفاة (DC)',
            rs_er: 'لإضراب المقيمين الدوريين — طوارئ الإسناد (RS - ER)',
            rs_wards: 'لإضراب المقيمين الدوريين — ردهات الإسناد (RS - Wards)'
        };

        const targetTitle = sheetNames[targetSheet] || sheetNames[state.activeTab] || 'لقسم الطوارئ';

        // Prepare table rows depending on sheet
        let tableHeaderHTML = '';
        let tableRowsHTML = '';

        if (targetSheet === 'er' || (state.activeTab === 'er' && !targetSheet)) {
            tableHeaderHTML = `
                <tr>
                    <th style="border: 1px solid #000; padding: 4px; width: 35px; text-align: center;">ت</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 65px; text-align: center;">اليوم</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 80px; text-align: center;">التاريخ</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الصباحية (8ص - 2م)</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">بعد الصباحية (2م - 8م)</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">البرينايت (8م - 2ص)</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الليلية (2ص - 8ص)</th>
                </tr>
            `;
            (state.schedules.er || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayNumber}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayName}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-family: monospace;">${day.date}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.morning || ''}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.afternoon || ''}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.preNight || ''}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.lateNight || ''}</td>
                    </tr>
                `;
            });
        } else if (targetSheet === 'con') {
            tableHeaderHTML = `
                <tr>
                    <th style="border: 1px solid #000; padding: 4px; width: 40px; text-align: center;">ت</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 80px; text-align: center;">اليوم</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 100px; text-align: center;">التاريخ</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">طبيب الاستشارية الخافرة</th>
                </tr>
            `;
            (state.schedules.con || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayNumber}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayName}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-family: monospace;">${day.date}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (targetSheet === 'dc') {
            tableHeaderHTML = `
                <tr>
                    <th style="border: 1px solid #000; padding: 4px; width: 40px; text-align: center;">ت</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 80px; text-align: center;">اليوم</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 100px; text-align: center;">التاريخ</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">طبيب شهادات الوفاة المكلف</th>
                </tr>
            `;
            (state.schedules.dc || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayNumber}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayName}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-family: monospace;">${day.date}</td>
                        <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (targetSheet === 'rs_er') {
            // Rotators Strike ER Printout (Strictly from RS Start Date to RS End Date or latest scheduled date!)
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="border: 1px solid #000; padding: 4px; width: 35px; text-align: center;">ت</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 65px; text-align: center;">اليوم</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 80px; text-align: center;">التاريخ</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الصباحية (8ص - 2م)</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">بعد الصباحية (2م - 8م)</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">البرينايت (8م - 2ص)</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الليلية (2ص - 8ص)</th>
                </tr>
            `;

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    tableRowsHTML += `
                        <tr>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayNumber}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayName}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center; font-family: monospace;">${day.date}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.er_morning || ''}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.er_afternoon || ''}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.er_preNight || ''}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.er_lateNight || ''}</td>
                        </tr>
                    `;
                }
            });
        } else if (targetSheet === 'rs_wards') {
            // Rotators Strike Wards Printout
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="border: 1px solid #000; padding: 4px; width: 35px; text-align: center;">ت</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 65px; text-align: center;">اليوم</th>
                    <th style="border: 1px solid #000; padding: 4px; width: 80px; text-align: center;">التاريخ</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الجناح الخاص</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الجناح العام / طابق 4</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">الجناح العام / طابق 5</th>
                </tr>
            `;

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    tableRowsHTML += `
                        <tr>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayNumber}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${day.dayName}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center; font-family: monospace;">${day.date}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.ward_private || ''}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.ward_floor4 || ''}</td>
                            <td style="border: 1px solid #000; padding: 4px; text-align: center;">${day.ward_floor5 || ''}</td>
                        </tr>
                    `;
                }
            });
        }

        printContainer.innerHTML = `
            <div style="font-family: 'Cairo', Arial, sans-serif; direction: rtl; color: #000; width: 100%;">
                
                <!-- Official Administrative Letterhead -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; border-bottom: 2px solid #000; padding-bottom: 8px;">
                    <div style="text-align: right; line-height: 1.4; font-size: 10pt; font-weight: bold;">
                        <div>جمهورية العراق</div>
                        <div>وزارة الصحة</div>
                        <div>دائرة صحة البصرة</div>
                        <div>${state.hospitalName}</div>
                        <div>شعبة إدارة الموارد البشرية</div>
                    </div>

                    <div style="text-align: center; line-height: 1.3;">
                        <div style="font-size: 11pt; font-weight: bold;">جمهورية العراق</div>
                        <div style="font-size: 16pt; font-weight: 900; margin: 4px 0;">أمـــــر إداري</div>
                    </div>

                    <div style="text-align: left; line-height: 1.4; font-size: 10pt;" dir="ltr">
                        <div><strong>No:</strong> ${state.orderNumber || '4821'}</div>
                        <div><strong>Date:</strong> ${new Date().toISOString().split('T')[0]}</div>
                    </div>
                </div>

                <!-- Administrative Intro Text -->
                <div style="margin: 10px 0; font-size: 10.5pt; font-weight: bold; line-height: 1.5;">
                    تقرر أن يكون جدول خفارات المقيمين الأقدمين ${targetTitle} لشهر <u>${state.monthYear}</u> كما مبين أدناه:-
                </div>

                <!-- Pristine Print Table -->
                <table style="width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9.5pt; border: 1.5px solid #000;">
                    <thead style="background-color: #f1f5f9; -webkit-print-color-adjust: exact;">
                        ${tableHeaderHTML}
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>

                <!-- Administrative Instructions & Notes -->
                <div style="margin-top: 14px; font-size: 9pt; line-height: 1.5; border: 1px solid #000; padding: 6px 10px; border-radius: 4px;">
                    <div>◆ يرجى تبليغ رئيس الأطباء المقيمين في حالة تبديل الخفارة وبخلافه يتحمل الطرفان المسؤولية الإدارية والقانونية.</div>
                    <div>◆ في حالة تغيب الطبيب عن الخفارة، يعتبر غياباً ويكون التعويض مضاعفاً بموجب الضوابط والتعليمات النافذة.</div>
                </div>

                <!-- Signatures Block -->
                <div style="display: flex; justify-content: space-between; margin-top: 30px; text-align: center; font-size: 10pt; font-weight: bold;">
                    <div style="width: 23%;">
                        <div>منظم الجدول</div>
                        <div style="margin-top: 30px;">............................</div>
                    </div>
                    <div style="width: 23%;">
                        <div>رئيس الأطباء المقيمين</div>
                        <div style="margin-top: 30px;">............................</div>
                    </div>
                    <div style="width: 23%;">
                        <div>مسؤول الموارد البشرية</div>
                        <div style="margin-top: 30px;">............................</div>
                    </div>
                    <div style="width: 23%;">
                        <div>مدير المستشفى</div>
                        <div style="margin-top: 30px;">............................</div>
                    </div>
                </div>

            </div>
        `;

        window.print();
    }

    // =========================================================================
    // 13. EXCEL EXPORT
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
            ['الاسم', 'الجنس', 'الاختصاص', 'نوع البورد', 'المرحلة', 'نصاب ER', 'نصاب Con', 'نصاب DC', 'نصاب RS', 'الحالة', 'ملاحظات'],
            ...(state.residents || []).map(r => [
                r.name, r.sex, r.specialty, r.board, r.stage, r.er_target, r.con_target, r.dc_target, r.rs_target, r.active ? 'نشط' : 'متوقف', r.notes
            ])
        ];
        const wsDb = XLSX.utils.aoa_to_sheet(dbData);
        XLSX.utils.book_append_sheet(wb, wsDb, 'Residents_DB');

        XLSX.writeFile(wb, `جدول_خفارات_${state.hospitalId}_${state.month}_${state.year}.xlsx`);
        showNotification('تم تصدير ملف Excel بنجاح', 'success');
    }

    // =========================================================================
    // NOTIFICATIONS SYSTEM
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
    // EXPOSE TO WINDOW
    // =========================================================================

    window.EmergencyHub = {
        init: initEmergencyApp,
        getState: () => state,
        switchTab,
        onHospitalChange,
        onMonthYearChange,
        onOrderNumberChange,
        suggestSequentialOrderNumber,
        onRsDateChange,
        toggleRotatorsStrike,
        openDoctorPicker,
        closeDoctorPickerModal,
        filterPickerList,
        selectDoctorForSlot,
        clearActiveSlot,
        clearCellOnly,
        toggleShowInactiveInDB,
        inlineEditResidentNumber,
        inlineEditResidentField,
        cycleResidentBoard,
        cycleResidentSex,
        toggleResidentActive,
        deleteResident,
        downloadEmergencyDbJson,
        openExportResidentModal,
        closeExportResidentModal,
        confirmExportResidentToHospital,
        openHospitalSyncModal,
        closeHospitalSyncModal,
        syncDoctorNameSpelling,
        importSingleDoctorToER,
        importAllMissingDoctorsToER,
        openAddResidentModal,
        closeAddResidentModal,
        handleSaveNewResident,
        autoGenerateSchedule,
        prepareOfficialPrint,
        exportFullScheduleToExcel,
        resetEmergencyToDefaults
    };

    // Global direct aliases for inline HTML event handlers
    window.switchTab = switchTab;
    window.autoGenerateSchedule = autoGenerateSchedule;
    window.exportFullScheduleToExcel = exportFullScheduleToExcel;
    window.resetEmergencyToDefaults = resetEmergencyToDefaults;
    window.openDoctorPicker = openDoctorPicker;
    window.closeDoctorPickerModal = closeDoctorPickerModal;
    window.filterPickerList = filterPickerList;
    window.selectDoctorForSlot = selectDoctorForSlot;
    window.clearActiveSlot = clearActiveSlot;
    window.clearCellOnly = clearCellOnly;
    window.toggleRotatorsStrike = toggleRotatorsStrike;
    window.suggestSequentialOrderNumber = suggestSequentialOrderNumber;
    window.onHospitalChange = onHospitalChange;
    window.onMonthYearChange = onMonthYearChange;
    window.onOrderNumberChange = onOrderNumberChange;
    window.onRsDateChange = onRsDateChange;
    window.openHospitalSyncModal = openHospitalSyncModal;
    window.closeHospitalSyncModal = closeHospitalSyncModal;
    window.syncDoctorNameSpelling = syncDoctorNameSpelling;
    window.importSingleDoctorToER = importSingleDoctorToER;
    window.importAllMissingDoctorsToER = importAllMissingDoctorsToER;
    window.openExportResidentModal = openExportResidentModal;
    window.closeExportResidentModal = closeExportResidentModal;
    window.confirmExportResidentToHospital = confirmExportResidentToHospital;
    window.openAddResidentModal = openAddResidentModal;
    window.closeAddResidentModal = closeAddResidentModal;
    window.handleSaveNewResident = handleSaveNewResident;
    window.toggleShowInactiveInDB = toggleShowInactiveInDB;
    window.inlineEditResidentNumber = inlineEditResidentNumber;
    window.inlineEditResidentField = inlineEditResidentField;
    window.cycleResidentBoard = cycleResidentBoard;
    window.cycleResidentSex = cycleResidentSex;
    window.toggleResidentActive = toggleResidentActive;
    window.deleteResident = deleteResident;
    window.downloadEmergencyDbJson = downloadEmergencyDbJson;
    window.prepareOfficialPrint = prepareOfficialPrint;

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEmergencyApp);
    } else {
        initEmergencyApp();
    }

})(window);
