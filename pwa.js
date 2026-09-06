(() => {
  let deferredInstallPrompt = null;

  // Register the service worker WITHOUT a changing parameter
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log('Service Worker registered successfully');

        // Check for updates on load (but only if there's actually a new version)
        // This will not show the prompt unless the CACHE_VERSION changed.
        registration.update();

        // Listen for a new service worker installing
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            // Only show the prompt if:
            // 1. The new worker is installed (state === 'installed')
            // 2. There was a previous controller (meaning this is an update, not a first install)
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdatePrompt();
            }
          });
        });
      })
      .catch(error => {
        console.warn('PWA service worker registration failed:', error);
      });
  }

  // Show a friendly prompt to reload
  function showUpdatePrompt() {
    // Use a flag to avoid showing the toast more than once per session
    if (window._updatePromptShown) return;
    window._updatePromptShown = true;

    if (typeof showToast === 'function') {
      showToast('🔄 New version available. Reload to update.', 'info', 6000);
    } else {
      if (confirm('A new version of this app is available. Refresh now?')) {
        window.location.reload();
      }
    }
  }

  // ----- Install Button (unchanged) -----
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
      showToast('✅ App installed successfully!', 'success');
    }
  });

  // On page load, check for updates (without forcing a re-install)
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update(); // Safe – only checks if there's a new version on the server
      });
    }
  });
})();
