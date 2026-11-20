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
            chief: !isOwner && !!(Hub.auth.rotatorChiefHospitals && Hub.auth.rotatorChiefHospitals().length),
            hasAcc: !!acc,
        };
    }
    const q = (page, c) => './' + page + (c.hosp ? '?hospital=' + encodeURIComponent(c.hosp) : '');
    const qx = (page, c, extra) => q(page, c) + (c.hosp ? '&' : '?') + extra;
    /** Runs `fn` as soon as it returns true (it looks for what to open), for up to 6 seconds. */
    const soon = fn => { const t0 = Date.now(); (function again() { let ok = false; try { ok = fn(); } catch (e) {} if (!ok && Date.now() - t0 < 6000) setTimeout(again, 300); })(); };

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
                ['.hosp-widget-card', 'بطاقة المستشفى', 'الاسم والموقع، ثم أرقام اليوم: الخفراء الآن، الأقدمون، التخصصات، الطوارئ والعناية.'],
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
                steps: ['اضغط «Call» للاتصال مباشرة أو «WhatsApp» للمراسلة.', 'اضغط شارة التخصص لترى الوقت المتبقي من الخفارة.', 'القلب للإعجاب، والفقاعة للتعليق على البطاقة.', 'زر «المتصدرين» يعرض أكثر الأقدمين نشاطاً.'],
            },
            steps: [
                ['#main-content > .hospital-header', 'المستشفى', 'اسم المستشفى والوقت الحالي.'],
                ['.top-action-btn.leader', 'المتصدرون', 'لوحة أكثر الأقدمين تفاعلاً اليوم والشهر.'],
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
                steps: ['انتقل بين الأشهر بالسهمين، و«اليوم» يعيدك للشهر الحالي.', 'اختر الأقدمين، أو الدوريين (جداول المقيمين الدوريين وفروعها)، أو الاختصاصيين.', 'اختر العرض: اليوم، تخصص، أو الشامل.', 'استخدم البحث لعرض خفارات طبيب معيّن، وزر الطباعة لطباعة الجدول.'],
            },
            steps: [
                ['.sch-month', 'الشهر', 'السهمان للتنقل بين الأشهر.'],
                ['#btn-jump-today', 'اليوم', 'يعيدك فوراً إلى الشهر واليوم الحاليين.'],
                ['#schedule-role-selector', 'الأقدمون / الدوريون / الاختصاصيون', 'بدّل بين جدول الأقدمين، وجداول المقيمين الدوريين، وجدول أطباء الاختصاص. كلها للعرض فقط.'],
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
                steps: ['اختر المستشفى.', 'اختر التخصص الطبي.', 'اختر يوم الخفارة (اليوم افتراضياً).', 'تظهر «تذكرة التبديل»: في أعلاها الخفر المسجل حالياً.', 'اكتب اسم الطبيب البديل واختره من القائمة.', 'اضغط «تأكيد التبديل» (أو «إرسال طلب التبديل» عند تفعيل الموافقة).', 'لخفارة طوارئ: اختر «🚑 الطوارئ» (أو «طوارئ المقيمين الدوريين») من قائمة التخصص؛ تُختار تلقائياً الخفارة التالية للخفارة الجارية، ويمكنك تغيير اليوم والوجبة.'],
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
                text: 'دليل المقيمين يضم كل الأطباء الأقدمين والدوريين بأرقامهم وتخصصاتهم ومستشفياتهم.',
                steps: ['اختر المستشفى من الأزرار في الأعلى.', 'اختر «الأقدمون» أو «الدوريون» من المفتاح.', 'ابحث بالاسم أو الرقم أو التخصص.', 'صفِّ حسب التخصص أو الحالة.', 'اضغط الرقم للاتصال أو أيقونة واتساب للمراسلة.'],
            },
            steps: [
                ['main > .glass-card:first-child', 'الدليل', 'عدد الأطباء المسجلين والظاهرين في البحث.'],
                ['#hospital-filter-pills', 'المستشفى', 'اختر مستشفى أو جميع المستشفيات.'],
                ['#res-kind', 'الأقدمون / الدوريون', 'بدّل بين أطباء الاختصاص الأقدمين والمقيمين الدوريين. مع الدوريين يختفي فلتر التخصص وتبقى الحالة.'],
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
            id: 'admin-page', group: 'admin', icon: 'fa-hospital-user', title: 'إدارة المستشفى والأقدمين',
            sub: 'الأدوات، الأقدمون، والتخصصات', who: c => c.isAdmin || c.branch,
            page: c => q('admin.html', c),
            learn: {
                text: 'صفحة الإدارة لإدارة مقيمي المستشفى وتخصصاته وإعداداته ونسخه الاحتياطية.',
                steps: ['أضف مقيماً جديداً أو من جهات الاتصال.', 'ابحث في الأقدمين وافتح التخصص لترى من فيه.', 'من الأدوات: إعدادات المستشفى، التخصصات، رئيس الأطباء، والنسخ الاحتياطي.', 'لا تنسَ «حفظ في السيرفر» بعد التعديل.'],
            },
            steps: [
                ['#app-body main > .glass-card:first-child .branch-hide', 'أدوات المستشفى', 'الإعدادات والتخصصات ورئيس الأطباء والإحصائية والنسخ الاحتياطي.'],
                ['#main-save-btn', 'الحفظ', 'يحفظ تعديلاتك في السيرفر.'],
                ['[onclick^="openAddResident"]', 'إضافة مقيم', 'أضف مقيماً جديداً يدوياً أو من جهات الاتصال.'],
                ['#admin-resident-search', 'البحث', 'ابحث بالاسم أو الرقم أو التخصص.'],
                ['#residents-accordion-list', 'الأقدمون حسب التخصص', 'افتح التخصص لترى مقيميه وتعدّلهم.'],
            ],
        },
        {
            id: 'scheduler', group: 'admin', icon: 'fa-calendar-plus', title: 'المجدول: تعبئة الجدول',
            sub: 'كتابة الخفارات وحفظها', who: c => c.isAdmin || c.branch,
            page: c => q('scheduler.html', c),
            learn: {
                text: 'المجدول هو مكان كتابة جدول الخفارات الشهري لكل تخصص.',
                steps: ['اختر الشهر.', 'اختر الأقدمين أو الاختصاصيين، وتخصصاً أو الكل.', 'اكتب اسم الطبيب في يومه (تظهر الأسماء المقترحة).', 'اضغط «حفظ الجدول».'],
            },
            steps: [
                ['#scheduler-mode-selector', 'الأقدمون / الاختصاصيون', 'اختر الجدول الذي تعمل عليه.'],
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
                ['.ers-side, .ers-tabs', 'الجداول', 'الطوارئ والاستشارية والوفيات والإسناد وقاعدة الأقدمين.'],
                ['.ers-top-actions', 'الحفظ والطباعة', 'الحفظ وخيارات الطباعة وتنزيل PDF.'],
                ['#schedule-view-container', 'الجدول', 'خلايا الجدول للأيام والمناوبات.'],
            ],
        },

        // ---- Added with the rotators, the ER duties view, the themes and the new tools ----
        {
            id: 'er-duties', group: 'basics', icon: 'fa-truck-medical', title: 'خفراء الطوارئ (ER)',
            sub: 'الوجبة الجارية، الشُعب، والاتصال', who: c => !c.officer,
            page: c => qx('Home.html', c, 'view=er'),
            learn: {
                text: 'صفحة «خفراء الطوارئ» تعرض أطباء الطوارئ اليوم: الوجبة الجارية أولاً، وأطباء الأقدمين والدوريين معاً، كلٌّ في شعبته.',
                steps: ['الوجبة الجارية (LIVE) مفتوحة في الأعلى دائماً.', 'إن كانت للطوارئ أقسام (رجال، نساء، أطفال) وشُعب (خضراء، صفراء...)، يظهر أطباء كل شعبة في إطار بلونها مع شارة القسم.', 'شارة البطاقة: اختصاص الطبيب الأصلي، أو «مقيم دوري».', 'الوجبات السابقة والقادمة مطوية في «الخفارات السابقة» و«الخفارات القادمة».', 'اتصل أو راسل أو أعجب وعلّق كما في بطاقات الخفراء.'],
            },
            steps: [
                ['.er-shift.live > summary', 'الوجبة الجارية', 'الوجبة الآن (LIVE): مفتوحة دائماً في أعلى الصفحة.'],
                ['.er-div', 'شعبة الطوارئ', 'أطباء القسم والشعبة في إطار بلون الشعبة، وشارة القسم (رجال، نساء، أطفال) على الإطار.'],
                ['.er-shift.live .roster-card', 'بطاقة الخفر', 'الشارة اختصاص الطبيب الأصلي أو «مقيم دوري». اتصال وواتساب وإعجاب وتعليق.'],
                ['.er-cat[data-k="prev"] > summary', 'الخفارات السابقة', 'وجبات اليوم التي انتهت، مطوية هنا.'],
                ['.er-cat[data-k="next"] > summary', 'الخفارات القادمة', 'وجبات اليوم القادمة، مطوية هنا.'],
            ],
        },
        {
            id: 'themes', group: 'basics', icon: 'fa-wand-magic-sparkles', title: 'ثيمات المناسبات والمؤثرات',
            sub: 'اختيار ثيم، الطقس الحي، وتقليل المؤثرات', who: c => c.hasAcc, page: null,
            before: () => window.HubAccounts && HubAccounts.openPanel('settings'),
            learn: {
                text: 'في المناسبات تُضاف للموقع ثيمات بألوان وزخارف ومؤثرات متحركة (ثلج، مطر، برق، ألعاب نارية، فوانيس...). يصلك إشعار عند إضافة ثيم جديد.',
                steps: ['افتح الإعدادات › المظهر › «ثيمات المناسبات».', 'افتح القائمة وابحث عن الثيم بالاسم، ثم اضغطه لتطبيقه؛ «المظهر الأساسي» يعيد ألوان الموقع.', '«الطقس الحي» يتغير مع الطقس الحقيقي في موقعك (يطلب إذن الموقع مرة واحدة، وبدونه يتبع طقس البصرة).', 'عند ثيم «مفعّل للجميع» يتبع الوضع الفاتح والداكن الثيمَ حتى انتهائه.', 'مفتاح «تقليل المؤثرات المتحركة» يوقف الحركة وتبقى الألوان.'],
            },
            steps: [
                ['.hth-fold > summary', 'ثيمات المناسبات', 'اضغط لفتح القائمة؛ فيها البحث والثيمات المتاحة لك.'],
                ['[data-role="theme"]', 'الوضع', 'الفاتح والداكن. عند ثيم مفعّل للجميع يتبع الثيم ويُقفل المفتاح.'],
                ['[data-act="fx-off"]', 'تقليل المؤثرات', 'يوقف الثلج والمطر والألعاب النارية وغيرها على جهازك، وتبقى ألوان الثيم.'],
            ],
        },
        {
            id: 'rot-mine', group: 'role', icon: 'fa-rotate', title: 'خفاراتك كمقيم دوري',
            sub: 'جدولي، طوارئ الدوريين، والرغبات', who: c => c.rotator && c.hasAcc, page: null,
            before: () => window.HubAccounts && HubAccounts.openPanel('schedule'),
            learn: {
                text: 'كمقيم دوري ترى في «جدولي» خفارات ردهتك وخفاراتك في «طوارئ المقيمين الدوريين»، وتصلك بوابة الرغبات عندما يفتحها رئيس المقيمين الدوريين (إن كان اسمك في قائمة طوارئ الشهر).',
                steps: ['افتح «جدولي» من لوحة حسابك.', 'خفارات الطوارئ تظهر مع «· الدوريون».', 'عند فتح بوابة الرغبات يصلك إشعار، فاختر أيامك ووجباتك قبل الإغلاق.', 'تبديل خفارة طوارئ: من صفحة التبديل اختر «🚑 طوارئ المقيمين الدوريين».'],
            },
            steps: [
                ['.hacc-tabs [data-tab="schedule"]', 'جدولي', 'خفاراتك في الردهة وفي طوارئ الدوريين، وبوابة الرغبات عند فتحها.'],
            ],
        },
        {
            id: 'rot-chief', group: 'role', icon: 'fa-user-shield', title: 'رئيس المقيمين الدوريين',
            sub: 'جدول الدوريين، قاعدتهم، وطوارئهم', who: c => c.chief,
            page: c => './index.html?portal=true',
            before: () => soon(() => { const b = document.querySelector('.hosp-expand-arrow-btn'); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; }),
            learn: {
                text: 'كرئيس للمقيمين الدوريين تدير دوريي مستشفاك من بطاقة المستشفى في الصفحة الرئيسية (سهم «المزيد من الخيارات»).',
                steps: ['«جدول الدوريين»: تعبئة جداول المقيمين الدوريين وفروعها.', '«الدوريون»: قاعدة المقيمين الدوريين (إضافة وتعديل وتعيين الروتيشن).', '«طوارئ الدوريين»: يظهر فقط إذا سمح لك المالك بذلك.', 'جداول الدوريين يراها الجميع في «جدول الخفارات › الدوريين».'],
            },
            steps: [
                ['.hosp-expand-arrow-btn', 'خيارات المستشفى', 'هذا السهم يفتح أزرار إدارة الدوريين.'],
                ['.hosp-expanded-options a[href*="type=rotators"]', 'جدول الدوريين', 'تعبئة جداول المقيمين الدوريين وفروعها.'],
                ['.hosp-expanded-options a[href*="admin.html"]', 'الدوريون', 'قاعدة المقيمين الدوريين في مستشفاك.'],
                ['.hosp-expanded-options a[href*="sys=rot"]', 'طوارئ الدوريين', 'جدول طوارئ الدوريين وتوزيعه وبوابة رغباتهم (بإذن المالك).'],
            ],
        },
        {
            id: 'er-structure', group: 'admin', icon: 'fa-sitemap', title: 'هيكلية الطوارئ لكل شهر',
            sub: 'الأقسام والشُعب، وإضافة مقيم لوجبة', who: c => c.er,
            page: c => q('emergency.html', c),
            learn: {
                text: 'لكل شهر هيكليته: تعديل هيكلية شهر لا يغيّر الأشهر الأخرى، والشهر الجديد يبدأ من آخر هيكلية محفوظة.',
                steps: ['افتح «هيكلية الخفارات» وأنت على الشهر المطلوب.', 'أضف أقسام الطوارئ (رجال، نساء، أطفال) وشُعب كل وجبة وعدد مقيميها.', 'وجبة بلا أقسام: «إضافة مقيم» يزيد عدد مقيميها دون عنوان.', 'احفظ: تُطبّق على هذا الشهر فقط.', 'طوارئ الدوريين: الطوارئ فقط (بلا استشارية ولا وفيات ولا إسناد)، ومفتاح «الأقدمون / الدوريون» للتنقل بينهما.'],
            },
            steps: [
                ['[onclick="openErStructureModal()"]', 'هيكلية الخفارات', 'هيكلية الشهر المعروض: الأقسام والشُعب وعدد المقيمين لكل وجبة.'],
                ['.ers-system', 'الأقدمون / الدوريون', 'بدّل بين طوارئ الأقدمين وطوارئ المقيمين الدوريين.'],
                ['#schedule-view-container', 'الجدول', 'أعمدة الجدول تتبع هيكلية الشهر المعروض.'],
            ],
        },
        {
            id: 'branches', group: 'admin', icon: 'fa-diagram-project', title: 'الفروع: مجموعاتها ومصدر أطبائها',
            sub: 'فروع التخصص، وسحب المتناوبين فقط', who: c => c.isAdmin,
            page: c => q('admin.html', c),
            before: () => soon(() => { const sub = document.querySelector('.spec-subs'); if (!sub) return false; const box = sub.closest('.spec-content'); if (box && !box.classList.contains('active') && window.toggleAccordion) toggleAccordion(box.id); return true; }),
            learn: {
                text: 'فروع التخصص (مثل فروع المقيم الدوري أو التخدير) تظهر مجموعاتٍ قابلة للطي داخل تخصصها الرئيسي، والأطباء غير المنسوبين لفرع في «بلا فرع» آخرها.',
                steps: ['افتح التخصص الرئيسي؛ تظهر فروعه أولاً، كلٌّ قابل للطي.', 'لتحديد أطباء الفرع: «إدارة التخصصات» › «خيارات» بجانب الفرع › «أطباء هذا الفرع».', '«كل أطباء التخصص الرئيسي»: قائمة الفرع في المجدول = كل أطباء التخصص.', '«المتناوبون في هذا الفرع فقط»: فقط من اختير الفرع في سجله كـ«القسم المكلف به (Rotation)».'],
            },
            steps: [
                ['.spec-subs', 'الفروع', 'فروع التخصص، ثم «بلا فرع» إن وُجد أطباء بلا فرع.'],
                ['.spec-sub-head', 'فرع', 'اضغطه لعرض أطبائه أو طيّهم.'],
            ],
        },
        {
            id: 'permissions', group: 'admin', icon: 'fa-shield-halved', title: 'صلاحيات الحسابات',
            sub: 'دور كل حساب في كل مستشفى بزر حفظ واحد', who: c => c.isAdmin && c.hasAcc,
            page: c => './account.html#manage',
            before: () => soon(() => { const b = document.querySelector('[data-filter="active"]'); if (!b) return false; b.click(); return true; }),
            learn: {
                text: 'من «الإدارة» افتح أي حساب (⚙️) لتحديد صلاحياته في كل مستشفى.',
                steps: ['ابحث عن الحساب واضغط ⚙️ في بطاقته.', 'في «المستشفيات والصلاحيات»: بطاقة لكل مستشفى، اختر الدور بلمسة (مقيم، مقيم تخدير، مدير فرع، رئيس المقيمين الدوريين، مدير مستشفى، روتيتر).', '«مدير فرع» يطلب اختيار اختصاصه.', 'المالك: «حسب المستشفى» أو «مدير عام» أو «مالك» في الأعلى، و«إضافة مستشفى يداوم فيه».', 'زر واحد «حفظ الصلاحيات» يحفظ كل شيء.'],
            },
            steps: [
                ['#mg-search', 'البحث', 'ابحث عن الحساب بالاسم أو اسم المستخدم.'],
                ['.acc', 'بطاقة الحساب', 'افتح ⚙️ في البطاقة لتعديل صلاحياته.'],
            ],
        },
        {
            id: 'view-as', group: 'admin', icon: 'fa-eye', title: 'عرض الموقع كمستخدم آخر',
            sub: 'ترى ما يراه بالضبط، للقراءة فقط', who: c => c.isOwner,
            page: c => './account.html#manage',
            before: () => soon(() => { const b = document.querySelector('[data-filter="active"]'); if (!b) return false; b.click(); return true; }),
            learn: {
                text: 'للمالك فقط: تصفّح الموقع كما يراه أي حساب مفعّل (صفحاته وصلاحياته وجدوله وإشعاراته)، للقراءة فقط: لا يُغيَّر شيء باسمه.',
                steps: ['افتح ⚙️ في بطاقة الحساب.', 'اضغط «عرض الموقع كهذا المستخدم» ثم أكّد.', 'تصفّح الموقع كما يراه.', 'للعودة: افتح لوحة حسابه (الصورة في الأعلى) واضغط «إنهاء العرض». ينتهي تلقائياً بعد ساعتين.'],
            },
            steps: [
                ['#mg-search', 'البحث', 'ابحث عن الحساب.'],
                ['.acc', 'بطاقة الحساب', 'من ⚙️ في البطاقة: «عرض الموقع كهذا المستخدم».'],
            ],
        },
        {
            id: 'themes-owner', group: 'admin', icon: 'fa-swatchbook', title: 'إدارة ثيمات الموقع',
            sub: 'الرفع، الأوضاع، الفترات، والحفظ', who: c => c.isOwner, page: null,
            before: () => { if (window.HubAccounts) HubAccounts.openPanel('settings'); soon(() => { const b = document.querySelector('[data-act="manage"]'); const box = document.querySelector('[data-role="manage-host"]'); if (!b || !box) return false; if (box.hidden) b.click(); return true; }); },
            learn: {
                text: 'للمالك فقط: ثيمات الموقع ملفات .hubtheme (ألوان وزخارف ومؤثرات جاهزة، بلا أوامر برمجية) تُحفظ نسخها في مجلد «HOSP HUB - Themes».',
                steps: ['الإعدادات › المظهر › «إدارة الثيمات» (أو القطاع الإداري › المنظومة › ثيمات الموقع).', '«رفع ثيم» لإضافة ملف؛ يُضاف متوقفاً.', 'لكل ثيم: إيقاف، لي فقط (للمعاينة)، اختياري للجميع (يصل إشعار للجميع)، إجباري للجميع (يفرض ألوانه ووضعه الفاتح/الداكن).', '«من / إلى» لتحديد فترة يُفعّل فيها الثيم تلقائياً ثم يتوقف.', 'عدّل ما تشاء ثم «حفظ التغييرات» مرة واحدة. «معاينة عندي» لتجربته، و«تنزيل» لنسخة من ملفه.'],
            },
            steps: [
                ['[data-act="manage"]', 'إدارة الثيمات', 'يفتح مدير الثيمات هنا في الإعدادات.'],
                ['.hth-upload', 'رفع ثيم', 'أضف ملف ثيم (.hubtheme)؛ يبدأ متوقفاً.'],
                ['.hth-card .hth-modes', 'وضع الثيم', 'إيقاف، لي فقط، اختياري للجميع، أو إجباري للجميع.'],
                ['.hth-card .hth-period', 'الفترة', 'من / إلى: يُفعّل الثيم تلقائياً في الفترة ثم يتوقف.'],
                ['[data-role="savebar"]', 'حفظ التغييرات', 'زر واحد يحفظ كل الثيمات المعدّلة دون أن تتحرك الصفحة.'],
            ],
        },
        {
            id: 'chief-er-switch', group: 'admin', icon: 'fa-toggle-on', title: 'طوارئ الدوريين لرئيس المقيمين الدوريين',
            sub: 'مفتاح المالك في بطاقة كل مستشفى', who: c => c.isOwner,
            page: c => './index.html?portal=true',
            before: () => soon(() => { const b = document.querySelector('.hosp-expand-arrow-btn'); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; }),
            learn: {
                text: 'رئيس المقيمين الدوريين لا يصل لطوارئ الدوريين إلا بإذنك: مفتاح في قسم المالك من بطاقة كل مستشفى.',
                steps: ['افتح خيارات المستشفى (السهم في بطاقته).', 'في قسم المالك: «طوارئ الدوريين لرئيس المقيمين الدوريين».', 'شغّله ليظهر له زر «طوارئ الدوريين»، أو أطفئه لمنعه.', 'لا يغيّر هذا المفتاح إلا المالك.'],
            },
            steps: [
                ['.hosp-expand-arrow-btn', 'خيارات المستشفى', 'يفتح أزرار المستشفى وقسم المالك.'],
                ['div:has(> label > input[onchange^="toggleRotChiefEr"])', 'طوارئ الدوريين لرئيس المقيمين', 'مسموح / ممنوع لرئيس المقيمين الدوريين في هذا المستشفى.'],
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
