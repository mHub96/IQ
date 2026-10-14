// Storage namespace for the beta when it is served next to the live site on the same origin
// (mhub96.github.io/IQ-beta/ beside mhub96.github.io/IQ/). Both sites use the same localStorage
// and sessionStorage keys (sign-in token, data cache, ER mirror); without this a beta sign-in
// would replace the live one in the same browser. Loaded first on every page; elsewhere it does nothing.
(function () {
    var m = /^\/(IQ-beta)\//i.exec(location.pathname);
    if (!m) return;
    var P = m[1] + ':';
    var S = Storage.prototype;
    var get = S.getItem, set = S.setItem, rem = S.removeItem, keyAt = S.key;
    var len = Object.getOwnPropertyDescriptor(S, 'length').get;
    function own(st) {
        var out = [], n = len.call(st);
        for (var i = 0; i < n; i++) { var k = keyAt.call(st, i); if (k && k.indexOf(P) === 0) out.push(k); }
        return out;
    }
    S.getItem = function (k) { return get.call(this, P + k); };
    S.setItem = function (k, v) { return set.call(this, P + k, v); };
    S.removeItem = function (k) { return rem.call(this, P + k); };
    S.key = function (i) { var k = own(this)[i]; return k === undefined ? null : k.slice(P.length); };
    S.clear = function () { var st = this; own(st).forEach(function (k) { rem.call(st, k); }); };
    Object.defineProperty(S, 'length', { configurable: true, enumerable: true, get: function () { return own(this).length; } });
})();
