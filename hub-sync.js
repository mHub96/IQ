/**
 * HOSPITAL HUB — RECORD SYNC HELPERS
 * Shared by the browser (hub-core.js), the D1 import script and the GitHub bridge.
 *
 * The in-memory database keeps its original shape. For syncing it is split into
 * small records (coll + id) so that a save only uploads what actually changed:
 *   meta      one per top-level key        { value: ... }
 *   hospital  one per hospital             hospital without schedule / icu / passwords
 *   icu       one per hospital             hospital.icu
 *   sched     one per duty slot            id "<hospital>:<entry id>"
 *   resident  one per resident             db.residents[i]
 * Passwords are split out separately and never stored as records.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.HubSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SKIP_META = new Set(['hospitals', 'residents', 'globalPasswords', 'lastUpdated']);
    const RID = '__rid';

    // FNV-1a over two seeds -> 13 hex chars; stable across browsers and Node.
    function hash(str) {
        let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193);
            h2 = Math.imul(h2 ^ c, 0x5bd1e995);
        }
        return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 13);
    }

    function stableStringify(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
        return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    }

    function setRid(obj, rid) {
        Object.defineProperty(obj, RID, { value: rid, enumerable: false, configurable: true, writable: true });
    }

    /** Identity of a duty slot: everything except the contact counter. */
    function schedIdentity(entry) {
        const copy = Object.assign({}, entry);
        delete copy.VisitCount;
        return hash(stableStringify(copy));
    }

    function key(c, id) {
        return c + '|' + id;
    }

    /**
     * Split a database object into records and passwords.
     * Assigns hidden ids to new duty slots and fixes duplicate resident ids in place,
     * so calling it again on the same objects yields the same ids.
     */
    function decompose(db) {
        const records = new Map();
        const secrets = {};
        const put = (c, id, h, o, d) => records.set(key(c, id), { c, id, h, o, d, s: JSON.stringify(d) });
        if (!db || typeof db !== 'object') return { records, secrets };

        for (const k of Object.keys(db)) {
            if (SKIP_META.has(k) || db[k] === undefined) continue;
            put('meta', k, null, 0, { value: db[k] });
        }
        if (db.globalPasswords) secrets.global = Object.assign({}, db.globalPasswords);

        let hi = 0;
        for (const [hid, hosp] of Object.entries(db.hospitals || {})) {
            if (!hosp || typeof hosp !== 'object') continue;
            const { schedule, icu, passwords, ...rest } = hosp;
            put('hospital', hid, hid, hi++, rest);
            if (icu !== undefined && icu !== null) put('icu', hid, hid, 0, icu);
            if (passwords) secrets[hid] = Object.assign({}, passwords);

            const seen = new Set();
            (Array.isArray(schedule) ? schedule : []).forEach((entry, i) => {
                if (!entry || typeof entry !== 'object') return;
                let rid = entry[RID];
                if (!rid || seen.has(rid)) {
                    rid = schedIdentity(entry);
                    while (seen.has(rid)) rid = hash(rid + '+');
                    setRid(entry, rid);
                }
                seen.add(rid);
                put('sched', hid + ':' + rid, hid, i, entry);
            });
        }

        const seenRes = new Set();
        (Array.isArray(db.residents) ? db.residents : []).forEach((r, i) => {
            if (!r || typeof r !== 'object') return;
            let id = r.id ? String(r.id) : '';
            if (!id || seenRes.has(id)) {
                id = (id || 'res') + '-' + hash(stableStringify(r) + i).slice(0, 6);
                r.id = id;
            }
            seenRes.add(id);
            put('resident', id, null, i, r);
        });

        return { records, secrets };
    }

    /** Rebuild a database object from server rows [coll, id, hosp, ord, v, data]. */
    function compose(rows) {
        const db = { hospitals: {}, residents: [] };
        const by = { meta: [], hospital: [], icu: [], sched: [], resident: [] };
        for (const row of rows) {
            if (by[row[0]]) by[row[0]].push(row);
        }
        const byOrd = (a, b) => (a[3] - b[3]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
        for (const list of Object.values(by)) list.sort(byOrd);

        for (const [, id, , , , data] of by.meta) db[id] = data ? data.value : undefined;
        for (const [, id, , , , data] of by.hospital) {
            db.hospitals[id] = Object.assign({}, data, { schedule: [] });
        }
        for (const [, id, , , , data] of by.icu) {
            if (db.hospitals[id]) db.hospitals[id].icu = data;
        }
        for (const [, id, hosp, , , data] of by.sched) {
            const h = db.hospitals[hosp];
            if (!h || !data) continue;
            setRid(data, id.slice(hosp.length + 1));
            h.schedule.push(data);
        }
        for (const [, , , , , data] of by.resident) {
            if (data) db.residents.push(data);
        }
        return db;
    }

    /** Base map from server rows: key -> { c, id, h, o, v, s }. */
    function baseFromRows(rows) {
        const base = new Map();
        for (const [c, id, h, o, v, data] of rows) {
            if (c === 'er' || c === 'er_conflict') continue;
            base.set(key(c, id), { c, id, h, o, v, s: JSON.stringify(data) });
        }
        return base;
    }

    /** Operations that turn `base` into `current`. */
    function diff(base, current) {
        const ops = [];
        for (const [k, r] of current) {
            const b = base.get(k);
            if (!b) ops.push({ k, c: r.c, id: r.id, h: r.h, o: r.o, bv: 0, d: r.d, s: r.s });
            else if (b.s !== r.s) ops.push({ k, c: r.c, id: r.id, h: r.h, o: r.o, bv: b.v, d: r.d, s: r.s });
            else if (b.o !== r.o) ops.push({ k, c: r.c, id: r.id, o: r.o, ordOnly: 1 });
        }
        for (const [k, b] of base) {
            if (!current.has(k)) ops.push({ k, c: b.c, id: b.id, h: b.h, bv: b.v, del: 1 });
        }
        return ops;
    }

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

    function itemKey(e) {
        if (isObj(e)) return e.id !== undefined ? 'id:' + e.id : null;
        return 'v:' + JSON.stringify(e);
    }

    /**
     * Three-way merge: keeps both sides' changes; on a true clash the local side wins.
     * Arrays of objects with `id` (and arrays of plain values) are merged item by item.
     */
    function merge3(base, local, remote) {
        if (same(local, remote)) return local;
        if (same(base, local)) return remote;
        if (same(base, remote)) return local;

        if (isObj(local) && isObj(remote)) {
            const out = {};
            const keys = [...Object.keys(local), ...Object.keys(remote).filter(k => !has(local, k))];
            for (const k of keys) {
                const inL = has(local, k), inR = has(remote, k), inB = has(base, k);
                if (!inL) {
                    if (inB && same(base[k], remote[k])) continue; // deleted locally
                    out[k] = remote[k];
                } else if (!inR) {
                    if (inB && same(base[k], local[k])) continue; // deleted remotely
                    out[k] = local[k];
                } else {
                    out[k] = merge3(inB ? base[k] : undefined, local[k], remote[k]);
                }
            }
            return out;
        }

        if (Array.isArray(local) && Array.isArray(remote)) {
            const all = [...local, ...remote, ...(Array.isArray(base) ? base : [])];
            if (all.some(e => itemKey(e) === null)) return local;
            const toMap = arr => new Map((Array.isArray(arr) ? arr : []).map(e => [itemKey(e), e]));
            const B = toMap(base), L = toMap(local), R = toMap(remote);
            const order = [...R.keys(), ...[...L.keys()].filter(k => !R.has(k))];
            const out = [];
            for (const k of order) {
                const inL = L.has(k), inR = R.has(k), inB = B.has(k);
                if (!inL) {
                    if (inB && same(B.get(k), R.get(k))) continue;
                    out.push(R.get(k));
                } else if (!inR) {
                    if (inB && same(B.get(k), L.get(k))) continue;
                    out.push(L.get(k));
                } else {
                    out.push(merge3(B.get(k), L.get(k), R.get(k)));
                }
            }
            return out;
        }

        return local;
    }

    /** Make `target` equal to `src` (same keys, same key order) without replacing the object. */
    function replaceInPlace(target, src, keep) {
        const kept = {};
        for (const k of Object.keys(target)) {
            if (keep && keep.has(k)) kept[k] = target[k];
            delete target[k];
        }
        Object.assign(target, src);
        for (const k of Object.keys(kept)) {
            if (!has(src, k)) target[k] = kept[k];
        }
        return target;
    }

    const HOSPITAL_KEEP = new Set(['schedule', 'icu', 'passwords']);

    /**
     * Write one record's value back into the in-memory database, mutating existing
     * objects in place so pages holding references keep seeing current data.
     * `value === null` removes the record.
     */
    function applyRecord(db, c, id, h, value) {
        if (!db) return;
        if (c === 'meta') {
            if (value === null) delete db[id];
            else db[id] = value.value;
            return;
        }
        db.hospitals = db.hospitals || {};
        if (c === 'hospital') {
            if (value === null) { delete db.hospitals[id]; return; }
            const cur = db.hospitals[id];
            if (cur) replaceInPlace(cur, value, HOSPITAL_KEEP);
            else db.hospitals[id] = Object.assign({}, value, { schedule: [] });
            return;
        }
        if (c === 'icu') {
            const hosp = db.hospitals[id];
            if (!hosp) return;
            if (value === null) delete hosp.icu;
            else if (isObj(hosp.icu)) replaceInPlace(hosp.icu, value);
            else hosp.icu = value;
            return;
        }
        if (c === 'sched') {
            const hosp = db.hospitals[h];
            if (!hosp) return;
            if (!Array.isArray(hosp.schedule)) hosp.schedule = [];
            const rid = id.slice(h.length + 1);
            const idx = hosp.schedule.findIndex(e => e && e[RID] === rid);
            if (value === null) {
                if (idx >= 0) hosp.schedule.splice(idx, 1);
            } else if (idx >= 0) {
                replaceInPlace(hosp.schedule[idx], value);
            } else {
                setRid(value, rid);
                hosp.schedule.push(value);
            }
            return;
        }
        if (c === 'resident') {
            if (!Array.isArray(db.residents)) db.residents = [];
            const idx = db.residents.findIndex(r => r && String(r.id) === id);
            if (value === null) {
                if (idx >= 0) db.residents.splice(idx, 1);
            } else if (idx >= 0) {
                replaceInPlace(db.residents[idx], value);
            } else {
                db.residents.push(value);
            }
        }
    }

    /** Group ops into requests that stay well under the Worker's per-request limits. */
    function chunkOps(ops, maxBytes = 150000, maxOps = 400) {
        const chunks = [];
        let cur = [], size = 0;
        for (const op of ops) {
            const len = (op.s ? op.s.length : 0) + 120;
            if (cur.length && (size + len > maxBytes || cur.length >= maxOps)) {
                chunks.push(cur);
                cur = [];
                size = 0;
            }
            cur.push(op);
            size += len;
        }
        if (cur.length) chunks.push(cur);
        return chunks;
    }

    return { hash, stableStringify, schedIdentity, key, decompose, compose, baseFromRows, diff, merge3, applyRecord, chunkOps, setRid, RID };
});
