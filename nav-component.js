/**
 * UNIVERSAL NAVIGATION BAR & HOSPITAL SWITCHER COMPONENT
 * Renders consistent, reactive top navigation across all hospital webpages.
 */

(function(window) {
    'use strict';

    function initUniversalNav(activePageId = 'hub') {
        const navContainer = document.getElementById('universal-nav') || createNavContainer();
        renderNav(navContainer, activePageId);

        // Listen for database changes or hospital switch
        window.addEventListener('hub:data-changed', () => renderNav(navContainer, activePageId));
        window.addEventListener('hub:hospital-switched', () => renderNav(navContainer, activePageId));
        window.addEventListener('hub:auth-changed', () => renderNav(navContainer, activePageId));
        window.addEventListener('hub:theme-changed', (e) => updateThemeIcon(e.detail.theme));
    }

    function createNavContainer() {
        const div = document.createElement('div');
        div.id = 'universal-nav';
        document.body.insertBefore(div, document.body.firstChild);
        return div;
    }

    function renderNav(container, activePageId) {
        if (!window.Hub) return;

        const activeHospital = window.Hub.getActiveHospital();
        const hospitals = window.Hub.getHospitals();
        const activeHospitalId = window.Hub.getActiveHospitalId();
        const role = window.Hub.auth.getRole();
        const isAdmin = window.Hub.auth.isAdmin();
        const currentTheme = window.Hub.getTheme();

        const hospName = activeHospital?.name_ar || activeHospital?.hospitalName || 'المستشفى التعليمي';
        const hospIcon = activeHospital?.icon || 'fa-hospital';

        // Role badge data
        const isOwner = window.Hub.auth.isOwner();
        const isLoggedIn = window.Hub.auth.isLoggedIn();
        let badgeClass = 'guest';
        let badgeIcon = 'fa-sign-in-alt';
        let badgeText = 'تسجيل الدخول';
        let badgeTitle = 'اضغط لتسجيل الدخول إلى النظام';

        if (isOwner) {
            badgeClass = 'owner';
            badgeIcon = 'fa-crown';
            badgeText = '👑 المالك';
            badgeTitle = 'صلاحيات المالك الكاملة مفعلة';
        } else if (isAdmin) {
            badgeClass = 'admin';
            badgeIcon = 'fa-shield-halved';
            badgeText = '🛡️ مدير النظام';
            badgeTitle = 'صلاحيات المدير مفعلة (اضغط للترقية إلى المالك)';
        } else if (isLoggedIn) {
            badgeClass = 'user';
            badgeIcon = 'fa-user';
            badgeText = 'مستخدم عادي';
            badgeTitle = 'حساب مستخدم عادي (اضغط للترقية إلى صلاحيات الإدارة أو المالك)';
        }

        // Base URL query parameter for current hospital
        const queryParam = `?hospital=${encodeURIComponent(activeHospitalId)}`;

        container.innerHTML = `
            <nav class="hub-nav-bar" id="hub-main-nav">
                <!-- Left: Brand -->
                <div class="hub-nav-left">
                    <a href="./index.html" class="hub-nav-brand" title="العودة إلى البوابة الرئيسية">
                        <span class="brand-icon"><i class="fas fa-hospital-alt"></i></span>
                        <span class="brand-text">بوابة المستشفيات</span>
                    </a>
                </div>

                <!-- Center: Universal Webpage Links (Ribbon cleaned: Admin and Today's Residents removed) -->
                <div class="hub-nav-center">
                    <a href="./index.html" class="hub-nav-link ${activePageId === 'hub' ? 'active' : ''}">
                        <i class="fas fa-th-large"></i> <span>البوابة الرئيسية</span>
                    </a>
                    <a href="./residents.html${queryParam}" class="hub-nav-link ${activePageId === 'residents' ? 'active' : ''}">
                        <i class="fas fa-address-book"></i> <span>دليل المقيمين</span>
                    </a>
                    <a href="./signup.html${queryParam}" class="hub-nav-link ${activePageId === 'signup' ? 'active' : ''}">
                        <i class="fas fa-exchange-alt"></i> <span>تبديل الخفارات</span>
                    </a>
                </div>

                <!-- Right: Role, Theme, Logout & Mobile Toggle -->
                <div class="hub-nav-right">
                    <!-- Role Badge -->
                    <span class="role-badge ${badgeClass}" onclick="handleRoleBadgeClick()" title="${badgeTitle}">
                        <i class="fas ${badgeIcon}"></i>
                        <span>${badgeText}</span>
                    </span>

                    ${isOwner ? `
                    <!-- Owner Edit Passwords Button -->
                    <button type="button" class="hub-nav-btn owner-key-btn" onclick="openAllPasswordsModalNav()" aria-label="تعديل كلمات المرور" title="تعديل كلمات المرور (المالك)" style="color:#d97706; border-color:rgba(217,119,6,0.35); background:rgba(217,119,6,0.08);">
                        <i class="fas fa-key"></i>
                    </button>
                    ` : ''}

                    <!-- Theme Toggle -->
                    <button type="button" class="hub-nav-btn" onclick="toggleThemeNav()" aria-label="تبديل الوضع الليلي" title="تبديل الوضع">
                        <i class="fas ${currentTheme === 'dark' ? 'fa-sun' : 'fa-moon'}" id="hub-theme-icon"></i>
                    </button>

                    <!-- Logout Button -->
                    <button type="button" class="hub-btn-logout" onclick="logoutNav()" title="تسجيل الخروج">
                        <i class="fas fa-sign-out-alt"></i>
                        <span class="hidden sm:inline">خروج</span>
                    </button>

                    <!-- Mobile Burger Toggle -->
                    <button type="button" class="hub-mobile-toggle" onclick="toggleMobileMenu()" aria-label="القائمة">
                        <i class="fas fa-bars"></i>
                    </button>
                </div>
            </nav>

            <!-- Upgrade to Admin/Owner Modal Dialog -->
            <div id="hub-upgrade-modal" class="hub-modal-overlay">
                <div class="hub-modal-card">
                    <div style="width:54px;height:54px;margin:0 auto 12px;border-radius:50%;background:rgba(212,175,55,0.15);display:flex;align-items:center;justify-content:center;color:#d4af37;font-size:1.5rem;">
                        <i class="fas fa-key"></i>
                    </div>
                    <h3 style="font-size:1.15rem;font-weight:800;margin-bottom:6px;color:#1e293b;" class="dark:text-white">تسجيل الدخول والترقية</h3>
                    <p style="font-size:0.8rem;color:#64748b;margin-bottom:16px;">أدخل كلمة مرور المدير أو المالك لتفعيل الصلاحيات الإدارية</p>
                    
                    <div class="hub-password-wrapper">
                        <input type="password" id="hub-admin-pwd-input" class="hub-password-input" placeholder="كلمة مرور المدير أو المالك..." 
                               autocomplete="current-password"
                               onkeydown="if(event.key==='Enter') executeUpgradeToAdmin()" />
                        <button type="button" class="hub-password-eye-btn" id="hub-upgrade-eye-btn" onclick="toggleUpgradePwdVisibility()" aria-label="عرض أو إخفاء كلمة المرور" title="إظهار / إخفاء كلمة المرور">
                            <i class="fas fa-eye" id="hub-upgrade-eye-icon"></i>
                        </button>
                    </div>
                    <p id="hub-upgrade-error" style="color:#ef4444;font-size:0.75rem;min-height:20px;margin-bottom:8px;"></p>

                    <div style="display:flex;gap:8px;">
                        <button type="button" onclick="executeUpgradeToAdmin()" 
                                style="flex:1;padding:10px;border-radius:12px;border:none;background:linear-gradient(135deg,#0f766e,#0d9488);color:white;font-weight:700;cursor:pointer;">
                            تأكيد الدخول
                        </button>
                        <button type="button" onclick="closeUpgradeModal()" 
                                style="padding:10px 16px;border-radius:12px;border:1px solid #cbd5e1;background:transparent;color:#64748b;font-weight:600;cursor:pointer;">
                            إلغاء
                        </button>
                    </div>
                </div>
            </div>

            <!-- Owner All Passwords Modal Dialog -->
            <div id="hub-passwords-modal" class="hub-modal-overlay">
                <div class="hub-modal-card" style="max-width:440px; text-align:right; padding:22px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="width:40px; height:40px; border-radius:12px; background:rgba(217,119,6,0.15); display:flex; align-items:center; justify-content:center; color:#d97706; font-size:1.2rem;">
                                <i class="fas fa-key"></i>
                            </div>
                            <div>
                                <h3 style="font-size:1.15rem; font-weight:800; margin:0; color:#1e293b;" class="dark:text-white">تعديل كلمات المرور</h3>
                                <span style="font-size:0.75rem; color:#b45309; font-weight:700;"><i class="fas fa-crown text-amber-500 ml-1"></i> صلاحية المالك حصراً</span>
                            </div>
                        </div>
                        <button type="button" onclick="closeAllPasswordsModalNav()" style="background:none; border:none; font-size:1.2rem; color:#94a3b8; cursor:pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <p style="font-size:0.8rem; color:#64748b; margin-bottom:14px; line-height:1.5;">
                        بصفتك المالك، يمكنك تعديل كلمات المرور لكافة المستويات وتطبيقها على كامل المنظومة أو مستشفى بعينه.
                    </p>

                    <!-- Scope Selection -->
                    <div style="margin-bottom:14px;">
                        <label style="display:block; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:4px;">نطاق تطبيق التعديل</label>
                        <select id="hub-pwd-scope-select" onchange="onScopeChangePasswordsNav()" style="width:100%; padding:9px 12px; border-radius:10px; border:1px solid #cbd5e1; font-size:0.85rem; font-weight:600; background:#f8fafc; outline:none; color:#1e293b;">
                            <option value="all">🌐 جميع المستشفيات والمنظومة بالكامل (تحديث شامل)</option>
                        </select>
                    </div>

                    <!-- Passwords Fields -->
                    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;">
                        <!-- Normal User Password -->
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <label style="font-size:0.78rem; font-weight:700; color:#334155;">كلمة مرور المستخدم العادي</label>
                                <span style="font-size:0.68rem; color:#64748b;">(تصفح، تبديل، دليل المقيمين)</span>
                            </div>
                            <div style="position:relative;">
                                <input type="text" id="hub-pwd-user" placeholder="1234" style="width:100%; padding:9px 36px 9px 12px; border-radius:10px; border:1px solid #cbd5e1; font-family:monospace; font-size:0.95rem; text-align:center; color:#1e293b; background:#ffffff;" />
                                <i class="fas fa-user" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:0.85rem;"></i>
                            </div>
                        </div>

                        <!-- Admin Password -->
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <label style="font-size:0.78rem; font-weight:700; color:#334155;">كلمة مرور المدير / المشرف</label>
                                <span style="font-size:0.68rem; color:#64748b;">(إدارة المقيمين، المجدول)</span>
                            </div>
                            <div style="position:relative;">
                                <input type="text" id="hub-pwd-admin" placeholder="Admin1996*" style="width:100%; padding:9px 36px 9px 12px; border-radius:10px; border:1px solid #cbd5e1; font-family:monospace; font-size:0.95rem; text-align:center; color:#1e293b; background:#ffffff;" />
                                <i class="fas fa-shield-halved" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:0.85rem;"></i>
                            </div>
                        </div>

                        <!-- Owner Password -->
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <label style="font-size:0.78rem; font-weight:700; color:#b45309;">كلمة مرور المالك</label>
                                <span style="font-size:0.68rem; color:#b45309; font-weight:700;">(كامل الصلاحيات + كلمات المرور)</span>
                            </div>
                            <div style="position:relative;">
                                <input type="text" id="hub-pwd-owner" placeholder="MrjBth1996*" style="width:100%; padding:9px 36px 9px 12px; border-radius:10px; border:2px solid rgba(217,119,6,0.5); font-family:monospace; font-size:0.95rem; text-align:center; background:#fffbeb; color:#1e293b;" />
                                <i class="fas fa-crown" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#d97706; font-size:0.85rem;"></i>
                            </div>
                        </div>
                    </div>

                    <p id="hub-passwords-error" style="color:#ef4444; font-size:0.75rem; min-height:18px; margin-bottom:10px; text-align:center;"></p>

                    <div style="display:flex; gap:8px;">
                        <button type="button" id="hub-save-passwords-btn" onclick="submitAllPasswordsNav()" style="flex:1; padding:11px; border-radius:12px; border:none; background:linear-gradient(135deg,#d97706,#b45309); color:white; font-weight:700; cursor:pointer; font-size:0.88rem; box-shadow:0 4px 14px rgba(217,119,6,0.3);">
                            <i class="fas fa-check-circle ml-1"></i> حفظ وتطبيق كلمات المرور
                        </button>
                        <button type="button" onclick="closeAllPasswordsModalNav()" style="padding:11px 16px; border-radius:12px; border:1px solid #cbd5e1; background:transparent; color:#64748b; font-weight:600; cursor:pointer; font-size:0.88rem;">
                            إلغاء
                        </button>
                    </div>
                </div>
            </div>
        `;
    }



    // Switch hospital and reload or refresh view
    window.switchHospital = function(hospitalId) {
        if (!window.Hub) return;
        window.Hub.setActiveHospitalId(hospitalId);

        // Keep current page path, update query string
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('hospital', hospitalId);
        window.location.href = currentUrl.toString();
    };

    // Theme Toggle
    window.toggleThemeNav = function() {
        if (!window.Hub) return;
        const newTheme = window.Hub.toggleTheme();
        updateThemeIcon(newTheme);
    };

    function updateThemeIcon(theme) {
        const icon = document.getElementById('hub-theme-icon');
        if (icon) {
            icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    // Mobile Menu
    window.toggleMobileMenu = function() {
        const bar = document.getElementById('hub-main-nav');
        if (bar) bar.classList.toggle('menu-open');
    };

    // Logout
    window.logoutNav = function() {
        if (!window.Hub) return;
        window.Hub.auth.logout();
        window.location.href = './index.html';
    };

    // Admin link guard
    let pendingAdminUrl = null;
    window.handleAdminLinkClick = function(event, targetUrl) {
        if (window.Hub && !window.Hub.auth.isAdmin()) {
            event.preventDefault();
            pendingAdminUrl = targetUrl;
            openUpgradeModal();
        }
    };

    window.handleRoleBadgeClick = function() {
        if (!window.Hub) return;
        if (!window.Hub.auth.isLoggedIn()) {
            window.location.href = './index.html';
            return;
        }
        if (window.Hub.auth.isOwner()) {
            openAllPasswordsModalNav();
        } else {
            openUpgradeModal();
        }
    };

    window.openUpgradeModal = function() {
        const modal = document.getElementById('hub-upgrade-modal');
        const input = document.getElementById('hub-admin-pwd-input');
        const err = document.getElementById('hub-upgrade-error');
        const eyeIcon = document.getElementById('hub-upgrade-eye-icon');
        if (modal) {
            modal.classList.add('active');
            if (err) err.textContent = '';
            if (input) {
                input.type = 'password';
                input.value = '';
                input.classList.remove('shake-error');
                setTimeout(() => input.focus(), 100);
            }
            if (eyeIcon) {
                eyeIcon.className = 'fas fa-eye';
                eyeIcon.style.color = '';
            }
        }
    };

    window.toggleUpgradePwdVisibility = function() {
        const input = document.getElementById('hub-admin-pwd-input');
        const icon = document.getElementById('hub-upgrade-eye-icon');
        if (!input || !icon) return;

        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash';
            icon.style.color = '#0f766e';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye';
            icon.style.color = '';
        }
    };

    window.closeUpgradeModal = function() {
        const modal = document.getElementById('hub-upgrade-modal');
        if (modal) modal.classList.remove('active');
        pendingAdminUrl = null;
    };

    window.executeUpgradeToAdmin = function() {
        const input = document.getElementById('hub-admin-pwd-input');
        const err = document.getElementById('hub-upgrade-error');
        const pwd = input ? input.value : '';

        if (!window.Hub) return;
        const res = window.Hub.auth.upgradeRole(pwd);

        if (res.success) {
            closeUpgradeModal();
            if (pendingAdminUrl) {
                window.location.href = pendingAdminUrl;
            } else {
                window.location.reload();
            }
        } else {
            if (err) err.textContent = res.error || 'كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى';
            if (input) {
                input.value = '';
                input.classList.add('shake-error');
                setTimeout(() => input.classList.remove('shake-error'), 500);
                input.focus();
            }
        }
    };

    // ============================================================
    // OWNER ALL PASSWORDS MODAL HANDLERS
    // ============================================================
    window.openAllPasswordsModalNav = function() {
        if (!window.Hub) return;
        if (!window.Hub.auth.isOwner()) {
            alert('عذراً، هذه الخاصية حصرية للمالك (Owner) فقط.');
            return;
        }

        const modal = document.getElementById('hub-passwords-modal');
        if (!modal) return;

        const db = window.Hub.getDatabase ? window.Hub.getDatabase() : null;
        const scopeSelect = document.getElementById('hub-pwd-scope-select');

        if (scopeSelect && db && db.hospitals) {
            scopeSelect.innerHTML = '<option value="all">🌐 جميع المستشفيات والمنظومة بالكامل (تحديث شامل)</option>';
            Object.values(db.hospitals).forEach(h => {
                const opt = document.createElement('option');
                opt.value = h.id;
                opt.textContent = `🏥 ${h.name_ar || h.hospitalName}`;
                scopeSelect.appendChild(opt);
            });
            scopeSelect.value = 'all';
        }

        onScopeChangePasswordsNav();
        const err = document.getElementById('hub-passwords-error');
        if (err) err.textContent = '';
        modal.classList.add('active');
    };

    window.closeAllPasswordsModalNav = function() {
        const modal = document.getElementById('hub-passwords-modal');
        if (modal) modal.classList.remove('active');
    };

    window.onScopeChangePasswordsNav = function() {
        if (!window.Hub) return;
        const scopeSelect = document.getElementById('hub-pwd-scope-select');
        const scope = scopeSelect ? scopeSelect.value : 'all';
        const db = window.Hub.getDatabase ? window.Hub.getDatabase() : null;

        let uVal = '1234';
        let aVal = 'Admin1996*';
        let oVal = 'MrjBth1996*';

        if (scope === 'all') {
            uVal = db?.globalPasswords?.user || '1234';
            aVal = db?.globalPasswords?.admin || 'Admin1996*';
            oVal = db?.globalPasswords?.owner || 'MrjBth1996*';
        } else if (db?.hospitals && db.hospitals[scope]) {
            const h = db.hospitals[scope];
            uVal = h.passwords?.user || db?.globalPasswords?.user || '1234';
            aVal = h.passwords?.admin || db?.globalPasswords?.admin || 'Admin1996*';
            oVal = h.passwords?.owner || db?.globalPasswords?.owner || 'MrjBth1996*';
        }

        const uInput = document.getElementById('hub-pwd-user');
        const aInput = document.getElementById('hub-pwd-admin');
        const oInput = document.getElementById('hub-pwd-owner');

        if (uInput) uInput.value = uVal;
        if (aInput) aInput.value = aVal;
        if (oInput) oInput.value = oVal;
    };

    window.submitAllPasswordsNav = async function() {
        if (!window.Hub) return;
        const err = document.getElementById('hub-passwords-error');
        const btn = document.getElementById('hub-save-passwords-btn');

        const uVal = (document.getElementById('hub-pwd-user')?.value || '').trim();
        const aVal = (document.getElementById('hub-pwd-admin')?.value || '').trim();
        const oVal = (document.getElementById('hub-pwd-owner')?.value || '').trim();
        const scope = document.getElementById('hub-pwd-scope-select')?.value || 'all';

        if (!uVal || !aVal || !oVal) {
            if (err) err.textContent = 'الرجاء إدخال جميع كلمات المرور الثلاث';
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-1"></i> جاري الحفظ والتطبيق...';
        }

        try {
            await window.Hub.updateAllPasswords({
                owner: oVal,
                admin: aVal,
                user: uVal
            }, scope);

            closeAllPasswordsModalNav();
            if (typeof showToast === 'function') {
                showToast('تم تحديث جميع كلمات المرور بنجاح 🔐', 'success');
            } else {
                alert('تم تحديث جميع كلمات المرور بنجاح 🔐');
            }
        } catch (e) {
            console.error('Password update error:', e);
            if (err) err.textContent = e.message || 'حدث خطأ أثناء حفظ كلمات المرور';
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check-circle ml-1"></i> حفظ وتطبيق كلمات المرور';
            }
        }
    };

    window.initUniversalNav = initUniversalNav;

})(window);

