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
        if (fromUrl && db && db.hospitals && db.hospitals[fromUrl]) {
            localStorage.setItem(ACTIVE_HOSP_KEY, fromUrl);
            return fromUrl;
        }

        const fromStorage = localStorage.getItem(ACTIVE_HOSP_KEY);
        if (fromStorage && db && db.hospitals && db.hospitals[fromStorage]) {
            return fromStorage;
        }

        if (db && db.hospitals) {
            const ids = Object.keys(db.hospitals);
            if (ids.length > 0) {
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
        if (db && db.hospitals && db.hospitals[id]) {
            localStorage.setItem(ACTIVE_HOSP_KEY, id);
            window.dispatchEvent(new CustomEvent('hub:hospital-switched', { detail: { hospitalId: id, hospital: db.hospitals[id] } }));
            return true;
        }
        return false;
    }

    async function addHospital(hospitalData) {
        if (!auth.isAdmin()) {
            throw new Error('غير مصرح لك بإضافة مستشفى. يتطلب صلاحيات المدير.');
        }

        let id = (hospitalData.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        if (!id) {
            id = 'hosp-' + Date.now().toString(36);
        }

        if (db.hospitals[id]) {
            throw new Error(`معرف المستشفى "${id}" مستخدم بالفعل.`);
        }

        // Get default specialties template from Iraqi Teaching Hospital or fallback
        const templateSpecs = (db.hospitals['iraqi']?.specialties || []).map(s => ({
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

            const currentHosp = getActiveHospital();
            const ownerPass = currentHosp?.passwords?.owner || db?.globalPasswords?.owner || "MrjBth1996*";
            const adminPass = currentHosp?.passwords?.admin || db?.globalPasswords?.admin || "Admin1996*";
            const userPass = currentHosp?.passwords?.user || db?.globalPasswords?.user || "1234";

            if (pwd === ownerPass) {
                this.saveSession('owner', pwd);
                return { success: true, role: 'owner' };
            } else if (pwd === adminPass) {
                this.saveSession('admin', pwd);
                return { success: true, role: 'admin' };
            } else if (pwd === userPass) {
                this.saveSession('user', pwd);
                return { success: true, role: 'user' };
            } else {
                return { success: false, error: 'كلمة المرور غير صحيحة' };
            }
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
            return true;
        },

        getRole() {
            if (!this.checkSession()) return null;
            return localStorage.getItem(SESSION_ROLE_KEY) || null;
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
            window.dispatchEvent(new CustomEvent('hub:auth-changed', { detail: { role: null } }));
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
        auth,
        getMedicalDate,
        getCurrentMedicalMinutes,
        getTheme,
        setTheme,
        toggleTheme
    };

})(window);

