/**
 * Name and phone normalisation used to match a sign-up against the roster and to link duty
 * cards to accounts. Spelling variants that are common in Arabic names (أ/إ/آ/ا, ة/ه, ى/ي,
 * diacritics, "د." titles, "عبد الله" vs "عبدالله") all normalise to the same key.
 */

// Titles in front of a name (doctors, and the job-title prefixes of Administrative Affairs officers).
const TITLES = new Set(['د', 'دكتور', 'الدكتور', 'دكتوره', 'الدكتوره', 'dr', 'doctor', 'م', 'ص',
  'ا', 'استاذ', 'الاستاذ', 'مهندس', 'المهندس', 'mr', 'mrs', 'ms', 'miss']);
const JOINERS = new Set(['عبد', 'ابو', 'أبو']);

export function nameTokens(name) {
  const cleaned = String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // diacritics, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const raw = cleaned ? cleaned.split(' ') : [];
  while (raw.length > 1 && TITLES.has(raw[0])) raw.shift();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (JOINERS.has(raw[i]) && i + 1 < raw.length) {
      out.push(raw[i] + raw[i + 1]);
      i++;
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

export const nameKey = name => nameTokens(name).join(' ');

/** The typed name must contain at least the first and second name of the roster entry, in order. */
export function namesMatch(typed, stored) {
  const t = nameTokens(typed);
  const s = nameTokens(stored);
  if (t.length < 2 || s.length < 2) return false;
  return t[0] === s[0] && t[1] === s[1];
}

/** Iraqi mobile numbers in any common form (+964 7.., 00964 7.., 07..) -> "7XXXXXXXXX". */
export function phoneKey(phone) {
  let d = String(phone || '').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('964')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^7\d{9}$/.test(d) ? d : '';
}

/** "DD/MM/YYYY" (the roster's format) or "YYYY-MM-DD" -> "YYYY-MM-DD", or '' when invalid. */
export function isoDate(date) {
  const s = String(date || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : '';
}
