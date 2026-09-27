/**
 * EMERGENCY SHIFT & ON-CALL ROSTER MANAGEMENT SYSTEM
 * HOSP HUB — Full Implementation v3.0
 * Includes: Single A4 Ministerial Print, Direct DB Inline Editing, Expiry Month,
 * Stage Progression, ER Priority Auto-Distribution, Duty Conflict Resolution Modal,
 * Quota Picker Filter, DC Overlap Rules, and DB Color Coding System.
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
        orderNumber: '٤٨٢١',
        rsEnabled: true,
        rsStartDate: '2026-09-15',
        rsEndDate: '2026-09-20',
        headOfResidents: 'د. محمد راضي خضر',
        hospitalDirector: 'د. علي عبد معن',
        activeTab: 'er',
        showInactiveInDB: false,
        scheduleSearchQuery: '',
        scheduleShiftFilter: 'all',
        scheduleDayFilter: 'all',
        scheduleEmptyOnly: false,
        scheduleConflictOnly: false,
        scheduleDoctorFilter: '',
        residents: [],
        schedules: {
            er: [],
            con: [],
            dc: [],
            rs: []
        }
    };

    let activeSlot = null;
    let pendingAutoDistType = null;

    // Convert Western Arabic digits to Eastern Arabic numerals
    function toArabicDigits(str) {
        if (str === null || str === undefined) return '';
        const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        return String(str).replace(/[0-9]/g, d => digits[parseInt(d, 10)]);
    }

    function getDaysInMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    function getArabicDayName(year, month, day) {
        const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const d = new Date(year, month - 1, day);
        return days[d.getDay()];
    }

    function formatDateStr(year, month, day) {
        const m = String(month).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        return `${year}-${m}-${d}`;
    }

    function formatHospitalDateStr(year, month, day) {
        const m = String(month).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        return `${d}/${m}/${year}`;
    }

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

    // Check if resident is expired for the active month
    function isResidentExpired(res) {
        if (!res || !res.expiryMonth) return false;
        const currentMonthKey = `${state.year}-${String(state.month).padStart(2, '0')}`;
        return currentMonthKey >= res.expiryMonth;
    }

    // Check if resident is active and not expired
    function isResidentEligible(res) {
        return res && res.active && !isResidentExpired(res);
    }

    // =========================================================================
    // INITIALIZATION & STATE PERSISTENCE
    // =========================================================================

    async function initEmergencyApp() {
        console.log('Initializing Emergency System v3.0...');

        const saved = localStorage.getItem(STATE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                state = Object.assign(state, parsed);
            } catch (e) {
                console.warn('Failed to parse saved emergency state v3, falling back', e);
            }
        }

        if (!state.residents || state.residents.length === 0) {
            if (window.DEFAULT_EMERGENCY_DATA && window.DEFAULT_EMERGENCY_DATA.residents) {
                state.residents = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.residents));
                state.schedules = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.schedules));
                state.hospitalName = window.DEFAULT_EMERGENCY_DATA.hospitalName || state.hospitalName;
                state.monthYear = window.DEFAULT_EMERGENCY_DATA.monthYear || state.monthYear;
                state.orderNumber = window.DEFAULT_EMERGENCY_DATA.orderNumber || state.orderNumber;
                state.rsStartDate = window.DEFAULT_EMERGENCY_DATA.rsStartDate || state.rsStartDate;
                state.rsEndDate = window.DEFAULT_EMERGENCY_DATA.rsEndDate || state.rsEndDate;
                state.headOfResidents = window.DEFAULT_EMERGENCY_DATA.headOfResidents || state.headOfResidents;
                state.hospitalDirector = window.DEFAULT_EMERGENCY_DATA.hospitalDirector || state.hospitalDirector;
            }
        }

        // Try local fetch of emergency-db.json if not edited
        try {
            const resp = await fetch(DB_FILE);
            if (resp.ok) {
                const dbJson = await resp.json();
                if (dbJson && Array.isArray(dbJson.residents) && dbJson.residents.length > 0) {
                    if (!saved) {
                        state.residents = dbJson.residents;
                        state.headOfResidents = dbJson.headOfResidents || state.headOfResidents;
                        state.hospitalDirector = dbJson.hospitalDirector || state.hospitalDirector;
                    }
                }
            }
        } catch (err) {}

        ensureScheduleIntegrity();
        initHospitalSelector();
        syncMetaInputsWithState();
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
            state.orderNumber = window.DEFAULT_EMERGENCY_DATA.orderNumber || '٤٨٢١';
            state.rsEnabled = true;
            state.rsStartDate = window.DEFAULT_EMERGENCY_DATA.rsStartDate || '2026-09-15';
            state.rsEndDate = window.DEFAULT_EMERGENCY_DATA.rsEndDate || '2026-09-20';
            state.headOfResidents = window.DEFAULT_EMERGENCY_DATA.headOfResidents || 'د. محمد راضي خضر';
            state.hospitalDirector = window.DEFAULT_EMERGENCY_DATA.hospitalDirector || 'د. علي عبد معن';
        }
        ensureScheduleIntegrity();
        saveState();
        syncMetaInputsWithState();
        renderActiveTab();
        showNotification('تمت استعادة النسخة الأصلية بنجاح', 'success');
    }

    // =========================================================================
    // HOSPITAL SELECTOR & LEADERSHIP NAMES
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

    function suggestSequentialOrderNumber() {
        const rawDigits = String(state.orderNumber || '4820').replace(/[^\d]/g, '');
        const currentNum = parseInt(rawDigits, 10) || 4820;
        const nextNum = currentNum + 1;
        state.orderNumber = toArabicDigits(nextNum);
        const input = document.getElementById('meta-order-number');
        if (input) input.value = state.orderNumber;
        saveState();
        showNotification(`تم اقتراح الرقم الإداري: ${state.orderNumber}`, 'success');
    }

    function onRsDateChange(field, val) {
        state[field] = val;
        saveState();
        updateDutyDashboard();
        if (state.activeTab === 'rs_er' || state.activeTab === 'rs_wards') {
            renderActiveTab();
        }
    }

    function updateLeadershipName(field, val) {
        state[field] = val.trim();
        saveState();
        showNotification('تم تحديث الاسم المعتمد للأمر الإداري', 'success');
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
        showNotification(state.rsEnabled ? 'تم تفعيل إضراب الدوريين (RS)' : 'تم إخفاء إضراب الدوريين (RS)', 'info');
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

        if (rsSettingsBar) rsSettingsBar.style.display = state.rsEnabled ? 'flex' : 'none';
        if (rsErTabBtn) rsErTabBtn.style.display = state.rsEnabled ? 'flex' : 'none';
        if (rsWardsTabBtn) rsWardsTabBtn.style.display = state.rsEnabled ? 'flex' : 'none';
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

        const headOfResInput = document.getElementById('meta-head-residents');
        if (headOfResInput) headOfResInput.value = state.headOfResidents;

        const hospDirInput = document.getElementById('meta-hosp-director');
        if (hospDirInput) hospDirInput.value = state.hospitalDirector;
    }

    // =========================================================================
    // CONFLICT ENGINE & DC DUAL-CHECK LOGIC
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

        // 2. Consultation Clinic
        const conDay = (state.schedules.con || []).find(s => s.dayNumber === dayNumber);
        if (conDay && conDay.doctor && normalizeArabic(conDay.doctor) === cleanTarget) {
            duties.push({ type: 'con', slotKey: 'doctor', label: 'الاستشارية الخافرة' });
        }

        // 3. Death Certificates
        const dcDay = (state.schedules.dc || []).find(s => s.dayNumber === dayNumber);
        if (dcDay && dcDay.doctor && normalizeArabic(dcDay.doctor) === cleanTarget) {
            duties.push({ type: 'dc', slotKey: 'doctor', label: 'شهادات الوفاة' });
        }

        // 4. Rotators Strike
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

        // 5. Hospital On-Call Specialty Schedule
        const hospDuties = getHospitalDutiesForDoctor(doctorName, dateStr);
        hospDuties.forEach(hd => {
            duties.push({
                type: 'hospital_spec',
                slotKey: hd.specCode,
                label: `خفارة اختصاص في المستشفى (${hd.specName})`
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
     * Conflict Check for a specific cell:
     * - In Death Certificate (DC): Hospital specialty duty is ALLOWED and RECOMMENDED (green check).
     *   BUT if the doctor has other duties (ER, Con, RS), that is flagged as a real conflict!
     * - In other tables: Any other duty is a conflict.
     */
    function evaluateCellConflict(doctorName, dateStr, currentSlotType, currentSlotKey) {
        if (!doctorName || !doctorName.trim()) {
            return { hasConflict: false, isDcHospitalDuty: false, conflicts: [] };
        }

        const allDuties = getDoctorDutiesOnDate(doctorName, dateStr);
        const otherDuties = allDuties.filter(d => !(d.type === currentSlotType && d.slotKey === currentSlotKey));

        if (currentSlotType === 'dc') {
            const hospSpecDuty = otherDuties.find(d => d.type === 'hospital_spec');
            const otherShiftDuties = otherDuties.filter(d => d.type !== 'hospital_spec');

            // If has other shifts (ER, Con, RS), that is a conflict!
            if (otherShiftDuties.length > 0) {
                return {
                    hasConflict: true,
                    isDcHospitalDuty: !!hospSpecDuty,
                    hospDutyName: hospSpecDuty ? hospSpecDuty.label : '',
                    conflicts: otherShiftDuties
                };
            }

            // Only hospital duty: valid & green-flagged
            if (hospSpecDuty) {
                return {
                    hasConflict: false,
                    isDcHospitalDuty: true,
                    hospDutyName: hospSpecDuty.label,
                    conflicts: []
                };
            }

            return { hasConflict: false, isDcHospitalDuty: false, conflicts: [] };
        }

        const hasConflict = otherDuties.length > 0;
        return {
            hasConflict,
            isDcHospitalDuty: false,
            conflicts: otherDuties
        };
    }

    // =========================================================================
    // CONFLICT DETAILS MODAL (CLICK SHOWS DETAILS WITH EMPTY BUTTON)
    // =========================================================================

    function showConflictDetailsModal(tableType, dayNumber, slotKey, doctorName, dateStr, event) {
        if (event) event.stopPropagation();

        const conflictInfo = evaluateCellConflict(doctorName, dateStr, tableType, slotKey);
        let modal = document.getElementById('conflict-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'conflict-modal';
            modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-600 font-bold text-base">
                            ⚠️
                        </div>
                        <div>
                            <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">تنبيه تعارض خفارات</h3>
                            <p class="text-[11px] text-slate-500">${dateStr} · يوم ${getArabicDayName(state.year, state.month, dayNumber)}</p>
                        </div>
                    </div>
                    <button type="button" onclick="closeConflictModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div class="p-5 space-y-3 text-xs">
                    <div class="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60">
                        <div class="font-bold text-amber-900 dark:text-amber-200">الطبيب: <span class="text-rose-600 font-black text-sm">${doctorName}</span></div>
                        <div class="text-[11px] text-amber-800 dark:text-amber-300 mt-1">الخفارة الحالية: <strong>${getSlotHumanLabel(tableType, slotKey)}</strong></div>
                    </div>

                    <div>
                        <span class="font-bold text-slate-700 dark:text-slate-300 block mb-1.5">الخفارات الأخرى المسجلة للطبيب في نفس اليوم:</span>
                        <ul class="space-y-1">
                            ${conflictInfo.conflicts.map(c => `
                                <li class="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center gap-2 font-bold text-rose-600">
                                    <i class="fas fa-circle-exclamation text-[10px]"></i>
                                    <span>${c.label}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>

                    <p class="text-[11px] text-slate-500">
                        يمكنك إفراغ الخلية الحالية لإزالة التعارض، أو الإبقاء عليها في حال كان التداخل مقصوداً.
                    </p>
                </div>

                <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                    <button type="button" onclick="closeConflictModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                        إلغاء
                    </button>
                    <button type="button" onclick="confirmClearConflictCell('${tableType}', ${dayNumber}, '${slotKey}')" class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 transition flex items-center gap-1.5">
                        <i class="fas fa-trash-can"></i>
                        <span>إفراغ هذه الخانة في هذا الجدول</span>
                    </button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeConflictModal() {
        const modal = document.getElementById('conflict-modal');
        if (modal) modal.classList.add('hidden');
    }

    function confirmClearConflictCell(tableType, dayNumber, slotKey) {
        const dayEntry = (state.schedules[tableType] || []).find(s => s.dayNumber === dayNumber);
        if (dayEntry) {
            dayEntry[slotKey] = '';
            delete dayEntry[slotKey + '_outsidePref'];
            saveState();
            renderActiveTab();
            closeConflictModal();
            showNotification('تم إفراغ الخلية بنجاح', 'info');
        }
    }

    // =========================================================================
    // MONTHLY DUTY DASHBOARD & COLOR SYSTEM
    // =========================================================================

    function updateDutyDashboard() {
        const daysCount = getDaysInMonth(state.year, state.month);

        const activeDocs = (state.residents || []).filter(r => isResidentEligible(r));
        const totalDocsCount = (state.residents || []).length;
        const totalDocEl = document.getElementById('stat-total-doctors');
        if (totalDocEl) totalDocEl.textContent = `${activeDocs.length} / ${totalDocsCount}`;

        // Counts
        const erRequired = daysCount * 4;
        const erAllocated = (state.residents || []).reduce((sum, r) => sum + (isResidentEligible(r) ? (Number(r.er_target) || 0) : 0), 0);
        let erScheduled = 0;
        (state.schedules.er || []).forEach(day => {
            if (day.morning && day.morning.trim()) erScheduled++;
            if (day.afternoon && day.afternoon.trim()) erScheduled++;
            if (day.preNight && day.preNight.trim()) erScheduled++;
            if (day.lateNight && day.lateNight.trim()) erScheduled++;
        });

        const conRequired = daysCount * 1;
        const conAllocated = (state.residents || []).reduce((sum, r) => sum + (isResidentEligible(r) ? (Number(r.con_target) || 0) : 0), 0);
        let conScheduled = 0;
        (state.schedules.con || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) conScheduled++;
        });

        const dcRequired = daysCount * 1;
        const dcAllocated = (state.residents || []).reduce((sum, r) => sum + (isResidentEligible(r) ? (Number(r.dc_target) || 0) : 0), 0);
        let dcScheduled = 0;
        (state.schedules.dc || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) dcScheduled++;
        });

        let rsDaysCount = 0;
        let rsErScheduled = 0;
        let rsWardsScheduled = 0;
        let rsAllocated = (state.residents || []).reduce((sum, r) => sum + (isResidentEligible(r) ? (Number(r.rs_target) || 0) : 0), 0);

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
                return `<span class="text-emerald-600 font-bold">مطابق (${allocated})</span>`;
            } else if (diff < 0) {
                return `<span class="text-rose-500 font-bold">عجز (${allocated}/${required})</span>`;
            } else {
                return `<span class="text-amber-500 font-bold">فائض (${allocated}/${required})</span>`;
            }
        };

        container.innerHTML = `
            <div class="glass-panel rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 hover:border-rose-300 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-rose-600">
                        <i class="fas fa-truck-medical"></i>
                        <span>خفارات الطوارئ (ER)</span>
                    </span>
                    ${makeBalancePill(erScheduled, erRequired)}
                </div>
                <div class="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mt-2">
                    ${erScheduled} <span class="text-xs font-normal text-slate-400">/ ${erRequired} مطلوب</span>
                </div>
                <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>الأنصبة المخصصة:</span>
                    ${makeAllocatedPill(erAllocated, erRequired)}
                </div>
            </div>

            <div class="glass-panel rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 hover:border-sky-300 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-sky-600">
                        <i class="fas fa-stethoscope"></i>
                        <span>الاستشارية الخافرة (Con)</span>
                    </span>
                    ${makeBalancePill(conScheduled, conRequired)}
                </div>
                <div class="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mt-2">
                    ${conScheduled} <span class="text-xs font-normal text-slate-400">/ ${conRequired} مطلوب</span>
                </div>
                <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>الأنصبة المخصصة:</span>
                    ${makeAllocatedPill(conAllocated, conRequired)}
                </div>
            </div>

            <div class="glass-panel rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-emerald-600">
                        <i class="fas fa-file-medical"></i>
                        <span>شهادات الوفاة (DC)</span>
                    </span>
                    ${makeBalancePill(dcScheduled, dcRequired)}
                </div>
                <div class="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mt-2">
                    ${dcScheduled} <span class="text-xs font-normal text-slate-400">/ ${dcRequired} مطلوب</span>
                </div>
                <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>الأنصبة المخصصة:</span>
                    ${makeAllocatedPill(dcAllocated, dcRequired)}
                </div>
            </div>

            ${state.rsEnabled ? `
            <div class="glass-panel rounded-2xl p-3.5 border border-amber-200/80 dark:border-amber-900/60 bg-amber-500/5 transition shadow-sm">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black flex items-center gap-1.5 text-amber-600">
                        <i class="fas fa-bed-pulse"></i>
                        <span>إضراب الدوريين (RS)</span>
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

        const totalFilledEl = document.getElementById('stat-total-filled');
        if (totalFilledEl) {
            const grandTotalFilled = erScheduled + conScheduled + dcScheduled + (state.rsEnabled ? (rsErScheduled + rsWardsScheduled) : 0);
            const grandTotalRequired = erRequired + conRequired + dcRequired + (state.rsEnabled ? (rsDaysCount * 7) : 0);
            totalFilledEl.textContent = `${grandTotalFilled} / ${grandTotalRequired}`;
        }
    }

    // =========================================================================
    // SCHEDULE SEARCH & FILTERING BAR
    // =========================================================================

    function renderScheduleFilterBar(type) {
        const eligibleDocs = (state.residents || [])
            .filter(r => isResidentEligible(r))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

        return `
            <div class="p-3 mb-4 rounded-2xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs no-print">
                <div class="flex items-center gap-2 flex-1 min-w-[220px]">
                    <div class="relative w-full max-w-xs">
                        <i class="fas fa-search absolute right-3 top-2.5 text-slate-400 text-xs"></i>
                        <input type="text" id="sched-search-input" value="${escapeForInline(state.scheduleSearchQuery)}" 
                            oninput="applyScheduleLiveFilter(this.value)" 
                            placeholder="بحث باسم الطبيب في الجدول..." 
                            class="w-full pr-8 pl-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20 text-xs font-bold">
                    </div>
                    ${state.scheduleSearchQuery ? `
                        <button type="button" onclick="clearScheduleSearch()" class="text-slate-400 hover:text-rose-600 px-1.5 py-1" title="مسح البحث">
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

                    <!-- Shift Filter (For ER & RS-ER) -->
                    ${type === 'er' || type === 'rs_er' ? `
                    <select id="sched-shift-filter" onchange="onScheduleShiftFilter(this.value)" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                        <option value="all" ${state.scheduleShiftFilter === 'all' ? 'selected' : ''}>كافة الوجبات</option>
                        <option value="morning" ${state.scheduleShiftFilter === 'morning' ? 'selected' : ''}>الصباحية فقط (8ص - 2م)</option>
                        <option value="afternoon" ${state.scheduleShiftFilter === 'afternoon' ? 'selected' : ''}>بعد الصباحية فقط (2م - 8م)</option>
                        <option value="preNight" ${state.scheduleShiftFilter === 'preNight' ? 'selected' : ''}>البرينايت فقط (8م - 2ص)</option>
                        <option value="lateNight" ${state.scheduleShiftFilter === 'lateNight' ? 'selected' : ''}>الليلية فقط (2ص - 8ص)</option>
                    </select>
                    ` : ''}

                    <!-- Day of Week Filter -->
                    <select id="sched-day-filter" onchange="onScheduleDayFilter(this.value)" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                        <option value="all" ${state.scheduleDayFilter === 'all' ? 'selected' : ''}>جميع الأيام</option>
                        <option value="weekday" ${state.scheduleDayFilter === 'weekday' ? 'selected' : ''}>أيام الدوام الرسمي (أحد - خميس)</option>
                        <option value="weekend" ${state.scheduleDayFilter === 'weekend' ? 'selected' : ''}>عطل نهاية الأسبوع (جمعة وسبت)</option>
                        <option value="friday" ${state.scheduleDayFilter === 'friday' ? 'selected' : ''}>الجمعة فقط</option>
                        <option value="saturday" ${state.scheduleDayFilter === 'saturday' ? 'selected' : ''}>السبت فقط</option>
                    </select>

                    <!-- Empty Slots Only Toggle -->
                    <label class="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 select-none text-xs font-bold">
                        <input type="checkbox" id="sched-empty-filter" ${state.scheduleEmptyOnly ? 'checked' : ''} onchange="onScheduleEmptyToggle(this.checked)" class="rounded text-rose-600">
                        <span>شواغر فارغة</span>
                    </label>

                    <!-- Conflict Slots Only Toggle -->
                    <label class="flex items-center gap-1.5 cursor-pointer text-amber-700 dark:text-amber-400 select-none text-xs font-bold">
                        <input type="checkbox" id="sched-conflict-filter" ${state.scheduleConflictOnly ? 'checked' : ''} onchange="onScheduleConflictToggle(this.checked)" class="rounded text-amber-600">
                        <span>التعارضات فقط</span>
                    </label>

                    <!-- Reset Filters Button -->
                    <button type="button" onclick="resetScheduleFilters()" class="text-xs text-rose-600 hover:underline font-bold px-1 py-0.5">
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
        const searchInput = document.getElementById('sched-search-input');
        if (searchInput) {
            searchInput.value = val;
        }
        applyScheduleLiveFilter(val);
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

    function resetScheduleFilters() {
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

    // High performance live DOM filter for schedule table
    function applyScheduleLiveFilter(queryVal) {
        state.scheduleSearchQuery = (queryVal !== undefined ? queryVal : (document.getElementById('sched-search-input')?.value || '')).trim();
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
            if (state.scheduleDayFilter === 'friday' && dayName !== 'الجمعة') { tr.style.display = 'none'; return; }
            if (state.scheduleDayFilter === 'saturday' && dayName !== 'السبت') { tr.style.display = 'none'; return; }

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

                // Shift-specific filter check
                const isShiftEligible = state.scheduleShiftFilter === 'all' || state.scheduleShiftFilter === slotKey;

                // Name highlight matching
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

            // 2. Empty only filter
            if (state.scheduleEmptyOnly && !hasEmpty) { tr.style.display = 'none'; return; }

            // 3. Conflict only filter
            if (state.scheduleConflictOnly && !hasConflict) { tr.style.display = 'none'; return; }

            // 4. Shift filter: if specific shift selected, check if that shift cell has a doctor assigned
            if (state.scheduleShiftFilter !== 'all') {
                const targetTd = tr.querySelector(`td[data-slot="${state.scheduleShiftFilter}"]`);
                if (!targetTd) { tr.style.display = 'none'; return; }
            }

            // 5. Query matching: must match doctor name in eligible slot OR day name OR date
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

        // Update live counter badge
        const badge = document.getElementById('sched-filter-count-badge');
        if (badge) {
            const hasAnyActiveFilter = cleanQ || state.scheduleShiftFilter !== 'all' || state.scheduleDayFilter !== 'all' || state.scheduleEmptyOnly || state.scheduleConflictOnly;
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
    // TAB VIEWS WITH SEPARATE AUTO-BUTTONS
    // =========================================================================

    function switchTab(tabId) {
        state.activeTab = tabId;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const isTarget = btn.getAttribute('data-tab') === tabId;
            btn.className = isTarget 
                ? 'tab-btn active-tab flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 bg-rose-600 text-white shadow-sm'
                : 'tab-btn flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900';
        });
        renderActiveTab();
    }

    function renderActiveTab() {
        const container = document.getElementById('schedule-view-container');
        if (!container) return;

        switch (state.activeTab) {
            case 'er': renderERView(container); break;
            case 'con': renderConView(container); break;
            case 'dc': renderDCView(container); break;
            case 'rs_er': renderRSERView(container); break;
            case 'rs_wards': renderRSWardsView(container); break;
            case 'db': renderDBView(container); break;
            default: renderERView(container);
        }
    }

    // 1. ER SCHEDULE VIEW
    // =========================================================================

    function renderERView(container) {
        const shifts = [
            { key: 'morning', label: 'الصباحية (8ص - 2م)', icon: 'fa-sun', color: 'text-amber-500' },
            { key: 'afternoon', label: 'بعد الصباحية (2م - 8م)', icon: 'fa-cloud-sun', color: 'text-orange-500' },
            { key: 'preNight', label: 'البرينايت (8م - 2ص)', icon: 'fa-moon', color: 'text-indigo-500' },
            { key: 'lateNight', label: 'الليلية (2ص - 8ص)', icon: 'fa-star-and-crescent', color: 'text-purple-500' }
        ];

        const allDays = state.schedules.er || [];

        let html = `
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-truck-medical text-rose-600"></i>
                        <span>جدول خفارات قسم الطوارئ (ER)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">4 وجبات خفارة يومياً · المقيمين الأقدمين</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="startAutoDistribution('er')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توزيع خفارات الطوارئ آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (صفحة واحدة)</span>
                    </button>
                </div>
            </div>

            ${renderScheduleFilterBar('er')}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-36 font-bold cursor-pointer hover:text-rose-600 transition" onclick="quickFilterByShift('all')" title="إعادة عرض كل الورديات">
                                <span>اليوم والتاريخ</span>
                            </th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-rose-600 transition" onclick="quickFilterByShift('morning')" title="انقر لتصفية الوجبة الصباحية">
                                <span class="flex items-center gap-1.5">
                                    <i class="fas fa-sun text-amber-500"></i>
                                    <span>الصباحية (8ص - 2م)</span>
                                    <i class="fas fa-filter text-[10px] opacity-40 ml-auto"></i>
                                </span>
                            </th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-rose-600 transition" onclick="quickFilterByShift('afternoon')" title="انقر لتصفية وجبة بعد الصباحية">
                                <span class="flex items-center gap-1.5">
                                    <i class="fas fa-cloud-sun text-orange-500"></i>
                                    <span>بعد الصباحية (2م - 8م)</span>
                                    <i class="fas fa-filter text-[10px] opacity-40 ml-auto"></i>
                                </span>
                            </th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-rose-600 transition" onclick="quickFilterByShift('preNight')" title="انقر لتصفية وجبة البرينايت">
                                <span class="flex items-center gap-1.5">
                                    <i class="fas fa-moon text-indigo-500"></i>
                                    <span>البرينايت (8م - 2ص)</span>
                                    <i class="fas fa-filter text-[10px] opacity-40 ml-auto"></i>
                                </span>
                            </th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-rose-600 transition" onclick="quickFilterByShift('lateNight')" title="انقر لتصفية الوجبة الليلية">
                                <span class="flex items-center gap-1.5">
                                    <i class="fas fa-star-and-crescent text-purple-500"></i>
                                    <span>الليلية (2ص - 8ص)</span>
                                    <i class="fas fa-filter text-[10px] opacity-40 ml-auto"></i>
                                </span>
                            </th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        if (allDays.length === 0) {
            html += `
                <tr>
                    <td colspan="6" class="py-12 text-center text-slate-400">
                        <i class="fas fa-calendar-xmark text-3xl mb-2 block"></i>
                        لا توجد أيام مولدة لهذا الشهر حتى الآن
                    </td>
                </tr>
            `;
        } else {
            allDays.forEach(day => {
                const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
                html += `
                    <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}" 
                        data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}">
                        <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-400">${day.dayNumber}</td>
                        <td class="py-2.5 px-3 whitespace-nowrap">
                            <div class="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>${day.dayName}</span>
                                ${isWeekend ? '<span class="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-bold dark:bg-amber-950 dark:text-amber-300">عطلة</span>' : ''}
                            </div>
                            <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                        </td>
                        ${shifts.map(s => renderShiftCellHTML('er', day.dayNumber, day.date, s.key, day[s.key], day[s.key + '_outsidePref'])).join('')}
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
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    // 2. CON VIEW
    // =========================================================================

    function renderConView(container) {
        const allDays = state.schedules.con || [];

        let html = `
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-stethoscope text-sky-600"></i>
                        <span>جدول خفارات الاستشارية الخافرة (Con)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">طبيب مقيم أقدم واحد يومياً</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="startAutoDistribution('con')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توزيع خفارات الاستشارية آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('con')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية</span>
                    </button>
                </div>
            </div>

            ${renderScheduleFilterBar('con')}

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

        allDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            html += `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}" 
                    data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <span>${day.dayName}</span>
                            ${isWeekend ? '<span class="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-bold dark:bg-amber-950 dark:text-amber-300">عطلة</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
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
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    // 3. DC VIEW
    // =========================================================================

    function renderDCView(container) {
        const allDays = state.schedules.dc || [];

        let html = `
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="fas fa-file-medical text-emerald-600"></i>
                        <span>جدول خفارات شهادات الوفاة (DC)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">طبيب واحد يومياً · يسمح بالتداخل مع خفارات المستشفى التخصصية فقط (أخضر)</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="startAutoDistribution('dc')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توزيع خفارات الوفيات آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('dc')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية</span>
                    </button>
                </div>
            </div>

            ${renderScheduleFilterBar('dc')}

            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-3xl">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-3 px-3 w-14 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-36 font-bold">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold">طبيب شهادات الوفاة المكلف</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        allDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            html += `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${isWeekend ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}" 
                    data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <span>${day.dayName}</span>
                            ${isWeekend ? '<span class="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-bold dark:bg-amber-950 dark:text-amber-300">عطلة</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                    </td>
                    ${renderShiftCellHTML('dc', day.dayNumber, day.date, 'doctor', day.doctor)}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    // =========================================================================

    function renderRSERView(container) {
        const shifts = [
            { key: 'er_morning', label: 'الصباحية (8ص - 2م)', icon: 'fa-sun', color: 'text-amber-500' },
            { key: 'er_afternoon', label: 'بعد الصباحية (2م - 8م)', icon: 'fa-cloud-sun', color: 'text-orange-500' },
            { key: 'er_preNight', label: 'البرينايت (8م - 2ص)', icon: 'fa-moon', color: 'text-indigo-500' },
            { key: 'er_lateNight', label: 'الليلية (2ص - 8ص)', icon: 'fa-star-and-crescent', color: 'text-purple-500' }
        ];

        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        const allDays = state.schedules.rs || [];

        let html = `
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <i class="fas fa-truck-medical text-amber-600"></i>
                        <span>جدول إضراب المقيمين الدوريين - قسم الطوارئ (RS - ER)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        الفترة: من ${state.rsStartDate} إلى ${state.rsEndDate} · إسناد وجبات الطوارئ
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="startAutoDistribution('rs_er')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توزيع إضراب الطوارئ آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('rs_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (RS-ER)</span>
                    </button>
                </div>
            </div>

            ${renderScheduleFilterBar('rs_er')}

            <div class="overflow-x-auto rounded-2xl border border-amber-200 dark:border-amber-900/60 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-amber-100/60 dark:bg-amber-950/30 border-b border-amber-200 text-slate-800 dark:text-slate-200">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-36 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('all')">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('er_morning')">الصباحية (8ص - 2م)</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('er_afternoon')">بعد الصباحية (2م - 8م)</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('er_preNight')">البرينايت (8م - 2ص)</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('er_lateNight')">الليلية (2ص - 8ص)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        allDays.forEach(day => {
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            html += `
                <tr class="hover:bg-amber-50/80 dark:hover:bg-amber-950/40 transition ${inRsPeriod ? 'bg-amber-50/40 dark:bg-amber-950/20' : 'opacity-40'}" 
                    data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <span>${day.dayName}</span>
                            ${inRsPeriod ? '<span class="text-[9px] px-1 py-0.2 rounded bg-amber-200 text-amber-900 font-bold dark:bg-amber-900 dark:text-amber-200">إضراب</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                    </td>
                    ${shifts.map(s => renderShiftCellHTML('rs_er', day.dayNumber, day.date, s.key, day[s.key])).join('')}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    // =========================================================================

    function renderRSWardsView(container) {
        const shifts = [
            { key: 'ward_private', label: 'الجناح الخاص' },
            { key: 'ward_floor4', label: 'الجناح العام / طابق 4' },
            { key: 'ward_floor5', label: 'الجناح العام / طابق 5' }
        ];

        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        const allDays = state.schedules.rs || [];

        let html = `
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                    <h2 class="text-base font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <i class="fas fa-bed-pulse text-amber-600"></i>
                        <span>جدول إضراب المقيمين الدوريين - الردهات والأجنحة (RS - Wards)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                        الفترة: من ${state.rsStartDate} إلى ${state.rsEndDate} · إسناد خفارات الردهات
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="startAutoDistribution('rs_wards')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توزيع إضراب الردهات آلياً</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('rs_wards')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (RS-Wards)</span>
                    </button>
                </div>
            </div>

            ${renderScheduleFilterBar('rs_wards')}

            <div class="overflow-x-auto rounded-2xl border border-amber-200 dark:border-amber-900/60 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-amber-100/60 dark:bg-amber-950/30 border-b border-amber-200 text-slate-800 dark:text-slate-200">
                            <th class="py-3 px-3 w-12 text-center font-bold">#</th>
                            <th class="py-3 px-3 w-36 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('all')">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('ward_private')">الجناح الخاص</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('ward_floor4')">الجناح العام / طابق 4</th>
                            <th class="py-3 px-3 font-bold cursor-pointer hover:text-amber-600" onclick="quickFilterByShift('ward_floor5')">الجناح العام / طابق 5</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        allDays.forEach(day => {
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            html += `
                <tr class="hover:bg-amber-50/80 dark:hover:bg-amber-950/40 transition ${inRsPeriod ? 'bg-amber-50/40 dark:bg-amber-950/20' : 'opacity-40'}" 
                    data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <span>${day.dayName}</span>
                            ${inRsPeriod ? '<span class="text-[9px] px-1 py-0.2 rounded bg-amber-200 text-amber-900 font-bold dark:bg-amber-900 dark:text-amber-200">إضراب</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 font-mono">${day.date}</div>
                    </td>
                    ${shifts.map(s => renderShiftCellHTML('rs_wards', day.dayNumber, day.date, s.key, day[s.key])).join('')}
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
        applyScheduleLiveFilter(state.scheduleSearchQuery);
    }

    // =========================================================================
    // CELL RENDERER WITH PREFERENCE MARK & CONFLICT MODAL TRIGGER
    // =========================================================================

    function renderShiftCellHTML(tableType, dayNumber, dateStr, slotKey, assignedDoctor, outsidePref) {
        if (!assignedDoctor || !assignedDoctor.trim()) {
            return `
                <td class="py-2 px-3" data-slot="${slotKey}" data-doc="" data-conflict="false" data-outside-pref="false">
                    <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" 
                        class="w-full text-right py-1.5 px-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-400 text-slate-400 hover:text-rose-600 text-[11px] transition flex items-center justify-between group">
                        <span>+ تعيين</span>
                        <i class="fas fa-plus text-[10px] opacity-0 group-hover:opacity-100 transition"></i>
                    </button>
                </td>
            `;
        }

        const conflictInfo = evaluateCellConflict(assignedDoctor, dateStr, tableType, slotKey);

        let badgeHTML = '';
        if (tableType === 'dc' && conflictInfo.isDcHospitalDuty && !conflictInfo.hasConflict) {
            badgeHTML = `
                <span class="inline-flex items-center text-emerald-600 ml-1" title="طبيب خافر في المستشفى بنفس اليوم (${conflictInfo.hospDutyName}) - موصى به لشهادات الوفاة">
                    <i class="fas fa-circle-check text-xs"></i>
                </span>
            `;
        } else if (conflictInfo.hasConflict) {
            badgeHTML = `
                <button type="button" 
                    onclick="showConflictDetailsModal('${tableType}', ${dayNumber}, '${slotKey}', '${escapeForInline(assignedDoctor)}', '${dateStr}', event)"
                    title="⚠️ تعارض خفارة! انقر لعرض التفاصيل وخيار الإفراغ"
                    class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 hover:bg-rose-100 text-amber-700 hover:text-rose-700 text-[10px] font-black transition ml-1 shadow-xs">
                    ⚠️
                </button>
            `;
        }

        let outsidePrefHTML = '';
        if (outsidePref) {
            outsidePrefHTML = `
                <button type="button" onclick="alert('تم تعيين هذه الخفارة خارج رغبة الطبيب المحددة لعدم توفر شواغر مطابقة في جدول الشهر.')" 
                    title="تم التعيين خارج رغبة الطبيب (انقر للتوضيح)" class="text-blue-500 hover:text-blue-700 ml-1 text-[11px]">
                    <i class="fas fa-circle-info"></i>
                </button>
            `;
        }

        return `
            <td class="py-2 px-3" data-slot="${slotKey}" data-doc="${escapeForInline(assignedDoctor)}" data-conflict="${conflictInfo.hasConflict ? 'true' : 'false'}" data-outside-pref="${outsidePref ? 'true' : 'false'}">
                <div class="flex items-center justify-between group py-1 px-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 hover:border-slate-400 transition">
                    <div class="flex items-center truncate cursor-pointer flex-1" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')">
                        <span class="doc-name-span font-bold text-slate-800 dark:text-slate-100 truncate">${assignedDoctor}</span>
                        ${badgeHTML}
                        ${outsidePrefHTML}
                    </div>
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition no-print">
                        <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center" title="تعديل">
                            <i class="fas fa-pencil text-[10px]"></i>
                        </button>
                        <button type="button" onclick="confirmClearConflictCell('${tableType}', ${dayNumber}, '${slotKey}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center" title="إفراغ الخلية">
                            <i class="fas fa-times text-[10px]"></i>
                        </button>
                    </div>
                </div>
            </td>
        `;
    }

    // 6. RESIDENT DATABASE TAB (DB) WITH DIRECT INLINE EDITING & COLOR CODING
    // =========================================================================

    function renderDBView(container) {
        // Precompute fulfilled quotas for all residents across schedules
        const scheduledCounts = computeAllScheduledDutiesPerDoctor();

        // Categorize into Active and Inactive
        const allResidents = state.residents || [];
        const activeList = allResidents.filter(r => isResidentEligible(r));
        const inactiveList = allResidents.filter(r => !isResidentEligible(r));

        let html = `
            <div class="space-y-4">
                <!-- Header Actions -->
                <div class="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <div>
                        <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <i class="fas fa-users-gear text-rose-600"></i>
                            <span>قاعدة المقيمين الأقدمين والأنصبة (DB)</span>
                        </h2>
                        <p class="text-xs text-slate-500 mt-0.5">
                            التعديل مباشر فورياً في الجدول بدون نوافذ تأكيد · التعديل يطبق فور مغادرة الحقل
                        </p>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <button type="button" onclick="advanceBoardResidentsStage()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition flex items-center gap-1.5">
                            <i class="fas fa-graduation-cap"></i>
                            <span>ترفيع مرحلة أطباء البورد (سنة واحدة) 🎓</span>
                        </button>

                        <button type="button" onclick="toggleShowInactiveInDB()" class="px-3 py-1.5 rounded-xl text-xs font-bold ${state.showInactiveInDB ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'} hover:bg-slate-200 transition flex items-center gap-1.5">
                            <i class="fas ${state.showInactiveInDB ? 'fa-eye-slash' : 'fa-eye'}"></i>
                            <span>${state.showInactiveInDB ? 'إخفاء غير النشطين' : `إظهار غير النشطين (${inactiveList.length})`}</span>
                        </button>

                        <button type="button" onclick="openHospitalSyncModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 transition flex items-center gap-1.5">
                            <i class="fas fa-arrows-rotate"></i>
                            <span>مطابقة مع المستشفى</span>
                        </button>

                        <button type="button" onclick="openAddResidentModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                            <i class="fas fa-user-plus"></i>
                            <span>إضافة مقيم</span>
                        </button>

                        <button type="button" onclick="downloadEmergencyDbJson()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                            <i class="fas fa-download text-emerald-500"></i>
                            <span>حفظ JSON</span>
                        </button>
                    </div>
                </div>

                <!-- Leadership Names Settings Bar -->
                <div class="p-3 rounded-2xl bg-slate-100/60 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3 text-xs">
                    <span class="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <i class="fas fa-signature text-rose-500"></i>
                        <span>الأسماء المعتمدة للأمر الإداري والطباعة:</span>
                    </span>
                    <div class="flex items-center gap-3 flex-wrap flex-1 max-w-2xl justify-end">
                        <div class="flex items-center gap-1.5">
                            <label class="text-[11px] font-bold text-slate-500">رئيس الأطباء المقيمين:</label>
                            <input type="text" id="meta-head-residents" value="${escapeForInline(state.headOfResidents)}" onchange="updateLeadershipName('headOfResidents', this.value)" class="text-xs font-bold px-2 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-44">
                        </div>
                        <div class="flex items-center gap-1.5">
                            <label class="text-[11px] font-bold text-slate-500">مدير المستشفى:</label>
                            <input type="text" id="meta-hosp-director" value="${escapeForInline(state.hospitalDirector)}" onchange="updateLeadershipName('hospitalDirector', this.value)" class="text-xs font-bold px-2 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-44">
                        </div>
                    </div>
                </div>

                <!-- HEADER PARAMETER FILTERS BAR (REAL-TIME NO FOCUS LOSS) -->
                <div class="p-3 rounded-2xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs no-print">
                    <div class="relative flex-1 min-w-[200px]">
                        <i class="fas fa-search absolute right-3 top-2.5 text-slate-400 text-xs"></i>
                        <input type="text" id="db-search-input" oninput="applyDBLiveFilter()" placeholder="بحث باسم المقيم أو الاختصاص..." class="w-full pr-8 pl-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs focus:ring-2 focus:ring-rose-500/20 font-bold">
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <!-- Sex Filter -->
                        <select id="db-filter-sex" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">الجنس: الكل</option>
                            <option value="M">ذكور فقط</option>
                            <option value="F">إناث فقط</option>
                        </select>

                        <!-- Board Filter -->
                        <select id="db-filter-board" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">البورد: الكل</option>
                            <option value="Iraqi">بورد عراقي</option>
                            <option value="Arabic">بورد عربي</option>
                            <option value="None">بدون بورد</option>
                        </select>

                        <!-- Stage Filter -->
                        <select id="db-filter-stage" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">المرحلة: الكل</option>
                            <option value="الأولى">المرحلة الأولى</option>
                            <option value="الثانية">المرحلة الثانية</option>
                            <option value="الثالثة">المرحلة الثالثة</option>
                            <option value="الرابعة">المرحلة الرابعة</option>
                            <option value="الخامسة">المرحلة الخامسة</option>
                            <option value="السادسة">المرحلة السادسة</option>
                            <option value="بدون">بدون مرحلة</option>
                        </select>

                        <!-- Quota Fulfillment Filter -->
                        <select id="db-filter-quota" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">حالة النصاب: الكل</option>
                            <option value="fulfilled">مكتمل النصاب (أخضر)</option>
                            <option value="unfulfilled">غير مكتمل (أحمر)</option>
                            <option value="has_rs">لديه خفارات إسناد RS (برتقالي)</option>
                        </select>

                        <button type="button" onclick="resetDBFilters()" class="text-xs text-rose-600 font-bold hover:underline px-1 py-0.5">
                            إعادة ضبط
                        </button>

                        <span id="db-filter-count-badge" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            ${activeList.length} مقيم
                        </span>
                    </div>
                </div>

                <!-- Color Legend -->
                <div class="flex items-center gap-4 text-xs font-bold px-1">
                    <span class="flex items-center gap-1.5 text-emerald-600">
                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> مكتمل النصاب
                    </span>
                    <span class="flex items-center gap-1.5 text-rose-600">
                        <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> غير مكتمل النصاب
                    </span>
                    <span class="flex items-center gap-1.5 text-amber-600">
                        <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> لديه خفارات إسناد (RS)
                    </span>
                </div>

                <!-- 1. ACTIVE RESIDENTS TABLE -->
                <div>
                    <h3 class="text-xs font-black text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
                        <span>الأطباء النشطون المشمولون بالخفارات (${activeList.length})</span>
                    </h3>
                    ${renderResidentSubTable(activeList, scheduledCounts, true)}
                </div>

                <!-- 2. INACTIVE RESIDENTS ISOLATED SECTION (SHOWN ONLY IF TOGGLED ON) -->
                ${state.showInactiveInDB ? `
                <div class="mt-8 pt-4 border-t-2 border-dashed border-slate-300 dark:border-slate-700 space-y-2">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-xs font-black text-slate-500 flex items-center gap-2">
                                <i class="fas fa-user-slash text-slate-400"></i>
                                <span>الأطباء غير النشطين / المتوقفون عن الخفارات (${inactiveList.length})</span>
                            </h3>
                            <p class="text-[11px] text-slate-400 mt-0.5">أنصبتهم صفر ومستبعدون من الجداول التلقائية وقوائم الاختيار</p>
                        </div>
                    </div>
                    ${renderResidentSubTable(inactiveList, scheduledCounts, false)}
                </div>
                ` : ''}
            </div>
        `;

        container.innerHTML = html;
        applyDBLiveFilter();
    }

    function applyDBLiveFilter() {
        const searchVal = document.getElementById('db-search-input')?.value || '';
        const cleanQ = normalizeArabic(searchVal).toLowerCase();

        const sexFilter = document.getElementById('db-filter-sex')?.value || 'all';
        const boardFilter = document.getElementById('db-filter-board')?.value || 'all';
        const stageFilter = document.getElementById('db-filter-stage')?.value || 'all';
        const quotaFilter = document.getElementById('db-filter-quota')?.value || 'all';

        const rows = document.querySelectorAll('#schedule-view-container tr[data-resident-id]');
        let count = 0;

        rows.forEach(tr => {
            const name = tr.getAttribute('data-name') || '';
            const specialty = tr.getAttribute('data-specialty') || '';
            const sex = tr.getAttribute('data-sex') || '';
            const board = tr.getAttribute('data-board') || '';
            const stage = tr.getAttribute('data-stage') || '';
            const quotaStatus = tr.getAttribute('data-quota-status') || '';
            const hasRs = tr.getAttribute('data-has-rs') === 'true';

            // 1. Text Search (name or specialty)
            if (cleanQ) {
                const matchesText = normalizeArabic(name).toLowerCase().includes(cleanQ) || specialty.toLowerCase().includes(cleanQ);
                if (!matchesText) { tr.style.display = 'none'; return; }
            }

            // 2. Sex filter
            if (sexFilter !== 'all' && sex !== sexFilter) { tr.style.display = 'none'; return; }

            // 3. Board filter
            if (boardFilter !== 'all' && board !== boardFilter) { tr.style.display = 'none'; return; }

            // 4. Stage filter
            if (stageFilter !== 'all' && stage !== stageFilter) { tr.style.display = 'none'; return; }

            // 5. Quota Status filter
            if (quotaFilter === 'fulfilled' && quotaStatus !== 'fulfilled') { tr.style.display = 'none'; return; }
            if (quotaFilter === 'unfulfilled' && quotaStatus !== 'unfulfilled') { tr.style.display = 'none'; return; }
            if (quotaFilter === 'has_rs' && !hasRs) { tr.style.display = 'none'; return; }

            tr.style.display = '';
            count++;
        });

        const badge = document.getElementById('db-filter-count-badge');
        if (badge) {
            badge.textContent = `معروض ${count} مقيم`;
        }
    }

    function resetDBFilters() {
        const searchInput = document.getElementById('db-search-input');
        if (searchInput) searchInput.value = '';
        const sexSelect = document.getElementById('db-filter-sex');
        if (sexSelect) sexSelect.value = 'all';
        const boardSelect = document.getElementById('db-filter-board');
        if (boardSelect) boardSelect.value = 'all';
        const stageSelect = document.getElementById('db-filter-stage');
        if (stageSelect) stageSelect.value = 'all';
        const quotaSelect = document.getElementById('db-filter-quota');
        if (quotaSelect) quotaSelect.value = 'all';

        applyDBLiveFilter();
    }

    function renderResidentSubTable(residents, scheduledCounts, isActiveTable) {
        const stages = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'بدون'];

        let html = `
            <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                            <th class="py-2.5 px-2 w-8 text-center font-bold">#</th>
                            <th class="py-2.5 px-2 font-bold min-w-[160px]">اسم المقيم الأقدم</th>
                            <th class="py-2.5 px-2 w-16 text-center font-bold">الجنس</th>
                            <th class="py-2.5 px-2 font-bold min-w-[120px]">الاختصاص</th>
                            <th class="py-2.5 px-2 w-20 text-center font-bold">البورد</th>
                            <th class="py-2.5 px-2 w-24 text-center font-bold">المرحلة</th>
                            <th class="py-2.5 px-2 w-16 text-center font-bold text-rose-600">ER</th>
                            <th class="py-2.5 px-2 w-16 text-center font-bold text-sky-600">Con</th>
                            <th class="py-2.5 px-2 w-16 text-center font-bold text-emerald-600">DC</th>
                            <th class="py-2.5 px-2 w-16 text-center font-bold text-amber-600">RS</th>
                            <th class="py-2.5 px-2 w-24 text-center font-bold">شهر الانتهاء</th>
                            <th class="py-2.5 px-2 font-bold min-w-[120px]">ملاحظات</th>
                            <th class="py-2.5 px-2 w-14 text-center font-bold">الحالة</th>
                            <th class="py-2.5 px-2 w-24 text-center font-bold">إجراءات</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        residents.forEach((r, idx) => {
            const cleanName = normalizeArabic(r.name);
            const docScheduled = scheduledCounts[cleanName] || { er: 0, con: 0, dc: 0, rs: 0, total: 0 };
            const docTargetTotal = (Number(r.er_target) || 0) + (Number(r.con_target) || 0) + (Number(r.dc_target) || 0) + (Number(r.rs_target) || 0);

            const isFulfilled = docTargetTotal > 0 && docScheduled.total >= docTargetTotal;
            const isUnfulfilled = docTargetTotal > 0 && docScheduled.total < docTargetTotal;
            const hasExtraDuties = (Number(r.rs_target) || 0) > 0 || docScheduled.rs > 0;

            let rowBgClass = '';
            let nameColorClass = 'text-slate-800 dark:text-slate-100';

            if (isActiveTable) {
                if (isFulfilled) {
                    rowBgClass = 'bg-emerald-50/40 dark:bg-emerald-950/20';
                    nameColorClass = 'text-emerald-700 dark:text-emerald-300 font-black';
                } else if (isUnfulfilled) {
                    rowBgClass = 'bg-rose-50/40 dark:bg-rose-950/20';
                    nameColorClass = 'text-rose-700 dark:text-rose-300 font-bold';
                }
            } else {
                rowBgClass = 'opacity-50 bg-slate-100/30';
            }

            const boardLabel = r.board === 'Arabic' ? 'عربي' : r.board === 'Iraqi' ? 'عراقي' : 'بدون';
            const boardColor = r.board === 'Arabic' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' :
                               r.board === 'Iraqi' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' :
                               'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';

            const sexLabel = r.sex === 'F' ? 'أنثى' : 'ذكر';
            const sexColor = r.sex === 'F' ? 'text-pink-500' : 'text-blue-500';

            html += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition ${rowBgClass}" 
                    data-resident-id="${r.id}" 
                    data-name="${escapeForInline(r.name)}" 
                    data-specialty="${escapeForInline(r.specialty || '')}" 
                    data-sex="${r.sex}" 
                    data-board="${r.board}" 
                    data-stage="${r.stage}" 
                    data-quota-status="${isFulfilled ? 'fulfilled' : isUnfulfilled ? 'unfulfilled' : 'neutral'}" 
                    data-has-rs="${hasExtraDuties ? 'true' : 'false'}">
                    <td class="py-2 px-2 text-center font-mono text-slate-400">${idx + 1}</td>
                    
                    <!-- Direct Name Edit -->
                    <td class="py-2 px-2">
                        <div class="flex items-center gap-1.5">
                            ${hasExtraDuties ? `
                                <span class="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" title="خفارات إسناد إضافية (RS)"></span>
                            ` : ''}
                            <input type="text" value="${escapeForInline(r.name)}" 
                                onblur="updateResidentFieldDirect('${r.id}', 'name', this.value)" 
                                class="bg-transparent border-0 font-bold focus:ring-1 focus:ring-rose-500 rounded px-1.5 py-0.5 w-full text-xs ${nameColorClass}">
                        </div>
                    </td>

                    <!-- Sex (Click to toggle) -->
                    <td class="py-2 px-2 text-center">
                        <button type="button" onclick="cycleResidentSex('${r.id}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${sexColor} bg-slate-100 dark:bg-slate-800 hover:scale-105 transition" title="انقر للتبديل">
                            ${sexLabel}
                        </button>
                    </td>

                    <!-- Specialty Direct Edit -->
                    <td class="py-2 px-2">
                        <input type="text" value="${escapeForInline(r.specialty)}" 
                            onblur="updateResidentFieldDirect('${r.id}', 'specialty', this.value)" 
                            class="bg-transparent border-0 focus:ring-1 focus:ring-rose-500 rounded px-1.5 py-0.5 w-full text-xs text-slate-600 dark:text-slate-300">
                    </td>

                    <!-- Board (Click to cycle) -->
                    <td class="py-2 px-2 text-center">
                        <button type="button" onclick="cycleResidentBoard('${r.id}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${boardColor} hover:scale-105 transition" title="انقر للتبديل: عربي/عراقي/بدون">
                            ${boardLabel}
                        </button>
                    </td>

                    <!-- Stage Direct Dropdown -->
                    <td class="py-2 px-2 text-center">
                        <select onchange="updateResidentFieldDirect('${r.id}', 'stage', this.value)" class="bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg px-1.5 py-0.5 text-xs text-center font-bold">
                            ${stages.map(st => `<option value="${st}" ${r.stage === st ? 'selected' : ''}>${st}</option>`).join('')}
                        </select>
                    </td>

                    <!-- ER Quota Direct Input -->
                    <td class="py-2 px-2 text-center">
                        <input type="number" min="0" value="${r.er_target}" 
                            onchange="updateResidentFieldDirect('${r.id}', 'er_target', parseInt(this.value)||0)" 
                            class="w-12 text-center bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg font-mono font-black text-rose-600 py-0.5 text-xs">
                    </td>

                    <!-- Con Quota Direct Input -->
                    <td class="py-2 px-2 text-center">
                        <input type="number" min="0" value="${r.con_target}" 
                            onchange="updateResidentFieldDirect('${r.id}', 'con_target', parseInt(this.value)||0)" 
                            class="w-12 text-center bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg font-mono font-black text-sky-600 py-0.5 text-xs">
                    </td>

                    <!-- DC Quota Direct Input -->
                    <td class="py-2 px-2 text-center">
                        <input type="number" min="0" value="${r.dc_target}" 
                            onchange="updateResidentFieldDirect('${r.id}', 'dc_target', parseInt(this.value)||0)" 
                            class="w-12 text-center bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg font-mono font-black text-emerald-600 py-0.5 text-xs">
                    </td>

                    <!-- RS Quota Direct Input -->
                    <td class="py-2 px-2 text-center">
                        <input type="number" min="0" value="${r.rs_target}" 
                            onchange="updateResidentFieldDirect('${r.id}', 'rs_target', parseInt(this.value)||0)" 
                            class="w-12 text-center bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg font-mono font-black text-amber-600 py-0.5 text-xs">
                    </td>

                    <!-- Expiry Month Direct Input -->
                    <td class="py-2 px-2 text-center">
                        <input type="month" value="${r.expiryMonth || ''}" 
                            onchange="updateResidentFieldDirect('${r.id}', 'expiryMonth', this.value)" 
                            class="text-[10px] bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg px-1 py-0.5 font-mono text-center">
                    </td>

                    <!-- Notes Direct Edit -->
                    <td class="py-2 px-2">
                        <input type="text" value="${escapeForInline(r.notes)}" 
                            onblur="updateResidentFieldDirect('${r.id}', 'notes', this.value)" 
                            placeholder="ملاحظات..."
                            class="bg-transparent border-0 focus:ring-1 focus:ring-rose-500 rounded px-1.5 py-0.5 w-full text-[11px] text-slate-500 truncate">
                    </td>

                    <!-- Active/Inactive Toggle -->
                    <td class="py-2 px-2 text-center">
                        <button type="button" onclick="handleToggleResidentActive('${r.id}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold transition ${r.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'}" title="انقر لتبديل حالة التنشيط">
                            ${r.active ? 'مفعّل' : 'معطّل'}
                        </button>
                    </td>

                    <!-- Actions: Preferences & Export to Hospital -->
                    <td class="py-2 px-2 text-center">
                        <div class="flex items-center justify-center gap-1">
                            <button type="button" onclick="openPreferencesModal('${r.id}')" class="w-6 h-6 rounded-lg text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition" title="أيام ووجبات التفضيل">
                                <i class="fas fa-heart text-[10px]"></i>
                            </button>
                            <button type="button" onclick="openExportResidentModal('${r.id}')" class="w-6 h-6 rounded-lg text-sky-600 hover:bg-sky-50 flex items-center justify-center transition" title="تصدير للمستشفى">
                                <i class="fas fa-file-export text-[10px]"></i>
                            </button>
                            <button type="button" onclick="deleteResident('${r.id}')" class="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition" title="حذف المقيم">
                                <i class="fas fa-trash-can text-[10px]"></i>
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
        `;
        return html;
    }

    // 7. PREFERENCES MODAL (رغبات الخفارة المحددة للطبيب)
    // =========================================================================

    function openPreferencesModal(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        let modal = document.getElementById('preferences-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'preferences-modal';
            modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        }

        const prefs = res.preferences || { prefDays: [], prefShifts: [] };
        const weekDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const shifts = [
            { key: 'morning', label: 'الصباحية (8ص - 2م)' },
            { key: 'afternoon', label: 'بعد الصباحية (2م - 8م)' },
            { key: 'preNight', label: 'البرينايت (8م - 2ص)' },
            { key: 'lateNight', label: 'الليلية (2ص - 8ص)' }
        ];

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">رغبات خفارة الطبيب</h3>
                        <p class="text-[11px] text-slate-500">${res.name}</p>
                    </div>
                    <button type="button" onclick="closePreferencesModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div class="p-5 space-y-4 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-2">الأيام المفضلة للخفارة:</label>
                        <div class="grid grid-cols-2 gap-2">
                            ${weekDays.map(d => `
                                <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 cursor-pointer">
                                    <input type="checkbox" name="pref-day" value="${d}" ${(prefs.prefDays || []).includes(d) ? 'checked' : ''} class="rounded text-rose-600">
                                    <span>${d}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-2">وجبات الخفارة المفضلة:</label>
                        <div class="space-y-1.5">
                            ${shifts.map(s => `
                                <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 cursor-pointer">
                                    <input type="checkbox" name="pref-shift" value="${s.key}" ${(prefs.prefShifts || []).includes(s.key) ? 'checked' : ''} class="rounded text-rose-600">
                                    <span>${s.label}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <div class="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-[11px] text-blue-800 dark:text-blue-300">
                        <i class="fas fa-info-circle ml-1"></i>
                        يحاول نظام التوزيع الآلي الالتزام بالرغبات قدر الإمكان، وفي حال عدم توفر شاغر سيتم تعيين الخفارة المتاحة ووضع شارة توضيحية.
                    </div>
                </div>

                <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                    <button type="button" onclick="closePreferencesModal()" class="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition">إلغاء</button>
                    <button type="button" onclick="saveResidentPreferences('${resId}')" class="px-5 py-2 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition">حفظ الرغبات</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closePreferencesModal() {
        const modal = document.getElementById('preferences-modal');
        if (modal) modal.classList.add('hidden');
    }

    function saveResidentPreferences(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        const dayInputs = document.querySelectorAll('input[name="pref-day"]:checked');
        const shiftInputs = document.querySelectorAll('input[name="pref-shift"]:checked');

        const prefDays = Array.from(dayInputs).map(i => i.value);
        const prefShifts = Array.from(shiftInputs).map(i => i.value);

        res.preferences = { prefDays, prefShifts };
        saveState();
        closePreferencesModal();
        showNotification(`تم حفظ رغبات الطبيب ${res.name}`, 'success');
    }

    // =========================================================================
    // 8. DOCTOR PICKER MODAL (ONLY AVAILABLE DUTIES > 0 SHOWN)
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

        const hospitalOnCall = getAllHospitalOnCallDoctors(activeSlot.dateStr);
        const hospDoctorMap = new Map();
        hospitalOnCall.forEach(hd => hospDoctorMap.set(hd.cleanName, hd));

        const scheduledCounts = countScheduledDutiesPerResident(activeSlot.type);

        const targetField = activeSlot.type === 'er' ? 'er_target' :
                            activeSlot.type === 'con' ? 'con_target' :
                            activeSlot.type === 'dc' ? 'dc_target' : 'rs_target';

        // STRICT REQUIREMENT: Only show residents with AVAILABLE duties (remaining > 0)!
        let residents = (state.residents || []).filter(r => {
            if (!isResidentEligible(r)) return false;
            const filled = scheduledCounts[normalizeArabic(r.name)] || 0;
            const target = Number(r[targetField]) || 0;
            return target > filled; // Must have remaining quota!
        });

        if (cleanQ) {
            residents = residents.filter(r =>
                normalizeArabic(r.name).includes(cleanQ) ||
                (r.specialty && r.specialty.toLowerCase().includes(query.toLowerCase()))
            );
        }

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

        // Priority Sorting:
        // For DC: Doctors with hospital duty on this day are at the VERY TOP!
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
                <div class="py-8 text-center text-slate-400 text-xs">
                    <i class="fas fa-check-double text-2xl mb-2 block text-emerald-500"></i>
                    جميع الأطباء استوفوا أنصبتهم المخصصة، أو لا يوجد أطباء متبقون للخفارة
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
                cardBorder = 'border-emerald-300 dark:border-emerald-800 ring-1 ring-emerald-500/20';
                cardBg = 'bg-emerald-50/40 dark:bg-emerald-950/20';
            } else if (item.hasConflict) {
                cardBorder = 'border-amber-300 dark:border-amber-800/80';
                cardBg = 'bg-amber-50/20 dark:bg-amber-950/10';
            }

            html += `
                <div onclick="selectDoctorForSlot('${escapeForInline(r.name)}')" 
                    class="p-3 rounded-2xl border ${cardBorder} ${cardBg} hover:shadow-md transition cursor-pointer flex items-center justify-between gap-3">
                    
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl ${isDcTopChoice ? 'bg-emerald-500 text-white' : item.hasConflict ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700'} flex items-center justify-center font-bold text-xs shrink-0">
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
                                ${r.specialty || 'عام'} · مرحلة: ${r.stage}
                            </div>
                        </div>
                    </div>

                    <div class="text-left shrink-0">
                        <div class="text-xs font-mono font-black text-emerald-600">
                            ${item.filled} / ${item.target}
                        </div>
                        <div class="text-[10px] text-slate-400 font-bold">
                            متبقي ${item.remaining}
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
                if (k !== 'dayNumber' && k !== 'date' && k !== 'dayName' && k !== 'notes' && !k.endsWith('_outsidePref')) {
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
            delete dayEntry[activeSlot.slotKey + '_outsidePref'];
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
            delete dayEntry[activeSlot.slotKey + '_outsidePref'];
            saveState();
            renderActiveTab();
            closeDoctorPickerModal();
            showNotification('تم إفراغ الخفارة بنجاح', 'info');
        }
    }

    // =========================================================================
    // 9. AUTOMATIC DUTY DISTRIBUTION (SEPARATE BUTTONS + PRECISE ER RULES)
    // =========================================================================

    function startAutoDistribution(type) {
        pendingAutoDistType = type;

        // Check if schedule has any entry
        let hasExistingEntries = false;
        (state.schedules[type] || []).forEach(day => {
            Object.keys(day).forEach(k => {
                if (k !== 'dayNumber' && k !== 'date' && k !== 'dayName' && k !== 'notes' && !k.endsWith('_outsidePref')) {
                    if (day[k] && day[k].trim()) hasExistingEntries = true;
                }
            });
        });

        if (hasExistingEntries) {
            openAutoDistPromptModal(type);
        } else {
            runAutoDistribution(type, 'clear_and_fill');
        }
    }

    function openAutoDistPromptModal(type) {
        let modal = document.getElementById('auto-schedule-prompt-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'auto-schedule-prompt-modal';
            modal.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        }

        const typeLabels = {
            er: 'خفارات قسم الطوارئ (ER)',
            con: 'خفارات الاستشارية (Con)',
            dc: 'خفارات شهادات الوفاة (DC)',
            rs_er: 'طوارئ إضراب الدوريين (RS-ER)',
            rs_wards: 'ردهات إضراب الدوريين (RS-Wards)'
        };

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">توزيع الخفارات آلياً: ${typeLabels[type]}</h3>
                    <button type="button" onclick="closeAutoDistPromptModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div class="p-5 space-y-3 text-xs">
                    <p class="text-slate-700 dark:text-slate-200 font-bold">
                        يحتوي هذا الجدول على خفارات معينة مسبقاً. كيف ترغب في المتابعة؟
                    </p>
                    <div class="space-y-2">
                        <button type="button" onclick="executeAutoDistChoice('fill_empty')" class="w-full p-3 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100 text-right transition">
                            <div class="font-black text-emerald-700 dark:text-emerald-300">1. إكمال ملء الشواغر الفارغة فقط</div>
                            <div class="text-[11px] text-slate-500 mt-0.5">الحفاظ التام على الأسماء المعينة مسبقاً وتوزيع الخانات الشاغرة فقط.</div>
                        </button>

                        <button type="button" onclick="executeAutoDistChoice('clear_and_fill')" class="w-full p-3 rounded-2xl border border-rose-200 dark:border-rose-800/80 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100 text-right transition">
                            <div class="font-black text-rose-700 dark:text-rose-300">2. مسح الجدول وإعادة التوزيع بالكامل</div>
                            <div class="text-[11px] text-slate-500 mt-0.5">مسح كافة الأسماء المعينة في هذا الجدول وإعادة التوزيع المنصف من الصفر.</div>
                        </button>
                    </div>
                </div>

                <div class="p-3 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button type="button" onclick="closeAutoDistPromptModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition">إلغاء</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeAutoDistPromptModal() {
        const modal = document.getElementById('auto-schedule-prompt-modal');
        if (modal) modal.classList.add('hidden');
    }

    function executeAutoDistChoice(mode) {
        closeAutoDistPromptModal();
        if (pendingAutoDistType) {
            runAutoDistribution(pendingAutoDistType, mode);
        }
    }

    function runAutoDistribution(type, mode) {
        if (type === 'er') {
            runERAutoDistribution(mode);
        } else if (type === 'con') {
            runConAutoDistribution(mode);
        } else if (type === 'dc') {
            runDCAutoDistribution(mode);
        } else if (type === 'rs_er') {
            runRSERAutoDistribution(mode);
        } else if (type === 'rs_wards') {
            runRSWardsAutoDistribution(mode);
        }
    }

    /**
     * ER Automatic Distribution Mechanics:
     * 1- Morning (8AM-2PM): Utmost priority to females.
     * 2- Post-Morning (2PM-8PM): Priority to females, then males.
     * 3- Pre-Night (8PM-2AM): Priority to males with multiple duties.
     * 4- Night (2AM-8AM): Priority to males with a single duty.
     * 5- Shift Diversity: Do not set same duty for same resident if > 1 duty, unless preferences state otherwise.
     * 6- Duty preferences respected; if impossible, assign and mark outside preference.
     */
    function runERAutoDistribution(mode) {
        const daysCount = getDaysInMonth(state.year, state.month);

        if (mode === 'clear_and_fill') {
            (state.schedules.er || []).forEach(day => {
                day.morning = '';
                day.afternoon = '';
                day.preNight = '';
                day.lateNight = '';
                delete day.morning_outsidePref;
                delete day.afternoon_outsidePref;
                delete day.preNight_outsidePref;
                delete day.lateNight_outsidePref;
            });
        }

        const eligibleDocs = (state.residents || []).filter(r => isResidentEligible(r) && (Number(r.er_target) || 0) > 0);
        if (eligibleDocs.length === 0) {
            alert('لا يوجد أطباء مؤهلون لديهم نصاب طوارئ (ER)!');
            return;
        }

        // Track how many duties assigned so far per resident
        const assignedCount = {};
        const assignedShifts = {};
        eligibleDocs.forEach(r => {
            const clean = normalizeArabic(r.name);
            assignedCount[clean] = 0;
            assignedShifts[clean] = new Set();
        });

        // If fill_empty mode, calculate existing assignments
        if (mode === 'fill_empty') {
            (state.schedules.er || []).forEach(day => {
                ['morning', 'afternoon', 'preNight', 'lateNight'].forEach(s => {
                    if (day[s] && day[s].trim()) {
                        const clean = normalizeArabic(day[s]);
                        if (assignedCount[clean] !== undefined) {
                            assignedCount[clean]++;
                            assignedShifts[clean].add(s);
                        }
                    }
                });
            });
        }

        const dayAssignments = {};
        for (let d = 1; d <= daysCount; d++) {
            dayAssignments[d] = new Set();
            const dayEntry = state.schedules.er.find(s => s.dayNumber === d);
            if (dayEntry) {
                ['morning', 'afternoon', 'preNight', 'lateNight'].forEach(s => {
                    if (dayEntry[s] && dayEntry[s].trim()) {
                        dayAssignments[d].add(normalizeArabic(dayEntry[s]));
                    }
                });
            }
        }

        // Helper to check candidate suitability
        function pickBestDoctorForShift(slotKey, dayNumber, dayName) {
            // Filter doctors who have remaining ER quota and not already assigned today
            const candidates = eligibleDocs.filter(r => {
                const clean = normalizeArabic(r.name);
                const target = Number(r.er_target) || 0;
                return (assignedCount[clean] < target) && !dayAssignments[dayNumber].has(clean);
            });

            if (candidates.length === 0) return null;

            // Score candidates according to user rules:
            const scored = candidates.map(r => {
                const clean = normalizeArabic(r.name);
                let score = 0;
                let matchesPref = false;

                const target = Number(r.er_target) || 0;
                const isFemale = r.sex === 'F';
                const hasMultipleDuties = target > 1;
                const hasSingleDuty = target === 1;

                // Rule 1: Morning (8AM-2PM): Utmost priority to females
                if (slotKey === 'morning') {
                    if (isFemale) score += 1000;
                }

                // Rule 2: Post-Morning (2PM-8PM): Priority to females, then males
                if (slotKey === 'afternoon') {
                    if (isFemale) score += 500;
                    else score += 100;
                }

                // Rule 3: Pre-Night (8PM-2AM): Priority to males with multiple duties
                if (slotKey === 'preNight') {
                    if (!isFemale && hasMultipleDuties) score += 800;
                    else if (!isFemale) score += 200;
                }

                // Rule 4: Night (2AM-8AM): Priority to males with a single duty
                if (slotKey === 'lateNight') {
                    if (!isFemale && hasSingleDuty) score += 900;
                    else if (!isFemale && hasMultipleDuties) score += 300;
                }

                // Rule 5: Avoid giving the same shift type if multiple duties
                if (hasMultipleDuties && assignedShifts[clean].has(slotKey)) {
                    score -= 400; // Penalize duplicate shift types for diversity
                }

                // Rule 5 (Preferences):
                const prefs = r.preferences;
                if (prefs) {
                    if (Array.isArray(prefs.prefDays) && prefs.prefDays.includes(dayName)) {
                        score += 300;
                        matchesPref = true;
                    }
                    if (Array.isArray(prefs.prefShifts) && prefs.prefShifts.includes(slotKey)) {
                        score += 300;
                        matchesPref = true;
                    }
                }

                // Remaining quota weight
                const remaining = target - assignedCount[clean];
                score += remaining * 10;

                return { resident: r, clean, score, matchesPref, hasPrefs: !!(prefs && ((prefs.prefDays||[]).length > 0 || (prefs.prefShifts||[]).length > 0)) };
            });

            scored.sort((a, b) => b.score - a.score);
            const winner = scored[0];

            const outsidePref = winner.hasPrefs && !winner.matchesPref;
            return { resident: winner.resident, clean: winner.clean, outsidePref };
        }

        // Fill shifts
        for (let d = 1; d <= daysCount; d++) {
            const dayEntry = state.schedules.er.find(s => s.dayNumber === d);
            if (!dayEntry) continue;
            const dayName = dayEntry.dayName;

            const shiftsOrder = ['morning', 'afternoon', 'preNight', 'lateNight'];
            shiftsOrder.forEach(slotKey => {
                if (!dayEntry[slotKey] || !dayEntry[slotKey].trim()) {
                    const picked = pickBestDoctorForShift(slotKey, d, dayName);
                    if (picked) {
                        dayEntry[slotKey] = picked.resident.name;
                        assignedCount[picked.clean]++;
                        assignedShifts[picked.clean].add(slotKey);
                        dayAssignments[d].add(picked.clean);

                        if (picked.outsidePref) {
                            dayEntry[slotKey + '_outsidePref'] = true;
                        }
                    }
                }
            });
        }

        saveState();
        renderActiveTab();
        showNotification('تم إنجاز التوزيع الآلي لخفارات الطوارئ وفق القواعد المحددة بنجاح!', 'success');
    }

    function runConAutoDistribution(mode) {
        const daysCount = getDaysInMonth(state.year, state.month);

        if (mode === 'clear_and_fill') {
            (state.schedules.con || []).forEach(day => day.doctor = '');
        }

        const eligibleDocs = (state.residents || []).filter(r => isResidentEligible(r) && (Number(r.con_target) || 0) > 0);
        if (eligibleDocs.length === 0) {
            alert('لا يوجد أطباء مؤهلون لديهم نصاب استشارية (Con)!');
            return;
        }

        const pool = [];
        eligibleDocs.forEach(r => {
            const clean = normalizeArabic(r.name);
            // Count already filled in Con
            let currentFilled = 0;
            if (mode === 'fill_empty') {
                (state.schedules.con || []).forEach(d => {
                    if (d.doctor && normalizeArabic(d.doctor) === clean) currentFilled++;
                });
            }
            const needed = (Number(r.con_target) || 0) - currentFilled;
            for (let i = 0; i < needed; i++) pool.push(r.name);
        });

        pool.sort(() => Math.random() - 0.5);

        for (let d = 1; d <= daysCount; d++) {
            const entry = state.schedules.con.find(s => s.dayNumber === d);
            if (entry && (!entry.doctor || !entry.doctor.trim())) {
                entry.doctor = pool.pop() || (eligibleDocs[Math.floor(Math.random() * eligibleDocs.length)].name);
            }
        }

        saveState();
        renderActiveTab();
        showNotification('تم توزيع خفارات الاستشارية آلياً بنجاح!', 'success');
    }

    function runDCAutoDistribution(mode) {
        const daysCount = getDaysInMonth(state.year, state.month);

        if (mode === 'clear_and_fill') {
            (state.schedules.dc || []).forEach(day => day.doctor = '');
        }

        const eligibleDocs = (state.residents || []).filter(r => isResidentEligible(r) && (Number(r.dc_target) || 0) > 0);
        if (eligibleDocs.length === 0) {
            alert('لا يوجد أطباء مؤهلون لديهم نصاب شهادات وفاة (DC)!');
            return;
        }

        const counts = {};
        eligibleDocs.forEach(r => counts[normalizeArabic(r.name)] = 0);

        if (mode === 'fill_empty') {
            (state.schedules.dc || []).forEach(d => {
                if (d.doctor && d.doctor.trim()) {
                    const c = normalizeArabic(d.doctor);
                    counts[c] = (counts[c] || 0) + 1;
                }
            });
        }

        for (let d = 1; d <= daysCount; d++) {
            const entry = state.schedules.dc.find(s => s.dayNumber === d);
            if (entry && (!entry.doctor || !entry.doctor.trim())) {
                const dateStr = formatDateStr(state.year, state.month, d);
                const hospitalDoctors = getAllHospitalOnCallDoctors(dateStr);

                let chosen = null;
                // Priority 1: Doctor having hospital specialty duty today and DC target remaining
                for (let hd of hospitalDoctors) {
                    const resident = eligibleDocs.find(r => normalizeArabic(r.name) === hd.cleanName);
                    if (resident && counts[hd.cleanName] < (Number(resident.dc_target) || 0)) {
                        chosen = resident.name;
                        counts[hd.cleanName]++;
                        break;
                    }
                }

                // Priority 2: Any doctor with DC target remaining
                if (!chosen) {
                    const available = eligibleDocs.filter(r => counts[normalizeArabic(r.name)] < (Number(r.dc_target) || 0));
                    if (available.length > 0) {
                        const r = available[Math.floor(Math.random() * available.length)];
                        chosen = r.name;
                        counts[normalizeArabic(r.name)]++;
                    } else {
                        chosen = eligibleDocs[Math.floor(Math.random() * eligibleDocs.length)].name;
                    }
                }

                entry.doctor = chosen || '';
            }
        }

        saveState();
        renderActiveTab();
        showNotification('تم توزيع خفارات شهادات الوفاة آلياً مع أولوية خافري المستشفى!', 'success');
    }

    function runRSERAutoDistribution(mode) {
        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        const eligibleDocs = (state.residents || []).filter(r => isResidentEligible(r) && (Number(r.rs_target) || 0) > 0);
        if (eligibleDocs.length === 0) {
            alert('لا يوجد أطباء لديهم نصاب إضراب الدوريين (RS)!');
            return;
        }

        const pool = [];
        eligibleDocs.forEach(r => {
            const target = Number(r.rs_target) || 0;
            for (let i = 0; i < target; i++) pool.push(r.name);
        });
        pool.sort(() => Math.random() - 0.5);

        (state.schedules.rs || []).forEach(day => {
            if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight'].forEach(s => {
                    if (mode === 'clear_and_fill' || !day[s] || !day[s].trim()) {
                        day[s] = pool.pop() || eligibleDocs[Math.floor(Math.random() * eligibleDocs.length)].name;
                    }
                });
            }
        });

        saveState();
        renderActiveTab();
        showNotification('تم توزيع طوارئ إضراب الدوريين آلياً بنجاح!', 'success');
    }

    function runRSWardsAutoDistribution(mode) {
        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        const eligibleDocs = (state.residents || []).filter(r => isResidentEligible(r) && (Number(r.rs_target) || 0) > 0);
        if (eligibleDocs.length === 0) {
            alert('لا يوجد أطباء لديهم نصاب إضراب الدوريين (RS)!');
            return;
        }

        const pool = [];
        eligibleDocs.forEach(r => {
            const target = Number(r.rs_target) || 0;
            for (let i = 0; i < target; i++) pool.push(r.name);
        });
        pool.sort(() => Math.random() - 0.5);

        (state.schedules.rs || []).forEach(day => {
            if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                ['ward_private', 'ward_floor4', 'ward_floor5'].forEach(s => {
                    if (mode === 'clear_and_fill' || !day[s] || !day[s].trim()) {
                        day[s] = pool.pop() || eligibleDocs[Math.floor(Math.random() * eligibleDocs.length)].name;
                    }
                });
            }
        });

        saveState();
        renderActiveTab();
        showNotification('تم توزيع ردهات إضراب الدوريين آلياً بنجاح!', 'success');
    }

    // =========================================================================
    // 10. EXPORT RESIDENT TO HOSPITAL (STRICT VALIDATION REQUIRING PHONE)
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
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">تصدير مقيم إلى قاعدة بيانات المستشفى</h3>
                        <p class="text-[11px] text-slate-500">المستشفى الهدف: <strong>${state.hospitalName}</strong></p>
                    </div>
                    <button type="button" onclick="closeExportResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleConfirmExportResident('${resId}', event)" class="p-5 space-y-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الطبيب:</label>
                        <input type="text" id="exp-res-name" value="${escapeForInline(res.name)}" required class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                            رقم الهاتف <span class="text-rose-500 font-black">* (مطلوب للتصدير)</span>:
                        </label>
                        <input type="tel" id="exp-res-phone" value="${escapeForInline(res.phone || '')}" placeholder="07XXXXXXXXX" required class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs">
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاختصاص الطبي:</label>
                        <input type="text" id="exp-res-spec" value="${escapeForInline(res.specialty || 'General')}" required class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    </div>

                    <div class="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900/60 text-[11px] text-blue-800 dark:text-blue-300">
                        <i class="fas fa-shield-halved ml-1"></i>
                        يلزم إدخال رقم الهاتف وكافة البيانات لإتمام التصدير بنجاح إلى جدول أطباء المستشفى الرسمي.
                    </div>

                    <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 -mx-5 -mb-5 mt-4">
                        <button type="button" onclick="closeExportResidentModal()" class="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition">إلغاء</button>
                        <button type="submit" class="px-5 py-2 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-md transition flex items-center gap-1.5">
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
        e.preventDefault();
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        const name = document.getElementById('exp-res-name').value.trim();
        const phone = document.getElementById('exp-res-phone').value.trim();
        const spec = document.getElementById('exp-res-spec').value.trim();

        if (!phone || phone.length < 10) {
            alert('الرجاء إدخال رقم هاتف صحيح للمقيم (لا يقل عن 10 أرقام) لإتمام التصدير.');
            return;
        }

        // Save phone to resident in ER DB as well
        res.name = name;
        res.phone = phone;
        res.specialty = spec;
        saveState();

        try {
            if (window.Hub && typeof window.Hub.getHospital === 'function') {
                const hosp = window.Hub.getHospital(state.hospitalId);
                if (hosp) {
                    if (!Array.isArray(hosp.names)) hosp.names = [];
                    const cleanRes = normalizeArabic(name);
                    const alreadyExists = hosp.names.some(n => normalizeArabic(n.name) === cleanRes);

                    if (alreadyExists) {
                        alert('هذا الطبيب موجود مسبقاً في قائمة أطباء المستشفى المحددة.');
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
                        await window.Hub.saveDatabase(`Exported resident ${name} with phone ${phone} to ${state.hospitalName}`);
                    }
                }
            }

            closeExportResidentModal();
            renderDBView(document.getElementById('schedule-view-container'));
            showNotification(`تم تصدير الطبيب "${name}" إلى مستشفى "${state.hospitalName}" بنجاح!`, 'success');
        } catch (err) {
            console.error('Export error:', err);
            showNotification('حدث خطأ أثناء تصدير الطبيب للمستشفى', 'error');
        }
    }

    // =========================================================================
    // 11. SINGLE A4 MINISTERIAL PRINTING LAYOUT
    // =========================================================================

    function prepareOfficialPrint(targetSheet) {
        const printContainer = document.getElementById('official-print-area');
        if (!printContainer) return;

        const sheetNames = {
            er: 'في الطوارئ',
            con: 'في الاستشارية',
            dc: 'في شهادات الوفاة',
            rs_er: 'في إسناد الطوارئ (RS)',
            rs_wards: 'في إسناد الردهات (RS)'
        };

        const target = targetSheet || state.activeTab || 'er';
        const targetTitle = sheetNames[target] || 'في الطوارئ';

        const arabicOrderNo = toArabicDigits(state.orderNumber || '٤٨٢١');
        const now = new Date();
        const arabicDate = toArabicDigits(`${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`);
        const arabicMonthYear = toArabicDigits(state.monthYear);

        let tableHeaderHTML = '';
        let tableRowsHTML = '';

        if (target === 'er') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 75px;">اليوم</th>
                    <th style="width: 80px;">التاريخ</th>
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
                        <td style="font-family: monospace;">${toArabicDigits(day.date)}</td>
                        <td>${day.morning || ''}</td>
                        <td>${day.afternoon || ''}</td>
                        <td>${day.preNight || ''}</td>
                        <td>${day.lateNight || ''}</td>
                    </tr>
                `;
            });
        } else if (target === 'con') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 90px;">اليوم</th>
                    <th style="width: 100px;">التاريخ</th>
                    <th>طبيب الاستشارية الخافرة</th>
                </tr>
            `;
            (state.schedules.con || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="font-weight: bold;">${day.dayName}</td>
                        <td style="font-family: monospace;">${toArabicDigits(day.date)}</td>
                        <td style="font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (target === 'dc') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 90px;">اليوم</th>
                    <th style="width: 100px;">التاريخ</th>
                    <th>طبيب شهادات الوفاة المكلف</th>
                </tr>
            `;
            (state.schedules.dc || []).forEach(day => {
                tableRowsHTML += `
                    <tr>
                        <td style="font-weight: bold;">${day.dayName}</td>
                        <td style="font-family: monospace;">${toArabicDigits(day.date)}</td>
                        <td style="font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (target === 'rs_er') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="width: 75px;">اليوم</th>
                    <th style="width: 80px;">التاريخ</th>
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
                            <td style="font-family: monospace;">${toArabicDigits(day.date)}</td>
                            <td>${day.er_morning || ''}</td>
                            <td>${day.er_afternoon || ''}</td>
                            <td>${day.er_preNight || ''}</td>
                            <td>${day.er_lateNight || ''}</td>
                        </tr>
                    `;
                }
            });
        } else if (target === 'rs_wards') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="width: 75px;">اليوم</th>
                    <th style="width: 80px;">التاريخ</th>
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
                            <td style="font-family: monospace;">${toArabicDigits(day.date)}</td>
                            <td>${day.ward_private || ''}</td>
                            <td>${day.ward_floor4 || ''}</td>
                            <td>${day.ward_floor5 || ''}</td>
                        </tr>
                    `;
                }
            });
        }

        printContainer.innerHTML = `
            <div style="font-family: 'Cairo', Arial, sans-serif; direction: rtl; color: #000; width: 100%; line-height: 1.15;">
                
                <!-- 1. Header (Centered like in image 2) -->
                <div style="text-align: center; font-weight: bold; line-height: 1.35; font-size: 11pt; margin-bottom: 2px;">
                    <div>جمهورية العراق</div>
                    <div>وزارة الصحة</div>
                    <div>دائرة صحة البصرة</div>
                    <div>${state.hospitalName}</div>
                    <div>شعبة ادارة الموارد البشرية</div>
                </div>

                <!-- 2. Date & Order No on right (in Arabic) -->
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 9.5pt; margin-top: 4px;">
                    <div style="text-align: right; line-height: 1.4;">
                        <div>العدد / ${arabicOrderNo}</div>
                        <div>التاريخ / ${arabicDate}</div>
                    </div>
                </div>

                <!-- 3. Title (Centered) -->
                <div style="text-align: center; font-size: 13pt; font-weight: 900; margin: 3px 0;">
                    امر اداري
                </div>

                <!-- 4. Intro text (Right aligned) -->
                <div style="text-align: right; font-weight: bold; font-size: 9pt; margin-bottom: 4px;">
                    تقرر ان يكون جدول خفارات المقيمين الاقدمين ${targetTitle} لشهر ${arabicMonthYear} كما مبين ادناه: -
                </div>

                <!-- 5. Single Page Table (Compact 7.5pt) -->
                <table style="width: 100%; border-collapse: collapse; font-size: 7.5pt; border: 1.5px solid #000;">
                    <thead style="background-color: #f1f5f9; -webkit-print-color-adjust: exact;">
                        ${tableHeaderHTML}
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>

                <!-- 6. Footer Notes (From Image 1) -->
                <div style="margin-top: 5px; font-size: 8pt; line-height: 1.35; font-weight: bold;">
                    <div>◆ يرجى تبليغ رئيس الاطباء المقيمين في حالة تبديل الخفارة وبخلافه يتحمل الطرفين المسؤولية.</div>
                    <div>◆ في حالة تغيب الطبيب عن الخفارة، يعتبر غياب ويكون التعويض مضاعف.</div>
                </div>

                <!-- 7. Signatures: Head of Residents (Right) & Hospital Director (Left) -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 10px; font-size: 9pt; font-weight: bold;">
                    <!-- Right (First child in RTL): Head of Residents -->
                    <div style="text-align: center; width: 40%;">
                        <div>${state.headOfResidents || 'د. محمد راضي خضر'}</div>
                        <div style="margin-top: 2px;">رئيس الأطباء المقيمين</div>
                    </div>
                    <!-- Left (Second child in RTL): Hospital Director -->
                    <div style="text-align: center; width: 40%;">
                        <div>الطبيب الاخصائي</div>
                        <div style="margin-top: 2px;">${state.hospitalDirector || 'د. علي عبد معن'}</div>
                        <div style="margin-top: 2px;">مدير ${state.hospitalName}</div>
                    </div>
                </div>

                <!-- 8. Distribution List (From Image 1) -->
                <div style="margin-top: 8px; font-size: 7.5pt; line-height: 1.35; font-weight: bold; text-align: right;">
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

    // =========================================================================
    // HOSPITAL SYNC & ADD RESIDENT MODALS
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
            if (!inEr) missingInEr.push(h);
        });

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">مطابقة ومزامنة الأسماء مع ${state.hospitalName}</h3>
                    </div>
                    <button type="button" onclick="closeHospitalSyncModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div class="p-4 space-y-4 max-h-[480px] overflow-y-auto">
                    <div class="grid grid-cols-3 gap-2 text-center text-xs">
                        <div class="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200">
                            <div class="text-[11px] text-emerald-700 font-bold">متطابقون</div>
                            <div class="text-xl font-black text-emerald-600 mt-0.5">${matched.length}</div>
                        </div>
                        <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200">
                            <div class="text-[11px] text-amber-700 font-bold">مفقودون في الطوارئ</div>
                            <div class="text-xl font-black text-amber-600 mt-0.5">${missingInEr.length}</div>
                        </div>
                        <div class="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200">
                            <div class="text-[11px] text-blue-700 font-bold">خاص بالطوارئ (محفوظ)</div>
                            <div class="text-xl font-black text-blue-600 mt-0.5">${erOnly.length}</div>
                        </div>
                    </div>

                    ${missingInEr.length > 0 ? `
                    <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-black text-slate-800 dark:text-slate-200">أطباء متاحون في المستشفى للاستيراد:</span>
                            <button type="button" onclick="importAllMissingDoctorsToER()" class="px-2.5 py-1 rounded-xl text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition">
                                استيراد الكل
                            </button>
                        </div>
                        <div class="max-h-36 overflow-y-auto space-y-1 text-xs">
                            ${missingInEr.map(h => `
                                <div class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60">
                                    <div>
                                        <span class="font-bold text-slate-800 dark:text-slate-100">${h.name}</span>
                                        <span class="text-[10px] text-slate-400 mr-2">(${h.spec || 'عام'})</span>
                                    </div>
                                    <button type="button" onclick="importSingleDoctorToER('${escapeForInline(h.name)}', '${escapeForInline(h.spec)}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold text-sky-600 bg-sky-50 hover:bg-sky-100 transition">
                                        استيراد
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                </div>

                <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 flex justify-end">
                    <button type="button" onclick="closeHospitalSyncModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition">إغلاق</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function closeHospitalSyncModal() {
        const modal = document.getElementById('hospital-sync-modal');
        if (modal) modal.classList.add('hidden');
    }

    function importSingleDoctorToER(name, spec) {
        state.residents.push({
            id: `er_res_${Date.now()}`,
            name: name,
            sex: 'M',
            specialty: spec || 'General',
            board: 'None',
            stage: 'الأولى',
            er_target: 2,
            con_target: 0,
            dc_target: 0,
            rs_target: 0,
            expiryMonth: '',
            phone: '',
            preferences: { prefDays: [], prefShifts: [] },
            notes: 'Imported from hospital',
            active: true,
            hospitals: [state.hospitalId]
        });
        saveState();
        openHospitalSyncModal();
        showNotification(`تم استيراد ${name} إلى الطوارئ بنجاح`, 'success');
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
                    stage: 'الأولى',
                    er_target: 2,
                    con_target: 0,
                    dc_target: 0,
                    rs_target: 0,
                    expiryMonth: '',
                    phone: '',
                    preferences: { prefDays: [], prefShifts: [] },
                    notes: 'Imported from hospital',
                    active: true,
                    hospitals: [state.hospitalId]
                });
                count++;
            }
        });

        saveState();
        openHospitalSyncModal();
        showNotification(`تم استيراد ${count} طبيب إلى قاعدة الطوارئ`, 'success');
    }

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
                    <button type="button" onclick="closeAddResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleSaveNewResident(event)" class="p-5 space-y-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الطبيب الرباعي:</label>
                        <input type="text" id="new-res-name" required placeholder="د. الاسم الكامل..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 text-slate-800 dark:text-slate-100">
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الجنس:</label>
                            <select id="new-res-sex" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200">
                                <option value="M">ذكر</option>
                                <option value="F">أنثى</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاختصاص:</label>
                            <input type="text" id="new-res-spec" placeholder="مثال: الجراحة العامة" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع البورد:</label>
                            <select id="new-res-board" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200">
                                <option value="Arabic">عربي (Arabic)</option>
                                <option value="Iraqi">عراقي (Iraqi)</option>
                                <option value="None" selected>بدون بورد (None)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">المرحلة:</label>
                            <select id="new-res-stage" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200">
                                <option value="الأولى">الأولى</option>
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
                            <input type="number" id="new-res-er" value="2" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-sky-600 mb-1">نصاب Con:</label>
                            <input type="number" id="new-res-con" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-emerald-600 mb-1">نصاب DC:</label>
                            <input type="number" id="new-res-dc" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-amber-600 mb-1">نصاب RS:</label>
                            <input type="number" id="new-res-rs" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 text-center font-mono font-bold">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">رقم الهاتف (للمستشفى):</label>
                            <input type="tel" id="new-res-phone" placeholder="07XXXXXXXXX" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 font-mono">
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">شهر الانتهاء (اختياري):</label>
                            <input type="month" id="new-res-expiry" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 font-mono">
                        </div>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">ملاحظات إدارية:</label>
                        <input type="text" id="new-res-notes" placeholder="ملاحظات..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200">
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                        <button type="button" onclick="closeAddResidentModal()" class="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition">إلغاء</button>
                        <button type="submit" class="px-5 py-2 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md transition">حفظ وإضافة</button>
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
        const stage = document.getElementById('new-res-stage').value;
        const er_target = parseInt(document.getElementById('new-res-er').value, 10) || 0;
        const con_target = parseInt(document.getElementById('new-res-con').value, 10) || 0;
        const dc_target = parseInt(document.getElementById('new-res-dc').value, 10) || 0;
        const rs_target = parseInt(document.getElementById('new-res-rs').value, 10) || 0;
        const phone = document.getElementById('new-res-phone').value.trim();
        const expiryMonth = document.getElementById('new-res-expiry').value;
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
            preferences: { prefDays: [], prefShifts: [] },
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
    // EXCEL EXPORT
    // =========================================================================

    function exportFullScheduleToExcel() {
        if (typeof XLSX === 'undefined') {
            alert('مكتبة SheetJS غير محملة');
            return;
        }

        const wb = XLSX.utils.book_new();

        const erData = [
            ['اليوم', 'التاريخ', 'الصباحية', 'بعد الصباحية', 'البرينايت', 'الليلية'],
            ...(state.schedules.er || []).map(d => [d.dayName, d.date, d.morning, d.afternoon, d.preNight, d.lateNight])
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(erData), 'ER');

        const conData = [
            ['اليوم', 'التاريخ', 'طبيب الاستشارية'],
            ...(state.schedules.con || []).map(d => [d.dayName, d.date, d.doctor])
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(conData), 'Con');

        const dcData = [
            ['اليوم', 'التاريخ', 'طبيب شهادات الوفاة'],
            ...(state.schedules.dc || []).map(d => [d.dayName, d.date, d.doctor])
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dcData), 'DC');

        if (state.rsEnabled) {
            const rsData = [
                ['اليوم', 'التاريخ', 'طوارئ: صباحية', 'طوارئ: بعد الصباحية', 'طوارئ: برينايت', 'طوارئ: ليلية', 'الجناح الخاص', 'طابق 4', 'طابق 5'],
                ...(state.schedules.rs || []).map(d => [d.dayName, d.date, d.er_morning, d.er_afternoon, d.er_preNight, d.er_lateNight, d.ward_private, d.ward_floor4, d.ward_floor5])
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rsData), 'RS');
        }

        const dbData = [
            ['الاسم', 'الجنس', 'الاختصاص', 'نوع البورد', 'المرحلة', 'نصاب ER', 'نصاب Con', 'نصاب DC', 'نصاب RS', 'رقم الهاتف', 'شهر الانتهاء', 'الحالة', 'ملاحظات'],
            ...(state.residents || []).map(r => [
                r.name, r.sex, r.specialty, r.board, r.stage, r.er_target, r.con_target, r.dc_target, r.rs_target, r.phone || '', r.expiryMonth || '', r.active ? 'نشط' : 'متوقف', r.notes
            ])
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dbData), 'Residents_DB');

        XLSX.writeFile(wb, `جدول_خفارات_${state.hospitalId}_${state.month}_${state.year}.xlsx`);
        showNotification('تم تصدير ملف Excel بنجاح', 'success');
    }

    function escapeForInline(str) {
        if (!str) return '';
        return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

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

    // Window Export
    window.EmergencyHub = {
        init: initEmergencyApp,
        getState: () => state,
        switchTab,
        onHospitalChange,
        onMonthYearChange,
        onOrderNumberChange,
        suggestSequentialOrderNumber,
        onRsDateChange,
        updateLeadershipName,
        toggleRotatorsStrike,
        openDoctorPicker,
        closeDoctorPickerModal,
        filterPickerList,
        selectDoctorForSlot,
        clearActiveSlot,
        showConflictDetailsModal,
        closeConflictModal,
        confirmClearConflictCell,
        startAutoDistribution,
        closeAutoDistPromptModal,
        executeAutoDistChoice,
        toggleShowInactiveInDB,
        handleToggleResidentActive,
        advanceBoardResidentsStage,
        updateResidentFieldDirect,
        cycleResidentBoard,
        cycleResidentSex,
        deleteResident,
        downloadEmergencyDbJson,
        openPreferencesModal,
        closePreferencesModal,
        saveResidentPreferences,
        openExportResidentModal,
        closeExportResidentModal,
        handleConfirmExportResident,
        openHospitalSyncModal,
        closeHospitalSyncModal,
        importSingleDoctorToER,
        importAllMissingDoctorsToER,
        openAddResidentModal,
        closeAddResidentModal,
        handleSaveNewResident,
        prepareOfficialPrint,
        exportFullScheduleToExcel,
        resetEmergencyToDefaults,
        onScheduleSearchInput,
        clearScheduleSearch,
        onScheduleShiftFilter,
        onScheduleDayFilter,
        onScheduleEmptyToggle
    };

    // Global aliases
    Object.keys(window.EmergencyHub).forEach(k => {
        window[k] = window.EmergencyHub[k];
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEmergencyApp);
    } else {
        initEmergencyApp();
    }

})(window);
