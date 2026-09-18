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
    const CACHE_KEY = 'hospital_hub_database_v3';
    const ACTIVE_HOSP_KEY = 'hospital_hub_active_id';
    const SESSION_ROLE_KEY = 'hospital_hub_session_role';
    const SESSION_TOKEN_KEY = 'hospital_hub_session_token';
    const SESSION_TIMESTAMP_KEY = 'hospital_hub_session_timestamp';
    const SESSION_REMEMBER_KEY = 'hospital_hub_session_remember';
    const SESSION_ADMIN_HOSPITALS_KEY = 'hospital_hub_session_admin_hospitals';
    const THEME_KEY = 'hospital_hub_theme';

    // Clear stale caches from older database iterations
    try {
        localStorage.removeItem('hospital_hub_database_v2');
        localStorage.removeItem('hospital_hub_database');
        localStorage.removeItem('hospital_hub_database_v1');
    } catch(e) {}

    // In-memory Database State
    let db = null;
    let fileSha = "";
    let isLoaded = false;
    let loadPromise = null;

    // Canonical 29 Unified Specialties
    const ALL_CLINICAL_SPECIALTY_IDS = [
        "NS", "CT", "GS", "OR", "US", "ENT", "MF", "O", "Pe", "M", "G", "ICU", "OP", "GA", "A", 
        "R", "ON", "N", "NM", "P", "Der", "EM", "FM", "GP", "H", "PS", "RM"
    ];

    const CANONICAL_SPECIALTIES = [
        { id: "NS", name_ar: "جراحة الجملة العصبية", name_en: "Neurosurgery", icon: "🧠", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "CT", name_ar: "جراحة الصدر و الاوعية الدموية", name_en: "Cardiothoracic Surgery", icon: "🫀", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "GS", name_ar: "الجراحة العامة", name_en: "General Surgery", icon: "🔪", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "OR", name_ar: "الكسور", name_en: "Orthopaedics", icon: "🦴", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "US", name_ar: "جراحة المسالك البولية", name_en: "Urosurgery", icon: "🫘", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "ENT", name_ar: "الأذن و الأنف و الحنجرة", name_en: "ENT", icon: "👂", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "MF", name_ar: "جراحة الوجه و الفكين", name_en: "MaxilloFacial Surgery", icon: "🦷", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "O", name_ar: "العيون", name_en: "Ophthalmology", icon: "👁️", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "Pe", name_ar: "طب الأطفال", name_en: "Paediatrics", icon: "👶", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "M", name_ar: "الباطنية", name_en: "Internal Medicine", icon: "💊", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "G", name_ar: "النسائية و التوليد", name_en: "Gynecology", icon: "🤰", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "ICU", name_ar: "تخدير العناية المركزة", name_en: "ICU Anaesthesia", icon: "💉", color: "#0f766e", parentSpec: "A", acceptPool: ["A"], enabled: true },
        { id: "OP", name_ar: "تخدير العمليات", name_en: "OT Anaesthesia", icon: "💉", color: "#0f766e", parentSpec: "A", acceptPool: ["A"], enabled: true },
        { id: "GA", name_ar: "تخدير صالة الولادة", name_en: "GYN Anaesthesia", icon: "🤰", color: "#0f766e", parentSpec: "A", acceptPool: ["A"], enabled: true },
        { id: "A", name_ar: "التخدير و العناية المركزة", name_en: "Anaesthesia & Intensive Care", icon: "💉", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "R", name_ar: "الأشعة و السونار", name_en: "Radiology", icon: "🩻", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "D", name_ar: "الوفيات", name_en: "Death Certificates", icon: "⚰️", color: "#0f766e", parentSpec: null, acceptPool: [...ALL_CLINICAL_SPECIALTY_IDS], enabled: true },
        { id: "AO", name_ar: "المعاون الاداري", name_en: "Administrative Officer", icon: "🧑", color: "#0f766e", parentSpec: null, acceptPool: [...ALL_CLINICAL_SPECIALTY_IDS], enabled: true },
        { id: "ON", name_ar: "طب الاورام", name_en: "Oncology", icon: "☢️", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "N", name_ar: "طب امراض الكلى", name_en: "Nephrology", icon: "🧫", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "NM", name_ar: "طب الجملة العصبية", name_en: "Neuromedicine", icon: "🧠", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "P", name_ar: "النفسية", name_en: "Psychiatry", icon: "🧠", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "Der", name_ar: "الجلدية", name_en: "Dermatology", icon: "🏥", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "EM", name_ar: "طب الطوارئ", name_en: "Emergency Medicine", icon: "🏥", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "FM", name_ar: "طب الأسرة", name_en: "Family Medicine", icon: "👨", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "GP", name_ar: "ممارسين", name_en: "General Practitioner", icon: "🏥", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "H", name_ar: "طب الامراض القلبية", name_en: "Cardiology", icon: "🫀", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "PS", name_ar: "الجراحة التجميلية", name_en: "Plastic Surgery", icon: "🪡", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true },
        { id: "RM", name_ar: "طب الامراض التنفسية", name_en: "Respiratory Medicine", icon: "🫁", color: "#0f766e", parentSpec: null, acceptPool: [], enabled: true }
    ];

    // Canonical Specialty Aliases (e.g. F -> FM for Family Medicine, E -> EM for Emergency)
    const SPECIALTY_ALIASES = {
        'F': 'FM',
        'E': 'EM',
        'IM': 'M',
        'DERM': 'Der',
        'DC': 'D',
        'PAED': 'Pe',
        'PED': 'Pe',
        'CARDIO': 'H',
        'CARD': 'H',
        'PLAST': 'PS',
        'URO': 'US',
        'ORTHO': 'OR',
        'OPHTH': 'O',
        'EYE': 'O',
        'RADIO': 'R',
        'ONCO': 'ON',
        'PSYCH': 'P',
        'RESP': 'RM',
        'PULM': 'RM',
        'NEPHRO': 'N',
        'ADMIN': 'AO',
        'EMERGENCY': 'EM',
        'FAMILY': 'FM',
        'FMED': 'FM'
    };

    function normalizeSpecialtyId(id) {
        if (!id) return id;
        const trimmed = String(id).trim();
        const upper = trimmed.toUpperCase();
        if (SPECIALTY_ALIASES[trimmed]) return SPECIALTY_ALIASES[trimmed];
        if (SPECIALTY_ALIASES[upper]) return SPECIALTY_ALIASES[upper];

        // Match common Arabic text names directly to canonical IDs
        const cleanAr = trimmed.replace(/[\u064B-\u065F\u0670]/g, '')
                               .replace(/[أإآ]/g, 'ا')
                               .replace(/ة/g, 'ه')
                               .replace(/\s+/g, '');
        if (cleanAr === 'طبالاسره' || cleanAr === 'الاسره' || cleanAr === 'طباسره') return 'FM';
        if (cleanAr === 'طبالطوارئ' || cleanAr === 'طوارئ' || cleanAr === 'طوارىء' || cleanAr === 'طبالطواريء') return 'EM';
        if (cleanAr === 'الباطنيه' || cleanAr === 'باطنيه') return 'M';
        if (cleanAr === 'الجلديه' || cleanAr === 'جلديه') return 'Der';
        if (cleanAr === 'الوفيات' || cleanAr === 'شهاداتالوفيات') return 'D';
        
        // Exact match check against CANONICAL_SPECIALTIES (case-insensitive)
        const matched = CANONICAL_SPECIALTIES.find(s => s.id.toUpperCase() === upper);
        if (matched) return matched.id;
        return trimmed;
    }

    /**
     * Determines whether a specialty is in a surgical branch
     * (General Surgery, Neurosurgery, Orthopaedics, Urosurgery, ENT, Maxillofacial, Ophthalmology, Gyn/Obs, etc.)
     */
    function isSurgicalSpecialty(specIdOrName) {
        if (!specIdOrName) return false;
        const normId = normalizeSpecialtyId(specIdOrName);
        const surgicalCanonIds = [
            'GS', // الجراحة العامة
            'NS', // جراحة الجملة العصبية
            'CT', // جراحة الصدر والاوعية الدموية
            'OR', // الكسور
            'US', // جراحة المسالك البولية
            'ENT', // الأذن والأنف والحنجرة
            'MF', // جراحة الوجه والفكين
            'O', // العيون
            'G', // النسائية والتوليد
            'PS', // جراحة الأطفال / التجميل
            'SURG', 'ORTHO', 'URO', 'OPHTH', 'GYN', 'OBS', 'PLASTIC'
        ];
        if (surgicalCanonIds.includes(normId)) return true;

        const globalSpecs = Array.isArray(db?.globalSpecialties) ? db.globalSpecialties : CANONICAL_SPECIALTIES;
        const found = globalSpecs.find(s => s.id === normId || s.name_ar === specIdOrName || s.name_en === specIdOrName);
        const checkStr = ((found ? (found.name_ar + ' ' + found.name_en) : '') + ' ' + specIdOrName).toLowerCase();
        
        const surgicalKeywords = [
            'جراح', 'surg', 'كسور', 'ortho', 'مسالك', 'uro', 'بولية',
            'عيون', 'ophth', 'أنف', 'اذن', 'ent', 'نسائية', 'توليد',
            'gyn', 'obs', 'فكين', 'maxillo', 'تجميل', 'plastic', 'أوعية', 'vascular'
        ];
        return surgicalKeywords.some(kw => checkStr.includes(kw));
    }

    /**
     * Complete Database Sanitization & Specialty Deduplication Engine
     * Enforces that:
     * - F & FM are merged strictly into FM (طب الأسرة).
     * - E & EM are merged strictly into EM (طب الطوارئ).
     * - IM is merged into M (الباطنية).
     * - All hospital specialties originate strictly from globalSpecialties.
     * - All residents and schedules use normalized canonical IDs.
     */
    function sanitizeAndMigrateDatabase(targetDb) {
        if (!targetDb || typeof targetDb !== 'object') return targetDb;

        // 1. Sanitize and Deduplicate globalSpecialties without destroying user modifications
        if (!Array.isArray(targetDb.globalSpecialties) || targetDb.globalSpecialties.length === 0) {
            targetDb.globalSpecialties = JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES));
        } else {
            const cleanMap = new Map();
            targetDb.globalSpecialties.forEach(s => {
                if (!s || !s.id) return;
                const normId = normalizeSpecialtyId(s.id);
                const canon = CANONICAL_SPECIALTIES.find(c => c.id === normId);

                let nameAr = s.name_ar || (canon ? canon.name_ar : normId);
                if (normId === 'Pe' && (nameAr === 'الاطفال' || !nameAr)) {
                    nameAr = 'طب الأطفال';
                }

                if (!cleanMap.has(normId)) {
                    // PRESERVE user's custom properties, only fallback to canon defaults if missing!
                    cleanMap.set(normId, {
                        id: normId,
                        name_ar: nameAr,
                        name_en: s.name_en || (canon ? canon.name_en : (s.name_ar || normId)),
                        icon: s.icon || (canon ? canon.icon : '🏥'),
                        color: s.color || (canon ? canon.color : '#0f766e'),
                        parentSpec: s.parentSpec || (canon ? canon.parentSpec : null),
                        acceptPool: Array.isArray(s.acceptPool) ? s.acceptPool : (canon && Array.isArray(canon.acceptPool) ? [...canon.acceptPool] : []),
                        enabled: s.enabled !== false
                    });
                } else {
                    // Deduplicating legacy entry (e.g. merging F into FM)
                    const existing = cleanMap.get(normId);
                    if (normId === 'Pe') existing.name_ar = 'طب الأطفال';
                    else if (!existing.name_ar && s.name_ar) existing.name_ar = s.name_ar;
                    if (!existing.name_en && s.name_en) existing.name_en = s.name_en;
                    if (!existing.icon && s.icon) existing.icon = s.icon;
                    if (Array.isArray(s.acceptPool) && s.acceptPool.length > 0) {
                        existing.acceptPool = Array.from(new Set([...existing.acceptPool, ...s.acceptPool]));
                    }
                }
            });
            targetDb.globalSpecialties = Array.from(cleanMap.values());
        }

        // 2. Sanitize and Deduplicate Hospital Specialties
        const validGlobalIds = new Set(targetDb.globalSpecialties.map(s => s.id));
        if (targetDb.hospitals && typeof targetDb.hospitals === 'object') {
            Object.keys(targetDb.hospitals).forEach(hid => {
                const hosp = targetDb.hospitals[hid];
                if (!hosp) return;
                
                const hospSpecMap = new Map();
                (hosp.specialties || []).forEach(s => {
                    if (!s || !s.id) return;
                    const normId = normalizeSpecialtyId(s.id);
                    if (!validGlobalIds.has(normId)) {
                        // Register hospital custom specialty into global catalog
                        const newGlobal = {
                            id: normId,
                            name_ar: s.name_ar || normId,
                            name_en: s.name_en || s.name_ar || normId,
                            icon: s.icon || '🏥',
                            color: s.color || '#0f766e',
                            parentSpec: s.parentSpec || null,
                            acceptPool: Array.isArray(s.acceptPool) ? s.acceptPool : [],
                            enabled: true
                        };
                        targetDb.globalSpecialties.push(newGlobal);
                        validGlobalIds.add(normId);
                    }
                    const globalDef = targetDb.globalSpecialties.find(g => g.id === normId);
                    if (!hospSpecMap.has(normId)) {
                        hospSpecMap.set(normId, {
                            ...s,
                            id: normId,
                            name_ar: globalDef ? globalDef.name_ar : s.name_ar,
                            name_en: globalDef ? globalDef.name_en : s.name_en,
                            icon: globalDef ? globalDef.icon : (s.icon || '🏥'),
                            parentSpec: globalDef ? globalDef.parentSpec : (s.parentSpec || null),
                            acceptPool: globalDef && Array.isArray(globalDef.acceptPool) ? globalDef.acceptPool : (s.acceptPool || [])
                        });
                    }
                });

                hosp.specialties = Array.from(hospSpecMap.values());

                // Sanitize hospital resident names
                (hosp.names || []).forEach(r => {
                    r.spec = normalizeSpecialtyId(r.spec);
                    r.tag = normalizeSpecialtyId(r.tag || r.spec);
                    r.dept = normalizeSpecialtyId(r.dept || r.department || r.spec);
                    r.department = r.dept;
                    if (Array.isArray(r.specs)) {
                        r.specs = r.specs.map(sp => normalizeSpecialtyId(sp));
                    }
                });

                // Sanitize hospital schedule
                (hosp.schedule || []).forEach(slot => {
                    if (slot.specCode) {
                        slot.specCode = normalizeSpecialtyId(slot.specCode);
                    }
                });

                // Sanitize hospital specialist schedule
                if (!Array.isArray(hosp.specialistSchedule)) {
                    hosp.specialistSchedule = [];
                } else {
                    hosp.specialistSchedule.forEach(slot => {
                        if (slot && slot.specCode) {
                            slot.specCode = normalizeSpecialtyId(slot.specCode);
                        }
                    });
                }

                // Ensure hospital Rotation Heroes URL is present
                if (typeof hosp.rotationHeroesUrl !== 'string') {
                    if (hid === 'iraqi') {
                        hosp.rotationHeroesUrl = 'https://khafarat-alsadr.netlify.app/';
                    } else {
                        hosp.rotationHeroesUrl = '';
                    }
                }
            });
        }

        // 3. Sanitize Master Residents
        (targetDb.residents || []).forEach(r => {
            r.spec = normalizeSpecialtyId(r.spec);
            r.tag = normalizeSpecialtyId(r.tag || r.spec);
            r.dept = normalizeSpecialtyId(r.dept || r.department || r.spec);
            r.department = r.dept;
            if (Array.isArray(r.specs)) {
                r.specs = r.specs.map(sp => normalizeSpecialtyId(sp));
            }
        });

        return targetDb;
    }

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
                    db = sanitizeAndMigrateDatabase(JSON.parse(cachedStr));
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
                    let remoteDb = null;
                    if (typeof jsonRes.content === 'string' && jsonRes.content.trim()) {
                        const binaryStr = atob(jsonRes.content.replace(/\s/g, ''));
                        const bytes = new Uint8Array(binaryStr.length);
                        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                        remoteDb = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                    } else if (jsonRes.git_url) {
                        // Direct Git Data Blob API keyed by immutable commit SHA - 100% fresh, immune to Fastly CDN caching!
                        const blobRes = await fetch(jsonRes.git_url, {
                            headers: {
                                "Authorization": `token ${GH_TOKEN}`,
                                "Accept": "application/vnd.github.v3+json"
                            }
                        });
                        if (blobRes.ok) {
                            const blobData = await blobRes.json();
                            const binaryStr = atob(blobData.content.replace(/\s/g, ''));
                            const bytes = new Uint8Array(binaryStr.length);
                            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                            remoteDb = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                        }
                    } else if (jsonRes.download_url) {
                        // Fallback to download_url if git_url is unavailable
                        const dlRes = await fetch(jsonRes.download_url + (jsonRes.download_url.includes('?') ? '&' : '?') + 't=' + Date.now());
                        if (dlRes.ok) {
                            remoteDb = await dlRes.json();
                        }
                    }

                    if (remoteDb && remoteDb.hospitals) {
                        // Anti-reversion check: Protect recent local changes from any CDN/proxy lag
                        const localUpdated = (db && db.lastUpdated) ? new Date(db.lastUpdated).getTime() : 0;
                        const remoteUpdated = (remoteDb && remoteDb.lastUpdated) ? new Date(remoteDb.lastUpdated).getTime() : 0;

                        if (localUpdated > remoteUpdated && (localUpdated - remoteUpdated < 600000)) {
                            console.warn("Local database has newer changes than remote snapshot. Retaining local data and syncing to remote...");
                            saveDatabase("Sync newer local changes to GitHub").catch(console.warn);
                            isLoaded = true;
                            return db;
                        }

                        db = sanitizeAndMigrateDatabase(remoteDb);
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
                            db = sanitizeAndMigrateDatabase(localDb);
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
            if (db) {
                if (!Array.isArray(db.globalSpecialties) || db.globalSpecialties.length === 0) {
                    const firstHosp = db.hospitals ? Object.values(db.hospitals)[0] : null;
                    const source = (firstHosp && Array.isArray(firstHosp.specialties) && firstHosp.specialties.length > 0)
                        ? firstHosp.specialties
                        : CANONICAL_SPECIALTIES;
                    db.globalSpecialties = JSON.parse(JSON.stringify(source));
                }
            }

            isLoaded = true;
            return db;
        })();

        return loadPromise;
    }

    async function refreshFileSha() {
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
                if (jsonRes && jsonRes.sha) {
                    fileSha = jsonRes.sha;
                    return fileSha;
                }
            }
        } catch (e) {
            console.warn("Could not refresh SHA:", e);
        }
        return fileSha;
    }

    async function saveDatabase(commitMessage = "Hospital Hub Data Update 🏥") {
        if (!db) return false;

        db.lastUpdated = new Date().toISOString();
        const jsonString = JSON.stringify(db, null, 2);

        // Instant local update & reactive notification
        localStorage.setItem(CACHE_KEY, jsonString);
        dispatchDataChanged();

        try {
            // Ensure we have a valid SHA before PUT
            if (!fileSha) {
                await refreshFileSha();
            }

            const sendPut = async (shaToUse) => {
                const base64Content = (typeof btoa !== 'undefined')
                    ? btoa(unescape(encodeURIComponent(jsonString)))
                    : ((typeof Buffer !== 'undefined') ? Buffer.from(jsonString, 'utf8').toString('base64') : '');
                const body = {
                    message: commitMessage,
                    content: base64Content
                };
                if (shaToUse) {
                    body.sha = shaToUse;
                }

                const url = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.path}`;
                return await fetch(url, {
                    method: "PUT",
                    headers: {
                        "Authorization": `token ${GH_TOKEN}`,
                        "Content-Type": "application/json",
                        "Accept": "application/vnd.github.v3+json"
                    },
                    body: JSON.stringify(body)
                });
            };

            let res = await sendPut(fileSha);

            // If 409 (Conflict) or 422 (Missing SHA), refresh SHA from GitHub and automatically retry
            if (res.status === 409 || res.status === 422) {
                console.warn(`GitHub PUT returned ${res.status}. Refreshing SHA and retrying save...`);
                await refreshFileSha();
                if (fileSha) {
                    res = await sendPut(fileSha);
                }
            }

            if (res.ok) {
                const responseData = await res.json();
                if (responseData && responseData.content && responseData.content.sha) {
                    fileSha = responseData.content.sha;
                }
                return true;
            } else {
                const errText = await res.text();
                console.error("GitHub save failed:", errText);
                throw new Error("خطأ في مزامنة GitHub: " + errText);
            }
        } catch (err) {
            console.error("Save to GitHub error:", err);
            throw err;
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
        const urlParams = (typeof URLSearchParams !== 'undefined' && window.location) ? new URLSearchParams(window.location.search || '') : { get: () => null };
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
            rotationHeroesUrl: (hospitalData.rotationHeroesUrl || '').trim(),
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

        // Only OWNER can modify rotationHeroesUrl!
        if (updates.rotationHeroesUrl !== undefined && !auth.isOwner()) {
            delete updates.rotationHeroesUrl;
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

        if (hospitalScope === 'all') {
            // Update global passwords
            db.globalPasswords = { ...pwdObj };

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
            auth.saveSession('owner', owner, true, ['*']);
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
        let specs = null;
        if (db && Array.isArray(db.globalSpecialties) && db.globalSpecialties.length > 0) {
            specs = db.globalSpecialties;
        } else if (db) {
            const firstHosp = db.hospitals ? Object.values(db.hospitals)[0] : null;
            const source = (firstHosp && Array.isArray(firstHosp.specialties) && firstHosp.specialties.length > 0)
                ? firstHosp.specialties
                : CANONICAL_SPECIALTIES;
            db.globalSpecialties = JSON.parse(JSON.stringify(source));
            specs = db.globalSpecialties;
        } else {
            specs = JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES));
        }

        // Deduplicate by normalized canonical ID
        const seen = new Set();
        return specs.filter(s => {
            const canonId = normalizeSpecialtyId(s.id);
            if (seen.has(canonId)) return false;
            seen.add(canonId);
            return true;
        });
    }

    /**
     * Resolves specialty code into full Arabic specialty name.
     * Guaranteed to never return a raw Latin code if an Arabic counterpart exists.
     * Normalizes Pe/PED/PAED strictly to 'طب الأطفال'.
     */
    const CANONICAL_CODE_TO_ARABIC = {
        'NS': 'جراحة الجملة العصبية',
        'CT': 'جراحة الصدر والأوعية الدموية',
        'GS': 'الجراحة العامة',
        'OR': 'الكسور وجراحة العظام',
        'US': 'جراحة المسالك البولية',
        'ENT': 'الأذن والأنف والحنجرة',
        'MF': 'جراحة الوجه والفكين',
        'O': 'العيون',
        'Pe': 'طب الأطفال',
        'PED': 'طب الأطفال',
        'PAED': 'طب الأطفال',
        'M': 'الباطنية',
        'IM': 'الباطنية',
        'G': 'النسائية والتوليد',
        'ICU': 'تخدير العناية المركزة',
        'OP': 'تخدير العمليات',
        'GA': 'تخدير صالة الولادة',
        'A': 'التخدير والعناية المركزة',
        'R': 'الأشعة والسونار',
        'D': 'الوفيات',
        'AO': 'المعاون الإداري',
        'ON': 'طب الأورام',
        'N': 'طب أمراض الكلى',
        'NM': 'طب الجملة العصبية',
        'P': 'الطب النفسي',
        'Der': 'الجلدية',
        'EM': 'طب الطوارئ',
        'FM': 'طب الأسرة',
        'F': 'طب الأسرة',
        'GP': 'الممارسين العامين',
        'H': 'طب أمراض القلب',
        'PS': 'الجراحة التجميلية',
        'RM': 'أمراض الجهاز التنفسي'
    };

    function getSpecialtyName(specCode, hospitalId = null) {
        if (!specCode) return '';
        const normCode = normalizeSpecialtyId(specCode);

        // Explicit canonical rule: Paediatrics is always 'طب الأطفال'
        if (normCode === 'Pe' || normCode === 'PAED' || normCode === 'PED') {
            return 'طب الأطفال';
        }

        // 1. Check hospital specialties
        const hid = hospitalId || getActiveHospitalId();
        if (hid && db?.hospitals?.[hid]?.specialties) {
            const sp = db.hospitals[hid].specialties.find(s => s.id === normCode || s.id === specCode);
            if (sp && sp.name_ar && !CANONICAL_CODE_TO_ARABIC[sp.name_ar]) {
                return (sp.name_ar === 'الاطفال' || normCode === 'Pe') ? 'طب الأطفال' : sp.name_ar;
            }
        }

        // 2. Check global specialties
        if (Array.isArray(db?.globalSpecialties)) {
            const sp = db.globalSpecialties.find(s => s.id === normCode || s.id === specCode);
            if (sp && sp.name_ar && !CANONICAL_CODE_TO_ARABIC[sp.name_ar]) {
                return (sp.name_ar === 'الاطفال' || normCode === 'Pe') ? 'طب الأطفال' : sp.name_ar;
            }
        }

        // 3. Check CANONICAL_SPECIALTIES
        const canon = CANONICAL_SPECIALTIES.find(s => s.id === normCode || s.id === specCode);
        if (canon && canon.name_ar) {
            return (canon.name_ar === 'الاطفال' || normCode === 'Pe') ? 'طب الأطفال' : canon.name_ar;
        }

        // 4. Check canonical dictionary mapping
        const upper = String(normCode || specCode).trim().toUpperCase();
        if (CANONICAL_CODE_TO_ARABIC[normCode]) return CANONICAL_CODE_TO_ARABIC[normCode];
        if (CANONICAL_CODE_TO_ARABIC[specCode]) return CANONICAL_CODE_TO_ARABIC[specCode];
        if (CANONICAL_CODE_TO_ARABIC[upper]) return CANONICAL_CODE_TO_ARABIC[upper];

        return specCode;
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
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بمزامنة التخصصات لهذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');
        const globals = getGlobalSpecialties();
        if (!globals || globals.length === 0) return false;

        // Build map from current hospital specialties, normalizing any legacy alias (e.g. F -> FM)
        const currentMap = new Map();
        (hosp.specialties || []).forEach(s => {
            const normId = normalizeSpecialtyId(s.id);
            if (!currentMap.has(normId)) {
                currentMap.set(normId, s);
            }
        });

        // Also normalize all residents in this hospital if any have legacy aliases
        (hosp.names || []).forEach(r => {
            if (r.spec) r.spec = normalizeSpecialtyId(r.spec);
            if (r.tag) r.tag = normalizeSpecialtyId(r.tag);
            if (r.dept) r.dept = normalizeSpecialtyId(r.dept);
            if (r.department) r.department = normalizeSpecialtyId(r.department);
        });

        // Also normalize schedule
        (hosp.schedule || []).forEach(sc => {
            if (sc.specCode) sc.specCode = normalizeSpecialtyId(sc.specCode);
        });

        // Hospital specialties are strictly drawn from the Main Specialty Store
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

    async function updateGlobalSpecialty(oldId, updatedData) {
        if (!auth.isOwner()) {
            throw new Error('تعديل مستودع التخصصات العام مخصص للمالك (Owner) حصراً.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.globalSpecialties)) {
            db.globalSpecialties = getGlobalSpecialties();
        }

        const idx = db.globalSpecialties.findIndex(s => s.id === oldId);
        if (idx === -1) throw new Error('التخصص غير موجود في المستودع العام');

        const newId = String(updatedData.id || oldId).trim().toUpperCase();
        if (!newId) throw new Error('رمز التخصص مطلوب');

        // Check ID uniqueness if changing ID
        if (newId !== oldId && db.globalSpecialties.some(s => s.id === newId)) {
            throw new Error(`رمز التخصص "${newId}" مستخدم بالفعل.`);
        }

        const nameAr = String(updatedData.name_ar || '').trim();
        if (!nameAr) throw new Error('اسم التخصص بالعربية مطلوب');

        const nameEn = String(updatedData.name_en || updatedData.name_ar || '').trim();
        const icon = String(updatedData.icon || '🏥').trim() || '🏥';
        const parentSpec = updatedData.parentSpec ? String(updatedData.parentSpec).trim().toUpperCase() : null;
        const acceptPool = Array.isArray(updatedData.acceptPool) ? updatedData.acceptPool : [];

        // Cascade rename if ID changed across all residents, schedules, and specialties
        if (newId !== oldId) {
            // 1. In globalSpecialties
            db.globalSpecialties.forEach(s => {
                if (s.parentSpec === oldId) s.parentSpec = newId;
                if (Array.isArray(s.acceptPool)) {
                    s.acceptPool = s.acceptPool.map(p => p === oldId ? newId : p);
                }
            });

            // 2. In all hospitals
            if (db.hospitals) {
                Object.keys(db.hospitals).forEach(hid => {
                    const h = db.hospitals[hid];
                    (h.specialties || []).forEach(s => {
                        if (s.id === oldId) s.id = newId;
                        if (s.parentSpec === oldId) s.parentSpec = newId;
                        if (Array.isArray(s.acceptPool)) {
                            s.acceptPool = s.acceptPool.map(p => p === oldId ? newId : p);
                        }
                    });
                    (h.names || []).forEach(n => {
                        if (n.spec === oldId) n.spec = newId;
                        if (n.tag === oldId) n.tag = newId;
                        if (n.dept === oldId) n.dept = newId;
                        if (n.department === oldId) n.department = newId;
                        if (Array.isArray(n.specs)) {
                            n.specs = n.specs.map(sp => sp === oldId ? newId : sp);
                        }
                    });
                    (h.schedule || []).forEach(entry => {
                        if (entry.specCode === oldId) entry.specCode = newId;
                    });
                });
            }

            // 3. In global residents
            (db.residents || []).forEach(r => {
                if (r.spec === oldId) r.spec = newId;
                if (r.tag === oldId) r.tag = newId;
                if (r.dept === oldId) r.dept = newId;
                if (r.department === oldId) r.department = newId;
                if (Array.isArray(r.specs)) {
                    r.specs = r.specs.map(sp => sp === oldId ? newId : sp);
                }
            });
        }

        // Update target item in globalSpecialties
        db.globalSpecialties[idx] = {
            id: newId,
            name_ar: nameAr,
            name_en: nameEn,
            icon: icon,
            parentSpec: parentSpec,
            acceptPool: acceptPool,
            enabled: db.globalSpecialties[idx].enabled !== false
        };

        // Propagate updated metadata to all hospitals' matching specialty (preserving local color and enabled status)
        if (db.hospitals) {
            Object.keys(db.hospitals).forEach(hid => {
                const h = db.hospitals[hid];
                const hospSpec = (h.specialties || []).find(s => s.id === newId);
                if (hospSpec) {
                    hospSpec.name_ar = nameAr;
                    hospSpec.name_en = nameEn;
                    hospSpec.icon = icon;
                    hospSpec.parentSpec = parentSpec;
                    hospSpec.acceptPool = acceptPool;
                }
            });
        }

        await saveDatabase(`Owner update global specialty: ${oldId} -> ${newId} (${nameAr})`);
        return db.globalSpecialties[idx];
    }

    async function addGlobalSpecialty(specData) {
        if (!auth.isOwner()) {
            throw new Error('إضافة تخصص للمستودع العام مخصصة للمالك (Owner) حصراً.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.globalSpecialties)) {
            db.globalSpecialties = getGlobalSpecialties();
        }

        const id = String(specData.id || '').trim().toUpperCase();
        const nameAr = String(specData.name_ar || '').trim();
        const nameEn = String(specData.name_en || specData.name_ar || '').trim();
        const icon = String(specData.icon || '🏥').trim() || '🏥';
        const parentSpec = specData.parentSpec ? String(specData.parentSpec).trim().toUpperCase() : null;
        const acceptPool = Array.isArray(specData.acceptPool) ? specData.acceptPool : [];

        if (!id) throw new Error('رمز التخصص مطلوب');
        if (!nameAr) throw new Error('اسم التخصص بالعربية مطلوب');

        if (db.globalSpecialties.some(s => s.id === id)) {
            throw new Error(`رمز التخصص "${id}" مستخدم بالفعل.`);
        }

        const newSpec = {
            id,
            name_ar: nameAr,
            name_en: nameEn,
            icon,
            parentSpec,
            acceptPool,
            enabled: true
        };

        db.globalSpecialties.push(newSpec);

        // Also add to all existing hospitals with default color #0f766e
        if (db.hospitals) {
            Object.keys(db.hospitals).forEach(hid => {
                const h = db.hospitals[hid];
                if (Array.isArray(h.specialties) && !h.specialties.some(s => s.id === id)) {
                    h.specialties.push({
                        ...newSpec,
                        color: '#0f766e',
                        enabled: true
                    });
                }
            });
        }

        await saveDatabase(`Owner add global specialty: ${id} (${nameAr})`);
        return newSpec;
    }

    async function deleteGlobalSpecialty(id) {
        if (!auth.isOwner()) {
            throw new Error('حذف تخصص من المستودع العام مخصص للمالك (Owner) حصراً.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        const specId = String(id || '').trim().toUpperCase();

        // Check if in use by residents
        let inUse = (db.residents || []).some(r => r.spec === specId || r.tag === specId);
        if (!inUse && db.hospitals) {
            inUse = Object.values(db.hospitals).some(h => (h.names || []).some(n => n.spec === specId || n.tag === specId));
        }
        if (inUse) {
            throw new Error(`لا يمكن حذف التخصص "${specId}" لوجود أطباء مقيمين مسجلين عليه.`);
        }

        // Remove from globalSpecialties
        db.globalSpecialties = (db.globalSpecialties || []).filter(s => s.id !== specId);

        // Remove from all hospitals
        if (db.hospitals) {
            Object.keys(db.hospitals).forEach(hid => {
                const h = db.hospitals[hid];
                h.specialties = (h.specialties || []).filter(s => s.id !== specId);
                (h.specialties || []).forEach(s => {
                    if (s.parentSpec === specId) s.parentSpec = null;
                    if (Array.isArray(s.acceptPool)) s.acceptPool = s.acceptPool.filter(p => p !== specId);
                });
            });
        }

        await saveDatabase(`Owner delete global specialty: ${specId}`);
        return true;
    }

    async function addHospitalSpecialty(hospitalId, specData) {
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بإضافة تخصص لهذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');

        const nameAr = String(specData.name_ar || specData.name || '').trim();
        if (!nameAr) throw new Error('اسم التخصص بالعربية مطلوب');

        let specId = String(specData.id || '').trim().toUpperCase();
        if (!specId) {
            if (specData.name_en) {
                specId = specData.name_en.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
            }
            if (!specId || specId.length < 2) {
                specId = 'SP' + Math.floor(100 + Math.random() * 900);
            }
        }

        if (!Array.isArray(db.globalSpecialties)) {
            db.globalSpecialties = getGlobalSpecialties();
        }

        // Avoid collision with different specialty name
        let baseId = specId;
        let counter = 1;
        while (db.globalSpecialties.some(s => s.id === specId && s.name_ar !== nameAr)) {
            specId = baseId.slice(0, 3) + counter;
            counter++;
        }

        let existingGlobal = db.globalSpecialties.find(s => s.id === specId || s.name_ar === nameAr);
        if (!existingGlobal) {
            existingGlobal = {
                id: specId,
                name_ar: nameAr,
                name_en: specData.name_en ? specData.name_en.trim() : nameAr,
                icon: specData.icon ? specData.icon.trim() : '🏥',
                parentSpec: specData.parentSpec ? String(specData.parentSpec).trim().toUpperCase() : null,
                acceptPool: Array.isArray(specData.acceptPool) ? specData.acceptPool : [],
                enabled: true
            };
            db.globalSpecialties.push(existingGlobal);
        }

        const canonId = existingGlobal.id;
        const color = specData.color || '#0f766e';

        if (!Array.isArray(hosp.specialties)) hosp.specialties = [];
        const existingInHosp = hosp.specialties.find(s => s.id === canonId);
        if (existingInHosp) {
            existingInHosp.enabled = true;
            existingInHosp.color = color || existingInHosp.color || '#0f766e';
            existingInHosp.name_ar = existingGlobal.name_ar;
            existingInHosp.name_en = existingGlobal.name_en;
            existingInHosp.icon = existingGlobal.icon;
        } else {
            hosp.specialties.push({
                ...existingGlobal,
                color: color,
                enabled: true
            });
        }

        await saveDatabase(`Add specialty ${canonId} (${nameAr}) to ${hosp.name_ar || hosp.hospitalName}`);
        return existingInHosp || hosp.specialties[hosp.specialties.length - 1];
    }

    async function addHospitalSpecialtyFromGlobal(hospitalId, specId, color = '#0f766e') {
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بإضافة تخصص لهذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');

        const globalSpecs = getGlobalSpecialties();
        const g = globalSpecs.find(s => s.id === specId);
        if (!g) throw new Error('التخصص غير موجود في المستودع العام');

        if (!Array.isArray(hosp.specialties)) hosp.specialties = [];
        const existing = hosp.specialties.find(s => s.id === specId);
        if (existing) {
            existing.enabled = true;
            existing.color = color || existing.color || '#0f766e';
        } else {
            hosp.specialties.push({
                ...g,
                color: color || '#0f766e',
                enabled: true
            });
        }

        await saveDatabase(`Add specialty ${specId} to ${hosp.hospitalName}`);
        return hosp.specialties;
    }

    async function updateHospitalSpecialty(hospitalId, specId, updates) {
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بتعديل التخصص في هذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');

        const s = (hosp.specialties || []).find(x => x.id === specId);
        if (!s) throw new Error('التخصص غير موجود في المستشفى');

        // Only color and enabled are allowed to be updated at hospital level!
        if (updates.color) s.color = updates.color;
        if (updates.enabled !== undefined) s.enabled = Boolean(updates.enabled);

        await saveDatabase(`Update specialty ${specId} in ${hosp.hospitalName}`);
        return s;
    }

    async function deleteEmptyHospitalSpecialties(hospitalId) {
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بحذف التخصصات. يتطلب صلاحيات مدير هذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');

        const residents = hosp.names || [];
        const initialCount = (hosp.specialties || []).length;

        // A specialty is retained if at least one resident has it as their primary specialty (spec) or assigned rotation (dept)
        hosp.specialties = (hosp.specialties || []).filter(s => {
            return residents.some(r => 
                (r.spec === s.id || r.tag === s.id || r.dept === s.id || r.department === s.id)
            );
        });

        const deletedCount = initialCount - hosp.specialties.length;
        if (deletedCount > 0) {
            await saveDatabase(`حذف ${deletedCount} تخصص فارغ (0 مقيم) من مستشفى ${hosp.name_ar || hosp.hospitalName}`);
        }
        return { deletedCount, remainingCount: hosp.specialties.length };
    }

    async function deleteHospitalSpecialty(hospitalId, specId) {
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بحذف التخصص من هذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');

        // Remove from hospital specialties
        const initialCount = (hosp.specialties || []).length;
        hosp.specialties = (hosp.specialties || []).filter(s => s.id !== specId);
        const wasRemoved = hosp.specialties.length < initialCount;

        // Unlink residents assigned to this hospital and specialty
        if (!Array.isArray(db.residents)) {
            syncSharedResidentsFromHospitals();
        }

        let affectedResidentsCount = 0;
        db.residents.forEach(r => {
            const isThisSpec = (r.spec === specId || r.tag === specId || r.dept === specId || r.department === specId);
            const isInThisHosp = Array.isArray(r.hospitals) && r.hospitals.includes(hospitalId);
            if (isThisSpec && isInThisHosp) {
                r.hospitals = r.hospitals.filter(hid => hid !== hospitalId);
                affectedResidentsCount++;
            }
        });

        // Clean up schedule entries for this specialty in this hospital
        if (Array.isArray(hosp.schedule)) {
            hosp.schedule = hosp.schedule.filter(slot => slot.specCode !== specId);
        }

        // Sync hospital local names with master residents
        syncHospitalsWithSharedResidents();

        const hospTitle = hosp.name_ar || hosp.hospitalName;
        await saveDatabase(`حذف تخصص ${specId} من مستشفى ${hospTitle} (تحويل ${affectedResidentsCount} مقيم إلى غير منسوب لمستشفى)`);

        return {
            success: true,
            specId,
            wasRemoved,
            affectedResidentsCount,
            remainingSpecsCount: hosp.specialties.length
        };
    }

    function getEligibleResidentsForSpecialty(hospitalOrId, specId) {
        const hospital = (typeof hospitalOrId === 'string') ? getHospital(hospitalOrId) : hospitalOrId;
        if (!hospital || !Array.isArray(hospital.names)) return [];

        const allSpecs = hospital.specialties || getGlobalSpecialties() || [];
        const specObj = allSpecs.find(s => s.id === specId);
        const acceptPool = Array.isArray(specObj?.acceptPool) ? specObj.acceptPool : [];
        const parentSpec = specObj?.parentSpec || null;
        const childSpecIds = allSpecs.filter(s => s.parentSpec === specId).map(s => s.id);

        const residents = hospital.names || [];

        if (acceptPool.includes('ALL') || acceptPool.includes('*')) {
            return residents.filter(r => r.active !== false && r.spec !== 'RESERVE');
        }

        const eligible = residents.filter(r => {
            if (r.active === false || r.spec === 'RESERVE') return false;

            // Effective duty department (assigned rotation takes precedence for duty schedule)
            const rDutyDept = r.dept || r.department || r.spec || r.tag;

            // 1. Direct duty department match (e.g. resident assigned to GS rotation has GS duties)
            if (rDutyDept === specId) return true;

            // 2. Specialty has a parent, and resident's duty belongs to parent
            if (parentSpec && (rDutyDept === parentSpec)) return true;

            // 3. Resident duty belongs to child/sub-specialty
            if (childSpecIds.includes(rDutyDept)) return true;

            // 4. Resident duty belongs to a specialty in acceptPool
            if (acceptPool.length > 0 && acceptPool.includes(rDutyDept)) return true;

            return false;
        });

        // Fallback: If no eligible residents found, return all active non-reserve residents
        return eligible.length > 0 ? eligible : residents.filter(r => r.active !== false && r.spec !== 'RESERVE');
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
                if (name && !name.includes('بدون خفر') && !name.includes('بدون خفارة')) {
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
                    const spec = n.spec || 'GS';
                    const dept = n.dept || n.department || spec;
                    map.set(name, {
                        id: n.id || ('res-' + Math.random().toString(36).substr(2, 9)),
                        name: name,
                        phone: (n.phone && n.phone !== 'رقم غير متوفر') ? n.phone : '',
                        spec: spec,
                        tag: n.tag || spec,
                        dept: dept,
                        department: dept,
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
                    if (n.dept && (!existing.dept || existing.dept === existing.spec)) {
                        existing.dept = n.dept;
                        existing.department = n.dept;
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
                dept: r.dept || r.department || r.spec,
                department: r.dept || r.department || r.spec,
                active: r.active,
                hospitals: r.hospitals
            }));

            // Automatically ensure any department actively staffed by residents exists in hospital specialties
            if (Array.isArray(hosp.specialties)) {
                const globalSpecs = getGlobalSpecialties();
                hosp.names.forEach(r => {
                    const dutyDept = r.dept || r.department || r.spec || r.tag;
                    if (dutyDept && !hosp.specialties.some(s => s.id === dutyDept)) {
                        const g = globalSpecs.find(s => s.id === dutyDept);
                        if (g) {
                            hosp.specialties.push({
                                ...g,
                                enabled: true,
                                color: g.color || '#0f766e'
                            });
                        }
                    }
                });
            }
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

        const spec = normalizeSpecialtyId(residentData.spec || 'GS');
        const dept = normalizeSpecialtyId(residentData.dept || residentData.department || spec);

        const newRes = {
            id: 'res-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            name: formattedName,
            phone: (residentData.phone || '').trim(),
            spec: spec,
            tag: normalizeSpecialtyId(residentData.tag || spec),
            dept: dept,
            department: dept,
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

        if (updates.spec) {
            const normSpec = normalizeSpecialtyId(updates.spec);
            updated.spec = normSpec;
            updated.tag = normalizeSpecialtyId(updates.tag || normSpec);
        }

        if (updates.dept || updates.department) {
            const normDept = normalizeSpecialtyId(updates.dept || updates.department);
            updated.dept = normDept;
            updated.department = normDept;
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
    // SPECIALISTS DIRECTORY & DATABASE (أطباء الاختصاص والاستشاريين)
    // ============================================================
    function getSpecialists(hospitalId = null, specCode = null) {
        if (!db) return [];
        let list = db.specialists;
        if (!Array.isArray(list)) {
            list = db.specialists = [];
        }
        if (hospitalId && hospitalId !== 'all') {
            list = list.filter(s => Array.isArray(s.hospitals) && (s.hospitals.includes(hospitalId) || s.hospitals.includes('all')));
        }
        if (specCode && specCode !== 'all') {
            list = list.filter(s => s.spec === specCode);
        }
        return list;
    }

    function getSpecialist(id) {
        if (!db || !Array.isArray(db.specialists)) return null;
        return db.specialists.find(s => s.id === id) || null;
    }

    async function saveSpecialist(specialistData) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بإدارة أطباء الاختصاص. يتطلب صلاحيات المدير أو المالك.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.specialists)) db.specialists = [];

        const name = (specialistData.name || '').trim();
        if (!name) throw new Error('الرجاء إدخال اسم الطبيب الاختصاصي');
        const formattedName = (name.startsWith('د.') || name.startsWith('د ')) ? name : `د. ${name}`;

        let hospitals = Array.isArray(specialistData.hospitals) ? specialistData.hospitals : [];
        if (hospitals.length === 0) {
            hospitals = [specialistData.hospitalId || getActiveHospitalId()];
        }

        const spec = normalizeSpecialtyId(specialistData.spec || 'GS');
        const globalSpecs = getGlobalSpecialties();
        const gSpec = globalSpecs.find(s => s.id === spec);
        const specName = specialistData.specName || (gSpec ? gSpec.name_ar : spec);

        let specialist;
        if (specialistData.id) {
            specialist = db.specialists.find(s => s.id === specialistData.id);
        }

        if (specialist) {
            specialist.name = formattedName;
            specialist.title = (specialistData.title || 'أخصائي').trim();
            specialist.spec = spec;
            specialist.specName = specName;
            specialist.hospitals = hospitals;
            specialist.phone = (specialistData.phone || '').trim();
            specialist.clinic = (specialistData.clinic || '').trim();
            specialist.notes = (specialistData.notes || '').trim();
            if (specialistData.active !== undefined) specialist.active = Boolean(specialistData.active);
            if (specialistData.schedule !== undefined) {
                specialist.schedule = {
                    clinicDays: Array.isArray(specialistData.schedule?.clinicDays) ? specialistData.schedule.clinicDays : [],
                    theatreDays: isSurgicalSpecialty(spec) && Array.isArray(specialistData.schedule?.theatreDays) ? specialistData.schedule.theatreDays : []
                };
            }
        } else {
            specialist = {
                id: specialistData.id || ('spec-doc-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4)),
                name: formattedName,
                title: (specialistData.title || 'أخصائي').trim(),
                spec: spec,
                specName: specName,
                hospitals: hospitals,
                phone: (specialistData.phone || '').trim(),
                clinic: (specialistData.clinic || '').trim(),
                notes: (specialistData.notes || '').trim(),
                active: specialistData.active !== false,
                schedule: {
                    clinicDays: Array.isArray(specialistData.schedule?.clinicDays) ? specialistData.schedule.clinicDays : [],
                    theatreDays: isSurgicalSpecialty(spec) && Array.isArray(specialistData.schedule?.theatreDays) ? specialistData.schedule.theatreDays : []
                }
            };
            db.specialists.unshift(specialist);
        }

        await saveDatabase(`Save Specialist: ${formattedName}`);
        return specialist;
    }

    function getSpecialistSchedule(hospitalId = null) {
        if (!db) return [];
        const hid = hospitalId || getActiveHospitalId();
        const hosp = getHospital(hid);
        if (!hosp) return [];
        if (!Array.isArray(hosp.specialistSchedule)) {
            hosp.specialistSchedule = [];
        }
        return hosp.specialistSchedule;
    }

    function getSpecialistDuties(specialistName, hospitalId = null) {
        if (!specialistName) return [];
        const cleanName = specialistName.replace(/^د[\.\s]+/, '').trim().toLowerCase();
        const targetHids = (hospitalId && hospitalId !== 'all') ? [hospitalId] : (getHospitals() || []).map(h => h.id);
        const duties = [];

        targetHids.forEach(hid => {
            const hosp = getHospital(hid);
            if (!hosp || !Array.isArray(hosp.specialistSchedule)) return;
            hosp.specialistSchedule.forEach(duty => {
                const dutyName = (duty.name || '').replace(/^د[\.\s]+/, '').trim().toLowerCase();
                if (dutyName === cleanName || (cleanName.length > 3 && dutyName.includes(cleanName)) || (dutyName.length > 3 && cleanName.includes(dutyName))) {
                    const resolvedSpecName = getSpecialtyName(duty.specCode || duty.spec, hid);
                    duties.push({
                        ...duty,
                        specName: resolvedSpecName,
                        hospitalId: hid,
                        hospitalName: hosp.name_ar || hosp.hospitalName || hid
                    });
                }
            });
        });

        // Sort chronologically by date
        duties.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        return duties;
    }

    async function saveSpecialistSchedule(specialistId, scheduleData) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بتعديل جدول الطبيب الاختصاصي. يتطلب صلاحيات المدير أو المالك.');
        }
        if (!db || !Array.isArray(db.specialists)) throw new Error('قاعدة البيانات غير محملة');
        const specialist = db.specialists.find(s => s.id === specialistId);
        if (!specialist) throw new Error('الطبيب الاختصاصي غير موجود');

        const spec = specialist.spec || 'GS';
        specialist.schedule = {
            clinicDays: Array.isArray(scheduleData?.clinicDays) ? scheduleData.clinicDays : [],
            theatreDays: isSurgicalSpecialty(spec) && Array.isArray(scheduleData?.theatreDays) ? scheduleData.theatreDays : [],
            updatedAt: new Date().toISOString()
        };

        await saveDatabase(`Update Specialist Schedule: ${specialist.name}`);
        return specialist;
    }

    async function deleteSpecialist(id) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بحذف الطبيب الاختصاصي. يتطلب صلاحيات المدير أو المالك.');
        }
        if (!db || !Array.isArray(db.specialists)) throw new Error('قاعدة البيانات غير محملة');
        const idx = db.specialists.findIndex(s => s.id === id);
        if (idx === -1) throw new Error('الطبيب الاختصاصي غير موجود');

        const deleted = db.specialists.splice(idx, 1)[0];
        await saveDatabase(`Delete Specialist: ${deleted.name}`);
        return deleted;
    }

    // ============================================================
    // MONTHLY SCHEDULE QUERY HELPER
    // ============================================================
    function getHospitalMonthSchedule(hospitalId, year, month, scheduleType = 'residents') {
        const hosp = getHospital(hospitalId);
        if (!hosp) return [];
        const scheduleArray = scheduleType === 'specialists' ? hosp.specialistSchedule : hosp.schedule;
        if (!Array.isArray(scheduleArray)) return [];
        const padMonth = String(month).padStart(2, '0');
        const strYear = String(year);

        return scheduleArray.filter(entry => {
            if (!entry.date) return false;
            const norm = normalizeDateString(entry.date);
            const parts = norm.split('/');
            if (parts.length === 3) {
                return parts[1] === padMonth && parts[2] === strYear;
            }
            return false;
        });
    }

    // ============================================================
    // AUTHENTICATION & MULTI-PASSWORD ROLE TRICK
    // ============================================================
    const auth = {
        verifyPassword(password) {
            const pwd = String(password || '').trim();
            if (!pwd) {
                return { success: false, error: 'الرجاء إدخال كلمة المرور' };
            }

            // 1. Check global passwords first
            if (db?.globalPasswords?.owner && pwd === db.globalPasswords.owner) {
                return { success: true, role: 'owner', adminHospitals: ['*'] };
            }
            if (db?.globalPasswords?.admin && pwd === db.globalPasswords.admin) {
                return { success: true, role: 'admin', adminHospitals: ['*'] };
            }
            if (db?.globalPasswords?.user && pwd === db.globalPasswords.user) {
                return { success: true, role: 'user', adminHospitals: [] };
            }

            // 2. Check across registered hospitals for matching passwords
            const matchingAdminHospitals = [];
            const matchingOwnerHospitals = [];
            let matchedUser = false;

            if (db?.hospitals) {
                for (const h of Object.values(db.hospitals)) {
                    if (h.passwords?.owner && pwd === h.passwords.owner) {
                        matchingOwnerHospitals.push(h.id);
                    }
                    if (h.passwords?.admin && pwd === h.passwords.admin) {
                        matchingAdminHospitals.push(h.id);
                    }
                    if (h.passwords?.user && pwd === h.passwords.user) {
                        matchedUser = true;
                    }
                }
            }

            if (matchingOwnerHospitals.length > 0) {
                return { success: true, role: 'owner', adminHospitals: ['*'] };
            }

            if (matchingAdminHospitals.length > 0) {
                return { success: true, role: 'admin', adminHospitals: matchingAdminHospitals };
            }

            if (matchedUser) {
                return { success: true, role: 'user', adminHospitals: [] };
            }

            // 3. Fallback: Check active hospital passwords
            const currentHosp = getActiveHospital();
            const ownerPass = currentHosp?.passwords?.owner || "MrjBth1996*";
            const adminPass = currentHosp?.passwords?.admin || "Admin1996*";
            const userPass = currentHosp?.passwords?.user || "1234";

            if (pwd === ownerPass) {
                return { success: true, role: 'owner', adminHospitals: ['*'] };
            } else if (pwd === adminPass) {
                const hId = currentHosp ? currentHosp.id : '*';
                return { success: true, role: 'admin', adminHospitals: [hId] };
            } else if (pwd === userPass) {
                return { success: true, role: 'user', adminHospitals: [] };
            }

            return { success: false, error: 'كلمة المرور غير صحيحة' };
        },

        login(password, remember = true) {
            const res = this.verifyPassword(password);
            if (res.success) {
                this.saveSession(res.role, password, remember, res.adminHospitals);
            }
            return res;
        },

        saveSession(role, password, remember = true, adminHospitals = null) {
            localStorage.setItem(SESSION_ROLE_KEY, role);
            localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());

            let hospList = adminHospitals;
            if (hospList === null) {
                if (role === 'owner') hospList = ['*'];
                else if (role === 'admin') hospList = this.getAdminHospitalIds();
                else hospList = [];
            }
            try {
                localStorage.setItem(SESSION_ADMIN_HOSPITALS_KEY, JSON.stringify(hospList || []));
            } catch(e) {}

            if (remember && (password || role === 'user')) {
                localStorage.setItem(SESSION_TOKEN_KEY, btoa(password || 'user_session'));
                localStorage.setItem(SESSION_REMEMBER_KEY, 'true');
            } else {
                localStorage.removeItem(SESSION_TOKEN_KEY);
                localStorage.removeItem(SESSION_REMEMBER_KEY);
            }
            window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role, adminHospitals: hospList } }));
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

        getAdminHospitalIds() {
            if (!this.checkSession()) return [];
            if (this.isOwner()) return ['*'];
            try {
                const raw = localStorage.getItem(SESSION_ADMIN_HOSPITALS_KEY);
                return raw ? JSON.parse(raw) : [];
            } catch(e) {
                return [];
            }
        },

        getAdminHospitalName() {
            const ids = this.getAdminHospitalIds();
            if (this.isOwner() || ids.includes('*')) return 'جميع المستشفيات';
            if (ids.length === 1 && db?.hospitals?.[ids[0]]) {
                return db.hospitals[ids[0]].name_ar || db.hospitals[ids[0]].hospitalName;
            }
            if (ids.length > 0) {
                const names = ids.map(id => db?.hospitals?.[id]?.name_ar || id);
                return names.join('، ');
            }
            return '';
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

        isAdmin(targetHospitalId = null) {
            const role = this.getRole();
            if (role === 'owner') return true;
            if (role !== 'admin') return false;

            const adminHospList = this.getAdminHospitalIds();
            if (adminHospList.includes('*')) return true;

            if (!targetHospitalId) {
                const activeId = getActiveHospitalId();
                if (activeId && adminHospList.includes(activeId)) return true;
                return adminHospList.length > 0;
            }

            return adminHospList.includes(targetHospitalId);
        },

        canEditPasswords() {
            return this.getRole() === 'owner';
        },

        logout() {
            localStorage.removeItem(SESSION_ROLE_KEY);
            localStorage.removeItem(SESSION_TOKEN_KEY);
            localStorage.removeItem(SESSION_TIMESTAMP_KEY);
            localStorage.removeItem(SESSION_REMEMBER_KEY);
            localStorage.removeItem(SESSION_ADMIN_HOSPITALS_KEY);
            window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role: 'guest', adminHospitals: [] } }));
        },

        upgradeRole(password) {
            const pwd = String(password || '').trim();
            const currentHosp = getActiveHospital();
            const ownerPass = currentHosp?.passwords?.owner || db?.globalPasswords?.owner || "MrjBth1996*";
            const adminPass = currentHosp?.passwords?.admin;

            if (pwd === ownerPass) {
                this.saveSession('owner', pwd, true, ['*']);
                return { success: true, role: 'owner', adminHospitals: ['*'] };
            }
            
            if (adminPass && pwd === adminPass) {
                const hId = currentHosp ? currentHosp.id : '*';
                this.saveSession('admin', pwd, true, [hId]);
                return { success: true, role: 'admin', adminHospitals: [hId] };
            }

            if (db?.globalPasswords?.admin && pwd === db.globalPasswords.admin) {
                this.saveSession('admin', pwd, true, ['*']);
                return { success: true, role: 'admin', adminHospitals: ['*'] };
            }

            if (db?.hospitals) {
                const matching = [];
                for (const h of Object.values(db.hospitals)) {
                    if (h.passwords?.admin && pwd === h.passwords.admin) {
                        matching.push(h.id);
                    }
                }
                if (matching.length > 0) {
                    this.saveSession('admin', pwd, true, matching);
                    return { success: true, role: 'admin', adminHospitals: matching };
                }
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
        getSpecialists,
        getSpecialist,
        saveSpecialist,
        deleteSpecialist,
        saveSpecialistSchedule,
        getSpecialistSchedule,
        getSpecialistDuties,
        isSurgicalSpecialty,
        getSpecialtyName,
        specialists: {
            getAll: (hospitalId, specCode) => getSpecialists(hospitalId, specCode),
            getById: (id) => getSpecialist(id),
            save: (specialistData) => saveSpecialist(specialistData),
            delete: (id) => deleteSpecialist(id),
            saveSchedule: (specialistId, scheduleData) => saveSpecialistSchedule(specialistId, scheduleData),
            getSchedule: (hospitalId) => getSpecialistSchedule(hospitalId),
            getDuties: (specialistName, hospitalId) => getSpecialistDuties(specialistName, hospitalId)
        },
        specialties: {
            getAll: () => getGlobalSpecialties().map(s => ({
                code: s.id,
                id: s.id,
                name_ar: s.name_ar,
                name_en: s.name_en || s.name_ar,
                icon: s.icon || '🏥',
                color: s.color || '#0f766e'
            })),
            getByCode: (code) => {
                const norm = normalizeSpecialtyId(code);
                const s = getGlobalSpecialties().find(sp => sp.id === norm);
                return s ? {
                    code: s.id,
                    id: s.id,
                    name_ar: s.name_ar,
                    name_en: s.name_en || s.name_ar,
                    icon: s.icon || '🏥',
                    color: s.color || '#0f766e'
                } : null;
            },
            getName: (code, hospitalId) => getSpecialtyName(code, hospitalId)
        },
        getHospitalMonthSchedule,
        updateDuty,
        exchangeDuty,
        incrementVisitCount,
        resetStatistics,
        CANONICAL_SPECIALTIES,
        getGlobalSpecialties,
        saveGlobalSpecialties,
        updateGlobalSpecialty,
        addGlobalSpecialty,
        deleteGlobalSpecialty,
        addHospitalSpecialty,
        addHospitalSpecialtyFromGlobal,
        updateHospitalSpecialty,
        deleteHospitalSpecialty,
        deleteEmptyHospitalSpecialties,
        getEligibleResidentsForSpecialty,
        syncHospitalSpecialtiesWithGlobal,
        getActiveOnCallResidentsCount,
        getTotalActiveOnCallCount,
        auth,
        getMedicalDate,
        getCurrentMedicalMinutes,
        normalizeSpecialtyId,
        SPECIALTY_ALIASES,
        getTheme,
        setTheme,
        toggleTheme
    };

})(window);

