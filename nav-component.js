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
        let badgeClass = 'user';
        let badgeIcon = 'fa-user';
        let badgeText = 'مستخدم عادي';
        let badgeTitle = 'اضغط للترقية إلى صلاحيات الإدارة أو المالك';

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

                <!-- Center: Universal Webpage Links (Admin button strictly hidden for normal users) -->
                <div class="hub-nav-center">
                    <a href="./index.html" class="hub-nav-link ${activePageId === 'hub' ? 'active' : ''}">
                        <i class="fas fa-th-large"></i> <span>البوابة الرئيسية</span>
                    </a>
                    <a href="./Home.html${queryParam}" class="hub-nav-link ${activePageId === 'roster' ? 'active' : ''}">
                        <i class="fas fa-users-viewfinder"></i> <span>الخفراء اليوم</span>
                    </a>
                    <a href="./residents.html${queryParam}" class="hub-nav-link ${activePageId === 'residents' ? 'active' : ''}">
                        <i class="fas fa-address-book"></i> <span>دليل المقيمين</span>
                    </a>
                    <a href="./signup.html${queryParam}" class="hub-nav-link ${activePageId === 'signup' ? 'active' : ''}">
                        <i class="fas fa-exchange-alt"></i> <span>تبديل الخفارات</span>
                    </a>
                    ${isAdmin ? `
                    <a href="./admin.html${queryParam}" class="hub-nav-link ${activePageId === 'admin' ? 'active' : ''}">
                        <i class="fas fa-cog"></i> <span>الإدارة</span>
                    </a>` : ''}
                </div>

                <!-- Right: Role, Theme, Logout & Mobile Toggle -->
                <div class="hub-nav-right">
                    <!-- Role Badge -->
                    <span class="role-badge ${badgeClass}" onclick="handleRoleBadgeClick()" title="${badgeTitle}">
                        <i class="fas ${badgeIcon}"></i>
                        <span>${badgeText}</span>
                    </span>

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
                    
                    <input type="password" id="hub-admin-pwd-input" placeholder="كلمة مرور المدير أو المالك..." 
                           style="width:100%;padding:12px 16px;border-radius:12px;border:2px solid #e2e8f0;outline:none;font-size:0.95rem;text-align:center;direction:ltr;margin-bottom:8px;"
                           onkeydown="if(event.key==='Enter') executeUpgradeToAdmin()" />
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
        window.location.reload();
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
        if (window.Hub && !window.Hub.auth.isOwner()) {
            openUpgradeModal();
        }
    };

    window.openUpgradeModal = function() {
        const modal = document.getElementById('hub-upgrade-modal');
        const input = document.getElementById('hub-admin-pwd-input');
        const err = document.getElementById('hub-upgrade-error');
        if (modal) {
            modal.classList.add('active');
            if (err) err.textContent = '';
            if (input) {
                input.value = '';
                setTimeout(() => input.focus(), 100);
            }
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
            if (err) err.textContent = res.error || 'كلمة المرور غير صحيحة';
            if (input) input.focus();
        }
    };

    window.initUniversalNav = initUniversalNav;

})(window);

