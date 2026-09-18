(() => {
  let deferredInstallPrompt = null;
  let refreshing = false;

  // Listen for controlling worker change and auto-refresh cleanly once
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[PWA] Controller changed -> reloading to activate new version');
      window.location.reload();
    });

    // Register service worker
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log('[PWA] Service Worker registered with scope:', registration.scope);

        // Immediate check on load
        registration.update();

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdatePrompt(newWorker);
            }
          });
        });

        // Check for updates when user returns to the app from background (mobile PWA resumption)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) {
            registration.update().catch(err => console.warn('[PWA] Background update check failed:', err));
          }
        });

        // Periodic background update check every 15 minutes
        setInterval(() => {
          if (navigator.onLine) {
            registration.update().catch(err => console.warn('[PWA] Periodic update check failed:', err));
          }
        }, 15 * 60 * 1000);
      })
      .catch(error => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  }

  // Show a friendly prompt or auto-activate
  function showUpdatePrompt(newWorker) {
    if (window._updatePromptShown) return;
    window._updatePromptShown = true;

    // Post skip waiting to new worker immediately so it activates
    if (newWorker) {
      newWorker.postMessage('SKIP_WAITING');
    }

    if (typeof showToast === 'function') {
      showToast('🔄 تم تنزيل إصدار جديد من التطبيق! جاري التحديث...', 'info', 4000);
    }
  }

  // Manual Force App Update utility (exposed globally)
  window.forceAppUpdate = async function() {
    try {
      if (typeof showToast === 'function') {
        showToast('⏳ جاري مسح التخزين المؤقت وتحديث التطبيق...', 'info', 3000);
      }
      // 1. Delete all cache stores
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // 2. Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      // 3. Clear session caches if any
      try {
        localStorage.removeItem('hub_db_cache');
      } catch (e) {}

      // 4. Force hard reload with timestamp query to bust browser HTTP cache
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.set('_v', Date.now());
      window.location.href = cleanUrl.href;
    } catch (err) {
      console.error('[PWA] Force update failed:', err);
      window.location.reload(true);
    }
  };

  // ----- Install Button -----
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
    if (typeof showToast === 'function') {
      showToast('✅ تم تثبيت التطبيق بنجاح!', 'success');
    }
  });

  // On page load, trigger an update check
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update();
      });
    }
  });
})();
