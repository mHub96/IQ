/**
 * An account's standing in each hospital. An account is one person; in each hospital it has its own
 * role: for example a regular resident in one, a branch representative in another.
 *
 *   accounts.role, accounts.hospitals  the highest role, and the hospitals it applies to. Everything
 *                                      that asks "is this an admin of X" keeps working from these.
 *   accounts.hosp_roles                { hospital: { r, s } } only when roles differ between hospitals,
 *                                      or for a branch representative (s = their specialty).
 *   accounts.cover                     the hospitals of the linked resident record (a copy kept by
 *                                      mirrorResident and the nightly job, so no extra read per request).
 *
 * A hospital without an entry: the role that covers it, else a plain resident where the account is
 * registered or covers it, else nothing.
 */

/** Roles an account can hold in one hospital, from the least to the most. */
export const HOSPITAL_ROLES = ['rotator', 'user', 'anaesthesia', 'branch', 'admin'];
// Roles whose rights come with a list of hospitals (accounts.hospitals).
const SCOPED = ['anaesthesia', 'branch', 'admin'];
const rank = r => HOSPITAL_ROLES.indexOf(r);

function parseJson(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text) ?? fallback; } catch { return fallback; }
}
export const parseHospRoles = text => {
  const v = parseJson(text, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
};
export const parseCover = text => {
  const v = parseJson(text, []);
  return Array.isArray(v) ? v.filter(h => typeof h === 'string') : [];
};

/** The account's role in `hosp` from a request's auth (see resolveAccountAuth). null = no standing there. */
export function roleAt(auth, hosp) {
  if (!auth || !hosp) return null;
  if (auth.r === 'owner') return 'owner';
  const own = auth.x && auth.x[hosp];
  if (own && own.r) return own.r;
  if (auth.h && (auth.h.includes('*') || auth.h.includes(hosp))) return auth.r;
  if (!auth.a) return null;
  const base = auth.r === 'rotator' || /^aa_/.test(auth.r) ? auth.r : 'user';
  if (auth.hosp === hosp) return base;
  if (auth.cov && auth.cov.includes(hosp)) return /^aa_/.test(base) ? null : base;
  return null;
}

/** The specialty a branch representative runs in `hosp` (null when they are not one there). */
export const branchSpecAt = (auth, hosp) => (roleAt(auth, hosp) === 'branch' ? (auth.x && auth.x[hosp] && auth.x[hosp].s) || null : null);

/** The hospitals where this account holds `role`. */
export function hospitalsWithRole(auth, role) {
  const out = new Set();
  if (auth.r === role) (auth.h || []).forEach(h => out.add(h));
  if (auth.x) Object.entries(auth.x).forEach(([h, v]) => { if (v && v.r === role) out.add(h); });
  return [...out];
}

/** Every hospital the account has anything to do with, from its database row. */
export function accountHospitals(row) {
  const out = new Set(row.hosp ? [row.hosp] : []);
  parseCover(row.cover).forEach(h => out.add(h));
  Object.keys(parseHospRoles(row.hosp_roles) || {}).forEach(h => out.add(h));
  parseJson(row.hospitals, []).forEach(h => { if (h !== '*') out.add(h); });
  return [...out];
}

/** { hospital: { r, s? } } as the account stands now, from its database row. */
export function accessOf(row) {
  const out = {};
  const scope = parseJson(row.hospitals, []);
  const base = row.role === 'rotator' ? 'rotator' : 'user';
  [row.hosp, ...parseCover(row.cover)].forEach(h => { if (h) out[h] = { r: base }; });
  if (SCOPED.includes(row.role)) scope.forEach(h => { if (h !== '*') out[h] = { r: row.role }; });
  Object.entries(parseHospRoles(row.hosp_roles) || {}).forEach(([h, v]) => { if (v && v.r) out[h] = v.s ? { r: v.r, s: v.s } : { r: v.r }; });
  return out;
}

/**
 * The columns for an account standing as `access` says. `keepAll`: the account's scope holds '*'.
 * Returns { role, hospitals, hosp_roles } (hosp_roles null when role and hospitals say it all).
 */
export function collapseAccess(access, keepAll = false) {
  const entries = Object.entries(access).filter(([, v]) => v && HOSPITAL_ROLES.includes(v.r));
  const top = entries.reduce((best, [, v]) => (rank(v.r) > rank(best) ? v.r : best), 'rotator');
  const hospitals = SCOPED.includes(top) ? entries.filter(([, v]) => v.r === top).map(([h]) => h) : [];
  if (keepAll && top === 'admin') hospitals.push('*');
  const special = entries.filter(([, v]) => v.r !== 'user');
  // Needed when a hospital's role is not what role + hospitals say by themselves.
  const plain = top !== 'branch' && special.every(([, v]) => v.r === top);
  const hosp_roles = plain ? null : Object.fromEntries(special.map(([h, v]) => [h, v.s ? { r: v.r, s: v.s } : { r: v.r }]));
  return { role: top, hospitals, hosp_roles: hosp_roles ? JSON.stringify(hosp_roles) : null };
}
