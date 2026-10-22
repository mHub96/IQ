/**
 * HOSPITAL MAIN HUB — CORE DATA & AUTH ENGINE
 * Unifies all hospital operations, dynamic hospital creation,
 * GitHub REST API synchronization, and role-based authentication.
 */

(function(window) {
    'use strict';

    // ============================================================
    // CLOUDFLARE API CONFIGURATION
    // ============================================================
    // Data lives in Cloudflare D1 behind the hosp-hub-api Worker (see worker/). The live site
    // (mhub96.github.io/IQ) uses hosp-hub-api; the test site (hosp-hub-beta) uses hosp-hub-api-beta,
    // so new server code can be tried there first (both share the same database).
    // `localStorage.hub_api_base` overrides the endpoint for local testing.
    const DEFAULT_API_BASE = /^hosp-hub-beta\./.test(location.hostname)
        ? 'https://hosp-hub-api-beta.mrjuniversity.workers.dev'
        : 'https://hosp-hub-api.mrjuniversity.workers.dev';
    const CONFIG = {
        apiBase: (() => {
            try { return (localStorage.getItem('hub_api_base') || DEFAULT_API_BASE).replace(/\/+$/, ''); }
            catch (e) { return DEFAULT_API_BASE; }
        })()
    };
    const HubSync = window.HubSync;
    if (!HubSync) {
        console.error('hub-sync.js must be loaded before hub-core.js');
    }

    // Storage Keys
    const CACHE_KEY = 'hospital_hub_database_v3';
    const ACTIVE_HOSP_KEY = 'hospital_hub_active_id';
    const SESSION_ROLE_KEY = 'hospital_hub_session_role';
    const SESSION_TOKEN_KEY = 'hospital_hub_session_token';
    const SESSION_TIMESTAMP_KEY = 'hospital_hub_session_timestamp';
    const SESSION_REMEMBER_KEY = 'hospital_hub_session_remember';
    const SESSION_ADMIN_HOSPITALS_KEY = 'hospital_hub_session_admin_hospitals';
    const API_TOKEN_KEY = 'hospital_hub_api_token';
    const ACCOUNT_KEY = 'hospital_hub_account';
    const ER_SYNC_KEY = 'hospital_hub_er_synced';
    const THEME_KEY = 'hospital_hub_theme';

    // ============================================================
    // ADMINISTRATIVE AFFAIRS DIVISION MODE
    // ============================================================
    // Every hospital has an Administrative Affairs division (الشؤون الإدارية) with its own job titles,
    // officers, daily roster and monthly schedule, in the same shape as the doctors' data. A page
    // runs on one division instead of the doctors' data when the signed-in account is one of the
    // division's officers (always their own hospital), or when the address carries ?aa=<hospital>
    // and the user is the owner or an admin of that hospital. The division's data is loaded from
    // /api/aa/* and cached apart from the doctors' data.
    const AA_ROLES = ['aa_user', 'aa_admin'];
    const AA_MIRROR_PREFIX = 'aa__';
    const AA = (() => {
        try {
            const role = localStorage.getItem(SESSION_ROLE_KEY);
            if (AA_ROLES.includes(role)) {
                const acc = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null');
                return acc && acc.hosp ? String(acc.hosp) : null;
            }
            const wanted = new URLSearchParams(location.search || '').get('aa');
            if (!wanted || !/^[\w-]{1,48}$/.test(wanted)) return null;
            if (role === 'owner') return wanted;
            if (role === 'admin') {
                const scope = JSON.parse(localStorage.getItem(SESSION_ADMIN_HOSPITALS_KEY) || '[]');
                return scope.includes('*') || scope.includes(wanted) ? wanted : null;
            }
        } catch (e) {}
        return null;
    })();
    const AA_Q = AA ? 'h=' + encodeURIComponent(AA) : '';
    const DB_PATH = AA ? '/api/aa/db?' + AA_Q : '/api/db';
    const SYNC_PATH = AA ? '/api/aa/sync?' + AA_Q : '/api/sync';
    const VISIT_PATH = AA ? '/api/aa/visit?' + AA_Q : '/api/visit';
    if (AA && typeof document !== 'undefined') document.documentElement.classList.add('aa-mode');

    // Clear stale caches from older database iterations
    try {
        localStorage.removeItem('hospital_hub_database_v2');
        localStorage.removeItem('hospital_hub_database');
        localStorage.removeItem('hospital_hub_database_v1');
    } catch(e) {}

    // In-memory Database State
    let db = null;
    let isLoaded = false;
    let loadPromise = null;
    // Server state the in-memory db was last reconciled with: key -> { c, id, h, o, v, s }.
    // Saves upload only the difference between `db` and this base.
    let syncBase = null;
    let syncBaseFull = false;   // false when loaded as a guest (phone numbers withheld)
    let secretsBase = null;     // owner only: passwords as last read from the server
    // When the page starts from the local cache, the cache contents serve as the merge base
    // for the first server load, so edits made before that load finishes are not lost.
    let cacheBase = null;
    // Exact copy of the server rows this device last saw ([coll, id, hosp, ord, v, data]),
    // kept in localStorage so later page views only fetch what changed since `syncSince`.
    let serverRows = null;
    let syncSince = 0;
    const ROWS_CACHE_KEY = AA ? 'hospital_hub_aa_rows_v1:' + AA : 'hospital_hub_rows_v1';
    const AA_ROWS_PREFIX = 'hospital_hub_aa_rows_v1:';
    const AA_MIRROR_CACHE_KEY = 'hospital_hub_aa_mirror_v1';
    // Virtual hospitals aa__<hospital> mirrored into the doctors' roster (see refreshDivisionMirrors).
    const divisionMirrors = (() => {
        try { return JSON.parse(localStorage.getItem(AA_MIRROR_CACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
    })();
    const aaMirrorId = hosp => AA_MIRROR_PREFIX + hosp;


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

    function normalizeArabicSpecName(name) {
        if (!name) return '';
        return String(name).trim()
            .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/[\s\-_]+/g, '');
    }

    // Precomputed normalized Arabic names to Canonical IDs
    const AR_CANONICAL_SYNONYMS = {
        'جراحة الجملة العصبية': 'NS',
        'جراحة الاعصاب': 'NS',
        'الجملة العصبية': 'NS',
        'جملة عصبية': 'NS',
        'الجراحة العامة': 'GS',
        'جراحة عامة': 'GS',
        'الكسور': 'OR',
        'جراحة الكسور': 'OR',
        'جراحة العظام و الكسور': 'OR',
        'جراحة العظام': 'OR',
        'كسور': 'OR',
        'الباطنية': 'M',
        'باطنية': 'M',
        'الطب الباطني': 'M',
        'الاشعة و السونار': 'R',
        'اشعة و سونار': 'R',
        'الاشعة': 'R',
        'اشعة': 'R',
        'الاشعة والتصوير الطبي': 'R',
        'جراحة الصدر و الاوعية الدموية': 'CT',
        'جراحة الصدر و الاوعية': 'CT',
        'جراحة الصدر': 'CT',
        'صدر و وعائية': 'CT',
        'جراحة الصدر و اوعية دموية': 'CT',
        'جراحة القلب و الصدر و الاوعية': 'CT',
        'جراحة المسالك البولية': 'US',
        'المسالك البولية': 'US',
        'مسالك': 'US',
        'الأذن و الأنف و الحنجرة': 'ENT',
        'الاذن و الانف و الحنجرة': 'ENT',
        'انف و اذن و حنجرة': 'ENT',
        'انف و اذن': 'ENT',
        'جراحة الوجه و الفكين': 'MF',
        'الوجه و الفكين': 'MF',
        'وجه و فكين': 'MF',
        'العيون': 'O',
        'طب و جراحة العيون': 'O',
        'طب الأطفال': 'Pe',
        'طب الاطفال': 'Pe',
        'الاطفال': 'Pe',
        'النسائية و التوليد': 'G',
        'النسائية': 'G',
        'توليد': 'G',
        'نسائية': 'G',
        'المعاون الاداري': 'AO',
        'المعاون الإداري': 'AO',
        'معاون اداري': 'AO',
        'طب الاورام': 'ON',
        'الاورام': 'ON',
        'اورام': 'ON',
        'طب الامراض القلبية': 'H',
        'امراض القلب': 'H',
        'قلبية': 'H',
        'طب الامراض التنفسية': 'RM',
        'امراض التنفس': 'RM',
        'تنفسية': 'RM',
        'طب الجملة العصبية': 'NM',
        'عصبية باطنية': 'NM',
        'طب امراض الكلى': 'N',
        'طب الامراض الكلوية': 'N',
        'طب الكلى': 'N',
        'امراض الكلى': 'N',
        'كلى': 'N',
        'النفسية': 'P',
        'طب النفسية': 'P',
        'طب نفسي': 'P',
        'الجراحة التجميلية': 'PS',
        'تجميلية': 'PS',
        'التخدير و العناية المركزة': 'A',
        'التخدير': 'A',
        'تخدير': 'A',
        'تخدير العناية المركزة': 'ICU',
        'تخدير العمليات': 'OP',
        'تخدير صالة الولادة': 'GA',
        'طب الأسرة': 'FM',
        'طب الاسرة': 'FM',
        'الاسرة': 'FM',
        'الأسرة': 'FM',
        'طب اسرة': 'FM',
        'طب الطوارئ': 'EM',
        'طوارئ': 'EM',
        'طوارىء': 'EM',
        'طوارى': 'EM',
        'الجلدية': 'Der',
        'جلدية': 'Der',
        'الوفيات': 'D',
        'شهادات الوفيات': 'D',
        'ممارسين': 'GP'
    };

    const NORMALIZED_AR_SPECIALTIES = {};
    for (const [name, code] of Object.entries(AR_CANONICAL_SYNONYMS)) {
        NORMALIZED_AR_SPECIALTIES[normalizeArabicSpecName(name)] = code;
    }
    CANONICAL_SPECIALTIES.forEach(s => {
        if (s.name_ar) {
            NORMALIZED_AR_SPECIALTIES[normalizeArabicSpecName(s.name_ar)] = s.id;
        }
    });

    function normalizeSpecialtyId(id) {
        if (!id) return id;
        const trimmed = String(id).trim();
        if (AA) return trimmed;   // division job titles have no medical aliases
        const upper = trimmed.toUpperCase();
        if (SPECIALTY_ALIASES[trimmed]) return SPECIALTY_ALIASES[trimmed];
        if (SPECIALTY_ALIASES[upper]) return SPECIALTY_ALIASES[upper];

        // Match common Arabic text names directly to canonical IDs
        const cleanAr = normalizeArabicSpecName(trimmed);
        if (NORMALIZED_AR_SPECIALTIES[cleanAr]) {
            return NORMALIZED_AR_SPECIALTIES[cleanAr];
        }

        // Exact match check against CANONICAL_SPECIALTIES (case-insensitive)
        const matched = CANONICAL_SPECIALTIES.find(s => s.id.toUpperCase() === upper);
        if (matched) return matched.id;
        return trimmed;
    }

    /** The branch stored on a specialty record ('surgical' | 'medical' | 'none'), or '' when not set. */
    function taggedBranch(specIdOrName, hospitalId) {
        const normId = normalizeSpecialtyId(specIdOrName);
        const same = s => s && (s.id === normId || s.id === specIdOrName || s.name_ar === specIdOrName || s.name_en === specIdOrName);
        const hid = hospitalId || getActiveHospitalId();
        const local = hid && db?.hospitals?.[hid]?.specialties ? db.hospitals[hid].specialties.find(same) : null;
        const global = Array.isArray(db?.globalSpecialties) ? db.globalSpecialties.find(same) : null;
        const b = (local && local.branch) || (global && global.branch) || '';
        return ['surgical', 'medical', 'none'].includes(b) ? b : '';
    }

    // Medical branches when a specialty has no branch set (anaesthesia, radiology and the like: neither).
    const MEDICAL_CANON_IDS = ['M', 'PE', 'N', 'NM', 'P', 'DER', 'EM', 'FM', 'GP', 'H', 'RM', 'ON'];
    const MEDICAL_KEYWORDS = ['باطن', 'medicine', 'اطفال', 'أطفال', 'paed', 'pediat', 'قلب', 'cardiol', 'كلى', 'nephro', 'نفسي', 'psych', 'جلد', 'derm',
        'اورام', 'أورام', 'onco', 'طوارئ', 'emergency', 'اسرة', 'أسرة', 'family', 'تنفس', 'respir', 'ممارس', 'practitioner', 'جملة العصبية', 'neuromed', 'neurology'];

    /**
     * The branch of a specialty for the ER's divisions: 'surgical', 'medical' or '' (neither / unknown).
     * The branch set on the specialty first, then the built-in rules.
     */
    function getSpecialtyBranch(specIdOrName, hospitalId) {
        if (!specIdOrName) return '';
        const tagged = taggedBranch(specIdOrName, hospitalId);
        if (tagged) return tagged === 'none' ? '' : tagged;
        if (isSurgicalSpecialty(specIdOrName)) return 'surgical';
        const normId = String(normalizeSpecialtyId(specIdOrName) || '').toUpperCase();
        if (MEDICAL_CANON_IDS.includes(normId)) return 'medical';
        const globalSpecs = Array.isArray(db?.globalSpecialties) ? db.globalSpecialties : CANONICAL_SPECIALTIES;
        const found = globalSpecs.find(s => s.id === normId || s.name_ar === specIdOrName || s.name_en === specIdOrName);
        const text = ((found ? `${found.name_ar} ${found.name_en}` : '') + ' ' + specIdOrName).toLowerCase();
        return MEDICAL_KEYWORDS.some(k => text.includes(k)) ? 'medical' : '';
    }
    const cleanBranch = b => (['surgical', 'medical', 'none'].includes(b) ? b : '');

    /**
     * Determines whether a specialty is in a surgical branch
     * (General Surgery, Neurosurgery, Orthopaedics, Urosurgery, ENT, Maxillofacial, Ophthalmology, Gyn/Obs, etc.)
     */
    function isSurgicalSpecialty(specIdOrName) {
        if (!specIdOrName) return false;
        // A branch set on the specialty (owner / hospital admin) wins.
        const tagged = taggedBranch(specIdOrName);
        if (tagged) return tagged === 'surgical';
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
            // A division starts without job titles; its catalog grows from the ones its admins add.
            targetDb.globalSpecialties = AA ? [] : JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES));
        } else {
            const cleanMap = new Map();
            const nameToIdMap = new Map();

            targetDb.globalSpecialties.forEach(s => {
                if (!s || !s.id) return;
                // Never allow clone specialties into global catalog
                if (s.isClone || s.clonedFromHospitalId || /_(iraqi|basra|mawani)$/i.test(s.id)) return;

                const normId = normalizeSpecialtyId(s.id);
                const canon = CANONICAL_SPECIALTIES.find(c => c.id === normId);

                let nameAr = s.name_ar || (canon ? canon.name_ar : normId);
                if (normId === 'Pe' && (nameAr === 'الاطفال' || !nameAr)) {
                    nameAr = 'طب الأطفال';
                }

                const normName = normalizeArabicSpecName(nameAr);
                const existingIdByName = normName ? nameToIdMap.get(normName) : null;
                const effectiveId = existingIdByName || normId;

                if (!cleanMap.has(effectiveId)) {
                    // PRESERVE user's custom properties, only fallback to canon defaults if missing!
                    cleanMap.set(effectiveId, {
                        id: effectiveId,
                        name_ar: nameAr,
                        name_en: s.name_en || (canon ? canon.name_en : (s.name_ar || effectiveId)),
                        icon: s.icon || (canon ? canon.icon : '🏥'),
                        prefix: (s.prefix !== undefined) ? s.prefix : (canon && canon.prefix !== undefined ? canon.prefix : (AA ? '' : 'د. ')),
                        color: s.color || (canon ? canon.color : '#0f766e'),
                        parentSpec: s.parentSpec || (canon ? canon.parentSpec : null),
                        acceptPool: Array.isArray(s.acceptPool) ? s.acceptPool : (canon && Array.isArray(canon.acceptPool) ? [...canon.acceptPool] : []),
                        enabled: s.enabled !== false
                    });
                    if (normName) nameToIdMap.set(normName, effectiveId);
                } else {
                    const existing = cleanMap.get(effectiveId);
                    if (normId === 'Pe') existing.name_ar = 'طب الأطفال';
                    else if (!existing.name_ar && s.name_ar) existing.name_ar = s.name_ar;
                    if (!existing.name_en && s.name_en) existing.name_en = s.name_en;
                    if (!existing.icon && s.icon) existing.icon = s.icon;
                    if (s.prefix !== undefined && existing.prefix === undefined) existing.prefix = s.prefix;
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
                    if (s.isClone) {
                        hospSpecMap.set(s.id, {
                            ...s,
                            id: s.id,
                            isClone: true,
                            clonedFromHospitalId: s.clonedFromHospitalId,
                            clonedFromSpecId: s.clonedFromSpecId,
                            enabled: s.enabled !== false
                        });
                        return;
                    }
                    const normId = normalizeSpecialtyId(s.id);
                    const normName = normalizeArabicSpecName(s.name_ar);
                    const matchingGlobal = targetDb.globalSpecialties.find(g => 
                        g.id === normId || (normName && normalizeArabicSpecName(g.name_ar) === normName)
                    );
                    const finalGlobalId = matchingGlobal ? matchingGlobal.id : normId;

                    if (!matchingGlobal && !validGlobalIds.has(finalGlobalId)) {
                        // Register hospital custom specialty into global catalog
                        const newGlobal = {
                            id: finalGlobalId,
                            name_ar: s.name_ar || finalGlobalId,
                            name_en: s.name_en || s.name_ar || finalGlobalId,
                            icon: s.icon || '🏥',
                            prefix: (s.prefix !== undefined) ? s.prefix : 'د. ',
                            color: s.color || '#0f766e',
                            parentSpec: s.parentSpec || null,
                            acceptPool: Array.isArray(s.acceptPool) ? s.acceptPool : [],
                            enabled: true
                        };
                        targetDb.globalSpecialties.push(newGlobal);
                        validGlobalIds.add(finalGlobalId);
                    }
                    const globalDef = targetDb.globalSpecialties.find(g => g.id === finalGlobalId);
                    if (!hospSpecMap.has(normId)) {
                        // The hospital's own names and icon (edited by its admins) win; the catalog only fills gaps.
                        hospSpecMap.set(normId, {
                            ...s,
                            id: normId,
                            name_ar: s.name_ar || (globalDef ? globalDef.name_ar : normId),
                            name_en: s.name_en || (globalDef ? globalDef.name_en : ''),
                            icon: s.icon || (globalDef ? globalDef.icon : '🏥'),
                            parentSpec: globalDef ? globalDef.parentSpec : (s.parentSpec || null),
                            acceptPool: Array.isArray(s.acceptPool) ? s.acceptPool.map(normalizeSpecialtyId) : (globalDef && Array.isArray(globalDef.acceptPool) ? globalDef.acceptPool.map(normalizeSpecialtyId) : [])
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

                // Doctors-only fields (specialists' schedule, Rotation Heroes link) do not apply to a division.
                if (AA) return;

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
        activeHospitalId: "iraqi",
        globalSpecialties: JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES)),
        residents: [],
        hospitals: {}
    };

    // Synchronously initialize in-memory db from local cache for instant zero-latency auth & rendering
    try {
        const cachedRows = JSON.parse(localStorage.getItem(ROWS_CACHE_KEY) || 'null');
        if (HubSync && cachedRows && Array.isArray(cachedRows.rows) && cachedRows.rows.length) {
            setServerRows(cachedRows.rows);
            syncSince = Number(cachedRows.since) || 0;
            syncBaseFull = !!cachedRows.full;
            db = sanitizeAndMigrateDatabase(HubSync.compose(cachedRows.rows));
        } else if (!AA) {
            const initialCachedStr = localStorage.getItem(CACHE_KEY);
            if (initialCachedStr) {
                db = sanitizeAndMigrateDatabase(restoreRidsFromCache(JSON.parse(initialCachedStr)));
                if (HubSync) {
                    cacheBase = new Map([...HubSync.decompose(db).records].map(([k, r]) => [k, { c: r.c, id: r.id, h: r.h, o: r.o, v: 0, s: r.s }]));
                }
            }
        }
    } catch (e) {
        console.warn("Initial local cache parse warning:", e);
    }

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
    // CLOUDFLARE API CLIENT
    // ============================================================
    class ApiError extends Error {
        constructor(message, status, data) {
            super(message);
            this.status = status;
            this.data = data;
        }
    }

    function readApiToken() {
        try {
            const t = JSON.parse(localStorage.getItem(API_TOKEN_KEY) || 'null');
            return (t && t.token && t.exp > Date.now()) ? t : null;
        } catch (e) {
            return null;
        }
    }

    function storeApiToken(token, exp) {
        try {
            if (token) localStorage.setItem(API_TOKEN_KEY, JSON.stringify({ token, exp }));
            else localStorage.removeItem(API_TOKEN_KEY);
        } catch (e) {}
    }

    async function api(method, path, body, { useToken = true, retries = 2 } = {}) {
        const headers = { 'Accept': 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const tok = useToken ? readApiToken() : null;
        if (tok) headers['Authorization'] = 'Bearer ' + tok.token;

        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await fetch(CONFIG.apiBase + path, {
                    method,
                    headers,
                    body: body === undefined ? undefined : JSON.stringify(body),
                    cache: 'no-store'
                });
                const text = await res.text();
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (res.status === 401 && tok) {
                    // Session expired or revoked on the server: sign out locally too.
                    storeApiToken(null);
                    auth.logout();
                }
                if (!res.ok) {
                    throw new ApiError((data && (data.error || data.message)) || ('HTTP ' + res.status), res.status, data);
                }
                return data;
            } catch (err) {
                lastErr = err;
                // Only network failures and server errors are worth retrying.
                if (err instanceof ApiError && err.status < 500) throw err;
                if (attempt < retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
            }
        }
        throw lastErr;
    }

    async function fetchAllRows(endpoint) {
        let after = 0;
        let rows = [];
        let page;
        let firstTime = 0;
        do {
            page = await api('GET', `${endpoint}${endpoint.includes('?') ? '&' : '?'}after=${after}`);
            if (!firstTime) firstTime = page.time;
            rows = rows.concat(page.rows || []);
            after = page.last;
        } while (page.more);
        return { rows, full: !!page.full, role: page.role, time: firstTime };
    }

    // Sessions created before the move to Cloudflare stored the password itself (base64).
    // Exchange it once for a server token so nobody has to sign in again.
    let sessionUpgrade = null;
    function ensureApiSession() {
        if (sessionUpgrade) return sessionUpgrade;
        sessionUpgrade = (async () => {
            const role = localStorage.getItem(SESSION_ROLE_KEY);
            if (!role || readApiToken()) return;
            let pwd = null;
            try {
                const legacy = localStorage.getItem(SESSION_TOKEN_KEY);
                pwd = legacy ? atob(legacy) : null;
            } catch (e) {}
            if (!pwd || pwd === role + '_session') {
                auth.logout();
                return;
            }
            const res = await api('POST', '/api/login', {
                password: pwd,
                roleHint: role,
                remember: localStorage.getItem(SESSION_REMEMBER_KEY) === 'true'
            }, { useToken: false });
            localStorage.removeItem(SESSION_TOKEN_KEY);
            if (res && res.success) {
                storeApiToken(res.token, res.exp);
                localStorage.setItem(SESSION_ROLE_KEY, res.role);
                localStorage.setItem(SESSION_ADMIN_HOSPITALS_KEY, JSON.stringify(res.adminHospitals || []));
            } else {
                auth.logout();
            }
        })().catch(err => {
            console.warn('Session upgrade failed (will retry on next load):', err);
        }).finally(() => {
            sessionUpgrade = null;
        });
        return sessionUpgrade;
    }

    // ============================================================
    // LOCAL CACHE (instant first paint; the server stays the source of truth)
    // ============================================================
    function setServerRows(rows) {
        serverRows = new Map();
        for (const row of rows) serverRows.set(HubSync.key(row[0], row[1]), row);
        syncBase = HubSync.baseFromRows(rows);
    }

    /** Record what the server now holds for one record (after a save, conflict or tap). */
    function setServerRow(c, id, h, o, v, data) {
        const k = HubSync.key(c, id);
        if (!serverRows) serverRows = new Map();
        if (data === null) {
            serverRows.delete(k);
            if (syncBase) syncBase.delete(k);
            return;
        }
        serverRows.set(k, [c, id, h, o, v, data]);
        if (syncBase) syncBase.set(k, { c, id, h, o, v, s: JSON.stringify(data) });
    }

    let cacheTimer = null;
    function writeCache() {
        clearTimeout(cacheTimer);
        cacheTimer = setTimeout(writeCacheNow, 250);
    }

    function writeCacheNow() {
        if (!serverRows) return;
        let text;
        try {
            text = JSON.stringify({ since: syncSince, full: syncBaseFull, rows: [...serverRows.values()] });
        } catch (e) {
            return;
        }
        try {
            localStorage.removeItem(CACHE_KEY);   // the old whole-database cache is no longer used
            localStorage.setItem(ROWS_CACHE_KEY, text);
            if (lastServerSync) localStorage.setItem(ROWS_CACHE_KEY + ':at', String(lastServerSync));
        } catch (e) {
            // Storage full: drop the optional snapshots and try once more, else skip caching.
            try {
                ['1', '2', '3'].forEach(n => localStorage.removeItem('hosp_hub_safety_snap_' + n));
                localStorage.setItem(ROWS_CACHE_KEY, text);
            } catch (e2) {
                try { localStorage.removeItem(ROWS_CACHE_KEY); } catch (e3) {}
                console.warn('Local cache skipped (storage full):', e2);
            }
        }
    }

    /** Remove locally cached data (it contains phone numbers) when signing out. */
    function clearLocalData() {
        clearTimeout(cacheTimer);
        try {
            localStorage.removeItem(ROWS_CACHE_KEY);
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(AA_MIRROR_CACHE_KEY);
            const divisionCaches = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf(AA_ROWS_PREFIX) >= 0) divisionCaches.push(k.slice(k.indexOf(AA_ROWS_PREFIX)));
            }
            divisionCaches.forEach(k => localStorage.removeItem(k));
            ['1', '2', '3'].forEach(n => localStorage.removeItem('hosp_hub_safety_snap_' + n));
        } catch (e) {}
        syncSince = 0;
    }

    function restoreRidsFromCache(target) {
        if (!target || !target.hospitals || !HubSync) return target;
        for (const h of Object.values(target.hospitals)) {
            (h && Array.isArray(h.schedule) ? h.schedule : []).forEach(e => {
                if (e && Object.prototype.hasOwnProperty.call(e, HubSync.RID)) {
                    const rid = e[HubSync.RID];
                    delete e[HubSync.RID];
                    HubSync.setRid(e, rid);
                }
            });
        }
        return target;
    }

    // ============================================================
    // DATABASE LOADING
    // ============================================================
    function sortByServerOrder(target, base) {
        const ordOf = k => { const b = base.get(k); return b ? b.o : Number.MAX_SAFE_INTEGER; };
        for (const [hid, h] of Object.entries(target.hospitals || {})) {
            if (!Array.isArray(h.schedule)) continue;
            const idx = new Map(h.schedule.map((e, i) => [e, i]));
            h.schedule.sort((a, b) => (ordOf(HubSync.key('sched', hid + ':' + (a && a[HubSync.RID]))) - ordOf(HubSync.key('sched', hid + ':' + (b && b[HubSync.RID])))) || (idx.get(a) - idx.get(b)));
        }
        if (Array.isArray(target.residents)) {
            const idx = new Map(target.residents.map((r, i) => [r, i]));
            target.residents.sort((a, b) => (ordOf(HubSync.key('resident', String(a && a.id))) - ordOf(HubSync.key('resident', String(b && b.id)))) || (idx.get(a) - idx.get(b)));
        }
    }

    /**
     * Bring `target` up to date with the server rows, in place.
     * With a base: local edits not yet saved are kept and merged with server changes.
     * Without a base (first load from a cached copy): the server wins everywhere.
     */
    function reconcileInto(target, remote, base) {
        const local = HubSync.decompose(target).records;
        const parse = s => JSON.parse(s);
        for (const [k, r] of remote) {
            const l = local.get(k);
            const b = base ? base.get(k) : null;
            let value;
            if (!base) {
                if (l && l.s === r.s) continue;
                value = parse(r.s);
            } else if (!l) {
                if (b && b.s === r.s) continue;          // deleted here, unchanged on server: stay deleted
                value = parse(r.s);
            } else if (l.s === r.s) {
                continue;
            } else if (b && l.s === b.s) {
                value = parse(r.s);                       // no local edits: take the server copy
            } else {
                value = HubSync.merge3(b ? parse(b.s) : {}, parse(l.s), parse(r.s));
            }
            HubSync.applyRecord(target, r.c, r.id, r.h, value);
        }
        for (const [k, l] of local) {
            if (remote.has(k)) continue;
            const b = base ? base.get(k) : null;
            // Removed on the server; keep it only if it was created or edited here and not saved yet.
            if (!base || (b && b.s === l.s)) HubSync.applyRecord(target, l.c, l.id, l.h, null);
        }
        sortByServerOrder(target, remote);
    }

    function applyServerRows(rows, full, serverTime) {
        const remote = HubSync.baseFromRows(rows);
        if (!db) {
            db = HubSync.compose(rows);
        } else {
            reconcileInto(db, remote, syncBase || cacheBase);
        }
        cacheBase = null;
        setServerRows(rows);
        syncBaseFull = !!full;
        // Overlap by two minutes so writes that were in flight during this read are not missed.
        syncSince = (Number(serverTime) || Date.now()) - 2 * 60 * 1000;
        db = sanitizeAndMigrateDatabase(db);
    }

    // The pages of the app shell share one device cache. A page that needs data while another page synced
    // with the server moments ago takes that page's copy instead of asking the server again (every
    // request reads the database, and the free plan allows a limited number of rows a day).
    const SHARED_FRESH_MS = 30 * 1000;
    let lastServerSync = 0;
    function freshSharedRows() {
        try {
            const at = Number(localStorage.getItem(ROWS_CACHE_KEY + ':at')) || 0;
            if (!at || Date.now() - at > SHARED_FRESH_MS) return null;
            const cached = JSON.parse(localStorage.getItem(ROWS_CACHE_KEY) || 'null');
            if (!cached || !Array.isArray(cached.rows) || !cached.rows.length) return null;
            if (!!cached.full !== !!readApiToken()) return null;           // another sign-in state
            if ((Number(cached.since) || 0) < syncSince) return null;       // not newer than ours
            return { rows: cached.rows, full: !!cached.full, time: (Number(cached.since) || 0) + 2 * 60 * 1000, shared: true };
        } catch (e) {
            return null;
        }
    }

    // The hospitals' names for the sign-up form (public; the only data a visitor can read).
    let publicHospitals = null;
    async function getPublicHospitals() {
        if (auth.isLoggedIn()) return getHospitals();
        if (!publicHospitals) {
            try {
                const res = await api('GET', '/api/public/hospitals', undefined, { useToken: false, retries: 1 });
                publicHospitals = Array.isArray(res && res.hospitals) ? res.hospitals : [];
            } catch (e) {
                publicHospitals = [];
            }
        }
        return publicHospitals;
    }
    const publicHospital = id => (publicHospitals || []).find(h => h.id === id) || null;

    // The latest automatic backups (every 5 hours, kept in the private backups repository):
    // when they were made, and the files themselves ('full' for the owner, 'hosp:<id>' per hospital).
    const getBackupInfo = () => api('GET', '/api/backup/info', undefined, { retries: 1 });
    const getLatestBackup = name => api('GET', '/api/backup/latest?f=' + encodeURIComponent(name), undefined, { retries: 1 });

    /** Fetch only what changed since the last sync; null when a full reload is needed. */
    async function fetchChangedRows() {
        if (!serverRows || !syncSince || syncBaseFull !== !!readApiToken()) return null;
        const res = await api('GET', DB_PATH + (AA ? '&' : '?') + 'since=' + syncSince);
        if (!res || res.reset || res.full !== syncBaseFull) return null;
        const next = new Map(serverRows);
        for (const [c, id] of res.deleted || []) next.delete(HubSync.key(c, id));
        for (const row of res.changed || []) next.set(HubSync.key(row[0], row[1]), row);
        return { rows: [...next.values()], full: res.full, time: res.time };
    }

    async function loadSecrets() {
        try {
            const res = await api('GET', '/api/secrets');
            secretsBase = res && res.secrets ? res.secrets : {};
            attachSecrets();
        } catch (e) {
            secretsBase = null;
            if (!(e instanceof ApiError && e.status === 403)) console.warn('Could not load passwords:', e);
        }
    }

    // Owner only: expose passwords on the in-memory db so the existing password panels keep working.
    function attachSecrets() {
        if (!db || !secretsBase) return;
        db.globalPasswords = Object.assign({}, secretsBase.global || {});
        for (const [hid, h] of Object.entries(db.hospitals || {})) {
            if (secretsBase[hid]) h.passwords = Object.assign({}, secretsBase[hid]);
            else delete h.passwords;
        }
    }

    function detachSecrets() {
        secretsBase = null;
        if (!db) return;
        delete db.globalPasswords;
        for (const h of Object.values(db.hospitals || {})) delete h.passwords;
    }

    // Site-wide switches from the API (cached for instant first paint).
    const icuAllOn = () => { try { return localStorage.getItem('hub_icu_all') === '1'; } catch (e) { return false; } };
    let authConfigAt = 0;
    function refreshAuthConfig() {
        if (Date.now() - authConfigAt < 60000) return;
        authConfigAt = Date.now();
        api('GET', '/api/auth-config', undefined, { useToken: false, retries: 0 }).then(cfg => {
            const was = icuAllOn();
            try { localStorage.setItem('hub_icu_all', cfg && cfg.icuAll ? '1' : '0'); } catch (e) {}
            if (was !== icuAllOn()) dispatchDataChanged();
        }).catch(() => {});
    }

    // A forced reload asks the server (callers use it right after a change made on the server); only the
    // first load of a page and the background refreshes below may take a sibling page's fresh copy.
    async function loadDatabase(forceRefresh = false, { network = forceRefresh } = {}) {
        if (!forceRefresh && isLoaded && db && syncBase) {
            return db;
        }
        // Not signed in: the server gives no data to visitors, so do not ask (pages show sign-in only).
        if (!AA && !auth.isLoggedIn()) {
            if (!db) db = sanitizeAndMigrateDatabase(JSON.parse(JSON.stringify(defaultTemplate)));
            return db;
        }
        if (loadPromise) {
            return loadPromise;
        }

        loadPromise = (async () => {
            try {
                await ensureApiSession();
                let result = network ? null : freshSharedRows();
                if (!result) {
                    try {
                        result = await fetchChangedRows();
                    } catch (err) {
                        result = null;
                    }
                }
                if (!result) {
                    try {
                        result = await fetchAllRows(DB_PATH);
                    } catch (err) {
                        // A rejected token has just been cleared; read again as a guest.
                        if (err instanceof ApiError && err.status === 401 && !AA) result = await fetchAllRows(DB_PATH);
                        else throw err;
                    }
                }
                applyServerRows(result.rows, result.full, result.time);
                if (!result.shared) lastServerSync = Date.now();
                refreshAuthConfig();
                if (auth.isOwner() && !AA) await loadSecrets();
                else detachSecrets();
                writeCache();
                isLoaded = true;
                dispatchDataChanged();
                if (!AA) refreshDivisionMirrors();
            } catch (err) {
                console.warn('Cloudflare API unavailable, showing the last saved local copy:', err);
                if (!db) {
                    db = sanitizeAndMigrateDatabase(JSON.parse(JSON.stringify(defaultTemplate)));
                }
                isLoaded = true;
            } finally {
                loadPromise = null;
            }
            return db;
        })();

        return loadPromise;
    }

    // Other tabs on this device saved something: pull the change from the server.
    let refreshTimer = null;
    let refreshNeedsServer = false;
    function scheduleRefresh(delay = 400, network = false) {
        clearTimeout(refreshTimer);
        refreshNeedsServer = refreshNeedsServer || network;
        refreshTimer = setTimeout(() => {
            const viaServer = refreshNeedsServer;
            refreshNeedsServer = false;
            if (isLoaded) loadDatabase(true, { network: viaServer }).catch(() => {});
        }, delay);
    }
    // A page of the app shell that is not on screen does not sync; it catches up when it is shown.
    const offScreenView = () => { try { return !!window.HubView && !window.HubView.active; } catch (e) { return false; } };
    let behind = false;          // something changed while this page was off screen
    let behindNeedsServer = false;

    const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(AA ? 'hosp_hub_aa_sync_' + AA : 'hosp_hub_sync_channel') : null;
    if (syncChannel) {
        syncChannel.onmessage = (event) => {
            if (!event.data || event.data.type !== 'hub:data-updated') return;
            // A save made elsewhere is on the server, not yet in the shared copy.
            if (offScreenView()) { behind = true; behindNeedsServer = true; }
            else scheduleRefresh(400, true);
        };
    }

    // App shell: a tab's view catches up as it is shown (after a while away, or if it missed a change).
    if (typeof window !== 'undefined') {
        window.addEventListener('hub:view-shown', e => {
            if (behind || (e.detail && e.detail.hiddenFor > 30 * 1000)) {
                const viaServer = behindNeedsServer;
                behind = false;
                behindNeedsServer = false;
                scheduleRefresh(0, viaServer);
            }
        });
    }

    // Phones keep the app open for days: refresh when it comes back to the foreground.
    let hiddenAt = 0;
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                hiddenAt = Date.now();
                flushErNow();
            } else if (hiddenAt && Date.now() - hiddenAt > 60 * 1000) {
                if (offScreenView()) behind = true;
                else scheduleRefresh(0);
            }
        });
    }

    // ============================================================
    // LOCAL SAFETY SNAPSHOT (the server also keeps every previous version)
    // ============================================================
    function saveLocalSafetySnapshot(dbObj, note = '') {
        if (AA) return;
        try {
            localStorage.removeItem('hosp_hub_safety_snap_2');
            localStorage.removeItem('hosp_hub_safety_snap_3');
            const snapshot = {
                timestamp: new Date().toISOString(),
                note: String(note || '').slice(0, 120),
                data: dbObj
            };
            localStorage.setItem('hosp_hub_safety_snap_1', JSON.stringify(snapshot, (k, v) => (k === 'passwords' || k === 'globalPasswords') ? undefined : v));
        } catch (e) {
            try { localStorage.removeItem('hosp_hub_safety_snap_1'); } catch (e2) {}
        }
    }

    function getSafetySnapshots() {
        const snaps = [];
        for (let i = 1; i <= 3; i++) {
            try {
                const raw = localStorage.getItem('hosp_hub_safety_snap_' + i);
                if (raw) snaps.push(JSON.parse(raw));
            } catch (e) {}
        }
        return snaps;
    }

    /** Replace the database contents while keeping the same `db` object for pages holding it. */
    function replaceDatabaseContents(next) {
        if (!db) {
            db = next;
            return db;
        }
        for (const k of Object.keys(db)) delete db[k];
        Object.assign(db, next);
        return db;
    }

    async function restoreSafetySnapshot(index = 1) {
        if (!auth.isOwner()) {
            throw new Error('استعادة النسخ الاحتياطية مخصصة للمالك حصراً.');
        }
        const snaps = getSafetySnapshots();
        const target = snaps[index - 1];
        if (!target || !target.data) {
            throw new Error('النسخة الاحتياطية المحددة غير موجودة.');
        }
        const keepSecrets = secretsBase;
        replaceDatabaseContents(sanitizeAndMigrateDatabase(restoreRidsFromCache(JSON.parse(JSON.stringify(target.data)))));
        if (keepSecrets) attachSecrets();
        await saveDatabase(`Restored from local safety snapshot #${index} (${target.timestamp})`);
        return db;
    }

    // ============================================================
    // SAVING
    // ============================================================
    function wireOp(op) {
        if (op.ordOnly) return { c: op.c, id: op.id, o: op.o, ordOnly: 1 };
        if (op.del) return { c: op.c, id: op.id, bv: op.bv, del: 1 };
        return { c: op.c, id: op.id, h: op.h, o: op.o, bv: op.bv, d: op.d };
    }

    function collectSecretChanges(current) {
        if (!secretsBase) return null;
        const changes = {};
        let any = false;
        const scopes = new Set([...Object.keys(current), ...Object.keys(secretsBase)]);
        for (const scope of scopes) {
            const cur = current[scope] || {};
            const prev = secretsBase[scope] || {};
            for (const role of ['owner', 'admin', 'anaesthesia', 'user']) {
                const a = String(cur[role] || '').trim();
                const b = String(prev[role] || '').trim();
                if (a !== b) {
                    (changes[scope] = changes[scope] || {})[role] = a || null;
                    any = true;
                }
            }
        }
        return any ? changes : null;
    }

    // Saves run one at a time so each one diffs against the result of the previous.
    let saveChain = Promise.resolve();
    function saveDatabase(commitMessage = "Hospital Hub Data Update 🏥") {
        const run = () => performSave(commitMessage);
        const p = saveChain.then(run, run);
        saveChain = p.catch(() => {});
        return p;
    }

    async function performSave(message) {
        if (!db) return false;
        if (!syncBase || (!syncBaseFull && readApiToken())) {
            // Never loaded from the server in this page (or loaded as a guest): sync first.
            await loadDatabase(true);
        }
        if (!syncBase) {
            throw new Error('تعذر الاتصال بالخادم، لم يتم حفظ التغييرات. تحقق من الاتصال بالإنترنت وحاول مجدداً.');
        }
        if (!readApiToken()) {
            throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً لحفظ التغييرات.');
        }

        db.lastUpdated = new Date().toISOString();
        const { records, secrets } = HubSync.decompose(db);

        const secretChanges = auth.isOwner() ? collectSecretChanges(secrets) : null;
        if (secretChanges) {
            await api('PUT', '/api/secrets', { secrets: secretChanges });
            for (const [scope, roles] of Object.entries(secretChanges)) {
                secretsBase[scope] = secretsBase[scope] || {};
                for (const [role, pwd] of Object.entries(roles)) {
                    if (pwd) secretsBase[scope][role] = pwd;
                    else delete secretsBase[scope][role];
                }
            }
        }

        let ops = HubSync.diff(syncBase, records);
        saveLocalSafetySnapshot(db, message);
        writeCache();
        dispatchDataChanged();

        let appliedCount = 0;
        const rejectedOps = [];
        for (let round = 0; ops.length > 0 && round < 4; round++) {
            const conflicts = [];
            for (const chunk of HubSync.chunkOps(ops)) {
                const res = await api('POST', SYNC_PATH, { msg: message, ops: chunk.map(wireOp) });
                for (const [i, v] of res.applied || []) {
                    const op = chunk[i];
                    appliedCount++;
                    if (op.del) setServerRow(op.c, op.id, null, 0, 0, null);
                    else setServerRow(op.c, op.id, op.h, op.o, v, op.d);
                }
                chunk.forEach(op => {
                    if (op.ordOnly && syncBase.has(op.k)) {
                        syncBase.get(op.k).o = op.o;
                        const row = serverRows && serverRows.get(op.k);
                        if (row) row[3] = op.o;
                    }
                });
                for (const [i, v, data] of res.conflicts || []) conflicts.push({ op: chunk[i], v, data });
                for (const i of res.rejected || []) rejectedOps.push(chunk[i]);
            }
            if (conflicts.length === 0) break;

            // Someone else changed these records meanwhile: merge with their version and retry.
            const retryKeys = new Set();
            for (const { op, v, data } of conflicts) {
                const remoteVal = (data === null || data === undefined) ? null : JSON.parse(data);
                const prev = syncBase.get(op.k);
                if (remoteVal === null) {
                    setServerRow(op.c, op.id, null, 0, 0, null);   // removed on the server; a local edit re-creates it
                } else {
                    if (!op.del) {
                        const merged = HubSync.merge3(prev ? JSON.parse(prev.s) : {}, op.d, remoteVal);
                        HubSync.applyRecord(db, op.c, op.id, op.h, merged);
                    }
                    setServerRow(op.c, op.id, op.h !== undefined ? op.h : (prev ? prev.h : null), op.o !== undefined ? op.o : (prev ? prev.o : 0), v, remoteVal);
                }
                retryKeys.add(op.k);
            }
            ops = HubSync.diff(syncBase, HubSync.decompose(db).records).filter(o => retryKeys.has(o.k));
        }

        if (rejectedOps.length) {
            // Not permitted for this role: put those records back to the server version.
            for (const op of rejectedOps) {
                const b = syncBase.get(op.k);
                HubSync.applyRecord(db, op.c, op.id, op.h !== undefined ? op.h : (b ? b.h : null), b ? JSON.parse(b.s) : null);
            }
            console.warn(`${rejectedOps.length} change(s) need a higher role and were not saved:`, rejectedOps.map(o => o.k));
            db = sanitizeAndMigrateDatabase(db);
        }

        if (secretsBase) attachSecrets();
        writeCache();
        dispatchDataChanged();
        if (syncChannel) {
            try { syncChannel.postMessage({ type: 'hub:data-updated' }); } catch (e) {}
        }

        if (rejectedOps.length && appliedCount === 0 && !secretChanges) {
            throw new Error('غير مصرح لك بحفظ هذه التغييرات.');
        }
        return true;
    }

    // ============================================================
    // CONTACT TAP COUNTER
    // ============================================================
    // One visit per resident per minute. The server enforces it for the account (whatever happens on
    // the phone); this local note only keeps the number on screen from jumping up and back.
    const VISIT_COOLDOWN_MS = 60 * 1000;
    const visitNoteKey = (hid, entry) => 'hub_visit_' + hid + '|' + String(entry.name || '').replace(/\s+/g, ' ').trim() + '|' + entry.date;
    function bumpVisit(entry) {
        const rid = HubSync ? entry[HubSync.RID] : null;
        if (!rid || !db || !readApiToken()) return;
        const hid = Object.keys(db.hospitals || {}).find(h => (db.hospitals[h].schedule || []).includes(entry));
        if (!hid) return;
        const note = visitNoteKey(hid, entry);
        let last = 0;
        try { last = Number(localStorage.getItem(note)) || 0; } catch (e) {}
        if (Date.now() - last < VISIT_COOLDOWN_MS) return;
        try { localStorage.setItem(note, String(Date.now())); } catch (e) {}
        entry.VisitCount = (entry.VisitCount || 0) + 1;
        const id = hid + ':' + rid;
        const k = HubSync.key('sched', id);
        api('POST', VISIT_PATH, { id }, { retries: 1 }).then(res => {
            if (!res || !res.ok) return;
            entry.VisitCount = res.count;
            if (res.cooldown) {
                try { localStorage.setItem(note, String(Date.now() - VISIT_COOLDOWN_MS + (res.retryIn || 0))); } catch (e) {}
                window.dispatchEvent(new CustomEvent('hub:data-changed'));
                return;
            }
            const b = syncBase && syncBase.get(k);
            if (b) {
                const obj = JSON.parse(b.s);
                obj.VisitCount = res.count;
                setServerRow(b.c, b.id, b.h, b.o, res.v, obj);
                writeCache();
            }
        }).catch(e => console.warn('Contact tap not recorded on server:', e));
    }

    // ============================================================
    // ER SCHEDULER SYNC
    // The ER page keeps its data in localStorage; these keys are mirrored to the server
    // so every admin device sees the same schedules.
    // ============================================================
    const ER_EXACT_KEYS = new Set(['hosp_hub_emergency_state_v3', 'hosp_hub_emergency_specialty_colors']);
    const ER_PREFIXES = ['hosp_hub_emergency_sched_', 'hosp_hub_emergency_alloc_'];
    const ER_MAX_BYTES = 1800000;
    const isErKey = k => typeof k === 'string' && (ER_EXACT_KEYS.has(k) || ER_PREFIXES.some(p => k.startsWith(p)));
    const erHospitalOf = k => {
        const m = /^hosp_hub_emergency_(?:sched|alloc)_(.+)_\d{4}_\d{1,2}$/.exec(k);
        return m ? m[1] : null;
    };

    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    const erDirty = new Set();
    let erPulled = false;
    // When each ER entry was last changed on this device (so a newer copy on the server is not
    // overwritten by an older, never-uploaded copy from this device).
    const ER_EDIT_KEY = 'hosp_hub_er_edit_times';
    const readEditTimes = () => { try { return JSON.parse(localStorage.getItem(ER_EDIT_KEY) || '{}') || {}; } catch (e) { return {}; } };
    const writeEditTimes = t => { try { nativeSetItem.call(localStorage, ER_EDIT_KEY, JSON.stringify(t)); } catch (e) {} };
    function erStatus(extra) {
        try { window.dispatchEvent(new CustomEvent('hub:er-sync', { detail: { pending: erDirty.size, pushing: !!erPushing, ...(extra || {}) } })); } catch (e) {}
    }
    let erTimer = null;
    let erPushing = null;

    Storage.prototype.setItem = function (k, v) {
        nativeSetItem.call(this, k, v);
        if (this === window.localStorage && isErKey(k)) markErDirty(k);
    };
    Storage.prototype.removeItem = function (k) {
        nativeRemoveItem.call(this, k);
        if (this === window.localStorage && isErKey(k)) markErDirty(k);
    };

    function canSyncEr() {
        if (AA) return false;
        const role = auth.getRole();
        return (role === 'owner' || role === 'admin') && !!readApiToken();
    }

    function readErState() {
        try { return JSON.parse(localStorage.getItem(ER_SYNC_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function writeErState(state) {
        try { nativeSetItem.call(localStorage, ER_SYNC_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function deviceId() {
        try {
            let id = localStorage.getItem('hospital_hub_device_id');
            if (!id) {
                id = Math.random().toString(36).slice(2, 10);
                nativeSetItem.call(localStorage, 'hospital_hub_device_id', id);
            }
            return id;
        } catch (e) {
            return 'unknown';
        }
    }

    function markErDirty(k) {
        erDirty.add(k);
        const t = readEditTimes();
        t[k] = Date.now();
        writeEditTimes(t);
        erStatus();
        if (!erPulled) return;
        clearTimeout(erTimer);
        erTimer = setTimeout(() => { pushEr().catch(() => {}); }, 1500);
    }

    function flushErNow() {
        if (erPulled && erDirty.size) pushEr().catch(() => {});
    }

    async function pullEr() {
        if (!canSyncEr()) return { skipped: true };
        let rows;
        try {
            ({ rows } = await fetchAllRows('/api/er'));
        } catch (e) {
            console.warn('ER sync: could not reach the server, using this device\'s copy:', e);
            return { error: String(e && e.message || e) };
        }
        const state = readErState();
        const editTimes = readEditTimes();
        const remote = new Map(rows.map(r => [r[1], r]));
        const conflictCopies = [];
        let pulled = 0;

        for (const [k, r] of remote) {
            const remoteText = JSON.stringify(r[5]);
            const localText = localStorage.getItem(k);
            const st = state[k];
            const unchangedHere = localText === null || (st && HubSync.hash(localText) === st.h);
            if (unchangedHere || localText === remoteText) {
                if (localText !== remoteText) {
                    try { nativeSetItem.call(localStorage, k, remoteText); pulled++; } catch (e) { console.warn('ER sync: storage full for', k); continue; }
                }
                state[k] = { v: r[4], h: HubSync.hash(remoteText) };
                erDirty.delete(k);
            } else if (st && st.v !== r[4] && r[6] && r[6] > (editTimes[k] || 0)) {
                // Changed on both sides, and the server's copy is the newer one (e.g. a backup restored on
                // another device after this device's last, never-uploaded edit): the newer copy wins and
                // this device's version is kept on the server as a conflict copy.
                try { conflictCopies.push({ k, h: erHospitalOf(k), d: JSON.parse(localText), from: 'device' }); } catch (e) {}
                try { nativeSetItem.call(localStorage, k, remoteText); pulled++; } catch (e) {}
                state[k] = { v: r[4], h: HubSync.hash(remoteText) };
                delete editTimes[k];
                erDirty.delete(k);
            } else if (st) {
                // Edited on this device since the last sync (and later than the server's copy): keep these
                // edits and upload them.
                if (st.v !== r[4]) conflictCopies.push({ k, h: r[2], d: r[5], from: 'server' });
                state[k] = { v: r[4], h: st.h };
                erDirty.add(k);
            } else if (localText.length > remoteText.length) {
                // First sync of a device that already had its own, fuller copy (ER schedules lived only
                // on each device before): keep this device's version and preserve the shared one.
                conflictCopies.push({ k, h: r[2], d: r[5], from: 'server' });
                state[k] = { v: r[4], h: '' };
                erDirty.add(k);
            } else {
                // First sync of a device whose copy is smaller: the shared copy wins and this
                // device's version is kept on the server for the owner to recover if needed.
                try { conflictCopies.push({ k, h: erHospitalOf(k), d: JSON.parse(localText), from: 'device' }); } catch (e) {}
                try { nativeSetItem.call(localStorage, k, remoteText); pulled++; } catch (e) {}
                state[k] = { v: r[4], h: HubSync.hash(remoteText) };
                erDirty.delete(k);
            }
        }

        const localKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (isErKey(k) && !remote.has(k)) localKeys.push(k);
        }
        for (const k of localKeys) {
            const st = state[k];
            if (st && HubSync.hash(localStorage.getItem(k) || '') === st.h) {
                nativeRemoveItem.call(localStorage, k);   // deleted on the server
                delete state[k];
            } else {
                if (st) delete state[k];
                erDirty.add(k);                            // never uploaded yet (or edited after a server delete)
            }
        }
        writeErState(state);
        writeEditTimes(editTimes);
        erPulled = true;

        if (conflictCopies.length) {
            const dev = deviceId();
            const ops = conflictCopies.map(c => ({ c: 'er_conflict', id: `${c.k}@${c.from}@${dev}@${Date.now()}`, h: c.h, o: 0, bv: 0, d: c.d }));
            api('POST', '/api/sync', { msg: 'ER conflict copy', ops }).catch(e => console.warn('ER conflict copy not saved:', e));
        }
        await pushEr();
        return { pulled, uploaded: true };
    }

    function pushEr() {
        if (erPushing) return erPushing.then(() => (erDirty.size ? pushEr() : undefined));
        if (!erPulled || !erDirty.size || !canSyncEr()) return Promise.resolve();
        erPushing = (async () => {
            const state = readErState();
            const keys = [...erDirty];
            erDirty.clear();
            erStatus();
            const ops = [];
            const texts = {};
            for (const k of keys) {
                const text = localStorage.getItem(k);
                const st = state[k];
                if (text === null) {
                    if (st) ops.push({ k, c: 'er', id: k, bv: st.v, del: 1 });
                    continue;
                }
                if (st && HubSync.hash(text) === st.h) continue;
                if (text.length > ER_MAX_BYTES) {
                    console.error('ER sync: entry too large to upload:', k, text.length);
                    erTooLarge.add(k);
                    continue;
                }
                erTooLarge.delete(k);
                let d;
                try { d = JSON.parse(text); } catch (e) { continue; }
                texts[k] = text;
                ops.push({ k, c: 'er', id: k, h: erHospitalOf(k), o: 0, bv: st ? st.v : 0, d, s: text });
            }
            for (let round = 0; ops.length && round < 3; round++) {
                const retry = [];
                for (const chunk of HubSync.chunkOps(ops)) {
                    let res;
                    try {
                        res = await api('POST', '/api/sync', { msg: 'ER scheduler sync', ops: chunk.map(wireOp) });
                    } catch (e) {
                        chunk.forEach(op => erDirty.add(op.k));   // try again later
                        console.warn('ER sync: upload failed, will retry:', e);
                        continue;
                    }
                    for (const [i, v] of res.applied || []) {
                        const op = chunk[i];
                        if (op.del) delete state[op.k];
                        else state[op.k] = { v, h: HubSync.hash(texts[op.k]) };
                    }
                    for (const [i, v, data] of res.conflicts || []) {
                        // Changed elsewhere since this device synced: this device's newer edit wins,
                        // the other version is preserved as a conflict copy.
                        const op = chunk[i];
                        if (v !== null && data) {
                            try {
                                await api('POST', '/api/sync', { msg: 'ER conflict copy', ops: [{ c: 'er_conflict', id: `${op.k}@server@${deviceId()}@${Date.now()}`, h: op.h || null, o: 0, bv: 0, d: JSON.parse(data) }] });
                            } catch (e) {}
                        }
                        retry.push(Object.assign({}, op, { bv: v === null ? 0 : v }));
                    }
                }
                ops.length = 0;
                ops.push(...retry);
            }
            writeErState(state);
            // Uploaded entries are in step with the server: their local edit times are no longer needed.
            const times = readEditTimes();
            Object.keys(times).forEach(k => { if (state[k] && HubSync.hash(localStorage.getItem(k) || '') === state[k].h) delete times[k]; });
            writeEditTimes(times);
        })().finally(() => { erPushing = null; erStatus(); });
        return erPushing;
    }

    const erTooLarge = new Set();
    /**
     * The save button of the ER page: uploads every ER entry that differs from the server now (no
     * waiting for the background sync) and checks that the server has them.
     * Resolves to { ok, pending, tooLarge, offline }.
     */
    async function saveErNow() {
        if (!canSyncEr()) return { ok: false, error: 'not_allowed' };
        if (!erPulled) {
            const r = await pullEr();
            if (r && r.error) return { ok: false, offline: true };
        }
        const state = readErState();
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (isErKey(k) && (!state[k] || HubSync.hash(localStorage.getItem(k) || '') !== state[k].h)) erDirty.add(k);
        }
        clearTimeout(erTimer);
        erStatus({ saving: true });
        await pushEr();
        while (erPushing) await erPushing;
        const after = readErState();
        const pending = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (isErKey(k) && (!after[k] || HubSync.hash(localStorage.getItem(k) || '') !== after[k].h)) pending.push(k);
        }
        const result = { ok: pending.length === 0, pending: pending.length, tooLarge: [...erTooLarge] };
        erStatus({ saved: result.ok });
        return result;
    }
    /** Entries of this device not yet on the server. */
    function erPendingCount() {
        const state = readErState();
        let n = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (isErKey(k) && (!state[k] || HubSync.hash(localStorage.getItem(k) || '') !== state[k].h)) n++;
        }
        return n;
    }

    async function restoreFullDatabase(payload) {
        if (!auth.isOwner()) {
            throw new Error('الاستعادة الشاملة للمنظومة مخصصة للمالك (Owner) حصراً.');
        }
        let targetDb = payload;
        if (payload && payload.hubDatabase) {
            targetDb = payload.hubDatabase;
        } else if (payload && payload.data && typeof payload.data === 'object' && payload.data.hospitals) {
            targetDb = payload.data;
        }

        if (!targetDb || typeof targetDb !== 'object' || !targetDb.hospitals) {
            throw new Error('ملف النسخة الاحتياطية لا يحتوي على قاعدة بيانات مستشفيات صالحة للاستعادة.');
        }

        // Sanitize and migrate database structure. Passwords are never restored from a file:
        // the current ones stay in force (old backups contain the old, publicly exposed passwords).
        const restored = sanitizeAndMigrateDatabase(JSON.parse(JSON.stringify(targetDb)));
        delete restored.globalPasswords;
        Object.values(restored.hospitals || {}).forEach(h => { if (h) delete h.passwords; });
        replaceDatabaseContents(restored);
        attachSecrets();

        // Restore emergency state if present in payload
        if (payload.emergencyState) {
            try {
                localStorage.setItem('hosp_hub_emergency_state_v3', typeof payload.emergencyState === 'string' ? payload.emergencyState : JSON.stringify(payload.emergencyState));
            } catch (e) {}
        }
        if (payload.emergencyAllocations && typeof payload.emergencyAllocations === 'object') {
            Object.keys(payload.emergencyAllocations).forEach(k => {
                try {
                    localStorage.setItem('hosp_hub_emergency_alloc_' + k, typeof payload.emergencyAllocations[k] === 'string' ? payload.emergencyAllocations[k] : JSON.stringify(payload.emergencyAllocations[k]));
                } catch (e) {}
            });
        }
        if (payload.emergencySchedules && typeof payload.emergencySchedules === 'object') {
            Object.keys(payload.emergencySchedules).forEach(k => {
                try {
                    localStorage.setItem('hosp_hub_emergency_sched_' + k, typeof payload.emergencySchedules[k] === 'string' ? payload.emergencySchedules[k] : JSON.stringify(payload.emergencySchedules[k]));
                } catch (e) {}
            });
        }
        if (payload.emergencyColors) {
            try {
                localStorage.setItem('hosp_hub_emergency_specialty_colors', typeof payload.emergencyColors === 'string' ? payload.emergencyColors : JSON.stringify(payload.emergencyColors));
            } catch (e) {}
        }
        if (payload.allLocalStorage && typeof payload.allLocalStorage === 'object') {
            Object.keys(payload.allLocalStorage).forEach(k => {
                if (k.startsWith('hosp_hub_') && k !== 'hosp_hub_token') {
                    try {
                        localStorage.setItem(k, typeof payload.allLocalStorage[k] === 'string' ? payload.allLocalStorage[k] : JSON.stringify(payload.allLocalStorage[k]));
                    } catch (e) {}
                }
            });
        }

        // Persist to local cache and sync to server
        await saveDatabase("Full system database restore from backup 🏥");
        return db;
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
        if (typeof id === 'string' && id.startsWith(AA_MIRROR_PREFIX)) return divisionMirrors[id] || null;
        if (!db || !db.hospitals) return null;
        return db.hospitals[id] || null;
    }

    // ------------------------------------------------------------
    // Mirrors of division job titles in the doctors' roster
    // ------------------------------------------------------------
    // A hospital admin can show chosen job titles of the hospital's division in the doctors' roster
    // as read-only "clone" specialties of the virtual hospital aa__<hospital>. The server serves
    // only those job titles' duties; getHospital() returns them like any other source hospital.

    async function fetchDivisionMirror(hosp) {
        const res = await api('GET', '/api/aa/mirror?h=' + encodeURIComponent(hosp), undefined, { retries: 1 });
        const h = res && res.hospital;
        if (!h) return null;
        (h.schedule || []).forEach(e => { if (e && HubSync) HubSync.setRid(e, HubSync.schedIdentity(e)); });
        divisionMirrors[h.id] = h;
        try { localStorage.setItem(AA_MIRROR_CACHE_KEY, JSON.stringify(divisionMirrors)); } catch (e) {}
        return h;
    }

    let mirrorsLoading = null;
    function refreshDivisionMirrors() {
        if (AA || !db || !db.hospitals || mirrorsLoading) return mirrorsLoading;
        const wanted = Object.values(db.hospitals).filter(h => h && (h.specialties || [])
            .some(s => s && s.isClone && s.clonedFromHospitalId === aaMirrorId(h.id))).map(h => h.id);
        if (!wanted.length) return null;
        mirrorsLoading = Promise.all(wanted.map(h => fetchDivisionMirror(h).catch(() => null)))
            .then(() => dispatchDataChanged())
            .finally(() => { mirrorsLoading = null; });
        return mirrorsLoading;
    }

    function getActiveHospitalId() {
        if (AA) return AA;
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
                owner: hospitalData.ownerPassword || db?.globalPasswords?.owner || '',
                admin: hospitalData.adminPassword || db?.globalPasswords?.admin || '',
                anaesthesia: hospitalData.anaesthesiaPassword || db?.globalPasswords?.anaesthesia || '',
                user: hospitalData.userPassword || db?.globalPasswords?.user || ''
            },
            icu: hospitalData.icu || {
                totalBeds: 12,
                functionalBeds: 10,
                occupiedBeds: 6,
                availableBeds: 4,
                notes: '',
                lastUpdated: new Date().toISOString(),
                updatedBy: 'مقيم التخدير'
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

        // Only OWNER can toggle erEnabled or pick the admins who use the ER page!
        if (updates.erEnabled !== undefined && !auth.isOwner()) {
            delete updates.erEnabled;
        }
        if (updates.erAdmins !== undefined && !auth.isOwner()) {
            delete updates.erAdmins;
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
            owner: newPasswords.owner || db.hospitals[id].passwords?.owner || '',
            admin: newPasswords.admin || db.hospitals[id].passwords?.admin || '',
            anaesthesia: newPasswords.anaesthesia || db.hospitals[id].passwords?.anaesthesia || '',
            user: newPasswords.user || db.hospitals[id].passwords?.user || ''
        };
        await saveDatabase(`Update passwords for hospital: ${db.hospitals[id].name_ar || db.hospitals[id].hospitalName}`);
        return db.hospitals[id].passwords;
    }

    async function updateAllPasswords(newPasswords, hospitalScope = 'all') {
        if (!auth.canEditPasswords()) {
            throw new Error('غير مصرح لك بتعديل كلمات المرور. هذه الصلاحية حصرية للمالك (Owner) فقط.');
        }

        const owner = String(newPasswords?.owner || '').trim();
        const admin = String(newPasswords?.admin || '').trim();
        const anaesthesia = String(newPasswords?.anaesthesia || '').trim();
        const user = String(newPasswords?.user || '').trim();

        if (!owner || !admin || !user) {
            throw new Error('الرجاء إدخال جميع كلمات المرور المطلوبة.');
        }

        const pwdObj = {
            owner,
            admin,
            anaesthesia: anaesthesia || (hospitalScope === 'all' ? (db?.globalPasswords?.anaesthesia || '') : (db?.hospitals?.[hospitalScope]?.passwords?.anaesthesia || '')),
            user
        };

        if (hospitalScope === 'all') {
            // Update global passwords (General User, Anaesthesia, General Admin for all hospitals, Owner)
            db.globalPasswords = { ...pwdObj };

            // Ensure any hospital missing passwords gets initialized, but do NOT wipe out existing distinct hospital passwords
            if (db.hospitals) {
                Object.keys(db.hospitals).forEach(hId => {
                    if (!db.hospitals[hId].passwords) {
                        db.hospitals[hId].passwords = { ...pwdObj };
                    }
                });
            }
            await saveDatabase('تحديث كلمات المرور العامة للمنظومة (المستخدم العام، مقيم التخدير، المدير العام، المالك)');
        } else if (db.hospitals && db.hospitals[hospitalScope]) {
            // Update passwords strictly for the selected hospital only
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
        if (auth.isRotator()) throw new Error('حساب الروتيتر للعرض والتعليق فقط');
        if (!AA && auth.isOfficer()) throw new Error('موظفو الشؤون الإدارية يبدّلون خفاراتهم في جدول الشؤون الإدارية فقط');
        if (!auth.canExchangeIn(hospitalId)) throw new Error('يمكنك تبديل الخفارات في مستشفاك فقط');
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

    async function incrementVisitCount(hospitalId, residentName, specCode = null, sourceHospitalId = null) {
        let hospital = getHospital(hospitalId);
        if (!hospital && !sourceHospitalId) return 0;

        const today = getMedicalDate();

        function namesMatch(n1, n2) {
            if (!n1 || !n2) return false;
            if (n1 === n2) return true;
            const clean = s => String(s || '').replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim().replace(/\s+/g, ' ');
            return clean(n1) === clean(n2);
        }

        function datesMatch(d1, d2) {
            if (!d1 || !d2) return false;
            if (d1 === d2) return true;
            return normalizeDateString(d1) === normalizeDateString(d2);
        }

        // 1. If explicit sourceHospitalId is provided (mirrored card)
        if (sourceHospitalId && sourceHospitalId !== hospitalId) {
            const srcHosp = getHospital(sourceHospitalId);
            if (srcHosp) {
                const entry = (srcHosp.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName));
                if (entry) {
                    bumpVisit(entry);
                    return entry.VisitCount;
                }
            }
        }

        // 2. Check if specCode in current hospital is a clone
        if (hospital && specCode) {
            const specObj = (hospital.specialties || []).find(s => s.id === specCode);
            if (specObj && specObj.isClone && specObj.clonedFromHospitalId) {
                const srcHosp = getHospital(specObj.clonedFromHospitalId);
                if (srcHosp) {
                    const targetSpec = specObj.clonedFromSpecId || specCode;
                    const entry = (srcHosp.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName) && (!targetSpec || s.specCode === targetSpec))
                               || (srcHosp.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName));
                    if (entry) {
                        bumpVisit(entry);
                        return entry.VisitCount;
                    }
                }
            }
        }

        // 3. Search in current hospital's schedule
        if (hospital) {
            let entry = null;
            if (specCode) {
                entry = (hospital.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName) && s.specCode === specCode);
            }
            if (!entry) {
                entry = (hospital.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName));
            }
            if (entry) {
                bumpVisit(entry);
                return entry.VisitCount;
            }

            // 4. Check all clone specialties in this hospital
            const cloneSpecs = (hospital.specialties || []).filter(s => s && s.isClone && s.clonedFromHospitalId);
            for (const cs of cloneSpecs) {
                const srcHosp = getHospital(cs.clonedFromHospitalId);
                if (srcHosp) {
                    const clonedEntry = (srcHosp.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName) && (!cs.clonedFromSpecId || s.specCode === cs.clonedFromSpecId))
                                     || (srcHosp.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName));
                    if (clonedEntry) {
                        bumpVisit(clonedEntry);
                        return clonedEntry.VisitCount;
                    }
                }
            }
        }

        // 5. Ultimate fallback: Check ALL hospitals for this resident on duty today
        const allHospitals = getHospitals() || [];
        for (const h of allHospitals) {
            const entry = (h.schedule || []).find(s => datesMatch(s.date, today) && namesMatch(s.name, residentName));
            if (entry) {
                bumpVisit(entry);
                return entry.VisitCount;
            }
        }

        return 0;
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
                : (AA ? [] : CANONICAL_SPECIALTIES);
            db.globalSpecialties = JSON.parse(JSON.stringify(source));
            specs = db.globalSpecialties;
        } else {
            specs = AA ? [] : JSON.parse(JSON.stringify(CANONICAL_SPECIALTIES));
        }

        // Deduplicate strictly by canonical ID AND normalized Arabic name!
        // Never include clones or legacy clone IDs in the global store.
        const seenIds = new Set();
        const seenNames = new Set();
        const deduplicated = [];

        for (const s of specs) {
            if (!s || !s.id) continue;
            // Never include hospital clone specialties in global catalog
            if (s.isClone || s.clonedFromHospitalId || /_(iraqi|basra|mawani)$/i.test(s.id)) continue;

            let canonId = normalizeSpecialtyId(s.id);
            const canonByName = s.name_ar ? normalizeSpecialtyId(s.name_ar) : null;
            if (canonByName && CANONICAL_SPECIALTIES.some(cs => cs.id === canonByName)) {
                canonId = canonByName;
            }
            const normName = normalizeArabicSpecName(s.name_ar);

            if (seenIds.has(canonId)) continue;
            if (normName && seenNames.has(normName)) continue;

            seenIds.add(canonId);
            if (normName) seenNames.add(normName);
            deduplicated.push(s);
        }

        return deduplicated;
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

        if (AA) {
            const any = Object.values(db?.hospitals || {}).flatMap(h => h.specialties || []).find(s => s.id === specCode);
            return (any && any.name_ar) || specCode;
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
        const cloneSpecs = [];
        (hosp.specialties || []).forEach(s => {
            if (!s) return;
            if (s.isClone) {
                cloneSpecs.push(s);
                return;
            }
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

        // Hospital specialties are strictly drawn from the Main Specialty Store, plus preserved clones
        const syncedGlobals = globals.map(g => {
            const cur = currentMap.get(g.id);
            return {
                ...g,
                enabled: cur ? (cur.enabled !== false) : true,
                color: cur?.color || g.color || '#0f766e'
            };
        });
        hosp.specialties = [...syncedGlobals, ...cloneSpecs];
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

        const prefix = (updatedData.prefix !== undefined) ? updatedData.prefix : (db.globalSpecialties[idx].prefix !== undefined ? db.globalSpecialties[idx].prefix : 'د. ');

        // Update target item in globalSpecialties
        const branch = updatedData.branch !== undefined ? cleanBranch(updatedData.branch) : cleanBranch(db.globalSpecialties[idx].branch);
        db.globalSpecialties[idx] = {
            id: newId,
            name_ar: nameAr,
            name_en: nameEn,
            icon: icon,
            prefix: prefix,
            parentSpec: parentSpec,
            acceptPool: acceptPool,
            enabled: db.globalSpecialties[idx].enabled !== false,
            ...(branch ? { branch } : {})
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
                    hospSpec.prefix = prefix;
                    hospSpec.parentSpec = parentSpec;
                    if (updatedData.branch !== undefined) { if (branch) hospSpec.branch = branch; else delete hospSpec.branch; }
                }
            });
        }

        // Cascade update to all residents belonging to this specialty if requested
        if (updatedData.updateExistingResidents !== false) {
            (db.residents || []).forEach(r => {
                if (r.spec === oldId || r.spec === newId) {
                    const oldName = r.name;
                    const newName = formatMemberName(oldName, prefix);
                    if (newName !== oldName) {
                        r.name = newName;
                        Object.values(db.hospitals || {}).forEach(h => {
                            (h.schedule || []).forEach(sch => {
                                if (sch.name === oldName) sch.name = newName;
                            });
                        });
                    }
                }
            });
            syncHospitalsWithSharedResidents();
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
        const prefix = (specData.prefix !== undefined) ? specData.prefix : 'د. ';
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
            prefix,
            parentSpec,
            acceptPool,
            enabled: true,
            ...(cleanBranch(specData.branch) ? { branch: cleanBranch(specData.branch) } : {})
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

        const prefix = (specData.prefix !== undefined) ? specData.prefix : (AA ? '' : 'د. ');

        let existingGlobal = db.globalSpecialties.find(s => s.id === specId || s.name_ar === nameAr);
        if (!existingGlobal) {
            existingGlobal = {
                id: specId,
                name_ar: nameAr,
                name_en: specData.name_en ? specData.name_en.trim() : nameAr,
                icon: specData.icon ? specData.icon.trim() : '🏥',
                prefix: prefix,
                parentSpec: specData.parentSpec ? String(specData.parentSpec).trim().toUpperCase() : null,
                acceptPool: Array.isArray(specData.acceptPool) ? specData.acceptPool : [],
                enabled: true,
                ...(cleanBranch(specData.branch) ? { branch: cleanBranch(specData.branch) } : {})
            };
            db.globalSpecialties.push(existingGlobal);
        } else if (specData.prefix !== undefined) {
            existingGlobal.prefix = prefix;
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
            existingInHosp.prefix = prefix;
        } else {
            hosp.specialties.push({
                ...existingGlobal,
                color: color,
                prefix: prefix,
                enabled: true
            });
        }
        if (cleanBranch(specData.branch)) (existingInHosp || hosp.specialties[hosp.specialties.length - 1]).branch = cleanBranch(specData.branch);

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
            if (g.prefix !== undefined) existing.prefix = g.prefix;
        } else {
            hosp.specialties.push({
                ...g,
                prefix: (g.prefix !== undefined) ? g.prefix : 'د. ',
                color: color || '#0f766e',
                enabled: true
            });
        }

        await saveDatabase(`Add specialty ${specId} to ${hosp.hospitalName}`);
        return hosp.specialties;
    }

    async function addHospitalCloneSpecialty(targetHospitalId, sourceHospitalId, sourceSpecId, customColor = null) {
        if (!auth.isAdmin(targetHospitalId)) {
            throw new Error('غير مصرح لك بإضافة تخصص لهذا المستشفى. يتطلب صلاحيات مدير.');
        }
        if (targetHospitalId === sourceHospitalId) {
            throw new Error('لا يمكن استنساخ تخصص من نفس المستشفى.');
        }
        const fromDivision = sourceHospitalId.startsWith(AA_MIRROR_PREFIX);
        if (fromDivision && sourceHospitalId !== aaMirrorId(targetHospitalId)) {
            throw new Error('يمكن عرض العناوين الوظيفية للشؤون الإدارية في المستشفى نفسه فقط.');
        }
        const targetHosp = getHospital(targetHospitalId);
        if (!targetHosp) throw new Error('المستشفى المستهدف غير موجود.');
        const sourceHosp = getHospital(sourceHospitalId);
        if (!sourceHosp) throw new Error('المستشفى المصدر غير موجود.');

        const sourceSpec = (sourceHosp.specialties || []).find(s => s.id === sourceSpecId);
        if (!sourceSpec) throw new Error('التخصص غير موجود في المستشفى المصدر.');

        if (!Array.isArray(targetHosp.specialties)) targetHosp.specialties = [];

        // Check if this specialty from this source is already cloned
        let existingClone = targetHosp.specialties.find(s => s.isClone && s.clonedFromHospitalId === sourceHospitalId && s.clonedFromSpecId === sourceSpecId);
        if (existingClone) {
            existingClone.enabled = true;
            if (customColor) existingClone.color = customColor;
            await saveDatabase(`Re-enabled clone specialty ${sourceSpecId} from ${sourceHospitalId} into ${targetHospitalId}`);
            return existingClone;
        }

        // Determine unique ID in target hospital
        let newId = sourceSpecId;
        if (targetHosp.specialties.some(s => s.id === newId)) {
            newId = `${sourceSpecId}_${sourceHospitalId}`;
        }
        let counter = 1;
        while (targetHosp.specialties.some(s => s.id === newId)) {
            newId = `${sourceSpecId}_${sourceHospitalId}_${counter++}`;
        }

        const cloneObj = {
            id: newId,
            name_ar: sourceSpec.name_ar,
            name_en: sourceSpec.name_en || sourceSpec.name_ar,
            icon: sourceSpec.icon || '🏥',
            prefix: (sourceSpec.prefix !== undefined) ? sourceSpec.prefix : 'د. ',
            color: customColor || sourceSpec.color || '#0f766e',
            isClone: true,
            clonedFromHospitalId: sourceHospitalId,
            clonedFromSpecId: sourceSpecId,
            enabled: true
        };

        targetHosp.specialties.push(cloneObj);
        await saveDatabase(`Add clone specialty ${newId} (mirrored from ${sourceHosp.name_ar || sourceHospitalId} - ${sourceSpec.name_ar}) to ${targetHosp.name_ar || targetHospitalId}`);
        // The server now serves this job title's duties too.
        if (fromDivision) fetchDivisionMirror(targetHospitalId).then(dispatchDataChanged).catch(() => {});
        return cloneObj;
    }

    async function updateHospitalSpecialty(hospitalId, specId, updates) {
        if (!auth.isAdmin(hospitalId)) {
            throw new Error('غير مصرح لك بتعديل التخصص في هذا المستشفى.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود');

        const s = (hosp.specialties || []).find(x => x.id === specId);
        if (!s) throw new Error('التخصص غير موجود في المستشفى');
        const oldNameAr = s.name_ar;

        if (updates.name_ar) s.name_ar = updates.name_ar.trim();
        if (updates.name_en) s.name_en = updates.name_en.trim();
        if (updates.icon) s.icon = updates.icon.trim();
        if (updates.color) s.color = updates.color;
        if (updates.enabled !== undefined) s.enabled = Boolean(updates.enabled);
        if (updates.acceptPool !== undefined) s.acceptPool = Array.isArray(updates.acceptPool) ? updates.acceptPool : [];
        if (updates.branch !== undefined) { const b = cleanBranch(updates.branch); if (b) s.branch = b; else delete s.branch; }

        if (updates.prefix !== undefined) {
            s.prefix = updates.prefix;

            // Cascade update to existing residents in this hospital if requested
            if (updates.updateExistingResidents !== false) {
                const newPrefix = updates.prefix;
                (hosp.names || []).forEach(r => {
                    if (r.spec === specId || r.tag === specId) {
                        const oldName = r.name;
                        const newName = formatMemberName(oldName, newPrefix);
                        if (newName !== oldName) {
                            r.name = newName;
                            if (Array.isArray(db.residents)) {
                                const master = db.residents.find(m => m.id === r.id || m.name === oldName);
                                if (master) master.name = newName;
                            }
                            (hosp.schedule || []).forEach(sch => {
                                if (sch.name === oldName) sch.name = newName;
                            });
                        }
                    }
                });
                syncHospitalsWithSharedResidents();
            }
        }

        await saveDatabase(`Update specialty ${specId} in ${hosp.name_ar || hosp.hospitalName}`);
        // The residents' accounts name their specialty in Arabic: a renamed specialty is renamed there too.
        // (Names and schedules follow above and on the server; the ER page follows the hospital records.)
        if (oldNameAr && s.name_ar && oldNameAr !== s.name_ar) {
            try { await api('POST', '/api/accounts/specialty-rename', { hosp: hospitalId, from: oldNameAr, to: s.name_ar }, { retries: 1 }); } catch (e) { console.warn('Specialty rename in accounts:', e); }
        }
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

        // A specialty is retained if it is a clone OR at least one resident has it as their primary specialty (spec) or assigned rotation (dept)
        hosp.specialties = (hosp.specialties || []).filter(s => {
            if (s.isClone) return true;
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

        // Cloned specialty: delegates to source hospital
        if (specObj && specObj.isClone && specObj.clonedFromHospitalId) {
            const srcHosp = getHospital(specObj.clonedFromHospitalId);
            if (srcHosp) {
                return getEligibleResidentsForSpecialty(srcHosp, specObj.clonedFromSpecId);
            }
        }

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
        if (!db || !idOrName) return null;
        const list = getResidents();
        let match = list.find(r => r.id === idOrName || r.name === idOrName);
        if (!match && typeof idOrName === 'string') {
            const cleanTarget = idOrName.replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim();
            match = list.find(r => (r.name || '').replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim() === cleanTarget);
        }
        return match || null;
    }

    function getAnaesthesiaResidents(hospitalId = null) {
        const targetHosp = hospitalId || getActiveHospitalId() || 'iraqi';
        const uniqueNames = new Set();

        const allResidents = getResidents(targetHosp);
        allResidents.forEach(r => {
            const spec = r.spec || '';
            const dept = r.dept || r.department || '';
            const isAnaesth = ['A', 'ICU', 'OP', 'GA'].includes(spec) ||
                              ['A', 'ICU', 'OP', 'GA'].includes(dept) ||
                              spec.includes('تخدير') ||
                              dept.includes('تخدير');
            if (isAnaesth && r.name && r.name.trim()) {
                uniqueNames.add(r.name.trim());
            }
        });

        if (db?.hospitals?.[targetHosp]?.names) {
            db.hospitals[targetHosp].names.forEach(n => {
                const spec = n.spec || '';
                const dept = n.dept || n.department || '';
                const isAnaesth = ['A', 'ICU', 'OP', 'GA'].includes(spec) ||
                                  ['A', 'ICU', 'OP', 'GA'].includes(dept) ||
                                  spec.includes('تخدير') ||
                                  dept.includes('تخدير');
                if (isAnaesth && n.name && n.name.trim()) {
                    uniqueNames.add(n.name.trim());
                }
            });
        }

        return Array.from(uniqueNames).sort((a, b) => a.localeCompare(b, 'ar'));
    }

    function getCurrentIcuResident(hospitalId = null, targetDate = null) {
        const targetHospId = hospitalId || getActiveHospitalId() || 'iraqi';
        const hosp = getHospital(targetHospId);
        if (!hosp || !Array.isArray(hosp.schedule)) return null;

        const date = normalizeDateString(targetDate || getMedicalDate());
        const currentMin = getCurrentMedicalMinutes();

        // 1. Look for explicit ICU specialty entries for target date
        let entries = hosp.schedule.filter(s => {
            const d = normalizeDateString(s.date);
            const code = String(s.specCode || '').toUpperCase();
            return (d === date) && (code === 'ICU');
        });

        // 2. Fallback to general Anaesthesia codes if no 'ICU' entry found for target date
        if (entries.length === 0) {
            entries = hosp.schedule.filter(s => {
                const d = normalizeDateString(s.date);
                const code = String(s.specCode || '').toUpperCase();
                return (d === date) && (code === 'AO' || code === 'A' || code === 'OP' || code === 'GA');
            });
        }

        // 3. Fallback to any entry whose specialty name or department contains تخدير / عناية
        if (entries.length === 0) {
            entries = hosp.schedule.filter(s => {
                const d = normalizeDateString(s.date);
                if (d !== date) return false;
                const specName = getSpecialtyName(s.specCode, targetHospId) || '';
                return specName.includes('تخدير') || specName.includes('عناية');
            });
        }

        entries = entries.filter(e => {
            const n = String(e.name || '').trim();
            return n && !n.includes('بدون خفر') && !n.includes('بدون خفارة');
        });

        if (entries.length === 0) return null;
        if (entries.length === 1) return String(entries[0].name).trim();

        // 4. Multi-slot or shift duty resolution
        const TOTAL_MINUTES = 24 * 60;
        function parseTimeStr(str) {
            const match = String(str || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (!match) return null;
            let hrs = parseInt(match[1], 10);
            const mins = parseInt(match[2], 10);
            const ampm = match[3].toUpperCase();
            if (ampm === 'PM' && hrs !== 12) hrs += 12;
            if (ampm === 'AM' && hrs === 12) hrs = 0;
            let total = hrs * 60 + mins;
            if (total < 8 * 60) total += 24 * 60;
            return total - (8 * 60);
        }

        function parseDutyTimeRange(str) {
            if (!str || !str.includes(' - ')) return null;
            const parts = str.split(' - ');
            const start = parseTimeStr(parts[0].trim());
            const end = parseTimeStr(parts[1].trim());
            if (start === null || end === null) return null;
            return { start, end };
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            let timeData = parseDutyTimeRange(entry.dutyTime);
            if (!timeData) {
                const slotIdx = (typeof entry.dutySlot === 'number') ? entry.dutySlot : i;
                const slotDuration = TOTAL_MINUTES / entries.length;
                timeData = { start: slotIdx * slotDuration, end: (slotIdx + 1) * slotDuration };
            }
            if (timeData) {
                const { start, end } = timeData;
                if (end <= start) {
                    if (currentMin >= start || currentMin < end) return String(entry.name).trim();
                } else {
                    if (currentMin >= start && currentMin < end) return String(entry.name).trim();
                }
            }
        }

        return String(entries[0].name).trim();
    }

    function getSpecialtyPrefix(specId, hospitalId = null) {
        if (!specId || !db) return AA ? '' : 'د. ';
        const normSpecId = normalizeSpecialtyId(specId);
        // 1. Check hospital specialties
        const targetHospId = hospitalId || getActiveHospitalId();
        if (targetHospId && db.hospitals?.[targetHospId]?.specialties) {
            const hospSpec = db.hospitals[targetHospId].specialties.find(s => s.id === normSpecId);
            if (hospSpec && hospSpec.prefix !== undefined) {
                return hospSpec.prefix;
            }
        }
        // 2. Check global specialties
        const globalSpec = (db.globalSpecialties || CANONICAL_SPECIALTIES).find(s => s.id === normSpecId);
        if (globalSpec && globalSpec.prefix !== undefined) {
            return globalSpec.prefix;
        }
        // 3. Fallback: check any hospital
        for (const hid in db.hospitals || {}) {
            const hs = (db.hospitals[hid].specialties || []).find(s => s.id === normSpecId);
            if (hs && hs.prefix !== undefined) return hs.prefix;
        }
        return AA ? '' : 'د. ';
    }

    function formatMemberName(rawName, prefix = 'د. ') {
        if (!rawName || typeof rawName !== 'string') return '';
        let cleaned = rawName.trim();
        cleaned = cleaned.replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim();
        if (!cleaned) return '';
        if (prefix === '' || prefix === null) return cleaned;
        const p = String(prefix).trim();
        return p ? `${p} ${cleaned}` : cleaned;
    }

    function formatIraqiPhoneNumber(rawPhone) {
        if (!rawPhone || typeof rawPhone !== 'string') return '';
        let p = rawPhone.trim();
        if (p === 'رقم غير متوفر' || p === 'غير متوفر' || p === 'N/A' || p === 'None' || p === 'بدون هاتف') return 'رقم غير متوفر';

        // Convert Arabic/Persian digits to English ASCII digits
        const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
        const persianDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
        for (let i = 0; i < 10; i++) {
            p = p.split(arabicDigits[i]).join(String(i));
            p = p.split(persianDigits[i]).join(String(i));
        }

        const hadPlus = p.startsWith('+');
        let digits = p.replace(/\D/g, '');
        if (!digits) return '';

        // Handle 00964 prefix or 964 prefix
        if (digits.startsWith('00964')) {
            digits = digits.substring(5);
        } else if (digits.startsWith('964')) {
            digits = digits.substring(3);
        }

        // Now digits is without 964. If it starts with 0 (e.g. 07XXXXXXXXX), remove all leading zeros
        while (digits.startsWith('0')) {
            digits = digits.substring(1);
        }

        if (!digits) return '';

        return '+964' + digits;
    }

    function isValidIraqiPhoneNumber(phone) {
        if (!phone || phone === 'رقم غير متوفر') return true;
        return /^\+9647\d{9}$/.test(phone);
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
                    const cleanPhone = (n.phone && n.phone !== 'رقم غير متوفر') ? (formatIraqiPhoneNumber(n.phone) || n.phone) : '';
                    map.set(name, {
                        id: n.id || ('res-' + Math.random().toString(36).substr(2, 9)),
                        name: name,
                        phone: cleanPhone,
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
                        existing.phone = formatIraqiPhoneNumber(n.phone) || n.phone;
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

        let hospitals = Array.isArray(residentData.hospitals) ? residentData.hospitals : [];
        if (hospitals.length === 0) {
            hospitals = [residentData.hospitalId || getActiveHospitalId()];
        }

        const spec = normalizeSpecialtyId(residentData.spec || 'GS');
        const dept = normalizeSpecialtyId(residentData.dept || residentData.department || spec);

        const targetPrefix = (residentData.prefix !== undefined) 
            ? residentData.prefix 
            : getSpecialtyPrefix(spec, hospitals[0]);
        const formattedName = formatMemberName(name, targetPrefix);

        const cleanPhone = (residentData.phone && residentData.phone !== 'رقم غير متوفر')
            ? (formatIraqiPhoneNumber(residentData.phone) || String(residentData.phone).trim())
            : (residentData.phone || '').trim();

        const newRes = {
            id: 'res-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            name: formattedName,
            phone: cleanPhone,
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

    // Same name key as the API (worker/src/names.js): spelling variants, titles and "عبد الله" spacing
    // all give one key, so a duty written "د. علي حسن" and "علي حسن" belong to the same resident.
    const NAME_TITLES = new Set(['د', 'دكتور', 'الدكتور', 'دكتوره', 'الدكتوره', 'dr', 'doctor', 'م', 'ص',
        'ا', 'استاذ', 'الاستاذ', 'مهندس', 'المهندس', 'mr', 'mrs', 'ms', 'miss']);
    const NAME_JOINERS = new Set(['عبد', 'ابو', 'أبو']);
    function nameKeyOf(name) {
        const cleaned = String(name || '').normalize('NFKC').toLowerCase()
            .replace(/[ً-ٰٟـ]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
            .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const raw = cleaned ? cleaned.split(' ') : [];
        while (raw.length > 1 && NAME_TITLES.has(raw[0])) raw.shift();
        const out = [];
        for (let i = 0; i < raw.length; i++) {
            if (NAME_JOINERS.has(raw[i]) && i + 1 < raw.length) { out.push(raw[i] + raw[i + 1]); i++; }
            else out.push(raw[i]);
        }
        return out.join(' ');
    }

    /**
     * A resident's new name replaces the old one in the roster of every month of their hospitals, so
     * their duties, statistics, likes and comments stay theirs. (The API does the same for anything a
     * client missed, and renames the linked account.) Skipped when another resident of those
     * hospitals has the same name: their duties could not be told apart.
     */
    function renameInSchedules(before, after) {
        const oldKey = nameKeyOf(before.name);
        if (!oldKey || before.name === after.name) return 0;
        const hospitals = new Set([...(before.hospitals || []), ...(after.hospitals || [])]);
        const twin = (db.residents || []).some(r => r !== before && r.id !== before.id && nameKeyOf(r.name) === oldKey
            && (r.hospitals || []).some(h => hospitals.has(h)));
        if (twin) return 0;
        let n = 0;
        hospitals.forEach(hId => {
            const h = db.hospitals && db.hospitals[hId];
            (h && Array.isArray(h.schedule) ? h.schedule : []).forEach(e => {
                if (e && e.name && e.name !== after.name && nameKeyOf(e.name) === oldKey) { e.name = after.name; n++; }
            });
        });
        return n;
    }

    async function updateResident(idOrName, updates) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بتعديل بيانات المقيم. يتطلب صلاحيات المدير.');
        }
        if (!db) throw new Error('قاعدة البيانات غير محملة');
        if (!Array.isArray(db.residents)) {
            syncSharedResidentsFromHospitals();
        }

        let idx = db.residents.findIndex(r => r.id === idOrName || r.name === idOrName);
        if (idx === -1 && typeof idOrName === 'string') {
            const cleanTarget = idOrName.replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim();
            idx = db.residents.findIndex(r => (r.name || '').replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim() === cleanTarget);
        }
        if (idx === -1) throw new Error('المقيم غير موجود');

        const current = db.residents[idx];
        const updated = {
            ...current,
            ...updates
        };

        const targetSpec = updates.spec ? normalizeSpecialtyId(updates.spec) : updated.spec;
        const targetPrefix = (updates.prefix !== undefined)
            ? updates.prefix
            : getSpecialtyPrefix(targetSpec, updated.hospitals?.[0]);

        if (updates.name) {
            updated.name = formatMemberName(updates.name, targetPrefix);
        } else if (updates.spec && updates.spec !== current.spec) {
            updated.name = formatMemberName(updated.name, targetPrefix);
        }

        if (updates.phone !== undefined) {
            const rawP = String(updates.phone || '').trim();
            updated.phone = (rawP && rawP !== 'رقم غير متوفر') ? (formatIraqiPhoneNumber(rawP) || rawP) : rawP;
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

        renameInSchedules(current, updated);
        db.residents[idx] = updated;
        syncHospitalsWithSharedResidents();

        await saveDatabase(current.name !== updated.name ? `Update Resident: ${current.name} -> ${updated.name}` : `Update Resident: ${updated.name}`);
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

        let idx = db.residents.findIndex(r => r.id === idOrName || r.name === idOrName);
        if (idx === -1 && typeof idOrName === 'string') {
            const cleanTarget = idOrName.replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim();
            idx = db.residents.findIndex(r => (r.name || '').replace(/^(د\.|د|dr\.|dr|mr\.|mr|ms\.|ms|أ\.|أ|م\.|م|ص\.|ص)[\s\:\/]+/gi, '').trim() === cleanTarget);
        }
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
        if (!canAddSpecialist()) {
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
        // A hospital's admin keeps to the specialists of their own hospitals; a resident to their specialty there.
        if ((specialist && !canManageSpecialist(specialist)) || !canManageSpecialist({ hospitals, spec })) {
            throw new Error(residentSpecialistScope()
                ? 'يمكنك إضافة وتعديل أطباء اختصاصك (أو اختصاص دورتك) في مستشفاك فقط.'
                : 'يمكنك إدارة أطباء الاختصاص في مستشفاك فقط.');
        }

        const rawSpecPhone = String(specialistData.phone || '').trim();
        const cleanSpecPhone = (rawSpecPhone && rawSpecPhone !== 'رقم غير متوفر')
            ? (formatIraqiPhoneNumber(rawSpecPhone) || rawSpecPhone)
            : rawSpecPhone;

        if (specialist) {
            specialist.name = formattedName;
            specialist.title = (specialistData.title || 'أخصائي').trim();
            specialist.spec = spec;
            specialist.specName = specName;
            specialist.hospitals = hospitals;
            specialist.phone = cleanSpecPhone;
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
                phone: cleanSpecPhone,
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
        if (!canAddSpecialist()) {
            throw new Error('غير مصرح لك بتعديل جدول الطبيب الاختصاصي. يتطلب صلاحيات المدير أو المالك.');
        }
        if (!db || !Array.isArray(db.specialists)) throw new Error('قاعدة البيانات غير محملة');
        const specialist = db.specialists.find(s => s.id === specialistId);
        if (!specialist) throw new Error('الطبيب الاختصاصي غير موجود');
        if (!canManageSpecialist(specialist)) throw new Error('يمكنك إدارة أطباء الاختصاص في مستشفاك فقط.');

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
        if (!canDeleteSpecialist(db.specialists[idx])) throw new Error('يمكنك حذف أطباء الاختصاص في مستشفاك فقط.');

        const deleted = db.specialists.splice(idx, 1)[0];
        await saveDatabase(`Delete Specialist: ${deleted.name}`);
        return deleted;
    }

    /** Owner: every specialist. A hospital's admin: the specialists working in their hospitals (the API checks it too). */
    function canDeleteSpecialist(specOrId) {
        const s = typeof specOrId === 'string' ? getSpecialist(specOrId) : specOrId;
        if (!s) return false;
        const role = auth.getRole();
        if (role === 'owner') return true;
        if (role !== 'admin') return false;
        const ids = auth.getAdminHospitalIds() || [];
        return ids.includes('*') || (Array.isArray(s.hospitals) && s.hospitals.some(h => ids.includes(h)));
    }

    // The per-hospital switch letting residents add and edit the cards of their own specialty or rotation
    // (GET /api/specialists/settings: the hospitals switched on, and this resident's hospital and codes).
    let specialistEdit = { on: [], me: null };
    async function loadSpecialistEditSettings() {
        if (!readApiToken()) { specialistEdit = { on: [], me: null }; return specialistEdit; }
        try {
            const res = await api('GET', '/api/specialists/settings', undefined, { retries: 1 });
            specialistEdit = { on: Array.isArray(res.on) ? res.on : [], me: res.me || null };
        } catch (e) { /* offline: keep what we had */ }
        return specialistEdit;
    }
    async function setSpecialistEditSwitch(hospitalId, on) {
        const res = await api('POST', '/api/specialists/settings', { hosp: hospitalId, on: !!on }, { retries: 0 });
        specialistEdit.on = Array.isArray(res.on) ? res.on : specialistEdit.on;
        return specialistEdit.on;
    }
    const specialtyCode = v => String(normalizeSpecialtyId(v) || '').toUpperCase();
    /** This resident's hospital and specialty codes while that hospital's switch is on, otherwise null. */
    function residentSpecialistScope() {
        const role = auth.getRole();
        const me = specialistEdit.me;
        if ((role !== 'user' && role !== 'anaesthesia') || !me || !specialistEdit.on.includes(me.hosp)) return null;
        return { hosp: me.hosp, codes: (me.codes || []).map(specialtyCode) };
    }

    /** Admins and the owner as for deleting; a resident (switch on) the cards of their specialty in their hospital. */
    function canManageSpecialist(specOrId) {
        const s = typeof specOrId === 'string' ? getSpecialist(specOrId) : specOrId;
        if (!s) return false;
        if (auth.isAdmin()) return canDeleteSpecialist(s);
        const scope = residentSpecialistScope();
        return !!scope && Array.isArray(s.hospitals) && s.hospitals.includes(scope.hosp) && scope.codes.includes(specialtyCode(s.spec));
    }
    const canAddSpecialist = () => auth.isAdmin() || !!residentSpecialistScope();

    /** Residents who may accompany a specialist: same original specialty or rotating in it, in the specialist's hospitals. */
    function getSpecialistResidentCandidates(id) {
        const s = getSpecialist(id);
        if (!s) return [];
        const spec = normalizeSpecialtyId(s.spec);
        const hosps = Array.isArray(s.hospitals) ? s.hospitals : [];
        const anyHosp = !hosps.length || hosps.includes('all');
        return getResidents().filter(r => r && r.active !== false
            && (normalizeSpecialtyId(r.spec) === spec || normalizeSpecialtyId(r.dept || r.department) === spec)
            && (anyHosp || (Array.isArray(r.hospitals) && r.hospitals.some(h => hosps.includes(h)))));
    }

    /** The residents assigned to a specialist (stored by id, so renames show everywhere; removed residents drop out). */
    function getSpecialistResidents(id) {
        const s = getSpecialist(id);
        if (!s || !Array.isArray(s.residents)) return [];
        const byId = new Map(getResidents().map(r => [r.id, r]));
        return s.residents.map(rid => byId.get(rid)).filter(Boolean);
    }

    async function setSpecialistResidents(id, residentIds) {
        const s = getSpecialist(id);
        if (!s) throw new Error('الطبيب الاختصاصي غير موجود');
        if (!canManageSpecialist(s)) throw new Error('غير مصرح لك بتعديل مقيمي هذا الطبيب. يتاح ذلك لمدير مستشفاه والمالك فقط.');
        const allowed = new Set(getSpecialistResidentCandidates(id).map(r => r.id));
        s.residents = [...new Set(residentIds || [])].filter(rid => allowed.has(rid));
        await saveDatabase(`Assigned Residents: ${s.name}`);
        return s.residents;
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

        const localEntries = scheduleArray.filter(entry => {
            if (!entry.date) return false;
            const norm = normalizeDateString(entry.date);
            const parts = norm.split('/');
            if (parts.length === 3) {
                return parts[1] === padMonth && parts[2] === strYear;
            }
            return false;
        });

        // Live Mirror: Include entries for any cloned specialties from their parent hospitals!
        const cloneEntries = [];
        (hosp.specialties || []).forEach(spec => {
            if (spec.isClone && spec.clonedFromHospitalId && spec.clonedFromSpecId && spec.enabled !== false) {
                const sourceHosp = getHospital(spec.clonedFromHospitalId);
                if (!sourceHosp) return;
                const srcSchedule = scheduleType === 'specialists' ? sourceHosp.specialistSchedule : sourceHosp.schedule;
                if (!Array.isArray(srcSchedule)) return;
                srcSchedule.forEach(entry => {
                    if (entry.specCode === spec.clonedFromSpecId && entry.date) {
                        const norm = normalizeDateString(entry.date);
                        const parts = norm.split('/');
                        if (parts.length === 3 && parts[1] === padMonth && parts[2] === strYear) {
                            cloneEntries.push({
                                ...entry,
                                specCode: spec.id,
                                isClone: true,
                                clonedFromHospitalId: spec.clonedFromHospitalId,
                                clonedFromSpecId: spec.clonedFromSpecId,
                                parentHospitalName: sourceHosp.name_ar || sourceHosp.hospitalName || spec.clonedFromHospitalId
                            });
                        }
                    }
                });
            }
        });

        return [...localEntries, ...cloneEntries];
    }

    // ============================================================
    // ICU BEDS & OCCUPANCY MANAGEMENT (إحصائيات وموقف أسرة العناية المركزة)
    // ============================================================
    function getICUStats(hospitalId) {
        if (!db || !db.hospitals) return null;
        const targetId = hospitalId || getActiveHospitalId();
        const hosp = getHospital(targetId);
        if (!hosp) return null;

        const defaultStats = {
            totalBeds: 12,
            functionalBeds: 10,
            occupiedBeds: 6,
            availableBeds: 4,
            notes: '',
            lastUpdated: hosp.lastUpdated || new Date().toISOString(),
            updatedBy: 'مقيم التخدير'
        };

        const icu = hosp.icu || defaultStats;
        const total = Math.max(0, parseInt(icu.totalBeds ?? defaultStats.totalBeds, 10));
        const functional = Math.max(0, Math.min(total, parseInt(icu.functionalBeds ?? defaultStats.functionalBeds, 10)));
        const occupied = Math.max(0, Math.min(functional, parseInt(icu.occupiedBeds ?? defaultStats.occupiedBeds, 10)));
        const available = Math.max(0, functional - occupied);
        const isFull = (available <= 0);
        const occupancyRate = functional > 0 ? Math.round((occupied / functional) * 100) : 0;

        return {
            hospitalId: hosp.id,
            hospitalName: hosp.name_ar || hosp.hospitalName,
            hospitalIcon: hosp.icon || 'fa-hospital',
            hospitalColor: hosp.color || '#0f766e',
            location: hosp.location || '',
            totalBeds: total,
            functionalBeds: functional,
            occupiedBeds: occupied,
            availableBeds: available,
            isFull: isFull,
            occupancyRate: occupancyRate,
            notes: icu.notes || '',
            lastUpdated: icu.lastUpdated || hosp.lastUpdated || '',
            updatedBy: icu.updatedBy || ''
        };
    }

    function getAllHospitalsICUStats() {
        const hospitals = getHospitals();
        return hospitals.map(h => getICUStats(h.id)).filter(Boolean);
    }

    async function updateICUStats(hospitalId, stats) {
        if (!auth.canEditICU(hospitalId)) {
            throw new Error('غير مصرح لك بتعديل موقف العناية المركزة لهذا المستشفى. يتطلب صلاحية مقيم التخدير لهذا المستشفى أو المالك.');
        }
        const hosp = getHospital(hospitalId);
        if (!hosp) throw new Error('المستشفى غير موجود.');

        const total = Math.max(0, parseInt(stats.totalBeds ?? 0, 10));
        const functional = Math.max(0, Math.min(total, parseInt(stats.functionalBeds ?? 0, 10)));
        const occupied = Math.max(0, Math.min(functional, parseInt(stats.occupiedBeds ?? 0, 10)));
        const available = Math.max(0, functional - occupied);

        hosp.icu = {
            totalBeds: total,
            functionalBeds: functional,
            occupiedBeds: occupied,
            availableBeds: available,
            notes: String(stats.notes || '').trim(),
            lastUpdated: new Date().toISOString(),
            updatedBy: String(stats.updatedBy || (auth.isOwner() ? 'المالك' : 'مقيم التخدير والعناية')).trim()
        };

        const hospTitle = hosp.name_ar || hosp.hospitalName;
        await saveDatabase(`تحديث موقف أسرة العناية المركزة لمستشفى ${hospTitle}: ${available} أسرة شاغرة من أصل ${functional} سرير وظيفي`);
        return hosp.icu;
    }

    // ============================================================
    // AUTHENTICATION & MULTI-PASSWORD ROLE TRICK
    // ============================================================
    let pendingToken = null;

    /**
     * Personal-account passwords are stretched on the device (PBKDF2-SHA256, 310 000 rounds,
     * salted with the username) and only the derived key is sent to the server.
     */
    async function deriveAccountKey(username, password) {
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('hosp-hub/v1/' + String(username).trim().toLowerCase()), iterations: 310000 },
            base, 256);
        let s = '';
        new Uint8Array(bits).forEach(b => { s += String.fromCharCode(b); });
        return btoa(s);
    }

    /** A random id that stays on this browser (also after signing out); used for the device limit. */
    function deviceId() {
        const KEY = 'hospital_hub_device_id';
        try {
            let id = localStorage.getItem(KEY);
            if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
                const bytes = crypto.getRandomValues(new Uint8Array(18));
                id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                localStorage.setItem(KEY, id);
            }
            return id;
        } catch (e) {
            return 'nostorage-' + Math.random().toString(36).slice(2, 18);
        }
    }

    /** Human-readable device name for the devices list, e.g. "iPhone · Safari". */
    function deviceLabel() {
        const ua = navigator.userAgent || '';
        const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
            : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'جهاز';
        const browser = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera'
            : /Brave/.test(ua) ? 'Brave' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
            : /Safari\//.test(ua) ? 'Safari' : '';
        const app = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? ' (التطبيق)' : '';
        return [os, browser].filter(Boolean).join(' · ') + app;
    }

    function storeAccount(account) {
        try {
            if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
            else localStorage.removeItem(ACCOUNT_KEY);
        } catch (e) {}
    }

    const auth = {
        /**
         * Checks a password with the server. Returns a Promise of
         * { success, role, adminHospitals } or { success: false, error }.
         * The token from a successful check is kept until saveSession() stores it.
         */
        async verifyPassword(password, roleHint = null, applyRoleHint = false) {
            const pwd = String(password || '').trim();
            if (!pwd) {
                return { success: false, error: 'الرجاء إدخال كلمة المرور' };
            }
            try {
                const res = await api('POST', '/api/login', { password: pwd, roleHint: (applyRoleHint && roleHint) || undefined }, { useToken: false, retries: 1 });
                if (res && res.success) {
                    pendingToken = { token: res.token, exp: res.exp };
                    return { success: true, role: res.role, adminHospitals: res.adminHospitals || [] };
                }
                return { success: false, error: (res && res.error) || 'كلمة المرور غير صحيحة' };
            } catch (err) {
                if (err instanceof ApiError && err.data && err.data.error) {
                    return { success: false, error: err.data.error };
                }
                return { success: false, error: 'تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.' };
            }
        },

        async login(arg1, arg2, arg3) {
            let roleHint = null;
            let pwd = '';
            let remember = true;

            if (typeof arg1 === 'string' && ['owner', 'admin', 'anaesthesia', 'user'].includes(arg1.toLowerCase()) && typeof arg2 === 'string') {
                roleHint = arg1.toLowerCase();
                pwd = arg2.trim();
                if (typeof arg3 === 'boolean') remember = arg3;
            } else {
                pwd = String(arg1 || '').trim();
                if (typeof arg2 === 'boolean') remember = arg2;
                else if (typeof arg3 === 'boolean') remember = arg3;
            }

            const res = await this.verifyPassword(pwd, roleHint, true);
            if (res.success) {
                storeAccount(null);
                this.saveSession(res.role, '', remember, res.adminHospitals);
            }
            return res;
        },

        /** Sign in with a personal account. Resolves to { success, role, account } or { success: false, error, status }. */
        async accountLogin(username, password, remember = true) {
            const user = String(username || '').trim().toLowerCase();
            if (!user || !password) return { success: false, error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' };
            try {
                const key = await deriveAccountKey(user, password);
                const res = await api('POST', '/api/accounts/login', { username: user, key, remember, deviceId: deviceId(), deviceLabel: deviceLabel() }, { useToken: false, retries: 1 });
                if (res && res.success) {
                    pendingToken = { token: res.token, exp: res.exp };
                    storeAccount(res.account);
                    this.saveSession(res.role, '', remember, res.adminHospitals || []);
                    return { success: true, role: res.role, account: res.account };
                }
                return { success: false, error: (res && res.error) || 'اسم المستخدم أو كلمة المرور غير صحيحة', status: res && res.status };
            } catch (err) {
                if (err instanceof ApiError && err.data && err.data.error) return { success: false, error: err.data.error };
                return { success: false, error: 'تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.' };
            }
        },

        /** The signed-in personal account (null for shared-password sessions and guests). */
        getAccount() {
            if (!this.checkSession()) return null;
            try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null'); } catch (e) { return null; }
        },

        /**
         * Applies a fresh profile from the server (role changes take effect without signing in again).
         * Returns true when the role or hospitals changed.
         */
        refreshAccount(account, role, adminHospitals) {
            // A reply that arrives after signing out must not bring the session back.
            if (!account || !localStorage.getItem(SESSION_ROLE_KEY) || !readApiToken()) return false;
            const before = localStorage.getItem(SESSION_ROLE_KEY) + '|' + localStorage.getItem(SESSION_ADMIN_HOSPITALS_KEY);
            storeAccount(account);
            localStorage.setItem(SESSION_ROLE_KEY, role);
            localStorage.setItem(SESSION_ADMIN_HOSPITALS_KEY, JSON.stringify(adminHospitals || []));
            const changed = before !== role + '|' + JSON.stringify(adminHospitals || []);
            if (changed) window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role, adminHospitals } }));
            return changed;
        },

        /** Keeps this device signed in after the server issued a new token (e.g. password change). */
        replaceToken(token, exp) {
            storeApiToken(token, exp);
        },

        deriveAccountKey,
        deviceId,

        saveSession(role, password = '', remember = true, adminHospitals = null) {
            localStorage.setItem(SESSION_ROLE_KEY, role);
            localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());

            let hospList = adminHospitals;
            if (hospList === null || hospList === undefined) {
                if (role === 'owner') hospList = ['*'];
                else if (role === 'admin' || role === 'anaesthesia') {
                    const currentStored = this.getAdminHospitalIds();
                    hospList = currentStored.length > 0 ? currentStored : ['*'];
                } else hospList = [];
            }
            try {
                localStorage.setItem(SESSION_ADMIN_HOSPITALS_KEY, JSON.stringify(hospList || []));
            } catch(e) {}

            // The password itself is never stored; only the server-issued token.
            localStorage.removeItem(SESSION_TOKEN_KEY);
            if (pendingToken) {
                storeApiToken(pendingToken.token, pendingToken.exp);
                pendingToken = null;
            }
            if (remember) {
                localStorage.setItem(SESSION_REMEMBER_KEY, 'true');
            } else {
                localStorage.removeItem(SESSION_REMEMBER_KEY);
            }
            window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role, adminHospitals: hospList } }));
            // Reload so the new role sees its full data (phone numbers, passwords for the owner).
            scheduleRefresh(0);
        },

        checkSession() {
            const role = localStorage.getItem(SESSION_ROLE_KEY);
            const ts = Number(localStorage.getItem(SESSION_TIMESTAMP_KEY));
            if (!role || !ts || isNaN(ts)) return false;

            const isRemembered = localStorage.getItem(SESSION_REMEMBER_KEY) === 'true';
            // Personal accounts stay signed in for 30 days (the server token decides); shared passwords 7.
            const rememberedDays = localStorage.getItem(ACCOUNT_KEY) ? 30 : 7;
            const maxAge = isRemembered ? (rememberedDays * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);

            if (Date.now() - ts > maxAge) {
                this.logout();
                return false;
            }
            // Server token present but expired: the session is over.
            try {
                const rawToken = JSON.parse(localStorage.getItem(API_TOKEN_KEY) || 'null');
                if (rawToken && rawToken.exp && rawToken.exp < Date.now()) {
                    this.logout();
                    return false;
                }
            } catch (e) {}
            return ['user', 'anaesthesia', 'admin', 'owner', 'rotator', ...AA_ROLES].includes(role);
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
            return this.checkSession() && ['user', 'anaesthesia', 'admin', 'owner', 'rotator', ...AA_ROLES].includes(this.getRole());
        },

        isUser() {
            return ['user', 'anaesthesia', 'admin', 'owner', 'rotator', ...AA_ROLES].includes(this.getRole());
        },

        /** Officers of an Administrative Affairs division (division user or division admin). */
        isOfficer() {
            return AA_ROLES.includes(this.getRole());
        },

        /** May open hospital `hospId`'s Administrative Affairs division (owner, its admins, its officers). */
        canAccessDivision(hospId) {
            const role = this.getRole();
            if (!hospId) return false;
            if (role === 'owner') return true;
            if (role === 'admin') { const ids = this.getAdminHospitalIds(); return ids.includes('*') || ids.includes(hospId); }
            if (AA_ROLES.includes(role)) { const acc = this.getAccount(); return !!acc && acc.hosp === hospId; }
            return false;
        },

        /** Rotators (doctors on rotation) can view the site and comment, but not exchange duties. */
        isRotator() {
            return this.getRole() === 'rotator';
        },

        canExchangeDuties() {
            return this.isLoggedIn() && this.getRole() !== 'rotator';
        },

        /** Duty exchanges are made in the doctor's own hospital only (the owner: everywhere). The API applies the same rule. */
        canExchangeIn(hospId) {
            if (!hospId || !this.isLoggedIn()) return false;
            const role = this.getRole();
            if (role === 'owner') return true;
            if (role === 'rotator') return false;
            if (AA) return hospId === AA && this.canAccessDivision(hospId);
            if (AA_ROLES.includes(role)) return false;
            const acc = this.getAccount();
            if (acc && acc.hosp === hospId) return true;
            const ids = this.getAdminHospitalIds();
            return ids.includes('*') || ids.includes(hospId);
        },

        isOwner() {
            return this.getRole() === 'owner';
        },

        /**
         * The ER page of a hospital: the owner; an admin of the hospital while its ER switch is on and
         * the owner picked them (hospital.erAdmins: account ids, 'shared' = the shared admin password;
         * no list = every admin, as before the list existed). The API applies the same rule.
         */
        canUseEr(hospId) {
            if (this.isOwner()) return true;
            if (!hospId || this.getRole() !== 'admin') return false;
            const ids = this.getAdminHospitalIds();
            if (!ids.includes('*') && !ids.includes(hospId)) return false;
            const h = getHospital(hospId);
            if (!h || !h.erEnabled) return false;
            if (!Array.isArray(h.erAdmins)) return true;
            const acc = this.getAccount();
            return h.erAdmins.includes(acc ? acc.id : 'shared');
        },

        isAnaesthesia(targetHospitalId = null) {
            const role = this.getRole();
            if (role === 'owner') return true;
            if (role !== 'anaesthesia') return false;

            const adminHospList = this.getAdminHospitalIds();
            if (adminHospList.includes('*')) return true;

            if (!targetHospitalId) {
                const activeId = getActiveHospitalId();
                if (activeId && adminHospList.includes(activeId)) return true;
                return adminHospList.length > 0;
            }

            return adminHospList.includes(targetHospitalId);
        },

        isAdmin(targetHospitalId = null) {
            const role = this.getRole();
            if (role === 'owner') return true;
            // A division admin administers their own hospital's division (division mode only).
            if (role === 'aa_admin') return !!AA && (!targetHospitalId || targetHospitalId === AA);
            // anaesthesia resident is NOT an admin! Admin cannot edit ICU, anaesthesia cannot edit general hospital admin
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

        canEditICU(targetHospitalId = null) {
            const role = this.getRole();
            if (role === 'owner') return true;
            // Admin and regular users CANNOT edit ICU! Only the anaesthesia resident of the respective hospital can edit
            if (role !== 'anaesthesia') return false;
            // The owner's switch: every anaesthesia resident edits every hospital's ICU (the API applies it too).
            if (icuAllOn()) return true;

            const adminHospList = this.getAdminHospitalIds();
            if (adminHospList.includes('*')) return true;

            const target = targetHospitalId || getActiveHospitalId();
            if (!target) return false;

            return adminHospList.includes(target);
        },

        canEditPasswords() {
            return this.getRole() === 'owner';
        },

        logout() {
            const hadSession = !!localStorage.getItem(SESSION_ROLE_KEY);
            localStorage.removeItem(SESSION_ROLE_KEY);
            localStorage.removeItem(SESSION_TOKEN_KEY);
            localStorage.removeItem(SESSION_TIMESTAMP_KEY);
            localStorage.removeItem(SESSION_REMEMBER_KEY);
            localStorage.removeItem(SESSION_ADMIN_HOSPITALS_KEY);
            storeApiToken(null);
            storeAccount(null);
            detachSecrets();
            if (hadSession) clearLocalData();
            if (hadSession) {
                window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role: 'guest', adminHospitals: [] } }));
            }
        },

        /**
         * Sign-out pressed by the user: ends the session and restarts the app at the sign-in screen.
         * Inside the app shell every page stays loaded in its own frame, so the whole shell is
         * reloaded: no page that was open while signed in (or its account panel) can come back.
         */
        signOut() {
            try {
                sessionStorage.removeItem('hub_cached_owner_pwd');
                sessionStorage.removeItem('hub_cached_admin_pwd');
                sessionStorage.removeItem('hub_aa_ctx');
            } catch (e) {}
            this.logout();
            try { localStorage.removeItem('app_last_route'); } catch (e) {}
            const dir = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
            let top = null;
            try { if (window.top !== window && window.top.HubShell) top = window.top; } catch (e) {}
            if (top) {
                // Only the address after # would change: point it at the hub, then really reload the shell.
                try { top.history.replaceState(null, '', dir + 'app.html#index.html?portal=true'); } catch (e) {}
                top.location.reload();
            } else location.replace(dir + 'index.html?portal=true');
        },

        /** Raise the current session to owner / admin / anaesthesia. Returns a Promise. */
        async upgradeRole(password) {
            const res = await this.verifyPassword(password);
            if (!res.success || !['owner', 'admin', 'anaesthesia'].includes(res.role)) {
                pendingToken = null;
                return { success: false, error: res.error || 'كلمة مرور غير صحيحة' };
            }
            storeAccount(null);
            this.saveSession(res.role, '', true, res.adminHospitals);
            return res;
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
        /** Authenticated call to the API: Hub.api('GET', '/api/...', body?, { useToken, retries }). */
        api,
        ApiError,
        loadDatabase,
        saveDatabase,
        er: {
            pull: pullEr,
            push: pushEr,
            save: saveErNow,
            pending: erPendingCount,
        },
        /** Troubleshooting: what would the next save upload, and which fields changed. */
        debugPendingChanges: (limit = 10) => {
            if (!db || !syncBase) return [];
            return HubSync.diff(syncBase, HubSync.decompose(db).records).slice(0, limit).map(op => {
                const before = syncBase.get(op.k);
                const prev = before ? JSON.parse(before.s) : {};
                const next = op.d || {};
                const fields = op.del ? ['(deleted)'] : op.ordOnly ? ['(order)'] : [...new Set([...Object.keys(prev), ...Object.keys(next)])]
                    .filter(f => JSON.stringify(prev[f]) !== JSON.stringify(next[f]))
                    .map(f => `${f}: ${JSON.stringify(prev[f])} -> ${JSON.stringify(next[f])}`.slice(0, 160));
                return { record: op.k, fields };
            });
        },
        getSyncStatus: () => ({
            apiBase: CONFIG.apiBase,
            loaded: !!syncBase,
            fullData: syncBaseFull,
            signedIn: !!readApiToken(),
            pendingChanges: (db && syncBase) ? HubSync.diff(syncBase, HubSync.decompose(db).records).length : null,
            erPending: erDirty.size
        }),
        getDatabase: () => db,
        /** Administrative Affairs division mode (see the top of this file). */
        aa: {
            hosp: AA,
            active: !!AA,
            ROLES: AA_ROLES,
            mirrorId: aaMirrorId,
            isMirrorId: id => typeof id === 'string' && id.startsWith(AA_MIRROR_PREFIX),
            /** The division's virtual hospital for the doctors' mirrors (all job titles for those with access). */
            loadMirror: hosp => fetchDivisionMirror(hosp),
            refreshMirrors: () => refreshDivisionMirrors(),
        },
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
        getAnaesthesiaResidents,
        getCurrentIcuResident,
        addResident,
        updateResident,
        nameKey: nameKeyOf,
        deleteResident,
        getSpecialists,
        getSpecialist,
        saveSpecialist,
        deleteSpecialist,
        saveSpecialistSchedule,
        getSpecialistSchedule,
        getSpecialistDuties,
        isSurgicalSpecialty,
        getSpecialtyBranch,
        getPublicHospitals,
        publicHospital,
        getBackupInfo,
        getLatestBackup,
        getSpecialtyName,
        specialists: {
            getAll: (hospitalId, specCode) => getSpecialists(hospitalId, specCode),
            getById: (id) => getSpecialist(id),
            save: (specialistData) => saveSpecialist(specialistData),
            delete: (id) => deleteSpecialist(id),
            saveSchedule: (specialistId, scheduleData) => saveSpecialistSchedule(specialistId, scheduleData),
            getSchedule: (hospitalId) => getSpecialistSchedule(hospitalId),
            getDuties: (specialistName, hospitalId) => getSpecialistDuties(specialistName, hospitalId),
            canManage: (specOrId) => canManageSpecialist(specOrId),
            canDelete: (specOrId) => canDeleteSpecialist(specOrId),
            canAdd: () => canAddSpecialist(),
            residentScope: () => residentSpecialistScope(),
            loadEditSettings: () => loadSpecialistEditSettings(),
            editSettings: () => specialistEdit,
            setEditSwitch: (hospitalId, on) => setSpecialistEditSwitch(hospitalId, on),
            residentCandidates: (id) => getSpecialistResidentCandidates(id),
            getResidents: (id) => getSpecialistResidents(id),
            setResidents: (id, residentIds) => setSpecialistResidents(id, residentIds)
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
        restoreFullDatabase,
        getSafetySnapshots,
        restoreSafetySnapshot,
        saveLocalSafetySnapshot,
        addHospitalSpecialty,
        addHospitalSpecialtyFromGlobal,
        addHospitalCloneSpecialty,
        updateHospitalSpecialty,
        deleteHospitalSpecialty,
        deleteEmptyHospitalSpecialties,
        getEligibleResidentsForSpecialty,
        syncHospitalSpecialtiesWithGlobal,
        getActiveOnCallResidentsCount,
        getTotalActiveOnCallCount,
        getICUStats,
        getAllHospitalsICUStats,
        updateICUStats,
        canEditICU: (hospId) => auth.canEditICU(hospId),
        icuAllOn,
        /** The owner switches ICU editing for every anaesthesia resident in every hospital. */
        async setIcuAll(on) {
            const res = await api('POST', '/api/icu-access', { on: !!on });
            try { localStorage.setItem('hub_icu_all', res.icuAll ? '1' : '0'); } catch (e) {}
            authConfigAt = Date.now();
            dispatchDataChanged();
            return res.icuAll;
        },
        auth,
        getMedicalDate,
        getCurrentMedicalMinutes,
        normalizeSpecialtyId,
        SPECIALTY_ALIASES,
        getTheme,
        setTheme,
        toggleTheme,
        getSpecialtyPrefix,
        formatMemberName,
        formatPhoneNumber: formatIraqiPhoneNumber,
        formatIraqiPhoneNumber,
        isValidIraqiPhoneNumber
    };

    // Start syncing with the server right away on every page; pages that call
    // Hub.loadDatabase() simply join this request.
    if (typeof document !== 'undefined') {
        loadDatabase().catch(() => {});
    }

})(window);

