// pwa.js - Progressive Web App Support & State Persistence for Hospital Main Hub
(() => {
  'use strict';

  const STORAGE_KEY_LAST_PAGE = 'hosp_hub_last_page';
  let deferredInstallPrompt = null;

  // ---------------------------------------------------------------------------
  // 1. SAVE LAST VISITED PAGE (So PWA launches directly where user left off)
  // ---------------------------------------------------------------------------
  function getCurrentRelativeUrl() {
    try {
      const pathParts = window.location.pathname.split('/');
      const fileName = pathParts.pop() || 'index.html';
      return './' + fileName + window.location.search + window.location.hash;
    } catch (e) {
      return './index.html';
    }
  }

  function saveCurrentPageAsLastPwaPage() {
    try {
      const relUrl = getCurrentRelativeUrl();
      localStorage.setItem(STORAGE_KEY_LAST_PAGE, relUrl);
    } catch (e) {}
  }

  // Save immediately on script execution
  saveCurrentPageAsLastPwaPage();

  // Save on page lifecycle events
  window.addEventListener('pageshow', saveCurrentPageAsLastPwaPage);
  window.addEventListener('popstate', saveCurrentPageAsLastPwaPage);
  window.addEventListener('hashchange', saveCurrentPageAsLastPwaPage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveCurrentPageAsLastPwaPage();
    }
  });

  // Track user clicks on internal links to immediately update the target page
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    // Check if internal navigation link
    if (href.includes('.html') || (!href.includes('://') && !href.startsWith('//'))) {
      try {
        let target = href;
        if (!target.startsWith('./') && !target.startsWith('/')) {
          target = './' + target;
        }
        localStorage.setItem(STORAGE_KEY_LAST_PAGE, target);
      } catch (err) {}
    }
  }, { capture: true });

  // ---------------------------------------------------------------------------
  // 2. SERVICE WORKER REGISTRATION & UPDATES
  // ---------------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        // Check for updates on load (if CACHE_VERSION changed)
        registration.update();

        // Listen for new worker installing
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
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

  // Show friendly prompt to reload when updated
  function showUpdatePrompt() {
    if (window._updatePromptShown) return;
    window._updatePromptShown = true;

    if (typeof showToast === 'function') {
      showToast('🔄 تم تحديث التطبيق. انقر لإعادة التحميل.', 'info', 6000);
    } else {
      if (confirm('يتوفر تحديث جديد للتطبيق. هل ترغب في إعادة التحميل الآن؟')) {
        window.location.reload();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. PWA INSTALL BUTTON (Home Screen Prompt)
  // ---------------------------------------------------------------------------
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

  // On page load, check for service worker updates
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update();
      });
    }
  });

  // Export helper for debugging or manual calls
  window.saveCurrentPageAsLastPwaPage = saveCurrentPageAsLastPwaPage;
})();
