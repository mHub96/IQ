(() => {
  let deferredInstallPrompt = null;
  let refreshing = false;

  // Render elegant floating Arabic update banner
  function showAutoUpdateBanner() {
    if (document.getElementById('pwa-auto-update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-auto-update-banner';
    banner.innerHTML = `
      <div style="
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 24px;
        border-radius: 9999px;
        background: linear-gradient(135deg, #0f766e, #047857);
        color: #ffffff;
        font-family: 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        font-weight: 700;
        box-shadow: 0 12px 36px rgba(0,0,0,0.38);
        border: 1.5px solid rgba(255,255,255,0.3);
        direction: rtl;
        text-align: right;
        pointer-events: none;
        animation: pwaSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <i class="fas fa-arrows-rotate fa-spin" style="color: #fef08a; font-size: 15px;"></i>
        <span>يتوفر تحديث جديد للنظام! جاري التحديث التلقائي...</span>
      </div>
      <style>
        @keyframes pwaSlideDown {
          from { opacity: 0; transform: translate(-50%, -24px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      </style>
    `;
    if (document.body) {
      document.body.appendChild(banner);
    } else {
      window.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));
    }
  }

  // Automated update trigger
  function triggerAutoUpdate(worker) {
    if (window._pwaUpdating) return;
    window._pwaUpdating = true;

    showAutoUpdateBanner();

    if (worker) {
      worker.postMessage('SKIP_WAITING');
    }

    // Safety fallback: if controllerchange doesn't reload, reload after 1400ms
    setTimeout(() => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] Auto-refreshing to apply new updates');
        window.location.reload();
      }
    }, 1400);
  }

  // Service Worker Registration & Live Auto-Update Pipeline
  if ('serviceWorker' in navigator) {
    // Listen for controlling worker change and auto-refresh cleanly
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      showAutoUpdateBanner();
      console.log('[PWA] Controller changed -> auto-reloading to activate new version');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    });

    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log('[PWA] Service Worker registered with scope:', registration.scope);

        // Immediate check on load
        registration.update().catch(() => {});

        // 1. If an updated worker is already waiting in background, activate immediately
        if (registration.waiting && navigator.serviceWorker.controller) {
          console.log('[PWA] Waiting service worker detected -> triggering auto-update');
          triggerAutoUpdate(registration.waiting);
        }

        // 2. Listen for newly discovered updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New service worker installed -> triggering auto-update');
              triggerAutoUpdate(newWorker);
            }
          });
        });

        // 3. Fast check when returning to the app from background (mobile PWA resumption)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) {
            registration.update().catch(() => {});
          }
        });

        // 4. Fast check on window focus
        window.addEventListener('focus', () => {
          if (navigator.onLine) {
            registration.update().catch(() => {});
          }
        });

        // 5. Check when coming back online
        window.addEventListener('online', () => {
          registration.update().catch(() => {});
        });

        // 6. Periodic background check every 60 seconds
        setInterval(() => {
          if (navigator.onLine) {
            registration.update().catch(() => {});
          }
        }, 60 * 1000);
      })
      .catch(error => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  }

  // Programmatic forceAppUpdate utility (kept on window for debugging / fallback)
  window.forceAppUpdate = async function() {
    try {
      showAutoUpdateBanner();
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      try {
        localStorage.removeItem('hub_db_cache');
      } catch (e) {}

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.set('_v', Date.now());
      window.location.href = cleanUrl.href;
    } catch (err) {
      console.error('[PWA] Force update failed:', err);
      window.location.reload();
    }
  };

  // ----- Install Button for Non-Installed Browsers -----
  function addInstallButton() {
    if (document.getElementById('pwa-install-button')) return;
    const button = document.createElement('button');
    button.id = 'pwa-install-button';
    button.type = 'button';
    button.innerHTML = '<i class="fas fa-download"></i><span>تثبيت التطبيق</span>';
    button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9998;display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid rgba(16,185,129,.35);border-radius:999px;background:#0f766e;color:#fff;font:700 12px "IBM Plex Sans Arabic",sans-serif;box-shadow:0 12px 28px rgba(0,0,0,.24);cursor:pointer;';
    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      button.remove();
    });
    document.body.appendChild(button);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    addInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('pwa-install-button')?.remove();
  });

  // On page load, trigger an immediate update check
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update().catch(() => {});
      });
    }
  });
})();
