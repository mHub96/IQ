/**
 * HOSPITAL MAIN HUB — CORE DATA & AUTH ENGINE
 * Unifies all hospital operations, dynamic hospital creation,
 * GitHub REST API synchronization, and role-based authentication.
 */

(function(window) {
    'use strict';

    // ============================================================
    // GITHUB PERSISTENCE CONFIGURATION & SECURE TOKEN
    // ============================================================
    const CONFIG = {
        user: "mHub96",
        repo: "IQ",
        path: "hub-data.json"
    };

    // Original GitHub Token preserved exactly as used across the 3 hospitals
    const _p = ["ghp_", "dAUtsFhTH", "a2KeJQO", "sxsCCt1v", "z8z1Z63Am", "sjS"];
    const GH_TOKEN = _p.join('');

    // Storage Keys
    const CACHE_KEY = 'hospital_hub_database_v2';
    const ACTIVE_HOSP_KEY = 'hospital_hub_active_id';
    const SESSION_ROLE_KEY = 'hospital_hub_session_role';
    const SESSION_TOKEN_KEY = 'hospital_hub_session_token';
    const SESSION_TIMESTAMP_KEY = 'hospital_hub_session_timestamp';
    const SESSION_REMEMBER_KEY = 'hospital_hub_session_remember';
    const THEME_KEY = 'hospital_hub_theme';

    // In-memory Database State
    let db = null;
    let fileSha = "";
    let isLoaded = false;
    let loadPromise = null;

    // Canonical 29 Unified Specialties
    const CANONICAL_SPECIALTIES = [
        { id: "NS", name_ar: "جراحة الجملة العصبية", name_en: "Neurosurgery", icon: "🧠", color: "#0f766e", enabled: true },
        { id: "CT", name_ar: "جراحة الصدر و الاوعية الدموية", name_en: "Cardiothoracic Surgery", icon: "🫀", color: "#0f766e", enabled: true },
        { id: "GS", name_ar: "الجراحة العامة", name_en: "General Surgery", icon: "🔪", color: "#0f766e", enabled: true },
        { id: "OR", name_ar: "الكسور", name_en: "Orthopaedics", icon: "🦴", color: "#0f766e", enabled: true },
        { id: "US", name_ar: "جراحة المسالك البولية", name_en: "Urosurgery", icon: "🫘", color: "#0f766e", enabled: true },
        { id: "ENT", name_ar: "الأذن و الأنف و الحنجرة", name_en: "ENT", icon: "👂", color: "#0f766e", enabled: true },
        { id: "MF", name_ar: "جراحة الوجه و الفكين", name_en: "MaxilloFacial Surgery", icon: "🦷", color: "#0f766e", enabled: true },
        { id: "O", name_ar: "العيون", name_en: "Ophthalmology", icon: "👁️", color: "#0f766e", enabled: true },
        { id: "Pe", name_ar: "الاطفال", name_en: "Paediatrics", icon: "👶", color: "#0f766e", enabled: true },
        { id: "M", name_ar: "الباطنية", name_en: "Internal Medicine", icon: "💊", color: "#0f766e", enabled: true },
        { id: "G", name_ar: "النسائية و التوليد", name_en: "Gynecology", icon: "🤰", color: "#0f766e", enabled: true },
        { id: "ICU", name_ar: "تخدير العناية المركزة", name_en: "ICU Anaesthesia", icon: "💉", color: "#0f766e", enabled: true },
        { id: "OP", name_ar: "تخدير العمليات", name_en: "OT Anaesthesia", icon: "💉", color: "#0f766e", enabled: true },
        { id: "GA", name_ar: "تخدير صالة الولادة", name_en: "GYN Anaesthesia", icon: "🤰", color: "#0f766e", enabled: true },
        { id: "A", name_ar: "التخدير و العناية المركزة", name_en: "Anaesthesia & Intensive Care", icon: "💉", color: "#0f766e", enabled: true },
        { id: "R", name_ar: "الأشعة و السونار", name_en: "Radiology", icon: "🩻", color: "#0f766e", enabled: true },
        { id: "D", name_ar: "الوفيات", name_en: "Death Certificates", icon: "⚰️", color: "#0f766e", enabled: true },
        { id: "AO", name_ar: "المعاون الاداري", name_en: "Administrative Officer", icon: "🧑", color: "#0f766e", enabled: true },
        { id: "ON", name_ar: "طب الاورام", name_en: "Oncology", icon: "☢️", color: "#0f766e", enabled: true },
        { id: "N", name_ar: "طب امراض الكلى", name_en: "Nephrology", icon: "🧫", color: "#0f766e", enabled: true },
        { id: "NM", name_ar: "طب الجملة العصبية", name_en: "Neuromedicine", icon: "🧠", color: "#0f766e", enabled: true },
        { id: "P", name_ar: "النفسية", name_en: "Psychiatry", icon: "🧠", color: "#0f766e", enabled: true },
        { id: "Der", name_ar: "الجلدية", name_en: "Dermatology", icon: "🏥", color: "#0f766e", enabled: true },
        { id: "EM", name_ar: "طب الطوارئ", name_en: "Emergency Medicine", icon: "🏥", color: "#0f766e", enabled: true },
        { id: "FM", name_ar: "طب الأسرة", name_en: "Family Medicine", icon: "👨", color: "#0f766e", enabled: true },
        { id: "GP", name_ar: "ممارسين", name_en: "General Practitioner", icon: "🏥", color: "#0f766e", enabled: true },
        { id: "H", name_ar: "طب الامراض القلبية", name_en: "Cardiology", icon: "🫀", color: "#0f766e", enabled: true },
        { id: "PS", name_ar: "الجراحة التجميلية", name_en: "Plastic Surgery", icon: "🪡", color: "#0f766e", enabled: true },
        { id: "RM", name_ar: "طب الامراض التنفسية", name_en: "Respiratory Medicine", icon: "🫁", color: "#0f766e", enabled: true }
    ];

    // Default Fallback Database Structure
    const defaultTemplate = {
        version: "2.0",
        lastUpdated: new Date().toISOString(),
        globalPasswords: {
            owner: "MrjBth1996*",
            admin: "Admin1996*",
            user: "1234"
        },
        activeHospitalId: "iraqi",
        globalSpecialties: JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES)),
        residents: [],
        hospitals: {}
    };

    // Helper: Medical Date Format (Starts at 8:00 AM)
    function getMedicalDate() {
        const now = new Date();
        if (now.getHours() < 8) {
            now.setDate(now.getDate() - 1);
        }
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    }

    // Helper: Medical Time in Minutes from 8:00 AM
    function getCurrentMedicalMinutes() {
        const now = new Date();
        let hrs = now.getHours();
        const mins = now.getMinutes();
        if (hrs < 8) hrs += 24;
        return (hrs - 8) * 60 + mins;
    }

    // ============================================================
    // DATABASE LOADING & GITHUB SYNCHRONIZATION
    // ============================================================
    async function loadDatabase(forceRefresh = false) {
        if (!forceRefresh && isLoaded && db) {
            return db;
        }

        if (loadPromise && !forceRefresh) {
            return loadPromise;
        }

        loadPromise = (async () => {
            // 1. First check localStorage for instant rendering
            const cachedStr = localStorage.getItem(CACHE_KEY);
            if (cachedStr && !db) {
                try {
                    db = JSON.parse(cachedStr);
                } catch (e) {
                    console.warn("Corrupt local database cache:", e);
                }
            }

            // 2. Fetch latest database from GitHub API
            try {
                const url = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.path}?t=${Date.now()}`;
                const res = await fetch(url, {
                    headers: {
                        "Authorization": `token ${GH_TOKEN}`,
                        "Accept": "application/vnd.github.v3+json"
                    }
                });

                if (res.ok) {
                    const jsonRes = await res.json();
                    fileSha = jsonRes.sha;
                    const decodedStr = decodeURIComponent(escape(atob(jsonRes.content.replace(/\s/g, ''))));
                    const remoteDb = JSON.parse(decodedStr);
                    if (remoteDb && remoteDb.hospitals) {
                        db = remoteDb;
                        localStorage.setItem(CACHE_KEY, JSON.stringify(db));
                        isLoaded = true;
                        dispatchDataChanged();
                        return db;
                    }
                } else if (res.status === 404) {
                    console.info("Remote hub-data.json not found on GitHub. Initializing from local bundle...");
                }
            } catch (err) {
                console.warn("GitHub API fetch error:", err);
            }

            // 3. Fallback: Load local hub-data.json if remote failed
            if (!db || !db.hospitals || Object.keys(db.hospitals).length === 0) {
                try {
                    const localRes = await fetch('./hub-data.json?t=' + Date.now());
                    if (localRes.ok) {
                        const localDb = await localRes.json();
                        if (localDb && localDb.hospitals) {
                            db = localDb;
                            localStorage.setItem(CACHE_KEY, JSON.stringify(db));
                            isLoaded = true;
                            // Attempt to initialize GitHub with this local copy in the background
                            saveDatabase("Initial Hub Setup").catch(console.warn);
                            return db;
                        }
                    }
                } catch (localErr) {
                    console.warn("Local hub-data.json fetch failed:", localErr);
                }
            }

            // 4. Final fallback to default template if all else fails
            if (!db) {
                db = defaultTemplate;
            }

            isLoaded = true;
            return db;
        })();

        return loadPromise;
    }

    async function saveDatabase(commitMessage = "Hospital Hub Data Update 🏥") {
        if (!db) return false;

        db.lastUpdated = new Date().toISOString();
        const jsonString = JSON.stringify(db, null, 2);

        // Instant local update
        localStorage.setItem(CACHE_KEY, jsonString);
        dispatchDataChanged();

        try {
            const body = {
                message: commitMessage,
                content: btoa(unescape(encodeURIComponent(jsonString)))
            };

            if (fileSha) {
                body.sha = fileSha;
            }

            const url = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.path}`;
            const res = await fetch(url, {
                method: "PUT",
                headers: {
                    "Authorization": `token ${GH_TOKEN}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                const responseData = await res.json();
                if (responseData && responseData.content && responseData.content.sha) {
                    fileSha = responseData.content.sha;
                }
                return true;
            } else {
                const errText = await res.text();
                console.error("GitHub save failed:", errText);
                // If sha conflict, re-fetch sha
                if (res.status === 409) {
                    await refreshFileSha();
                }
                throw new Error(errText);
            }
        } catch (err) {
            console.error("Save to GitHub error:", err);
            throw err;
        }
    }

    async function refreshFileSha() {
        try {
            const url = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.path}?t=${Date.now()}`;
            const res = await fetch(url, {
                headers: { "Authorization": `token ${GH_TOKEN}` }
            });
            if (res.ok) {
                const jsonRes = await res.json();
                fileSha = jsonRes.sha;
            }
        } catch (e) {
            console.warn("Could not refresh SHA:", e);
        }
    }

    function dispatchDataChanged() {
        try {
            window.dispatchEvent(new CustomEvent('hub:data-changed', { detail: { db } }));
        } catch (e) {}
    }

    // ============================================================
    // HOSPITAL REGISTRY & CRUD
    // ============================================================
    function getHospitals() {
        return (db && db.hospitals) ? Object.values(db.hospitals) : [];
    }

    function getHospital(id) {
        if (!db || !db.hospitals) return null;
        return db.hospitals[id] || null;
    }

    function getActiveHospitalId() {
        // Priority: 1. URL parameter (?hospital=...) 2. LocalStorage 3. Default ('iraqi')
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('hospital') || urlParams.get('hosp');
        if (fromUrl) {
            localStorage.setItem(ACTIVE_HOSP_KEY, fromUrl);
            return fromUrl;
        }

        const fromStorage = localStorage.getItem(ACTIVE_HOSP_KEY);
        if (fromStorage) {
            if (!db || !db.hospitals || db.hospitals[fromStorage]) {
                return fromStorage;
            }
        }

        if (db && db.hospitals) {
            const ids = Object.keys(db.hospitals);
            if (ids.length > 0) {
                localStorage.setItem(ACTIVE_HOSP_KEY, ids[0]);
                return ids[0];
            }
        }
        return 'iraqi';
    }

    function getActiveHospital() {
        const id = getActiveHospitalId();
        return getHospital(id);
    }

    function setActiveHospitalId(id) {
        if (!id) return false;
        localStorage.setItem(ACTIVE_HOSP_KEY, id);
        if (db && db.hospitals && db.hospitals[id]) {
            window.dispatchEvent(new CustomEvent('hub:hospital-switched', { detail: { hospitalId: id, hospital: db.hospitals[id] } }));
            return true;
        }
        return true;
    }

    async function addHospital(hospitalData) {
        if (!auth.isOwner()) {
            throw new Error('غير مصرح لك بإضافة مستشفى. يتطلب صلاحيات المالك (Owner) حصراً.');
        }

        let id = (hospitalData.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        if (!id) {
            id = 'hosp-' + Date.now().toString(36);
        }

        if (db.hospitals[id]) {
            throw new Error(`معرف المستشفى "${id}" مستخدم بالفعل.`);
        }

        // Get default specialties template from Central Global Specialties Catalog
        const globalCatalog = getGlobalSpecialties();
        const templateSpecs = (globalCatalog.length > 0 ? globalCatalog : (db.hospitals['iraqi']?.specialties || CANONICAL_SPECIALTIES)).map(s => ({
            ...s,
            enabled: true
        }));

        const newHospital = {
            id: id,
            hospitalName: hospitalData.hospitalName || 'New Teaching Hospital',
            name_ar: hospitalData.name_ar || hospitalData.hospitalName || 'مستشفى تعليمي جديد',
            location: hospitalData.location || 'Basra · Iraq',
            icon: hospitalData.icon || 'fa-hospital',
            color: hospitalData.color || '#0f766e',
            passwords: {
                owner: hospitalData.ownerPassword || 'MrjBth1996*',
                admin: hospitalData.adminPassword || 'Admin1996*',
                user: hospitalData.userPassword || '1234'
            },
            specialties: hospitalData.cloneTemplate !== false ? JSON.parse(JSON.stringify(templateSpecs)) : (hospitalData.specialties || []),
            names: hospitalData.names || [],
            schedule: hospitalData.schedule || []
        };

        db.hospitals[id] = newHospital;
        await saveDatabase(`Add Hospital: ${newHospital.hospitalName}`);
        return newHospital;
    }

    async function updateHospital(id, updates) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بتعديل بيانات المستشفى.');
        }
        if (!db.hospitals[id]) {
            throw new Error('المستشفى غير موجود.');
        }

        // If passwords are provided in updates, only OWNER can change them!
        if (updates.passwords) {
            if (!auth.canEditPasswords()) {
                // Ignore password modifications from non-owners
                delete updates.passwords;
            }
        }

        db.hospitals[id] = {
            ...db.hospitals[id],
            ...updates,
            id: id // enforce original ID
        };

        await saveDatabase(`Update Hospital: ${db.hospitals[id].hospitalName}`);
        return db.hospitals[id];
    }

    async function updateHospitalPasswords(id, newPasswords) {
        if (!auth.canEditPasswords()) {
            throw new Error('غير مصرح لك بتعديل كلمات المرور. هذه الصلاحية للمالك (Owner) فقط.');
        }
        if (!db.hospitals[id]) {
            throw new Error('المستشفى غير موجود.');
        }
        db.hospitals[id].passwords = {
            owner: newPasswords.owner || db.hospitals[id].passwords?.owner || 'MrjBth1996*',
            admin: newPasswords.admin || db.hospitals[id].passwords?.admin || 'Admin1996*',
            user: newPasswords.user || db.hospitals[id].passwords?.user || '1234'
        };
        // Keep global passwords synchronized with active/primary hospital
        if (id === 'iraqi' || id === getActiveHospitalId()) {
            db.globalPasswords = { ...db.hospitals[id].passwords };
        }
        await saveDatabase(`Update passwords for hospital: ${db.hospitals[id].hospitalName}`);
        return db.hospitals[id].passwords;
    }

    async function updateAllPasswords(newPasswords, hospitalScope = 'all') {
        if (!auth.canEditPasswords()) {
            throw new Error('غير مصرح لك بتعديل كلمات المرور. هذه الصلاحية حصرية للمالك (Owner) فقط.');
        }

        const owner = String(newPasswords?.owner || '').trim();
        const admin = String(newPasswords?.admin || '').trim();
        const user = String(newPasswords?.user || '').trim();

        if (!owner || !admin || !user) {
            throw new Error('الرجاء إدخال جميع كلمات المرور (المالك، المدير، المستخدم).');
        }

        const pwdObj = { owner, admin, user };

        // Always update global passwords
        db.globalPasswords = { ...pwdObj };

        if (hospitalScope === 'all') {
            // Update passwords across ALL hospitals in database
            if (db.hospitals) {
                Object.keys(db.hospitals).forEach(hId => {
                    db.hospitals[hId].passwords = { ...pwdObj };
                });
            }
            await saveDatabase('تحديث كلمات المرور لجميع المستشفيات والمنظومة العامة بواسطة المالك');
        } else if (db.hospitals && db.hospitals[hospitalScope]) {
            db.hospitals[hospitalScope].passwords = { ...pwdObj };
            await saveDatabase(`تحديث كلمات المرور لمستشفى ${db.hospitals[hospitalScope].name_ar || db.hospitals[hospitalScope].hospitalName}`);
        } else {
            throw new Error('المستشفى المحدد غير موجود.');
        }

        // If the logged in owner's current password changed, keep session valid
        if (auth.isOwner()) {
            auth.saveSession('owner', owner);
        }

        return pwdObj;
    }

    async function deleteHospital(id) {
        if (!auth.isOwner()) {
            throw new Error('غير مصرح لك بحذف المستشفى. هذه الصلاحية للمالك (Owner) فقط.');
        }
        if (!db.hospitals[id]) {
            throw new Error('المستشفى غير موجود.');
        }
        const name = db.hospitals[id].hospitalName;
        delete db.hospitals[id];

        // If active hospital was deleted, switch to another
        if (getActiveHospitalId() === id) {
            const remaining = Object.keys(db.hospitals);
            if (remaining.length > 0) {
                setActiveHospitalId(remaining[0]);
            }
        }

        await saveDatabase(`Delete Hospital: ${name}`);
        return true;
    }

    // ============================================================
    // DUTY & SCHEDULE MANAGEMENT
    // ============================================================
    async function exchangeDuty(hospitalId, specCode, newResidentName, targetDate = null, oldResidentName = null) {
        const hospital = getHospital(hospitalId);
        if (!hospital) throw new Error('المستشفى غير موجود');

        const date = targetDate || getMedicalDate();
        const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        if (!Array.isArray(hospital.schedule)) {
            hospital.schedule = [];
        }

        if (oldResidentName) {
            // Target specific resident slot to replace
            const idx = hospital.schedule.findIndex(s => s.specCode === specCode && s.date === date && s.name === oldResidentName);
            if (idx !== -1) {
                hospital.schedule[idx].name = newResidentName;
                hospital.schedule[idx].timestamp = ts;
            } else {
                hospital.schedule.push({
                    date: date,
                    specCode: specCode,
                    name: newResidentName,
                    timestamp: ts,
                    VisitCount: 0
                });
            }
        } else {
            // Replace existing duty for this specialty on this date
            hospital.schedule = hospital.schedule.filter(s => !(s.specCode === specCode && s.date === date));
            hospital.schedule.push({
                date: date,
                specCode: specCode,
                name: newResidentName,
                timestamp: ts,
                VisitCount: 0
            });
        }

        // Consolidate identical residents on the same day and specialty into a single 24-hour entry
        const sameDayEntries = hospital.schedule.filter(s => s.specCode === specCode && s.date === date);
        if (sameDayEntries.length > 1) {
            const uniqueNames = [...new Set(sameDayEntries.map(s => String(s.name || '').trim()))];
            if (uniqueNames.length < sameDayEntries.length) {
                // Duplicate resident detected on same day - merge them
                const keptEntries = [];
                const seenNames = new Set();
                for (const entry of sameDayEntries) {
                    const normName = String(entry.name || '').trim();
                    if (!seenNames.has(normName)) {
                        seenNames.add(normName);
                        keptEntries.push({ ...entry });
                    } else {
                        // Merge visit count into the primary entry
                        const primary = keptEntries.find(k => String(k.name || '').trim() === normName);
                        if (primary) {
                            primary.VisitCount = (primary.VisitCount || 0) + (entry.VisitCount || 0);
                        }
                    }
                }
                hospital.schedule = hospital.schedule
                    .filter(s => !(s.specCode === specCode && s.date === date))
                    .concat(keptEntries);
            }
        }

        await saveDatabase(`Duty Exchange (${hospital.hospitalName}): ${specCode} on ${date} → ${newResidentName}`);
        return true;
    }

    async function updateDuty(hospitalId, specCode, residentName, targetDate = null, oldResidentName = null) {
        return exchangeDuty(hospitalId, specCode, residentName, targetDate, oldResidentName);
    }

    async function incrementVisitCount(hospitalId, residentName) {
        const hospital = getHospital(hospitalId);
        if (!hospital) return false;

        const today = getMedicalDate();
        const entry = (hospital.schedule || []).find(s => s.date === today && s.name === residentName);
        if (entry) {
            entry.VisitCount = (entry.VisitCount || 0) + 1;
            // Debounced save
            debounceSave(`Interaction: ${residentName} in ${hospital.hospitalName}`);
            return entry.VisitCount;
        }
        return 0;
    }

    let debounceTimer = null;
    function debounceSave(message) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            saveDatabase(message).catch(console.warn);
        }, 4000);
    }

    async function resetStatistics(hospitalId, range = 'today') {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بإعادة تعيين الإحصائيات.');
        }
        const hospital = getHospital(hospitalId);
        if (!hospital) throw new Error('المستشفى غير موجود');

        const today = getMedicalDate();
        const now = new Date();
        const monthStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

        (hospital.schedule || []).forEach(entry => {
            if (range === 'today' && entry.date === today) {
                entry.VisitCount = 0;
            } else if (range === 'month') {
                const parts = entry.date.split('/');
                if (parts.length === 3 && `${parts[1]}/${parts[2]}` === monthStr) {
                    entry.VisitCount = 0;
                }
            } else if (range === 'all') {
                entry.VisitCount = 0;
            }
        });

        await saveDatabase(`Reset Stats (${hospital.hospitalName}): ${range}`);
        return true;
    }

    // ============================================================
    // CENTRAL UNIFIED SPECIALTIES CATALOG
    // ============================================================
    function getGlobalSpecialties() {
        if (db && Array.isArray(db.globalSpecialties) && db.globalSpecialties.length > 0) {
            return db.globalSpecialties;
        }
        const active = getActiveHospital();
        if (active && Array.isArray(active.specialties) && active.specialties.length > 0) {
            return active.specialties;
        }
        return JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES));
    }

    async function saveGlobalSpecialties(specs) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بتعديل التخصصات العامة. يتطلب صلاحيات المدير.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(specs)) throw new Error('بيانات التخصصات غير صالحة');
        db.globalSpecialties = specs;
        await saveDatabase('تحديث الدليل العام للتخصصات الموحدة');
        return db.globalSpecialties;
    }

    async function syncHospitalSpecialtiesWithGlobal(hospitalId) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بمزامنة التخصصات.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');
        const globals = getGlobalSpecialties();
        if (!globals || globals.length === 0) return false;

        const currentMap = new Map((hosp.specialties || []).map(s => [s.id, s]));
        hosp.specialties = globals.map(g => {
            const cur = currentMap.get(g.id);
            return {
                ...g,
                enabled: cur ? (cur.enabled !== false) : true,
                color: cur?.color || g.color || '#0f766e'
            };
        });
        await saveDatabase(`مزامنة تخصصات مستشفى ${hosp.name_ar || hosp.hospitalName} مع الدليل العام`);
        return hosp.specialties;
    }

    // ============================================================
    // ACTIVE ON-CALL RESIDENTS REAL-TIME METRICS
    // ============================================================
    function normalizeDateString(dateStr) {
        if (!dateStr) return '';
        const s = String(dateStr).trim();
        if (s.includes('-')) {
            const parts = s.split('-');
            if (parts.length === 3) {
                return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
            }
        }
        return s;
    }

    function getActiveOnCallResidentsCount(hospital, targetDate = null) {
        if (!hospital || !Array.isArray(hospital.schedule)) return 0;
        const normTarget = normalizeDateString(targetDate || getMedicalDate());
        const uniqueOnCall = new Set();
        hospital.schedule.forEach(entry => {
            const entryDate = normalizeDateString(entry.date);
            if (entryDate === normTarget) {
                const name = String(entry.name || '').trim();
                if (name && name !== 'بدون خفير' && name !== 'بدون خفر') {
                    uniqueOnCall.add(name);
                }
            }
        });
        return uniqueOnCall.size;
    }

    function getTotalActiveOnCallCount(targetDate = null) {
        if (!db || !db.hospitals) return 0;
        let total = 0;
        Object.values(db.hospitals).forEach(h => {
            total += getActiveOnCallResidentsCount(h, targetDate);
        });
        return total;
    }

    // ============================================================
    // SHARED RESIDENTS DIRECTORY & CROSS-HOSPITAL TAGGING
    // ============================================================
    function getResidents(hospitalId = null) {
        if (!db) return [];
        let list = db.residents;
        if (!Array.isArray(list)) {
            list = syncSharedResidentsFromHospitals();
        }
        if (!hospitalId || hospitalId === 'all') {
            return list;
        }
        return list.filter(r => Array.isArray(r.hospitals) && r.hospitals.includes(hospitalId));
    }

    function getResident(idOrName) {
        if (!db) return null;
        const list = getResidents();
        return list.find(r => r.id === idOrName || r.name === idOrName) || null;
    }

    function syncSharedResidentsFromHospitals() {
        if (!db || !db.hospitals) return [];
        const map = new Map();
        Object.keys(db.hospitals).forEach(hid => {
            const h = db.hospitals[hid];
            (h.names || []).forEach(n => {
                const name = (n.name || '').trim();
                if (!name) return;
                if (!map.has(name)) {
                    map.set(name, {
                        id: n.id || ('res-' + Math.random().toString(36).substr(2, 9)),
                        name: name,
                        phone: (n.phone && n.phone !== 'رقم غير متوفر') ? n.phone : '',
                        spec: n.spec || 'GS',
                        tag: n.tag || n.spec || 'GS',
                        active: n.active !== false && n.spec !== 'RESERVE',
                        hospitals: [hid]
                    });
                } else {
                    const existing = map.get(name);
                    if (!existing.hospitals.includes(hid)) {
                        existing.hospitals.push(hid);
                    }
                    if (!existing.phone && n.phone && n.phone !== 'رقم غير متوفر') {
                        existing.phone = n.phone;
                    }
                }
            });
        });
        db.residents = Array.from(map.values());
        return db.residents;
    }

    function syncHospitalsWithSharedResidents() {
        if (!db || !db.hospitals || !Array.isArray(db.residents)) return;
        Object.keys(db.hospitals).forEach(hid => {
            const hosp = db.hospitals[hid];
            const matchingResidents = db.residents.filter(r => Array.isArray(r.hospitals) && r.hospitals.includes(hid));
            hosp.names = matchingResidents.map(r => ({
                id: r.id,
                name: r.name,
                phone: r.phone || 'رقم غير متوفر',
                spec: r.spec,
                tag: r.tag,
                active: r.active,
                hospitals: r.hospitals
            }));
        });
    }

    async function addResident(residentData) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بإضافة مقيم. يتطلب صلاحيات المدير.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.residents)) {
            syncSharedResidentsFromHospitals();
        }

        const name = (residentData.name || '').trim();
        if (!name) throw new Error('الرجاء إدخال اسم المقيم');

        const formattedName = (name.startsWith('د.') || name.startsWith('د ')) ? name : `د. ${name}`;

        let hospitals = Array.isArray(residentData.hospitals) ? residentData.hospitals : [];
        if (hospitals.length === 0) {
            hospitals = [residentData.hospitalId || getActiveHospitalId()];
        }

        const newRes = {
            id: 'res-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            name: formattedName,
            phone: (residentData.phone || '').trim(),
            spec: residentData.spec || 'GS',
            tag: residentData.tag || residentData.spec || 'GS',
            active: residentData.active !== false,
            hospitals: hospitals
        };

        db.residents.push(newRes);
        syncHospitalsWithSharedResidents();

        await saveDatabase(`Add Resident: ${formattedName}`);
        return newRes;
    }

    async function updateResident(idOrName, updates) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بتعديل بيانات المقيم. يتطلب صلاحيات المدير.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.residents)) {
            syncSharedResidentsFromHospitals();
        }

        const idx = db.residents.findIndex(r => r.id === idOrName || r.name === idOrName);
        if (idx === -1) throw new Error('المقيم غير موجود');

        const current = db.residents[idx];
        const updated = {
            ...current,
            ...updates
        };

        if (updates.name) {
            const n = updates.name.trim();
            updated.name = (n.startsWith('د.') || n.startsWith('د ')) ? n : `د. ${n}`;
        }

        if (updates.hospitals) {
            updated.hospitals = Array.isArray(updates.hospitals) ? updates.hospitals : [updates.hospitals];
        }

        db.residents[idx] = updated;
        syncHospitalsWithSharedResidents();

        await saveDatabase(`Update Resident: ${updated.name}`);
        return updated;
    }

    async function deleteResident(idOrName) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بحذف المقيم. يتطلب صلاحيات المدير.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.residents)) {
            syncSharedResidentsFromHospitals();
        }

        const idx = db.residents.findIndex(r => r.id === idOrName || r.name === idOrName);
        if (idx === -1) throw new Error('المقيم غير موجود');

        const name = db.residents[idx].name;
        db.residents.splice(idx, 1);
        syncHospitalsWithSharedResidents();

        await saveDatabase(`Delete Resident: ${name}`);
        return true;
    }

    // ============================================================
    // AUTHENTICATION & MULTI-PASSWORD ROLE TRICK
    // ============================================================
    const auth = {
        login(password) {
            const pwd = String(password || '').trim();
            if (!pwd) {
                return { success: false, error: 'الرجاء إدخال كلمة المرور' };
            }

            // 1. Check global passwords first
            if (db?.globalPasswords?.owner && pwd === db.globalPasswords.owner) {
                this.saveSession('owner', pwd);
                return { success: true, role: 'owner' };
            }
            if (db?.globalPasswords?.admin && pwd === db.globalPasswords.admin) {
                this.saveSession('admin', pwd);
                return { success: true, role: 'admin' };
            }
            if (db?.globalPasswords?.user && pwd === db.globalPasswords.user) {
                this.saveSession('user', pwd);
                return { success: true, role: 'user' };
            }

            // 2. Check active hospital passwords
            const currentHosp = getActiveHospital();
            const ownerPass = currentHosp?.passwords?.owner || "MrjBth1996*";
            const adminPass = currentHosp?.passwords?.admin || "Admin1996*";
            const userPass = currentHosp?.passwords?.user || "1234";

            if (pwd === ownerPass) {
                this.saveSession('owner', pwd);
                return { success: true, role: 'owner' };
            } else if (pwd === adminPass) {
                this.saveSession('admin', pwd);
                return { success: true, role: 'admin' };
            } else if (pwd === userPass) {
                this.saveSession('user', pwd);
                return { success: true, role: 'user' };
            }

            // 3. Check across all registered hospitals
            if (db?.hospitals) {
                for (const h of Object.values(db.hospitals)) {
                    if (h.passwords?.owner && pwd === h.passwords.owner) {
                        this.saveSession('owner', pwd);
                        return { success: true, role: 'owner' };
                    }
                    if (h.passwords?.admin && pwd === h.passwords.admin) {
                        this.saveSession('admin', pwd);
                        return { success: true, role: 'admin' };
                    }
                    if (h.passwords?.user && pwd === h.passwords.user) {
                        this.saveSession('user', pwd);
                        return { success: true, role: 'user' };
                    }
                }
            }

            return { success: false, error: 'كلمة المرور غير صحيحة' };
        },

        saveSession(role, password, remember = true) {
            localStorage.setItem(SESSION_ROLE_KEY, role);
            localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
            if (remember && password) {
                localStorage.setItem(SESSION_TOKEN_KEY, btoa(password));
                localStorage.setItem(SESSION_REMEMBER_KEY, 'true');
            } else {
                localStorage.removeItem(SESSION_TOKEN_KEY);
                localStorage.removeItem(SESSION_REMEMBER_KEY);
            }
            window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role } }));
        },

        checkSession() {
            const role = localStorage.getItem(SESSION_ROLE_KEY);
            const ts = Number(localStorage.getItem(SESSION_TIMESTAMP_KEY));
            if (!role || !ts) return false;

            // 7-day expiration
            if (Date.now() - ts > 7 * 24 * 60 * 60 * 1000) {
                this.logout();
                return false;
            }
            return ['user', 'admin', 'owner'].includes(role);
        },

        getRole() {
            if (!this.checkSession()) return 'guest';
            return localStorage.getItem(SESSION_ROLE_KEY) || 'guest';
        },

        isLoggedIn() {
            return this.checkSession() && ['user', 'admin', 'owner'].includes(this.getRole());
        },

        isUser() {
            return ['user', 'admin', 'owner'].includes(this.getRole());
        },

        isOwner() {
            return this.getRole() === 'owner';
        },

        isAdmin() {
            const role = this.getRole();
            return role === 'owner' || role === 'admin';
        },

        canEditPasswords() {
            return this.getRole() === 'owner';
        },

        logout() {
            localStorage.removeItem(SESSION_ROLE_KEY);
            localStorage.removeItem(SESSION_TOKEN_KEY);
            localStorage.removeItem(SESSION_TIMESTAMP_KEY);
            localStorage.removeItem(SESSION_REMEMBER_KEY);
            window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role: 'guest' } }));
        },

        upgradeRole(password) {
            const pwd = String(password || '').trim();
            const currentHosp = getActiveHospital();
            const ownerPass = currentHosp?.passwords?.owner || db?.globalPasswords?.owner || "MrjBth1996*";
            const adminPass = currentHosp?.passwords?.admin || db?.globalPasswords?.admin || "Admin1996*";

            if (pwd === ownerPass) {
                this.saveSession('owner', pwd);
                return { success: true, role: 'owner' };
            } else if (pwd === adminPass) {
                this.saveSession('admin', pwd);
                return { success: true, role: 'admin' };
            }
            return { success: false, error: 'كلمة مرور غير صحيحة' };
        },

        upgradeToAdmin(password) {
            return this.upgradeRole(password);
        }
    };

    // ============================================================
    // THEME MANAGEMENT
    // ============================================================
    function getTheme() {
        return localStorage.getItem(THEME_KEY) || 'light';
    }

    function applyThemeToDOM(theme) {
        const isDark = theme === 'dark';
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.classList.toggle('light', !isDark);
        if (document.body) {
            document.body.classList.toggle('dark', isDark);
            document.body.classList.toggle('light', !isDark);
        }
    }

    function setTheme(theme) {
        localStorage.setItem(THEME_KEY, theme);
        applyThemeToDOM(theme);
        window.dispatchEvent(new CustomEvent('hub:theme-changed', { detail: { theme } }));
    }

    function toggleTheme() {
        const next = getTheme() === 'dark' ? 'light' : 'dark';
        setTheme(next);
        return next;
    }

    // Auto apply theme on script load and ensure body is updated when ready
    applyThemeToDOM(getTheme());
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyThemeToDOM(getTheme()));
    }

    // ============================================================
    // EXPOSE PUBLIC API
    // ============================================================
    window.Hub = {
        CONFIG,
        GH_TOKEN,
        loadDatabase,
        saveDatabase,
        getDatabase: () => db,
        getHospitals,
        getHospital,
        getActiveHospitalId,
        getActiveHospital,
        setActiveHospitalId,
        addHospital,
        updateHospital,
        updateHospitalPasswords,
        updateAllPasswords,
        deleteHospital,
        getResidents,
        getResident,
        addResident,
        updateResident,
        deleteResident,
        updateDuty,
        exchangeDuty,
        incrementVisitCount,
        resetStatistics,
        CANONICAL_SPECIALTIES,
        getGlobalSpecialties,
        saveGlobalSpecialties,
        syncHospitalSpecialtiesWithGlobal,
        getActiveOnCallResidentsCount,
        getTotalActiveOnCallCount,
        auth,
        getMedicalDate,
        getCurrentMedicalMinutes,
        getTheme,
        setTheme,
        toggleTheme
    };

})(window);

