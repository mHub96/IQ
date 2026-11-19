/**
 * Tutorials (the "الدليل" tab of the account panel) and the interactive tours they start.
 *
 * A guide first teaches the task in the panel (what it is for, the steps), then "ابدأ الجولة" takes
 * the user to the page (when it is another page) and walks through its elements with a spotlight.
 * Guides are chosen by the user's authority (doctor, rotator, anaesthesia, branch representative,
 * hospital admin, owner, Administrative Affairs). Every tour can be skipped at any moment (✕, Esc, back).
 * Display only: tours read the page and point at it; they never press its buttons or change data.
 */
(function (window, document) {
    'use strict';

    const PENDING_KEY = 'hub_tour_pending';
    const DONE_KEY = 'hub_tours_done';
    const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
    const write = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const pageFile = () => (location.pathname.split('/').pop() || 'index.html');

    // ------------------------------------------------------------------
    // Who is reading: the guides shown depend on it
    // ------------------------------------------------------------------
    function who() {
        const Hub = window.Hub;
        if (!Hub || !Hub.auth) return { role: 'guest' };
        const role = Hub.auth.getRole();
        const acc = Hub.auth.getAccount ? Hub.auth.getAccount() : null;
        const accRole = acc ? acc.role : role;
        const isOwner = Hub.auth.isOwner();
        const branch = (Hub.auth.branchHospitals ? Hub.auth.branchHospitals() : []).length > 0;
        const officer = ['aa_user', 'aa_admin'].includes(accRole);
        const hosp = (acc && acc.hosp) || (Hub.getActiveHospitalId && Hub.getActiveHospitalId()) || '';
        let er = false;
        try { er = isOwner || (Hub.auth.canUseEr && Hub.auth.canUseEr(hosp)); } catch (e) {}
        return {
            role, accRole, isOwner, branch, officer, hosp, er,
            isAdmin: isOwner || role === 'admin',
            rotator: accRole === 'rotator',
            anaesthesia: role === 'anaesthesia' || accRole === 'anaesthesia',
            hasAcc: !!acc,
        };
    }
    const q = (page, c) => './' + page + (c.hosp ? '?hospital=' + encodeURIComponent(c.hosp) : '');

    // ------------------------------------------------------------------
    // The guides
    //   learn: what the panel teaches before the tour (paragraph + numbered steps)
    //   page:  where the tour runs (null = right here, e.g. inside the account panel)
    //   before: prepares the screen (opens a panel tab); steps: what the spotlight points at
    // ------------------------------------------------------------------
    const GUIDES = [
        {
            id: 'portal', group: 'basics', icon: 'fa-house-medical', title: 'جولة في الصفحة الرئيسية',
            sub: 'الخفراء الآن، العناية، والمستشفيات', who: c => !c.officer,
            page: c => './index.html?portal=true',
            learn: {
                text: 'الصفحة الرئيسية هي نقطة البداية: ترى فيها عدد الأطباء الخفراء الآن، والأسرّة الشاغرة في العناية، وكل المستشفيات بأرقامها.',
                steps: ['اقرأ عدد الخفراء الآن في البطاقة الداكنة.', 'اضغط بطاقة العناية لفتح موقف الأسرّة.', 'ابحث عن مستشفى أو اختر «مستشفاي» أو «جميع المستشفيات».', 'من بطاقة المستشفى اضغط «الخفراء اليوم» لترى من هو الخفر الآن.'],
            },
            steps: [
                ['.v5-greeting', 'تحيتك', 'اسمك وتاريخ اليوم. تتغير التحية حسب وقت اليوم.'],
                ['.live-activity-card .live-status-left', 'الخفراء الآن', 'عدد الأطباء الخفراء في هذه اللحظة في كل المستشفيات. يتحدث تلقائياً.'],
                ['#live-icu-shortcut', 'موقف العناية', 'مجموع الأسرّة الشاغرة في العناية المركزة. اضغط عليها لفتح صفحة العناية.'],
                ['#hosp-search-input', 'البحث', 'اكتب اسم مستشفى أو مدينة لتصفية القائمة.'],
                ['#hosp-segmented-filter', 'مستشفاي / الجميع', 'اختر مستشفاك فقط أو كل المستشفيات. يتذكر الموقع اختيارك.'],
                ['.hosp-widget-card', 'بطاقة المستشفى', 'الاسم والموقع، ثم أرقام اليوم: الخفراء الآن، المقيمون، التخصصات، الطوارئ والعناية.'],
                ['.hosp-roster-btn', 'الخفراء اليوم', 'يفتح قائمة الأطباء الخفراء الآن في هذا المستشفى مع أزرار الاتصال.'],
                ['.hosp-expand-arrow-btn', 'المزيد', 'يفتح بقية أدوات المستشفى: الجدول، العناية، التبديل، أطباء الاختصاص وغيرها.'],
                ['[data-hacc-slot]', 'الإشعارات وحسابك', 'الجرس للإشعارات، والصورة لفتح لوحة حسابك (ومنها هذا الدليل).'],
            ],
        },
        {
            id: 'roster', group: 'basics', icon: 'fa-user-doctor', title: 'الخفراء اليوم والاتصال بهم',
            sub: 'بطاقات الخفراء، الاتصال، والحالة', who: () => true,
            page: c => q('Home.html', c),
            learn: {
                text: 'صفحة «الخفراء اليوم» تعرض الأطباء الخفراء الآن في المستشفى، كل طبيب في بطاقة مع تخصصه ورقمه.',
                steps: ['اضغط «Call» للاتصال مباشرة أو «WhatsApp» للمراسلة.', 'اضغط شارة التخصص لترى الوقت المتبقي من الخفارة.', 'القلب للإعجاب، والفقاعة للتعليق على البطاقة.', 'زر «المتصدرين» يعرض أكثر المقيمين نشاطاً.'],
            },
            steps: [
                ['#main-content > .hospital-header', 'المستشفى', 'اسم المستشفى والوقت الحالي.'],
                ['.top-action-btn.leader', 'المتصدرون', 'لوحة أكثر المقيمين تفاعلاً اليوم والشهر.'],
                ['#report-btn', 'نسخ التقرير', 'ينسخ قائمة الخفراء اليوم نصاً جاهزاً للإرسال.'],
                ['.roster-card', 'بطاقة الخفر', 'كل طبيب خفر في بطاقة: التخصص، الاسم، والرقم.'],
                ['.roster-card .specialty-flip', 'الوقت المتبقي', 'اضغط شارة التخصص لتنقلب وتعرض الوقت المتبقي من الخفارة.'],
                ['.roster-card .action-btn-sm.call', 'اتصال', 'اتصال هاتفي مباشر بالطبيب الخفر.'],
                ['.roster-card .action-btn-sm.wa', 'واتساب', 'فتح محادثة واتساب مع الطبيب.'],
                ['.roster-card .card-actions', 'إعجاب وتعليق', 'القلب للإعجاب والفقاعة للتعليق؛ يمكن التعليق باسم مستعار.'],
                ['.roster-card .card-duty-status', 'حالة الخفر', 'حالة الطبيب الآن (في العمليات، مشغول...). صاحب البطاقة يغيّرها بالضغط عليها.'],
            ],
        },
        {
            id: 'schedule', group: 'basics', icon: 'fa-calendar-week', title: 'جدول الخفارات الشهري',
            sub: 'الأيام، الأشهر، والبحث عن طبيب', who: () => true,
            page: c => q('schedule.html', c),
            learn: {
                text: 'جدول الخفارات يعرض خفارات الشهر كاملة: يوماً بيوم، أو تخصصاً بتخصص، أو الجدول الشامل.',
                steps: ['انتقل بين الأشهر بالسهمين، و«اليوم» يعيدك للشهر الحالي.', 'اختر المقيمين أو الاختصاصيين.', 'اختر العرض: اليوم، تخصص، أو الشامل.', 'استخدم البحث لعرض خفارات طبيب معيّن، وزر الطباعة لطباعة الجدول.'],
            },
            steps: [
                ['.sch-month', 'الشهر', 'السهمان للتنقل بين الأشهر.'],
                ['#btn-jump-today', 'اليوم', 'يعيدك فوراً إلى الشهر واليوم الحاليين.'],
                ['#schedule-role-selector', 'المقيمون / الاختصاصيون', 'بدّل بين جدول المقيمين وجدول أطباء الاختصاص.'],
                ['#view-mode-selector', 'طريقة العرض', 'يوم واحد، أو تخصص واحد على الشهر، أو الجدول الشامل.'],
                ['#day-strip', 'أيام الشهر', 'اضغط أي يوم لعرض خفاراته.'],
                ['#btn-search', 'البحث عن طبيب', 'اكتب اسم طبيب لعرض كل خفاراته في الشهر.'],
            ],
        },
        {
            id: 'exchange', group: 'basics', icon: 'fa-right-left', title: 'تبديل خفارة',
            sub: 'خطوة بخطوة من اختيار اليوم إلى التأكيد', who: c => !c.rotator,
            page: c => q('signup.html', c),
            learn: {
                text: 'تبديل الخفارة يعني أن يأخذ طبيب آخر خفارتك (أو خفارة طبيب آخر) في يوم معيّن. إن كان نظام الموافقة مفعّلاً في المستشفى يُرسل التبديل طلباً لصاحب الخفارة ثم للإدارة.',
                steps: ['اختر المستشفى.', 'اختر التخصص الطبي.', 'اختر يوم الخفارة (اليوم افتراضياً).', 'تظهر «تذكرة التبديل»: في أعلاها الخفر المسجل حالياً.', 'اكتب اسم الطبيب البديل واختره من القائمة.', 'اضغط «تأكيد التبديل» (أو «إرسال طلب التبديل» عند تفعيل الموافقة).'],
            },
            steps: [
                ['#app-card > div:first-child', 'تبديل الخفارات', 'التاريخ في الشارة الخضراء هو يوم الخفارة المختار.'],
                ['.xch-progress', 'التقدّم', 'يمتلئ الشريط كلما أكملت خطوة.'],
                ['#hosp-select', 'الخطوة ١: المستشفى', 'اختر المستشفى. تظهر علامة ✓ بجانب الخطوة عند اكتمالها.'],
                ['#spec-group', 'الخطوة ٢: التخصص', 'اختر التخصص الطبي؛ بعدها يظهر اختيار اليوم.'],
                ['#date-group', 'الخطوة ٣: اليوم', 'غيّر التاريخ إن كان التبديل ليوم آخر.'],
                ['#duty-status-group', 'الخفر الحالي', 'أعلى التذكرة: الطبيب المسجل في هذا اليوم. إن وُجد أكثر من واحد اختر من تريد التبديل معه.'],
                ['#name-section', 'الطبيب البديل', 'اكتب الاسم، وستظهر الأسماء المطابقة لتختار منها.'],
                ['#update-btn', 'التأكيد', 'يصبح الزر فعّالاً عند اكتمال كل شيء. اضغطه لتثبيت التبديل أو إرسال الطلب.'],
                ['#my-exchanges-btn', 'طلبات التبديل', 'هنا تتابع طلباتك وموافقاتها عند تفعيل نظام الموافقة.'],
            ],
        },
        {
            id: 'icu', group: 'basics', icon: 'fa-bed-pulse', title: 'موقف العناية المركزة',
            sub: 'الأسرّة الشاغرة في كل المستشفيات', who: c => !c.officer,
            page: c => './icu.html',
            learn: {
                text: 'موقف العناية يعرض أسرّة العناية المركزة: الكلية، الصالحة، المشغولة، والشاغرة، لكل مستشفى.',
                steps: ['اقرأ المجاميع في المربعات الملونة.', 'صفِّ المستشفيات: الكل، يتوفر سرير، أو ممتلئة.', 'كل بطاقة مستشفى تعرض نسبة الإشغال وأعداد الأسرّة.'],
            },
            steps: [
                ['#kpi-container', 'المجاميع', 'الأسرّة الكلية والصالحة والمشغولة والشاغرة ونسبة الإشغال.'],
                ['.filter-tab[data-filter="available"]', 'التصفية', 'اعرض المستشفيات التي فيها سرير شاغر، أو الممتلئة.'],
                ['#icu-search-input', 'البحث', 'ابحث عن مستشفى أو مدينة.'],
                ['.icu-hosp-card', 'بطاقة المستشفى', 'نسبة الإشغال وأعداد الأسرّة وآخر تحديث.'],
            ],
        },
        {
            id: 'icu-edit', group: 'role', icon: 'fa-syringe', title: 'تحديث موقف العناية (مقيم التخدير)',
            sub: 'تعديل أعداد الأسرّة', who: c => c.anaesthesia || c.isAdmin,
            page: c => './icu.html',
            learn: {
                text: 'بصفتك مقيم تخدير يمكنك تحديث أعداد أسرّة العناية في مستشفاك (أو كل المستشفيات إن فعّل المالك ذلك).',
                steps: ['افتح صفحة موقف العناية.', 'في بطاقة مستشفاك اضغط «تعديل الموقف».', 'أدخل الأسرّة الصالحة والمشغولة واحفظ. يظهر التحديث للجميع فوراً.'],
            },
            steps: [
                ['.icu-hosp-card', 'بطاقة مستشفاك', 'ابحث عن بطاقة مستشفاك هنا.'],
                ['.icu-hosp-card button[onclick*="Edit"], .icu-hosp-card [onclick*="openIcuEdit"]', 'تعديل الموقف', 'اضغط هنا لتحديث أعداد الأسرّة.'],
            ],
        },
        {
            id: 'directory', group: 'basics', icon: 'fa-address-book', title: 'دليل المقيمين',
            sub: 'البحث عن أي طبيب والتواصل معه', who: c => !c.officer,
            page: c => './residents.html',
            learn: {
                text: 'دليل المقيمين يضم كل الأطباء المقيمين بأرقامهم وتخصصاتهم ومستشفياتهم.',
                steps: ['اختر المستشفى من الأزرار في الأعلى.', 'ابحث بالاسم أو الرقم أو التخصص.', 'صفِّ حسب التخصص أو الحالة.', 'اضغط الرقم للاتصال أو أيقونة واتساب للمراسلة.'],
            },
            steps: [
                ['main > .glass-card:first-child', 'الدليل', 'عدد الأطباء المسجلين والظاهرين في البحث.'],
                ['#hospital-filter-pills', 'المستشفى', 'اختر مستشفى أو جميع المستشفيات.'],
                ['#search-input', 'البحث', 'ابحث بالاسم أو رقم الهاتف أو التخصص.'],
                ['#spec-filter', 'التخصص', 'اعرض تخصصاً واحداً.'],
                ['#residents-grid > *', 'بطاقة الطبيب', 'الاسم والتخصص والمستشفى، مع أزرار الاتصال وواتساب.'],
            ],
        },
        {
            id: 'specialists', group: 'basics', icon: 'fa-user-tie', title: 'أطباء الاختصاص ودليل العيادات',
            sub: 'الاستشاريون وعياداتهم في البصرة', who: c => !c.officer,
            page: c => './specialists.html',
            learn: {
                text: 'صفحة أطباء الاختصاص تضم الاستشاريين وأطباء البورد، وفيها «دليل العيادات الخاصة في البصرة» بالعناوين وأرقام الحجز.',
                steps: ['افتح «دليل العيادات» للبحث عن عيادة أو مختبر أو صيدلية.', 'صفِّ أطباء الاختصاص حسب المستشفى والتخصص واللقب.', 'من بطاقة الطبيب: أيام الاستشارية والعمليات، والاتصال.'],
            },
            steps: [
                ['#guide-entry', 'دليل العيادات', 'عيادات أطباء الاختصاص في البصرة مع أيام الدوام وأرقام الحجز، والمختبرات والصيدليات.'],
                ['#hospital-filter-pills', 'المستشفى', 'اختر المستشفى.'],
                ['#search-input', 'البحث', 'ابحث بالاسم أو التخصص.'],
                ['#title-filter', 'اللقب', 'استشاري، بورد، أو الكل.'],
                ['#specialists-container', 'البطاقات', 'بطاقة لكل طبيب اختصاص مع أيامه وأرقامه.'],
            ],
        },
        {
            id: 'account', group: 'basics', icon: 'fa-id-card', title: 'لوحة حسابك',
            sub: 'الملف، جدولي، التعليقات، والإعدادات', who: c => c.hasAcc, page: null,
            before: () => window.HubAccounts && HubAccounts.openPanel('profile'),
            learn: {
                text: 'لوحة الحساب تفتح من صورتك في أعلى الصفحة. فيها ملفك ونقاطك وكؤوسك، وجدول خفاراتك، والتعليقات على بطاقاتك، والإعدادات.',
                steps: ['«الملف الشخصي»: بياناتك ومستواك وكؤوسك وصورتك الرمزية.', '«جدولي»: خفاراتك القادمة، ويمكن إضافتها لتقويم هاتفك.', '«تعليقاتي»: ما كُتب على بطاقاتك.', '«الإعدادات»: المظهر، البصمة، الإشعارات، وكلمة المرور.'],
            },
            steps: [
                ['.hp-head', 'حسابك', 'اسمك ونوع حسابك.'],
                ['.hacc-tabs [data-tab="profile"]', 'الملف الشخصي', 'مستواك ونقاطك وكؤوسك وصورتك الرمزية.'],
                ['.hacc-tabs [data-tab="schedule"]', 'جدولي', 'خفاراتك القادمة في كل المستشفيات.'],
                ['.hacc-tabs [data-tab="comments"]', 'تعليقاتي', 'التعليقات والإعجابات على بطاقاتك.'],
                ['.hacc-tabs [data-tab="settings"]', 'الإعدادات', 'المظهر والبصمة والإشعارات وكلمة المرور.'],
                ['.hacc-tabs [data-tab="guide"]', 'الدليل', 'هنا تجد كل الشروحات متى احتجتها.'],
            ],
        },
        {
            id: 'biometric', group: 'basics', icon: 'fa-fingerprint', title: 'الدخول بالبصمة أو الوجه',
            sub: 'تفعيله أو إيقافه على جهازك', who: c => c.hasAcc, page: null,
            before: () => window.HubAccounts && HubAccounts.openPanel('settings'),
            learn: {
                text: 'يمكنك الدخول إلى البوابة ببصمة الإصبع أو بالوجه بدل كتابة كلمة المرور، على كل جهاز تفعّله فيه.',
                steps: ['افتح الإعدادات من لوحة حسابك.', 'شغّل مفتاح «على هذا الجهاز» وأكّد ببصمتك.', 'في شاشة الدخول اختر الدخول بالبصمة.', 'لإيقافه أطفئ المفتاح؛ يبقى الدخول بكلمة المرور.'],
            },
            steps: [
                ['[data-role="pk-section"]', 'البصمة / الوجه', 'المفتاح يفعّل الدخول بالبصمة على هذا الجهاز أو يوقفه، وتحته الأجهزة المفعّلة.'],
            ],
        },
        {
            id: 'notifications', group: 'basics', icon: 'fa-bell', title: 'الإشعارات',
            sub: 'تنبيهات الخفارات والطلبات', who: c => c.hasAcc, page: null,
            before: () => window.HubAccounts && HubAccounts.openPanel('settings'),
            learn: {
                text: 'فعّل الإشعارات لتصلك تنبيهات خفاراتك وطلبات التبديل والتواصل حتى والتطبيق مغلق.',
                steps: ['افتح الإعدادات.', 'في قسم الإشعارات اضغط تفعيل ووافق على طلب المتصفح.', 'جرّب «إشعار تجريبي».'],
            },
            steps: [
                ['[data-act="push"]', 'تفعيل الإشعارات', 'اضغط لتفعيل الإشعارات على هذا الجهاز.'],
            ],
        },
        // ---- Administration ----
        {
            id: 'admin-page', group: 'admin', icon: 'fa-hospital-user', title: 'إدارة المستشفى والمقيمين',
            sub: 'الأدوات، المقيمون، والتخصصات', who: c => c.isAdmin || c.branch,
            page: c => q('admin.html', c),
            learn: {
                text: 'صفحة الإدارة لإدارة مقيمي المستشفى وتخصصاته وإعداداته ونسخه الاحتياطية.',
                steps: ['أضف مقيماً جديداً أو من جهات الاتصال.', 'ابحث في المقيمين وافتح التخصص لترى من فيه.', 'من الأدوات: إعدادات المستشفى، التخصصات، رئيس الأطباء، والنسخ الاحتياطي.', 'لا تنسَ «حفظ في السيرفر» بعد التعديل.'],
            },
            steps: [
                ['#app-body main > .glass-card:first-child .branch-hide', 'أدوات المستشفى', 'الإعدادات والتخصصات ورئيس الأطباء والإحصائية والنسخ الاحتياطي.'],
                ['#main-save-btn', 'الحفظ', 'يحفظ تعديلاتك في السيرفر.'],
                ['[onclick^="openAddResident"]', 'إضافة مقيم', 'أضف مقيماً جديداً يدوياً أو من جهات الاتصال.'],
                ['#admin-resident-search', 'البحث', 'ابحث بالاسم أو الرقم أو التخصص.'],
                ['#residents-accordion-list', 'المقيمون حسب التخصص', 'افتح التخصص لترى مقيميه وتعدّلهم.'],
            ],
        },
        {
            id: 'scheduler', group: 'admin', icon: 'fa-calendar-plus', title: 'المجدول: تعبئة الجدول',
            sub: 'كتابة الخفارات وحفظها', who: c => c.isAdmin || c.branch,
            page: c => q('scheduler.html', c),
            learn: {
                text: 'المجدول هو مكان كتابة جدول الخفارات الشهري لكل تخصص.',
                steps: ['اختر الشهر.', 'اختر المقيمين أو الاختصاصيين، وتخصصاً أو الكل.', 'اكتب اسم الطبيب في يومه (تظهر الأسماء المقترحة).', 'اضغط «حفظ الجدول».'],
            },
            steps: [
                ['#scheduler-mode-selector', 'المقيمون / الاختصاصيون', 'اختر الجدول الذي تعمل عليه.'],
                ['#specialty-quick-select', 'التخصص', 'انتقل إلى تخصص بعينه.'],
                ['#month-picker', 'الشهر', 'اختر شهر الجدول.'],
                ['#synchronize-button', 'حفظ الجدول', 'يحفظ الجدول في السيرفر (أو Ctrl+S).'],
            ],
        },
        {
            id: 'admin-tab', group: 'admin', icon: 'fa-shield-halved', title: 'لوحة الإدارة في حسابك',
            sub: 'الطلبات، الإحصائيات، والإعدادات', who: c => c.isAdmin, page: null,
            before: () => window.HubAccounts && HubAccounts.openPanel('admin'),
            learn: {
                text: 'تبويب الإدارة في لوحة حسابك يجمع طلبات الحسابات وكلمات المرور ومراجعة التعليقات وإعدادات المستشفيات والإحصائيات. المجموعات مطوية؛ اضغط أي مجموعة لفتحها.',
                steps: ['«إدارة الحسابات»: كل الحسابات وأدوارها.', 'الإحصائيات: تُحمّل عند فتحها فقط.', 'افتح المجموعة التي تحتاجها.'],
            },
            steps: [
                ['.hp-admin-lead', 'إدارة الحسابات', 'كل الحسابات: الأدوار والمستشفيات والأجهزة.'],
                ['details.hp-acc[data-group="stats"]', 'الإحصائيات', 'اضغط لفتحها؛ لا تُحمّل قبل ذلك.'],
                ['details.hp-acc[data-group="accounts"]', 'الحسابات', 'الطلبات وكلمات المرور والتعليقات.'],
                ['details.hp-acc[data-group="hospitals"], details.hp-acc[data-group="hospital"]', 'المستشفى', 'إعدادات المستشفيات وطلبات التبديل.'],
                ['details.hp-acc[data-group="system"]', 'المنظومة', 'الطوارئ، حالات الخفارة، المستشفيات والتخصصات والنسخ.'],
                ['details.hp-acc[data-group="perm"]', 'الصلاحيات', 'كلمات المرور المشتركة ومفاتيح الصلاحيات.'],
            ],
        },
        {
            id: 'er', group: 'admin', icon: 'fa-truck-medical', title: 'جدول الطوارئ (ER)',
            sub: 'التوزيع والطباعة والنسخ', who: c => c.er,
            page: c => q('emergency.html', c),
            learn: {
                text: 'نظام الطوارئ يوزّع خفارات الطوارئ والاستشارية والوفيات ويطبع الجداول الرسمية.',
                steps: ['اختر الجدول من الشريط الجانبي (أو الأعلى في الهاتف).', 'راجع لوحة الجاهزية لترى النقص.', 'وزّع تلقائياً أو يدوياً، ثم «حفظ».', 'اطبع أو نزّل PDF من قائمة الطباعة.'],
            },
            steps: [
                ['.ers-side, .ers-tabs', 'الجداول', 'الطوارئ والاستشارية والوفيات والإسناد وقاعدة المقيمين.'],
                ['.ers-top-actions', 'الحفظ والطباعة', 'الحفظ وخيارات الطباعة وتنزيل PDF.'],
                ['#schedule-view-container', 'الجدول', 'خلايا الجدول للأيام والمناوبات.'],
            ],
        },
    ];
    const GROUPS = [['basics', 'الأساسيات'], ['role', 'لصلاحيتك'], ['admin', 'أدوات الإدارة']];
    const guideById = id => GUIDES.find(g => g.id === id);

    // ------------------------------------------------------------------
    // The tour on the page: a spotlight and a card, step by step
    // ------------------------------------------------------------------
    let run = null;   // { guide, steps: [[el, title, text]], i, root }
    const visible = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    function resolveSteps(guide) {
        return guide.steps.map(([sel, title, text]) => {
            let el = null;
            try { el = [...document.querySelectorAll(sel)].find(visible) || null; } catch (e) {}
            return el ? [el, title, text, sel] : null;
        }).filter(Boolean);
    }

    function start(id) {
        const guide = guideById(id);
        if (!guide) return;
        stop(false);
        try { if (guide.before) guide.before(); } catch (e) {}
        // Wait for the page (or the panel) to draw what the tour points at. A panel being reopened
        // replaces its elements, so tours that prepare the screen give it a moment first.
        const t0 = Date.now() + (guide.before ? 700 : 0);
        if (guide.before) return setTimeout(() => waitFor(guide, t0), 700);
        waitFor(guide, t0);
    }
    function waitFor(guide, t0) {
        (function wait() {
            const steps = resolveSteps(guide);
            const ready = steps.length && (steps.length >= Math.min(3, guide.steps.length) || Date.now() - t0 > 2500);
            if (ready) return open(guide, steps);
            if (Date.now() - t0 > 8000) return toast('تعذّر عرض الجولة هنا الآن. جرّب مجدداً بعد تحميل الصفحة.');
            setTimeout(wait, 250);
        })();
    }

    function open(guide, steps) {
        const root = document.createElement('div');
        root.id = 'hub-tour';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'جولة: ' + guide.title);
        root.innerHTML = `<div class="ht-catch"></div><div class="ht-spot"></div>
            <div class="ht-card" role="document">
                <div class="ht-top"><span class="ht-count"></span><span class="ht-guide"><i class="fas ${guide.icon}"></i> ${esc(guide.title)}</span>
                    <button type="button" class="ht-skip" data-ht="skip" aria-label="تخطي الجولة">تخطي <i class="fas fa-xmark"></i></button></div>
                <div class="ht-bar"><i></i></div>
                <h4 class="ht-title"></h4><p class="ht-text"></p>
                <div class="ht-actions"><button type="button" class="ht-prev" data-ht="prev"><i class="fas fa-arrow-right"></i> السابق</button>
                    <button type="button" class="ht-next" data-ht="next">التالي <i class="fas fa-arrow-left"></i></button></div>
            </div>`;
        document.body.appendChild(root);
        run = { guide, steps, i: 0, root };
        root.addEventListener('click', e => {
            const b = e.target.closest('[data-ht]');
            if (!b) return;
            const act = b.dataset.ht;
            if (act === 'skip') stop(false);
            else if (act === 'prev') go(run.i - 1);
            else if (act === 'next') (run.i >= run.steps.length - 1 ? finish() : go(run.i + 1));
        });
        requestAnimationFrame(() => root.classList.add('open'));
        // Sheets slide and pages settle after the tour opens: keep the spotlight on its element.
        run.timer = setInterval(replace, 300);
        go(0);
    }

    function go(i) {
        if (!run) return;
        run.i = Math.max(0, Math.min(i, run.steps.length - 1));
        const [, title, text] = run.steps[run.i];
        const el = stepEl();
        const n = run.steps.length, root = run.root;
        root.querySelector('.ht-count').textContent = `${run.i + 1} / ${n}`;
        root.querySelector('.ht-bar > i').style.width = `${((run.i + 1) / n) * 100}%`;
        const card = root.querySelector('.ht-card');
        card.classList.remove('ht-swap'); void card.offsetWidth; card.classList.add('ht-swap');
        root.querySelector('.ht-title').textContent = title;
        root.querySelector('.ht-text').textContent = text;
        root.querySelector('[data-ht="prev"]').disabled = run.i === 0;
        root.querySelector('[data-ht="next"]').innerHTML = run.i === n - 1 ? 'إنهاء <i class="fas fa-check"></i>' : 'التالي <i class="fas fa-arrow-left"></i>';
        try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
        setTimeout(place, 380);
        place();
    }

    /** The step's element, found again if the page redrew it since. */
    function stepEl() {
        const st = run.steps[run.i];
        if (!st[0].isConnected || !visible(st[0])) {
            try { const again = [...document.querySelectorAll(st[3])].find(visible); if (again) st[0] = again; } catch (e) {}
        }
        return st[0];
    }
    function place() {
        if (!run) return;
        const el = stepEl();
        const root = run.root, spot = root.querySelector('.ht-spot'), card = root.querySelector('.ht-card');
        const vw = window.innerWidth, vh = window.innerHeight;
        const r = el.getBoundingClientRect();
        const pad = 8;
        const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
        const w = Math.min(vw - 8, r.width + pad * 2), h = Math.min(vh - 8, r.height + pad * 2);
        Object.assign(spot.style, { transform: `translate(${left}px, ${top}px)`, width: w + 'px', height: h + 'px' });
        // The card: under the element when there is room, otherwise above; on phones it docks at the
        // bottom (or the top when the element is low on the screen), clear of the app's tab bar.
        const narrow = vw < 640;
        const shellBar = document.documentElement.classList.contains('in-shell') && narrow ? 88 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hub-sab')) || 0) * 0.5 : 0;
        const ch = card.offsetHeight || 190, cw = narrow ? vw - 24 : Math.min(380, vw - 24);
        card.style.width = cw + 'px';
        let ct, cl;
        if (narrow) {
            cl = 12;
            const lowEl = r.top + r.height / 2 > vh / 2;
            ct = lowEl ? 12 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hub-sat')) || 0) : vh - ch - 16 - shellBar;
        } else {
            const below = r.bottom + 14 + ch < vh - 12;
            ct = below ? r.bottom + 14 : Math.max(12, r.top - ch - 14);
            cl = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
        }
        Object.assign(card.style, { transform: `translate(${cl}px, ${ct}px)` });
    }
    let raf = 0;
    const replace = () => { if (!run || raf) return; raf = requestAnimationFrame(() => { raf = 0; place(); }); };
    window.addEventListener('resize', replace);
    window.addEventListener('scroll', replace, true);
    document.addEventListener('keydown', e => {
        if (!run) return;
        if (e.key === 'Escape') stop(false);
        else if (e.key === 'ArrowLeft') (run.i >= run.steps.length - 1 ? finish() : go(run.i + 1));
        else if (e.key === 'ArrowRight') go(run.i - 1);
    });
    // The back button / gesture inside the app closes the tour first.
    window.addEventListener('hub:back', e => { if (run) { e.preventDefault(); stop(false); } });

    function finish() {
        const id = run && run.guide.id;
        const done = read(DONE_KEY, {});
        if (id) { done[id] = Date.now(); write(DONE_KEY, done); }
        stop(true);
        toast('أحسنت! أنهيت جولة «' + (guideById(id) || {}).title + '» ✓');
    }
    function stop() {
        if (!run) return;
        const root = run.root;
        clearInterval(run.timer);
        run = null;
        root.classList.remove('open');
        root.classList.add('closing');
        setTimeout(() => root.remove(), 260);
    }
    function toast(msg) {
        if (window.HubAccounts && HubAccounts.toast) HubAccounts.toast(msg, 'success');
    }

    // ------------------------------------------------------------------
    // Starting a tour from the panel: here, or on its page (the page picks it up when it is on screen)
    // ------------------------------------------------------------------
    function launch(id) {
        const guide = guideById(id);
        if (!guide) return;
        const c = who();
        const url = guide.page ? guide.page(c) : null;
        const here = !url || new URL(url, location.href).pathname.split('/').pop() === pageFile();
        if (here) {
            if (guide.page && window.HubAccounts && HubAccounts.closeSheet) HubAccounts.closeSheet();
            setTimeout(() => start(id), guide.page ? 380 : 120);
            return;
        }
        write(PENDING_KEY, { id, page: new URL(url, location.href).pathname.split('/').pop(), at: Date.now() });
        if (window.HubAccounts && HubAccounts.closeSheet) HubAccounts.closeSheet();
        setTimeout(() => {
            if (window.HubView && HubView.inShell) HubView.go(url);
            else location.href = url;
        }, 200);
    }
    let checking = 0;
    function checkPending() {
        const p = read(PENDING_KEY, null);
        if (!p || run) return;
        if (Date.now() - p.at > 30000) { write(PENDING_KEY, null); return; }
        if (p.page !== pageFile()) return;
        if (window.HubView && HubView.inShell && !HubView.active) return;
        write(PENDING_KEY, null);
        setTimeout(() => start(p.id), 500);
    }
    function watchPending() {
        if (checking) return;
        const t0 = Date.now();
        checking = setInterval(() => {
            checkPending();
            const p = read(PENDING_KEY, null);
            if (!p || Date.now() - t0 > 30000) { clearInterval(checking); checking = 0; }
        }, 400);
    }
    window.addEventListener('storage', e => { if (e.key === PENDING_KEY && e.newValue) watchPending(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (read(PENDING_KEY, null)) watchPending(); });
    else if (read(PENDING_KEY, null)) watchPending();

    // ------------------------------------------------------------------
    // The "الدليل" tab of the account panel
    // ------------------------------------------------------------------
    function list() { const c = who(); return GUIDES.filter(g => { try { return g.who(c); } catch (e) { return false; } }); }

    function renderTab(body) {
        const guides = list();
        const done = read(DONE_KEY, {});
        const n = guides.filter(g => done[g.id]).length;
        const pct = guides.length ? Math.round(n / guides.length * 100) : 0;
        const card = g => `<button type="button" class="ht-item${done[g.id] ? ' done' : ''}" data-guide="${g.id}">
                <i class="fas ${g.icon} ht-item-ic"></i>
                <span class="ht-item-t"><b>${esc(g.title)}</b><small>${esc(g.sub)} · ${g.steps.length} خطوات</small></span>
                <span class="ht-item-go">${done[g.id] ? '<i class="fas fa-check"></i>' : '<i class="fas fa-chevron-left"></i>'}</span>
            </button>`;
        body.innerHTML = `<section class="ht-hero">
                <div class="ht-ring" style="--p:${pct}"><span>${n}<small>/${guides.length}</small></span></div>
                <div><b>الدليل التعليمي</b><small>جولات قصيرة تعلّمك أدوات البوابة حسب صلاحيتك، وتأخذك إلى كل صفحة وتشرح عناصرها. يمكنك تخطي أي جولة متى شئت.</small></div>
            </section>
            ${GROUPS.map(([gid, gtitle]) => {
                const items = guides.filter(g => g.group === gid);
                return items.length ? `<h3 class="ht-group">${gtitle}</h3><div class="ht-list">${items.map(card).join('')}</div>` : '';
            }).join('')}
            ${n ? '<button type="button" class="ht-reset" data-act="ht-reset"><i class="fas fa-rotate-left"></i> إعادة ضبط التقدّم</button>' : ''}`;
        body.querySelectorAll('[data-guide]').forEach(b => b.addEventListener('click', () => renderGuide(body, b.dataset.guide)));
        const reset = body.querySelector('[data-act="ht-reset"]');
        if (reset) reset.addEventListener('click', () => { write(DONE_KEY, null); renderTab(body); });
    }

    function renderGuide(body, id) {
        const g = guideById(id);
        if (!g) return;
        const c = who();
        const goesElsewhere = g.page && new URL(g.page(c), location.href).pathname.split('/').pop() !== pageFile();
        body.innerHTML = `<div class="ht-detail">
                <button type="button" class="ht-back" data-act="ht-back"><i class="fas fa-arrow-right"></i> كل الشروحات</button>
                <div class="ht-detail-head"><i class="fas ${g.icon}"></i><div><h3>${esc(g.title)}</h3><small>${esc(g.sub)}</small></div></div>
                <p class="ht-detail-text">${esc(g.learn.text)}</p>
                <h4 class="ht-how">كيف تفعل ذلك</h4>
                <ol class="ht-steps">${g.learn.steps.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol>
                <div class="ht-cta">
                    <button type="button" class="hacc-btn primary ht-start" data-act="ht-start"><i class="fas fa-play"></i> ${goesElsewhere ? 'خذني إلى الصفحة وابدأ الجولة' : 'ابدأ الجولة التفاعلية'}</button>
                    <small>${g.steps.length} خطوات قصيرة · يمكنك التخطي في أي لحظة</small>
                </div>
            </div>`;
        body.scrollTop = 0;
        body.querySelector('[data-act="ht-back"]').addEventListener('click', () => renderTab(body));
        body.querySelector('[data-act="ht-start"]').addEventListener('click', () => launch(id));
    }

    window.HubTour = { renderTab, launch, start, list, stop: () => stop(false) };
})(window, document);
