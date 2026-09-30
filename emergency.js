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
    const MONTH_STORAGE_PREFIX = 'hosp_hub_emergency_sched_';

    const PRINT_THEME_PRESETS = {
        official: {
            name: 'النموذج الوزاري PDF',
            headerBg: '#000000',
            headerText: '#ffffff',
            weekendBg: '#5ea37d',
            weekendText: '#000000',
            borderColor: '#000000'
        },
        bw: {
            name: 'أبيض وأسود كلاسيكي',
            headerBg: '#e2e8f0',
            headerText: '#000000',
            weekendBg: '#f1f5f9',
            weekendText: '#000000',
            borderColor: '#000000'
        },
        navy: {
            name: 'أزرق كحلي ملكي',
            headerBg: '#1e3a8a',
            headerText: '#ffffff',
            weekendBg: '#bfdbfe',
            weekendText: '#1e3a8a',
            borderColor: '#1e3a8a'
        },
        emerald: {
            name: 'أخضر زمردي',
            headerBg: '#065f46',
            headerText: '#ffffff',
            weekendBg: '#a7f3d0',
            weekendText: '#064e3b',
            borderColor: '#065f46'
        },
        burgundy: {
            name: 'عنابي طوارئ',
            headerBg: '#881337',
            headerText: '#ffffff',
            weekendBg: '#fecdd3',
            weekendText: '#881337',
            borderColor: '#881337'
        }
    };

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
        monthlySchedules: {},
        hospitalResidents: {},
        residents: [],
        // Database Sorting states
        dbSortColumn: 'name',
        dbSortDirection: 'asc',
        // Specialty Custom Colors Map
        specialtyColors: {},
        // Clear Print Metadata (Handwritten pen dotted lines)
        clearPrintMeta: false,
        schedules: {
            er: [],
            con: [],
            dc: [],
            rs: []
        },
        // Undo / Redo history stacks
        undoStack: [],
        redoStack: [],
        // Official Paper Print Customization
        printOptions: {
            theme: 'official',
            headerBg: '#000000',
            headerText: '#ffffff',
            weekendBg: '#5ea37d',
            weekendText: '#000000',
            borderColor: '#000000'
        }
    };

    let activeSlot = null; // currently opened slot in picker
    let pendingConflictData = null; // slot data for conflict explanation modal
    let pendingAutoGenerateType = null; // schedule type for auto generate modal
    let activePrintSheet = 'er'; // active sheet for print options modal

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

    /**
     * Determines whether to show current month or next month based on Day 18 rule:
     * - If day < 18: current month
     * - If day >= 18: next month (preparing the next month's schedule)
     */
    function getDefaultPeriodByDay18Rule(customDate) {
        const now = customDate || new Date();
        const curDay = now.getDate();
        const curMonth = now.getMonth() + 1; // 1-12
        const curYear = now.getFullYear();

        if (curDay < 18) {
            return { month: curMonth, year: curYear };
        } else {
            if (curMonth === 12) {
                return { month: 1, year: curYear + 1 };
            } else {
                return { month: curMonth + 1, year: curYear };
            }
        }
    }

    // =========================================================================
    // HOSPITAL HUB CACHE & DOCTORS LOADER HELPERS
    // =========================================================================
    let hubFallbackData = null;

    async function ensureHubDatabaseLoaded() {
        if (window.Hub && typeof window.Hub.loadDatabase === 'function') {
            try {
                await window.Hub.loadDatabase();
            } catch (e) {
                console.warn('Hub loadDatabase error:', e);
            }
        }
        const hosps = (window.Hub && typeof window.Hub.getHospitals === 'function') ? window.Hub.getHospitals() : [];
        if (hosps.length === 0 && !hubFallbackData) {
            try {
                if (typeof fetch === 'function') {
                    const res = await fetch('./hub-data.json?t=' + Date.now());
                    if (res.ok) {
                        hubFallbackData = await res.json();
                        if (window.Hub && typeof window.Hub.getDatabase === 'function' && !window.Hub.getDatabase()) {
                            try {
                                localStorage.setItem('hospital_hub_database_v3', JSON.stringify(hubFallbackData));
                                localStorage.setItem('hospital_hub_database_v2', JSON.stringify(hubFallbackData));
                                if (typeof window.Hub.loadDatabase === 'function') await window.Hub.loadDatabase();
                            } catch (e) {}
                        }
                    }
                }
            } catch (err) {
                console.warn('Direct hub-data.json fallback fetch error:', err);
            }
        }
    }

    function getAllHospitalRecords() {
        let hospitals = [];
        if (window.Hub && typeof window.Hub.getHospitals === 'function') {
            hospitals = window.Hub.getHospitals() || [];
        }
        if (hospitals.length === 0 && hubFallbackData && hubFallbackData.hospitals) {
            hospitals = Object.values(hubFallbackData.hospitals);
        }
        if (hospitals.length === 0) {
            hospitals = [
                { id: 'iraqi', name_ar: 'المستشفى العراقي التعليمي' },
                { id: 'basra', name_ar: 'مستشفى البصرة التعليمي' },
                { id: 'mawani', name_ar: 'مستشفى الموانئ التعليمي' }
            ];
        }
        return hospitals;
    }

    function getHospitalRecord(hospId) {
        if (!hospId) return null;
        if (window.Hub && typeof window.Hub.getHospital === 'function') {
            const h = window.Hub.getHospital(hospId);
            if (h) return h;
        }
        if (hubFallbackData && hubFallbackData.hospitals && hubFallbackData.hospitals[hospId]) {
            return hubFallbackData.hospitals[hospId];
        }
        return null;
    }

    function getHospitalDoctorsList(hospId) {
        if (!hospId) return [];
        let docs = [];
        const hosp = getHospitalRecord(hospId);
        if (hosp && Array.isArray(hosp.names)) {
            docs.push(...hosp.names);
        }
        let shared = [];
        if (window.Hub && typeof window.Hub.getResidents === 'function') {
            shared = window.Hub.getResidents(hospId) || [];
        } else if (hubFallbackData && Array.isArray(hubFallbackData.residents)) {
            shared = hubFallbackData.residents.filter(r => Array.isArray(r.hospitals) && r.hospitals.includes(hospId));
        }
        shared.forEach(s => {
            const sNorm = normalizeArabic(s.name);
            if (!docs.some(d => normalizeArabic(d.name) === sNorm)) {
                docs.push(s);
            }
        });
        return docs;
    }

    function getHospitalSpecificSpecialties(hospId) {
        const hosp = getHospitalRecord(hospId);
        const result = [];
        const seen = new Set();

        if (hosp && Array.isArray(hosp.specialties) && hosp.specialties.length > 0) {
            hosp.specialties.forEach(s => {
                const canonEn = canonicalizeSpecialtyName(s.name_en || s.enName || s.name_ar || s.name || s.id);
                const key = (s.id || canonEn).toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push({
                        id: s.id,
                        name_ar: s.name_ar || s.name || '',
                        name_en: canonEn,
                        color: s.color || getSpecialtyColor(canonEn)
                    });
                }
            });
            return result;
        }

        // Fallback: extract unique specialties from the hospital's doctors
        const docs = getHospitalDoctorsList(hospId);
        const uniqueSpecIds = [...new Set(docs.map(d => d.spec || d.specialty || d.dept).filter(Boolean))];
        uniqueSpecIds.forEach(specId => {
            const canonEn = canonicalizeSpecialtyName(specId);
            result.push({
                id: specId,
                name_ar: specId,
                name_en: canonEn,
                color: getSpecialtyColor(canonEn)
            });
        });
        return result;
    }

    function isDoctorInHospitalSpecialty(doc, specId, hospSpecialties) {
        if (!specId || specId === 'all') return true;
        const docSpec = doc.spec || doc.tag || doc.dept || doc.department || '';
        if (docSpec === specId) return true;

        const targetSpecObj = (hospSpecialties || []).find(s => s.id === specId);
        const targetEn = targetSpecObj ? canonicalizeSpecialtyName(targetSpecObj.name_en || targetSpecObj.name_ar || targetSpecObj.id) : canonicalizeSpecialtyName(specId);

        const docSpecObj = (hospSpecialties || []).find(s => s.id === docSpec);
        const docEn = docSpecObj ? canonicalizeSpecialtyName(docSpecObj.name_en || docSpecObj.name_ar || docSpecObj.id) : canonicalizeSpecialtyName(docSpec);

        if (targetEn && docEn && targetEn.toLowerCase() === docEn.toLowerCase()) {
            return true;
        }
        return false;
    }

    function isResidentAlreadyInER(doc) {
        const normName = normalizeArabic(doc.name || '');
        const cleanPhone = doc.phone ? formatIraqiPhoneNumber(doc.phone) : '';
        return (state.residents || []).some(r => {
            const nameMatches = normalizeArabic(r.name || '') === normName;
            const phoneMatches = cleanPhone && r.phone && (formatIraqiPhoneNumber(r.phone) === cleanPhone);
            return nameMatches || phoneMatches;
        });
    }

    // =========================================================================
    // INITIALIZATION & STATE PERSISTENCE
    // =========================================================================

    async function initEmergencyApp() {
        console.log('Initializing Emergency System V2...');
        await ensureHubDatabaseLoaded();

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

        // Enforce: Always display ER schedule first on initial load
        state.activeTab = 'er';

        // Enforce: Day 18 rule for initial schedule month/year on launch
        // If today is earlier than 18th of current month -> current month
        // If today is 18th or later -> next month (preparing schedule for next month)
        const initialPeriod = getDefaultPeriodByDay18Rule();
        state.month = initialPeriod.month;
        state.year = initialPeriod.year;
        const monthNames = [
            'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
            'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
        ];
        state.monthYear = `${monthNames[state.month - 1]} ${state.year}`;

        // 2. Fallback to DEFAULT_EMERGENCY_DATA if residents or schedules empty
        if (!state.residents || state.residents.length === 0) {
            if (window.DEFAULT_EMERGENCY_DATA && window.DEFAULT_EMERGENCY_DATA.residents) {
                state.residents = JSON.parse(JSON.stringify(window.DEFAULT_EMERGENCY_DATA.residents));
                state.hospitalName = window.DEFAULT_EMERGENCY_DATA.hospitalName || state.hospitalName;
                state.orderNumber = window.DEFAULT_EMERGENCY_DATA.orderNumber || state.orderNumber;
                state.orderDate = window.DEFAULT_EMERGENCY_DATA.orderDate || state.orderDate;
                state.headOfResidents = window.DEFAULT_EMERGENCY_DATA.headOfResidents || state.headOfResidents;
                state.headOfHospital = window.DEFAULT_EMERGENCY_DATA.headOfHospital || state.headOfHospital;
                state.rsStartDate = window.DEFAULT_EMERGENCY_DATA.rsStartDate || state.rsStartDate;
                state.rsEndDate = window.DEFAULT_EMERGENCY_DATA.rsEndDate || state.rsEndDate;
            }
        }

        // Ensure baseline activation state is restored from canonical data if state was corrupted (e.g. 0 inactives)
        const baselineMap = {};
        if (window.DEFAULT_EMERGENCY_DATA && Array.isArray(window.DEFAULT_EMERGENCY_DATA.residents)) {
            window.DEFAULT_EMERGENCY_DATA.residents.forEach(r => {
                baselineMap[r.id] = (r.active !== false);
            });
        }
        const inactiveInState = (state.residents || []).filter(r => r.active === false).length;
        if (inactiveInState === 0 && Object.keys(baselineMap).length > 0) {
            (state.residents || []).forEach(r => {
                if (baselineMap[r.id] !== undefined) {
                    r.active = baselineMap[r.id];
                }
            });
        }

        // Canonicalize all resident specialties to English names matching Hospital specialties
        (state.residents || []).forEach(r => {
            if (r.specialty) {
                r.specialty = canonicalizeSpecialtyName(r.specialty);
            }
        });
        if (state.hospitalResidents) {
            Object.values(state.hospitalResidents).forEach(list => {
                if (Array.isArray(list)) {
                    list.forEach(r => {
                        if (r.specialty) {
                            r.specialty = canonicalizeSpecialtyName(r.specialty);
                        }
                    });
                }
            });
        }

        // Load the schedule and allocations for the determined month from store
        loadMonthScheduleFromStore(state.hospitalId, state.year, state.month);
        loadMonthAllocationsFromStore(state.hospitalId, state.year, state.month);

        if (!state.hospitalSignatories) state.hospitalSignatories = {};
        if (state.hospitalId && state.hospitalSignatories[state.hospitalId]) {
            if (state.hospitalSignatories[state.hospitalId].headOfResidents) {
                state.headOfResidents = state.hospitalSignatories[state.hospitalId].headOfResidents;
            }
            if (state.hospitalSignatories[state.hospitalId].headOfHospital) {
                state.headOfHospital = state.hospitalSignatories[state.hospitalId].headOfHospital;
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

        // 4b. Initialize in-memory cache for monthly schedules and hospital residents
        if (!state.monthlySchedules) state.monthlySchedules = {};
        if (!state.hospitalResidents) state.hospitalResidents = {};
        const initKey = `${state.hospitalId}_${state.year}_${state.month}`;
        if (!state.monthlySchedules[initKey] && state.schedules) {
            state.monthlySchedules[initKey] = JSON.parse(JSON.stringify(state.schedules));
        }
        if (!state.hospitalResidents[state.hospitalId] && state.residents && state.residents.length > 0) {
            state.hospitalResidents[state.hospitalId] = JSON.parse(JSON.stringify(state.residents));
        }

        // 5. Initialize Hospital Selector from Hub
        initHospitalSelector();

        // 6. Sync UI inputs with state
        syncMetaInputsWithState();

        // 7. Render UI
        updateDutyDashboard();
        renderActiveTab();
        updateRsVisibilityUI();
        initAutoModalListeners();
        initKeyboardShortcuts();
    }

    function initKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            const dbModal = document.getElementById('residents-db-modal');
            const isDbOpen = dbModal && !dbModal.classList.contains('hidden');

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) {
                    e.preventDefault();
                    if (isDbOpen) redoDBAction();
                    else redoScheduleAction();
                } else {
                    e.preventDefault();
                    if (isDbOpen) undoDBAction();
                    else undoScheduleAction();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                if (isDbOpen) redoDBAction();
                else redoScheduleAction();
            }
        });
    }

    function ensureScheduleIntegrity() {
        const daysCount = getDaysInMonth(state.year, state.month);
        
        ['er', 'con', 'dc', 'rs'].forEach(type => {
            if (!Array.isArray(state.schedules[type])) {
                state.schedules[type] = [];
            }
            
            const existingEntries = state.schedules[type];
            const newSchedule = [];
            
            for (let d = 1; d <= daysCount; d++) {
                const dateStr = formatDateStr(state.year, state.month, d);
                const dayName = getArabicDayName(state.year, state.month, d);
                
                // Match by exact date first, then by dayNumber (preventing duplicate assignments)
                let entry = existingEntries.find(s => s && s.date === dateStr);
                if (!entry) {
                    entry = existingEntries.find(s => s && s.dayNumber === d && !newSchedule.some(ns => ns.dayNumber === d));
                }
                
                if (entry) {
                    entry = Object.assign({}, entry);
                    entry.dayNumber = d;
                    entry.date = dateStr;
                    entry.dayName = dayName;
                } else {
                    if (type === 'er') {
                        entry = { dayNumber: d, date: dateStr, dayName, morning: '', afternoon: '', preNight: '', lateNight: '', notes: '' };
                    } else if (type === 'con' || type === 'dc') {
                        entry = { dayNumber: d, date: dateStr, dayName, doctor: '' };
                    } else if (type === 'rs') {
                        entry = { dayNumber: d, date: dateStr, dayName, er_morning: '', er_afternoon: '', er_preNight: '', er_lateNight: '', ward_private: '', ward_floor4: '', ward_floor5: '' };
                    }
                }
                newSchedule.push(entry);
            }
            // Strict replacement: exactly daysCount elements, exactly 1..daysCount
            state.schedules[type] = newSchedule;
        });
    }

    const MONTH_ALLOC_PREFIX = 'hosp_hub_emergency_alloc_';

    function saveCurrentMonthScheduleToStore() {
        if (!state.monthlySchedules) state.monthlySchedules = {};
        const key = `${state.hospitalId}_${state.year}_${state.month}`;
        if (state.schedules) {
            state.monthlySchedules[key] = JSON.parse(JSON.stringify(state.schedules));
            try {
                localStorage.setItem(MONTH_STORAGE_PREFIX + key, JSON.stringify(state.schedules));
            } catch (e) {
                console.warn('Failed to save month schedule to localStorage', e);
            }
        }
    }

    function saveCurrentMonthAllocationsToStore() {
        if (!state.hospitalId || !state.year || !state.month) return;
        const key = `${state.hospitalId}_${state.year}_${state.month}`;
        const map = {};
        (state.residents || []).forEach(r => {
            map[r.id] = {
                active: r.active !== false,
                er_target: Number(r.er_target) || 0,
                con_target: Number(r.con_target) || 0,
                dc_target: Number(r.dc_target) || 0,
                rs_target: Number(r.rs_target) || 0
            };
        });
        if (!state.monthlyAllocations) state.monthlyAllocations = {};
        state.monthlyAllocations[key] = map;
        try {
            localStorage.setItem(MONTH_ALLOC_PREFIX + key, JSON.stringify(map));
        } catch (e) {
            console.warn('Failed to save monthly allocations to localStorage', e);
        }
    }

    function getBaselineResidentActive(residentId) {
        if (window.DEFAULT_EMERGENCY_DATA && Array.isArray(window.DEFAULT_EMERGENCY_DATA.residents)) {
            const found = window.DEFAULT_EMERGENCY_DATA.residents.find(r => r.id === residentId);
            if (found) return found.active !== false;
        }
        return true;
    }

    function loadMonthAllocationsFromStore(hospId, year, month) {
        if (!state.monthlyAllocations) state.monthlyAllocations = {};
        const key = `${hospId}_${year}_${month}`;

        let loadedMap = null;
        try {
            const raw = localStorage.getItem(MONTH_ALLOC_PREFIX + key);
            if (raw) {
                loadedMap = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('Error reading month allocations from localStorage', e);
        }

        if (!loadedMap && state.monthlyAllocations[key]) {
            loadedMap = state.monthlyAllocations[key];
        }

        // Bundled initial September 2026 allocations for default Iraqi hospital
        if (!loadedMap && hospId === 'iraqi' && year === 2026 && month === 9 && window.DEFAULT_EMERGENCY_DATA && window.DEFAULT_EMERGENCY_DATA.residents) {
            loadedMap = {};
            window.DEFAULT_EMERGENCY_DATA.residents.forEach(r => {
                loadedMap[r.id] = {
                    active: r.active !== false,
                    er_target: Number(r.er_target) || 0,
                    con_target: Number(r.con_target) || 0,
                    dc_target: Number(r.dc_target) || 0,
                    rs_target: Number(r.rs_target) || 0
                };
            });
        }

        if (loadedMap) {
            // Heuristically heal if loadedMap had 0 inactives for large baseline dataset (e.g. from previous bug)
            const inactivesInMap = Object.values(loadedMap).filter(v => v.active === false).length;
            if (inactivesInMap === 0 && Object.keys(loadedMap).length >= 100) {
                Object.keys(loadedMap).forEach(rId => {
                    if (!getBaselineResidentActive(rId)) {
                        loadedMap[rId].active = false;
                    }
                });
            }

            state.monthlyAllocations[key] = loadedMap;
            (state.residents || []).forEach(r => {
                if (loadedMap[r.id]) {
                    r.active = loadedMap[r.id].active !== undefined ? Boolean(loadedMap[r.id].active) : getBaselineResidentActive(r.id);
                    r.er_target = Number(loadedMap[r.id].er_target) || 0;
                    r.con_target = Number(loadedMap[r.id].con_target) || 0;
                    r.dc_target = Number(loadedMap[r.id].dc_target) || 0;
                    r.rs_target = Number(loadedMap[r.id].rs_target) || 0;
                } else {
                    r.active = getBaselineResidentActive(r.id);
                    r.er_target = 0;
                    r.con_target = 0;
                    r.dc_target = 0;
                    r.rs_target = 0;
                }
            });
            return true;
        } else {
            // Empty month: All resident targets are zero/empty by default, active is baseline state
            (state.residents || []).forEach(r => {
                r.active = getBaselineResidentActive(r.id);
                r.er_target = 0;
                r.con_target = 0;
                r.dc_target = 0;
                r.rs_target = 0;
            });
            return false;
        }
    }

    function getPreviousMonth(year, month) {
        const prevMonth = (month === 1) ? 12 : month - 1;
        const prevYear = (month === 1) ? year - 1 : year;
        return { month: prevMonth, year: prevYear };
    }

    function getPreviousMonthAllocations(hospId, year, month) {
        const prev = getPreviousMonth(year, month);
        const prevKey = `${hospId}_${prev.year}_${prev.month}`;
        let prevMap = null;
        try {
            const raw = localStorage.getItem(MONTH_ALLOC_PREFIX + prevKey);
            if (raw) prevMap = JSON.parse(raw);
        } catch (e) {}

        if (!prevMap && state.monthlyAllocations && state.monthlyAllocations[prevKey]) {
            prevMap = state.monthlyAllocations[prevKey];
        }

        if (!prevMap && hospId === 'iraqi' && prev.year === 2026 && prev.month === 9 && window.DEFAULT_EMERGENCY_DATA && window.DEFAULT_EMERGENCY_DATA.residents) {
            prevMap = {};
            window.DEFAULT_EMERGENCY_DATA.residents.forEach(r => {
                prevMap[r.id] = {
                    active: r.active !== false,
                    er_target: Number(r.er_target) || 0,
                    con_target: Number(r.con_target) || 0,
                    dc_target: Number(r.dc_target) || 0,
                    rs_target: Number(r.rs_target) || 0
                };
            });
        }

        return prevMap;
    }

    function copyAllocationsFromPreviousMonth() {
        const prev = getPreviousMonth(state.year, state.month);
        const prevMap = getPreviousMonthAllocations(state.hospitalId, state.year, state.month);
        if (!prevMap || Object.keys(prevMap).length === 0) {
            showNotification('لا توجد أنصبة مسجلة في الشهر السابق لنسخها', 'warning');
            return false;
        }

        pushScheduleHistory('نسخ أنصبة الأطباء من الشهر السابق');

        let copiedCount = 0;
        (state.residents || []).forEach(r => {
            if (prevMap[r.id]) {
                if (prevMap[r.id].active !== undefined) {
                    r.active = Boolean(prevMap[r.id].active);
                }
                r.er_target = Number(prevMap[r.id].er_target) || 0;
                r.con_target = Number(prevMap[r.id].con_target) || 0;
                r.dc_target = Number(prevMap[r.id].dc_target) || 0;
                r.rs_target = Number(prevMap[r.id].rs_target) || 0;
                copiedCount++;
            }
        });

        saveCurrentMonthAllocationsToStore();
        saveState();
        updateDutyDashboard();
        refreshDBView();
        showNotification(`تم نسخ ونقل أنصبة ${copiedCount} طبيب من شهر (${prev.month}/${prev.year}) بنجاح`, 'success');
        return true;
    }

    function saveCurrentHospitalResidents() {
        if (!state.hospitalResidents) state.hospitalResidents = {};
        if (state.hospitalId && Array.isArray(state.residents)) {
            state.hospitalResidents[state.hospitalId] = JSON.parse(JSON.stringify(state.residents));
        }
    }

    function loadMonthScheduleFromStore(hospId, year, month) {
        if (!state.monthlySchedules) state.monthlySchedules = {};
        const key = `${hospId}_${year}_${month}`;

        let loaded = null;
        try {
            const raw = localStorage.getItem(MONTH_STORAGE_PREFIX + key);
            if (raw) {
                loaded = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('Error reading month schedule from localStorage', e);
        }

        if (!loaded && state.monthlySchedules[key]) {
            loaded = state.monthlySchedules[key];
        }

        // Bundled initial September 2026 data only for default Iraqi hospital
        if (!loaded && hospId === 'iraqi' && year === 2026 && month === 9 && window.DEFAULT_EMERGENCY_DATA && window.DEFAULT_EMERGENCY_DATA.schedules) {
            loaded = window.DEFAULT_EMERGENCY_DATA.schedules;
        }

        if (loaded) {
            state.schedules = JSON.parse(JSON.stringify(loaded));
        } else {
            // Strictly empty clean schedule for any unfilled month
            state.schedules = { er: [], con: [], dc: [], rs: [] };
        }

        // Clear undo/redo stacks when loading a different month schedule
        state.undoStack = [];
        state.redoStack = [];

        ensureScheduleIntegrity();
    }

    // =========================================================================
    // UNDO / REDO HISTORY MANAGEMENT (PER SCHEDULE & MONTH)
    // =========================================================================

    function pushScheduleHistory(desc) {
        if (!state.undoStack) state.undoStack = [];
        if (!state.redoStack) state.redoStack = [];

        state.undoStack.push({
            schedules: JSON.parse(JSON.stringify(state.schedules)),
            residents: JSON.parse(JSON.stringify(state.residents || [])),
            tab: state.activeTab,
            desc: desc || 'تعديل جدول'
        });

        if (state.undoStack.length > 50) {
            state.undoStack.shift();
        }
        state.redoStack = [];
        updateScheduleUndoRedoUI();
    }

    function undoScheduleAction() {
        if (!state.undoStack || state.undoStack.length === 0) {
            showNotification('لا توجد عمليات سابقة للتراجع عنها', 'warning');
            return;
        }

        if (!state.redoStack) state.redoStack = [];
        state.redoStack.push({
            schedules: JSON.parse(JSON.stringify(state.schedules)),
            residents: JSON.parse(JSON.stringify(state.residents || [])),
            tab: state.activeTab,
            desc: 'إعادة التعديل'
        });

        const prev = state.undoStack.pop();
        state.schedules = JSON.parse(JSON.stringify(prev.schedules));
        if (prev.residents) {
            state.residents = JSON.parse(JSON.stringify(prev.residents));
        }
        if (prev.tab && prev.tab !== state.activeTab && prev.tab !== 'db') {
            state.activeTab = prev.tab;
        }

        saveCurrentMonthAllocationsToStore();
        saveState();
        updateDutyDashboard();
        renderActiveTab();
        refreshDBView();
        updateScheduleUndoRedoUI();
        showNotification(`تم التراجع عن: ${prev.desc || 'آخر تعديل'}`, 'info');
    }

    function redoScheduleAction() {
        if (!state.redoStack || state.redoStack.length === 0) {
            showNotification('لا توجد عمليات لإعادتها', 'warning');
            return;
        }

        if (!state.undoStack) state.undoStack = [];
        state.undoStack.push({
            schedules: JSON.parse(JSON.stringify(state.schedules)),
            residents: JSON.parse(JSON.stringify(state.residents || [])),
            tab: state.activeTab,
            desc: 'إعادة التعديل'
        });

        const next = state.redoStack.pop();
        state.schedules = JSON.parse(JSON.stringify(next.schedules));
        if (next.residents) {
            state.residents = JSON.parse(JSON.stringify(next.residents));
        }
        if (next.tab && next.tab !== state.activeTab && next.tab !== 'db') {
            state.activeTab = next.tab;
        }

        saveCurrentMonthAllocationsToStore();
        saveState();
        updateDutyDashboard();
        renderActiveTab();
        refreshDBView();
        updateScheduleUndoRedoUI();
        showNotification('تمت إعادة تطبيق التعديل', 'info');
    }

    function renderScheduleUndoRedoButtons() {
        const canUndo = Boolean(state.undoStack && state.undoStack.length > 0);
        const canRedo = Boolean(state.redoStack && state.redoStack.length > 0);

        return `
            <div class="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 shadow-2xs">
                <button type="button" onclick="undoScheduleAction()" ${!canUndo ? 'disabled' : ''} 
                    class="btn-schedule-undo px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${!canUndo ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50' : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 shadow-xs active:scale-95'}" 
                    title="تراجع عن آخر تعديل (Ctrl+Z)">
                    <i class="fas fa-undo text-[11px]"></i>
                    <span>تراجع</span>
                </button>
                <div class="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5"></div>
                <button type="button" onclick="redoScheduleAction()" ${!canRedo ? 'disabled' : ''} 
                    class="btn-schedule-redo px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${!canRedo ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50' : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 shadow-xs active:scale-95'}" 
                    title="إعادة التعديل (Ctrl+Y)">
                    <i class="fas fa-redo text-[11px]"></i>
                    <span>إعادة</span>
                </button>
            </div>
        `;
    }

    function updateScheduleUndoRedoUI() {
        const canUndo = Boolean(state.undoStack && state.undoStack.length > 0);
        const canRedo = Boolean(state.redoStack && state.redoStack.length > 0);

        document.querySelectorAll('.btn-schedule-undo').forEach(btn => {
            btn.disabled = !canUndo;
            if (!canUndo) {
                btn.className = 'btn-schedule-undo px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50';
            } else {
                btn.className = 'btn-schedule-undo px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 shadow-xs active:scale-95';
            }
        });

        document.querySelectorAll('.btn-schedule-redo').forEach(btn => {
            btn.disabled = !canRedo;
            if (!canRedo) {
                btn.className = 'btn-schedule-redo px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50';
            } else {
                btn.className = 'btn-schedule-redo px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 shadow-xs active:scale-95';
            }
        });
    }

    // =========================================================================
    // RESIDENTS DB UNDO / REDO HISTORY SYSTEM (DEDICATED STACK)
    // =========================================================================

    const DB_HISTORY_MAX = 50;
    let dbHistoryStack = [];
    let dbHistoryIndex = -1;
    let isDbHistoryNavigating = false;
    let dbTargetDebounceTimer = null;

    function captureDBSnapshot(desc = '') {
        return {
            residents: JSON.parse(JSON.stringify(state.residents || [])),
            monthlyAllocations: JSON.parse(JSON.stringify(state.monthlyAllocations || {})),
            specialtyColors: JSON.parse(JSON.stringify(state.specialtyColors || {})),
            schedules: JSON.parse(JSON.stringify(state.schedules || {})),
            desc: desc || 'تعديل في قاعدة المقيمين'
        };
    }

    function initDBHistory() {
        if (!Array.isArray(dbHistoryStack) || dbHistoryStack.length === 0) {
            dbHistoryStack = [captureDBSnapshot('الحالة الابتدائية')];
            dbHistoryIndex = 0;
            updateDBUndoRedoUI();
        }
    }

    function pushDBHistory(desc = '') {
        if (isDbHistoryNavigating) return;

        // If not initialized, initialize with current state first
        if (!Array.isArray(dbHistoryStack) || dbHistoryStack.length === 0) {
            dbHistoryStack = [captureDBSnapshot('الحالة الابتدائية')];
            dbHistoryIndex = 0;
        }

        // Discard any redos beyond current index
        if (dbHistoryIndex < dbHistoryStack.length - 1) {
            dbHistoryStack = dbHistoryStack.slice(0, dbHistoryIndex + 1);
        }

        const snapshot = captureDBSnapshot(desc);
        dbHistoryStack.push(snapshot);
        if (dbHistoryStack.length > DB_HISTORY_MAX) {
            dbHistoryStack.shift();
        }
        dbHistoryIndex = dbHistoryStack.length - 1;
        updateDBUndoRedoUI();
    }

    function undoDBAction() {
        if (dbHistoryIndex > 0) {
            dbHistoryIndex--;
            const snap = dbHistoryStack[dbHistoryIndex];
            applyDBSnapshot(snap);
            showNotification(`تم التراجع عن: ${snap.desc || 'آخر تعديل في قاعدة المقيمين'}`, 'info');
        } else {
            showNotification('لا توجد عمليات سابقة للتراجع عنها في اللوحة', 'warning');
        }
    }

    function redoDBAction() {
        if (dbHistoryIndex < dbHistoryStack.length - 1) {
            dbHistoryIndex++;
            const snap = dbHistoryStack[dbHistoryIndex];
            applyDBSnapshot(snap);
            showNotification(`تمت إعادة تطبيق: ${snap.desc || 'التعديل'}`, 'info');
        } else {
            showNotification('لا توجد عمليات لإعادة تطبيقها', 'warning');
        }
    }

    function applyDBSnapshot(snap) {
        if (!snap) return;
        isDbHistoryNavigating = true;
        try {
            state.residents = JSON.parse(JSON.stringify(snap.residents || []));
            state.monthlyAllocations = JSON.parse(JSON.stringify(snap.monthlyAllocations || {}));
            state.specialtyColors = JSON.parse(JSON.stringify(snap.specialtyColors || {}));
            if (snap.schedules) {
                state.schedules = JSON.parse(JSON.stringify(snap.schedules));
            }

            syncCurrentMonthAllocations();
            saveCurrentMonthAllocationsToStore();
            saveCurrentMonthScheduleToStore();
            saveCurrentHospitalResidents();
            saveState();
            refreshDBView();
            updateDutyDashboard();
            renderActiveTab();
            updateDBUndoRedoUI();
        } finally {
            isDbHistoryNavigating = false;
        }
    }

    function updateDBUndoRedoUI() {
        const canUndo = dbHistoryIndex > 0;
        const canRedo = dbHistoryIndex < dbHistoryStack.length - 1;

        document.querySelectorAll('.db-undo-btn').forEach(btn => {
            btn.disabled = !canUndo;
            if (canUndo) {
                btn.classList.remove('opacity-40', 'cursor-not-allowed');
            } else {
                btn.classList.add('opacity-40', 'cursor-not-allowed');
            }
        });

        document.querySelectorAll('.db-redo-btn').forEach(btn => {
            btn.disabled = !canRedo;
            if (canRedo) {
                btn.classList.remove('opacity-40', 'cursor-not-allowed');
            } else {
                btn.classList.add('opacity-40', 'cursor-not-allowed');
            }
        });
    }

    function clearCurrentSchedule(sheetType) {
        const sheetLabels = {
            er: 'جدول خفارات الطوارئ (ER)',
            con: 'جدول الاستشارية الخافرة (Con)',
            dc: 'جدول شهادات الوفاة (DC)',
            rs_er: 'جدول طوارئ الإسناد (RS - ER)',
            rs_wards: 'جدول ردهات الإسناد (RS - Wards)'
        };
        const title = sheetLabels[sheetType] || 'الجدول';

        const confirmed = confirm(`⚠️ هل أنت متأكد من رغبتك في تفريغ ومسح ${title} لشهر (${state.monthYear}) بالكامل؟\n\n(ملاحظة: يمكنك التراجع عن هذه العملية في أي وقت بالضغط على زر "تراجع" أو Ctrl+Z)`);
        if (!confirmed) return;

        pushScheduleHistory(`مسح ${title}`);

        if (sheetType === 'er') {
            (state.schedules.er || []).forEach(day => {
                day.morning = '';
                day.afternoon = '';
                day.preNight = '';
                day.lateNight = '';
            });
        } else if (sheetType === 'con') {
            (state.schedules.con || []).forEach(day => {
                day.doctor = '';
            });
        } else if (sheetType === 'dc') {
            (state.schedules.dc || []).forEach(day => {
                day.doctor = '';
            });
        } else if (sheetType === 'rs_er') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);
            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    day.er_morning = '';
                    day.er_afternoon = '';
                    day.er_preNight = '';
                    day.er_lateNight = '';
                }
            });
        } else if (sheetType === 'rs_wards') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);
            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    day.ward_private = '';
                    day.ward_floor4 = '';
                    day.ward_floor5 = '';
                }
            });
        }

        saveState();
        renderActiveTab();
        updateDutyDashboard();
        showNotification(`تم مسح وتفريغ ${title} بنجاح`, 'info');
    }

    function updateResidentRowFulfillment(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        const scheduledCounts = getScheduledCountsMap();
        const cleanName = normalizeArabic(res.name);
        const stats = scheduledCounts[cleanName] || { normalScheduled: 0, extraScheduled: 0, erFilled: 0 };
        const normalTarget = (Number(res.er_target) || 0) + (Number(res.con_target) || 0) + (Number(res.dc_target) || 0);
        const isFulfilled = (stats.normalScheduled >= normalTarget) && normalTarget > 0;
        const isExpired = isResidentExpired(res, state.year, state.month);

        const tr = document.querySelector(`tr[data-resident-id="${resId}"]`);
        if (!tr) return;

        const hasActiveRS = state.rsEnabled && (stats.extraScheduled > 0 || (Number(res.rs_target) || 0) > 0);
        tr.setAttribute('data-quota-status', isFulfilled ? 'fulfilled' : 'unfulfilled');
        tr.setAttribute('data-has-extra', hasActiveRS ? 'true' : 'false');

        // Update RS dot badge beside doctor name
        const nameCell = tr.querySelector('.resident-name-cell') || tr.querySelector('td:nth-child(2)');
        if (nameCell) {
            const extraDotEl = nameCell.querySelector('.rs-dot-badge');
            const flexDiv = nameCell.querySelector('.flex');
            if (hasActiveRS && !extraDotEl && flexDiv) {
                const dotSpan = document.createElement('span');
                dotSpan.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shrink-0 ring-2 ring-white dark:ring-slate-900 shadow-xs rs-dot-badge';
                dotSpan.title = `خفارات إسناد إضافية (مجدول: ${stats.extraScheduled} / نصاب: ${res.rs_target || 0})`;
                flexDiv.prepend(dotSpan);
            } else if (!hasActiveRS && extraDotEl) {
                extraDotEl.remove();
            }
        }

        let statusBadge = '';
        if (!res.active) {
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">معطّل</span>`;
        } else if (isExpired) {
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">منتهي الإقامة</span>`;
        } else if (isFulfilled) {
            tr.className = tr.className.replace(/border-l-rose-400 bg-rose-50\/\d+/g, '').replace(/border-l-emerald-500 bg-emerald-50\/\d+/g, '') + ' bg-emerald-50/40 dark:bg-emerald-950/15 border-l-4 border-l-emerald-500';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">مكتمل (${stats.normalScheduled}/${normalTarget})</span>`;
        } else {
            tr.className = tr.className.replace(/border-l-emerald-500 bg-emerald-50\/\d+/g, '').replace(/border-l-rose-400 bg-rose-50\/\d+/g, '') + ' bg-rose-50/30 dark:bg-rose-950/10 border-l-4 border-l-rose-400';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">غير مكتمل (${stats.normalScheduled}/${normalTarget})</span>`;
        }

        const badgeCell = tr.querySelector('.resident-status-badge-cell');
        if (badgeCell) {
            badgeCell.innerHTML = `<div>${statusBadge}</div>`;
        }
    }

    function importResidentsFromHospital(hospId) {
        let hubResidents = [];
        if (window.Hub && typeof window.Hub.getResidents === 'function') {
            hubResidents = window.Hub.getResidents(hospId) || [];
        }
        if (hubResidents.length === 0 && window.Hub && typeof window.Hub.getDatabase === 'function') {
            const db = window.Hub.getDatabase();
            if (db && Array.isArray(db.residents)) {
                hubResidents = db.residents.filter(r => Array.isArray(r.hospitals) && r.hospitals.includes(hospId));
            }
        }

        if (hubResidents.length === 0) {
            showNotification(`لم يتم العثور على أطباء مسجلين لمستشفى "${state.hospitalName}" في HOSP HUB`, 'warning');
            state.residents = [];
            if (!state.hospitalResidents) state.hospitalResidents = {};
            state.hospitalResidents[hospId] = [];
            saveState();
            renderActiveTab();
            return false;
        }

        const femaleNames = ['فاطمة', 'زينب', 'زهراء', 'مريم', 'نور', 'سارة', 'هدى', 'شهد', 'آية', 'اية', 'رشا', 'دعاء', 'رنا', 'منى', 'اسراء', 'إسراء', 'أمل', 'امل', 'ريم', 'حوراء', 'تبارك', 'ضحى', 'بنين', 'تقى', 'فرح'];

        const mapped = hubResidents.map((r, idx) => {
            let cleanName = (r.name || '').trim();
            if (cleanName && !cleanName.startsWith('د.') && !cleanName.startsWith('د ')) {
                cleanName = 'د. ' + cleanName;
            }

            let sex = r.sex || 'M';
            if (!r.sex) {
                const parts = cleanName.split(/\s+/);
                if (parts.length > 1) {
                    const first = parts[1];
                    if (femaleNames.includes(first) || first.endsWith('ة') || first.endsWith('اء')) {
                        sex = 'F';
                    }
                }
            }

            let spec = r.spec || r.dept || r.department || 'General';
            if (window.Hub && typeof window.Hub.getSpecialtyName === 'function') {
                const sName = window.Hub.getSpecialtyName(spec);
                if (sName) spec = sName;
            }

            return {
                id: `er_${hospId}_${r.id || (idx + 1)}`,
                row: idx + 1,
                name: cleanName,
                sex: sex,
                specialty: spec,
                board: r.board || 'None',
                stage: r.stage || 'الأولى',
                er_target: 0,
                con_target: 0,
                dc_target: 0,
                rs_target: 0,
                notes: r.notes || '',
                active: r.active !== false,
                hospitals: [hospId],
                phone: r.phone || '',
                expiryMonth: '',
                prefDays: [],
                prefShifts: [],
                noConsecutiveDays: true,
                preferences: { prefDays: [], prefShifts: [] }
            };
        });

        state.residents = mapped;
        if (!state.hospitalResidents) state.hospitalResidents = {};
        state.hospitalResidents[hospId] = mapped;
        saveState();
        pushDBHistory(`استيراد ${mapped.length} طبيب مقيم لمستشفى (${state.hospitalName})`);
        updateDutyDashboard();
        renderActiveTab();
        updateDBUndoRedoUI();
        showNotification(`تم استيراد ${mapped.length} طبيب مقيم بنجاح لمستشفى ${state.hospitalName}`, 'success');
        return true;
    }

    function saveState() {
        saveCurrentMonthScheduleToStore();
        saveCurrentHospitalResidents();
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
        if (hospId === state.hospitalId) return;

        // 1. Save current month schedule, allocations & current residents
        saveCurrentMonthScheduleToStore();
        saveCurrentMonthAllocationsToStore();
        saveCurrentHospitalResidents();

        // 2. Set new hospital
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

        // Restore hospital signatories if recorded
        if (!state.hospitalSignatories) state.hospitalSignatories = {};
        if (state.hospitalSignatories[hospId]) {
            if (state.hospitalSignatories[hospId].headOfResidents) {
                state.headOfResidents = state.hospitalSignatories[hospId].headOfResidents;
            }
            if (state.hospitalSignatories[hospId].headOfHospital) {
                state.headOfHospital = state.hospitalSignatories[hospId].headOfHospital;
            }
        }

        // 3. Load or offer to import residents for this hospital
        if (!state.hospitalResidents) state.hospitalResidents = {};
        if (state.hospitalResidents[hospId] && state.hospitalResidents[hospId].length > 0) {
            state.residents = JSON.parse(JSON.stringify(state.hospitalResidents[hospId]));
        } else {
            state.residents = [];
            const shouldImport = confirm(`مستشفى "${hospName}" لا يحتوي على أطباء مقيمين مسجلين في جدول الطوارئ حالياً.\n\nهل ترغب في استيراد الأطباء المقيمين لهذا المستشفى من قاعدة بيانات HOSP HUB؟`);
            if (shouldImport) {
                importResidentsFromHospital(hospId);
            }
        }

        // 4. Load schedule & allocations for this hospital and current month/year
        loadMonthScheduleFromStore(hospId, state.year, state.month);
        loadMonthAllocationsFromStore(hospId, state.year, state.month);

        saveState();
        syncMetaInputsWithState();
        updateDutyDashboard();
        renderActiveTab();
        showNotification(`تم التبديل إلى: ${state.hospitalName}`, 'info');
    }

    function onMonthYearChange(monthVal, yearVal) {
        // 1. Save current month schedule & allocations
        saveCurrentMonthScheduleToStore();
        saveCurrentMonthAllocationsToStore();
        
        // 2. Update month and year
        state.month = parseInt(monthVal) || state.month;
        state.year = parseInt(yearVal) || state.year;
        
        const monthNames = [
            'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
            'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
        ];
        state.monthYear = `${monthNames[state.month - 1]} ${state.year}`;
        
        // 3. Load schedule for newly selected month
        loadMonthScheduleFromStore(state.hospitalId, state.year, state.month);
        const hasAlloc = loadMonthAllocationsFromStore(state.hospitalId, state.year, state.month);
        
        // 4. If empty month, check if previous month has allocations and offer to transfer
        if (!hasAlloc) {
            const prevAlloc = getPreviousMonthAllocations(state.hospitalId, state.year, state.month);
            if (prevAlloc && Object.keys(prevAlloc).length > 0) {
                const prev = getPreviousMonth(state.year, state.month);
                const shouldCopy = confirm(`شهر (${state.monthYear}) لا يحتوي على أنصبة خفارات محددة للأطباء المقيمين.\n\nهل ترغب بنسخ ونقل أنصبة الأطباء من الشهر السابق (${prev.month}/${prev.year}) تلقائياً؟`);
                if (shouldCopy) {
                    copyAllocationsFromPreviousMonth();
                }
            }
        }
        
        saveState();
        syncMetaInputsWithState();
        updateDutyDashboard();
        renderActiveTab();
        showNotification(`تم التبديل إلى جدول شهر: ${state.monthYear}`, 'info');
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
        if (!state.hospitalSignatories) state.hospitalSignatories = {};
        if (state.hospitalId) {
            if (!state.hospitalSignatories[state.hospitalId]) state.hospitalSignatories[state.hospitalId] = {};
            state.hospitalSignatories[state.hospitalId].headOfResidents = state.headOfResidents;
        }
        saveState();
        showNotification('تم حفظ اسم مسؤول الأطباء المقيمين بنجاح', 'success');
    }

    function onHeadOfHospitalChange(val) {
        state.headOfHospital = val.trim();
        if (!state.hospitalSignatories) state.hospitalSignatories = {};
        if (state.hospitalId) {
            if (!state.hospitalSignatories[state.hospitalId]) state.hospitalSignatories[state.hospitalId] = {};
            state.hospitalSignatories[state.hospitalId].headOfHospital = state.headOfHospital;
        }
        saveState();
        showNotification('تم حفظ اسم مدير المستشفى بنجاح', 'success');
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

        // 5. Hospital On-Call Duty (checking the resident's registered hospital via Hub)
        const hospDuties = getHospitalDutiesForDoctor(doctorName, dateStr);
        hospDuties.forEach(hd => {
            duties.push({
                type: 'hospital',
                slotKey: hd.specCode,
                label: hd.hospitalName ? `خفارة اختصاص رسمية في ${hd.hospitalName}: ${hd.specName}` : `خفارة اختصاص في المستشفى: ${hd.specName}`
            });
        });

        return duties;
    }

    function getHospitalDutiesForDoctor(doctorName, dateStr) {
        if (!doctorName || !doctorName.trim()) return [];
        if (!window.Hub || typeof window.Hub.getHospital !== 'function') return [];

        const cleanTarget = normalizeArabic(doctorName);
        let targetHospIds = [];

        // 1. Check current resident list in ER state
        const localRes = (state.residents || []).find(r => normalizeArabic(r.name) === cleanTarget);
        if (localRes && Array.isArray(localRes.hospitals) && localRes.hospitals.length > 0) {
            targetHospIds = [...localRes.hospitals];
        } else if (localRes && localRes.hospitalId) {
            targetHospIds = [localRes.hospitalId];
        }

        // 2. Check Hub database
        if (targetHospIds.length === 0 && typeof window.Hub.getResident === 'function') {
            const hubRes = window.Hub.getResident(doctorName);
            if (hubRes && Array.isArray(hubRes.hospitals) && hubRes.hospitals.length > 0) {
                targetHospIds = [...hubRes.hospitals];
            }
        }

        // 3. Fallback
        if (targetHospIds.length === 0) {
            targetHospIds = [state.hospitalId || 'iraqi'];
        }

        // Always check active state.hospitalId as well
        if (state.hospitalId && !targetHospIds.includes(state.hospitalId)) {
            targetHospIds.push(state.hospitalId);
        }

        const parts = dateStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const hospDateStr = formatHospitalDateStr(y, m, d);

        const matched = [];

        targetHospIds.forEach(hId => {
            const hosp = window.Hub.getHospital(hId);
            if (!hosp || !Array.isArray(hosp.schedule)) return;
            const hospName = hosp.name_ar || hosp.hospitalName || hId;

            hosp.schedule.forEach(item => {
                if (item.date === hospDateStr && item.name && normalizeArabic(item.name) === cleanTarget) {
                    const specName = (window.Hub.getSpecialtyName && window.Hub.getSpecialtyName(item.specCode)) || item.specCode;
                    matched.push({
                        hospitalId: hId,
                        hospitalName: hospName,
                        specCode: item.specCode,
                        specName: specName,
                        name: item.name
                    });
                }
            });
        });

        return matched;
    }

    function getAllHospitalOnCallDoctors(dateStr) {
        if (!window.Hub || typeof window.Hub.getHospital !== 'function') return [];

        const parts = dateStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const hospDateStr = formatHospitalDateStr(y, m, d);

        const onCall = [];
        const hospIds = new Set([state.hospitalId || 'iraqi']);
        (state.residents || []).forEach(r => {
            if (Array.isArray(r.hospitals)) {
                r.hospitals.forEach(h => hospIds.add(h));
            } else if (r.hospitalId) {
                hospIds.add(r.hospitalId);
            }
        });

        hospIds.forEach(hId => {
            const hosp = window.Hub.getHospital(hId);
            if (!hosp || !Array.isArray(hosp.schedule)) return;
            const hospName = hosp.name_ar || hosp.hospitalName || hId;

            hosp.schedule.forEach(item => {
                if (item.date === hospDateStr && item.name && item.name.trim()) {
                    const specName = (window.Hub.getSpecialtyName && window.Hub.getSpecialtyName(item.specCode)) || item.specCode;
                    onCall.push({
                        name: item.name,
                        cleanName: normalizeArabic(item.name),
                        hospitalId: hId,
                        hospitalName: hospName,
                        specCode: item.specCode,
                        specName: specName
                    });
                }
            });
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

        pushScheduleHistory('تفريغ الخانة');
        dayEntry[slotKey] = '';
        saveState();
        renderActiveTab();
        showNotification('تم إفراغ الخلية في هذا الجدول بنجاح', 'info');
    }

    // =========================================================================
    // MONTHLY DUTY COUNTING DASHBOARD (RENOVATED EXECUTIVE COCKPIT)
    // =========================================================================

    function updateDutyDashboard() {
        const daysCount = getDaysInMonth(state.year, state.month);

        const activeDocs = (state.residents || []).filter(r => r.active && !isResidentExpired(r, state.year, state.month));
        const totalDocsCount = (state.residents || []).length;
        const inactiveDocs = (state.residents || []).filter(r => !r.active || isResidentExpired(r, state.year, state.month));
        
        const femaleDocs = activeDocs.filter(r => r.sex === 'F' || r.gender === 'female' || r.gender === 'أنثى');
        const maleDocs = activeDocs.filter(r => r.sex === 'M' || r.gender === 'male' || r.gender === 'ذكر');
        const boardDocs = activeDocs.filter(r => r.board === 'Arabic' || r.board === 'Iraqi' || r.board === 'عربي' || r.board === 'عراقي');

        const totalDocEl = document.getElementById('stat-total-doctors');
        if (totalDocEl) totalDocEl.textContent = `${activeDocs.length} / ${totalDocsCount}`;

        const dbNavBadge = document.getElementById('db-nav-count-badge');
        if (dbNavBadge) dbNavBadge.textContent = `${activeDocs.length} طبيب`;

        // 1. ER Duties (4 shifts/day)
        const erRequired = daysCount * 4;
        const erAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.er_target) || 0), 0);
        let erScheduled = 0;
        (state.schedules.er || []).forEach(day => {
            if (day.morning && day.morning.trim()) erScheduled++;
            if (day.afternoon && day.afternoon.trim()) erScheduled++;
            if (day.preNight && day.preNight.trim()) erScheduled++;
            if (day.lateNight && day.lateNight.trim()) erScheduled++;
        });
        const erRemaining = Math.max(0, erRequired - erScheduled);
        const erPercent = erRequired > 0 ? Math.min(100, Math.round((erScheduled / erRequired) * 100)) : 0;
        const erAllocDiff = erAllocated - erRequired;

        // 2. Con Duties (1 shift/day)
        const conRequired = daysCount * 1;
        const conAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.con_target) || 0), 0);
        let conScheduled = 0;
        (state.schedules.con || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) conScheduled++;
        });
        const conRemaining = Math.max(0, conRequired - conScheduled);
        const conPercent = conRequired > 0 ? Math.min(100, Math.round((conScheduled / conRequired) * 100)) : 0;
        const conAllocDiff = conAllocated - conRequired;

        // 3. DC Duties (1 shift/day)
        const dcRequired = daysCount * 1;
        const dcAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.dc_target) || 0), 0);
        let dcScheduled = 0;
        (state.schedules.dc || []).forEach(day => {
            if (day.doctor && day.doctor.trim()) dcScheduled++;
        });
        const dcRemaining = Math.max(0, dcRequired - dcScheduled);
        const dcPercent = dcRequired > 0 ? Math.min(100, Math.round((dcScheduled / dcRequired) * 100)) : 0;
        const dcAllocDiff = dcAllocated - dcRequired;

        // 4. RS Duties (Rotators Strike)
        let rsDaysCount = 0;
        let rsErScheduled = 0;
        let rsWardsScheduled = 0;
        let rsAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.rs_target) || 0), 0);
        let rsErRequired = 0;
        let rsWardsRequired = 0;
        let rsTotalRequired = 0;
        let rsTotalScheduled = 0;
        let rsRemaining = 0;
        let rsPercent = 0;
        let rsAllocDiff = 0;

        if (state.rsEnabled && state.rsStartDate && state.rsEndDate) {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || daysCount;
            rsDaysCount = Math.max(0, endDay - startDay + 1);
            rsErRequired = rsDaysCount * 4;
            rsWardsRequired = rsDaysCount * 3;
            rsTotalRequired = rsErRequired + rsWardsRequired;

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

            rsTotalScheduled = rsErScheduled + rsWardsScheduled;
            rsRemaining = Math.max(0, rsTotalRequired - rsTotalScheduled);
            rsPercent = rsTotalRequired > 0 ? Math.min(100, Math.round((rsTotalScheduled / rsTotalRequired) * 100)) : 0;
            rsAllocDiff = rsAllocated - rsTotalRequired;
        }

        // Overall Monthly Hospital Duty Totals
        const overallRequired = erRequired + conRequired + dcRequired + (state.rsEnabled ? rsTotalRequired : 0);
        const overallScheduled = erScheduled + conScheduled + dcScheduled + (state.rsEnabled ? rsTotalScheduled : 0);
        const overallAllocated = erAllocated + conAllocated + dcAllocated + (state.rsEnabled ? rsAllocated : 0);
        const overallPercent = overallRequired > 0 ? Math.min(100, Math.round((overallScheduled / overallRequired) * 100)) : 0;
        const overallRemaining = Math.max(0, overallRequired - overallScheduled);
        const overallAllocDiff = overallAllocated - overallRequired;

        const container = document.getElementById('duty-dashboard-grid');
        if (!container) return;

        const monthNames = [
            'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
            'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
        ];
        const currentMonthName = monthNames[state.month - 1] || `شهر ${state.month}`;

        const makeBalancePill = (scheduled, required) => {
            const diff = scheduled - required;
            if (diff === 0) {
                return `
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-xs">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>مكتمل تماماً</span>
                    </span>
                `;
            } else if (diff < 0) {
                return `
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-xs">
                        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                        <span>نقص (${diff})</span>
                    </span>
                `;
            } else {
                return `
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 shadow-xs">
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        <span>زيادة (+${diff})</span>
                    </span>
                `;
            }
        };

        const makeAllocatedPill = (allocated, required) => {
            const diff = allocated - required;
            if (diff === 0) {
                return `<span class="text-emerald-600 dark:text-emerald-400 font-bold">مطابق (${allocated})</span>`;
            } else if (diff < 0) {
                return `<span class="text-rose-600 dark:text-rose-400 font-bold">عجز (${diff})</span>`;
            } else {
                return `<span class="text-amber-600 dark:text-amber-400 font-bold">فائض (+${diff})</span>`;
            }
        };

        // Render Renovated Executive Cockpit & 4 Interactive Track Cards
        container.innerHTML = `
            <!-- 1. Executive Operations & Hospital Readiness Suite -->
            <div class="relative overflow-hidden rounded-3xl glass-panel border border-slate-200/90 dark:border-slate-800 shadow-sm p-4 sm:p-5">
                <!-- Ambient Glow Accents -->
                <div class="pointer-events-none absolute -top-24 -left-20 w-80 h-80 bg-gradient-to-br from-rose-500/10 via-sky-500/10 to-emerald-500/10 rounded-full blur-3xl opacity-60"></div>
                <div class="pointer-events-none absolute -bottom-24 -right-20 w-80 h-80 bg-gradient-to-tr from-amber-500/10 via-rose-500/10 to-indigo-500/10 rounded-full blur-3xl opacity-60"></div>

                <div class="relative z-10 space-y-4">
                    <!-- Top Operational Header -->
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800/80">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-600 via-rose-500 to-red-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/25 shrink-0">
                                <i class="fas fa-chart-line text-base"></i>
                            </div>
                            <div>
                                <div class="flex items-center gap-2 flex-wrap">
                                    <h2 class="text-sm sm:text-base font-black text-slate-900 dark:text-slate-50 tracking-tight">
                                        لوحة الجاهزية التشغيلية وتغطية الخفارات
                                    </h2>
                                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 font-mono">
                                        ${currentMonthName} ${state.year}
                                    </span>
                                </div>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                    <span class="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                        <i class="fas fa-hospital text-slate-400"></i>
                                        <span>${state.hospitalName || 'مستشفى الصدر التعليمي'}</span>
                                    </span>
                                    <span class="text-slate-300 dark:text-slate-700">•</span>
                                    <span>عدد أيام الشهر: <strong>${daysCount} يوماً</strong></span>
                                    ${state.rsEnabled ? `
                                        <span class="text-slate-300 dark:text-slate-700">•</span>
                                        <span class="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                                            <i class="fas fa-triangle-exclamation text-[10px]"></i>
                                            <span>إضراب المقيمين مفعل (${rsDaysCount} يوم)</span>
                                        </span>
                                    ` : ''}
                                </p>
                            </div>
                        </div>

                        <!-- Overall Readiness Badge -->
                        <div class="flex items-center gap-2 self-start sm:self-center">
                            ${overallPercent === 100 ? `
                                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold text-xs shadow-xs">
                                    <span class="relative flex h-2.5 w-2.5">
                                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                    </span>
                                    <span>تغطية مكتملة 100% (جاهز للاعتماد)</span>
                                </div>
                            ` : `
                                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 font-bold text-xs shadow-xs">
                                    <span class="relative flex h-2.5 w-2.5">
                                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                                    </span>
                                    <span>قيد التعبئة (${overallRemaining} شاغر غير مسند)</span>
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- 4 High-Impact Cockpit Metric Cards -->
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <!-- 1. Coverage Percentage -->
                        <div class="p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
                            <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                                <span class="font-bold text-[11px]">نسبة التغطية الكلية</span>
                                <span class="text-xs font-black font-mono text-rose-600 dark:text-rose-400">${overallPercent}%</span>
                            </div>
                            <div class="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-slate-50 tracking-tight">
                                ${overallScheduled} <span class="text-xs font-normal text-slate-400 dark:text-slate-500">/ ${overallRequired} خفارة</span>
                            </div>
                            <div class="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mt-2 overflow-hidden">
                                <div class="h-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500 rounded-full transition-all duration-500" style="width: ${overallPercent}%"></div>
                            </div>
                        </div>

                        <!-- 2. Quota Balance -->
                        <div class="p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
                            <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                                <span class="font-bold text-[11px]">رصيد الأنصبة بالقاعدة</span>
                                <span class="text-[10px] font-black px-1.5 py-0.5 rounded-md ${overallAllocDiff >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'}">
                                    ${overallAllocDiff >= 0 ? `+${overallAllocDiff} كفاية` : `${overallAllocDiff} عجز`}
                                </span>
                            </div>
                            <div class="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-slate-50 tracking-tight">
                                ${overallAllocated} <span class="text-xs font-normal text-slate-400 dark:text-slate-500">خفارة مقررة</span>
                            </div>
                            <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-2 truncate">
                                ${overallAllocDiff === 0 ? 'مجموع أنصبة الأطباء يطابق المطلوب تماماً' : overallAllocDiff > 0 ? `فائض ${overallAllocDiff} خفارة في أنصبة الأطباء` : `عجز أنصبة الأطباء بمقدار ${Math.abs(overallAllocDiff)} خفارة`}
                            </p>
                        </div>

                        <!-- 3. Medical Staff Pool (Distinct Executive Style) -->
                        <div onclick="switchTab('db')" class="relative overflow-hidden p-3 rounded-2xl bg-gradient-to-br from-indigo-50/95 via-purple-50/60 to-slate-50/80 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-slate-900/60 border-2 border-indigo-300/80 dark:border-indigo-700/60 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-500/10 cursor-pointer transition-all duration-200 group active:scale-[0.98]" title="انقر لفتح وإدارة قاعدة بيانات الأطباء المقيمين">
                            <div class="pointer-events-none absolute -top-6 -right-6 w-20 h-20 bg-indigo-500/10 rounded-full blur-xl"></div>
                            <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                                <span class="font-bold text-[11px] text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5 group-hover:text-indigo-600 transition">
                                    <i class="fas fa-user-doctor text-indigo-600 dark:text-indigo-400"></i>
                                    <span>الكادر الطبي المقيم</span>
                                </span>
                                <span class="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-2xs group-hover:bg-indigo-600 group-hover:text-white transition">
                                    <i class="fas fa-users-gear text-[9px]"></i> إدارة
                                </span>
                            </div>
                            <div class="text-lg sm:text-xl font-black font-mono text-indigo-950 dark:text-indigo-100 tracking-tight">
                                ${activeDocs.length} <span class="text-xs font-normal text-slate-500 dark:text-slate-400">/ ${totalDocsCount} مسجل</span>
                            </div>
                            <div class="flex items-center gap-1.5 mt-2 text-[10px] text-slate-600 dark:text-slate-300 font-bold truncate">
                                <span class="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400"><i class="fas fa-mars"></i> ${maleDocs.length} ذكر</span>
                                <span class="text-slate-300 dark:text-slate-700">•</span>
                                <span class="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400"><i class="fas fa-venus"></i> ${femaleDocs.length} أنثى</span>
                                <span class="text-slate-300 dark:text-slate-700">•</span>
                                <span class="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><i class="fas fa-graduation-cap"></i> ${boardDocs.length} بورد</span>
                            </div>
                        </div>

                        <!-- 4. Remaining Vacancies -->
                        <div class="p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
                            <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                                <span class="font-bold text-[11px]">الشواغر غير المنجزة</span>
                                <span class="text-xs font-black font-mono ${overallRemaining === 0 ? 'text-emerald-500' : 'text-rose-500'}">
                                    ${overallRemaining === 0 ? '0 شاغر' : `${overallRemaining} شاغر`}
                                </span>
                            </div>
                            <div class="text-lg sm:text-xl font-black font-mono ${overallRemaining === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'} tracking-tight">
                                ${overallRemaining} <span class="text-xs font-normal text-slate-400 dark:text-slate-500">خفارة فارغة</span>
                            </div>
                            <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-2 truncate">
                                ${overallRemaining === 0 ? 'تم شغل كافة الخفارات بنجاح' : 'انقر على البطاقة أدناه لتعبئة الجدول'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 2. Core Interactive Schedule Tracks (ER, Con, DC, RS) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">

                <!-- 1. ER Card (Emergency Shifts) -->
                <div onclick="switchTab('er')" class="duty-card group relative overflow-hidden rounded-2xl p-4 glass-panel border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${state.activeTab === 'er' ? 'ring-2 ring-rose-500/70 dark:ring-rose-500/80 shadow-md shadow-rose-500/10 border-rose-400 dark:border-rose-700 bg-rose-50/30 dark:bg-rose-950/20' : 'border-slate-200/80 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-800'}">
                    <!-- Accent top border stripe -->
                    <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-red-600"></div>

                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform">
                                <i class="fas fa-truck-medical"></i>
                            </div>
                            <div>
                                <h3 class="text-xs font-black text-slate-900 dark:text-slate-100 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition">خفارات الطوارئ (ER)</h3>
                                <span class="text-[10px] text-slate-400 font-bold">4 خفارات يومياً</span>
                            </div>
                        </div>
                        ${makeBalancePill(erScheduled, erRequired)}
                    </div>

                    <!-- Hero numbers & % -->
                    <div class="flex items-baseline justify-between mt-3">
                        <div class="text-xl sm:text-2xl font-black font-mono text-slate-900 dark:text-slate-100">
                            ${erScheduled} <span class="text-xs font-normal text-slate-400">/ ${erRequired}</span>
                        </div>
                        <span class="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                            ${erPercent}%
                        </span>
                    </div>

                    <!-- Progress bar -->
                    <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-2.5 overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-rose-500 to-red-600 rounded-full transition-all duration-500" style="width: ${erPercent}%"></div>
                    </div>

                    <!-- Sub-metrics Pills -->
                    <div class="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="bg-slate-50/70 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <div class="text-[10px] text-slate-400 font-bold">الأنصبة بالقاعدة</div>
                            <div class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                                ${makeAllocatedPill(erAllocated, erRequired)}
                            </div>
                        </div>
                        <div class="bg-slate-50/70 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <div class="text-[10px] text-slate-400 font-bold">المتبقي للجدول</div>
                            <div class="font-mono text-xs font-bold ${erRemaining === 0 ? 'text-emerald-500' : 'text-rose-500'} mt-0.5">
                                ${erRemaining === 0 ? 'مغطى بالكامل' : `${erRemaining} شاغر`}
                            </div>
                        </div>
                    </div>

                    <!-- Interactive hint -->
                    <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                        <span>عرض وتعديل جدول الطوارئ</span>
                        <i class="fas fa-arrow-left text-[10px] transition-transform group-hover:-translate-x-1"></i>
                    </div>
                </div>

                <!-- 2. Con Card (Consultation Shifts) -->
                <div onclick="switchTab('con')" class="duty-card group relative overflow-hidden rounded-2xl p-4 glass-panel border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${state.activeTab === 'con' ? 'ring-2 ring-sky-500/70 dark:ring-sky-500/80 shadow-md shadow-sky-500/10 border-sky-400 dark:border-sky-700 bg-sky-50/30 dark:bg-sky-950/20' : 'border-slate-200/80 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-800'}">
                    <!-- Accent top border stripe -->
                    <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-600"></div>

                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform">
                                <i class="fas fa-stethoscope"></i>
                            </div>
                            <div>
                                <h3 class="text-xs font-black text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">الاستشارية الخافرة (Con)</h3>
                                <span class="text-[10px] text-slate-400 font-bold">خفارة واحدة يومياً</span>
                            </div>
                        </div>
                        ${makeBalancePill(conScheduled, conRequired)}
                    </div>

                    <!-- Hero numbers & % -->
                    <div class="flex items-baseline justify-between mt-3">
                        <div class="text-xl sm:text-2xl font-black font-mono text-slate-900 dark:text-slate-100">
                            ${conScheduled} <span class="text-xs font-normal text-slate-400">/ ${conRequired}</span>
                        </div>
                        <span class="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                            ${conPercent}%
                        </span>
                    </div>

                    <!-- Progress bar -->
                    <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-2.5 overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-sky-500 to-blue-600 rounded-full transition-all duration-500" style="width: ${conPercent}%"></div>
                    </div>

                    <!-- Sub-metrics Pills -->
                    <div class="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="bg-slate-50/70 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <div class="text-[10px] text-slate-400 font-bold">الأنصبة بالقاعدة</div>
                            <div class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                                ${makeAllocatedPill(conAllocated, conRequired)}
                            </div>
                        </div>
                        <div class="bg-slate-50/70 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <div class="text-[10px] text-slate-400 font-bold">المتبقي للجدول</div>
                            <div class="font-mono text-xs font-bold ${conRemaining === 0 ? 'text-emerald-500' : 'text-rose-500'} mt-0.5">
                                ${conRemaining === 0 ? 'مغطى بالكامل' : `${conRemaining} شاغر`}
                            </div>
                        </div>
                    </div>

                    <!-- Interactive hint -->
                    <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                        <span>عرض وتعديل جدول الاستشارية</span>
                        <i class="fas fa-arrow-left text-[10px] transition-transform group-hover:-translate-x-1"></i>
                    </div>
                </div>

                <!-- 3. DC Card (Death Certificates Shifts) -->
                <div onclick="switchTab('dc')" class="duty-card group relative overflow-hidden rounded-2xl p-4 glass-panel border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${state.activeTab === 'dc' ? 'ring-2 ring-emerald-500/70 dark:ring-emerald-500/80 shadow-md shadow-emerald-500/10 border-emerald-400 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20' : 'border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800'}">
                    <!-- Accent top border stripe -->
                    <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-600"></div>

                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform">
                                <i class="fas fa-file-medical"></i>
                            </div>
                            <div>
                                <h3 class="text-xs font-black text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">شهادات الوفاة (DC)</h3>
                                <span class="text-[10px] text-slate-400 font-bold">خفارة واحدة يومياً</span>
                            </div>
                        </div>
                        ${makeBalancePill(dcScheduled, dcRequired)}
                    </div>

                    <!-- Hero numbers & % -->
                    <div class="flex items-baseline justify-between mt-3">
                        <div class="text-xl sm:text-2xl font-black font-mono text-slate-900 dark:text-slate-100">
                            ${dcScheduled} <span class="text-xs font-normal text-slate-400">/ ${dcRequired}</span>
                        </div>
                        <span class="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            ${dcPercent}%
                        </span>
                    </div>

                    <!-- Progress bar -->
                    <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-2.5 overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full transition-all duration-500" style="width: ${dcPercent}%"></div>
                    </div>

                    <!-- Sub-metrics Pills -->
                    <div class="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="bg-slate-50/70 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <div class="text-[10px] text-slate-400 font-bold">الأنصبة بالقاعدة</div>
                            <div class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                                ${makeAllocatedPill(dcAllocated, dcRequired)}
                            </div>
                        </div>
                        <div class="bg-slate-50/70 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <div class="text-[10px] text-slate-400 font-bold">المتبقي للجدول</div>
                            <div class="font-mono text-xs font-bold ${dcRemaining === 0 ? 'text-emerald-500' : 'text-rose-500'} mt-0.5">
                                ${dcRemaining === 0 ? 'مغطى بالكامل' : `${dcRemaining} شاغر`}
                            </div>
                        </div>
                    </div>

                    <!-- Interactive hint -->
                    <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        <span>عرض وتعديل شهادات الوفاة</span>
                        <i class="fas fa-arrow-left text-[10px] transition-transform group-hover:-translate-x-1"></i>
                    </div>
                </div>

                <!-- 4. RS Card (Rotators Strike - Active or Quick Enable) -->
                ${state.rsEnabled ? `
                <div onclick="switchTab('rs_er')" class="duty-card group relative overflow-hidden rounded-2xl p-4 glass-panel border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${(state.activeTab === 'rs_er' || state.activeTab === 'rs_wards') ? 'ring-2 ring-amber-500/70 dark:ring-amber-500/80 shadow-md shadow-amber-500/10 border-amber-400 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/20' : 'border-slate-200/80 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-800'}">
                    <!-- Accent top border stripe -->
                    <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-600"></div>

                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform">
                                <i class="fas fa-shield-virus"></i>
                            </div>
                            <div>
                                <h3 class="text-xs font-black text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition">إضراب المقيمين (RS)</h3>
                                <span class="text-[10px] text-amber-600 dark:text-amber-400 font-bold">${rsDaysCount} يوم إضراب</span>
                            </div>
                        </div>
                        ${makeBalancePill(rsTotalScheduled, rsTotalRequired)}
                    </div>

                    <!-- Hero numbers & % -->
                    <div class="flex items-baseline justify-between mt-3">
                        <div class="text-xl sm:text-2xl font-black font-mono text-slate-900 dark:text-slate-100">
                            ${rsTotalScheduled} <span class="text-xs font-normal text-slate-400">/ ${rsTotalRequired}</span>
                        </div>
                        <span class="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            ${rsPercent}%
                        </span>
                    </div>

                    <!-- Progress bar -->
                    <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-2.5 overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-amber-500 to-orange-600 rounded-full transition-all duration-500" style="width: ${rsPercent}%"></div>
                    </div>

                    <!-- Sub-metrics Split -->
                    <div class="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="bg-amber-50/60 dark:bg-amber-950/40 p-1.5 rounded-lg text-center">
                            <div class="text-[10px] text-amber-700 dark:text-amber-300 font-bold">طوارئ الإضراب</div>
                            <div class="font-mono text-xs font-black text-amber-900 dark:text-amber-200 mt-0.5">
                                ${rsErScheduled} / ${rsDaysCount * 4}
                            </div>
                        </div>
                        <div class="bg-amber-50/60 dark:bg-amber-950/40 p-1.5 rounded-lg text-center">
                            <div class="text-[10px] text-amber-700 dark:text-amber-300 font-bold">ردهات الإضراب</div>
                            <div class="font-mono text-xs font-black text-amber-900 dark:text-amber-200 mt-0.5">
                                ${rsWardsScheduled} / ${rsDaysCount * 3}
                            </div>
                        </div>
                    </div>

                    <!-- Interactive hint -->
                    <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                        <span>عرض وتعديل جداول الإضراب</span>
                        <i class="fas fa-arrow-left text-[10px] transition-transform group-hover:-translate-x-1"></i>
                    </div>
                </div>
                ` : `
                <!-- Disabled State RS Card with Quick Activation Action -->
                <div class="duty-card group relative overflow-hidden rounded-2xl p-4 bg-slate-50/70 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-slate-700 flex flex-col justify-between transition-all duration-300">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-2">
                                <div class="w-8 h-8 rounded-xl bg-slate-200/70 dark:bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold">
                                    <i class="fas fa-bed-pulse"></i>
                                </div>
                                <div>
                                    <h3 class="text-xs font-black text-slate-500 dark:text-slate-400">إضراب المقيمين (RS)</h3>
                                    <span class="text-[10px] text-slate-400 font-bold">إسناد إضافي</span>
                                </div>
                            </div>
                            <span class="text-[10px] font-bold text-slate-500 bg-slate-200/70 dark:bg-slate-800 px-2 py-0.5 rounded-full">معطّل حالياً</span>
                        </div>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                            نظام إسناد الطوارئ والردهات غير مفعّل للشهر الحالي. عند حدوث إضراب يمكنك تفعيله لإضافة خفارات الإسناد.
                        </p>
                    </div>

                    <button type="button" onclick="event.stopPropagation(); toggleRotatorsStrike()" class="mt-3 w-full py-2 px-3 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition flex items-center justify-center gap-1.5 shadow-xs">
                        <i class="fas fa-toggle-on text-amber-500"></i>
                        <span>تفعيل إسناد الإضراب الآن</span>
                    </button>
                </div>
                `}

            </div>
        `;
    }

    // =========================================================================
    // TAB SWITCHING & RENDERING
    // =========================================================================

    function openResidentsDbModal() {
        const modal = document.getElementById('residents-db-modal');
        const modalBody = document.getElementById('residents-db-modal-body');
        const modalHosp = document.getElementById('residents-db-modal-hosp');
        if (!modal || !modalBody) return;

        initDBHistory();
        if (modalHosp) modalHosp.textContent = state.hospitalName || 'المستشفى';
        renderDBView(modalBody);
        modal.classList.remove('hidden');
        updateDBUndoRedoUI();
    }

    function closeResidentsDbModal() {
        const modal = document.getElementById('residents-db-modal');
        if (modal) modal.classList.add('hidden');
        updateDutyDashboard();
        renderActiveTab();
    }

    function switchTab(tabId) {
        if (tabId === 'db') {
            openResidentsDbModal();
            return;
        }

        state.activeTab = tabId;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const isTarget = btn.getAttribute('data-tab') === tabId;
            if (isTarget) {
                btn.className = 'tab-btn active-tab shrink-0 h-9 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 bg-rose-600 text-white shadow-xs whitespace-nowrap';
            } else {
                btn.className = 'tab-btn shrink-0 h-9 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap';
            }
        });

        // Reset schedule search/filter on tab change
        state.scheduleSearchQuery = '';
        state.scheduleShiftFilter = 'all';
        state.scheduleDayFilter = 'all';
        state.scheduleStatusFilter = 'all';

        renderActiveTab();
        updateDutyDashboard();
    }

    function renderActiveTab() {
        const container = document.getElementById('schedule-view-container');
        if (!container) return;

        updateDutyDashboard();

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
                openResidentsDbModal();
                state.activeTab = 'er';
                renderERView(container);
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

    
    // Backward compatibility aliases
    function onScheduleSearchInput(type, val) {
        applyScheduleLiveFilter(val);
    }
    function onScheduleShiftFilterChange(type, val) {
        onScheduleShiftFilter(val);
    }
    function onScheduleDayFilterChange(type, val) {
        onScheduleDayFilter(val);
    }
    function onScheduleStatusFilterChange(type, val) {
        if (val === 'empty_only') {
            state.scheduleEmptyOnly = true;
            state.scheduleConflictOnly = false;
        } else if (val === 'conflict_only') {
            state.scheduleEmptyOnly = false;
            state.scheduleConflictOnly = true;
        } else {
            state.scheduleEmptyOnly = false;
            state.scheduleConflictOnly = false;
        }
        applyScheduleLiveFilter(state.scheduleSearchQuery);
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
        const cleanQ = normalizeArabic(state.scheduleSearchQuery || '').toLowerCase();
        const cleanDocFilter = normalizeArabic(state.scheduleDoctorFilter || '').toLowerCase();
        const targetHighlight = cleanQ || cleanDocFilter;

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
                const cleanDoc = normalizeArabic(docName).toLowerCase();

                const isMatch = targetHighlight && isShiftEligible && cleanDoc && (
                    (cleanQ && cleanDoc.includes(cleanQ)) ||
                    (cleanDocFilter && cleanDoc === cleanDocFilter)
                );

                const docSpan = td.querySelector('.doc-name-span');
                if (isMatch) {
                    hasNameMatch = true;
                    matchedDuties++;
                    if (docSpan) {
                        docSpan.classList.add('bg-amber-300', 'dark:bg-amber-500/40', 'text-amber-950', 'dark:text-amber-100', 'ring-2', 'ring-amber-500', 'shadow-xs', 'px-1.5', 'py-0.5', 'rounded-md', 'font-black');
                    }
                } else {
                    if (docSpan) {
                        docSpan.classList.remove('bg-amber-300', 'dark:bg-amber-500/40', 'text-amber-950', 'dark:text-amber-100', 'ring-2', 'ring-amber-500', 'shadow-xs', 'px-1.5', 'py-0.5', 'rounded-md', 'font-black');
                    }
                }
            });

            // Doctor dropdown filter
            if (state.scheduleDoctorFilter) {
                if (!hasNameMatch) { tr.style.display = 'none'; return; }
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
                badge.textContent = targetHighlight 
                    ? `تم العثور على ${matchedDuties} خفارة في ${matchedDays} يوم` 
                    : `معروض ${matchedDays} يوم`;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    // =========================================================================
    
    // =========================================================================
    // FILTER ROW HELPER
    // =========================================================================

    function filterDayRow(day, type, shiftKeys) {
        if (!day) return false;
        const cleanQ = normalizeArabic(state.scheduleSearchQuery || '').toLowerCase();

        // 1. Day of week filter
        const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
        if (state.scheduleDayFilter === 'weekend' && !isWeekend) return false;
        if (state.scheduleDayFilter === 'weekday' && isWeekend) return false;

        // 2. Doctor selector filter
        if (state.scheduleDoctorFilter) {
            const cleanDoc = normalizeArabic(state.scheduleDoctorFilter).toLowerCase();
            const hasDoctor = (shiftKeys || []).some(k => day[k] && normalizeArabic(day[k]).toLowerCase() === cleanDoc);
            if (!hasDoctor) return false;
        }

        // 3. Shift filter
        if (state.scheduleShiftFilter && state.scheduleShiftFilter !== 'all') {
            if ((shiftKeys || []).includes(state.scheduleShiftFilter)) {
                // If checking specific shift, verify it has a doctor or is valid
            }
        }

        // 4. Empty filter
        if (state.scheduleEmptyOnly) {
            const hasEmpty = (shiftKeys || []).some(k => !day[k] || !day[k].trim());
            if (!hasEmpty) return false;
        }

        // 5. Conflict filter
        if (state.scheduleConflictOnly) {
            const hasConflict = (shiftKeys || []).some(k => {
                const doc = day[k];
                if (!doc) return false;
                const evalRes = evaluateCellConflict(doc, day.date, type, k);
                return evalRes && evalRes.hasConflict;
            });
            if (!hasConflict) return false;
        }

        // 6. Search query matching
        if (cleanQ) {
            const matchesDayOrDate = normalizeArabic(day.dayName || '').toLowerCase().includes(cleanQ) || (day.date || '').includes(cleanQ);
            const matchesDoctor = (shiftKeys || []).some(k => day[k] && normalizeArabic(day[k]).toLowerCase().includes(cleanQ));
            if (!matchesDayOrDate && !matchesDoctor) return false;
        }

        return true;
    }

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
                    ${renderScheduleUndoRedoButtons()}
                    <button type="button" onclick="clearCurrentSchedule('er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition flex items-center gap-1.5" title="تفريغ ومسح جدول خفارات الطوارئ لهذا الشهر">
                        <i class="fas fa-trash-can text-[11px]"></i>
                        <span>تفريغ الجدول</span>
                    </button>
                    <button type="button" onclick="triggerScheduleAutoGenerate('er')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد خفارات الطوارئ آلياً</span>
                    </button>
                    <button type="button" onclick="openPrintOptionsModal('er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5" title="خيارات ألوان وتصميم ورقة الطباعة الرسمية">
                        <i class="fas fa-palette text-rose-500"></i>
                        <span>خيارات الطباعة</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('er', shifts)}

            <div class="overflow-x-auto rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-900 text-white dark:bg-black dark:text-white border-b-2 border-slate-800 text-xs font-black select-none">
                            <th class="py-3 px-3 w-12 text-center font-bold border-l border-slate-800">#</th>
                            <th class="py-3 px-3 w-32 font-bold border-l border-slate-800">اليوم والتاريخ</th>
                            ${shifts.map(s => `
                                <th onclick="quickFilterByShift('${s.key}')" class="py-3 px-3 font-bold cursor-pointer hover:bg-slate-800 transition select-none border-l border-slate-800 ${state.scheduleShiftFilter !== 'all' && state.scheduleShiftFilter !== s.key ? 'opacity-40' : ''}" title="انقر لتصفية الجدول بهذه الوجبة">
                                    <div class="flex items-center gap-1.5 text-white">
                                        <i class="fas ${s.icon} ${s.color}"></i>
                                        <span>${s.label}</span>
                                    </div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
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
                    <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition border-b border-slate-200 dark:border-slate-800/80 ${isWeekend ? 'bg-[#5ea37d]/15 dark:bg-[#5ea37d]/20 border-r-4 border-r-[#5ea37d]' : ''}">
                        <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800">${day.dayNumber}</td>
                        <td class="py-2.5 px-3 whitespace-nowrap border-l border-slate-200 dark:border-slate-800">
                            <div class="flex items-center gap-1.5 font-bold ${isWeekend ? 'text-[#2e5d42] dark:text-[#88d4aa]' : 'text-slate-800 dark:text-slate-100'}">
                                <span>${day.dayName}</span>
                                ${isWeekend ? '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-[#5ea37d] text-white">عطلة</span>' : ''}
                            </div>
                            <div class="text-[11px] font-mono font-bold ${isWeekend ? 'text-[#3b7353] dark:text-[#72c798]' : 'text-slate-500 dark:text-slate-400'}">${formatArabicDateNumbers(day.date)}</div>
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
                    ${renderScheduleUndoRedoButtons()}
                    <button type="button" onclick="clearCurrentSchedule('con')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition flex items-center gap-1.5" title="تفريغ ومسح جدول الاستشارية الخافرة لهذا الشهر">
                        <i class="fas fa-trash-can text-[11px]"></i>
                        <span>تفريغ الجدول</span>
                    </button>
                    <button type="button" onclick="triggerScheduleAutoGenerate('con')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد خفارات الاستشارية آلياً</span>
                    </button>
                    <button type="button" onclick="openPrintOptionsModal('con')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5" title="خيارات ألوان وتصميم ورقة الطباعة الرسمية">
                        <i class="fas fa-palette text-rose-500"></i>
                        <span>خيارات الطباعة</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('con')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('con', null)}

            <div class="overflow-x-auto rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm max-w-3xl">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-900 text-white dark:bg-black dark:text-white border-b-2 border-slate-800 text-xs font-black select-none">
                            <th class="py-3 px-3 w-14 text-center font-bold border-l border-slate-800">#</th>
                            <th class="py-3 px-3 w-36 font-bold border-l border-slate-800">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold">طبيب الاستشارية الخافرة</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        filteredDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition border-b border-slate-200 dark:border-slate-800/80 ${isWeekend ? 'bg-[#5ea37d]/15 dark:bg-[#5ea37d]/20 border-r-4 border-r-[#5ea37d]' : ''}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap border-l border-slate-200 dark:border-slate-800">
                        <div class="flex items-center gap-1.5 font-bold ${isWeekend ? 'text-[#2e5d42] dark:text-[#88d4aa]' : 'text-slate-800 dark:text-slate-100'}">
                            <span>${day.dayName}</span>
                            ${isWeekend ? '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-[#5ea37d] text-white">عطلة</span>' : ''}
                        </div>
                        <div class="text-[11px] font-mono font-bold ${isWeekend ? 'text-[#3b7353] dark:text-[#72c798]' : 'text-slate-500 dark:text-slate-400'}">${formatArabicDateNumbers(day.date)}</div>
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
                    ${renderScheduleUndoRedoButtons()}
                    <button type="button" onclick="clearCurrentSchedule('dc')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition flex items-center gap-1.5" title="تفريغ ومسح جدول شهادات الوفاة لهذا الشهر">
                        <i class="fas fa-trash-can text-[11px]"></i>
                        <span>تفريغ الجدول</span>
                    </button>
                    <button type="button" onclick="triggerScheduleAutoGenerate('dc')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد شهادات الوفاة آلياً</span>
                    </button>
                    <button type="button" onclick="openPrintOptionsModal('dc')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5" title="خيارات ألوان وتصميم ورقة الطباعة الرسمية">
                        <i class="fas fa-palette text-rose-500"></i>
                        <span>خيارات الطباعة</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('dc')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('dc', null)}

            <div class="overflow-x-auto rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm max-w-4xl">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-900 text-white dark:bg-black dark:text-white border-b-2 border-slate-800 text-xs font-black select-none">
                            <th class="py-3 px-3 w-14 text-center font-bold border-l border-slate-800">#</th>
                            <th class="py-3 px-3 w-36 font-bold border-l border-slate-800">اليوم والتاريخ</th>
                            <th class="py-3 px-3 font-bold border-l border-slate-800">طبيب شهادات الوفاة</th>
                            <th class="py-3 px-3 w-64 font-bold text-slate-300">حالة الخفارة في المستشفى</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        filteredDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            const hospDuties = day.doctor ? getHospitalDutiesForDoctor(day.doctor, day.date) : [];
            const hasHospDuty = hospDuties.length > 0;

            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition border-b border-slate-200 dark:border-slate-800/80 ${isWeekend ? 'bg-[#5ea37d]/15 dark:bg-[#5ea37d]/20 border-r-4 border-r-[#5ea37d]' : ''}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800">${day.dayNumber}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap border-l border-slate-200 dark:border-slate-800">
                        <div class="flex items-center gap-1.5 font-bold ${isWeekend ? 'text-[#2e5d42] dark:text-[#88d4aa]' : 'text-slate-800 dark:text-slate-100'}">
                            <span>${day.dayName}</span>
                            ${isWeekend ? '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-[#5ea37d] text-white">عطلة</span>' : ''}
                        </div>
                        <div class="text-[11px] font-mono font-bold ${isWeekend ? 'text-[#3b7353] dark:text-[#72c798]' : 'text-slate-500 dark:text-slate-400'}">${formatArabicDateNumbers(day.date)}</div>
                    </td>
                    ${renderShiftCellHTML('dc', day.dayNumber, day.date, 'doctor', day.doctor)}
                    <td class="py-2.5 px-3 text-slate-500 border-l border-slate-200 dark:border-slate-800">
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
                    ${renderScheduleUndoRedoButtons()}
                    <button type="button" onclick="clearCurrentSchedule('rs_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition flex items-center gap-1.5" title="تفريغ ومسح جدول طوارئ الإسناد لهذا الشهر">
                        <i class="fas fa-trash-can text-[11px]"></i>
                        <span>تفريغ الجدول</span>
                    </button>
                    <button type="button" onclick="triggerScheduleAutoGenerate('rs_er')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد طوارئ الإضراب آلياً</span>
                    </button>
                    <button type="button" onclick="openPrintOptionsModal('rs_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5" title="خيارات ألوان وتصميم ورقة الطباعة الرسمية">
                        <i class="fas fa-palette text-rose-500"></i>
                        <span>خيارات الطباعة</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('rs_er')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('rs', shifts)}

            <div class="overflow-x-auto rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-900 text-white dark:bg-black dark:text-white border-b-2 border-slate-800 text-xs font-black select-none">
                            <th class="py-3 px-3 w-12 text-center font-bold border-l border-slate-800">#</th>
                            <th class="py-3 px-3 w-32 font-bold border-l border-slate-800">اليوم والتاريخ</th>
                            ${shifts.map(s => `
                                <th onclick="quickFilterByShift('${s.key}')" class="py-3 px-3 font-bold cursor-pointer hover:bg-slate-800 transition select-none border-l border-slate-800 ${state.scheduleShiftFilter !== 'all' && state.scheduleShiftFilter !== s.key ? 'opacity-40' : ''}" title="انقر لتصفية الجدول بهذه الوجبة">
                                    <div class="flex items-center gap-1.5 text-white">
                                        <i class="fas ${s.icon} ${s.color}"></i>
                                        <span>${s.label}</span>
                                    </div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        filteredDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            const hasNames = shifts.some(s => day[s.key] && day[s.key].trim());
            const weekendClass = isWeekend ? 'bg-[#5ea37d]/15 dark:bg-[#5ea37d]/20 border-r-4 border-r-[#5ea37d]' : '';
            const rowClass = inRsPeriod 
                ? (weekendClass || (hasNames ? 'bg-amber-50/50 dark:bg-amber-950/20 font-medium' : 'bg-slate-50/30 dark:bg-slate-800/20')) 
                : 'opacity-40 bg-slate-50/10';

            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition border-b border-slate-200 dark:border-slate-800/80 ${rowClass}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800">
                        ${day.dayNumber}
                        ${inRsPeriod ? '<span class="block w-1.5 h-1.5 rounded-full bg-amber-500 mx-auto mt-0.5"></span>' : ''}
                    </td>
                    <td class="py-2.5 px-3 whitespace-nowrap border-l border-slate-200 dark:border-slate-800">
                        <div class="flex items-center gap-1.5 font-bold ${isWeekend ? 'text-[#2e5d42] dark:text-[#88d4aa]' : 'text-slate-800 dark:text-slate-100'}">
                            <span>${day.dayName}</span>
                            ${isWeekend ? '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-[#5ea37d] text-white">عطلة</span>' : ''}
                        </div>
                        <div class="text-[11px] font-mono font-bold ${isWeekend ? 'text-[#3b7353] dark:text-[#72c798]' : 'text-slate-500 dark:text-slate-400'}">${formatArabicDateNumbers(day.date)}</div>
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
                    ${renderScheduleUndoRedoButtons()}
                    <button type="button" onclick="clearCurrentSchedule('rs_wards')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition flex items-center gap-1.5" title="تفريغ ومسح جدول ردهات الإسناد لهذا الشهر">
                        <i class="fas fa-trash-can text-[11px]"></i>
                        <span>تفريغ الجدول</span>
                    </button>
                    <button type="button" onclick="triggerScheduleAutoGenerate('rs_wards')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>توليد ردهات الإضراب آلياً</span>
                    </button>
                    <button type="button" onclick="openPrintOptionsModal('rs_wards')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5" title="خيارات ألوان وتصميم ورقة الطباعة الرسمية">
                        <i class="fas fa-palette text-rose-500"></i>
                        <span>خيارات الطباعة</span>
                    </button>
                    <button type="button" onclick="prepareOfficialPrint('rs_wards')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5">
                        <i class="fas fa-print"></i>
                        <span>طباعة رسمية (A4)</span>
                    </button>
                </div>
            </div>

            <!-- Filter Bar -->
            ${renderScheduleFilterBar('rs', wards)}

            <div class="overflow-x-auto rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm">
                <table class="w-full text-right border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-900 text-white dark:bg-black dark:text-white border-b-2 border-slate-800 text-xs font-black select-none">
                            <th class="py-3 px-3 w-12 text-center font-bold border-l border-slate-800">#</th>
                            <th class="py-3 px-3 w-32 font-bold border-l border-slate-800">اليوم والتاريخ</th>
                            ${wards.map(w => `
                                <th class="py-3 px-3 font-bold border-l border-slate-800 ${state.scheduleShiftFilter !== 'all' && state.scheduleShiftFilter !== w.key ? 'opacity-40' : ''}">
                                    <div class="flex items-center gap-1.5 text-white">
                                        <i class="fas ${w.icon} ${w.color}"></i>
                                        <span>${w.label}</span>
                                    </div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
        `;

        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

        filteredDays.forEach(day => {
            const isWeekend = day.dayName === 'الجمعة' || day.dayName === 'السبت';
            const inRsPeriod = day.dayNumber >= startDay && day.dayNumber <= endDay;
            const hasNames = wards.some(w => day[w.key] && day[w.key].trim());
            const weekendClass = isWeekend ? 'bg-[#5ea37d]/15 dark:bg-[#5ea37d]/20 border-r-4 border-r-[#5ea37d]' : '';
            const rowClass = inRsPeriod 
                ? (weekendClass || (hasNames ? 'bg-amber-50/50 dark:bg-amber-950/20 font-medium' : 'bg-slate-50/30 dark:bg-slate-800/20')) 
                : 'opacity-40 bg-slate-50/10';

            html += `
                <tr data-day="${day.dayNumber}" data-dayname="${day.dayName}" data-date="${day.date}" class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition border-b border-slate-200 dark:border-slate-800/80 ${rowClass}">
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800">
                        ${day.dayNumber}
                        ${inRsPeriod ? '<span class="block w-1.5 h-1.5 rounded-full bg-amber-500 mx-auto mt-0.5"></span>' : ''}
                    </td>
                    <td class="py-2.5 px-3 whitespace-nowrap border-l border-slate-200 dark:border-slate-800">
                        <div class="flex items-center gap-1.5 font-bold ${isWeekend ? 'text-[#2e5d42] dark:text-[#88d4aa]' : 'text-slate-800 dark:text-slate-100'}">
                            <span>${day.dayName}</span>
                            ${isWeekend ? '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-[#5ea37d] text-white">عطلة</span>' : ''}
                        </div>
                        <div class="text-[11px] font-mono font-bold ${isWeekend ? 'text-[#3b7353] dark:text-[#72c798]' : 'text-slate-500 dark:text-slate-400'}">${formatArabicDateNumbers(day.date)}</div>
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
                <td class="py-2 px-3 bg-rose-50/50 dark:bg-rose-950/20 border-l border-slate-200 dark:border-slate-800" data-slot="${slotKey}" data-doc="" data-conflict="false" data-outside-pref="false">
                    <button type="button" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')" 
                        class="w-full text-right py-1.5 px-2.5 rounded-xl border border-dashed border-rose-300 dark:border-rose-700/80 bg-rose-50/80 dark:bg-rose-900/20 hover:border-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 font-bold text-[11px] transition flex items-center justify-between group shadow-xs">
                        <span class="flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                            <span>شاغر (تعيين)</span>
                        </span>
                        <i class="fas fa-plus text-[10px] text-rose-500 group-hover:scale-125 transition-transform"></i>
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

        const cleanQ = normalizeArabic(state.scheduleSearchQuery || '').toLowerCase();
        const cleanDocFilter = normalizeArabic(state.scheduleDoctorFilter || '').toLowerCase();
        const cleanDocName = normalizeArabic(assignedDoctor).toLowerCase();
        const isHighlight = (cleanQ && cleanDocName.includes(cleanQ)) || (cleanDocFilter && cleanDocName === cleanDocFilter);
        const highlightClasses = isHighlight ? ' bg-amber-300 dark:bg-amber-500/40 text-amber-950 dark:text-amber-100 ring-2 ring-amber-500 shadow-xs px-1.5 py-0.5 rounded-md font-black' : '';

        return `
            <td class="py-2 px-3 border-l border-slate-200 dark:border-slate-800" data-slot="${slotKey}" data-doc="${escapeForInline(assignedDoctor)}" data-conflict="${conflictInfo.hasConflict ? 'true' : 'false'}" data-outside-pref="${hasPrefOverride ? 'true' : 'false'}">
                <div class="flex items-center justify-between group py-1 px-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 hover:border-slate-400 transition">
                    <div class="flex items-center truncate cursor-pointer flex-1" onclick="openDoctorPicker('${tableType}', ${dayNumber}, '${slotKey}', '${slotKey}')">
                        <span class="doc-name-span font-bold text-slate-800 dark:text-slate-100 truncate${highlightClasses}">${assignedDoctor}</span>
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

    function getDBContainer() {
        const modalBody = document.getElementById('residents-db-modal-body');
        if (modalBody) return modalBody;
        return document.getElementById('schedule-view-container');
    }

    // Monthly Duty Allocations Summary Helper
    function getMonthlyDutyAllocationsSummary() {
        const daysCount = getDaysInMonth(state.year, state.month);
        const activeDocs = (state.residents || []).filter(r => r.active && !isResidentExpired(r, state.year, state.month));

        // 1. ER (4 shifts per day)
        const erRequired = daysCount * 4;
        const erAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.er_target) || 0), 0);

        // 2. Consultation (1 shift per day)
        const conRequired = daysCount * 1;
        const conAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.con_target) || 0), 0);

        // 3. Death Certificates (1 shift per day)
        const dcRequired = daysCount * 1;
        const dcAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.dc_target) || 0), 0);

        // 4. Rotators Strike (RS)
        let rsDaysCount = 0;
        let rsRequired = 0;
        let rsAllocated = 0;
        if (state.rsEnabled && state.rsStartDate && state.rsEndDate) {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || daysCount;
            rsDaysCount = Math.max(0, endDay - startDay + 1);
            rsRequired = rsDaysCount * 7; // 4 ER + 3 Wards per day
            rsAllocated = activeDocs.reduce((sum, r) => sum + (Number(r.rs_target) || 0), 0);
        }

        return {
            daysCount,
            er: {
                required: erRequired,
                allocated: erAllocated,
                isMatch: erAllocated === erRequired,
                diff: erAllocated - erRequired,
                label: 'نصاب الطوارئ (ER)',
                sublabel: `(4 وجبات × ${daysCount} يوم)`
            },
            con: {
                required: conRequired,
                allocated: conAllocated,
                isMatch: conAllocated === conRequired,
                diff: conAllocated - conRequired,
                label: 'نصاب الاستشارية (Con)',
                sublabel: `(1 وجبة × ${daysCount} يوم)`
            },
            dc: {
                required: dcRequired,
                allocated: dcAllocated,
                isMatch: dcAllocated === dcRequired,
                diff: dcAllocated - dcRequired,
                label: 'نصاب الوفيات (DC)',
                sublabel: `(1 وجبة × ${daysCount} يوم)`
            },
            rs: {
                enabled: Boolean(state.rsEnabled),
                daysCount: rsDaysCount,
                required: rsRequired,
                allocated: rsAllocated,
                isMatch: rsAllocated === rsRequired,
                diff: rsAllocated - rsRequired,
                label: 'نصاب الإضراب (RS)',
                sublabel: state.rsEnabled ? `(7 وجبات × ${rsDaysCount} يوم)` : 'غير مفعل'
            }
        };
    }

    function renderDBDutyCheckersHTML() {
        const summary = getMonthlyDutyAllocationsSummary();

        const makeCard = (item, colorTheme, icon) => {
            const isGreen = item.isMatch;
            const statusBorder = isGreen ? 'border-emerald-500/80 bg-emerald-500/10' : 'border-rose-500/80 bg-rose-500/10';
            const statusBadge = isGreen
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-xs">
                     <i class="fas fa-check-circle"></i>
                     <span>مطابق تماماً</span>
                   </span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-xs animate-pulse">
                     <i class="fas fa-circle-exclamation"></i>
                     <span>${item.diff < 0 ? `نقص (${Math.abs(item.diff)})` : `فائض (+${item.diff})`}</span>
                   </span>`;

            const statusText = isGreen
                ? `<div class="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">الأنصبة مطابقة للمطلوب (${item.allocated} / ${item.required})</div>`
                : `<div class="text-[11px] font-bold text-rose-700 dark:text-rose-300">المنصوب: ${item.allocated} من أصل ${item.required} ${item.diff < 0 ? `(متبقي ${item.required - item.allocated})` : `(فائض +${item.diff})`}</div>`;

            return `
                <div class="p-3.5 rounded-2xl border-2 transition shadow-xs flex flex-col justify-between ${statusBorder}">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-xl flex items-center justify-center ${colorTheme} text-white shadow-xs shrink-0">
                                <i class="fas ${icon} text-sm"></i>
                            </div>
                            <div>
                                <div class="font-black text-xs text-slate-800 dark:text-slate-100">${item.label}</div>
                                <div class="text-[10px] text-slate-500 font-mono">${item.sublabel}</div>
                            </div>
                        </div>
                        <div>${statusBadge}</div>
                    </div>
                    <div class="flex items-baseline justify-between pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                        <div class="font-mono font-black text-base ${isGreen ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}">
                            ${item.allocated} <span class="text-xs font-normal text-slate-500">/ ${item.required} خفارة</span>
                        </div>
                        ${statusText}
                    </div>
                </div>
            `;
        };

        return `
            <div id="db-duty-checkers-container" class="space-y-2 mb-2">
                <div class="flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
                        <h3 class="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <i class="fas fa-scale-balanced text-rose-600"></i>
                            <span>مطابقة أنصبة الخفارات مع المطلوب لشهر (${state.monthYear})</span>
                        </h3>
                    </div>
                    <span class="text-[11px] text-slate-500">الأخضر يعني مطابقة تامة · الأحمر يعني عدم مطابقة (يُمنع تجاوز المطلوب)</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:${state.rsEnabled ? 'grid-cols-4' : 'grid-cols-3'} gap-3">
                    ${makeCard(summary.er, 'bg-rose-600', 'fa-truck-medical')}
                    ${makeCard(summary.con, 'bg-sky-600', 'fa-stethoscope')}
                    ${makeCard(summary.dc, 'bg-emerald-600', 'fa-file-lines')}
                    ${state.rsEnabled ? makeCard(summary.rs, 'bg-amber-600', 'fa-triangle-exclamation') : ''}
                </div>
            </div>
        `;
    }

    function updateDBDutyCheckers() {
        const el = document.getElementById('db-duty-checkers-container');
        if (el) {
            el.outerHTML = renderDBDutyCheckersHTML();
        }
    }

    function refreshDBView(targetResidentId) {
        const container = getDBContainer();
        if (container) {
            const prevContainerScroll = container.scrollTop;
            const activeTable = document.getElementById('db-active-table-wrapper');
            const inactiveTable = document.getElementById('db-inactive-table-wrapper');
            const savedActiveScroll = activeTable ? activeTable.scrollTop : 0;
            const savedActiveScrollLeft = activeTable ? activeTable.scrollLeft : 0;
            const savedInactiveScroll = inactiveTable ? inactiveTable.scrollTop : 0;
            const prevWinScroll = window.scrollY || document.documentElement.scrollTop;

            const scrollableStates = [];
            const scrollWrappers = container.querySelectorAll('.overflow-auto, .overflow-y-auto');
            scrollWrappers.forEach((el, idx) => {
                scrollableStates.push({
                    index: idx,
                    scrollTop: el.scrollTop,
                    scrollLeft: el.scrollLeft
                });
            });

            renderDBView(container);

            const doRestore = () => {
                const newActiveTable = document.getElementById('db-active-table-wrapper');
                const newInactiveTable = document.getElementById('db-inactive-table-wrapper');
                if (newActiveTable) {
                    if (savedActiveScroll > 0) newActiveTable.scrollTop = savedActiveScroll;
                    if (savedActiveScrollLeft > 0) newActiveTable.scrollLeft = savedActiveScrollLeft;
                }
                if (newInactiveTable && savedInactiveScroll > 0) {
                    newInactiveTable.scrollTop = savedInactiveScroll;
                }

                const newScrollWrappers = container.querySelectorAll('.overflow-auto, .overflow-y-auto');
                scrollableStates.forEach(item => {
                    if (newScrollWrappers[item.index]) {
                        if (item.scrollTop > 0) newScrollWrappers[item.index].scrollTop = item.scrollTop;
                        if (item.scrollLeft > 0) newScrollWrappers[item.index].scrollLeft = item.scrollLeft;
                    }
                });

                if (prevContainerScroll > 0) {
                    container.scrollTop = prevContainerScroll;
                }
                if (prevWinScroll > 0) {
                    window.scrollTo({ top: prevWinScroll, behavior: 'instant' });
                }

                if (targetResidentId) {
                    const row = container.querySelector(`tr[data-resident-id="${targetResidentId}"]`);
                    if (row) {
                        row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
                    }
                }
            };

            void container.offsetHeight;
            doRestore();

            requestAnimationFrame(() => {
                doRestore();
                setTimeout(doRestore, 25);
                setTimeout(doRestore, 80);
            });
        }
        const navBadge = document.getElementById('db-nav-count-badge');
        if (navBadge) {
            const count = (state.residents || []).filter(r => r.active).length;
            navBadge.textContent = `${count} طبيب`;
        }
    }

    // Stage names normalization (Converts numbers 1..6 or R1..R6 to Arabic names)
    function normalizeStageName(val) {
        if (!val) return 'بدون';
        const str = String(val).trim();
        switch (str) {
            case '1':
            case 'R1':
            case 'r1':
            case 'المرحلة الأولى':
            case 'الأولى':
                return 'الأولى';
            case '2':
            case 'R2':
            case 'r2':
            case 'المرحلة الثانية':
            case 'الثانية':
                return 'الثانية';
            case '3':
            case 'R3':
            case 'r3':
            case 'المرحلة الثالثة':
            case 'الثالثة':
                return 'الثالثة';
            case '4':
            case 'R4':
            case 'r4':
            case 'المرحلة الرابعة':
            case 'الرابعة':
                return 'الرابعة';
            case '5':
            case 'R5':
            case 'r5':
            case 'المرحلة الخامسة':
            case 'الخامسة':
                return 'الخامسة';
            case '6':
            case 'R6':
            case 'r6':
            case 'المرحلة السادسة':
            case 'السادسة':
                return 'السادسة';
            case '0':
            case 'none':
            case 'None':
            case 'بدون':
            case 'بدون تحديد':
                return 'بدون';
            default:
                return str;
        }
    }

    // Default medical specialty color palette
    const DEFAULT_SPECIALTY_COLORS = {
        'جراحة عامة': '#10b981',
        'الجراحة العامة': '#10b981',
        'general surgery': '#10b981',
        'جراحة الصدر و الاوعية الدموية': '#f97316',
        'cardiothoracic': '#f97316',
        'جراحة الجملة العصبية': '#8b5cf6',
        'neurosurgery': '#8b5cf6',
        'الكسور': '#ef4444',
        'orthopaedics': '#ef4444',
        'جراحة المسالك البولية': '#06b6d4',
        'urosurgery': '#06b6d4',
        'الأذن و الأنف و الحنجرة': '#eab308',
        'ent': '#eab308',
        'العيون': '#3b82f6',
        'ophthalmology': '#3b82f6',
        'الباطنية': '#6366f1',
        'internal medicine': '#6366f1',
        'طب الأطفال': '#ec4899',
        'paediatrics': '#ec4899',
        'جراحة التجميل': '#d946ef',
        'plastic surgery': '#d946ef',
        'الجلدية': '#14b8a6',
        'dermatology': '#14b8a6',
        'الأشعة والسونار': '#64748b',
        'radiology': '#64748b',
        'الأورام': '#a855f7',
        'oncology': '#a855f7',
        'أمراض الدم': '#be123c',
        'haematology': '#be123c',
        'طب الأسرة': '#059669',
        'family medicine': '#059669',
        'طوارئ': '#dc2626',
        'طب الطوارئ': '#dc2626',
        'emergency': '#dc2626',
        'gp': '#64748b',
        'عام': '#64748b',
        'general': '#64748b'
    };

    function getSpecialtyColor(specName) {
        if (!specName) return '#64748b';
        const clean = specName.trim().toLowerCase();
        
        // 1. User customized color
        if (state.specialtyColors && state.specialtyColors[clean]) {
            return state.specialtyColors[clean];
        }
        if (state.specialtyColors && state.specialtyColors[specName]) {
            return state.specialtyColors[specName];
        }

        // 2. Hospital specialty color from Hub
        if (window.Hub && typeof window.Hub.getHospital === 'function') {
            const hosp = window.Hub.getHospital(state.hospitalId);
            if (hosp && Array.isArray(hosp.specialties)) {
                const found = hosp.specialties.find(s => 
                    (s.name_ar && s.name_ar.toLowerCase() === clean) ||
                    (s.name_en && s.name_en.toLowerCase() === clean) ||
                    (s.name && s.name.toLowerCase() === clean)
                );
                if (found && found.color) return found.color;
            }
        }

        // 3. Preset color
        if (DEFAULT_SPECIALTY_COLORS[clean]) {
            return DEFAULT_SPECIALTY_COLORS[clean];
        }
        for (const [key, color] of Object.entries(DEFAULT_SPECIALTY_COLORS)) {
            if (clean.includes(key) || key.includes(clean)) {
                return color;
            }
        }

        // 4. Hash fallback
        let hash = 0;
        for (let i = 0; i < specName.length; i++) {
            hash = specName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colors = ['#0284c7', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#e11d48', '#9333ea', '#4f46e5', '#0891b2'];
        return colors[Math.abs(hash) % colors.length];
    }

    // =========================================================================
    // PHONE & NAME FORMATTING AND VALIDATION HELPERS
    // =========================================================================

    function formatDoctorName(rawName) {
        if (!rawName || typeof rawName !== 'string') return '';
        let cleaned = rawName.trim();
        // Remove existing "د." or "د " or "Dr." or "dr." prefix variations
        cleaned = cleaned.replace(/^(د|dr)[\.\s\:\/]+/gi, '').trim();
        if (!cleaned) return '';
        return `د. ${cleaned}`;
    }

    function formatIraqiPhoneNumber(rawPhone) {
        if (!rawPhone || typeof rawPhone !== 'string') return '';
        let p = rawPhone.trim();
        // Convert Arabic/Persian digits to English ASCII digits
        const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
        for (let i = 0; i < 10; i++) {
            p = p.split(arabicDigits[i]).join(String(i));
        }
        // Keep note if original had a plus, then strip all non-digits
        const hasPlus = p.startsWith('+');
        p = p.replace(/\D/g, '');
        if (!p) return '';

        // Normalize Iraqi international prefixes:
        if (p.startsWith('00964')) {
            p = '+964' + p.substring(5);
        } else if (p.startsWith('964')) {
            p = '+' + p;
        } else if (p.startsWith('07')) {
            // 07XXXXXXXXX (11 digits) -> +9647XXXXXXXXX
            p = '+964' + p.substring(1);
        } else if (p.startsWith('7') && p.length === 10) {
            // 7XXXXXXXXX (10 digits) -> +9647XXXXXXXXX
            p = '+964' + p;
        } else if (hasPlus) {
            p = '+' + p;
        }

        return p;
    }

    function isValidIraqiPhoneNumber(phone) {
        if (!phone) return true; // Optional field
        // Standard Iraqi mobile pattern: +9647 followed by 9 digits (total 14 chars with +)
        return /^\+9647\d{9}$/.test(phone);
    }

    // =========================================================================
    // SPECIALTY UNIFICATION & MAPPING (ENGLISH NAMES MATCHING HOSPITALS)
    // =========================================================================

    const SPECIALTY_AR_TO_EN_MAP = {
        'الجراحة العامة': 'General Surgery',
        'جراحة عامة': 'General Surgery',
        'جراحة الصدر و الاوعية الدموية': 'Cardiothoracic Surgery',
        'جراحة الصدر والأوعية الدموية': 'Cardiothoracic Surgery',
        'جراحة الصدر والاوعية الدموية': 'Cardiothoracic Surgery',
        'صدرية وقلبية': 'Cardiothoracic Surgery',
        'صدرية': 'Cardiothoracic Surgery',
        'جراحة الجملة العصبية': 'Neurosurgery',
        'جملة عصبية': 'Neurosurgery',
        'الكسور': 'Orthopaedics',
        'كسور': 'Orthopaedics',
        'جراحة العظام والكسور': 'Orthopaedics',
        'جراحة المسالك البولية': 'Urosurgery',
        'مسالك بولية': 'Urosurgery',
        'بولية': 'Urosurgery',
        'الأذن و الأنف و الحنجرة': 'ENT',
        'الأذن والأنف والحنجرة': 'ENT',
        'الاذن والانف والحنجرة': 'ENT',
        'أنف وأذن وحنجرة': 'ENT',
        'جراحة الوجه و الفكين': 'MaxilloFacial Surgery',
        'جراحة الوجه والفكين': 'MaxilloFacial Surgery',
        'وجه وفكين': 'MaxilloFacial Surgery',
        'العيون': 'Ophthalmology',
        'طب العيون': 'Ophthalmology',
        'طب الأطفال': 'Paediatrics',
        'الأطفال': 'Paediatrics',
        'اطفال': 'Paediatrics',
        'الباطنية': 'Internal Medicine',
        'الطب الباطني': 'Internal Medicine',
        'طب باطني': 'Internal Medicine',
        'باطنية': 'Internal Medicine',
        'النسائية و التوليد': 'Gynecology',
        'النسائية والتوليد': 'Gynecology',
        'نسائية وتوليد': 'Gynecology',
        'نسائية': 'Gynecology',
        'تخدير العناية المركزة': 'ICU Anaesthesia',
        'تخدير العمليات': 'OT Anaesthesia',
        'تخدير صالة الولادة': 'GYN Anaesthesia',
        'التخدير و العناية المركزة': 'Anaesthesia & Intensive Care',
        'تخدير': 'Anaesthesia & Intensive Care',
        'الأشعة و السونار': 'Radiology',
        'الأشعة والسونار': 'Radiology',
        'أشعة وسونار': 'Radiology',
        'أشعة': 'Radiology',
        'الوفيات': 'Death Certificates',
        'المعاون الاداري': 'Administrative Officer',
        'طب الاورام': 'Oncology',
        'الأورام': 'Oncology',
        'اورام': 'Oncology',
        'طب امراض الكلى': 'Nephrology',
        'كلى': 'Nephrology',
        'طب الجملة العصبية': 'Neuromedicine',
        'جملة عصبية باطنية': 'Neuromedicine',
        'النفسية': 'Psychiatry',
        'طب نفسي': 'Psychiatry',
        'الجلدية': 'Dermatology',
        'جلدية': 'Dermatology',
        'طب الطوارئ': 'Emergency Medicine',
        'طوارئ': 'Emergency Medicine',
        'طب الأسرة': 'Family Medicine',
        'طب الاسرة': 'Family Medicine',
        'ممارسين': 'General Practitioner',
        'عام': 'General Practitioner',
        'طب الامراض القلبية': 'Cardiology',
        'قلبية': 'Cardiology',
        'الجراحة التجميلية': 'Plastic Surgery',
        'جراحة التجميل': 'Plastic Surgery',
        'تجميل': 'Plastic Surgery',
        'طب الامراض التنفسية': 'Respiratory Medicine',
        'تنفسية': 'Respiratory Medicine',
        'الاحالات': 'Referrals',
        'أمراض الدم': 'Haematology',
        'امراض الدم': 'Haematology'
    };

    const SPECIALTY_EN_CANONICAL_MAP = {
        'cardiothoracic': 'Cardiothoracic Surgery',
        'cardiothoracicsurgery': 'Cardiothoracic Surgery',
        'cardiothoracic surgery': 'Cardiothoracic Surgery',
        'general surgery': 'General Surgery',
        'generalsurgery': 'General Surgery',
        'neurosurgery': 'Neurosurgery',
        'orthopaedics': 'Orthopaedics',
        'orthopedics': 'Orthopaedics',
        'urosurgery': 'Urosurgery',
        'ent': 'ENT',
        'maxillofacial surgery': 'MaxilloFacial Surgery',
        'maxillofacial': 'MaxilloFacial Surgery',
        'ophthalmology': 'Ophthalmology',
        'paediatrics': 'Paediatrics',
        'pediatrics': 'Paediatrics',
        'internal medicine': 'Internal Medicine',
        'internalmedicine': 'Internal Medicine',
        'gynecology': 'Gynecology',
        'obstetrics & gynecology': 'Gynecology',
        'icu anaesthesia': 'ICU Anaesthesia',
        'ot anaesthesia': 'OT Anaesthesia',
        'gyn anaesthesia': 'GYN Anaesthesia',
        'anaesthesia & intensive care': 'Anaesthesia & Intensive Care',
        'anaesthesia': 'Anaesthesia & Intensive Care',
        'radiology': 'Radiology',
        'death certificates': 'Death Certificates',
        'administrative officer': 'Administrative Officer',
        'oncology': 'Oncology',
        'nephrology': 'Nephrology',
        'neuromedicine': 'Neuromedicine',
        'psychiatry': 'Psychiatry',
        'dermatology': 'Dermatology',
        'emergency medicine': 'Emergency Medicine',
        'emergency': 'Emergency Medicine',
        'emergencymedicine': 'Emergency Medicine',
        'family medicine': 'Family Medicine',
        'general practitioner': 'General Practitioner',
        'gp': 'General Practitioner',
        'cardiology': 'Cardiology',
        'plastic surgery': 'Plastic Surgery',
        'plasticsurgery': 'Plastic Surgery',
        'respiratory medicine': 'Respiratory Medicine',
        'referrals': 'Referrals',
        'haematology': 'Haematology',
        'hematology': 'Haematology'
    };

    const SPECIALTY_ID_MAP = {
        'NS': 'Neurosurgery',
        'CT': 'Cardiothoracic Surgery',
        'GS': 'General Surgery',
        'OR': 'Orthopaedics',
        'US': 'Urosurgery',
        'ENT': 'ENT',
        'MF': 'MaxilloFacial Surgery',
        'O': 'Ophthalmology',
        'Pe': 'Paediatrics',
        'M': 'Internal Medicine',
        'G': 'Gynecology',
        'ICU': 'ICU Anaesthesia',
        'OP': 'OT Anaesthesia',
        'GA': 'GYN Anaesthesia',
        'A': 'Anaesthesia & Intensive Care',
        'R': 'Radiology',
        'D': 'Death Certificates',
        'AO': 'Administrative Officer',
        'ON': 'Oncology',
        'N': 'Nephrology',
        'NM': 'Neuromedicine',
        'P': 'Psychiatry',
        'Der': 'Dermatology',
        'EM': 'Emergency Medicine',
        'FM': 'Family Medicine',
        'GP': 'General Practitioner',
        'H': 'Cardiology',
        'PS': 'Plastic Surgery',
        'RM': 'Respiratory Medicine',
        'REFE': 'Referrals'
    };

    function canonicalizeSpecialtyName(rawName) {
        if (!rawName || typeof rawName !== 'string') return 'General Surgery';
        const trimmed = rawName.trim();
        if (!trimmed) return 'General Surgery';

        // 1. Direct ID match (e.g. 'GS', 'CT')
        if (SPECIALTY_ID_MAP[trimmed]) return SPECIALTY_ID_MAP[trimmed];

        // 2. Arabic name mapping
        if (SPECIALTY_AR_TO_EN_MAP[trimmed]) return SPECIALTY_AR_TO_EN_MAP[trimmed];
        const normAr = normalizeArabic(trimmed);
        for (const [ar, en] of Object.entries(SPECIALTY_AR_TO_EN_MAP)) {
            if (normalizeArabic(ar) === normAr) return en;
        }

        // 3. English canonical mapping (case-insensitive)
        const lower = trimmed.toLowerCase();
        if (SPECIALTY_EN_CANONICAL_MAP[lower]) return SPECIALTY_EN_CANONICAL_MAP[lower];

        // 4. Return trimmed
        return trimmed;
    }

    function getHospitalSpecialties(hospId) {
        const id = hospId || state.hospitalId;
        const result = [];
        const seen = new Set();

        const addSpec = (nameAr, nameEn, col) => {
            const canonicalEn = canonicalizeSpecialtyName(nameEn || nameAr);
            if (!canonicalEn || seen.has(canonicalEn.toLowerCase())) return;
            seen.add(canonicalEn.toLowerCase());

            result.push({
                name: canonicalEn,
                name_en: canonicalEn,
                name_ar: nameAr && typeof nameAr === 'string' ? nameAr.trim() : '',
                color: col || getSpecialtyColor(canonicalEn)
            });
        };

        // 1. From window.Hub / hub-data for specified hospital
        const hosp = getHospitalRecord(id);
        if (hosp && Array.isArray(hosp.specialties)) {
            hosp.specialties.forEach(s => {
                const en = s.name_en || s.enName || SPECIALTY_ID_MAP[s.id] || '';
                addSpec(s.name_ar || s.name, en, s.color);
            });
        }

        // 2. From residents in state (canonicalized to English)
        (state.residents || []).forEach(r => {
            if (r.specialty) {
                const en = canonicalizeSpecialtyName(r.specialty);
                addSpec('', en, getSpecialtyColor(en));
            }
        });

        // 3. Fallback standard list (English names matching Hospital Hub)
        const fallbackList = [
            { en: 'General Surgery', ar: 'الجراحة العامة' },
            { en: 'Cardiothoracic Surgery', ar: 'جراحة الصدر و الاوعية الدموية' },
            { en: 'Neurosurgery', ar: 'جراحة الجملة العصبية' },
            { en: 'Orthopaedics', ar: 'الكسور' },
            { en: 'Urosurgery', ar: 'جراحة المسالك البولية' },
            { en: 'ENT', ar: 'الأذن و الأنف و الحنجرة' },
            { en: 'MaxilloFacial Surgery', ar: 'جراحة الوجه و الفكين' },
            { en: 'Ophthalmology', ar: 'العيون' },
            { en: 'Plastic Surgery', ar: 'جراحة التجميل' },
            { en: 'Internal Medicine', ar: 'الباطنية' },
            { en: 'Paediatrics', ar: 'طب الأطفال' },
            { en: 'Gynecology', ar: 'النسائية و التوليد' },
            { en: 'Emergency Medicine', ar: 'طب الطوارئ' },
            { en: 'Dermatology', ar: 'الجلدية' },
            { en: 'Radiology', ar: 'الأشعة والسونار' },
            { en: 'Oncology', ar: 'الأورام' },
            { en: 'Haematology', ar: 'أمراض الدم' },
            { en: 'Family Medicine', ar: 'طب الأسرة' },
            { en: 'Anaesthesia & Intensive Care', ar: 'التخدير و العناية المركزة' },
            { en: 'Cardiology', ar: 'طب الامراض القلبية' },
            { en: 'General Practitioner', ar: 'ممارسين' }
        ];

        fallbackList.forEach(item => {
            addSpec(item.ar, item.en, getSpecialtyColor(item.en));
        });

        return result;
    }

    // Numeric stage representation: 0 = No board / No stage, 1..6 = Stages 1 to 6
    function getResidentStageNumber(resident) {
        if (!resident) return 0;
        const board = String(resident.board || '').trim();
        if (!board || board === 'None' || board === 'none' || board === 'بدون' || board === 'لا يوجد') {
            return 0;
        }
        const norm = normalizeStageName(resident.stage);
        switch (norm) {
            case 'الأولى': return 1;
            case 'الثانية': return 2;
            case 'الثالثة': return 3;
            case 'الرابعة': return 4;
            case 'الخامسة': return 5;
            case 'السادسة': return 6;
            case 'بدون': return 0;
            default: {
                const num = parseInt(norm, 10);
                return isNaN(num) ? 0 : num;
            }
        }
    }

    // Resident Sorting Algorithm
    function sortResidentsList(list, sortCol, sortDir) {
        const scheduledCounts = getScheduledCountsMap();

        return [...list].sort((a, b) => {
            let res = 0;
            switch (sortCol) {
                case 'row':
                    res = (Number(a.row) || 0) - (Number(b.row) || 0);
                    break;
                case 'name': {
                    const nameA = (a.name || '').replace(/^د\.\s*/, '').trim();
                    const nameB = (b.name || '').replace(/^د\.\s*/, '').trim();
                    res = nameA.localeCompare(nameB, 'ar');
                    break;
                }
                case 'sex':
                    res = (a.sex || '').localeCompare(b.sex || '');
                    break;
                case 'specialty':
                    res = (a.specialty || '').localeCompare(b.specialty || '', 'en');
                    break;
                case 'board':
                    res = (a.board || '').localeCompare(b.board || '');
                    break;
                case 'stage': {
                    const stageA = getResidentStageNumber(a);
                    const stageB = getResidentStageNumber(b);
                    res = stageA - stageB;
                    if (res === 0) {
                        const nameA = (a.name || '').replace(/^د\.\s*/, '').trim();
                        const nameB = (b.name || '').replace(/^د\.\s*/, '').trim();
                        res = nameA.localeCompare(nameB, 'ar');
                    }
                    break;
                }
                case 'er_target':
                    res = (Number(a.er_target) || 0) - (Number(b.er_target) || 0);
                    break;
                case 'con_target':
                    res = (Number(a.con_target) || 0) - (Number(b.con_target) || 0);
                    break;
                case 'dc_target':
                    res = (Number(a.dc_target) || 0) - (Number(b.dc_target) || 0);
                    break;
                case 'rs_target':
                    res = (Number(a.rs_target) || 0) - (Number(b.rs_target) || 0);
                    break;
                case 'quota': {
                    const normA = (Number(a.er_target) || 0) + (Number(a.con_target) || 0) + (Number(a.dc_target) || 0);
                    const normB = (Number(b.er_target) || 0) + (Number(b.con_target) || 0) + (Number(b.dc_target) || 0);
                    const countA = (scheduledCounts[normalizeArabic(a.name)] || {}).normalScheduled || 0;
                    const countB = (scheduledCounts[normalizeArabic(b.name)] || {}).normalScheduled || 0;
                    const fulA = normA > 0 && countA >= normA ? 1 : 0;
                    const fulB = normB > 0 && countB >= normB ? 1 : 0;
                    res = fulA - fulB;
                    break;
                }
                case 'expiryMonth':
                    res = (a.expiryMonth || '').localeCompare(b.expiryMonth || '');
                    break;
                default: {
                    const nameA = (a.name || '').replace(/^د\.\s*/, '').trim();
                    const nameB = (b.name || '').replace(/^د\.\s*/, '').trim();
                    res = nameA.localeCompare(nameB, 'ar');
                }
            }
            return sortDir === 'desc' ? -res : res;
        });
    }

    function onDBSortColumn(colKey) {
        if ((state.dbSortColumn || 'name') === colKey) {
            state.dbSortDirection = state.dbSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            state.dbSortColumn = colKey;
            state.dbSortDirection = 'asc';
        }
        saveState();
        refreshDBView();
    }

    function getSortHeaderHTML(colKey, label, widthClass, extraClass = '') {
        const isCurrent = (state.dbSortColumn || 'name') === colKey;
        const icon = isCurrent 
            ? (state.dbSortDirection === 'desc' ? 'fa-arrow-down-wide-short text-rose-600' : 'fa-arrow-up-wide-short text-rose-600')
            : 'fa-sort text-slate-300 dark:text-slate-600 group-hover:text-slate-500';

        return `
            <th onclick="onDBSortColumn('${colKey}')" 
                class="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 py-3 px-2 ${widthClass} ${extraClass} cursor-pointer hover:bg-slate-200/80 dark:hover:bg-slate-800 select-none transition group shadow-2xs"
                title="انقر للترتيب ${isCurrent && state.dbSortDirection === 'asc' ? 'تنازلياً' : 'تصاعدياً'} بحسب ${label}">
                <div class="flex items-center justify-center gap-1">
                    <span>${label}</span>
                    <i class="fas ${icon} text-[10px]"></i>
                </div>
            </th>
        `;
    }

    function onDBMonthChange(monthVal, yearVal) {
        onMonthYearChange(monthVal, yearVal);
        refreshDBView();
    }

    // Modal to Import Allocations from previous months
    function openImportMonthAllocationsModal() {
        const modal = document.getElementById('import-allocations-modal');
        const body = document.getElementById('import-allocations-modal-body');
        if (!modal || !body) return;

        const monthNames = [
            'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
            'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
        ];

        const availableMonths = [];
        for (let y = 2025; y <= 2028; y++) {
            for (let m = 1; m <= 12; m++) {
                if (y === state.year && m === state.month) continue;
                
                const key = `${state.hospitalId}_${y}_${m}`;
                let rec = null;
                try {
                    const raw = localStorage.getItem(MONTH_ALLOC_PREFIX + key);
                    if (raw) rec = JSON.parse(raw);
                } catch (e) {}
                if (!rec && state.monthlyAllocations && state.monthlyAllocations[key]) {
                    rec = state.monthlyAllocations[key];
                }
                if (!rec && state.hospitalId === 'iraqi' && y === 2026 && m === 9 && window.DEFAULT_EMERGENCY_DATA) {
                    rec = window.DEFAULT_EMERGENCY_DATA.residents;
                }

                if (rec && Object.keys(rec).length > 0) {
                    availableMonths.push({
                        year: y,
                        month: m,
                        label: `${monthNames[m - 1]} ${y}`,
                        count: Array.isArray(rec) ? rec.length : Object.keys(rec).length
                    });
                }
            }
        }

        const prev = getPreviousMonth(state.year, state.month);
        const prevLabel = `${monthNames[prev.month - 1]} ${prev.year}`;

        body.innerHTML = `
            <div class="space-y-4">
                <div class="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200/80 dark:border-amber-800/60 text-slate-700 dark:text-slate-300">
                    <div class="font-bold text-xs text-amber-900 dark:text-amber-200 mb-1">
                        <i class="fas fa-circle-info ml-1 text-amber-600"></i>
                        الشهر المستهدف الحالي: <strong>${state.monthYear}</strong>
                    </div>
                    <p class="text-[11px] leading-relaxed">
                        سيتم استيراد أنصبة الخفارات الرسمية (ER, Con, DC, RS) وحالات التنشيط لجميع الأطباء من الشهر المختار ونقلها إلى شهر (${state.monthYear}).
                    </p>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">اختر الشهر السابق للاستيراد منه:</label>
                    <select id="import-source-month-select" class="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs">
                        <option value="${prev.year}_${prev.month}">الشهر السابق مباشرة (${prevLabel})</option>
                        ${availableMonths.filter(am => !(am.year === prev.year && am.month === prev.month)).map(am => `
                            <option value="${am.year}_${am.month}">${am.label} (${am.count} طبيب)</option>
                        `).join('')}
                    </select>
                </div>

                <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                    <button type="button" onclick="closeImportMonthAllocationsModal()" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                        إلغاء
                    </button>
                    <button type="button" onclick="executeImportMonthAllocations()" class="px-5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-file-import"></i>
                        <span>تأكيد استيراد الأنصبة</span>
                    </button>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    function closeImportMonthAllocationsModal() {
        const modal = document.getElementById('import-allocations-modal');
        if (modal) modal.classList.add('hidden');
    }

    function executeImportMonthAllocations() {
        const select = document.getElementById('import-source-month-select');
        if (!select) return;

        const [srcYearStr, srcMonthStr] = select.value.split('_');
        const srcYear = parseInt(srcYearStr, 10);
        const srcMonth = parseInt(srcMonthStr, 10);

        const srcKey = `${state.hospitalId}_${srcYear}_${srcMonth}`;
        let srcMap = null;
        try {
            const raw = localStorage.getItem(MONTH_ALLOC_PREFIX + srcKey);
            if (raw) srcMap = JSON.parse(raw);
        } catch (e) {}
        if (!srcMap && state.monthlyAllocations && state.monthlyAllocations[srcKey]) {
            srcMap = state.monthlyAllocations[srcKey];
        }
        if (!srcMap && state.hospitalId === 'iraqi' && srcYear === 2026 && srcMonth === 9 && window.DEFAULT_EMERGENCY_DATA) {
            srcMap = {};
            window.DEFAULT_EMERGENCY_DATA.residents.forEach(r => {
                srcMap[r.id] = {
                    active: r.active !== false,
                    er_target: Number(r.er_target) || 0,
                    con_target: Number(r.con_target) || 0,
                    dc_target: Number(r.dc_target) || 0,
                    rs_target: Number(r.rs_target) || 0
                };
            });
        }

        if (!srcMap || Object.keys(srcMap).length === 0) {
            showNotification('لا توجد بيانات مسجلة في الشهر المختار للاستيراد منه', 'warning');
            return;
        }

        pushDBHistory(`استيراد الأنصبة من شهر ${srcMonth}/${srcYear}`);

        let importedCount = 0;
        (state.residents || []).forEach(r => {
            if (srcMap[r.id]) {
                r.active = srcMap[r.id].active !== undefined ? Boolean(srcMap[r.id].active) : true;
                r.er_target = Number(srcMap[r.id].er_target) || 0;
                r.con_target = Number(srcMap[r.id].con_target) || 0;
                r.dc_target = Number(srcMap[r.id].dc_target) || 0;
                r.rs_target = Number(srcMap[r.id].rs_target) || 0;
                importedCount++;
            }
        });

        saveCurrentMonthAllocationsToStore();
        saveState();
        closeImportMonthAllocationsModal();
        updateDutyDashboard();
        refreshDBView();
        updateDBUndoRedoUI();
        showNotification(`تم بنجاح استيراد أنصبة وإحصائيات ${importedCount} طبيب من شهر (${srcMonth}/${srcYear}) إلى شهر (${state.monthYear})`, 'success');
    }

    function renderDBView(container) {
        if (!container) {
            container = getDBContainer();
        }
        if (!container) return;

        const residents = state.residents || [];
        const scheduledCounts = getScheduledCountsMap();

        // Separate Active and Inactive Residents for the selected month
        const rawActive = residents.filter(r => r.active);
        const rawInactive = residents.filter(r => !r.active);

        // Sort lists according to current sort column and direction
        const activeList = sortResidentsList(rawActive, state.dbSortColumn || 'name', state.dbSortDirection || 'asc');
        const inactiveList = sortResidentsList(rawInactive, state.dbSortColumn || 'name', state.dbSortDirection || 'asc');

        const allUniqueSpecs = Array.from(new Set(
            residents.map(r => r.specialty).filter(Boolean)
                .concat(getHospitalSpecialties(state.hospitalId).map(s => s.name))
        )).sort((a, b) => a.localeCompare(b, 'en'));

        const monthNames = [
            'كانون الثاني (1)', 'شباط (2)', 'آذار (3)', 'نيسان (4)', 'أيار (5)', 'حزيران (6)',
            'تموز (7)', 'آب (8)', 'أيلول (9)', 'تشرين الأول (10)', 'تشرين الثاني (11)', 'كانون الأول (12)'
        ];

        let html = `
            <div class="space-y-5">
                <!-- DB Header Actions & Controls -->
                <div class="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <div>
                        <div class="flex items-center gap-2">
                            <h2 class="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <i class="fas fa-users-gear text-rose-600"></i>
                                <span>قاعدة المقيمين الأقدمين والأنصبة (DB)</span>
                            </h2>
                            <!-- Live Month Selector in DB Header -->
                            <div class="flex items-center gap-1.5 p-1 px-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                                <i class="fas fa-calendar-days text-rose-600 text-xs"></i>
                                <span class="font-bold text-[11px] text-slate-500">شهر:</span>
                                <select id="db-month-select" onchange="onDBMonthChange(this.value, document.getElementById('db-year-select').value)" class="text-xs font-black bg-transparent border-0 text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none">
                                    ${monthNames.map((m, idx) => `<option value="${idx + 1}" ${state.month === (idx + 1) ? 'selected' : ''}>${m}</option>`).join('')}
                                </select>
                                <select id="db-year-select" onchange="onDBMonthChange(document.getElementById('db-month-select').value, this.value)" class="text-xs font-mono font-bold bg-transparent border-0 text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none">
                                    ${[2025, 2026, 2027, 2028].map(y => `<option value="${y}" ${state.year === y ? 'selected' : ''}>${y}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <p class="text-xs text-slate-500 mt-1">
                            الأنصبة والحالات شهرية مستقلة · انقر على ترويسة أي عمود لترتيب الأطباء تصاعدياً أو تنازلياً
                        </p>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <!-- Undo / Redo in Toolbar -->
                        <div class="flex items-center gap-1 ps-1 pe-2 border-e border-slate-200 dark:border-slate-800">
                            <button type="button" onclick="undoDBAction()" class="db-undo-btn px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-1 shadow-2xs opacity-40 cursor-not-allowed" title="تراجع عن آخر تعديل في اللوحة (Ctrl+Z)" disabled>
                                <i class="fas fa-undo text-slate-500"></i>
                                <span>تراجع</span>
                            </button>
                            <button type="button" onclick="redoDBAction()" class="db-redo-btn px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-1 shadow-2xs opacity-40 cursor-not-allowed" title="إعادة تطبيق التعديل (Ctrl+Y)" disabled>
                                <i class="fas fa-redo text-slate-500"></i>
                                <span>إعادة</span>
                            </button>
                        </div>

                        <!-- Import Allocations from Previous Month Button -->
                        <button type="button" onclick="openImportMonthAllocationsModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition flex items-center gap-1.5 shadow-xs" title="استيراد أنصبة وإحصائيات الأطباء من أي شهر سابق">
                            <i class="fas fa-clock-rotate-left"></i>
                            <span>استيراد من شهر سابق</span>
                        </button>

                        <!-- Advance Board Stage Button -->
                        <button type="button" onclick="advanceBoardResidentsStage()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition flex items-center gap-1.5 shadow-xs" title="تقديم مرحلة جميع أطباء البورد النشطين بمقدار مرحلة واحدة">
                            <i class="fas fa-graduation-cap"></i>
                            <span>ترفيع مرحلة البورد (+1)</span>
                        </button>

                        <!-- Toggle Show/Hide Inactive Button -->
                        <button type="button" id="toggle-inactive-btn" onclick="toggleShowInactiveInDB()" class="px-3 py-1.5 rounded-xl text-xs font-bold ${state.showInactiveInDB ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 hover:bg-amber-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200'} transition flex items-center gap-1.5 cursor-pointer">
                            <i class="fas ${state.showInactiveInDB ? 'fa-eye' : 'fa-eye-slash'}"></i>
                            <span>${state.showInactiveInDB ? 'إخفاء غير النشطين' : `إظهار غير النشطين (${inactiveList.length})`}</span>
                        </button>

                        <!-- Import Resident from Hospital with Detail Review -->
                        <button type="button" onclick="openImportResidentFromHospitalModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition flex items-center gap-1.5 shadow-xs" title="استيراد مقيم من أي مستشفى وتعبئة تفاصيل الطوارئ">
                            <i class="fas fa-hospital-user"></i>
                            <span>استيراد مقيم من مستشفى</span>
                        </button>

                        <button type="button" onclick="openHospitalSyncModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 transition flex items-center gap-1.5">
                            <i class="fas fa-arrows-rotate"></i>
                            <span>مطابقة مع المستشفى</span>
                        </button>

                        <button type="button" onclick="openAddResidentModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition flex items-center gap-1.5">
                            <i class="fas fa-user-plus"></i>
                            <span>إضافة طبيب جديد</span>
                        </button>

                        <!-- Backup Residents Database Button -->
                        <button type="button" onclick="backupResidentsDatabase()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition flex items-center gap-1.5 shadow-xs" title="حفظ وتنزيل نسخة احتياطية من قاعدة بيانات أطباء الطوارئ الحالية (JSON)">
                            <i class="fas fa-download text-emerald-600 dark:text-emerald-400"></i>
                            <span>نسخ احتياطي</span>
                        </button>

                        <!-- Restore Residents Database from Backup Button -->
                        <button type="button" onclick="triggerRestoreResidentsDatabase()" class="px-3 py-1.5 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition flex items-center gap-1.5 shadow-xs" title="استعادة قاعدة بيانات أطباء الطوارئ من ملف نسخة احتياطية سابقة (JSON)">
                            <i class="fas fa-upload text-blue-600 dark:text-blue-400"></i>
                            <span>استعادة نسخة</span>
                        </button>
                        <input type="file" id="db-restore-file-input" accept=".json,application/json" onchange="handleRestoreResidentsFile(event)" class="hidden" style="display:none;">
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
                        <!-- Specialty Filter -->
                        <select id="db-filter-specialty" onchange="applyDBLiveFilter()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs">
                            <option value="all">الاختصاص: الكل</option>
                            ${allUniqueSpecs.map(s => `<option value="${escapeForInline(s)}">${s}</option>`).join('')}
                        </select>

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

                <!-- Duty Allocations Dashboard Checkers (Real-Time Live Counters) -->
                ${renderDBDutyCheckersHTML()}

                <!-- 1. ACTIVE RESIDENTS SECTION -->
                <div class="space-y-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <h3 class="text-sm font-black text-slate-800 dark:text-slate-100">الأطباء النشطون لشهر (${state.monthYear}) (<span id="active-res-count">${activeList.length}</span>)</h3>
                    </div>

                    <div id="db-active-table-wrapper" class="overflow-auto max-h-[68vh] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative">
                        <table class="w-full text-right border-collapse text-xs">
                            <thead class="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 shadow-xs">
                                <tr class="bg-slate-100/90 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                    ${getSortHeaderHTML('row', '#', 'w-10', 'text-center font-bold')}
                                    ${getSortHeaderHTML('name', 'اسم المقيم الأقدم', 'w-48', 'font-bold text-right')}
                                    ${getSortHeaderHTML('sex', 'الجنس', 'w-16', 'text-center font-bold')}
                                    ${getSortHeaderHTML('specialty', 'الاختصاص', 'w-36', 'font-bold text-center')}
                                    ${getSortHeaderHTML('board', 'البورد', 'w-24', 'text-center font-bold')}
                                    ${getSortHeaderHTML('stage', 'المرحلة', 'w-20', 'text-center font-bold')}
                                    ${getSortHeaderHTML('er_target', 'نصاب ER', 'w-16', 'text-center font-bold text-rose-600')}
                                    ${getSortHeaderHTML('con_target', 'نصاب Con', 'w-16', 'text-center font-bold text-sky-600')}
                                    ${getSortHeaderHTML('dc_target', 'نصاب DC', 'w-16', 'text-center font-bold text-emerald-600')}
                                    ${state.rsEnabled ? getSortHeaderHTML('rs_target', 'نصاب RS', 'w-16', 'text-center font-bold text-amber-600') : ''}
                                    ${getSortHeaderHTML('quota', 'حالة النصاب', 'w-32', 'font-bold text-center')}
                                    ${getSortHeaderHTML('expiryMonth', 'شهر الانتهاء', 'w-28', 'font-bold text-center')}
                                    <th class="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 py-3 px-2 w-20 text-center font-bold shadow-2xs">الرغبات</th>
                                    <th class="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 py-3 px-2 w-14 text-center font-bold shadow-2xs">تعطيل</th>
                                    <th class="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900 py-3 px-2 w-20 text-center font-bold shadow-2xs">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
                                ${activeList.map((r, idx) => renderResidentRowHTML(r, idx + 1, scheduledCounts, false)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 2. INACTIVE RESIDENTS ISOLATED SECTION (Toggleable in-place) -->
                <div id="inactive-residents-section" class="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-800 ${state.showInactiveInDB ? '' : 'hidden'}">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                        <h3 class="text-sm font-black text-slate-500 dark:text-slate-400">الأطباء غير النشطين / المعطلين لشهر (${state.monthYear}) (${inactiveList.length})</h3>
                        <span class="text-[11px] text-slate-400">(تم تعطيلهم وتصفير أنصبتهم لهذا الشهر ومستبعدون من جداول خفاراته)</span>
                    </div>

                    <div id="db-inactive-table-wrapper" class="overflow-auto max-h-[50vh] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm opacity-80 relative">
                        <table class="w-full text-right border-collapse text-xs bg-slate-50/50 dark:bg-slate-900/20">
                            <thead class="sticky top-0 z-20 bg-slate-200 dark:bg-slate-900 shadow-xs">
                                <tr class="bg-slate-200/90 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                                    ${getSortHeaderHTML('row', '#', 'w-10', 'text-center font-bold')}
                                    ${getSortHeaderHTML('name', 'اسم المقيم الأقدم', 'w-48', 'font-bold text-right')}
                                    ${getSortHeaderHTML('sex', 'الجنس', 'w-16', 'text-center font-bold')}
                                    ${getSortHeaderHTML('specialty', 'الاختصاص', 'w-36', 'font-bold text-center')}
                                    ${getSortHeaderHTML('board', 'البورد', 'w-24', 'text-center font-bold')}
                                    ${getSortHeaderHTML('stage', 'المرحلة', 'w-20', 'text-center font-bold')}
                                    ${getSortHeaderHTML('er_target', 'نصاب ER', 'w-16', 'text-center font-bold')}
                                    ${getSortHeaderHTML('con_target', 'نصاب Con', 'w-16', 'text-center font-bold')}
                                    ${getSortHeaderHTML('dc_target', 'نصاب DC', 'w-16', 'text-center font-bold')}
                                    ${state.rsEnabled ? getSortHeaderHTML('rs_target', 'نصاب RS', 'w-16', 'text-center font-bold') : ''}
                                    ${getSortHeaderHTML('quota', 'الحالة', 'w-32', 'font-bold text-center')}
                                    ${getSortHeaderHTML('expiryMonth', 'شهر الانتهاء', 'w-28', 'font-bold text-center')}
                                    <th class="sticky top-0 z-20 bg-slate-200 dark:bg-slate-900 py-2.5 px-2 w-20 text-center font-bold shadow-2xs">تنشيط</th>
                                    <th class="sticky top-0 z-20 bg-slate-200 dark:bg-slate-900 py-2.5 px-2 w-20 text-center font-bold shadow-2xs">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-800/60">
                                ${inactiveList.length > 0 
                                    ? inactiveList.map((r, idx) => renderResidentRowHTML(r, idx + 1, scheduledCounts, true)).join('')
                                    : `<tr><td colspan="${state.rsEnabled ? 14 : 13}" class="py-4 text-center text-slate-400 font-bold">لا يوجد أطباء غير نشطين في هذا الشهر</td></tr>`
                                }
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;

        container.innerHTML = html;
        if (state.dbSearchQuery) applyDBLiveFilter(state.dbSearchQuery);
        updateDBUndoRedoUI();
    }

    function applyDBLiveFilter(queryVal) {
        if (queryVal !== undefined) {
            state.dbSearchQuery = queryVal.trim();
        } else {
            const input = document.getElementById('db-search-input');
            if (input) state.dbSearchQuery = input.value.trim();
        }
        const cleanQ = normalizeArabic(state.dbSearchQuery || '').toLowerCase();

        const specFilter = document.getElementById('db-filter-specialty')?.value || 'all';
        const sexFilter = document.getElementById('db-filter-sex')?.value || 'all';
        const boardFilter = document.getElementById('db-filter-board')?.value || 'all';
        const stageFilter = document.getElementById('db-filter-stage')?.value || 'all';
        const quotaFilter = document.getElementById('db-filter-quota')?.value || 'all';

        const dbContainer = getDBContainer();
        const rows = dbContainer ? dbContainer.querySelectorAll('tr[data-resident-id]') : document.querySelectorAll('tr[data-resident-id]');
        let visibleCount = 0;

        rows.forEach(tr => {
            const name = tr.getAttribute('data-name') || '';
            const sex = tr.getAttribute('data-sex') || '';
            const spec = (tr.getAttribute('data-spec') || '').toLowerCase();
            const board = tr.getAttribute('data-board') || '';
            const stage = tr.getAttribute('data-stage') || '';
            const quotaStatus = tr.getAttribute('data-quota-status') || '';
            const hasExtra = tr.getAttribute('data-has-extra') === 'true';

            if (specFilter !== 'all' && spec !== specFilter.toLowerCase()) { tr.style.display = 'none'; return; }
            if (sexFilter !== 'all' && sex !== sexFilter) { tr.style.display = 'none'; return; }
            if (boardFilter !== 'all' && board !== boardFilter) { tr.style.display = 'none'; return; }
            if (stageFilter !== 'all' && stage !== stageFilter) { tr.style.display = 'none'; return; }
            if (quotaFilter === 'fulfilled' && quotaStatus !== 'fulfilled') { tr.style.display = 'none'; return; }
            if (quotaFilter === 'unfulfilled' && quotaStatus !== 'unfulfilled') { tr.style.display = 'none'; return; }
            if (quotaFilter === 'extra' && !hasExtra) { tr.style.display = 'none'; return; }

            if (cleanQ) {
                const cleanName = normalizeArabic(name).toLowerCase();
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
            const hasFilter = cleanQ || specFilter !== 'all' || sexFilter !== 'all' || boardFilter !== 'all' || stageFilter !== 'all' || quotaFilter !== 'all';
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
        const sSpec = document.getElementById('db-filter-specialty');
        if (sSpec) sSpec.value = 'all';
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

    function renderSexBubbleHTML(r) {
        if (r.sex === 'F') {
            return `<button type="button" onclick="toggleResidentSex('${r.id}')" class="px-2.5 py-1 rounded-full text-xs font-black transition-all shadow-xs cursor-pointer bg-pink-100 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 border border-pink-300 dark:border-pink-800 hover:scale-105 active:scale-95 inline-flex items-center gap-1 select-none" title="انقر للتبديل إلى ذكر">
                <i class="fas fa-venus text-[10px]"></i>
                <span>أنثى</span>
            </button>`;
        } else {
            return `<button type="button" onclick="toggleResidentSex('${r.id}')" class="px-2.5 py-1 rounded-full text-xs font-black transition-all shadow-xs cursor-pointer bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 hover:scale-105 active:scale-95 inline-flex items-center gap-1 select-none" title="انقر للتبديل إلى أنثى">
                <i class="fas fa-mars text-[10px]"></i>
                <span>ذكر</span>
            </button>`;
        }
    }

    function renderBoardBubbleHTML(r) {
        const board = r.board || 'None';
        if (board === 'Iraqi') {
            return `<button type="button" onclick="cycleResidentBoard('${r.id}')" class="px-2.5 py-1 rounded-full text-xs font-black transition-all shadow-xs cursor-pointer bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:scale-105 active:scale-95 inline-flex items-center gap-1 select-none" title="انقر للتبديل إلى عربي">
                <i class="fas fa-graduation-cap text-[10px]"></i>
                <span>عراقي</span>
            </button>`;
        } else if (board === 'Arabic') {
            return `<button type="button" onclick="cycleResidentBoard('${r.id}')" class="px-2.5 py-1 rounded-full text-xs font-black transition-all shadow-xs cursor-pointer bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700 hover:scale-105 active:scale-95 inline-flex items-center gap-1 select-none" title="انقر للتبديل إلى بدون">
                <i class="fas fa-graduation-cap text-[10px]"></i>
                <span>عربي</span>
            </button>`;
        } else {
            return `<button type="button" onclick="cycleResidentBoard('${r.id}')" class="px-2.5 py-1 rounded-full text-xs font-bold transition-all shadow-xs cursor-pointer bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:scale-105 active:scale-95 inline-flex items-center gap-1 select-none" title="انقر للتبديل إلى عراقي">
                <span>بدون</span>
            </button>`;
        }
    }

    function toggleResidentSex(id) {
        const res = (state.residents || []).find(r => r.id === id);
        if (!res) return;
        res.sex = (res.sex === 'F') ? 'M' : 'F';
        saveState();
        pushDBHistory(`تغيير جنس الطبيب (${res.name})`);
        const tr = document.querySelector(`tr[data-resident-id="${id}"]`);
        if (tr) {
            tr.setAttribute('data-sex', res.sex);
            const sexCell = tr.querySelector('.resident-sex-cell');
            if (sexCell) sexCell.innerHTML = renderSexBubbleHTML(res);
        }
        updateDutyDashboard();
    }

    function cycleResidentBoard(id) {
        const res = (state.residents || []).find(r => r.id === id);
        if (!res) return;
        if (res.board === 'Iraqi') {
            res.board = 'Arabic';
        } else if (res.board === 'Arabic') {
            res.board = 'None';
            res.stage = 'بدون';
        } else {
            res.board = 'Iraqi';
            if (!res.stage || res.stage === 'بدون') res.stage = 'الأولى';
        }
        saveState();
        pushDBHistory(`تغيير بورد الطبيب (${res.name})`);
        const tr = document.querySelector(`tr[data-resident-id="${id}"]`);
        if (tr) {
            tr.setAttribute('data-board', res.board);
            tr.setAttribute('data-stage', res.stage || 'بدون');
            const boardCell = tr.querySelector('.resident-board-cell');
            if (boardCell) boardCell.innerHTML = renderBoardBubbleHTML(res);
            const stageCell = tr.querySelector('.resident-stage-cell');
            if (stageCell) stageCell.innerHTML = renderStageBubbleHTML(res);
        }
    }

    function getStageBubbleClass(stage) {
        switch (stage) {
            case 'الأولى': return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-300 dark:border-blue-700';
            case 'الثانية': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700';
            case 'الثالثة': return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border-purple-300 dark:border-purple-700';
            case 'الرابعة': return 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300 border-pink-300 dark:border-pink-700';
            case 'الخامسة': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-300 dark:border-amber-700';
            case 'السادسة': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700';
            default: return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700';
        }
    }

    function renderStageBubbleHTML(r) {
        const isNoneBoard = r.board === 'None' || !r.board || r.board === 'بدون';
        if (isNoneBoard) {
            return `
                <button type="button" disabled class="px-2.5 py-1 rounded-full text-xs font-bold border transition-all shadow-2xs opacity-40 cursor-not-allowed inline-flex items-center justify-center min-w-[62px] bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700" title="لا توجد مرحلة لأطباء بدون بورد">
                    <span>بدون</span>
                </button>
            `;
        }
        const stage = r.stage || 'الأولى';
        const colorClass = getStageBubbleClass(stage);
        return `
            <button type="button" onclick="openStageOptionsModal('${r.id}', event)" class="px-2.5 py-1 rounded-full text-xs font-black border transition-all duration-150 shadow-2xs hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center min-w-[62px] ${colorClass}" title="انقر لاختيار مرحلة البورد">
                <span>${stage}</span>
            </button>
        `;
    }

    let activeStageResidentId = null;

    function openStageOptionsModal(residentId, event) {
        if (event) event.stopPropagation();
        const r = (state.residents || []).find(doc => doc.id === residentId);
        if (!r) return;
        if (r.board === 'None' || !r.board || r.board === 'بدون') return;

        activeStageResidentId = residentId;
        const modal = document.getElementById('stage-options-modal');
        const docNameEl = document.getElementById('stage-modal-docname');
        const optionsEl = document.getElementById('stage-modal-options');
        if (!modal || !optionsEl) return;

        if (docNameEl) docNameEl.textContent = `${r.name} · (${r.specialty || 'General'})`;

        const stages = [
            { name: 'الأولى', label: 'المرحلة الأولى (R1)', desc: 'السنة الأولى في برنامج البورد' },
            { name: 'الثانية', label: 'المرحلة الثانية (R2)', desc: 'السنة الثانية في برنامج البورد' },
            { name: 'الثالثة', label: 'المرحلة الثالثة (R3)', desc: 'السنة الثالثة في برنامج البورد' },
            { name: 'الرابعة', label: 'المرحلة الرابعة (R4)', desc: 'السنة الرابعة في برنامج البورد' },
            { name: 'الخامسة', label: 'المرحلة الخامسة (R5)', desc: 'السنة الخامسة في برنامج البورد' },
            { name: 'السادسة', label: 'المرحلة السادسة (R6)', desc: 'السنة السادسة في برنامج البورد' },
            { name: 'بدون', label: 'بدون تحديد', desc: 'طبيب مقيم أقدم ممارس بدون بورد' }
        ];

        optionsEl.innerHTML = stages.map(s => {
            const isSelected = r.stage === s.name || (!r.stage && s.name === 'بدون');
            const colorClass = getStageBubbleClass(s.name);
            return `
                <button type="button" onclick="selectResidentStage('${residentId}', '${s.name}')" 
                    class="w-full p-2.5 rounded-2xl border-2 text-right transition flex items-center justify-between gap-2 group ${isSelected ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/40' : 'border-slate-200 dark:border-slate-700 hover:border-purple-400 bg-white dark:bg-slate-900'}">
                    <div>
                        <div class="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${colorClass}">${s.name}</span>
                            <span>${s.label}</span>
                        </div>
                        <div class="text-[10px] text-slate-500 mt-0.5">${s.desc}</div>
                    </div>
                    ${isSelected ? '<i class="fas fa-check-circle text-purple-600 text-sm"></i>' : ''}
                </button>
            `;
        }).join('');

        modal.classList.remove('hidden');
    }

    function closeStageOptionsModal() {
        const modal = document.getElementById('stage-options-modal');
        if (modal) modal.classList.add('hidden');
        activeStageResidentId = null;
    }

    function selectResidentStage(residentId, newStage) {
        const r = (state.residents || []).find(doc => doc.id === residentId);
        if (!r) return;

        r.stage = newStage;
        saveState();
        pushDBHistory(`تغيير مرحلة الطبيب (${r.name}) إلى ${newStage}`);

        const tr = document.querySelector(`tr[data-resident-id="${residentId}"]`);
        if (tr) {
            tr.setAttribute('data-stage', newStage);
            const stageCell = tr.querySelector('.resident-stage-cell');
            if (stageCell) {
                stageCell.innerHTML = renderStageBubbleHTML(r);
            }
        }

        closeStageOptionsModal();
        showNotification(`تم تعيين المرحلة: ${newStage} للطبيب ${r.name}`, 'success');
    }

    // =========================================================================
    // SPECIALTY BUBBLE, PICKER & COLOR CUSTOMIZATION SYSTEM
    // =========================================================================

    function renderSpecialtyBubbleHTML(r) {
        const spec = r.specialty || 'عام';
        const color = getSpecialtyColor(spec);
        return `
            <button type="button" onclick="openSpecialtyPickerModal('${r.id}', event)" 
                class="px-2.5 py-1 rounded-full text-xs font-black border transition-all duration-150 shadow-2xs hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center gap-1.5 select-none" 
                style="background-color: ${color}15; color: ${color}; border-color: ${color}55;" 
                title="انقر لاختيار الاختصاص أو تعديل لونه">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color};"></span>
                <span>${spec}</span>
            </button>
        `;
    }

    let activeSpecialtyResidentId = null;

    function openSpecialtyPickerModal(residentId, event) {
        if (event) event.stopPropagation();
        const r = (state.residents || []).find(doc => doc.id === residentId);
        if (!r) return;

        activeSpecialtyResidentId = residentId;
        const modal = document.getElementById('specialty-options-modal');
        const docNameEl = document.getElementById('specialty-modal-docname');
        const optionsEl = document.getElementById('specialty-modal-options');
        if (!modal || !optionsEl) return;

        if (docNameEl) {
            docNameEl.textContent = `تحديد اختصاص: ${r.name}`;
        }

        const hospSpecs = getHospitalSpecialties(state.hospitalId);

        // Ensure current resident's specialty is included in list
        if (r.specialty && !hospSpecs.some(s => s.name === r.specialty)) {
            hospSpecs.unshift({
                name: r.specialty,
                name_en: '',
                color: getSpecialtyColor(r.specialty)
            });
        }

        let html = `
            <div class="space-y-2 mb-3">
                ${hospSpecs.map(s => {
                    const isSelected = (r.specialty === s.name);
                    const color = getSpecialtyColor(s.name);
                    return `
                        <div class="p-2.5 rounded-2xl border-2 transition flex items-center justify-between gap-2 ${isSelected ? 'border-rose-600 bg-rose-50/50 dark:bg-rose-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'}">
                            <button type="button" onclick="selectResidentSpecialty('${residentId}', '${escapeForInline(s.name)}')" class="flex-1 flex items-center gap-2 text-right">
                                <span class="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs border border-white dark:border-slate-800" style="background-color: ${color};"></span>
                                <span class="font-bold text-xs text-slate-800 dark:text-slate-100">${s.name}</span>
                                ${s.name_en ? `<span class="text-[10px] text-slate-400 font-mono">(${s.name_en})</span>` : ''}
                                ${isSelected ? '<i class="fas fa-check-circle text-rose-600 text-xs mr-auto ml-1"></i>' : ''}
                            </button>
                            <!-- Color Picker to customize specialty color -->
                            <div class="flex items-center gap-1.5 shrink-0 pl-1 border-r border-slate-200 dark:border-slate-700 pr-2" title="تعديل لون الاختصاص">
                                <input type="color" value="${color}" onchange="updateSpecialtyColor('${escapeForInline(s.name)}', this.value, event)" class="w-6 h-6 rounded-lg cursor-pointer border-0 bg-transparent p-0">
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <!-- Custom Specialty Entry -->
            <div class="pt-2 border-t border-slate-200 dark:border-slate-800">
                <label class="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">إضافة اختصاص جديد أو مخصص:</label>
                <div class="flex items-center gap-2">
                    <input type="text" id="new-custom-spec-input" placeholder="اسم الاختصاص الجديد..." class="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-rose-500/20">
                    <input type="color" id="new-custom-spec-color" value="#0284c7" class="w-7 h-7 rounded-lg cursor-pointer border-0 bg-transparent p-0" title="لون الاختصاص الجديد">
                    <button type="button" onclick="saveNewCustomSpecialty('${residentId}')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shrink-0">
                        تعيين
                    </button>
                </div>
            </div>
        `;

        optionsEl.innerHTML = html;
        modal.classList.remove('hidden');
    }

    function closeSpecialtyOptionsModal() {
        const modal = document.getElementById('specialty-options-modal');
        if (modal) modal.classList.add('hidden');
        activeSpecialtyResidentId = null;
    }

    function selectResidentSpecialty(residentId, newSpec) {
        const r = (state.residents || []).find(doc => doc.id === residentId);
        if (!r) return;

        r.specialty = newSpec;
        saveState();
        pushDBHistory(`تغيير اختصاص الطبيب (${r.name}) إلى ${newSpec}`);

        const tr = document.querySelector(`tr[data-resident-id="${residentId}"]`);
        if (tr) {
            tr.setAttribute('data-spec', newSpec);
            const specCell = tr.querySelector('.resident-spec-cell');
            if (specCell) {
                specCell.innerHTML = renderSpecialtyBubbleHTML(r);
            }
        }

        closeSpecialtyOptionsModal();
        showNotification(`تم تعيين الاختصاص: ${newSpec} للطبيب ${r.name}`, 'success');
    }

    function updateSpecialtyColor(specName, newColor, event) {
        if (event) event.stopPropagation();
        if (!specName) return;

        if (!state.specialtyColors) state.specialtyColors = {};
        state.specialtyColors[specName.trim().toLowerCase()] = newColor;
        state.specialtyColors[specName.trim()] = newColor;

        try {
            localStorage.setItem('hosp_hub_emergency_specialty_colors', JSON.stringify(state.specialtyColors));
        } catch (e) {
            console.warn('Failed to save specialty color to localStorage', e);
        }

        saveState();
        pushDBHistory(`تغيير لون اختصاص (${specName})`);

        // Update all specialty bubbles in the table immediately
        document.querySelectorAll('tr[data-resident-id]').forEach(tr => {
            const resId = tr.getAttribute('data-resident-id');
            const res = (state.residents || []).find(d => d.id === resId);
            if (res && res.specialty && res.specialty.trim().toLowerCase() === specName.trim().toLowerCase()) {
                const specCell = tr.querySelector('.resident-spec-cell');
                if (specCell) {
                    specCell.innerHTML = renderSpecialtyBubbleHTML(res);
                }
            }
        });

        // Also refresh open modal view if still open
        if (activeSpecialtyResidentId) {
            openSpecialtyPickerModal(activeSpecialtyResidentId);
        }

        showNotification(`تم تحديث لون اختصاص "${specName}" بنجاح`, 'info');
    }

    function saveNewCustomSpecialty(residentId) {
        const input = document.getElementById('new-custom-spec-input');
        const colorInput = document.getElementById('new-custom-spec-color');
        if (!input || !input.value.trim()) return;

        const specName = input.value.trim();
        const color = colorInput ? colorInput.value : '#0284c7';

        if (!state.specialtyColors) state.specialtyColors = {};
        state.specialtyColors[specName.toLowerCase()] = color;
        state.specialtyColors[specName] = color;

        try {
            localStorage.setItem('hosp_hub_emergency_specialty_colors', JSON.stringify(state.specialtyColors));
        } catch (e) {}

        selectResidentSpecialty(residentId, specName);
    }

    function renderResidentPrefsButtonHTML(r) {
        const hasPrefs = (Array.isArray(r.prefDays) && r.prefDays.length > 0) || 
                         (Array.isArray(r.prefShifts) && r.prefShifts.length > 0) || 
                         (r.noConsecutiveDays === false);
        if (hasPrefs) {
            return `
                <button type="button" onclick="openResidentPrefsModal('${r.id}')" class="px-2.5 py-1 rounded-xl text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition shadow-2xs flex items-center justify-center gap-1 mx-auto" title="لديه رغبات محددة - انقر للتعديل">
                    <i class="fas fa-sliders text-emerald-600"></i>
                    <span>رغبات</span>
                </button>
            `;
        } else {
            return `
                <button type="button" onclick="openResidentPrefsModal('${r.id}')" class="px-2.5 py-1 rounded-xl text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition shadow-2xs flex items-center justify-center gap-1 mx-auto" title="لا توجد رغبات محددة - انقر للإضافة">
                    <i class="fas fa-sliders text-rose-500"></i>
                    <span>رغبات</span>
                </button>
            `;
        }
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
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">منتهي الإقامة</span>`;
        } else if (isFulfilled) {
            rowBgClass = 'bg-emerald-50/40 dark:bg-emerald-950/15 border-l-4 border-l-emerald-500';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">مكتمل (${stats.normalScheduled}/${normalTarget})</span>`;
        } else {
            rowBgClass = 'bg-rose-50/30 dark:bg-rose-950/10 border-l-4 border-l-rose-400';
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">غير مكتمل (${stats.normalScheduled}/${normalTarget})</span>`;
        }

        // Orange badge beside name (Active ONLY if state.rsEnabled is true AND resident has extra scheduled or RS target)
        const hasActiveRS = state.rsEnabled && (stats.extraScheduled > 0 || (Number(r.rs_target) || 0) > 0);
        const extraDot = hasActiveRS ? `
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shrink-0 ring-2 ring-white dark:ring-slate-900 shadow-xs rs-dot-badge" title="خفارات إسناد إضافية (مجدول: ${stats.extraScheduled} / نصاب: ${r.rs_target || 0})"></span>
        ` : '';

        const normalizedStage = normalizeStageName(r.stage) || 'بدون';

        return `
            <tr data-resident-id="${r.id}" 
                data-name="${escapeForInline(r.name)}" 
                data-sex="${r.sex}" 
                data-board="${r.board || 'None'}" 
                data-stage="${normalizedStage}" 
                data-quota-status="${isFulfilled ? 'fulfilled' : 'unfulfilled'}" 
                data-has-extra="${hasActiveRS ? 'true' : 'false'}" 
                data-spec="${escapeForInline(r.specialty || '')}"
                class="hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition ${rowBgClass}">
                <td class="py-1 px-2 text-center font-mono text-slate-400 text-xs">${rowNum}</td>
                
                <!-- Name with Orange Dot Badge (if extra RS duties) -->
                <td class="py-1 px-2 resident-name-cell">
                    <div class="flex items-center gap-1.5 flex-1 min-w-[150px]">
                        ${extraDot}
                        <input type="text" value="${escapeForInline(r.name)}" onblur="onResidentFieldChange('${r.id}', 'name', this.value)" class="db-cell-input font-bold text-slate-800 dark:text-slate-100 flex-1">
                    </div>
                </td>

                <!-- Sex (Bubble Badge Switcher) -->
                <td class="py-1 px-2 text-center resident-sex-cell">
                    ${renderSexBubbleHTML(r)}
                </td>

                <!-- Specialty (Interactive Bubble Badge with Color & Selection) -->
                <td class="py-1 px-2 text-center resident-spec-cell">
                    ${renderSpecialtyBubbleHTML(r)}
                </td>

                <!-- Board (Bubble Badge Cycler: Iraqi -> Arabic -> None) -->
                <td class="py-1 px-2 text-center resident-board-cell">
                    ${renderBoardBubbleHTML(r)}
                </td>

                <!-- Stage (Interactive Bubble Badge, Arabic Named) -->
                <td class="py-1 px-2 text-center resident-stage-cell">
                    ${renderStageBubbleHTML(r)}
                </td>

                <!-- ER Target (Direct number input with live update) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" data-target-field="er_target" value="${r.er_target || 0}" oninput="onResidentTargetChange('${r.id}', 'er_target', this.value)" onblur="onResidentTargetChange('${r.id}', 'er_target', this.value)" class="db-cell-input text-center font-mono font-black text-rose-600">
                </td>

                <!-- Con Target (Direct number input with live update) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" data-target-field="con_target" value="${r.con_target || 0}" oninput="onResidentTargetChange('${r.id}', 'con_target', this.value)" onblur="onResidentTargetChange('${r.id}', 'con_target', this.value)" class="db-cell-input text-center font-mono font-black text-sky-600">
                </td>

                <!-- DC Target (Direct number input with live update) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" data-target-field="dc_target" value="${r.dc_target || 0}" oninput="onResidentTargetChange('${r.id}', 'dc_target', this.value)" onblur="onResidentTargetChange('${r.id}', 'dc_target', this.value)" class="db-cell-input text-center font-mono font-black text-emerald-600">
                </td>

                ${state.rsEnabled ? `
                <!-- RS Target (Direct number input with live update) -->
                <td class="py-1 px-2 text-center">
                    <input type="number" min="0" data-target-field="rs_target" value="${r.rs_target || 0}" oninput="onResidentTargetChange('${r.id}', 'rs_target', this.value)" onblur="onResidentTargetChange('${r.id}', 'rs_target', this.value)" class="db-cell-input text-center font-mono font-black text-amber-600">
                </td>
                ` : ''}

                <!-- Status Badge -->
                <td class="py-1 px-2 resident-status-badge-cell">
                    <div>${statusBadge}</div>
                </td>

                <!-- Expiry Month (Direct month picker) -->
                <td class="py-1 px-2">
                    <input type="month" value="${r.expiryMonth || ''}" onchange="onResidentFieldChange('${r.id}', 'expiryMonth', this.value)" class="db-cell-input text-[11px] font-mono text-slate-500">
                </td>

                <!-- Preferences Button (if active) / Reactivate Button (if inactive) -->
                ${!isInactiveSection ? `
                <td class="py-1 px-2 text-center resident-prefs-cell">
                    ${renderResidentPrefsButtonHTML(r)}
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

        // RS (Only counted if Rotators Strike is enabled and active in the selected window)
        if (state.rsEnabled) {
            const startDay = state.rsStartDate ? parseInt(state.rsStartDate.split('-')[2], 10) : 1;
            const endDay = state.rsEndDate ? parseInt(state.rsEndDate.split('-')[2], 10) : 31;
            (state.schedules.rs || []).forEach(day => {
                const dayNum = parseInt(day.day, 10) || parseInt(day.dayNumber, 10) || 0;
                if (!dayNum || (dayNum >= startDay && dayNum <= endDay)) {
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
                }
            });
        }

        return counts;
    }

    // Direct in-database field changes
    function onResidentFieldChange(resId, field, newVal) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (res) {
            const oldVal = res[field];
            let val = (newVal || '').trim();
            if (field === 'name') {
                val = formatDoctorName(val);
            } else if (field === 'phone') {
                val = formatIraqiPhoneNumber(val);
            }
            res[field] = val;
            saveState();
            pushDBHistory(`تعديل ${field} للطبيب (${res.name})`);

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
        if (!res) return;

        const parsedVal = Math.max(0, parseInt(newVal, 10) || 0);
        const oldVal = Number(res[targetField]) || 0;
        if (parsedVal === oldVal) return;

        // Check against monthly required quota
        const summary = getMonthlyDutyAllocationsSummary();
        let dutyKey = '';
        let dutyTitle = '';
        if (targetField === 'er_target') { dutyKey = 'er'; dutyTitle = 'خفارات الطوارئ (ER)'; }
        else if (targetField === 'con_target') { dutyKey = 'con'; dutyTitle = 'خفارات الاستشارية (Con)'; }
        else if (targetField === 'dc_target') { dutyKey = 'dc'; dutyTitle = 'خفارات شهادات الوفاة (DC)'; }
        else if (targetField === 'rs_target') { dutyKey = 'rs'; dutyTitle = 'خفارات الإسناد الإضافي (RS)'; }

        if (dutyKey && summary[dutyKey]) {
            const required = summary[dutyKey].required;
            // Sum all other active non-expired residents' targets
            const otherAllocated = (state.residents || [])
                .filter(r => r.active && r.id !== resId && !isResidentExpired(r, state.year, state.month))
                .reduce((sum, r) => sum + (Number(r[targetField]) || 0), 0);

            const projectedTotal = otherAllocated + parsedVal;
            if (projectedTotal > required) {
                const remaining = Math.max(0, required - otherAllocated);
                // Revert input value in DOM
                const tr = document.querySelector(`tr[data-resident-id="${resId}"]`);
                if (tr) {
                    const input = tr.querySelector(`input[data-target-field="${targetField}"]`) || 
                                  tr.querySelector(`input[oninput*="${targetField}"]`);
                    if (input) input.value = oldVal;
                }
                alert(
                    `⚠️ تنبيه منع تجاوز النصاب المطلوب!\n\n` +
                    `لا يمكن زيادة نصاب ${dutyTitle} للطبيب (${res.name}).\n` +
                    `العدد الكلي المطلوب لشهر (${state.monthYear}) هو: ${required} خفارة.\n` +
                    `المنصوب لبقية الأطباء: ${otherAllocated} خفارة.\n` +
                    `الحد الأقصى المتاح للتوزيع لهذا الطبيب هو: ${remaining} خفارة فقط.\n\n` +
                    `تم إلغاء التعديل واسترجاع النصاب السابق (${oldVal}).`
                );
                return;
            }
        }

        res[targetField] = parsedVal;
        saveCurrentMonthAllocationsToStore();
        saveState();
        updateDutyDashboard();
        updateDBDutyCheckers();
        updateResidentRowFulfillment(resId);

        clearTimeout(dbTargetDebounceTimer);
        dbTargetDebounceTimer = setTimeout(() => {
            pushDBHistory(`تعديل نصاب ${targetField} للطبيب (${res.name})`);
        }, 350);
    }

    function toggleShowInactiveInDB() {
        state.showInactiveInDB = !state.showInactiveInDB;

        const inactiveSection = document.getElementById('inactive-residents-section');
        const toggleBtn = document.getElementById('toggle-inactive-btn');
        const inactiveCount = (state.residents || []).filter(r => !r.active).length;

        if (inactiveSection && toggleBtn) {
            if (state.showInactiveInDB) {
                inactiveSection.classList.remove('hidden');
                toggleBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 hover:bg-amber-200 transition flex items-center gap-1.5 cursor-pointer';
                toggleBtn.innerHTML = `<i class="fas fa-eye"></i><span>إخفاء غير النشطين</span>`;
            } else {
                inactiveSection.classList.add('hidden');
                toggleBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 transition flex items-center gap-1.5 cursor-pointer';
                toggleBtn.innerHTML = `<i class="fas fa-eye-slash"></i><span>إظهار غير النشطين (${inactiveCount})</span>`;
            }
            applyDBLiveFilter();
        } else {
            refreshDBView();
        }
    }

    // Deactivation with confirmation and resetting duty allocations to zero + removing from current month schedules
    function deactivateResidentWithConfirmation(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        const confirmMsg = `هل أنت متأكد من إلغاء تنشيط الطبيب (${res.name}) لشهر (${state.monthYear})؟\n\nتنبيه إداري: سيتم تصفير كافة أنصبته وإزالة اسمه من جداول شهر (${state.monthYear}) فقط، ويبقى نشطاً في الأشهر الأخرى.`;
        if (!confirm(confirmMsg)) return;

        pushDBHistory(`إلغاء تنشيط الطبيب (${res.name}) لشهر ${state.monthYear}`);

        // Reset quotas to zero for current selected month
        res.active = false;
        res.er_target = 0;
        res.con_target = 0;
        res.dc_target = 0;
        res.rs_target = 0;

        // Remove name from current month schedules only
        const docName = res.name;
        ['er', 'con', 'dc', 'rs'].forEach(type => {
            (state.schedules[type] || []).forEach(day => {
                Object.keys(day).forEach(k => {
                    if (day[k] === docName) day[k] = '';
                });
            });
        });

        saveCurrentMonthAllocationsToStore();
        saveCurrentMonthScheduleToStore();
        saveState();
        refreshDBView();
        updateDutyDashboard();
        renderActiveTab();
        updateDBUndoRedoUI();
        showNotification(`تم إلغاء تنشيط الطبيب (${docName}) لشهر (${state.monthYear}) وتصفير أنصبته وإزالته من جداول الشهر`, 'info');
    }

    function reactivateResident(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        pushDBHistory(`إعادة تنشيط الطبيب (${res.name}) لشهر ${state.monthYear}`);

        res.active = true;
        res.er_target = 2; // initial default for this month
        saveCurrentMonthAllocationsToStore();
        saveState();
        refreshDBView();
        updateDutyDashboard();
        renderActiveTab();
        updateDBUndoRedoUI();
        showNotification(`تمت إعادة تنشيط الطبيب (${res.name}) لشهر (${state.monthYear}) بنجاح`, 'success');
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

        pushDBHistory('ترقية مرحلة أطباء البورد (+1)');

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

        saveCurrentHospitalResidents();
        saveState();
        refreshDBView();
        updateDBUndoRedoUI();
        showNotification(`تمت ترقية مرحلة ${count} طبيب بورد بنجاح (+1)`, 'success');
    }

    function deleteResident(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;
        if (!confirm(`هل أنت متأكد من حذف الطبيب: "${res.name}" نهائياً من قاعدة الطوارئ؟`)) return;

        pushDBHistory(`حذف الطبيب (${res.name})`);

        state.residents = state.residents.filter(r => r.id !== resId);
        saveCurrentMonthAllocationsToStore();
        saveCurrentHospitalResidents();
        saveState();
        refreshDBView();
        updateDutyDashboard();
        renderActiveTab();
        updateDBUndoRedoUI();
        showNotification('تم حذف الطبيب من قاعدة الطوارئ', 'info');
    }

    function backupResidentsDatabase() {
        // Ensure latest in-memory state is flushed to store
        saveCurrentMonthAllocationsToStore();
        saveCurrentHospitalResidents();
        saveCurrentMonthScheduleToStore();

        const residentsBackupList = (state.residents || []).map((r, idx) => ({
            id: r.id || ('doc_' + Date.now() + '_' + idx),
            row: r.row !== undefined ? r.row : (idx + 1),
            name: r.name || '',
            sex: (r.sex === 'F' || r.sex === 'أنثى') ? 'F' : 'M',
            specialty: r.specialty || '',
            board: r.board || 'None',
            stage: normalizeStageName(r.stage),
            active: r.active !== false,
            er_target: Number(r.er_target) || 0,
            con_target: Number(r.con_target) || 0,
            dc_target: Number(r.dc_target) || 0,
            rs_target: Number(r.rs_target) || 0,
            expiryMonth: r.expiryMonth || '',
            phone: r.phone || r.mobile || '',
            notes: r.notes || '',
            prefShifts: Array.isArray(r.prefShifts) ? [...r.prefShifts] : (r.preferences && Array.isArray(r.preferences.prefShifts) ? [...r.preferences.prefShifts] : []),
            prefDays: Array.isArray(r.prefDays) ? [...r.prefDays] : (r.preferences && Array.isArray(r.preferences.prefDays) ? [...r.preferences.prefDays] : []),
            noConsecutiveDays: r.noConsecutiveDays !== false,
            preferences: r.preferences || {
                prefShifts: Array.isArray(r.prefShifts) ? [...r.prefShifts] : [],
                prefDays: Array.isArray(r.prefDays) ? [...r.prefDays] : []
            }
        }));

        const backupData = {
            format: 'hosp_hub_emergency_full_backup',
            version: '2.5',
            exportedAt: new Date().toISOString(),
            exportDateFormatted: new Date().toLocaleString('ar-IQ'),
            hospitalId: state.hospitalId || 'iraqi',
            hospitalName: state.hospitalName || 'مستشفى الصدر التعليمي',
            monthYear: state.monthYear || '',
            month: state.month || 9,
            year: state.year || 2026,
            headOfResidents: state.headOfResidents || '',
            headOfHospital: state.headOfHospital || '',
            orderNumber: state.orderNumber || '',
            orderDate: state.orderDate || '',
            rsEnabled: state.rsEnabled !== false,
            rsStartDate: state.rsStartDate || '',
            rsEndDate: state.rsEndDate || '',
            totalResidents: residentsBackupList.length,
            activeResidentsCount: residentsBackupList.filter(r => r.active).length,
            inactiveResidentsCount: residentsBackupList.filter(r => !r.active).length,
            specialtyColors: state.specialtyColors || {},
            residents: residentsBackupList,
            hospitalResidents: state.hospitalResidents || {},
            monthlyAllocations: state.monthlyAllocations || {},
            monthlySchedules: state.monthlySchedules || {},
            schedules: state.schedules || {},
            prefOverrides: state.prefOverrides || {}
        };

        const jsonStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const dlAnchor = document.createElement('a');
        const hospSlug = (state.hospitalId || 'hosp').replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `emergency_database_full_backup_${hospSlug}_${dateStr}.json`;

        dlAnchor.setAttribute('href', url);
        dlAnchor.setAttribute('download', fileName);
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        setTimeout(() => {
            dlAnchor.remove();
            URL.revokeObjectURL(url);
        }, 500);

        showNotification(`تم تنزيل النسخة الاحتياطية الشاملة بنجاح (${residentsBackupList.length} طبيب)`, 'success');
    }

    function triggerRestoreResidentsDatabase() {
        let input = document.getElementById('db-restore-file-input');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'db-restore-file-input';
            input.accept = '.json,application/json';
            input.className = 'hidden';
            input.style.display = 'none';
            input.onchange = handleRestoreResidentsFile;
            document.body.appendChild(input);
        }
        input.value = '';
        input.click();
    }

    function handleRestoreResidentsFile(event) {
        const input = (event && event.target) || document.getElementById('db-restore-file-input');
        const file = input && input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const parsed = JSON.parse(e.target.result);
                let rawResidents = null;

                if (Array.isArray(parsed)) {
                    rawResidents = parsed;
                } else if (parsed && Array.isArray(parsed.residents)) {
                    rawResidents = parsed.residents;
                } else if (parsed && parsed.state && Array.isArray(parsed.state.residents)) {
                    rawResidents = parsed.state.residents;
                } else if (parsed && parsed.hospitalResidents && Array.isArray(parsed.hospitalResidents[state.hospitalId])) {
                    rawResidents = parsed.hospitalResidents[state.hospitalId];
                }

                if (!rawResidents || !Array.isArray(rawResidents) || rawResidents.length === 0) {
                    alert('الملف المحدد لا يحتوي على قائمة أطباء صالحة للاستعادة.');
                    if (input) input.value = '';
                    return;
                }

                const cleanedResidents = rawResidents.map((r, idx) => ({
                    id: r.id || ('doc_' + Date.now() + '_' + idx),
                    row: r.row !== undefined ? r.row : (idx + 1),
                    name: r.name ? formatDoctorName(r.name) : '',
                    sex: (r.sex === 'F' || r.sex === 'أنثى') ? 'F' : 'M',
                    specialty: r.specialty || '',
                    board: r.board || 'None',
                    stage: normalizeStageName(r.stage),
                    active: r.active !== false,
                    er_target: Math.max(0, Number(r.er_target) || 0),
                    con_target: Math.max(0, Number(r.con_target) || 0),
                    dc_target: Math.max(0, Number(r.dc_target) || 0),
                    rs_target: Math.max(0, Number(r.rs_target) || 0),
                    expiryMonth: r.expiryMonth || '',
                    phone: r.phone || r.mobile || '',
                    notes: r.notes || '',
                    prefShifts: Array.isArray(r.prefShifts) ? [...r.prefShifts] : (r.preferences && Array.isArray(r.preferences.prefShifts) ? [...r.preferences.prefShifts] : []),
                    prefDays: Array.isArray(r.prefDays) ? [...r.prefDays] : (r.preferences && Array.isArray(r.preferences.prefDays) ? [...r.preferences.prefDays] : []),
                    noConsecutiveDays: r.noConsecutiveDays !== false,
                    preferences: r.preferences || {
                        prefShifts: Array.isArray(r.prefShifts) ? [...r.prefShifts] : [],
                        prefDays: Array.isArray(r.prefDays) ? [...r.prefDays] : []
                    }
                })).filter(r => r.name && r.name.trim().length > 0);

                if (cleanedResidents.length === 0) {
                    alert('لم يتم العثور على أطباء بأسماء صالحة في ملف النسخة الاحتياطية.');
                    if (input) input.value = '';
                    return;
                }

                const count = cleanedResidents.length;
                const backupDate = parsed.exportDateFormatted || parsed.exportedAt || parsed.updatedAt || 'غير محدد';
                const backupHosp = parsed.hospitalName || state.hospitalName || 'المستشفى الحالي';
                const backupMonth = parsed.monthYear || (parsed.month && parsed.year ? `${parsed.month}/${parsed.year}` : '');

                const confirmMsg = `تأكيد استعادة النسخة الاحتياطية الشاملة:\n\n` +
                    `• المستشفى: ${backupHosp}\n` +
                    `• تاريخ النسخة: ${backupDate}\n` +
                    (backupMonth ? `• شهر النسخة: ${backupMonth}\n` : '') +
                    `• إجمالي الأطباء: ${count} طبيب\n` +
                    `  - النشطون: ${cleanedResidents.filter(r => r.active).length}\n` +
                    `  - غير النشطين: ${cleanedResidents.filter(r => !r.active).length}\n\n` +
                    `سيتم استعادة كافة بيانات الأطباء (الأسماء، الاختصاصات، البورد، المراحل، الأنصبة، الرغبات، والحالة) فوراً.\n\n` +
                    `هل ترغب بالمتابعة وتطبيق الاستعادة؟`;

                if (!confirm(confirmMsg)) {
                    if (input) input.value = '';
                    return;
                }

                pushDBHistory(`استعادة قاعدة البيانات الشاملة (${count} طبيب)`);

                // 1. Restore current residents
                state.residents = JSON.parse(JSON.stringify(cleanedResidents));

                // 2. Restore specialty colors
                if (parsed.specialtyColors && typeof parsed.specialtyColors === 'object') {
                    state.specialtyColors = Object.assign(state.specialtyColors || {}, parsed.specialtyColors);
                }

                // 3. Restore all monthly allocations
                if (parsed.monthlyAllocations && typeof parsed.monthlyAllocations === 'object') {
                    state.monthlyAllocations = Object.assign(state.monthlyAllocations || {}, parsed.monthlyAllocations);
                    Object.keys(parsed.monthlyAllocations).forEach(k => {
                        try {
                            localStorage.setItem(MONTH_ALLOC_PREFIX + k, JSON.stringify(parsed.monthlyAllocations[k]));
                        } catch (err) {}
                    });
                }

                // 4. Restore monthly schedules if present
                if (parsed.monthlySchedules && typeof parsed.monthlySchedules === 'object') {
                    state.monthlySchedules = Object.assign(state.monthlySchedules || {}, parsed.monthlySchedules);
                    Object.keys(parsed.monthlySchedules).forEach(k => {
                        try {
                            localStorage.setItem(MONTH_STORAGE_PREFIX + k, JSON.stringify(parsed.monthlySchedules[k]));
                        } catch (err) {}
                    });
                }

                // 5. Restore current active schedules if present and matching
                if (parsed.schedules && typeof parsed.schedules === 'object') {
                    ['er', 'con', 'dc', 'rs'].forEach(tab => {
                        if (Array.isArray(parsed.schedules[tab])) {
                            state.schedules[tab] = JSON.parse(JSON.stringify(parsed.schedules[tab]));
                        }
                    });
                }

                // 6. Restore preference overrides if present
                if (parsed.prefOverrides && typeof parsed.prefOverrides === 'object') {
                    state.prefOverrides = Object.assign(state.prefOverrides || {}, parsed.prefOverrides);
                }

                // 7. Restore signatories if present
                if (parsed.headOfResidents) state.headOfResidents = parsed.headOfResidents;
                if (parsed.headOfHospital) state.headOfHospital = parsed.headOfHospital;

                // 8. Update hospitalResidents store
                if (!state.hospitalResidents) state.hospitalResidents = {};
                if (parsed.hospitalResidents && typeof parsed.hospitalResidents === 'object') {
                    Object.keys(parsed.hospitalResidents).forEach(k => {
                        state.hospitalResidents[k] = parsed.hospitalResidents[k];
                    });
                }
                if (state.hospitalId) {
                    state.hospitalResidents[state.hospitalId] = JSON.parse(JSON.stringify(cleanedResidents));
                }

                // 9. Save active state to store
                saveCurrentMonthAllocationsToStore();
                saveCurrentHospitalResidents();
                saveCurrentMonthScheduleToStore();
                saveState();

                // 10. Refresh all views & checkers
                refreshDBView();
                updateDBDutyCheckers();
                updateDutyDashboard();
                renderActiveTab();
                updateDBUndoRedoUI();

                if (input) input.value = '';
                showNotification(`تمت استعادة قاعدة البيانات الشاملة بنجاح (${count} طبيب)`, 'success');
            } catch (err) {
                console.error('Error restoring backup file:', err);
                alert('فشل قراءة الملف أو استعادته: ملف JSON غير صالح أو به أخطاء برمجية.');
                if (input) input.value = '';
            }
        };
        reader.readAsText(file, 'utf-8');
    }

    const downloadEmergencyDbJson = backupResidentsDatabase;

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

        // Consecutive days preference (preferred by default for all residents)
        const noConsecutiveCb = document.getElementById('pref-no-consecutive');
        if (noConsecutiveCb) {
            noConsecutiveCb.checked = (res.noConsecutiveDays !== false);
        }

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

        const noConsecutiveCb = document.getElementById('pref-no-consecutive');
        if (noConsecutiveCb) {
            res.noConsecutiveDays = noConsecutiveCb.checked;
        }

        saveState();
        pushDBHistory(`تعديل رغبات الطبيب (${res.name})`);
        closeResidentPrefsModal();

        // In-place update resident row's preference cell to eliminate any scroll jump
        const tr = document.querySelector(`tr[data-resident-id="${activePrefsResId}"]`);
        if (tr) {
            const prefsCell = tr.querySelector('.resident-prefs-cell');
            if (prefsCell) prefsCell.innerHTML = renderResidentPrefsButtonHTML(res);
        } else {
            refreshDBView(activePrefsResId);
        }

        updateDBUndoRedoUI();
        showNotification(`تم حفظ رغبات الخفارة للطبيب (${res.name}) بنجاح`, 'success');
    }

    // =========================================================================
    // EXPORT RESIDENT TO HOSPITAL (FULL ADMIN RESIDENT PANEL FORM)
    // =========================================================================

    function toggleExpResidentMulti(isMulti) {
        const singleWrap = document.getElementById('exp-res-hosp-single-wrap');
        const multiWrap = document.getElementById('exp-res-hosp-multi-wrap');
        if (singleWrap) singleWrap.classList.toggle('hidden', isMulti);
        if (multiWrap) multiWrap.classList.toggle('hidden', !isMulti);
    }

    function onExpResSpecChanged(specId) {
        const deptSelect = document.getElementById('exp-res-dept');
        if (deptSelect && !deptSelect.dataset.userModified) {
            deptSelect.value = specId;
        }
    }

    function onExpResDeptChanged() {
        const deptSelect = document.getElementById('exp-res-dept');
        if (deptSelect) deptSelect.dataset.userModified = 'true';
    }

    function openExportResidentModal(resId) {
        const res = (state.residents || []).find(r => r.id === resId);
        if (!res) return;

        let modal = document.getElementById('export-resident-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'export-resident-modal';
            document.body.appendChild(modal);
        }
        modal.style.zIndex = '99999';
        modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 no-print overflow-y-auto';

        // Load specialties from Hub or fallback
        let specs = [];
        if (window.Hub && typeof window.Hub.getGlobalSpecialties === 'function') {
            specs = window.Hub.getGlobalSpecialties();
        } else if (window.Hub && window.Hub.specialties && typeof window.Hub.specialties.getAll === 'function') {
            specs = window.Hub.specialties.getAll();
        }
        if (!specs || specs.length === 0) {
            specs = [
                { id: 'GS', name_ar: 'الجراحة العامة', icon: '🔪' },
                { id: 'CM', name_ar: 'الباطنية العامة', icon: '🩺' },
                { id: 'ORTHO', name_ar: 'جراحة العظام والكسور', icon: '🦴' },
                { id: 'OBGYN', name_ar: 'النسائية والتوليد', icon: '👶' },
                { id: 'PED', name_ar: 'طب الأطفال', icon: '🍼' },
                { id: 'RADIO', name_ar: 'الأشعة والتصوير الطبي', icon: '🩻' },
                { id: 'NEURO', name_ar: 'الجراحة العصبية', icon: '🧠' },
                { id: 'ENT', name_ar: 'الأنف والأذن والحنجرة', icon: '👂' },
                { id: 'OPHTH', name_ar: 'طب وجراحة العيون', icon: '👁️' },
                { id: 'DERM', name_ar: 'الأمراض الجلدية', icon: '🧴' },
                { id: 'URO', name_ar: 'جراحة المسالك البولية', icon: '🚽' },
                { id: 'PSYCH', name_ar: 'الطب النفسي والعصبي', icon: '🧘' },
                { id: 'ANES', name_ar: 'التخدير والعناية المركزة', icon: '💉' },
                { id: 'CARDIO', name_ar: 'أمراض وجراحة القلب', icon: '❤️' },
                { id: 'PLAST', name_ar: 'جراحة التجميل والتقويم', icon: '🩹' },
                { id: 'MAXILLO', name_ar: 'جراحة الوجه والفكين', icon: '🦷' }
            ];
        }

        const resSpecNorm = (res.specialty || '').trim();
        const specOptionsHtml = specs.map(s => {
            const sName = s.name_ar || s.name || s.id;
            const isMatch = s.id === resSpecNorm || sName === resSpecNorm || normalizeArabic(sName) === normalizeArabic(resSpecNorm);
            return `<option value="${s.id}" ${isMatch ? 'selected' : ''}>${s.icon || '🏥'} ${sName}</option>`;
        }).join('');

        const deptOptionsHtml = specs.map(s => {
            const sName = s.name_ar || s.name || s.id;
            const isMatch = s.id === resSpecNorm || sName === resSpecNorm || normalizeArabic(sName) === normalizeArabic(resSpecNorm);
            return `<option value="${s.id}" ${isMatch ? 'selected' : ''}>${s.icon || '🏥'} ${sName}</option>`;
        }).join('');

        // Hospitals
        let hospitals = [];
        if (window.Hub && typeof window.Hub.getHospitals === 'function') {
            hospitals = window.Hub.getHospitals() || [];
        }
        if (!hospitals || hospitals.length === 0) {
            hospitals = [
                { id: state.hospitalId || 'iraqi', name_ar: state.hospitalName || 'مستشفى الصدر التعليمي' }
            ];
        }

        const currentHospId = state.hospitalId || (window.Hub && typeof window.Hub.getActiveHospitalId === 'function' ? window.Hub.getActiveHospitalId() : 'iraqi');

        const hospSingleOptionsHtml = hospitals.map(h => {
            const hName = h.name_ar || h.hospitalName || h.name || h.id;
            const isSelected = (h.id === currentHospId);
            return `<option value="${h.id}" ${isSelected ? 'selected' : ''}>${hName}</option>`;
        }).join('');

        const hospCheckboxesHtml = hospitals.map(h => {
            const hName = h.name_ar || h.hospitalName || h.name || h.id;
            const isChecked = (h.id === currentHospId);
            return `
                <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer text-xs">
                    <input type="checkbox" name="exp-res-hosp-cb" value="${h.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 accent-teal-600">
                    <span class="font-bold text-slate-700 dark:text-slate-200">${hName}</span>
                </label>
            `;
        }).join('');

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150 my-8">
                <div class="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                        <div class="w-9 h-9 rounded-2xl bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-amber-400 flex items-center justify-center font-bold text-base shadow-xs">
                            <i class="fas fa-user-plus"></i>
                        </div>
                        <div>
                            <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">بيانات المقيم الجديد</h3>
                            <p class="text-[11px] text-slate-500">إضافة وتصدير الطبيب لقاعدة بيانات المستشفى الرسمية</p>
                        </div>
                    </div>
                    <button type="button" onclick="closeExportResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleConfirmExportResident('${resId}', event)" class="p-5 sm:p-6 space-y-4 text-xs">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">اسم المقيم <span class="text-rose-500">*</span></label>
                            <input type="text" id="exp-res-name" value="${escapeForInline(res.name)}" required class="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs focus:ring-2 focus:ring-teal-500 outline-none" placeholder="مثال: د. احمد علي" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">رقم الهاتف <span class="text-rose-500 font-normal">(إلزامي)</span></label>
                            <input type="tel" id="exp-res-phone" value="${escapeForInline(res.phone || '')}" required class="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-mono font-bold text-xs text-left focus:ring-2 focus:ring-teal-500 outline-none" placeholder="07XXXXXXXXX" dir="ltr" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">التخصص الأساسي (Specialty)</label>
                            <select id="exp-res-spec" onchange="onExpResSpecChanged(this.value)" class="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs focus:ring-2 focus:ring-teal-500 outline-none cursor-pointer">
                                ${specOptionsHtml}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 flex items-center justify-between">
                                <span>القسم المكلف به (الخفارات)</span>
                                <span class="text-[10px] text-teal-600 dark:text-amber-400 font-normal">تناوب Rotation</span>
                            </label>
                            <select id="exp-res-dept" onchange="onExpResDeptChanged()" class="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs focus:ring-2 focus:ring-teal-500 outline-none cursor-pointer">
                                ${deptOptionsHtml}
                            </select>
                        </div>
                    </div>

                    <!-- Hospital Assignment & Multi-Hospital Switch -->
                    <div class="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-2.5">
                        <div class="flex items-center justify-between">
                            <div>
                                <div class="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                                    <i class="fas fa-shuffle text-teal-600 dark:text-amber-400"></i>
                                    <span>تغطية أكثر من مستشفى</span>
                                </div>
                                <div class="text-[11px] text-slate-400 mt-0.5">تعيين المقيم للدوام في عدة مستشفيات مشتركة</div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="exp-res-multi-toggle" onchange="toggleExpResidentMulti(this.checked)" class="sr-only peer" />
                                <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-teal-600"></div>
                            </label>
                        </div>

                        <div id="exp-res-hosp-single-wrap">
                            <label class="block text-[11px] font-bold text-slate-500 mb-1">المستشفى التابع له:</label>
                            <select id="exp-res-hospital-single" class="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs">
                                ${hospSingleOptionsHtml}
                            </select>
                        </div>

                        <div id="exp-res-hosp-multi-wrap" class="hidden pt-1 border-t border-slate-200 dark:border-slate-800">
                            <label class="block text-[11px] font-bold text-slate-500 mb-1.5">حدد المستشفيات التي يداوم فيها المقيم:</label>
                            <div id="exp-res-hospital-checkboxes" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                ${hospCheckboxesHtml}
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                        <label class="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                            <input type="checkbox" id="exp-res-active" ${res.active ? 'checked' : ''} class="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 accent-teal-600 cursor-pointer" />
                            <span>المقيم نشط في جدول الخفارات (غير احتياط)</span>
                        </label>
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                        <button type="button" onclick="closeExportResidentModal()" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                            إلغاء
                        </button>
                        <button type="submit" class="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 shadow-md transition flex items-center gap-1.5 cursor-pointer">
                            <i class="fas fa-check"></i>
                            <span>إضافة المقيم لقاعدة المستشفى</span>
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
        const phoneInput = document.getElementById('exp-res-phone');
        const specInput = document.getElementById('exp-res-spec');
        const deptInput = document.getElementById('exp-res-dept');
        const activeInput = document.getElementById('exp-res-active');
        const multiToggle = document.getElementById('exp-res-multi-toggle');

        const name = (nameInput?.value || '').trim();
        const phone = (phoneInput?.value || '').trim();
        const spec = (specInput?.value || '').trim();
        const dept = (deptInput?.value || '').trim() || spec;
        const active = activeInput ? activeInput.checked : true;
        const isMulti = multiToggle ? multiToggle.checked : false;

        if (!name) {
            alert('الرجاء إدخال اسم المقيم');
            if (nameInput) nameInput.focus();
            return;
        }

        // Strict Phone Validation (Required, at least 10 digits)
        const cleanDigits = phone.replace(/[^0-9]/g, '');
        if (!phone || cleanDigits.length < 10) {
            alert('رقم الهاتف حقل إلزامي لتصدير الطبيب لقاعدة المستشفى الرسمية (يجب أن يتكون من 10 أرقام على الأقل).');
            if (phoneInput) phoneInput.focus();
            return;
        }

        let assignedHospitals = [];
        if (isMulti) {
            document.querySelectorAll('input[name="exp-res-hosp-cb"]:checked').forEach(cb => {
                assignedHospitals.push(cb.value);
            });
            if (assignedHospitals.length === 0) {
                alert('الرجاء اختيار مستشفى واحد على الأقل للمقيم');
                return;
            }
        } else {
            const singleH = document.getElementById('exp-res-hospital-single')?.value || state.hospitalId;
            assignedHospitals = [singleH];
        }

        const formattedName = (name.startsWith('د.') || name.startsWith('د ')) ? name : `د. ${name}`;

        res.name = formattedName;
        res.phone = phone;
        res.specialty = spec;
        saveState();

        try {
            let exportedSuccessfully = false;
            // 1. Try Hub.addResident if available
            if (window.Hub && typeof window.Hub.addResident === 'function') {
                try {
                    await window.Hub.addResident({
                        name: formattedName,
                        phone: phone,
                        spec: spec,
                        tag: spec,
                        dept: dept,
                        department: dept,
                        active: active,
                        hospitals: assignedHospitals
                    });
                    exportedSuccessfully = true;
                } catch (hubErr) {
                    console.warn('Hub.addResident error, falling back to direct hospital storage:', hubErr);
                }
            }

            // 2. Direct fallback into hosp.names
            if (!exportedSuccessfully && window.Hub && typeof window.Hub.getHospital === 'function') {
                assignedHospitals.forEach(hId => {
                    const hosp = window.Hub.getHospital(hId);
                    if (hosp) {
                        if (!Array.isArray(hosp.names)) hosp.names = [];
                        const cleanNew = normalizeArabic(formattedName);
                        const exists = hosp.names.some(n => normalizeArabic(n.name) === cleanNew);
                        if (!exists) {
                            hosp.names.push({
                                id: `res_exp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                                name: formattedName,
                                phone: phone,
                                spec: spec,
                                dept: dept,
                                active: active,
                                hospitals: assignedHospitals
                            });
                        }
                    }
                });

                if (typeof window.Hub.saveDatabase === 'function') {
                    await window.Hub.saveDatabase(`Exported resident ${formattedName} to ${assignedHospitals.join(', ')}`);
                }
                exportedSuccessfully = true;
            }

            closeExportResidentModal();
            refreshDBView();
            showNotification(`تمت إضافة الطبيب "${formattedName}" إلى قاعدة بيانات المستشفى بنجاح!`, 'success');
        } catch (err) {
            console.error('Error exporting resident to hospital:', err);
            showNotification('حدث خطأ أثناء تصدير الطبيب للمستشفى', 'error');
        }
    }

    window.toggleExpResidentMulti = toggleExpResidentMulti;
    window.onExpResSpecChanged = onExpResSpecChanged;
    window.onExpResDeptChanged = onExpResDeptChanged;
    window.openExportResidentModal = openExportResidentModal;
    window.closeExportResidentModal = closeExportResidentModal;
    window.handleConfirmExportResident = handleConfirmExportResident;

    // =========================================================================
    // HOSPITAL RECONCILIATION MODAL
    // =========================================================================

    function openHospitalSyncModal() {
        let modal = document.getElementById('hospital-sync-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'hospital-sync-modal';
            modal.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        } else {
            modal.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
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
        closeHospitalSyncModal();
        openImportResidentFromHospitalModal(state.hospitalId, name);
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
            pushScheduleHistory(`تعيين ${doctorName}`);
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
            pushScheduleHistory('تفريغ خانة الخفارة');
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
            modal.style.zIndex = '99999';
            modal.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        } else {
            modal.style.zIndex = '99999';
            modal.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
        }

        const hospSpecs = getHospitalSpecialties(state.hospitalId);

        let hospitals = [];
        if (window.Hub && typeof window.Hub.getHospitals === 'function') {
            hospitals = window.Hub.getHospitals() || [];
        }
        if (hospitals.length === 0) {
            hospitals = [
                { id: 'iraqi', name_ar: 'المستشفى العراقي التعليمي' },
                { id: 'basra', name_ar: 'مستشفى البصرة التعليمي' },
                { id: 'mawani', name_ar: 'مستشفى الموانئ التعليمي' }
            ];
        }

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100">إضافة مقيم أقدم جديد</h3>
                        <p class="text-[11px] text-slate-500">إضافة الطبيب لقاعدة خفارات الطوارئ وترتيبه تلقائياً</p>
                    </div>
                    <button type="button" onclick="closeAddResidentModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleSaveNewResident(event)" class="p-5 space-y-3 text-xs max-h-[85vh] overflow-y-auto">
                    <!-- Quick Hospital Doctor Search & Auto-Fill in Add Panel -->
                    <div class="p-3 bg-sky-50/70 dark:bg-sky-950/40 rounded-2xl border border-sky-200 dark:border-sky-800 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1.5 text-xs">
                                <i class="fas fa-hospital-user text-sky-600"></i>
                                <span>بحث واستيراد سريع من مستشفى (اختياري):</span>
                            </span>
                            <span class="text-[10px] text-slate-500">يملأ الحقول تلقائياً</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select id="add-modal-hosp-select" onchange="searchHospitalResidentsForAddModal()" class="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-800 dark:text-slate-100 font-bold text-xs">
                                <option value="all">جميع المستشفيات</option>
                                ${hospitals.map(h => `<option value="${h.id}">${h.name_ar || h.hospitalName || h.id}</option>`).join('')}
                            </select>
                            <div class="relative">
                                <input type="text" id="add-modal-doc-search" oninput="searchHospitalResidentsForAddModal()" placeholder="ابحث باسم الطبيب من المستشفى..." class="w-full pr-7 pl-2 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-800 dark:text-slate-100 font-bold text-xs">
                                <i class="fas fa-search absolute right-2.5 top-2 text-sky-600 text-xs"></i>
                            </div>
                        </div>
                        <div id="add-modal-search-results" class="hidden max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-xl border border-sky-200 dark:border-sky-800 shadow-sm">
                            <!-- Results populated dynamically -->
                        </div>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الطبيب الرباعي <span class="text-rose-500">*</span>:</label>
                        <input type="text" id="new-res-name" required placeholder="د. الاسم الكامل..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الجنس:</label>
                            <select id="new-res-sex" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                                <option value="M">ذكر</option>
                                <option value="F">أنثى</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاختصاص (English):</label>
                            <select id="new-res-spec" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                                ${hospSpecs.map(s => `<option value="${escapeForInline(s.name)}">${s.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع البورد:</label>
                            <select id="new-res-board" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
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

                    <div class="grid ${state.rsEnabled ? 'grid-cols-4' : 'grid-cols-3'} gap-2 pt-1">
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
                        ${state.rsEnabled ? `
                        <div>
                            <label class="block text-[11px] font-bold text-amber-600 mb-1">نصاب RS:</label>
                            <input type="number" id="new-res-rs" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        ` : ''}
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">رقم الهاتف (+964... / اختياري):</label>
                            <input type="tel" id="new-res-phone" placeholder="07XXXXXXXXX أو +9647XXXXXXXXX" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-mono">
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

    function searchHospitalResidentsForAddModal() {
        const query = (document.getElementById('add-modal-doc-search')?.value || '').trim();
        const hospId = document.getElementById('add-modal-hosp-select')?.value || 'all';
        const resultsEl = document.getElementById('add-modal-search-results');
        if (!resultsEl) return;

        if (!query && hospId === 'all') {
            resultsEl.classList.add('hidden');
            resultsEl.innerHTML = '';
            return;
        }

        let allHospDocs = [];
        const allHosps = getAllHospitalRecords();
        allHosps.forEach(h => {
            if (hospId !== 'all' && h.id !== hospId) return;
            const names = getHospitalDoctorsList(h.id);
            names.forEach(d => {
                allHospDocs.push({
                    doc: d,
                    hospitalId: h.id,
                    hospitalName: h.name_ar || h.hospitalName || h.id
                });
            });
        });

        const cleanQ = normalizeArabic(query).toLowerCase();
        const matches = allHospDocs.filter(item => {
            if (!cleanQ) return true;
            const docName = normalizeArabic(item.doc.name || '').toLowerCase();
            const docSpec = (item.doc.spec || item.doc.specialty || '').toLowerCase();
            return docName.includes(cleanQ) || docSpec.includes(cleanQ);
        }).slice(0, 8);

        if (matches.length === 0) {
            resultsEl.innerHTML = `<div class="p-2 text-center text-slate-400 text-[11px]">لا توجد نتائج مطابقة في قاعدة المستشفيات</div>`;
            resultsEl.classList.remove('hidden');
            return;
        }

        resultsEl.innerHTML = matches.map(item => {
            const formatted = formatDoctorName(item.doc.name);
            const canonSpec = canonicalizeSpecialtyName(item.doc.spec || item.doc.specialty || '');
            return `
                <div class="p-2 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition flex items-center justify-between gap-2 cursor-pointer" onclick="quickFillAddResidentModal('${escapeForInline(item.hospitalId)}', '${escapeForInline(item.doc.id || item.doc.name)}')">
                    <div>
                        <div class="font-bold text-slate-800 dark:text-slate-100 text-xs">${formatted}</div>
                        <div class="text-[10px] text-slate-500">${item.hospitalName} · <span class="text-sky-600 font-mono font-bold">${canonSpec}</span></div>
                    </div>
                    <button type="button" class="px-2 py-0.5 rounded-lg text-[10px] font-bold text-sky-700 bg-sky-100 dark:bg-sky-900/60 hover:bg-sky-200 transition">
                        استيراد وتعبئة
                    </button>
                </div>
            `;
        }).join('');
        resultsEl.classList.remove('hidden');
    }

    function quickFillAddResidentModal(hospId, docKey) {
        const hospObj = getHospitalRecord(hospId);
        const hospResidents = getHospitalDoctorsList(hospId);

        const doc = hospResidents.find(d => (d.id && d.id === docKey) || d.name === docKey);
        if (!doc) return;

        const formattedName = formatDoctorName(doc.name);
        const formattedPhone = formatIraqiPhoneNumber(doc.phone || '');
        const nameInput = document.getElementById('new-res-name');
        const phoneInput = document.getElementById('new-res-phone');
        const sexSelect = document.getElementById('new-res-sex');
        const specSelect = document.getElementById('new-res-spec');
        const notesInput = document.getElementById('new-res-notes');

        if (nameInput) nameInput.value = formattedName;
        if (phoneInput) phoneInput.value = formattedPhone;

        const femaleNames = ['زهراء', 'فاطمة', 'زينب', 'مريم', 'هدى', 'نور', 'سارة', 'آلاء', 'رنا', 'دعاء', 'ضحى', 'إسراء', 'تبارك', 'أبرار', 'حوراء', 'مروة', 'آية', 'تقى', 'بنين', 'شهد', 'يقين', 'أمل', 'إيناس', 'خديجة'];
        const cleanName = formattedName.replace(/^د[\.\s]+/, '').trim();
        const firstName = cleanName.split(/\s+/)[0];
        const isF = femaleNames.includes(firstName) || doc.sex === 'F';
        if (sexSelect) sexSelect.value = isF ? 'F' : 'M';

        let enSpec = '';
        if (doc.spec && hospObj && Array.isArray(hospObj.specialties)) {
            const sObj = hospObj.specialties.find(s => s.id === doc.spec);
            if (sObj) enSpec = sObj.name_en || sObj.enName;
        }
        if (!enSpec) {
            enSpec = canonicalizeSpecialtyName(doc.spec || doc.specialty || doc.dept || doc.department || '');
        }

        if (specSelect) {
            let foundOption = Array.from(specSelect.options).find(opt => opt.value === enSpec);
            if (!foundOption) {
                const newOpt = document.createElement('option');
                newOpt.value = enSpec;
                newOpt.textContent = enSpec;
                specSelect.appendChild(newOpt);
            }
            specSelect.value = enSpec;
        }

        if (notesInput) {
            const hospTitle = hospObj ? (hospObj.name_ar || hospObj.hospitalName || hospId) : hospId;
            notesInput.value = `مستورد من مستشفى (${hospTitle})`;
        }

        const resultsEl = document.getElementById('add-modal-search-results');
        if (resultsEl) resultsEl.classList.add('hidden');

        showNotification(`تمت تعبئة بيانات الطبيب (${formattedName}) من مستشفى (${hospObj ? (hospObj.name_ar || hospId) : hospId})`, 'info');
    }

    function closeAddResidentModal() {
        const modal = document.getElementById('add-resident-modal');
        if (modal) modal.classList.add('hidden');
    }

    function handleSaveNewResident(e) {
        e.preventDefault();
        const rawName = document.getElementById('new-res-name').value.trim();
        const formattedName = formatDoctorName(rawName);
        if (!formattedName) {
            alert('الرجاء إدخال اسم الطبيب');
            return;
        }

        const rawPhone = (document.getElementById('new-res-phone')?.value || '').trim();
        const formattedPhone = formatIraqiPhoneNumber(rawPhone);
        if (rawPhone && !isValidIraqiPhoneNumber(formattedPhone)) {
            alert('رقم الهاتف غير صالح!\nيجب أن يبدأ بـ 07 أو +964 ويتكون من 10 أرقام.\n(مثال: 07801234567 أو +9647801234567)');
            return;
        }

        // 1. Check duplicate in ER Database
        const normNewName = normalizeArabic(formattedName);
        const existingErDoc = (state.residents || []).find(r => {
            const nameMatch = normalizeArabic(r.name) === normNewName;
            const phoneMatch = formattedPhone && r.phone && (formatIraqiPhoneNumber(r.phone) === formattedPhone);
            return nameMatch || phoneMatch;
        });

        if (existingErDoc) {
            alert(`تنبيه: الطبيب (${existingErDoc.name}) مسجل مسبقاً في قاعدة بيانات الطوارئ!\nلا يمكن إضافة نفس الطبيب أو نفس رقم الهاتف أكثر من مرة.`);
            return;
        }

        // 2. Check if present in Hospital Database (Hub)
        let hospMatch = null;
        const allHospitals = getAllHospitalRecords();
        for (const h of allHospitals) {
            const names = getHospitalDoctorsList(h.id);
            const match = names.find(n => {
                const nameMatches = normalizeArabic(n.name) === normNewName;
                const phoneMatches = formattedPhone && n.phone && (formatIraqiPhoneNumber(n.phone) === formattedPhone);
                return nameMatches || phoneMatches;
            });
            if (match) {
                hospMatch = { resident: match, hospital: h };
                break;
            }
        }

        if (hospMatch) {
            const hospTitle = hospMatch.hospital.name_ar || hospMatch.hospital.hospitalName || hospMatch.hospital.id;
            const confirmImport = confirm(
                `تنبيه: اسم الطبيب (${hospMatch.resident.name}) مسجل مسبقاً في قاعدة بيانات مستشفى (${hospTitle})!\n\n` +
                `هل ترغب في استيراد بياناته الرسمية من المستشفى وإكمال تفاصيل الطوارئ؟\n\n` +
                `- اضغط "موافق" (OK) للانتقال إلى نافذة استيراد الطبيب من المستشفى.\n` +
                `- اضغط "إلغاء" (Cancel) لتعديل الاسم أو الهاتف وإدخال مقيم آخر.`
            );

            if (confirmImport) {
                closeAddResidentModal();
                openImportResidentFromHospitalModal(hospMatch.hospital.id, hospMatch.resident.name);
                return;
            } else {
                showNotification('يرجى تعديل اسم الطبيب أو رقم الهاتف لإدخال مقيم آخر', 'info');
                return;
            }
        }

        const sex = document.getElementById('new-res-sex').value;
        const specialty = canonicalizeSpecialtyName(document.getElementById('new-res-spec').value);
        const board = document.getElementById('new-res-board').value;
        const stage = document.getElementById('new-res-stage').value.trim() || 'الأولى';
        const er_target = parseInt(document.getElementById('new-res-er').value, 10) || 0;
        const con_target = parseInt(document.getElementById('new-res-con').value, 10) || 0;
        const dc_target = parseInt(document.getElementById('new-res-dc').value, 10) || 0;
        const rs_target = state.rsEnabled ? (parseInt(document.getElementById('new-res-rs')?.value, 10) || 0) : 0;
        const expiryMonth = (document.getElementById('new-res-expiry')?.value || '').trim();
        const notes = (document.getElementById('new-res-notes')?.value || '').trim();

        // Enforce quota limits: prevent adding duties that exceed monthly required totals
        const summary = getMonthlyDutyAllocationsSummary();
        const checkQuota = (targetVal, dutyKey, dutyTitle) => {
            if (!summary[dutyKey]) return true;
            const required = summary[dutyKey].required;
            const currentAllocated = summary[dutyKey].allocated;
            if (currentAllocated + targetVal > required) {
                const remaining = Math.max(0, required - currentAllocated);
                alert(
                    `⚠️ تنبيه منع تجاوز النصاب المطلوب!\n\n` +
                    `النصاب المدخل لـ ${dutyTitle} (${targetVal}) يتجاوز الحد المطلوب لهذا الشهر.\n` +
                    `المطلوب الكلي لشهر (${state.monthYear}): ${required} خفارة.\n` +
                    `الموزع حالياً: ${currentAllocated} خفارة.\n` +
                    `المتبقي المتاح للتوزيع: ${remaining} خفارة فقط.\n\n` +
                    `يرجى تعديل النصاب والمحاولة مجدداً.`
                );
                return false;
            }
            return true;
        };

        if (!checkQuota(er_target, 'er', 'الطوارئ (ER)')) return;
        if (!checkQuota(con_target, 'con', 'الاستشارية (Con)')) return;
        if (!checkQuota(dc_target, 'dc', 'شهادات الوفاة (DC)')) return;
        if (state.rsEnabled && !checkQuota(rs_target, 'rs', 'الإسناد الإضافي (RS)')) return;

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
            phone: formattedPhone,
            expiryMonth,
            prefDays: [],
            prefShifts: [],
            noConsecutiveDays: true,
            notes,
            active: true,
            hospitals: [state.hospitalId]
        };

        state.residents.push(newDoc);
        // Auto-sort residents according to current sort column and direction
        state.residents = sortResidentsList(state.residents, state.dbSortColumn || 'name', state.dbSortDirection || 'asc');
        state.residents.forEach((r, idx) => { r.row = idx + 1; });

        saveCurrentMonthAllocationsToStore();
        saveCurrentHospitalResidents();
        saveState();
        pushDBHistory(`إضافة الطبيب (${formattedName})`);
        closeAddResidentModal();
        refreshDBView(newDoc.id);
        updateDBDutyCheckers();
        updateDBUndoRedoUI();
        showNotification(`تمت إضافة وترتيب الطبيب "${formattedName}" بنجاح`, 'success');
    }

    // =========================================================================
    // 8.5 IMPORT RESIDENT FROM HOSPITAL MODAL (WITH DETAIL REVIEW & FILLING)
    // =========================================================================

    let currentImportAvailableDocs = [];

    async function openImportResidentFromHospitalModal(preselectedHospId, preselectedDocName) {
        let modal = document.getElementById('import-resident-from-hospital-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'import-resident-from-hospital-modal';
            modal.style.zIndex = '99999';
            modal.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            document.body.appendChild(modal);
        } else {
            modal.style.zIndex = '99999';
            modal.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 no-print';
            modal.classList.remove('hidden');
        }

        // Ensure hospital database is fully loaded from cache/hub-data
        await ensureHubDatabaseLoaded();

        const hospitals = getAllHospitalRecords();
        const selectedHospId = preselectedHospId || state.hospitalId || (hospitals[0] ? hospitals[0].id : 'iraqi');
        const hospSpecs = getHospitalSpecificSpecialties(selectedHospId);

        modal.innerHTML = `
            <div class="glass-panel rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 class="font-black text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <i class="fas fa-hospital-user text-teal-600"></i>
                            <span>استيراد مقيم من مستشفى إلى الطوارئ</span>
                        </h3>
                        <p class="text-[11px] text-slate-500">اختر الطبيب وأكمل أنصبته وبياناته لقاعدة خفارات الطوارئ</p>
                    </div>
                    <button type="button" onclick="closeImportResidentFromHospitalModal()" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form onsubmit="handleSaveImportedResident(event)" class="p-5 space-y-3 text-xs max-h-[80vh] overflow-y-auto">
                    <!-- Hospital & Doctor Selection -->
                    <div class="p-3 bg-teal-50/60 dark:bg-teal-950/30 rounded-2xl border border-teal-200/80 dark:border-teal-800/60 space-y-2.5">
                        <div>
                            <label class="block font-bold text-teal-900 dark:text-teal-200 mb-1">
                                <i class="fas fa-hospital ml-1 text-teal-600"></i>
                                المستشفى المصدر:
                            </label>
                            <select id="import-res-hosp-select" onchange="onImportResidentHospChanged()" class="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-700 text-slate-800 dark:text-slate-100 font-bold">
                                ${hospitals.map(h => `<option value="${h.id}" ${h.id === selectedHospId ? 'selected' : ''}>${h.name_ar || h.hospitalName || h.id}</option>`).join('')}
                            </select>
                        </div>

                        <!-- Filter by Hospital Specialty -->
                        <div>
                            <label class="block text-[11px] font-bold text-teal-800 dark:text-teal-300 mb-1">
                                <i class="fas fa-stethoscope ml-1 text-teal-600"></i>
                                فلترة حسب اختصاصات المستشفى:
                            </label>
                            <select id="import-res-filter-spec" onchange="onImportResidentFilterChanged()" class="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-700 text-slate-800 dark:text-slate-100 font-bold text-xs">
                                <option value="all">جميع الاختصاصات (الكل)</option>
                                ${hospSpecs.map(s => {
                                    const label = s.name_ar ? `${s.name_ar} (${s.name_en})` : s.name_en;
                                    return `<option value="${escapeForInline(s.id)}">${label}</option>`;
                                }).join('')}
                            </select>
                        </div>

                        <!-- Searchable Autocomplete Combobox for Resident -->
                        <div>
                            <div class="flex items-center justify-between mb-1">
                                <label class="block font-bold text-teal-900 dark:text-teal-200">
                                    <i class="fas fa-user-md ml-1 text-teal-600"></i>
                                    المقيم المطلوب استيراده <span class="text-rose-500">*</span>:
                                </label>
                                <span id="import-res-count-badge" class="text-[10px] font-mono font-bold text-teal-700 dark:text-teal-300"></span>
                            </div>
                            <div class="relative" id="import-res-combobox-wrapper">
                                <div class="relative flex items-center">
                                    <input 
                                        type="text" 
                                        id="import-res-search-input" 
                                        autocomplete="off" 
                                        placeholder="اختر من القائمة أو ابدأ بكتابة اسم المقيم..." 
                                        class="w-full pr-8 pl-8 py-2 rounded-xl bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-700 text-slate-800 dark:text-slate-100 font-bold text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none transition shadow-xs"
                                        oninput="onImportResidentSearchInput(this.value)"
                                        onfocus="openImportResidentSuggestions()"
                                        onclick="openImportResidentSuggestions()"
                                        onkeydown="onImportResidentSearchKeydown(event)"
                                    />
                                    <i class="fas fa-search absolute right-2.5 top-2.5 text-teal-600 text-xs pointer-events-none"></i>
                                    <button 
                                        type="button" 
                                        id="import-res-toggle-btn"
                                        onclick="toggleImportResidentSuggestions(event)" 
                                        class="absolute left-1.5 top-1 p-1.5 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/50 transition cursor-pointer" 
                                        title="عرض / إخفاء القائمة"
                                    >
                                        <i class="fas fa-chevron-down text-xs transition-transform duration-200" id="import-res-chevron"></i>
                                    </button>
                                </div>

                                <!-- Hidden input for selected doc ID -->
                                <input type="hidden" id="import-res-selected-id" value="">

                                <!-- Suggestions Dropdown Panel -->
                                <div 
                                    id="import-res-suggestions-panel" 
                                    class="hidden absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-700 shadow-2xl z-[100] divide-y divide-slate-100 dark:divide-slate-800"
                                >
                                    <!-- Populated dynamically -->
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ER Required Details -->
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الطبيب في الطوارئ <span class="text-rose-500">*</span>:</label>
                        <input type="text" id="import-res-name" required placeholder="د. الاسم الكامل..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الجنس:</label>
                            <select id="import-res-sex" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                                <option value="M">ذكر</option>
                                <option value="F">أنثى</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاختصاص (English):</label>
                            <select id="import-res-spec" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                                ${hospSpecs.map(s => `<option value="${escapeForInline(s.name_en)}">${s.name_en}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع البورد:</label>
                            <select id="import-res-board" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
                                <option value="None" selected>بدون بورد (None)</option>
                                <option value="Arabic">عربي (Arabic)</option>
                                <option value="Iraqi">عراقي (Iraqi)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">المرحلة:</label>
                            <select id="import-res-stage" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold">
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

                    <div class="grid ${state.rsEnabled ? 'grid-cols-4' : 'grid-cols-3'} gap-2 pt-1">
                        <div>
                            <label class="block text-[11px] font-bold text-rose-600 mb-1">نصاب ER:</label>
                            <input type="number" id="import-res-er" value="2" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-sky-600 mb-1">نصاب Con:</label>
                            <input type="number" id="import-res-con" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-emerald-600 mb-1">نصاب DC:</label>
                            <input type="number" id="import-res-dc" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        ${state.rsEnabled ? `
                        <div>
                            <label class="block text-[11px] font-bold text-amber-600 mb-1">نصاب RS:</label>
                            <input type="number" id="import-res-rs" value="0" min="0" class="w-full px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-mono font-bold">
                        </div>
                        ` : ''}
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">رقم الهاتف (+964... / اختياري):</label>
                            <input type="tel" id="import-res-phone" placeholder="07XXXXXXXXX أو +9647XXXXXXXXX" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-mono">
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">شهر انتهاء الصلاحية (اختياري):</label>
                            <input type="month" id="import-res-expiry" class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                        </div>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">ملاحظات إدارية:</label>
                        <input type="text" id="import-res-notes" placeholder="ملاحظات..." class="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                        <button type="button" onclick="closeImportResidentFromHospitalModal()" class="px-4 py-2 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                            إلغاء
                        </button>
                        <button type="submit" class="px-5 py-2 rounded-xl font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-600/20 transition flex items-center gap-1.5">
                            <i class="fas fa-check"></i>
                            <span>إتمام الاستيراد والحفظ</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        if (!window._importResidentClickBound) {
            window._importResidentClickBound = true;
            document.addEventListener('click', function(e) {
                const wrapper = document.getElementById('import-res-combobox-wrapper');
                const panel = document.getElementById('import-res-suggestions-panel');
                if (wrapper && panel && !panel.classList.contains('hidden')) {
                    if (!wrapper.contains(e.target)) {
                        closeImportResidentSuggestions();
                    }
                }
            });
        }

        populateImportResidentDoctorList(selectedHospId, preselectedDocName);
    }

    function closeImportResidentFromHospitalModal() {
        const modal = document.getElementById('import-resident-from-hospital-modal');
        if (modal) modal.classList.add('hidden');
        closeImportResidentSuggestions();
    }

    function onImportResidentHospChanged() {
        const hospSelect = document.getElementById('import-res-hosp-select');
        if (!hospSelect) return;
        const hospId = hospSelect.value;

        // 1. Update specialty filter options to strictly this hospital's specialties
        const filterSpecSelect = document.getElementById('import-res-filter-spec');
        const hospSpecs = getHospitalSpecificSpecialties(hospId);

        if (filterSpecSelect) {
            filterSpecSelect.innerHTML = `<option value="all">جميع الاختصاصات (الكل)</option>` + 
                hospSpecs.map(s => {
                    const label = s.name_ar ? `${s.name_ar} (${s.name_en})` : s.name_en;
                    return `<option value="${escapeForInline(s.id)}">${label}</option>`;
                }).join('');
            filterSpecSelect.value = 'all';
        }

        // 2. Update target ER specialty select
        const specSelect = document.getElementById('import-res-spec');
        if (specSelect) {
            specSelect.innerHTML = hospSpecs.map(s => `<option value="${escapeForInline(s.name_en)}">${s.name_en}</option>`).join('');
        }

        // 3. Clear combobox input and selection
        const searchInput = document.getElementById('import-res-search-input');
        const selectedIdInput = document.getElementById('import-res-selected-id');
        if (searchInput) searchInput.value = '';
        if (selectedIdInput) selectedIdInput.value = '';

        // 4. Clear form inputs
        const nameInput = document.getElementById('import-res-name');
        const phoneInput = document.getElementById('import-res-phone');
        if (nameInput) nameInput.value = '';
        if (phoneInput) phoneInput.value = '';

        populateImportResidentDoctorList(hospId);
    }

    function onImportResidentFilterChanged() {
        const hospSelect = document.getElementById('import-res-hosp-select');
        if (!hospSelect) return;
        const searchInput = document.getElementById('import-res-search-input');
        if (searchInput) searchInput.value = '';
        populateImportResidentDoctorList(hospSelect.value);
    }

    function populateImportResidentDoctorList(hospId, preselectedDocName) {
        const allHospDocs = getHospitalDoctorsList(hospId);
        const hospSpecs = getHospitalSpecificSpecialties(hospId);

        const existingErNames = new Set((state.residents || []).map(r => normalizeArabic(r.name)));
        const existingErPhones = new Set((state.residents || []).map(r => r.phone ? formatIraqiPhoneNumber(r.phone) : '').filter(Boolean));

        let availableDocs = allHospDocs.filter(d => {
            if (preselectedDocName && normalizeArabic(d.name) === normalizeArabic(preselectedDocName)) {
                return true;
            }
            const cleanName = normalizeArabic(d.name);
            const cleanPhone = d.phone ? formatIraqiPhoneNumber(d.phone) : '';
            if (existingErNames.has(cleanName)) return false;
            if (cleanPhone && existingErPhones.has(cleanPhone)) return false;
            return true;
        });

        // Filter by specialty if selected
        const specFilter = document.getElementById('import-res-filter-spec')?.value || 'all';
        if (specFilter !== 'all') {
            availableDocs = availableDocs.filter(d => isDoctorInHospitalSpecialty(d, specFilter, hospSpecs));
        }

        currentImportAvailableDocs = availableDocs;

        const countBadge = document.getElementById('import-res-count-badge');
        if (countBadge) {
            countBadge.textContent = `(${availableDocs.length} متاح)`;
        }

        const searchInput = document.getElementById('import-res-search-input');
        const selectedIdInput = document.getElementById('import-res-selected-id');

        if (preselectedDocName) {
            const preDoc = availableDocs.find(d => normalizeArabic(d.name) === normalizeArabic(preselectedDocName)) ||
                           allHospDocs.find(d => normalizeArabic(d.name) === normalizeArabic(preselectedDocName));
            if (preDoc) {
                selectImportResidentDoctor(preDoc.id || preDoc.name);
                return;
            }
        }

        // Render suggestions according to current search query
        const currentQ = searchInput?.value || '';
        filterAndRenderImportSuggestions(currentQ);

        // If no doctor selected and available list is empty, clear form inputs
        if (!selectedIdInput?.value && availableDocs.length === 0) {
            const nameInput = document.getElementById('import-res-name');
            const phoneInput = document.getElementById('import-res-phone');
            if (nameInput) nameInput.value = '';
            if (phoneInput) phoneInput.value = '';
        }
    }

    function filterAndRenderImportSuggestions(query = '') {
        const panel = document.getElementById('import-res-suggestions-panel');
        const badge = document.getElementById('import-res-count-badge');
        if (!panel) return;

        const cleanQ = normalizeArabic(query.replace(/^د[\.\s]*/, '')).trim().toLowerCase();
        const rawQ = normalizeArabic(query).trim().toLowerCase();
        const qDigits = query.replace(/\D/g, '');

        const matches = currentImportAvailableDocs.filter(d => {
            if (!cleanQ && !rawQ) return true;
            const dName = normalizeArabic(d.name || '').toLowerCase();
            const dNameNoDr = normalizeArabic((d.name || '').replace(/^د[\.\s]*/, '')).toLowerCase();
            const dPhoneDigits = (d.phone || '').replace(/\D/g, '');
            
            const nameMatch = dName.includes(rawQ) || dNameNoDr.includes(cleanQ) || dName.includes(cleanQ);
            const phoneMatch = qDigits.length >= 3 && dPhoneDigits.includes(qDigits);
            return nameMatch || phoneMatch;
        });

        if (badge) {
            badge.textContent = `(${matches.length} متاح)`;
        }

        if (matches.length === 0) {
            panel.innerHTML = `
                <div class="p-3 text-center text-slate-400 text-xs font-bold">
                    <i class="fas fa-info-circle text-teal-500 mr-1"></i> لا يوجد أطباء مطابقين للبحث / الاختصاص المختار
                </div>
            `;
            return;
        }

        const hospId = document.getElementById('import-res-hosp-select')?.value;
        const hospSpecs = getHospitalSpecificSpecialties(hospId);

        panel.innerHTML = matches.map(d => {
            const formatted = formatDoctorName(d.name);
            const specObj = hospSpecs.find(s => s.id === d.spec);
            const specAr = specObj ? (specObj.name_ar || specObj.name || '') : '';
            const canonEn = canonicalizeSpecialtyName((specObj && (specObj.name_en || specObj.name_ar)) || d.spec || '');
            const specLabel = specAr ? `${specAr} (${canonEn})` : canonEn;
            const color = getSpecialtyColor(canonEn);

            return `
                <div 
                    class="p-2.5 hover:bg-teal-50 dark:hover:bg-teal-950/50 cursor-pointer transition flex items-center justify-between gap-2 group"
                    data-doc-id="${escapeForInline(d.id || d.name)}"
                    onclick="selectImportResidentDoctor('${escapeForInline(d.id || d.name)}')"
                >
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold text-teal-700 bg-teal-100 dark:bg-teal-900/60 shrink-0">
                            <i class="fas fa-user-md"></i>
                        </div>
                        <div class="truncate">
                            <div class="font-bold text-xs text-slate-800 dark:text-slate-100 group-hover:text-teal-600 transition truncate">
                                ${formatted}
                            </div>
                            ${d.phone ? `<div class="text-[10px] text-slate-400 font-mono"><i class="fas fa-phone mr-1 text-[9px]"></i>${formatIraqiPhoneNumber(d.phone)}</div>` : ''}
                        </div>
                    </div>
                    <div class="shrink-0 flex items-center gap-1.5">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background-color: ${color}20; color: ${color};">
                            ${specLabel}
                        </span>
                        <i class="fas fa-arrow-left text-xs text-slate-300 group-hover:text-teal-600 transition"></i>
                    </div>
                </div>
            `;
        }).join('');
    }

    function selectImportResidentDoctor(docIdOrName) {
        const hospId = document.getElementById('import-res-hosp-select')?.value;
        const docs = getHospitalDoctorsList(hospId);
        const doc = docs.find(d => (d.id && d.id === docIdOrName) || d.name === docIdOrName);
        if (!doc) return;

        const formatted = formatDoctorName(doc.name);
        const searchInput = document.getElementById('import-res-search-input');
        const selectedIdInput = document.getElementById('import-res-selected-id');

        if (searchInput) searchInput.value = formatted;
        if (selectedIdInput) selectedIdInput.value = doc.id || doc.name;

        closeImportResidentSuggestions();
        populateImportResidentFormFields(doc, hospId);
    }

    function populateImportResidentFormFields(doc, hospId) {
        const hospObj = getHospitalRecord(hospId);
        const formattedName = formatDoctorName(doc.name);
        const formattedPhone = formatIraqiPhoneNumber(doc.phone || '');

        const nameInput = document.getElementById('import-res-name');
        const phoneInput = document.getElementById('import-res-phone');
        const sexSelect = document.getElementById('import-res-sex');
        const specSelect = document.getElementById('import-res-spec');
        const notesInput = document.getElementById('import-res-notes');

        if (nameInput) nameInput.value = formattedName;
        if (phoneInput) phoneInput.value = formattedPhone;

        const femaleNames = ['زهراء', 'فاطمة', 'زينب', 'مريم', 'هدى', 'نور', 'سارة', 'آلاء', 'رنا', 'دعاء', 'ضحى', 'إسراء', 'تبارك', 'أبرار', 'حوراء', 'مروة', 'آية', 'تقى', 'بنين', 'شهد', 'يقين', 'أمل', 'إيناس', 'خديجة'];
        const cleanName = formattedName.replace(/^د[\.\s]+/, '').trim();
        const firstName = cleanName.split(/\s+/)[0];
        const isF = femaleNames.includes(firstName) || doc.sex === 'F';
        if (sexSelect) sexSelect.value = isF ? 'F' : 'M';

        let enSpec = '';
        if (doc.spec && hospObj && Array.isArray(hospObj.specialties)) {
            const sObj = hospObj.specialties.find(s => s.id === doc.spec);
            if (sObj) enSpec = sObj.name_en || sObj.enName;
        }
        if (!enSpec) {
            enSpec = canonicalizeSpecialtyName(doc.spec || doc.specialty || doc.dept || doc.department || '');
        }

        if (specSelect) {
            let foundOption = Array.from(specSelect.options).find(opt => opt.value === enSpec);
            if (!foundOption) {
                const newOpt = document.createElement('option');
                newOpt.value = enSpec;
                newOpt.textContent = enSpec;
                specSelect.appendChild(newOpt);
            }
            specSelect.value = enSpec;
        }

        if (notesInput) {
            const hospTitle = hospObj ? (hospObj.name_ar || hospObj.hospitalName || hospId) : hospId;
            notesInput.value = `مستورد من مستشفى (${hospTitle})`;
        }
    }

    function onImportResidentSearchInput(val) {
        openImportResidentSuggestions();
        filterAndRenderImportSuggestions(val);
    }

    function openImportResidentSuggestions() {
        const panel = document.getElementById('import-res-suggestions-panel');
        const chevron = document.getElementById('import-res-chevron');
        if (panel) panel.classList.remove('hidden');
        if (chevron) chevron.classList.add('rotate-180');
    }

    function closeImportResidentSuggestions() {
        const panel = document.getElementById('import-res-suggestions-panel');
        const chevron = document.getElementById('import-res-chevron');
        if (panel) panel.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }

    function toggleImportResidentSuggestions(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        const panel = document.getElementById('import-res-suggestions-panel');
        if (!panel) return;
        if (panel.classList.contains('hidden')) {
            openImportResidentSuggestions();
            const currentInput = document.getElementById('import-res-search-input')?.value || '';
            filterAndRenderImportSuggestions(currentInput);
        } else {
            closeImportResidentSuggestions();
        }
    }

    function onImportResidentSearchKeydown(e) {
        if (e.key === 'Escape') {
            closeImportResidentSuggestions();
        } else if (e.key === 'Enter') {
            const panel = document.getElementById('import-res-suggestions-panel');
            if (panel && !panel.classList.contains('hidden')) {
                const firstItem = panel.querySelector('[data-doc-id]');
                if (firstItem) {
                    e.preventDefault();
                    selectImportResidentDoctor(firstItem.getAttribute('data-doc-id'));
                }
            }
        }
    }

    function handleSaveImportedResident(e) {
        e.preventDefault();
        const rawName = document.getElementById('import-res-name').value.trim();
        const formattedName = formatDoctorName(rawName);
        if (!formattedName) {
            alert('الرجاء التأكد من اسم الطبيب');
            return;
        }

        const rawPhone = (document.getElementById('import-res-phone')?.value || '').trim();
        const formattedPhone = formatIraqiPhoneNumber(rawPhone);
        if (rawPhone && !isValidIraqiPhoneNumber(formattedPhone)) {
            alert('رقم الهاتف غير صالح!\nيجب أن يبدأ بـ 07 أو +964 ويتكون من 10 أرقام.\n(مثال: 07801234567 أو +9647801234567)');
            return;
        }

        const normName = normalizeArabic(formattedName);
        const existingErDoc = (state.residents || []).find(r => {
            const nameMatch = normalizeArabic(r.name) === normName;
            const phoneMatch = formattedPhone && r.phone && (formatIraqiPhoneNumber(r.phone) === formattedPhone);
            return nameMatch || phoneMatch;
        });

        if (existingErDoc) {
            alert(`الطبيب (${existingErDoc.name}) مسجل مسبقاً في قاعدة بيانات الطوارئ! لا يمكن التكرار.`);
            return;
        }

        const sourceHospId = document.getElementById('import-res-hosp-select')?.value || state.hospitalId;
        const sex = document.getElementById('import-res-sex').value;
        const specialty = canonicalizeSpecialtyName(document.getElementById('import-res-spec').value);
        const board = document.getElementById('import-res-board').value;
        const stage = document.getElementById('import-res-stage').value.trim() || 'الأولى';
        const er_target = parseInt(document.getElementById('import-res-er').value, 10) || 0;
        const con_target = parseInt(document.getElementById('import-res-con').value, 10) || 0;
        const dc_target = parseInt(document.getElementById('import-res-dc').value, 10) || 0;
        const rs_target = state.rsEnabled ? (parseInt(document.getElementById('import-res-rs')?.value, 10) || 0) : 0;
        const expiryMonth = (document.getElementById('import-res-expiry')?.value || '').trim();
        const notes = (document.getElementById('import-res-notes')?.value || '').trim();

        // Enforce quota limits: prevent importing duties that exceed monthly required totals
        const summary = getMonthlyDutyAllocationsSummary();
        const checkQuota = (targetVal, dutyKey, dutyTitle) => {
            if (!summary[dutyKey]) return true;
            const required = summary[dutyKey].required;
            const currentAllocated = summary[dutyKey].allocated;
            if (currentAllocated + targetVal > required) {
                const remaining = Math.max(0, required - currentAllocated);
                alert(
                    `⚠️ تنبيه منع تجاوز النصاب المطلوب!\n\n` +
                    `النصاب المدخل لـ ${dutyTitle} (${targetVal}) يتجاوز الحد المطلوب لهذا الشهر.\n` +
                    `المطلوب الكلي لشهر (${state.monthYear}): ${required} خفارة.\n` +
                    `الموزع حالياً: ${currentAllocated} خفارة.\n` +
                    `المتبقي المتاح للتوزيع: ${remaining} خفارة فقط.\n\n` +
                    `يرجى تعديل النصاب والمحاولة مجدداً.`
                );
                return false;
            }
            return true;
        };

        if (!checkQuota(er_target, 'er', 'الطوارئ (ER)')) return;
        if (!checkQuota(con_target, 'con', 'الاستشارية (Con)')) return;
        if (!checkQuota(dc_target, 'dc', 'شهادات الوفاة (DC)')) return;
        if (state.rsEnabled && !checkQuota(rs_target, 'rs', 'الإسناد الإضافي (RS)')) return;

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
            phone: formattedPhone,
            expiryMonth,
            prefDays: [],
            prefShifts: [],
            noConsecutiveDays: true,
            notes: notes || `مستورد من ${sourceHospId}`,
            active: true,
            hospitals: [state.hospitalId, sourceHospId].filter((v, i, a) => a.indexOf(v) === i)
        };

        state.residents.push(newDoc);
        state.residents = sortResidentsList(state.residents, state.dbSortColumn || 'name', state.dbSortDirection || 'asc');
        state.residents.forEach((r, idx) => { r.row = idx + 1; });

        saveCurrentMonthAllocationsToStore();
        saveCurrentHospitalResidents();
        saveState();
        pushDBHistory(`استيراد الطبيب (${formattedName})`);
        closeImportResidentFromHospitalModal();
        refreshDBView(newDoc.id);
        updateDBDutyCheckers();
        updateDBUndoRedoUI();
        showNotification(`تم استيراد وترتيب الطبيب "${formattedName}" بنجاح في قاعدة الطوارئ`, 'success');
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

        pushScheduleHistory(`توليد جدول ${type} آلياً`);

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
     * ADVANCED AUTOMATIC DISTRIBUTION SYSTEM
     * 1- Absolute priority to doctors with preferences (both Day and Shift, then Day, then Shift).
     * 2- Hard Quota Limit: Never exceed allocated duties (er_target, con_target, dc_target, rs_target),
     *    even if it leaves cells empty due to shortage of allocations.
     * 3- Cross-schedule preferences: Day preferences apply to all allocated schedules.
     */

    /**
     * Cross-schedule check for duties on adjacent days (day - 1, day + 1)
     * Checks ER, Consultation (Con), Death Certificates (DC), and Rotators Strike (RS).
     */
    function hasDoctorDutyOnAdjacentDay(doctorName, dayNumber, daysCount) {
        if (!doctorName) return false;
        const clean = normalizeArabic(doctorName);
        function checkDay(d) {
            if (d < 1 || d > daysCount) return false;
            // 1. ER Schedule
            const erDay = (state.schedules.er || []).find(s => s.dayNumber === d);
            if (erDay) {
                if ((erDay.morning && normalizeArabic(erDay.morning) === clean) ||
                    (erDay.afternoon && normalizeArabic(erDay.afternoon) === clean) ||
                    (erDay.preNight && normalizeArabic(erDay.preNight) === clean) ||
                    (erDay.lateNight && normalizeArabic(erDay.lateNight) === clean)) {
                    return true;
                }
            }
            // 2. Con Schedule
            const conDay = (state.schedules.con || []).find(s => s.dayNumber === d);
            if (conDay && conDay.doctor && normalizeArabic(conDay.doctor) === clean) return true;

            // 3. DC Schedule
            const dcDay = (state.schedules.dc || []).find(s => s.dayNumber === d);
            if (dcDay && dcDay.doctor && normalizeArabic(dcDay.doctor) === clean) return true;

            // 4. RS Schedule
            const rsDay = (state.schedules.rs || []).find(s => s.dayNumber === d);
            if (rsDay) {
                for (const k of Object.keys(rsDay)) {
                    if ((k.startsWith('er_') || k.startsWith('ward_')) && rsDay[k]) {
                        if (normalizeArabic(rsDay[k]) === clean) return true;
                    }
                }
            }
            return false;
        }
        return checkDay(dayNumber - 1) || checkDay(dayNumber + 1);
    }

    function shuffleArray(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function runAutoDistributionER(mode, daysCount, activeDocs) {
        const schedule = state.schedules.er;
        const shifts = ['morning', 'afternoon', 'preNight', 'lateNight'];

        if (mode === 'fresh') {
            schedule.forEach(d => {
                shifts.forEach(s => d[s] = '');
            });
            state.prefOverrides = {};
        }

        // Track assignments strictly by normalized doctor name
        const assignedCount = {};
        const assignedShifts = {}; // cleanName => Set of shift names
        const assignedDays = {};   // dayNumber => Set of cleanNames
        const assignedShiftCounts = {}; // cleanName => { morning: 0, afternoon: 0, preNight: 0, lateNight: 0 }
        const assignedDayNameCounts = {}; // cleanName => { [dayName]: count }

        for (let d = 1; d <= daysCount; d++) {
            assignedDays[d] = new Set();
        }

        activeDocs.forEach(r => {
            const clean = normalizeArabic(r.name);
            assignedCount[clean] = 0;
            assignedShifts[clean] = new Set();
            assignedShiftCounts[clean] = { morning: 0, afternoon: 0, preNight: 0, lateNight: 0 };
            assignedDayNameCounts[clean] = {};
        });

        // Initialize with existing entries if fill_empty
        schedule.forEach(day => {
            shifts.forEach(s => {
                if (day[s] && day[s].trim()) {
                    const clean = normalizeArabic(day[s].trim());
                    assignedCount[clean] = (assignedCount[clean] || 0) + 1;
                    if (!assignedShifts[clean]) assignedShifts[clean] = new Set();
                    assignedShifts[clean].add(s);
                    if (!assignedShiftCounts[clean]) assignedShiftCounts[clean] = { morning: 0, afternoon: 0, preNight: 0, lateNight: 0 };
                    assignedShiftCounts[clean][s] = (assignedShiftCounts[clean][s] || 0) + 1;
                    if (!assignedDayNameCounts[clean]) assignedDayNameCounts[clean] = {};
                    assignedDayNameCounts[clean][day.dayName] = (assignedDayNameCounts[clean][day.dayName] || 0) + 1;
                    if (assignedDays[day.dayNumber]) assignedDays[day.dayNumber].add(clean);
                }
            });
        });

        function getQuota(r) {
            return Math.max(0, Number(r.er_target) || 0);
        }

        function getAssigned(r) {
            const clean = normalizeArabic(r.name);
            return assignedCount[clean] || 0;
        }

        function hasRemainingQuota(r) {
            return getAssigned(r) < getQuota(r);
        }

        function getShiftCount(r, s) {
            const clean = normalizeArabic(r.name);
            return (assignedShiftCounts[clean] && assignedShiftCounts[clean][s]) || 0;
        }

        function getDayNameCount(r, dn) {
            const clean = normalizeArabic(r.name);
            return (assignedDayNameCounts[clean] && assignedDayNameCounts[clean][dn]) || 0;
        }

        function getMinPrefShiftCount(r) {
            if (!Array.isArray(r.prefShifts) || r.prefShifts.length === 0) return 0;
            return Math.min(...r.prefShifts.map(s => getShiftCount(r, s)));
        }

        function getMinPrefDayCount(r) {
            if (!Array.isArray(r.prefDays) || r.prefDays.length === 0) return 0;
            return Math.min(...r.prefDays.map(dn => getDayNameCount(r, dn)));
        }

        // Variety helpers: Ensure doctors with multiple preferences do not repeat
        // the same shift or day while other preferred shifts or days have fewer assignments
        function isShiftVarietySatisfied(r, shiftKey) {
            if (!Array.isArray(r.prefShifts) || r.prefShifts.length <= 1) return true;
            if (!r.prefShifts.includes(shiftKey)) return true;
            return getShiftCount(r, shiftKey) <= getMinPrefShiftCount(r);
        }

        function isDayVarietySatisfied(r, dayName) {
            if (!Array.isArray(r.prefDays) || r.prefDays.length <= 1) return true;
            if (!r.prefDays.includes(dayName)) return true;
            return getDayNameCount(r, dayName) <= getMinPrefDayCount(r);
        }

        // Strict availability check:
        // Must NEVER exceed quota!
        // Must NEVER duplicate doctor on same day!
        // Must NOT conflict with other schedules!
        // Must avoid consecutive days if preferred (r.noConsecutiveDays !== false)
        function isDoctorAvailable(r, dayNumber, shiftKey, allowConsecutive = false) {
            if (!r || !hasRemainingQuota(r)) return false;
            const clean = normalizeArabic(r.name);
            if (assignedDays[dayNumber] && assignedDays[dayNumber].has(clean)) return false;

            const dateStr = formatDateStr(state.year, state.month, dayNumber);
            const conflict = evaluateCellConflict(r.name, dateStr, 'er', shiftKey);
            if (conflict && conflict.hasConflict) return false;

            if (!allowConsecutive && r.noConsecutiveDays !== false) {
                if (hasDoctorDutyOnAdjacentDay(clean, dayNumber, daysCount)) return false;
            }

            return true;
        }

        function assignSlot(dayEntry, shiftKey, r, dayNumber) {
            dayEntry[shiftKey] = r.name;
            const clean = normalizeArabic(r.name);
            assignedCount[clean] = (assignedCount[clean] || 0) + 1;
            if (!assignedShifts[clean]) assignedShifts[clean] = new Set();
            assignedShifts[clean].add(shiftKey);

            if (!assignedShiftCounts[clean]) assignedShiftCounts[clean] = { morning: 0, afternoon: 0, preNight: 0, lateNight: 0 };
            assignedShiftCounts[clean][shiftKey] = (assignedShiftCounts[clean][shiftKey] || 0) + 1;

            if (!assignedDayNameCounts[clean]) assignedDayNameCounts[clean] = {};
            const dName = dayEntry.dayName;
            assignedDayNameCounts[clean][dName] = (assignedDayNameCounts[clean][dName] || 0) + 1;

            if (assignedDays[dayNumber]) assignedDays[dayNumber].add(clean);

            // Preference Override Check (track if doctor preferred a shift but was given a different one)
            const cellSlotId = `er_${dayNumber}_${shiftKey}`;
            if (r.prefShifts && r.prefShifts.length > 0) {
                if (!r.prefShifts.includes(shiftKey)) {
                    if (!state.prefOverrides) state.prefOverrides = {};
                    state.prefOverrides[cellSlotId] = true;
                }
            }
        }

        // -----------------------------------------------------------------
        // PASS 1: HIGHEST PRIORITY - Exact Preference Match (Both Day & Shift)
        // Doctor-Centric Round-Robin: Guarantees maximum duty variety across
        // preferred shifts and days (e.g. 1 afternoon, 1 preNight, 1 lateNight
        // across Sunday, Tuesday, Thursday) with randomized date selection!
        // -----------------------------------------------------------------
        let pass1Progress = true;
        let guard1 = 0;
        while (pass1Progress && guard1 < 200) {
            guard1++;
            pass1Progress = false;

            const candidateDocs = activeDocs.filter(r => {
                return hasRemainingQuota(r) &&
                    Array.isArray(r.prefDays) && r.prefDays.length > 0 &&
                    Array.isArray(r.prefShifts) && r.prefShifts.length > 0;
            });

            // Randomize doctor order each round for fair distribution across runs
            const docsOrder = shuffleArray(candidateDocs);

            for (const r of docsOrder) {
                if (!hasRemainingQuota(r)) continue;

                const minShift = getMinPrefShiftCount(r);
                const minDay = getMinPrefDayCount(r);

                // 1. Preferred shifts that currently have minimum assignments (strict variety!)
                let candidateShifts = r.prefShifts.filter(s => getShiftCount(r, s) === minShift);
                if (candidateShifts.length === 0) candidateShifts = r.prefShifts.slice();
                candidateShifts = shuffleArray(candidateShifts);

                // 2. Preferred days that currently have minimum assignments (strict variety!)
                let candidateDays = r.prefDays.filter(dn => getDayNameCount(r, dn) === minDay);
                if (candidateDays.length === 0) candidateDays = r.prefDays.slice();
                candidateDays = shuffleArray(candidateDays);

                // Tier 1: Non-consecutive slots matching candidateShifts & candidateDays
                let validSlots = [];
                for (const shiftKey of candidateShifts) {
                    for (let d = 1; d <= daysCount; d++) {
                        const dayEntry = schedule.find(s => s.dayNumber === d);
                        if (dayEntry && !dayEntry[shiftKey] && candidateDays.includes(dayEntry.dayName)) {
                            if (isDoctorAvailable(r, d, shiftKey, false)) {
                                validSlots.push({ d, dayEntry, shiftKey, consecutive: false });
                            }
                        }
                    }
                }

                // Tier 2: Non-consecutive slots matching candidateShifts on any preferred day (relaxed day variety)
                if (validSlots.length === 0) {
                    for (const shiftKey of candidateShifts) {
                        for (let d = 1; d <= daysCount; d++) {
                            const dayEntry = schedule.find(s => s.dayNumber === d);
                            if (dayEntry && !dayEntry[shiftKey] && r.prefDays.includes(dayEntry.dayName)) {
                                if (isDoctorAvailable(r, d, shiftKey, false)) {
                                    validSlots.push({ d, dayEntry, shiftKey, consecutive: false });
                                }
                            }
                        }
                    }
                }

                // Tier 3: Consecutive fallback relaxation if required
                if (validSlots.length === 0) {
                    for (const shiftKey of candidateShifts) {
                        for (let d = 1; d <= daysCount; d++) {
                            const dayEntry = schedule.find(s => s.dayNumber === d);
                            if (dayEntry && !dayEntry[shiftKey] && r.prefDays.includes(dayEntry.dayName)) {
                                if (isDoctorAvailable(r, d, shiftKey, true)) {
                                    validSlots.push({ d, dayEntry, shiftKey, consecutive: true });
                                }
                            }
                        }
                    }
                }

                if (validSlots.length > 0) {
                    // Pick a random slot among the valid candidates for date distribution randomness!
                    validSlots = shuffleArray(validSlots);
                    const chosen = validSlots[0];
                    assignSlot(chosen.dayEntry, chosen.shiftKey, r, chosen.d);
                    pass1Progress = true;
                }
            }
        }

        // -----------------------------------------------------------------
        // PASS 2: DAY PREFERENCE MATCH (Doctors with Day prefs, no shift prefs)
        // Doctor requested this day; try candidate shifts in order of FEWEST ASSIGNED
        // first to ensure maximum variety across all shifts, with randomized dates!
        // -----------------------------------------------------------------
        let pass2Progress = true;
        let guard2 = 0;
        while (pass2Progress && guard2 < 200) {
            guard2++;
            pass2Progress = false;

            const dayPrefDocs = activeDocs.filter(r => {
                return hasRemainingQuota(r) &&
                    Array.isArray(r.prefDays) && r.prefDays.length > 0;
            });

            const docsOrder = shuffleArray(dayPrefDocs);

            for (const r of docsOrder) {
                if (!hasRemainingQuota(r)) continue;

                const minDay = getMinPrefDayCount(r);
                let candidateDays = r.prefDays.filter(dn => getDayNameCount(r, dn) === minDay);
                if (candidateDays.length === 0) candidateDays = r.prefDays.slice();
                candidateDays = shuffleArray(candidateDays);

                // Determine candidate shifts based on variety & gender rules
                let shiftCandidates = [];
                if (Array.isArray(r.prefShifts) && r.prefShifts.length > 0) {
                    const minS = getMinPrefShiftCount(r);
                    shiftCandidates = r.prefShifts.filter(s => getShiftCount(r, s) === minS);
                    if (shiftCandidates.length === 0) shiftCandidates = r.prefShifts.slice();
                } else if (r.sex === 'F') {
                    shiftCandidates = ['morning', 'afternoon', 'preNight', 'lateNight'];
                } else {
                    shiftCandidates = (getQuota(r) > 1) 
                        ? ['preNight', 'morning', 'afternoon', 'lateNight']
                        : ['lateNight', 'preNight', 'afternoon', 'morning'];
                }
                shiftCandidates.sort((s1, s2) => getShiftCount(r, s1) - getShiftCount(r, s2));

                let validSlots = [];
                // First try non-consecutive
                for (const shiftKey of shiftCandidates) {
                    for (let d = 1; d <= daysCount; d++) {
                        const dayEntry = schedule.find(s => s.dayNumber === d);
                        if (dayEntry && !dayEntry[shiftKey] && candidateDays.includes(dayEntry.dayName)) {
                            if (isDoctorAvailable(r, d, shiftKey, false)) {
                                validSlots.push({ d, dayEntry, shiftKey, consecutive: false });
                            }
                        }
                    }
                    if (validSlots.length > 0) break;
                }

                // Fallback consecutive relaxation
                if (validSlots.length === 0) {
                    for (const shiftKey of shiftCandidates) {
                        for (let d = 1; d <= daysCount; d++) {
                            const dayEntry = schedule.find(s => s.dayNumber === d);
                            if (dayEntry && !dayEntry[shiftKey] && candidateDays.includes(dayEntry.dayName)) {
                                if (isDoctorAvailable(r, d, shiftKey, true)) {
                                    validSlots.push({ d, dayEntry, shiftKey, consecutive: true });
                                }
                            }
                        }
                        if (validSlots.length > 0) break;
                    }
                }

                if (validSlots.length > 0) {
                    validSlots = shuffleArray(validSlots);
                    const chosen = validSlots[0];
                    assignSlot(chosen.dayEntry, chosen.shiftKey, r, chosen.d);
                    pass2Progress = true;
                }
            }
        }

        // -----------------------------------------------------------------
        // PASS 3: SHIFT PREFERENCE MATCH (Doctor preferred specific shifts)
        // Rotates shifts in round-robin fashion so doctors with multiple
        // preferences receive varied duties with least possible similarities!
        // (e.g. 1 morning, 1 afternoon, 1 prenight for a doctor with 3 duties)
        // -----------------------------------------------------------------
        let pass3Progress = true;
        let guard3 = 0;
        while (pass3Progress && guard3 < 200) {
            guard3++;
            pass3Progress = false;

            const shiftPrefDocs = activeDocs.filter(r => {
                return hasRemainingQuota(r) &&
                    Array.isArray(r.prefShifts) && r.prefShifts.length > 0;
            });

            const docsOrder = shuffleArray(shiftPrefDocs);

            for (const r of docsOrder) {
                if (!hasRemainingQuota(r)) continue;

                const minShift = getMinPrefShiftCount(r);
                let eligibleShifts = r.prefShifts.filter(s => getShiftCount(r, s) === minShift);
                if (eligibleShifts.length === 0) eligibleShifts = r.prefShifts.slice();
                eligibleShifts = shuffleArray(eligibleShifts);

                let validSlots = [];
                for (const shiftKey of eligibleShifts) {
                    for (let d = 1; d <= daysCount; d++) {
                        const dayEntry = schedule.find(s => s.dayNumber === d);
                        if (dayEntry && !dayEntry[shiftKey] && isDoctorAvailable(r, d, shiftKey, false)) {
                            validSlots.push({ d, dayEntry, shiftKey, consecutive: false });
                        }
                    }
                    if (validSlots.length > 0) break;
                }

                if (validSlots.length === 0) {
                    for (const shiftKey of eligibleShifts) {
                        for (let d = 1; d <= daysCount; d++) {
                            const dayEntry = schedule.find(s => s.dayNumber === d);
                            if (dayEntry && !dayEntry[shiftKey] && isDoctorAvailable(r, d, shiftKey, true)) {
                                validSlots.push({ d, dayEntry, shiftKey, consecutive: true });
                            }
                        }
                        if (validSlots.length > 0) break;
                    }
                }

                if (validSlots.length > 0) {
                    // Sort valid slots to prioritize days of week doctor has worked fewest times,
                    // with a random tie-breaker for date variety across runs
                    validSlots.sort((a, b) => {
                        const dayCountDiff = getDayNameCount(r, a.dayEntry.dayName) - getDayNameCount(r, b.dayEntry.dayName);
                        if (dayCountDiff !== 0) return dayCountDiff;
                        return Math.random() - 0.5;
                    });
                    const chosen = validSlots[0];
                    assignSlot(chosen.dayEntry, chosen.shiftKey, r, chosen.d);
                    pass3Progress = true;
                }
            }
        }

        // -----------------------------------------------------------------
        // PASS 4: GENERAL DISTRIBUTION FOR REMAINING SLOTS
        // Respecting medical rules + variety:
        // - Morning (8AM-2PM): Females first, then males
        // - Afternoon (2PM-8PM): Females first, then males
        // - Pre-Night (8PM-2AM): Males with multiple duties (>1), then any male, then any doc
        // - Late-Night (2AM-8AM): Males with single duty (==1), then any male, then any doc
        // Priority within each tier given to doctors with FEWEST OF THIS SHIFT!
        // Shuffled dates across the month ensure natural, non-linear distribution!
        // STRICT QUOTA LIMIT: IF NO CANDIDATE HAS QUOTA, LEAVE CELL EMPTY!
        // -----------------------------------------------------------------
        const shuffledDaysForGen = shuffleArray([...Array(daysCount).keys()].map(i => i + 1));

        // 4A. Morning
        for (const d of shuffledDaysForGen) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.morning) {
                let candidates = activeDocs.filter(r => r.sex === 'F' && isDoctorAvailable(r, d, 'morning', false));
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'morning', false));
                }
                // Fallback relaxation if no non-consecutive candidate has quota
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'F' && isDoctorAvailable(r, d, 'morning', true));
                    if (candidates.length === 0) {
                        candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'morning', true));
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => {
                        const sDiff = getShiftCount(a, 'morning') - getShiftCount(b, 'morning');
                        if (sDiff !== 0) return sDiff;
                        const dDiff = getDayNameCount(a, dayEntry.dayName) - getDayNameCount(b, dayEntry.dayName);
                        if (dDiff !== 0) return dDiff;
                        const assignedDiff = getAssigned(a) - getAssigned(b);
                        if (assignedDiff !== 0) return assignedDiff;
                        return Math.random() - 0.5;
                    });
                    assignSlot(dayEntry, 'morning', candidates[0], d);
                }
            }
        }

        // 4B. Afternoon
        for (const d of shuffledDaysForGen) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.afternoon) {
                let candidates = activeDocs.filter(r => r.sex === 'F' && isDoctorAvailable(r, d, 'afternoon', false));
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'afternoon', false));
                }
                // Fallback relaxation
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'F' && isDoctorAvailable(r, d, 'afternoon', true));
                    if (candidates.length === 0) {
                        candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'afternoon', true));
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => {
                        const sDiff = getShiftCount(a, 'afternoon') - getShiftCount(b, 'afternoon');
                        if (sDiff !== 0) return sDiff;
                        const dDiff = getDayNameCount(a, dayEntry.dayName) - getDayNameCount(b, dayEntry.dayName);
                        if (dDiff !== 0) return dDiff;
                        const assignedDiff = getAssigned(a) - getAssigned(b);
                        if (assignedDiff !== 0) return assignedDiff;
                        return Math.random() - 0.5;
                    });
                    assignSlot(dayEntry, 'afternoon', candidates[0], d);
                }
            }
        }

        // 4C. Pre-Night (8PM - 2AM)
        for (const d of shuffledDaysForGen) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.preNight) {
                let candidates = activeDocs.filter(r => r.sex === 'M' && getQuota(r) > 1 && isDoctorAvailable(r, d, 'preNight', false));
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'preNight', false));
                }
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => isDoctorAvailable(r, d, 'preNight', false));
                }
                // Fallback relaxation
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && getQuota(r) > 1 && isDoctorAvailable(r, d, 'preNight', true));
                    if (candidates.length === 0) {
                        candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'preNight', true));
                    }
                    if (candidates.length === 0) {
                        candidates = activeDocs.filter(r => isDoctorAvailable(r, d, 'preNight', true));
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => {
                        const sDiff = getShiftCount(a, 'preNight') - getShiftCount(b, 'preNight');
                        if (sDiff !== 0) return sDiff;
                        const dDiff = getDayNameCount(a, dayEntry.dayName) - getDayNameCount(b, dayEntry.dayName);
                        if (dDiff !== 0) return dDiff;
                        const assignedDiff = getAssigned(a) - getAssigned(b);
                        if (assignedDiff !== 0) return assignedDiff;
                        return Math.random() - 0.5;
                    });
                    assignSlot(dayEntry, 'preNight', candidates[0], d);
                }
            }
        }

        // 4D. Late-Night (2AM - 8AM)
        for (const d of shuffledDaysForGen) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.lateNight) {
                let candidates = activeDocs.filter(r => r.sex === 'M' && getQuota(r) === 1 && isDoctorAvailable(r, d, 'lateNight', false));
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'lateNight', false));
                }
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => isDoctorAvailable(r, d, 'lateNight', false));
                }
                // Fallback relaxation
                if (candidates.length === 0) {
                    candidates = activeDocs.filter(r => r.sex === 'M' && getQuota(r) === 1 && isDoctorAvailable(r, d, 'lateNight', true));
                    if (candidates.length === 0) {
                        candidates = activeDocs.filter(r => r.sex === 'M' && isDoctorAvailable(r, d, 'lateNight', true));
                    }
                    if (candidates.length === 0) {
                        candidates = activeDocs.filter(r => isDoctorAvailable(r, d, 'lateNight', true));
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => {
                        const sDiff = getShiftCount(a, 'lateNight') - getShiftCount(b, 'lateNight');
                        if (sDiff !== 0) return sDiff;
                        const dDiff = getDayNameCount(a, dayEntry.dayName) - getDayNameCount(b, dayEntry.dayName);
                        if (dDiff !== 0) return dDiff;
                        const assignedDiff = getAssigned(a) - getAssigned(b);
                        if (assignedDiff !== 0) return assignedDiff;
                        return Math.random() - 0.5;
                    });
                    assignSlot(dayEntry, 'lateNight', candidates[0], d);
                }
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

        const conCandidates = activeDocs.filter(r => (Number(r.con_target) || 0) > 0);
        const assigned = countScheduledDutiesPerResident('con');

        function isConAvailable(r, dayNumber, allowConsecutive = false) {
            const clean = normalizeArabic(r.name);
            const filled = assigned[clean] || 0;
            const target = Number(r.con_target) || 0;
            if (filled >= target) return false;

            const dateStr = formatDateStr(state.year, state.month, dayNumber);
            const evalRes = evaluateCellConflict(r.name, dateStr, 'con', 'doctor');
            if (evalRes.hasConflict) return false;

            if (!allowConsecutive && r.noConsecutiveDays !== false) {
                if (hasDoctorDutyOnAdjacentDay(clean, dayNumber, daysCount)) return false;
            }

            return true;
        }

        const assignedDayNameCounts = {};
        schedule.forEach(day => {
            if (day.doctor && day.doctor.trim()) {
                const clean = normalizeArabic(day.doctor.trim());
                assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
                assignedDayNameCounts[clean][day.dayName] = (assignedDayNameCounts[clean][day.dayName] || 0) + 1;
            }
        });

        function getDayNameCountCon(r, dn) {
            const clean = normalizeArabic(r.name);
            return (assignedDayNameCounts[clean] && assignedDayNameCounts[clean][dn]) || 0;
        }

        function getMinPrefDayCountCon(r) {
            if (!Array.isArray(r.prefDays) || r.prefDays.length <= 1) return 0;
            return Math.min(...r.prefDays.map(dn => getDayNameCountCon(r, dn)));
        }

        function isDayVarietySatisfiedCon(r, dn) {
            if (!Array.isArray(r.prefDays) || r.prefDays.length <= 1) return true;
            if (!r.prefDays.includes(dn)) return true;
            return getDayNameCountCon(r, dn) <= getMinPrefDayCountCon(r);
        }

        function assignCon(dayEntry, r) {
            dayEntry.doctor = r.name;
            const clean = normalizeArabic(r.name);
            assigned[clean] = (assigned[clean] || 0) + 1;
            assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
            assignedDayNameCounts[clean][dayEntry.dayName] = (assignedDayNameCounts[clean][dayEntry.dayName] || 0) + 1;
        }

        const shuffledDaysCon = shuffleArray([...Array(daysCount).keys()].map(i => i + 1));

        // Pass 1: Preferences (Doctors who prefer this day)
        for (const d of shuffledDaysCon) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                // Tier 1: Day variety satisfied (doctor hasn't had more of this day than of their other preferred days)
                let prefMatches = conCandidates.filter(r => {
                    if (!isConAvailable(r, d, false)) return false;
                    return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName) && isDayVarietySatisfiedCon(r, dayEntry.dayName);
                });

                if (prefMatches.length === 0) {
                    prefMatches = conCandidates.filter(r => {
                        if (!isConAvailable(r, d, false)) return false;
                        return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                    });
                }

                if (prefMatches.length === 0) {
                    prefMatches = conCandidates.filter(r => {
                        if (!isConAvailable(r, d, true)) return false;
                        return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                    });
                }

                if (prefMatches.length > 0) {
                    prefMatches.sort((a, b) => {
                        const dayDiff = getDayNameCountCon(a, dayEntry.dayName) - getDayNameCountCon(b, dayEntry.dayName);
                        if (dayDiff !== 0) return dayDiff;
                        const remA = (Number(a.con_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                        const remB = (Number(b.con_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                        if (remB !== remA) return remB - remA;
                        return Math.random() - 0.5;
                    });
                    assignCon(dayEntry, prefMatches[0]);
                }
            }
        }

        // Pass 2: General Fill for remaining slots
        for (const d of shuffledDaysCon) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                let available = conCandidates.filter(r => isConAvailable(r, d, false));
                if (available.length === 0) {
                    available = conCandidates.filter(r => isConAvailable(r, d, true));
                }
                if (available.length > 0) {
                    available.sort((a, b) => {
                        const dayDiff = getDayNameCountCon(a, dayEntry.dayName) - getDayNameCountCon(b, dayEntry.dayName);
                        if (dayDiff !== 0) return dayDiff;
                        const remA = (Number(a.con_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                        const remB = (Number(b.con_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                        if (remB !== remA) return remB - remA;
                        return Math.random() - 0.5;
                    });
                    assignCon(dayEntry, available[0]);
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

        const dcCandidates = activeDocs.filter(r => (Number(r.dc_target) || 0) > 0);
        const assigned = countScheduledDutiesPerResident('dc');

        function isDCAvailable(r, dayNumber, allowConsecutive = false) {
            const clean = normalizeArabic(r.name);
            const filled = assigned[clean] || 0;
            const target = Number(r.dc_target) || 0;
            if (filled >= target) return false;

            const dateStr = formatDateStr(state.year, state.month, dayNumber);
            const evalRes = evaluateCellConflict(r.name, dateStr, 'dc', 'doctor');
            if (evalRes.hasConflict) return false;

            if (!allowConsecutive && r.noConsecutiveDays !== false) {
                if (hasDoctorDutyOnAdjacentDay(clean, dayNumber, daysCount)) return false;
            }

            return true;
        }

        const assignedDayNameCounts = {};
        schedule.forEach(day => {
            if (day.doctor && day.doctor.trim()) {
                const clean = normalizeArabic(day.doctor.trim());
                assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
                assignedDayNameCounts[clean][day.dayName] = (assignedDayNameCounts[clean][day.dayName] || 0) + 1;
            }
        });

        function getDayNameCountDC(r, dn) {
            const clean = normalizeArabic(r.name);
            return (assignedDayNameCounts[clean] && assignedDayNameCounts[clean][dn]) || 0;
        }

        function getMinPrefDayCountDC(r) {
            if (!Array.isArray(r.prefDays) || r.prefDays.length <= 1) return 0;
            return Math.min(...r.prefDays.map(dn => getDayNameCountDC(r, dn)));
        }

        function isDayVarietySatisfiedDC(r, dn) {
            if (!Array.isArray(r.prefDays) || r.prefDays.length <= 1) return true;
            if (!r.prefDays.includes(dn)) return true;
            return getDayNameCountDC(r, dn) <= getMinPrefDayCountDC(r);
        }

        function assignDC(dayEntry, r) {
            dayEntry.doctor = r.name;
            const clean = normalizeArabic(r.name);
            assigned[clean] = (assigned[clean] || 0) + 1;
            assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
            assignedDayNameCounts[clean][dayEntry.dayName] = (assignedDayNameCounts[clean][dayEntry.dayName] || 0) + 1;
        }

        const shuffledDaysDC = shuffleArray([...Array(daysCount).keys()].map(i => i + 1));

        // Pass 1: Preferences (Doctors who prefer this day)
        for (const d of shuffledDaysDC) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                // Tier 1: Day variety satisfied
                let prefMatches = dcCandidates.filter(r => {
                    if (!isDCAvailable(r, d, false)) return false;
                    return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName) && isDayVarietySatisfiedDC(r, dayEntry.dayName);
                });
                if (prefMatches.length === 0) {
                    prefMatches = dcCandidates.filter(r => {
                        if (!isDCAvailable(r, d, false)) return false;
                        return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                    });
                }
                if (prefMatches.length === 0) {
                    prefMatches = dcCandidates.filter(r => {
                        if (!isDCAvailable(r, d, true)) return false;
                        return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                    });
                }

                if (prefMatches.length > 0) {
                    prefMatches.sort((a, b) => {
                        const dayDiff = getDayNameCountDC(a, dayEntry.dayName) - getDayNameCountDC(b, dayEntry.dayName);
                        if (dayDiff !== 0) return dayDiff;
                        const remA = (Number(a.dc_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                        const remB = (Number(b.dc_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                        if (remB !== remA) return remB - remA;
                        return Math.random() - 0.5;
                    });
                    assignDC(dayEntry, prefMatches[0]);
                }
            }
        }

        // Pass 2: Doctors on-call in hospital on this date
        for (const d of shuffledDaysDC) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                const dateStr = formatDateStr(state.year, state.month, d);
                const hospOnCall = getAllHospitalOnCallDoctors(dateStr);
                const hospCleanSet = new Set(hospOnCall.map(h => h.cleanName));

                let onCallCandidates = dcCandidates.filter(r => {
                    if (!isDCAvailable(r, d, false)) return false;
                    return hospCleanSet.has(normalizeArabic(r.name));
                });
                if (onCallCandidates.length === 0) {
                    onCallCandidates = dcCandidates.filter(r => {
                        if (!isDCAvailable(r, d, true)) return false;
                        return hospCleanSet.has(normalizeArabic(r.name));
                    });
                }

                if (onCallCandidates.length > 0) {
                    onCallCandidates.sort((a, b) => {
                        const dayDiff = getDayNameCountDC(a, dayEntry.dayName) - getDayNameCountDC(b, dayEntry.dayName);
                        if (dayDiff !== 0) return dayDiff;
                        const remA = (Number(a.dc_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                        const remB = (Number(b.dc_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                        if (remB !== remA) return remB - remA;
                        return Math.random() - 0.5;
                    });
                    assignDC(dayEntry, onCallCandidates[0]);
                }
            }
        }

        // Pass 3: General Fallback for remaining slots
        for (const d of shuffledDaysDC) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (dayEntry && !dayEntry.doctor) {
                let available = dcCandidates.filter(r => isDCAvailable(r, d, false));
                if (available.length === 0) {
                    available = dcCandidates.filter(r => isDCAvailable(r, d, true));
                }
                if (available.length > 0) {
                    available.sort((a, b) => {
                        const dayDiff = getDayNameCountDC(a, dayEntry.dayName) - getDayNameCountDC(b, dayEntry.dayName);
                        if (dayDiff !== 0) return dayDiff;
                        const remA = (Number(a.dc_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                        const remB = (Number(b.dc_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                        if (remB !== remA) return remB - remA;
                        return Math.random() - 0.5;
                    });
                    assignDC(dayEntry, available[0]);
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
        const shiftMap = {
            'er_morning': 'morning',
            'er_afternoon': 'afternoon',
            'er_preNight': 'preNight',
            'er_lateNight': 'lateNight'
        };
        const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
        const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || daysCount;

        if (mode === 'fresh') {
            schedule.forEach(d => {
                if (d.dayNumber >= startDay && d.dayNumber <= endDay) {
                    shifts.forEach(s => d[s] = '');
                }
            });
        }

        const rsCandidates = activeDocs.filter(r => (Number(r.rs_target) || 0) > 0);
        const assigned = countScheduledDutiesPerResident('rs');
        const assignedShiftCounts = {};
        const assignedDayNameCounts = {};

        schedule.forEach(day => {
            shifts.forEach(slot => {
                if (day[slot] && day[slot].trim()) {
                    const clean = normalizeArabic(day[slot].trim());
                    const s = shiftMap[slot];
                    assignedShiftCounts[clean] = assignedShiftCounts[clean] || {};
                    assignedShiftCounts[clean][s] = (assignedShiftCounts[clean][s] || 0) + 1;
                    assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
                    assignedDayNameCounts[clean][day.dayName] = (assignedDayNameCounts[clean][day.dayName] || 0) + 1;
                }
            });
        });

        function getShiftCountRS(r, s) {
            const clean = normalizeArabic(r.name);
            return (assignedShiftCounts[clean] && assignedShiftCounts[clean][s]) || 0;
        }

        function getDayNameCountRS(r, dn) {
            const clean = normalizeArabic(r.name);
            return (assignedDayNameCounts[clean] && assignedDayNameCounts[clean][dn]) || 0;
        }

        function isRSAvailable(r, dayNumber, slot, allowConsecutive = false) {
            const clean = normalizeArabic(r.name);
            const filled = assigned[clean] || 0;
            const target = Number(r.rs_target) || 0;
            if (filled >= target) return false;

            const dateStr = formatDateStr(state.year, state.month, dayNumber);
            const evalRes = evaluateCellConflict(r.name, dateStr, 'rs', slot);
            if (evalRes.hasConflict) return false;

            if (!allowConsecutive && r.noConsecutiveDays !== false) {
                if (hasDoctorDutyOnAdjacentDay(clean, dayNumber, daysCount)) return false;
            }

            return true;
        }

        function assignRS(dayEntry, slot, r) {
            dayEntry[slot] = r.name;
            const clean = normalizeArabic(r.name);
            assigned[clean] = (assigned[clean] || 0) + 1;
            const s = shiftMap[slot];
            assignedShiftCounts[clean] = assignedShiftCounts[clean] || {};
            assignedShiftCounts[clean][s] = (assignedShiftCounts[clean][s] || 0) + 1;
            assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
            assignedDayNameCounts[clean][dayEntry.dayName] = (assignedDayNameCounts[clean][dayEntry.dayName] || 0) + 1;
        }

        const rsDaysArr = [];
        for (let d = startDay; d <= endDay; d++) rsDaysArr.push(d);
        const shuffledDaysRS = shuffleArray(rsDaysArr);

        // Pass 1: Preferences
        for (const d of shuffledDaysRS) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (!dayEntry) continue;
            shifts.forEach(slot => {
                if (!dayEntry[slot]) {
                    const standardShift = shiftMap[slot];
                    let prefMatches = rsCandidates.filter(r => {
                        if (!isRSAvailable(r, d, slot, false)) return false;
                        const hasDay = Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                        const hasShift = Array.isArray(r.prefShifts) && r.prefShifts.includes(standardShift);
                        return hasDay || hasShift;
                    });
                    if (prefMatches.length === 0) {
                        prefMatches = rsCandidates.filter(r => {
                            if (!isRSAvailable(r, d, slot, true)) return false;
                            const hasDay = Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                            const hasShift = Array.isArray(r.prefShifts) && r.prefShifts.includes(standardShift);
                            return hasDay || hasShift;
                        });
                    }
                    if (prefMatches.length > 0) {
                        prefMatches.sort((a, b) => {
                            const shiftDiff = getShiftCountRS(a, standardShift) - getShiftCountRS(b, standardShift);
                            if (shiftDiff !== 0) return shiftDiff;
                            const dayDiff = getDayNameCountRS(a, dayEntry.dayName) - getDayNameCountRS(b, dayEntry.dayName);
                            if (dayDiff !== 0) return dayDiff;
                            const remA = (Number(a.rs_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                            const remB = (Number(b.rs_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                            if (remB !== remA) return remB - remA;
                            return Math.random() - 0.5;
                        });
                        assignRS(dayEntry, slot, prefMatches[0]);
                    }
                }
            });
        }

        // Pass 2: General Fallback
        for (const d of shuffledDaysRS) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (!dayEntry) continue;
            shifts.forEach(slot => {
                if (!dayEntry[slot]) {
                    const standardShift = shiftMap[slot];
                    let available = rsCandidates.filter(r => isRSAvailable(r, d, slot, false));
                    if (available.length === 0) {
                        available = rsCandidates.filter(r => isRSAvailable(r, d, slot, true));
                    }
                    if (available.length > 0) {
                        available.sort((a, b) => {
                            const shiftDiff = getShiftCountRS(a, standardShift) - getShiftCountRS(b, standardShift);
                            if (shiftDiff !== 0) return shiftDiff;
                            const dayDiff = getDayNameCountRS(a, dayEntry.dayName) - getDayNameCountRS(b, dayEntry.dayName);
                            if (dayDiff !== 0) return dayDiff;
                            const remA = (Number(a.rs_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                            const remB = (Number(b.rs_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                            if (remB !== remA) return remB - remA;
                            return Math.random() - 0.5;
                        });
                        assignRS(dayEntry, slot, available[0]);
                    }
                }
            });
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

        const rsCandidates = activeDocs.filter(r => (Number(r.rs_target) || 0) > 0);
        const assigned = countScheduledDutiesPerResident('rs');
        const assignedDayNameCounts = {};

        schedule.forEach(day => {
            wards.forEach(w => {
                if (day[w] && day[w].trim()) {
                    const clean = normalizeArabic(day[w].trim());
                    assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
                    assignedDayNameCounts[clean][day.dayName] = (assignedDayNameCounts[clean][day.dayName] || 0) + 1;
                }
            });
        });

        function getDayNameCountRSWards(r, dn) {
            const clean = normalizeArabic(r.name);
            return (assignedDayNameCounts[clean] && assignedDayNameCounts[clean][dn]) || 0;
        }

        function isRSWardsAvailable(r, dayNumber, slot, allowConsecutive = false) {
            const clean = normalizeArabic(r.name);
            const filled = assigned[clean] || 0;
            const target = Number(r.rs_target) || 0;
            if (filled >= target) return false;

            const dateStr = formatDateStr(state.year, state.month, dayNumber);
            const evalRes = evaluateCellConflict(r.name, dateStr, 'rs', slot);
            if (evalRes.hasConflict) return false;

            if (!allowConsecutive && r.noConsecutiveDays !== false) {
                if (hasDoctorDutyOnAdjacentDay(clean, dayNumber, daysCount)) return false;
            }

            return true;
        }

        function assignRSWards(dayEntry, slot, r) {
            dayEntry[slot] = r.name;
            const clean = normalizeArabic(r.name);
            assigned[clean] = (assigned[clean] || 0) + 1;
            assignedDayNameCounts[clean] = assignedDayNameCounts[clean] || {};
            assignedDayNameCounts[clean][dayEntry.dayName] = (assignedDayNameCounts[clean][dayEntry.dayName] || 0) + 1;
        }

        const rsWardsDaysArr = [];
        for (let d = startDay; d <= endDay; d++) rsWardsDaysArr.push(d);
        const shuffledDaysRSWards = shuffleArray(rsWardsDaysArr);

        // Pass 1: Preferences (day match)
        for (const d of shuffledDaysRSWards) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (!dayEntry) continue;
            wards.forEach(slot => {
                if (!dayEntry[slot]) {
                    let prefMatches = rsCandidates.filter(r => {
                        if (!isRSWardsAvailable(r, d, slot, false)) return false;
                        return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                    });
                    if (prefMatches.length === 0) {
                        prefMatches = rsCandidates.filter(r => {
                            if (!isRSWardsAvailable(r, d, slot, true)) return false;
                            return Array.isArray(r.prefDays) && r.prefDays.includes(dayEntry.dayName);
                        });
                    }
                    if (prefMatches.length > 0) {
                        prefMatches.sort((a, b) => {
                            const dayDiff = getDayNameCountRSWards(a, dayEntry.dayName) - getDayNameCountRSWards(b, dayEntry.dayName);
                            if (dayDiff !== 0) return dayDiff;
                            const remA = (Number(a.rs_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                            const remB = (Number(b.rs_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                            if (remB !== remA) return remB - remA;
                            return Math.random() - 0.5;
                        });
                        assignRSWards(dayEntry, slot, prefMatches[0]);
                    }
                }
            });
        }

        // Pass 2: General Fallback
        for (const d of shuffledDaysRSWards) {
            const dayEntry = schedule.find(s => s.dayNumber === d);
            if (!dayEntry) continue;
            wards.forEach(slot => {
                if (!dayEntry[slot]) {
                    let available = rsCandidates.filter(r => isRSWardsAvailable(r, d, slot, false));
                    if (available.length === 0) {
                        available = rsCandidates.filter(r => isRSWardsAvailable(r, d, slot, true));
                    }
                    if (available.length > 0) {
                        available.sort((a, b) => {
                            const dayDiff = getDayNameCountRSWards(a, dayEntry.dayName) - getDayNameCountRSWards(b, dayEntry.dayName);
                            if (dayDiff !== 0) return dayDiff;
                            const remA = (Number(a.rs_target) || 0) - (assigned[normalizeArabic(a.name)] || 0);
                            const remB = (Number(b.rs_target) || 0) - (assigned[normalizeArabic(b.name)] || 0);
                            if (remB !== remA) return remB - remA;
                            return Math.random() - 0.5;
                        });
                        assignRSWards(dayEntry, slot, available[0]);
                    }
                }
            });
        }
    }

    // =========================================================================
    // 10. OFFICIAL MINISTERIAL PRINTING LAYOUT (FITS STRICTLY ON A SINGLE A4 PAGE)
    // =========================================================================

    function countIncompleteScheduleSlots(sheetKey) {
        let emptyCount = 0;
        let totalSlots = 0;

        if (sheetKey === 'er') {
            const slots = ['morning', 'afternoon', 'preNight', 'lateNight'];
            (state.schedules.er || []).forEach(day => {
                slots.forEach(s => {
                    totalSlots++;
                    if (!day[s] || !day[s].trim()) emptyCount++;
                });
            });
        } else if (sheetKey === 'con') {
            (state.schedules.con || []).forEach(day => {
                totalSlots++;
                if (!day.doctor || !day.doctor.trim()) emptyCount++;
            });
        } else if (sheetKey === 'dc') {
            (state.schedules.dc || []).forEach(day => {
                totalSlots++;
                if (!day.doctor || !day.doctor.trim()) emptyCount++;
            });
        } else if (sheetKey === 'rs_er') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);
            const slots = ['er_morning', 'er_afternoon', 'er_preNight', 'er_lateNight'];
            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    slots.forEach(s => {
                        totalSlots++;
                        if (!day[s] || !day[s].trim()) emptyCount++;
                    });
                }
            });
        } else if (sheetKey === 'rs_wards') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);
            const slots = ['ward_private', 'ward_floor4', 'ward_floor5'];
            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    slots.forEach(s => {
                        totalSlots++;
                        if (!day[s] || !day[s].trim()) emptyCount++;
                    });
                }
            });
        } else if (sheetKey === 'rs') {
            const erIncomplete = countIncompleteScheduleSlots('rs_er');
            const wardsIncomplete = countIncompleteScheduleSlots('rs_wards');
            return {
                emptyCount: erIncomplete.emptyCount + wardsIncomplete.emptyCount,
                totalSlots: erIncomplete.totalSlots + wardsIncomplete.totalSlots
            };
        }

        return { emptyCount, totalSlots };
    }

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

        const activeSheet = targetSheet || (state.activeTab === 'rs' ? 'rs_er' : (state.activeTab || 'er'));
        const targetTitle = sheetNames[activeSheet] || 'في الطوارئ';

        // Check for incomplete schedule and notify user before proceeding to print
        const incompleteInfo = countIncompleteScheduleSlots(activeSheet);
        if (incompleteInfo.emptyCount > 0) {
            const proceed = window.confirm(`⚠️ تنبيه: جدول خفارات ${targetTitle} غير مكتمل!\n\nيوجد (${incompleteInfo.emptyCount}) خفارة شاغرة غير معينة من إجمالي (${incompleteInfo.totalSlots}) خفارة.\n\nهل ترغب بالاستمرار والطباعة على أية حال؟`);
            if (!proceed) {
                return;
            }
        }

        const opts = state.printOptions || PRINT_THEME_PRESETS.official;
        const thStyle = `background-color: ${opts.headerBg} !important; color: ${opts.headerText} !important; border: 1px solid ${opts.borderColor} !important; font-weight: 900; padding: 2.5px 3.5px !important; text-align: center;`;

        // Prepare table rows depending on sheet (DAY NUMBER / ت COLUMN IS REMOVED AS REQUESTED)
        let tableHeaderHTML = '';
        let tableRowsHTML = '';

        if (activeSheet === 'er' || (!targetSheet && state.activeTab === 'er')) {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 70px; ${thStyle}">اليوم</th>
                    <th style="width: 80px; ${thStyle}">التاريخ</th>
                    <th style="${thStyle}">الصباحية 8ص-2م</th>
                    <th style="${thStyle}">بعدالصباحية 2م-8م</th>
                    <th style="${thStyle}">البرينايت 8م-2ص</th>
                    <th style="${thStyle}">الليلية 2ص-8ص</th>
                </tr>
            `;
            (state.schedules.er || []).forEach(day => {
                const isWeekend = (day.dayName === 'الجمعة' || day.dayName === 'السبت');
                const rowBg = isWeekend ? (opts.weekendBg || '#5ea37d') : '#ffffff';
                const rowTextColor = isWeekend ? (opts.weekendText || '#000000') : '#000000';
                const rowWeight = isWeekend ? 'font-weight: 700;' : '';
                const tdStyle = `border: 1px solid ${opts.borderColor} !important; color: ${rowTextColor} !important; padding: 2.2px 3.5px !important; text-align: center;`;

                tableRowsHTML += `
                    <tr style="background-color: ${rowBg} !important; color: ${rowTextColor} !important; ${rowWeight}">
                        <td style="${tdStyle}; font-weight: bold;">${day.dayName}</td>
                        <td style="${tdStyle}; font-family: Arial, sans-serif; font-weight: bold;">${formatArabicDateNumbers(day.date)}</td>
                        <td style="${tdStyle}">${day.morning || ''}</td>
                        <td style="${tdStyle}">${day.afternoon || ''}</td>
                        <td style="${tdStyle}">${day.preNight || ''}</td>
                        <td style="${tdStyle}">${day.lateNight || ''}</td>
                    </tr>
                `;
            });
        } else if (activeSheet === 'con') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 100px; ${thStyle}">اليوم</th>
                    <th style="width: 110px; ${thStyle}">التاريخ</th>
                    <th style="${thStyle}">طبيب الاستشارية الخافرة</th>
                </tr>
            `;
            (state.schedules.con || []).forEach(day => {
                const isWeekend = (day.dayName === 'الجمعة' || day.dayName === 'السبت');
                const rowBg = isWeekend ? (opts.weekendBg || '#5ea37d') : '#ffffff';
                const rowTextColor = isWeekend ? (opts.weekendText || '#000000') : '#000000';
                const rowWeight = isWeekend ? 'font-weight: 700;' : '';
                const tdStyle = `border: 1px solid ${opts.borderColor} !important; color: ${rowTextColor} !important; padding: 2.5px 4px !important; text-align: center;`;

                tableRowsHTML += `
                    <tr style="background-color: ${rowBg} !important; color: ${rowTextColor} !important; ${rowWeight}">
                        <td style="${tdStyle}; font-weight: bold;">${day.dayName}</td>
                        <td style="${tdStyle}; font-family: Arial, sans-serif; font-weight: bold;">${formatArabicDateNumbers(day.date)}</td>
                        <td style="${tdStyle}; font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (activeSheet === 'dc') {
            tableHeaderHTML = `
                <tr>
                    <th style="width: 100px; ${thStyle}">اليوم</th>
                    <th style="width: 110px; ${thStyle}">التاريخ</th>
                    <th style="${thStyle}">طبيب شهادات الوفاة المكلف</th>
                </tr>
            `;
            (state.schedules.dc || []).forEach(day => {
                const isWeekend = (day.dayName === 'الجمعة' || day.dayName === 'السبت');
                const rowBg = isWeekend ? (opts.weekendBg || '#5ea37d') : '#ffffff';
                const rowTextColor = isWeekend ? (opts.weekendText || '#000000') : '#000000';
                const rowWeight = isWeekend ? 'font-weight: 700;' : '';
                const tdStyle = `border: 1px solid ${opts.borderColor} !important; color: ${rowTextColor} !important; padding: 2.5px 4px !important; text-align: center;`;

                tableRowsHTML += `
                    <tr style="background-color: ${rowBg} !important; color: ${rowTextColor} !important; ${rowWeight}">
                        <td style="${tdStyle}; font-weight: bold;">${day.dayName}</td>
                        <td style="${tdStyle}; font-family: Arial, sans-serif; font-weight: bold;">${formatArabicDateNumbers(day.date)}</td>
                        <td style="${tdStyle}; font-weight: bold;">${day.doctor || ''}</td>
                    </tr>
                `;
            });
        } else if (activeSheet === 'rs_er') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="width: 70px; ${thStyle}">اليوم</th>
                    <th style="width: 80px; ${thStyle}">التاريخ</th>
                    <th style="${thStyle}">الصباحية 8ص-2م</th>
                    <th style="${thStyle}">بعدالصباحية 2م-8م</th>
                    <th style="${thStyle}">البرينايت 8م-2ص</th>
                    <th style="${thStyle}">الليلية 2ص-8ص</th>
                </tr>
            `;

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    const isWeekend = (day.dayName === 'الجمعة' || day.dayName === 'السبت');
                    const rowBg = isWeekend ? (opts.weekendBg || '#5ea37d') : '#ffffff';
                    const rowTextColor = isWeekend ? (opts.weekendText || '#000000') : '#000000';
                    const rowWeight = isWeekend ? 'font-weight: 700;' : '';
                    const tdStyle = `border: 1px solid ${opts.borderColor} !important; color: ${rowTextColor} !important; padding: 2.2px 3.5px !important; text-align: center;`;

                    tableRowsHTML += `
                        <tr style="background-color: ${rowBg} !important; color: ${rowTextColor} !important; ${rowWeight}">
                            <td style="${tdStyle}; font-weight: bold;">${day.dayName}</td>
                            <td style="${tdStyle}; font-family: Arial, sans-serif; font-weight: bold;">${formatArabicDateNumbers(day.date)}</td>
                            <td style="${tdStyle}">${day.er_morning || ''}</td>
                            <td style="${tdStyle}">${day.er_afternoon || ''}</td>
                            <td style="${tdStyle}">${day.er_preNight || ''}</td>
                            <td style="${tdStyle}">${day.er_lateNight || ''}</td>
                        </tr>
                    `;
                }
            });
        } else if (activeSheet === 'rs_wards') {
            const startDay = parseInt(state.rsStartDate.split('-')[2], 10) || 1;
            const endDay = parseInt(state.rsEndDate.split('-')[2], 10) || getDaysInMonth(state.year, state.month);

            tableHeaderHTML = `
                <tr>
                    <th style="width: 70px; ${thStyle}">اليوم</th>
                    <th style="width: 80px; ${thStyle}">التاريخ</th>
                    <th style="${thStyle}">الجناح الخاص</th>
                    <th style="${thStyle}">الجناح العام / طابق 4</th>
                    <th style="${thStyle}">الجناح العام / طابق 5</th>
                </tr>
            `;

            (state.schedules.rs || []).forEach(day => {
                if (day.dayNumber >= startDay && day.dayNumber <= endDay) {
                    const isWeekend = (day.dayName === 'الجمعة' || day.dayName === 'السبت');
                    const rowBg = isWeekend ? (opts.weekendBg || '#5ea37d') : '#ffffff';
                    const rowTextColor = isWeekend ? (opts.weekendText || '#000000') : '#000000';
                    const rowWeight = isWeekend ? 'font-weight: 700;' : '';
                    const tdStyle = `border: 1px solid ${opts.borderColor} !important; color: ${rowTextColor} !important; padding: 2.2px 3.5px !important; text-align: center;`;

                    tableRowsHTML += `
                        <tr style="background-color: ${rowBg} !important; color: ${rowTextColor} !important; ${rowWeight}">
                            <td style="${tdStyle}; font-weight: bold;">${day.dayName}</td>
                            <td style="${tdStyle}; font-family: Arial, sans-serif; font-weight: bold;">${formatArabicDateNumbers(day.date)}</td>
                            <td style="${tdStyle}">${day.ward_private || ''}</td>
                            <td style="${tdStyle}">${day.ward_floor4 || ''}</td>
                            <td style="${tdStyle}">${day.ward_floor5 || ''}</td>
                        </tr>
                    `;
                }
            });
        }

        const arabicOrderDate = state.orderDate ? formatArabicDateNumbers(state.orderDate) : formatArabicDateNumbers(new Date().toISOString().split('T')[0]);
        const isMetaCleared = Boolean(state.clearPrintMeta);

        const numberValueHTML = isMetaCleared
            ? `<span style="border-bottom: 1.5px dotted #000; display: inline-block; min-width: 125px; height: 13px; vertical-align: baseline;"></span>`
            : `<span>${state.orderNumber || ''}</span>`;

        const dateValueHTML = isMetaCleared
            ? `<span style="border-bottom: 1.5px dotted #000; display: inline-block; min-width: 125px; height: 13px; vertical-align: baseline;"></span>`
            : `<span>${arabicOrderDate}</span>`;

        printContainer.innerHTML = `
            <div style="font-family: 'Cairo', Arial, sans-serif; direction: rtl; color: #000; width: 100%; box-sizing: border-box;">
                
                <!-- 1. OFFICIAL CENTERED HEADER (MATCHING MINISTERIAL PDF VERBATIM) -->
                <div style="text-align: center; line-height: 1.25; margin-bottom: 5px;">
                    <div style="font-size: 10.5pt; font-weight: bold;">جمهورية العراق</div>
                    <div style="font-size: 10.5pt; font-weight: bold;">وزارة الصحة</div>
                    <div style="font-size: 10.5pt; font-weight: bold;">دائرة صحة البصرة</div>
                    <div style="font-size: 10.5pt; font-weight: bold;">${state.hospitalName}</div>
                    <div style="font-size: 10pt; font-weight: bold;">شعبة ادارة الموارد البشرية</div>
                </div>

                <!-- 2. ORDER NUMBER & DATE (ON LEFT SIDE OF PAGE, RIGHT-ALIGNED FROM RIGHT SIDE) -->
                <div style="display: flex; justify-content: flex-start; direction: ltr; margin-bottom: 6px; padding-left: 15px;">
                    <div style="direction: rtl; text-align: right; font-size: 9pt; font-weight: bold; line-height: 1.45;">
                        <div style="display: flex; align-items: baseline; gap: 4px;">
                            <span style="display: inline-block; min-width: 52px; text-align: right;">العدد /</span>
                            ${numberValueHTML}
                        </div>
                        <div style="display: flex; align-items: baseline; gap: 4px;">
                            <span style="display: inline-block; min-width: 52px; text-align: right;">التاريخ /</span>
                            ${dateValueHTML}
                        </div>
                    </div>
                </div>

                <!-- 3. ORDER TITLE & INTRO (MATCHING PDF) -->
                <div style="text-align: center; margin-bottom: 5px;">
                    <div style="font-size: 11.5pt; font-weight: 900; margin-bottom: 2px;">امر اداري</div>
                    <div style="font-size: 9pt; font-weight: bold;">
                        تقرر ان يكون جدول خفارات المقيمين الاقدمين ${targetTitle} لشهر <u>${state.monthYear}</u> كما مبين ادناه: -
                    </div>
                </div>

                <!-- 4. FORMAL PRINT TABLE (CUSTOMIZABLE PRESET COLORS & MINISTERIAL BORDERS) -->
                <table class="print-table" style="border: 1px solid ${opts.borderColor} !important;">
                    <thead style="background-color: ${opts.headerBg} !important; color: ${opts.headerText} !important;">
                        ${tableHeaderHTML}
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>

                <!-- 5. INSTRUCTIONS (MATCHING PDF) -->
                <div style="margin-top: 5px; font-size: 7.5pt; font-weight: bold; line-height: 1.35; text-align: right;">
                    <div>◆ يرجى تبليغ رئيس الاطباء المقيمين في حالة تبديل الخفارة وبخلافه يتحمل الطرفين المسؤولية.</div>
                    <div>◆ في حالة تغيب الطبيب عن الخفارة، يعتبر غياب ويكون التعويض مضاعف.</div>
                </div>

                <!-- 6. SIGNATURES (MATCHING PDF: HEAD OF RESIDENTS RIGHT, HOSPITAL DIRECTOR LEFT) -->
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px; font-size: 8.5pt;">
                    <!-- Head of Residents (Right) -->
                    <div style="width: 45%; text-align: center;">
                        <div style="height: 52px; min-height: 50px;"></div>
                        <div style="font-weight: bold; font-size: 9pt;">${state.headOfResidents || 'د. محمد راضي خضر'}</div>
                        <div style="font-weight: bold; font-size: 8pt; margin-top: 1px;">رئيس الأطباء المقيمين</div>
                    </div>

                    <!-- Hospital Director (Left) -->
                    <div style="width: 45%; text-align: center;">
                        <div style="height: 52px; min-height: 50px;"></div>
                        <div style="font-size: 7.5pt; font-weight: bold;">الطبيب الاخصائي</div>
                        <div style="font-weight: bold; font-size: 9pt;">${state.headOfHospital || 'د. علي عبد معن'}</div>
                        <div style="font-weight: bold; font-size: 8pt; margin-top: 1px;">مدير ${state.hospitalName}</div>
                    </div>
                </div>

                <!-- 7. COPIES TO (MATCHING PDF) -->
                <div style="margin-top: 6px; font-size: 7pt; font-weight: bold; line-height: 1.25; text-align: right;">
                    <div>نسخه منه الى: -</div>
                    <div>◆ دائرة صحة البصرة / قسم الامور الإدارية / للعلم مع التقدير</div>
                    <div>◆ دائرة صحة البصرة / قسم التفتيش / للعلم مع التقدير</div>
                    <div>◆ دائرة صحة البصرة / قسم العمليات الطبية والخدمات المتخصصة / للعلم مع التقدير</div>
                    <div>◆ مكتب مدير المستشفى / للعلم مع التقدير</div>
                    <div>◆ رئيس الاطباء المقيمين / شعبة الطوارئ / لوحة الاعلانات – وحدة المتابعة</div>
                    <div>◆ الاوراق مع الاوليات</div>
                </div>

            </div>
        `;

        window.print();
    }

    function formatArabicDateNumbers(dateStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
        }
        return dateStr;
    }

    // =========================================================================
    // PRINT OPTIONS & COLOR CUSTOMIZATION MODAL HANDLERS
    // =========================================================================

    function openPrintOptionsModal(targetSheet) {
        activePrintSheet = targetSheet || state.activeTab || 'er';
        const modal = document.getElementById('print-options-modal');
        if (!modal) return;

        const opts = state.printOptions || PRINT_THEME_PRESETS.official;

        const headerBgInput = document.getElementById('print-opt-header-bg');
        const headerTextInput = document.getElementById('print-opt-header-text');
        const weekendBgInput = document.getElementById('print-opt-weekend-bg');
        const weekendTextInput = document.getElementById('print-opt-weekend-text');
        const borderInput = document.getElementById('print-opt-border-color');

        if (headerBgInput) headerBgInput.value = opts.headerBg || '#000000';
        if (headerTextInput) headerTextInput.value = opts.headerText || '#ffffff';
        if (weekendBgInput) weekendBgInput.value = opts.weekendBg || '#5ea37d';
        if (weekendTextInput) weekendTextInput.value = opts.weekendText || '#000000';
        if (borderInput) borderInput.value = opts.borderColor || '#000000';

        updatePrintPreview();
        updateClearPrintMetaUI();
        modal.classList.remove('hidden');
    }

    function closePrintOptionsModal() {
        const modal = document.getElementById('print-options-modal');
        if (modal) modal.classList.add('hidden');
    }

    function toggleClearPrintMeta() {
        state.clearPrintMeta = !state.clearPrintMeta;
        updateClearPrintMetaUI();
        saveState();
        showNotification(state.clearPrintMeta ? 'تم تفعيل تفريغ العدد والتاريخ (خط تنقيط للكتابة اليدوية)' : 'تم إلغاء تفريغ العدد والتاريخ (إظهار القيم)', 'info');
    }

    function updateClearPrintMetaUI() {
        const btn = document.getElementById('toggle-clear-print-meta-btn');
        if (!btn) return;
        if (state.clearPrintMeta) {
            btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs bg-rose-600 text-white hover:bg-rose-700 shrink-0';
            btn.innerHTML = '<i class="fas fa-check-circle"></i><span>مفرّغ (منقّط)</span>';
        } else {
            btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-300 shrink-0';
            btn.innerHTML = '<i class="fas fa-pen-to-square"></i><span>تفريغ</span>';
        }
    }

    function applyPrintPreset(presetKey) {
        const preset = PRINT_THEME_PRESETS[presetKey];
        if (!preset) return;

        state.printOptions = {
            theme: presetKey,
            headerBg: preset.headerBg,
            headerText: preset.headerText,
            weekendBg: preset.weekendBg,
            weekendText: preset.weekendText,
            borderColor: preset.borderColor
        };

        const headerBgInput = document.getElementById('print-opt-header-bg');
        const headerTextInput = document.getElementById('print-opt-header-text');
        const weekendBgInput = document.getElementById('print-opt-weekend-bg');
        const weekendTextInput = document.getElementById('print-opt-weekend-text');
        const borderInput = document.getElementById('print-opt-border-color');

        if (headerBgInput) headerBgInput.value = preset.headerBg;
        if (headerTextInput) headerTextInput.value = preset.headerText;
        if (weekendBgInput) weekendBgInput.value = preset.weekendBg;
        if (weekendTextInput) weekendTextInput.value = preset.weekendText;
        if (borderInput) borderInput.value = preset.borderColor;

        updatePrintPreview();
        saveState();
        showNotification(`تم تطبيق نموذج الطباعة: ${preset.name}`, 'info');
    }

    function onCustomPrintColorChange() {
        const headerBgInput = document.getElementById('print-opt-header-bg');
        const headerTextInput = document.getElementById('print-opt-header-text');
        const weekendBgInput = document.getElementById('print-opt-weekend-bg');
        const weekendTextInput = document.getElementById('print-opt-weekend-text');
        const borderInput = document.getElementById('print-opt-border-color');

        state.printOptions = {
            theme: 'custom',
            headerBg: headerBgInput ? headerBgInput.value : '#000000',
            headerText: headerTextInput ? headerTextInput.value : '#ffffff',
            weekendBg: weekendBgInput ? weekendBgInput.value : '#5ea37d',
            weekendText: weekendTextInput ? weekendTextInput.value : '#000000',
            borderColor: borderInput ? borderInput.value : '#000000'
        };

        updatePrintPreview();
    }

    function updatePrintPreview() {
        const opts = state.printOptions || PRINT_THEME_PRESETS.official;
        const previewHeader = document.getElementById('preview-header-row');
        const previewNormal = document.getElementById('preview-normal-row');
        const previewWeekend = document.getElementById('preview-weekend-row');

        if (previewHeader) {
            previewHeader.style.backgroundColor = opts.headerBg;
            previewHeader.style.color = opts.headerText;
            previewHeader.style.borderColor = opts.borderColor;
            previewHeader.querySelectorAll('th').forEach(th => {
                th.style.borderColor = opts.borderColor;
            });
        }

        if (previewNormal) {
            previewNormal.style.backgroundColor = '#ffffff';
            previewNormal.style.color = '#000000';
            previewNormal.querySelectorAll('td').forEach(td => {
                td.style.borderColor = opts.borderColor;
            });
        }

        if (previewWeekend) {
            previewWeekend.style.backgroundColor = opts.weekendBg;
            previewWeekend.style.color = opts.weekendText;
            previewWeekend.querySelectorAll('td').forEach(td => {
                td.style.borderColor = opts.borderColor;
            });
        }
    }

    function savePrintOptions() {
        onCustomPrintColorChange();
        saveState();
        closePrintOptionsModal();
        showNotification('تم حفظ تخصيص ألوان الطباعة بنجاح', 'success');
    }

    function saveAndPrintImmediately() {
        savePrintOptions();
        prepareOfficialPrint(activePrintSheet || state.activeTab);
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
        backupResidentsDatabase,
        triggerRestoreResidentsDatabase,
        handleRestoreResidentsFile,
        getResidentStageNumber,
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
        resetEmergencyToDefaults,
        getDefaultPeriodByDay18Rule,
        countIncompleteScheduleSlots,
        clearCurrentSchedule,
        copyAllocationsFromPreviousMonth,
        updateResidentRowFulfillment,
        updateScheduleUndoRedoUI,
        openSpecialtyPickerModal,
        closeSpecialtyOptionsModal,
        selectResidentSpecialty,
        updateSpecialtyColor,
        saveNewCustomSpecialty,
        renderSpecialtyBubbleHTML,
        onDBSortColumn,
        onDBMonthChange,
        openImportMonthAllocationsModal,
        closeImportMonthAllocationsModal,
        executeImportMonthAllocations,
        toggleClearPrintMeta,
        updateClearPrintMetaUI,
        undoDBAction,
        redoDBAction,
        pushDBHistory,
        initDBHistory,
        updateDBUndoRedoUI,
        hasDoctorDutyOnAdjacentDay
    };

    // Global direct aliases for inline HTML attributes
    window.undoDBAction = undoDBAction;
    window.redoDBAction = redoDBAction;
    window.pushDBHistory = pushDBHistory;
    window.initDBHistory = initDBHistory;
    window.updateDBUndoRedoUI = updateDBUndoRedoUI;
    window.hasDoctorDutyOnAdjacentDay = hasDoctorDutyOnAdjacentDay;
    window.clearCurrentSchedule = clearCurrentSchedule;
    window.copyAllocationsFromPreviousMonth = copyAllocationsFromPreviousMonth;
    window.updateResidentRowFulfillment = updateResidentRowFulfillment;
    window.updateScheduleUndoRedoUI = updateScheduleUndoRedoUI;
    window.switchTab = switchTab;
    window.exportFullScheduleToExcel = exportFullScheduleToExcel;
    window.resetEmergencyToDefaults = resetEmergencyToDefaults;
    window.getDefaultPeriodByDay18Rule = getDefaultPeriodByDay18Rule;
    window.countIncompleteScheduleSlots = countIncompleteScheduleSlots;
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
    window.backupResidentsDatabase = backupResidentsDatabase;
    window.triggerRestoreResidentsDatabase = triggerRestoreResidentsDatabase;
    window.handleRestoreResidentsFile = handleRestoreResidentsFile;
    window.getResidentStageNumber = getResidentStageNumber;
    window.prepareOfficialPrint = prepareOfficialPrint;

    // Database Sorting, Month, Import & Specialty Management
    window.onDBSortColumn = onDBSortColumn;
    window.onDBMonthChange = onDBMonthChange;
    window.openImportMonthAllocationsModal = openImportMonthAllocationsModal;
    window.closeImportMonthAllocationsModal = closeImportMonthAllocationsModal;
    window.executeImportMonthAllocations = executeImportMonthAllocations;
    window.openSpecialtyPickerModal = openSpecialtyPickerModal;
    window.closeSpecialtyOptionsModal = closeSpecialtyOptionsModal;
    window.selectResidentSpecialty = selectResidentSpecialty;
    window.updateSpecialtyColor = updateSpecialtyColor;
    window.saveNewCustomSpecialty = saveNewCustomSpecialty;
    window.renderSpecialtyBubbleHTML = renderSpecialtyBubbleHTML;
    window.toggleClearPrintMeta = toggleClearPrintMeta;
    window.updateClearPrintMetaUI = updateClearPrintMetaUI;
    
    // Expose all interactive live filter functions globally
    window.applyScheduleLiveFilter = applyScheduleLiveFilter;
    window.onScheduleDoctorFilter = onScheduleDoctorFilter;
    window.onScheduleShiftFilter = onScheduleShiftFilter;
    window.onScheduleDayFilter = onScheduleDayFilter;
    window.onScheduleEmptyToggle = onScheduleEmptyToggle;
    window.onScheduleConflictToggle = onScheduleConflictToggle;
    window.quickFilterByShift = quickFilterByShift;
    window.clearScheduleSearch = clearScheduleSearch;
    window.applyDBLiveFilter = applyDBLiveFilter;
    window.clearDBSearch = clearDBSearch;
    window.resetDBFilters = resetDBFilters;
    window.toggleResidentSex = toggleResidentSex;
    window.cycleResidentBoard = cycleResidentBoard;
    window.importResidentsFromHospital = importResidentsFromHospital;

    // Modals and Action Handlers
    window.openResidentsDbModal = openResidentsDbModal;
    window.closeResidentsDbModal = closeResidentsDbModal;
    window.openStageOptionsModal = openStageOptionsModal;
    window.closeStageOptionsModal = closeStageOptionsModal;
    window.selectResidentStage = selectResidentStage;
    window.renderStageBubbleHTML = renderStageBubbleHTML;
    window.undoScheduleAction = undoScheduleAction;
    window.redoScheduleAction = redoScheduleAction;
    window.renderScheduleUndoRedoButtons = renderScheduleUndoRedoButtons;
    window.openPrintOptionsModal = openPrintOptionsModal;
    window.closePrintOptionsModal = closePrintOptionsModal;
    window.applyPrintPreset = applyPrintPreset;
    window.onCustomPrintColorChange = onCustomPrintColorChange;
    window.updatePrintPreview = updatePrintPreview;
    window.savePrintOptions = savePrintOptions;
    window.saveAndPrintImmediately = saveAndPrintImmediately;
    window.formatArabicDateNumbers = formatArabicDateNumbers;
    window.PRINT_THEME_PRESETS = PRINT_THEME_PRESETS;
    window.getDBContainer = getDBContainer;
    window.refreshDBView = refreshDBView;
    window.updateDutyDashboard = updateDutyDashboard;
    window.runAutoDistribution = runAutoDistribution;
    window.initEmergencyApp = initEmergencyApp;
    window.state = state;
    window.saveState = saveState;

    // Import Resident from Hospital Modal Handlers
    window.openImportResidentFromHospitalModal = openImportResidentFromHospitalModal;
    window.closeImportResidentFromHospitalModal = closeImportResidentFromHospitalModal;
    window.onImportResidentHospChanged = onImportResidentHospChanged;
    window.onImportResidentFilterChanged = onImportResidentFilterChanged;
    window.onImportResidentSearchInput = onImportResidentSearchInput;
    window.onImportResidentSearchKeydown = onImportResidentSearchKeydown;
    window.openImportResidentSuggestions = openImportResidentSuggestions;
    window.closeImportResidentSuggestions = closeImportResidentSuggestions;
    window.toggleImportResidentSuggestions = toggleImportResidentSuggestions;
    window.selectImportResidentDoctor = selectImportResidentDoctor;
    window.populateImportResidentDoctorList = populateImportResidentDoctorList;
    window.filterAndRenderImportSuggestions = filterAndRenderImportSuggestions;
    window.handleSaveImportedResident = handleSaveImportedResident;
    window.searchHospitalResidentsForAddModal = searchHospitalResidentsForAddModal;
    window.quickFillAddResidentModal = quickFillAddResidentModal;
    window.getHospitalSpecificSpecialties = getHospitalSpecificSpecialties;
    window.getHospitalDoctorsList = getHospitalDoctorsList;
    window.getAllHospitalRecords = getAllHospitalRecords;
    window.getHospitalRecord = getHospitalRecord;
    window.ensureHubDatabaseLoaded = ensureHubDatabaseLoaded;

    // Monthly Duty Checkers & Preferences Helpers
    window.getMonthlyDutyAllocationsSummary = getMonthlyDutyAllocationsSummary;
    window.renderDBDutyCheckersHTML = renderDBDutyCheckersHTML;
    window.updateDBDutyCheckers = updateDBDutyCheckers;
    window.renderResidentPrefsButtonHTML = renderResidentPrefsButtonHTML;

    // Doctor Name & Phone formatters & Specialty canonicalizer
    window.formatDoctorName = formatDoctorName;
    window.formatIraqiPhoneNumber = formatIraqiPhoneNumber;
    window.isValidIraqiPhoneNumber = isValidIraqiPhoneNumber;
    window.canonicalizeSpecialtyName = canonicalizeSpecialtyName;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEmergencyApp);
    } else {
        initEmergencyApp();
    }

})(window);
