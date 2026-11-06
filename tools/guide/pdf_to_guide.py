"""
Basra medical guide (دليل البصرة الطبي, an Excel sheet printed to PDF) -> guide.json for the
Specialists page's clinics guide (hub-guide.js, worker/src/guide.js).

    python tools/guide/pdf_to_guide.py "<guide>.pdf" <out>/guide.json

Needs: pip install pymupdf fonttools

Why the text is decoded glyph by glyph: the PDF's own text layer is wrong in many places. Excel
embeds Calibri Bold, whose Arabic ligatures (بر، ين، في، سر، صر ...) are drawn as undotted shapes
plus separate dot glyphs, and the PDF's ToUnicode table maps those to the wrong letters (عصرا comes
out as عرصا, الحسين as الحسير ى). So:
  1. every glyph id is mapped to its true letters through the embedded font's own cmap + GSUB
     (ligatures resolve to their undotted components, e.g. ٮى);
  2. the dot glyphs are attached to the ligature under them, and their count and position (above /
     below, right / left part) give the dotted letters (ٮ + two dots below = ي, ...);
  3. glyphs are put into the table's cells by position (column borders below, row borders from the
     sheet's lines) and each cell's visual order is turned back into logical order.
The output holds only what the PDF says (names, addresses, phone numbers, notes), grouped into
categories (CATS / SECTION_RULES below). The data is not kept in git: the repo is public and nothing
of the site may be seen without signing in; the owner uploads guide.json from the guide's panel.
"""
import sys, re, json, time, unicodedata, collections
import pymupdf
from fontTools.ttLib import TTFont
import io

# ---------------------------------------------------------------- glyph -> text through the font
def font_map(buf):
    f = TTFont(io.BytesIO(buf))
    go = f.getGlyphOrder()
    gid = {n: i for i, n in enumerate(go)}
    txt = {}
    for cp, name in sorted(f.getBestCmap().items(), key=lambda kv: (kv[0] >= 0xFB50, kv[0])):
        g = gid[name]
        if g in txt:
            continue
        dec = unicodedata.decomposition(chr(cp))
        txt[g] = ''.join(chr(int(p, 16)) for p in dec.split()[1:]) if dec.startswith('<') else chr(cp)
    subs = []
    for lk in f['GSUB'].table.LookupList.Lookup:
        for st in lk.SubTable:
            if st.LookupType == 7:
                st = st.ExtSubTable
            t = st.LookupType
            if t == 1:
                subs += [('s', gid[a], gid[b]) for a, b in st.mapping.items()]
            elif t == 3:
                subs += [('s', gid[a], gid[b]) for a, bs in st.alternates.items() for b in bs]
            elif t == 4:
                for first, ligs in st.ligatures.items():
                    for lg in ligs:
                        subs.append(('l', [gid[first]] + [gid[c] for c in lg.Component], gid[lg.LigGlyph]))
    changed = True
    while changed:
        changed = False
        for kind, a, b in subs:
            if kind == 's' and a in txt and b not in txt:
                txt[b] = txt[a]; changed = True
            elif kind == 'l' and b not in txt and all(c in txt for c in a):
                txt[b] = ''.join(txt[c] for c in a); changed = True
    upm = f['head'].unitsPerEm
    glyf = f['glyf']
    def ink(g):
        gl = glyf[go[g]]
        return ((gl.xMin + gl.xMax) / 2 / upm, (gl.yMin + gl.yMax) / 2 / upm) if hasattr(gl, 'xMin') else (0, 0)
    # Dot glyphs: the font's undotted-letter marks (no character of their own). Counted by contours.
    marks = {}
    for g, name in enumerate(go):
        if g in txt or not name.startswith('glyph'):
            continue
        gl = glyf[name]
        if not hasattr(gl, 'numberOfContours') or gl.numberOfContours <= 0 or gl.numberOfContours > 3:
            continue
        if (gl.yMax - gl.yMin) > upm * 0.35:   # a dot group is small
            continue
        w, h = gl.xMax - gl.xMin, gl.yMax - gl.yMin
        # one contour taller than wide is the hamza mark (ئ); otherwise the contours are the dots
        marks[g] = 'h' if gl.numberOfContours == 1 and h > w * 1.15 else gl.numberOfContours
    return txt, marks, ink

UNDOTTED = 'ٮٯں'
def needs_dots(t):
    return any(c in UNDOTTED for c in t) or (len(t) == 2 and t[1] in 'ىر' and not t.startswith('ل' + 'ا'))

DOTS = {
    'ٮ': {((1, 'b'),): 'ب', ((2, 'a'),): 'ت', ((3, 'a'),): 'ث', ((1, 'a'),): 'ن', ((2, 'b'),): 'ي', (('h', 'a'),): 'ئ', (): 'ى'},
    'ں': {((1, 'a'),): 'ن', (): 'ن'},
    'ى': {((2, 'b'),): 'ي', (): 'ى', (('h', 'a'),): 'ئ'},
    'ٯ': {((1, 'a'),): 'ف', ((2, 'a'),): 'ق', (): 'ف'},
    'ح': {((1, 'b'),): 'ج', ((1, 'a'),): 'خ', (): 'ح'},
    'ر': {((1, 'a'),): 'ز', (): 'ر'},
    'س': {((3, 'a'),): 'ش', (): 'س'},
    'ص': {((1, 'a'),): 'ض', (): 'ص'},
    'ط': {((1, 'a'),): 'ظ', (): 'ط'},
    'ع': {((1, 'a'),): 'غ', (): 'ع'},
}
UNRESOLVED = collections.Counter()
FALLBACK = {'ٮ': 'ي', 'ں': 'ن', 'ٯ': 'ف'}

def dotted(comp, marks):
    m = DOTS.get(comp)
    if not m:
        return comp
    r = m.get(tuple(sorted(marks)))
    if r is None:
        UNRESOLVED[(comp, tuple(sorted(marks)))] += 1
        return FALLBACK.get(comp, comp)
    return r

def decode_lig(text, x0, x1, base_y, size, marks):
    comps = list(text)
    w = (x1 - x0) or 1
    first = 0.4 if comps[0] in 'ٮٯ' else 0.5     # right-to-left: the first letter is the right part
    assign = [[] for _ in comps]
    for cnt, mx, my in marks:
        i = min(0 if (x1 - mx) / w < first else 1, len(comps) - 1)
        th = 0.45 if comps[i] == 'ح' else 0.2       # ج's dot sits inside the bowl, خ's above it
        pos = 'a' if (cnt == 'h' or my < base_y - th * size) else 'b'
        assign[i].append((cnt, pos))
    return ''.join(dotted(c, a) for c, a in zip(comps, assign))

LTR = re.compile(r'[0-9A-Za-z](?:[0-9A-Za-z/.:+&,\- ]*[0-9A-Za-z])?')
def logical(vis):
    s = LTR.sub(lambda m: m.group(0)[::-1], vis[::-1])
    return s.translate(str.maketrans('()', ')('))

# Column borders of the sheet (PDF units, the same on every page): ت | name | address | phone | notes
COLS = [(2185, 2250, 'n'), (1930, 2185, 'name'), (1312, 1930, 'addr'), (1090, 1312, 'phone'), (0, 1090, 'note')]
def col_of(x):
    for a, b, k in COLS:
        if a <= x < b:
            return k
    return None

def read_rows(pdf):
    d = pymupdf.open(pdf)
    best = None
    for p in d:
        for f in p.get_fonts():
            if f[1] == 'ttf' and f[5] == 'Identity-H' and 'Calibri,Bold' == f[3].split('+')[-1]:
                buf = d.extract_font(f[0])[3]
                if best is None or len(buf) > len(best):
                    best = buf
    txt, marks_g, ink = font_map(best)
    hamza = [g for g, t in txt.items() if t == 'ء']
    rows = []
    for pno, p in enumerate(d):
        ys = set()
        for g in p.get_drawings():
            for it in g['items']:
                if it[0] == 're' and it[1].height < 6 and it[1].width > 500:
                    ys.add(round(it[1].y0))
                elif it[0] == 'l' and abs(it[1].y - it[2].y) < 1 and abs(it[1].x - it[2].x) > 500:
                    ys.add(round(it[1].y))
        yb = []
        for y in sorted(ys):
            if not yb or y - yb[-1] > 8:
                yb.append(y)
        def row_of(y):
            for i in range(len(yb) - 1):
                if yb[i] <= y < yb[i + 1]:
                    return i
            return None
        bases, marks = [], []
        for sp in p.get_texttrace():
            if not sp['font'].endswith('Calibri,Bold'):
                continue
            size = sp['size']
            for u, g, (ox, oy), bb in sp['chars']:
                if g < 0:
                    continue
                if g in marks_g:
                    ix, iy = ink(g)
                    marks.append((marks_g[g], ox + ix * size, oy - iy * size))
                    continue
                t = txt.get(g, chr(u))
                if t == 'ء' and bb[2] - bb[0] < 0.5:   # a zero-width hamza is a ligature's mark (ئ)
                    ix, iy = ink(g)
                    marks.append(('h', ox + ix * size, oy - iy * size))
                    continue
                bases.append({'x0': bb[0], 'x1': bb[2], 'y': oy, 'size': size, 't': t, 'm': [], 'lig': needs_dots(t)})
        for cnt, mx, my in marks:
            best_b, bd = None, 1e9
            for b in bases:
                if not b['lig'] or abs(b['y'] - my) > b['size'] * 1.2:
                    continue
                dx = 0 if b['x0'] - 0.5 <= mx <= b['x1'] + 0.5 else min(abs(mx - b['x0']), abs(mx - b['x1'])) + 5
                if dx + abs(b['y'] - my) / 100 < bd:
                    bd, best_b = dx + abs(b['y'] - my) / 100, b
            if best_b is not None:
                best_b['m'].append((cnt, mx, my))
        for b in bases:
            if b['lig']:
                b['t'] = decode_lig(b['t'], b['x0'], b['x1'], b['y'], b['size'], b['m'])
        cells = collections.defaultdict(list)
        for b in bases:
            r = row_of(b['y'] - b['size'] * 0.3)
            k = 'BIG' if b['size'] > 30 else col_of((b['x0'] + b['x1']) / 2)
            if r is not None and k:
                cells[(r, k)].append(b)
        for r in range(len(yb) - 1):
            rec = {'page': pno + 1}
            for k in ['n', 'name', 'addr', 'phone', 'note', 'BIG']:
                bs = sorted(cells.get((r, k), []), key=lambda b: b['y'])
                if not bs:
                    continue
                lines = []
                for b in bs:
                    if lines and abs(lines[-1][0] - b['y']) < b['size'] * 0.5:
                        lines[-1][1].append(b)
                    else:
                        lines.append([b['y'], [b]])
                out = []
                for _, lb in lines:
                    lb.sort(key=lambda b: b['x0'])
                    vis, prev = '', None
                    for b in lb:
                        if prev is not None and b['x0'] - prev > 2.5 and not vis.endswith(' ') and b['t'] != ' ':
                            vis += ' '
                        vis += b['t'][::-1] if len(b['t']) > 1 else b['t']
                        prev = b['x1']
                    out.append(logical(vis))
                rec[k] = ' '.join(out)
            if len(rec) > 1:
                rows.append(rec)
    return rows

# ---------------------------------------------------------------- cleaning
def clean(s):
    s = (s or '').replace('ـ', '').replace('ە', 'ه').replace('⁇', '')
    s = s.translate(str.maketrans(FALLBACK))
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\s+\)', ')', s)
    s = re.sub(r'\s*\.\.\.+\s*', ' ... ', s)
    s = re.sub(r'\s*(?<!\.)\.\.(?!\.)\s*', ' .. ', s)
    s = re.sub(r'\s+', ' ', s).strip(' -')
    return s

PHONE = re.compile(r'(?<!\d)0?7\d{9}(?!\d)')
def phones_of(s):
    out = []
    for m in PHONE.finditer(s or ''):
        p = m.group(0)
        p = p if p.startswith('0') else '0' + p
        if p not in out:
            out.append(p)
    return out

# ---------------------------------------------------------------- categories
# id, name, icon (Font Awesome)
CATS = [
    ('im', 'الباطنية', 'fa-stethoscope'),
    ('card', 'القلبية', 'fa-heart-pulse'),
    ('cts', 'جراحة القلب والصدر والأوعية', 'fa-heart-circle-plus'),
    ('gs', 'الجراحة العامة', 'fa-user-doctor'),
    ('obg', 'النسائية والتوليد والعقم', 'fa-person-pregnant'),
    ('ped', 'طب الأطفال', 'fa-baby'),
    ('peds', 'جراحة الأطفال', 'fa-children'),
    ('ortho', 'الكسور والمفاصل', 'fa-bone'),
    ('rheum', 'المفاصل (الروماتيزم)', 'fa-hand-dots'),
    ('neuro', 'طب الجملة العصبية', 'fa-wave-square'),
    ('ns', 'جراحة الجملة العصبية', 'fa-brain'),
    ('psy', 'النفسية', 'fa-comment-medical'),
    ('uro', 'المجاري البولية والكلى', 'fa-droplet'),
    ('eye', 'العيون', 'fa-eye'),
    ('ent', 'الأنف والأذن والحنجرة', 'fa-ear-listen'),
    ('derm', 'الجلدية والتناسلية', 'fa-hand-sparkles'),
    ('plast', 'الجراحة التجميلية', 'fa-wand-magic-sparkles'),
    ('rad', 'الأشعة والسونار والطب النووي', 'fa-x-ray'),
    ('pain', 'الألم والتخدير', 'fa-syringe'),
    ('nutr', 'التغذية', 'fa-apple-whole'),
    ('fm', 'طب الأسرة والطب العام', 'fa-house-medical'),
    ('dent', 'الأسنان', 'fa-tooth'),
    ('hosp', 'المستشفيات الأهلية', 'fa-hospital'),
    ('char', 'المجمعات الطبية الخيرية', 'fa-hand-holding-heart'),
    ('lab', 'المختبرات', 'fa-flask'),
    ('pharm', 'الصيدليات', 'fa-prescription-bottle-medical'),
    ('pt', 'العلاج الطبيعي والتأهيل', 'fa-person-walking'),
    ('beauty', 'التجميل والليزر', 'fa-spa'),
    ('autism', 'التوحد والنطق وتنمية القدرات', 'fa-puzzle-piece'),
    ('optic', 'البصريات', 'fa-glasses'),
    ('nurse', 'التضميد والتمريض', 'fa-user-nurse'),
    ('equip', 'التجهيزات والمستلزمات الطبية', 'fa-boxes-stacked'),
]
# (section-name test, category id, kind) — first match wins. kind: d = doctors, p = places.
SECTION_RULES = [
    (r'^الباطنية', 'im', 'd'),
    (r'تشوهات القلب|^القلبية|أيكو القلب', 'card', 'd'),
    (r'جراحة القلب', 'cts', 'd'),
    (r'الطب النووي|قسطرة|هشاشة العظام', 'rad', 'p'),
    (r'^مراكز العقم', 'obg', 'p'),
    (r'النسائية', 'obg', 'd'),
    (r'جراحة الأطفال', 'peds', 'd'),
    (r'طب الأطفال', 'ped', 'd'),
    (r'السمع والنطق', 'ent', 'd'),
    (r'جراحة الجملة العصبية', 'ns', 'd'),
    (r'الجملة العصبية|الفسلجة العصبية', 'neuro', 'd'),
    (r'^النفسية', 'psy', 'd'),
    (r'المجاري البولية', 'uro', 'd'),
    (r'الألم والتخدير', 'pain', 'd'),
    (r'الثقلين|المستشفيات الاهلية', 'hosp', 'p'),
    (r'جراحة عامه|الجراحة العامة', 'gs', 'd'),
    (r'الجراحة التجميلية', 'plast', 'd'),
    (r'التغذية', 'nutr', 'd'),
    (r'طب الأسرة|طب المجتمع', 'fm', 'd'),
    (r'مستلزمات الكسور|تجهيزات مستلزمات الاسنان|التجهيزات الطبية|الأطراف', 'equip', 'p'),
    (r'الكسور والمفاصل', 'ortho', 'd'),
    (r'^المفاصل', 'rheum', 'd'),
    (r'عوينات', 'optic', 'p'),
    (r'العيون', 'eye', 'd'),
    (r'الانف والاذن', 'ent', 'd'),
    (r'الجلدية', 'derm', 'd'),
    (r'^مراكز الاشعة الخاصة بالاسنان|^مختبرات الاسنان', 'dent', 'p'),
    (r'الاسنان والتجميل|التجميل والليزر|زراعة الشعر|الرشاقة', 'beauty', 'p'),
    (r'الاسنان', 'dent', 'd'),
    (r'الاشعة|السونار|الرنين', 'rad', 'd'),
    (r'العلاج الطبيعي|الطب الرياضي', 'pt', 'p'),
    (r'المجمعات الطبية الخيرية|سبع سنابل', 'char', 'p'),
    (r'المضمدين', 'nurse', 'p'),
    (r'التوحد', 'autism', 'p'),
    (r'^المختبرات', 'lab', 'p'),
    (r'الصيدليات', 'pharm', 'p'),
]

def section_label(name):
    s = re.sub(r'\((?:\s*)(?:الطبيبات|الأطباء) فقط\s*\)', '', name)
    s = re.sub(r'^الباطنية - ', '', s)
    s = s.replace('الاولادة', 'الولادة').replace('جراحة عامه', 'الجراحة العامة')
    return clean(s)

def build(rows):
    meta_rows = [r for r in rows if r['page'] == 1 and 'name' in r and not (r.get('n') or '').strip().isdigit()]
    info = {clean(r['name']).replace('ا سم', 'اسم'): clean(r.get('BIG', '')) for r in meta_rows}
    cats_idx = {c[0]: i for i, c in enumerate(CATS)}
    secs, items, unmatched = [], [], []
    notes, started, sec = [], False, None
    for r in rows:
        if 'BIG' in r and 'name' not in r:
            big = clean(r['BIG'])
            if big.startswith('ت ') or big.startswith('ت'+'ا'):     # a table's column titles
                continue
            rule = next((x for x in SECTION_RULES if re.search(x[0], big)), None)
            if rule is None:
                if not started:
                    if big.startswith('ملاحظة') or 'وتساب' in big:
                        notes.append(big)
                    continue
                unmatched.append(big)
                continue
            started = True
            g = 'f' if 'الطبيبات فقط' in big or big.startswith('طبيبة') else ('m' if 'الأطباء فقط' in big else '')
            sub = 1 if 'اختصاص دقيق' in big or 'الاختصاصات الدقيقة' in big else 0
            secs.append([cats_idx[rule[1]], section_label(big), rule[2], g, sub])
            sec = len(secs) - 1
            continue
        if not started or sec is None or not r.get('name'):
            continue
        name = clean(r['name'])
        addr = clean(r.get('addr', ''))
        ph_raw = clean(r.get('phone', ''))
        note = clean(r.get('note', ''))
        ph = phones_of(ph_raw)
        rest = PHONE.sub('', ph_raw).strip(' -')
        if rest:
            note = (rest + ' .. ' + note) if note else rest
        items.append([sec, name, addr, ' '.join(ph), note])
    contact = next((p for n in notes for p in phones_of(n)), '')
    return {
        'v': int(time.time()),
        'title': info.get('أسم الملف', 'دليل البصرة الطبي'),
        'edition': info.get('ناريخ أخر تحديث', '') or next((v for k, v in info.items() if 'تحديث' in k), ''),
        'author': next((v for k, v in info.items() if 'مصمم' in k), ''),
        'org': next((v for k, v in info.items() if 'المؤسسة' in k), ''),
        'contact': contact,
        'notes': [n for n in notes if 'ترتيب' not in n],
        'cats': [list(c) for c in CATS],
        'secs': secs,
        'items': items,
    }, unmatched

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    rows = read_rows(sys.argv[1])
    guide, unmatched = build(rows)
    json.dump(guide, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('sections', len(guide['secs']), 'entries', len(guide['items']))
    for u in unmatched:
        print('UNMATCHED SECTION', u)
    for k, v in UNRESOLVED.most_common():
        print('dots not resolved (fallback used)', k, v)
