/**
 * The ER page's save button (header and residents panel).
 *
 * The page keeps its data on the device and the background sync uploads it a moment after each
 * change; the button uploads everything now, checks that the server has it, and says so. It shows
 * whether something is still unsaved, and a restored backup is saved through it at once (a restore
 * that never reached the server looked done on this device only).
 */
(function (window, document) {
    'use strict';

    const Hub = () => window.Hub;
    const notify = (msg, type) => { try { window.EmergencyCore.showNotification(msg, type); } catch (e) {} };
    const LABELS = {
        saved: '<i class="fas fa-cloud"></i><span>محفوظ</span>',
        dirty: '<i class="fas fa-cloud-arrow-up"></i><span>حفظ</span>',
        saving: '<i class="fas fa-spinner fa-spin"></i><span>جاري الحفظ…</span>',
        done: '<i class="fas fa-circle-check"></i><span>تم الحفظ</span>',
        error: '<i class="fas fa-triangle-exclamation"></i><span>تعذر الحفظ</span>',
    };
    let busy = false, doneTimer = null;

    function paint(state) {
        document.querySelectorAll('[data-er-save]').forEach(b => {
            b.dataset.state = state;
            b.innerHTML = LABELS[state];
            b.disabled = state === 'saving';
            b.title = { saved: 'كل التعديلات محفوظة على الخادم', dirty: 'توجد تعديلات لم تُرفع بعد: اضغط للحفظ الآن', saving: 'جاري رفع التعديلات', done: 'تم الحفظ على الخادم', error: 'تعذر الحفظ: اضغط للمحاولة مجدداً' }[state];
        });
    }
    function idle() {
        if (busy) return;
        const n = Hub() && Hub().er && Hub().er.pending ? Hub().er.pending() : 0;
        paint(n ? 'dirty' : 'saved');
    }

    async function save({ reason } = {}) {
        if (busy || !Hub() || !Hub().er || !Hub().er.save) return null;
        busy = true;
        clearTimeout(doneTimer);
        paint('saving');
        let r;
        try { r = await Hub().er.save(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
        busy = false;
        if (r && r.ok) {
            paint('done');
            notify(reason === 'restore' ? 'تمت استعادة النسخة وحفظها على الخادم ✓ ستظهر على كل الأجهزة' : 'تم حفظ كل تعديلات الطوارئ على الخادم ✓', 'success');
            doneTimer = setTimeout(idle, 2200);
        } else {
            paint('error');
            const why = r && r.tooLarge && r.tooLarge.length ? 'حجم البيانات أكبر من الحد المسموح للرفع.'
                : r && r.offline ? 'لا يوجد اتصال بالخادم.'
                : r && r.error === 'not_allowed' ? 'الحفظ على الخادم للمالك ومدراء المستشفيات.'
                : 'لم تُرفع كل التعديلات بعد.';
            notify(`تعذر الحفظ على الخادم: ${why} التعديلات باقية على هذا الجهاز، اضغط «حفظ» للمحاولة مجدداً.`, 'error');
        }
        return r;
    }

    function start() {
        document.addEventListener('click', e => {
            const b = e.target.closest && e.target.closest('[data-er-save]');
            if (b) { e.preventDefault(); save(); }
        });
        window.addEventListener('hub:er-sync', () => { if (!busy) setTimeout(idle, 50); });
        idle();
        setInterval(idle, 5000);
    }

    window.EmergencySave = { save, refresh: idle };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(window, document);
