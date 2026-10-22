// Nothing of the site is shown without signing in (for everyone, the owner included). Loaded on every
// page right after storage-scope.js, before anything is drawn: a visitor who is not signed in sees
// only the sign-in screen (index.html), the account page's sign-in / sign-up / password-reset views,
// and the app shell that shows the sign-in screen. Any other page is hidden at once and replaced by
// the sign-in screen. Same session rules as Hub.auth.checkSession (hub-core.js); the server refuses
// the data to anyone not signed in as well.
(function () {
    'use strict';
    var ROLES = ['user', 'anaesthesia', 'admin', 'owner', 'rotator', 'aa_user', 'aa_admin'];
    function signedIn() {
        try {
            var role = localStorage.getItem('hospital_hub_session_role');
            var ts = Number(localStorage.getItem('hospital_hub_session_timestamp'));
            if (!role || !ts || ROLES.indexOf(role) < 0) return false;
            var remembered = localStorage.getItem('hospital_hub_session_remember') === 'true';
            var days = localStorage.getItem('hospital_hub_account') ? 30 : 7;
            if (Date.now() - ts > (remembered ? days * 864e5 : 864e5)) return false;
            var token = JSON.parse(localStorage.getItem('hospital_hub_api_token') || 'null');
            if (token && token.exp && token.exp < Date.now()) return false;
            return true;
        } catch (e) {
            return false;
        }
    }
    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var open = page === 'index.html' || page === 'app.html' || page === 'account.html';
    window.HubGuard = { signedIn: signedIn };
    if (signedIn()) return;
    document.documentElement.classList.add('hub-signed-out');
    if (open) return;
    // Hide everything before the first paint, then show the sign-in screen instead.
    var style = document.createElement('style');
    style.textContent = 'html{visibility:hidden!important;background:#0b0e12!important}';
    document.documentElement.appendChild(style);
    location.replace('./index.html?portal=true');
})();
