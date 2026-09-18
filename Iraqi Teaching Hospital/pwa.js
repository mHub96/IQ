(() => {
  let deferredInstallPrompt = null;
  let refreshing = false;

  // Show a sleek floating notification banner when an update is being applied
  function showAutoUpdateBanner() {
    if (document.getElementById('pwa-update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: linear-gradient(135deg, #0f766e, #0d9488);
      color: #ffffff;
      padding: 10px 22px;
      border-radius: 999px;
      font-family: 'IBM Plex Sans Arabic', sans-serif;
      font-size: 0.85rem;
      font-weight: 800;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1.5px solid rgba(255, 255, 255, 0.4);
      direction: rtl;
      pointer-events: none;
      transition: all 0.3s ease;
    `;
    banner.innerHTML = '<i class="fas fa-arrows-rotate fa-spin"></i> <span>تم اكتشاف تحديث جديد للمنظومة! جاري التحديث التلقائي...</span>';
    document.body.appendChild(banner);
  }

  // Listen for controlling worker change and auto-refresh smoothly once
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[PWA] New version activated -> Auto-refreshing');
      showAutoUpdateBanner();
      setTimeout(() => {
        window.location.reload();
      }, 600);
    });

    // Register service worker
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log('[PWA] Service Worker registered:', registration.scope);

        // Immediate check on initial load
        registration.update().catch(() => {});

        // Listen for new updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New update installed -> Triggering SKIP_WAITING');
              newWorker.postMessage('SKIP_WAITING');
            }
          });
        });

        // Check for updates when user switches back to the app / window focus
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) {
            registration.update().catch(() => {});
          }
        });

        window.addEventListener('focus', () => {
          if (navigator.onLine) {
            registration.update().catch(() => {});
          }
        });

        window.addEventListener('online', () => {
          registration.update().catch(() => {});
        });

        // Periodic background update check every 5 minutes
        setInterval(() => {
          if (navigator.onLine) {
            registration.update().catch(() => {});
          }
        }, 5 * 60 * 1000);
      })
      .catch(error => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  }

  // PWA Install Prompt
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
})();
