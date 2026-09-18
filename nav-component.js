/**
 * UNIVERSAL NAVIGATION BAR & HOSPITAL SWITCHER COMPONENT
 * Renders consistent, reactive top navigation across all hospital webpages.
 */

(function(window) {
    'use strict';

    function initUniversalNav(activePageId = 'hub') {
        const navContainer = document.getElementById('universal-nav') || createNavContainer();
        renderNav(navContainer, activePageId);
        setupSeamlessAppNavigation();

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
        const isCurrentHospAdmin = window.Hub.auth.isAdmin(activeHospitalId);
        let badgeClass = 'guest';
        let badgeIcon = 'fa-sign-in-alt';
        let badgeText = 'تسجيل الدخول';
        let badgeTitle = 'اضغط لتسجيل الدخول إلى النظام';

        if (isOwner) {
            badgeClass = 'owner';
            badgeIcon = 'fa-crown';
            badgeText = '👑 المالك';
            badgeTitle = 'صلاحيات المالك الكاملة مفعلة';
        } else if (role === 'admin' && isCurrentHospAdmin) {
            const adminHospName = window.Hub.auth.getAdminHospitalName ? window.Hub.auth.getAdminHospitalName() : '';
            badgeClass = 'admin';
            badgeIcon = 'fa-shield-halved';
            badgeText = (adminHospName && adminHospName !== 'جميع المستشفيات') ? `🛡️ مدير (${adminHospName})` : '🛡️ مدير النظام';
            badgeTitle = 'صلاحيات المدير مفعلة لهذا المستشفى (اضغط للترقية إلى المالك)';
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

                <!-- Center: Universal Webpage Links -->
                <div class="hub-nav-center">
                    <a href="./index.html" class="hub-nav-link ${activePageId === 'hub' ? 'active' : ''}">
                        <i class="fas fa-th-large"></i> <span>البوابة الرئيسية</span>
                    </a>
                    <a href="./schedule.html${queryParam}" class="hub-nav-link ${activePageId === 'schedule' ? 'active' : ''}">
                        <i class="fas fa-calendar-week"></i> <span>جدول الخفارات</span>
                    </a>
                    <a href="./specialists.html${queryParam}" class="hub-nav-link ${activePageId === 'specialists' ? 'active' : ''}">
                        <i class="fas fa-user-tie"></i> <span>أطباء الاختصاص</span>
                    </a>
                    <a href="./residents.html${queryParam}" class="hub-nav-link ${activePageId === 'residents' ? 'active' : ''}">
                        <i class="fas fa-address-book"></i> <span>دليل المقيمين</span>
                    </a>
                    <a href="./signup.html${queryParam}" class="hub-nav-link ${activePageId === 'signup' ? 'active' : ''}">
                        <i class="fas fa-exchange-alt"></i> <span>تبديل الخفارات</span>
                    </a>
                    ${(isAdmin || isOwner || isCurrentHospAdmin) ? `
                    <a href="./scheduler.html${queryParam}" class="hub-nav-link ${activePageId === 'scheduler' ? 'active' : ''}">
                        <i class="fas fa-calendar-alt"></i> <span>المجدول</span>
                    </a>` : ''}
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

            <!-- ROLE SWITCHER MODAL (Universal Switch User Level) -->
            <div id="role-switcher-modal" class="modal-overlay hub-modal-overlay" onclick="if(event.target===this) closeRoleSwitcherModal()">
                <div class="modal-card hub-modal-card max-w-md w-full p-5 sm:p-6 text-right relative" style="max-width:440px; text-align:right;">
                    <!-- Modal Header -->
                    <div class="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-4" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(148,163,184,0.2); padding-bottom:12px; margin-bottom:16px;">
                        <div class="flex items-center gap-3" style="display:flex; align-items:center; gap:10px;">
                            <div class="w-10 h-10 rounded-xl bg-teal-500/15 dark:bg-amber-400/20 text-teal-700 dark:text-amber-400 flex items-center justify-center text-lg shadow-sm" style="width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:rgba(15,118,110,0.15); color:#0f766e;">
                                <i class="fas fa-users-cog"></i>
                            </div>
                            <div>
                                <h3 class="text-base font-black text-slate-800 dark:text-white" style="font-size:1.05rem; font-weight:800; margin:0;">تبديل مستوى المستخدم</h3>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400" style="font-size:0.75rem; color:#64748b; margin:2px 0 0;">اختر مستوى الصلاحية للعمل به داخل المنظومة</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeRoleSwitcherModal()" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition" style="background:transparent; border:none; font-size:1.2rem; cursor:pointer; color:#94a3b8;" aria-label="إغلاق">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- Current Role Indicator Banner -->
                    <div class="mb-4 p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:14px; margin-bottom:14px; background:rgba(241,245,249,0.7); border:1px solid rgba(226,232,240,0.8);">
                        <div class="flex items-center gap-2" style="display:flex; align-items:center; gap:8px;">
                            <span class="text-xs text-slate-500 dark:text-slate-400 font-bold" style="font-size:0.78rem; font-weight:700; color:#64748b;">المستوى الحالي:</span>
                            <span id="switcher-current-role-badge" class="px-2.5 py-1 rounded-full text-xs font-black bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300" style="padding:3px 10px; border-radius:999px; font-size:0.75rem; font-weight:800;">مستخدم</span>
                        </div>
                        <span id="switcher-hospital-badge" class="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate max-w-[150px]" style="font-size:0.75rem; font-weight:700; color:#64748b;"></span>
                    </div>

                    <!-- Role Selection Options -->
                    <div class="space-y-3" id="switcher-role-cards" style="display:flex; flex-direction:column; gap:10px;">
                        <!-- 1. Owner Level Card -->
                        <div class="border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 transition hover:border-amber-400 dark:hover:border-amber-500 cursor-pointer bg-white/80 dark:bg-slate-900/60 shadow-sm" id="card-role-owner" onclick="selectRoleLevel('owner')" style="padding:12px; border-radius:16px; border:1px solid rgba(226,232,240,0.8); cursor:pointer; background:rgba(255,255,255,0.7);">
                            <div class="flex items-start justify-between gap-2" style="display:flex; align-items:flex-start; justify-content:space-between;">
                                <div class="flex items-center gap-3" style="display:flex; align-items:center; gap:10px;">
                                    <div class="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg flex-shrink-0" style="width:38px; height:38px; border-radius:12px; background:rgba(245,158,11,0.15); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
                                        👑
                                    </div>
                                    <div>
                                        <div class="flex items-center gap-2" style="display:flex; align-items:center; gap:6px;">
                                            <h4 class="text-xs font-black text-slate-800 dark:text-white" style="font-size:0.85rem; font-weight:800; margin:0;">المالك (Owner)</h4>
                                            <span id="tag-active-owner" class="hidden text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold" style="font-size:0.68rem; padding:2px 8px; border-radius:999px; background:rgba(245,158,11,0.15); color:#b45309; font-weight:800;">نشط حالياً ✓</span>
                                        </div>
                                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5" style="font-size:0.72rem; color:#64748b; margin:2px 0 0;">تحكم كامل بالمنظومة، إدارة المستشفيات، وتعديل كلمات المرور</p>
                                    </div>
                                </div>
                            </div>
                            <!-- Password input for owner if needed -->
                            <div id="owner-pwd-box" class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 hidden" style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(226,232,240,0.8);" onclick="event.stopPropagation()">
                                <div class="relative mb-2" style="position:relative; margin-bottom:8px;">
                                    <input type="password" id="owner-level-pwd" class="hub-input text-xs w-full" placeholder="أدخل كلمة مرور المالك..." onkeydown="if(event.key==='Enter') confirmUpgradeToRole('owner')" />
                                    <button type="button" onclick="toggleInputPwd('owner-level-pwd', 'owner-eye-icon')" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:#94a3b8;">
                                        <i class="fas fa-eye" id="owner-eye-icon"></i>
                                    </button>
                                </div>
                                <div class="flex gap-2" style="display:flex; gap:8px;">
                                    <button type="button" onclick="confirmUpgradeToRole('owner')" class="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition shadow-sm" style="flex:1; padding:8px 12px; border-radius:10px; border:none; background:#d97706; color:white; font-weight:700; cursor:pointer; font-size:0.78rem;">تأكيد التبديل لمالك</button>
                                    <button type="button" onclick="cancelRoleInput('owner')" class="py-1.5 px-3 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 text-slate-500" style="padding:8px 12px; border-radius:10px; border:1px solid #cbd5e1; background:transparent; color:#64748b; font-weight:600; cursor:pointer; font-size:0.78rem;">إلغاء</button>
                                </div>
                                <p id="owner-pwd-error" class="text-[11px] text-rose-500 mt-1 min-h-[16px]" style="color:#ef4444; font-size:0.72rem; margin:4px 0 0; min-height:16px;"></p>
                            </div>
                        </div>

                        <!-- 2. Admin Level Card -->
                        <div class="border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 transition hover:border-teal-500 dark:hover:border-teal-400 cursor-pointer bg-white/80 dark:bg-slate-900/60 shadow-sm" id="card-role-admin" onclick="selectRoleLevel('admin')" style="padding:12px; border-radius:16px; border:1px solid rgba(226,232,240,0.8); cursor:pointer; background:rgba(255,255,255,0.7);">
                            <div class="flex items-start justify-between gap-2" style="display:flex; align-items:flex-start; justify-content:space-between;">
                                <div class="flex items-center gap-3" style="display:flex; align-items:center; gap:10px;">
                                    <div class="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 flex items-center justify-center text-lg flex-shrink-0" style="width:38px; height:38px; border-radius:12px; background:rgba(15,118,110,0.15); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
                                        🛡️
                                    </div>
                                    <div>
                                        <div class="flex items-center gap-2" style="display:flex; align-items:center; gap:6px;">
                                            <h4 class="text-xs font-black text-slate-800 dark:text-white" style="font-size:0.85rem; font-weight:800; margin:0;">مدير مستشفى (Admin)</h4>
                                            <span id="tag-active-admin" class="hidden text-[10px] px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-bold" style="font-size:0.68rem; padding:2px 8px; border-radius:999px; background:rgba(15,118,110,0.15); color:#0f766e; font-weight:800;">نشط حالياً ✓</span>
                                        </div>
                                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5" style="font-size:0.72rem; color:#64748b; margin:2px 0 0;">إدارة وتعديل جداول الخفارات للمقيمين والاختصاصيين وتعديل الأطباء</p>
                                    </div>
                                </div>
                            </div>
                            <!-- Password input for admin if needed -->
                            <div id="admin-pwd-box" class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 hidden" style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(226,232,240,0.8);" onclick="event.stopPropagation()">
                                <div class="relative mb-2" style="position:relative; margin-bottom:8px;">
                                    <input type="password" id="admin-level-pwd" class="hub-input text-xs w-full" placeholder="أدخل كلمة مرور الإدارة..." onkeydown="if(event.key==='Enter') confirmUpgradeToRole('admin')" />
                                    <button type="button" onclick="toggleInputPwd('admin-level-pwd', 'admin-eye-icon')" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:#94a3b8;">
                                        <i class="fas fa-eye" id="admin-eye-icon"></i>
                                    </button>
                                </div>
                                <div class="flex gap-2" style="display:flex; gap:8px;">
                                    <button type="button" onclick="confirmUpgradeToRole('admin')" class="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition shadow-sm" style="flex:1; padding:8px 12px; border-radius:10px; border:none; background:#0f766e; color:white; font-weight:700; cursor:pointer; font-size:0.78rem;">تأكيد التبديل لمدير</button>
                                    <button type="button" onclick="cancelRoleInput('admin')" class="py-1.5 px-3 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 text-slate-500" style="padding:8px 12px; border-radius:10px; border:1px solid #cbd5e1; background:transparent; color:#64748b; font-weight:600; cursor:pointer; font-size:0.78rem;">إلغاء</button>
                                </div>
                                <p id="admin-pwd-error" class="text-[11px] text-rose-500 mt-1 min-h-[16px]" style="color:#ef4444; font-size:0.72rem; margin:4px 0 0; min-height:16px;"></p>
                            </div>
                        </div>

                        <!-- 3. User Level Card -->
                        <div class="border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 transition hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer bg-white/80 dark:bg-slate-900/60 shadow-sm" id="card-role-user" onclick="selectRoleLevel('user')" style="padding:12px; border-radius:16px; border:1px solid rgba(226,232,240,0.8); cursor:pointer; background:rgba(255,255,255,0.7);">
                            <div class="flex items-start justify-between gap-2" style="display:flex; align-items:flex-start; justify-content:space-between;">
                                <div class="flex items-center gap-3" style="display:flex; align-items:center; gap:10px;">
                                    <div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-lg flex-shrink-0" style="width:38px; height:38px; border-radius:12px; background:rgba(100,116,139,0.15); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
                                        👨‍⚕️
                                    </div>
                                    <div>
                                        <div class="flex items-center gap-2" style="display:flex; align-items:center; gap:6px;">
                                            <h4 class="text-xs font-black text-slate-800 dark:text-white" style="font-size:0.85rem; font-weight:800; margin:0;">مستخدم عادي (User)</h4>
                                            <span id="tag-active-user" class="hidden text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold" style="font-size:0.68rem; padding:2px 8px; border-radius:999px; background:rgba(100,116,139,0.15); color:#475569; font-weight:800;">نشط حالياً ✓</span>
                                        </div>
                                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5" style="font-size:0.72rem; color:#64748b; margin:2px 0 0;">استعراض جداول الخفارات واليوميات والبحث عن الأطباء (وضع القراءة فقط)</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer Quick Actions -->
                    <div class="mt-5 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between" style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid rgba(226,232,240,0.8);">
                        <button type="button" onclick="handleDockLockAction(); closeRoleSwitcherModal();" class="text-xs font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40" style="background:none; border:none; color:#ef4444; font-weight:700; font-size:0.78rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i class="fas fa-sign-out-alt"></i> قفل التطبيق وخروج
                        </button>
                        <button type="button" onclick="closeRoleSwitcherModal()" class="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700" style="padding:6px 14px; border-radius:10px; border:1px solid #cbd5e1; background:transparent; color:#64748b; font-weight:700; font-size:0.78rem; cursor:pointer;">
                            إغلاق
                        </button>
                    </div>
                </div>
            </div>

            <!-- Legacy Upgrade to Admin/Owner Modal Dialog (Kept for compatibility) -->
            <div id="hub-upgrade-modal" class="hub-modal-overlay" style="display:none;">
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

            ${activePageId !== 'hub' ? `
            <!-- Universal Mobile Bottom App Dock -->
            <nav class="hub-mobile-bottom-dock" id="hub-bottom-dock">
                <a href="./index.html" class="dock-tab-btn ${activePageId === 'hub' ? 'active' : ''}" title="البوابة الرئيسية">
                    <i class="fas fa-hospital-alt"></i>
                    <span>الرئيسية</span>
                </a>
                <a href="./Home.html${queryParam}" class="dock-tab-btn ${activePageId === 'roster' ? 'active' : ''}" title="خفراء اليوم">
                    <i class="fas fa-users-viewfinder"></i>
                    <span>الخفراء</span>
                </a>
                <a href="./schedule.html${queryParam}" class="dock-tab-btn ${activePageId === 'schedule' ? 'active' : ''}" title="جدول الخفارات الشهري">
                    <i class="fas fa-calendar-week"></i>
                    <span>الجدول</span>
                </a>
                <a href="./specialists.html${queryParam}" class="dock-tab-btn ${activePageId === 'specialists' ? 'active' : ''}" title="أطباء الاختصاص">
                    <i class="fas fa-user-tie"></i>
                    <span>الاختصاص</span>
                </a>
                <a href="./residents.html${queryParam}" class="dock-tab-btn ${activePageId === 'residents' ? 'active' : ''}" title="دليل المقيمين">
                    <i class="fas fa-address-book"></i>
                    <span>المقيمين</span>
                </a>
                <a href="./signup.html${queryParam}" class="dock-tab-btn ${activePageId === 'signup' ? 'active' : ''}" title="تبديل الخفارات">
                    <i class="fas fa-calendar-check"></i>
                    <span>تبديل</span>
                </a>
                ${(isAdmin || isOwner || isCurrentHospAdmin) ? `
                <a href="./scheduler.html${queryParam}" class="dock-tab-btn ${activePageId === 'scheduler' ? 'active' : ''}" title="المجدول (صلاحيات الإدارة)">
                    <i class="fas fa-calendar-alt"></i>
                    <span>المجدول</span>
                </a>
                ` : ''}
            </nav>
            ` : ''}

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
            openRoleSwitcherModal();
        }
    };

    // ============================================================
    // UNIVERSAL USER LEVEL SWITCHER CONTROLLER
    // ============================================================
    function showNavToast(msg, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
            return;
        }
        let toast = document.getElementById('universal-nav-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'universal-nav-toast';
            toast.style.cssText = 'position:fixed; bottom:84px; left:50%; transform:translateX(-50%); z-index:999999; padding:10px 22px; border-radius:14px; font-weight:700; font-size:0.85rem; box-shadow:0 12px 30px rgba(0,0,0,0.25); transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1); pointer-events:none; opacity:0; direction:rtl; text-align:center;';
            document.body.appendChild(toast);
        }
        const bg = type === 'success' ? '#0f766e' : (type === 'error' ? '#e11d48' : '#1e293b');
        toast.style.background = bg;
        toast.style.color = '#ffffff';
        toast.textContent = msg;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(12px)';
        }, 2800);
    }

    window.openRoleSwitcherModal = function() {
        const modal = document.getElementById('role-switcher-modal');
        if (!modal) return;

        const isOwner = window.Hub ? window.Hub.auth.isOwner() : false;
        const isAdmin = window.Hub ? window.Hub.auth.isAdmin() : false;

        // 1. Current badge indicator
        const badgeEl = document.getElementById('switcher-current-role-badge');
        const hospBadgeEl = document.getElementById('switcher-hospital-badge');
        if (badgeEl) {
            if (isOwner) {
                badgeEl.className = 'px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';
                badgeEl.textContent = 'المالك 👑';
            } else if (isAdmin) {
                badgeEl.className = 'px-2.5 py-1 rounded-full text-xs font-black bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300';
                const hName = (window.Hub && window.Hub.auth.getAdminHospitalName) ? window.Hub.auth.getAdminHospitalName() : 'مدير';
                badgeEl.textContent = `مدير (${hName.length > 14 ? 'المستشفى' : hName}) 🛡️`;
            } else {
                badgeEl.className = 'px-2.5 py-1 rounded-full text-xs font-black bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
                badgeEl.textContent = 'مستخدم عادي 👨‍⚕️';
            }
        }
        if (hospBadgeEl) {
            hospBadgeEl.textContent = (isAdmin && !isOwner && window.Hub && window.Hub.auth.getAdminHospitalName) ? window.Hub.auth.getAdminHospitalName() : '';
        }

        // 2. Active cards & tags
        ['owner', 'admin', 'user'].forEach(r => {
            const tag = document.getElementById(`tag-active-${r}`);
            const card = document.getElementById(`card-role-${r}`);
            const isActive = (r === 'owner' && isOwner) || (r === 'admin' && isAdmin && !isOwner) || (r === 'user' && !isAdmin && !isOwner);
            if (tag) {
                if (isActive) tag.classList.remove('hidden');
                else tag.classList.add('hidden');
            }
            if (card) {
                if (isActive) {
                    card.classList.add('ring-2', 'ring-teal-500', 'dark:ring-amber-400');
                    card.style.borderColor = isOwner ? '#f59e0b' : '#0f766e';
                    card.style.boxShadow = '0 0 0 2px ' + (isOwner ? '#f59e0b' : '#0f766e');
                } else {
                    card.classList.remove('ring-2', 'ring-teal-500', 'dark:ring-amber-400');
                    card.style.borderColor = '';
                    card.style.boxShadow = '';
                }
            }
        });

        // 3. Reset password boxes
        cancelRoleInput('owner');
        cancelRoleInput('admin');

        modal.classList.add('active');
    };

    window.closeRoleSwitcherModal = function() {
        const modal = document.getElementById('role-switcher-modal');
        if (modal) modal.classList.remove('active');
        pendingAdminUrl = null;
    };

    window.cancelRoleInput = function(role) {
        const box = document.getElementById(`${role}-pwd-box`);
        const input = document.getElementById(`${role}-level-pwd`);
        const err = document.getElementById(`${role}-pwd-error`);
        if (box) box.classList.add('hidden');
        if (input) input.value = '';
        if (err) err.textContent = '';
    };

    window.toggleInputPwd = function(inputId, iconId) {
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if (!input) return;
        const isPwd = input.type === 'password';
        input.type = isPwd ? 'text' : 'password';
        if (icon) {
            icon.className = isPwd ? 'fas fa-eye-slash' : 'fas fa-eye';
        }
    };

    window.selectRoleLevel = function(targetRole) {
        if (!window.Hub) return;
        const isOwner = window.Hub.auth.isOwner();
        const isAdmin = window.Hub.auth.isAdmin();

        // Determine current and target rank: owner = 3, admin = 2, user = 1
        const currentRank = isOwner ? 3 : (isAdmin ? 2 : 1);
        const targetRank = targetRole === 'owner' ? 3 : (targetRole === 'admin' ? 2 : 1);

        // 1. Same level check
        if (targetRank === currentRank) {
            showNavToast('أنت تعمل حالياً بهذا المستوى بالفعل', 'info');
            return;
        }

        // 2. DESCENDING PRIVILEGE: NO PASSWORD REQUIRED!
        if (targetRank < currentRank) {
            if (targetRole === 'admin') {
                // Owner descending to Admin (no password needed)
                window.Hub.auth.saveSession('admin', '', true, ['*']);
                if (typeof window.updateTopRoleBadge === 'function') window.updateTopRoleBadge();
                if (typeof window.renderHubDashboard === 'function') window.renderHubDashboard();
                closeRoleSwitcherModal();
                showNavToast('تم التبديل بنجاح إلى: مدير مستشفى 🛡️', 'success');
                return;
            }
            if (targetRole === 'user') {
                // Owner or Admin descending to Regular User (no password needed)
                window.Hub.auth.saveSession('user', '', true, []);
                if (typeof window.updateTopRoleBadge === 'function') window.updateTopRoleBadge();
                if (typeof window.renderHubDashboard === 'function') window.renderHubDashboard();
                closeRoleSwitcherModal();
                showNavToast('تم التبديل بنجاح إلى: مستخدم عادي 👨‍⚕️', 'success');
                return;
            }
        }

        // 3. ASCENDING PRIVILEGE: PASSWORD IS A STRICT MUST!
        // A regular user CANNOT become an Admin or an Owner without a password.
        // An admin CANNOT become an Owner without a password.
        if (targetRole === 'admin') {
            // User ascending to Admin: MUST enter Admin password!
            const adminBox = document.getElementById('admin-pwd-box');
            const ownerBox = document.getElementById('owner-pwd-box');
            if (adminBox) adminBox.classList.remove('hidden');
            if (ownerBox) ownerBox.classList.add('hidden');
            const pwdInput = document.getElementById('admin-level-pwd');
            const err = document.getElementById('admin-pwd-error');
            if (err) err.textContent = '';
            if (pwdInput) {
                pwdInput.value = '';
                setTimeout(() => pwdInput.focus(), 80);
            }
            return;
        }

        if (targetRole === 'owner') {
            // User or Admin ascending to Owner: MUST enter Owner password!
            const ownerBox = document.getElementById('owner-pwd-box');
            const adminBox = document.getElementById('admin-pwd-box');
            if (ownerBox) ownerBox.classList.remove('hidden');
            if (adminBox) adminBox.classList.add('hidden');
            const pwdInput = document.getElementById('owner-level-pwd');
            const err = document.getElementById('owner-pwd-error');
            if (err) err.textContent = '';
            if (pwdInput) {
                pwdInput.value = '';
                setTimeout(() => pwdInput.focus(), 80);
            }
            return;
        }
    };

    window.confirmUpgradeToRole = function(targetRole) {
        if (!window.Hub) return;
        const input = document.getElementById(`${targetRole}-level-pwd`);
        const err = document.getElementById(`${targetRole}-pwd-error`);
        const pwd = (input?.value || '').trim();

        if (!pwd) {
            if (err) err.textContent = 'يرجى إدخال كلمة المرور';
            return;
        }

        const res = window.Hub.auth.login(pwd);
        if (res.success) {
            // If ascending to owner, verified role MUST be owner
            if (targetRole === 'owner' && res.role !== 'owner') {
                if (err) err.textContent = 'كلمة المرور المدخلة ليست كلمة مرور المالك!';
                return;
            }

            // If ascending to admin, verified role can be admin or owner
            if (targetRole === 'admin' && res.role !== 'admin' && res.role !== 'owner') {
                if (err) err.textContent = 'كلمة المرور غير صحيحة، حاول مجدداً';
                return;
            }

            if (targetRole === 'admin' && res.role === 'owner') {
                window.Hub.auth.saveSession('admin', pwd, true, ['*']);
            }

            if (err) err.textContent = '';
            if (typeof window.updateTopRoleBadge === 'function') window.updateTopRoleBadge();
            if (typeof window.renderHubDashboard === 'function') window.renderHubDashboard();
            closeRoleSwitcherModal();

            const roleName = targetRole === 'owner' ? 'المالك 👑' : 'مدير مستشفى 🛡️';
            showNavToast(`تم التبديل بنجاح إلى: ${roleName}`, 'success');

            if (pendingAdminUrl) {
                const target = pendingAdminUrl;
                pendingAdminUrl = null;
                window.location.href = target;
            }
        } else {
            if (err) err.textContent = 'كلمة المرور غير صحيحة، حاول مجدداً';
            if (input) {
                input.value = '';
                input.focus();
            }
        }
    };

    window.handleRoleBadgeClick = function() {
        if (!window.Hub) return;
        if (!window.Hub.auth.isLoggedIn()) {
            window.location.href = './index.html';
            return;
        }
        window.openRoleSwitcherModal();
    };

    window.handleDockLockAction = function() {
        if (window.Hub && window.Hub.auth) {
            window.Hub.auth.logout();
        }
        window.location.href = './index.html';
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

        // Close modal immediately on save
        closeAllPasswordsModalNav();

        try {
            await window.Hub.updateAllPasswords({
                owner: oVal,
                admin: aVal,
                user: uVal
            }, scope);

            if (typeof showToast === 'function') {
                showToast('تم تحديث جميع كلمات المرور بنجاح 🔐', 'success');
            } else {
                alert('تم تحديث جميع كلمات المرور بنجاح 🔐');
            }
        } catch (e) {
            console.error('Password update error:', e);
            if (typeof showToast === 'function') {
                showToast(e.message || 'حدث خطأ أثناء حفظ كلمات المرور', 'error');
            } else if (err) {
                err.textContent = e.message || 'حدث خطأ أثناء حفظ كلمات المرور';
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check-circle ml-1"></i> حفظ وتطبيق كلمات المرور';
            }
        }
    };

    // ============================================================
    // SEAMLESS APP NAVIGATION & INSTANT PRE-RENDERING
    // ============================================================
    let isNavSetup = false;
    function setupSeamlessAppNavigation() {
        if (isNavSetup) return;
        isNavSetup = true;

        // 1. Ensure progress bar element exists
        let progressEl = document.getElementById('hub-nav-progress');
        if (!progressEl) {
            progressEl = document.createElement('div');
            progressEl.id = 'hub-nav-progress';
            document.body.appendChild(progressEl);
        }

        // 2. Finish progress bar on page show / complete
        const finishProgress = () => {
            if (progressEl) {
                progressEl.classList.remove('loading');
                progressEl.classList.add('done');
                setTimeout(() => {
                    progressEl.classList.remove('done');
                    progressEl.style.transform = 'scaleX(0)';
                }, 350);
            }
        };

        window.addEventListener('pageshow', finishProgress);

        // 3. Smooth progress on internal page navigation links
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (!link) return;
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
            if (link.target && link.target !== '_self') return;
            if (link.hasAttribute('download')) return;

            // Internal page navigation
            if (href.includes('.html') || (!href.includes('://') && !href.startsWith('//'))) {
                if (progressEl) {
                    progressEl.style.transform = '';
                    progressEl.classList.remove('done');
                    progressEl.classList.add('loading');
                }
            }
        }, { capture: true });

        // 4. Speculation Rules for instant background pre-rendering
        try {
            if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
                if (!document.querySelector('script[type="speculationrules"]')) {
                    const specScript = document.createElement('script');
                    specScript.type = 'speculationrules';
                    specScript.textContent = JSON.stringify({
                        prerender: [
                            {
                                where: {
                                    href_matches: "/*"
                                },
                                eagerness: "moderate"
                            }
                        ]
                    });
                    document.head.appendChild(specScript);
                }
            }
        } catch (e) {
            // Silently fallback if speculation rules are not supported
        }
    }

    window.initUniversalNav = initUniversalNav;

})(window);

