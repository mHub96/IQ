"""
Turns the avataaars TSX components (read as text, never executed) into SVG template strings.

Template syntax produced:
  {{id:NAME}}            a per-render unique id (masks, paths, filters)
  {{color}}              the colour of a makeColor() component
  {{slot:Name:maskVar}}  a child component (HairColor, HatColor, FacialHair, Colors, Graphics, Skin)
  {{children}}           the accessories slot inside a top
Output: avataaars.json  { group: { optionName: template } } plus colour tables.
"""
import json, re, sys, pathlib

SRC = pathlib.Path(sys.argv[1])          # .../package/src/avatar
OUT = pathlib.Path(sys.argv[2])

ATTR = {
    'strokeWidth': 'stroke-width', 'fillRule': 'fill-rule', 'fillOpacity': 'fill-opacity',
    'strokeLinecap': 'stroke-linecap', 'strokeLinejoin': 'stroke-linejoin', 'strokeOpacity': 'stroke-opacity',
    'clipRule': 'clip-rule', 'clipPath': 'clip-path', 'xlinkHref': 'xlink:href', 'stopColor': 'stop-color',
    'stopOpacity': 'stop-opacity', 'fontSize': 'font-size', 'fontWeight': 'font-weight', 'fontFamily': 'font-family',
    'strokeDasharray': 'stroke-dasharray', 'strokeMiterlimit': 'stroke-miterlimit', 'xmlnsXlink': 'xmlns:xlink',
    'letterSpacing': 'letter-spacing', 'gradientUnits': 'gradientUnits', 'colorInterpolationFilters': 'color-interpolation-filters',
    'floodColor': 'flood-color', 'floodOpacity': 'flood-opacity', 'stdDeviation': 'stdDeviation',
}

def find_return_jsx(text, start=0):
    """JSX of the first `return (` after `start`: the text up to the matching parenthesis."""
    i = text.find('return (', start)
    if i < 0:
        i = text.find('return(', start)
        if i < 0:
            return None, -1
    j = text.index('(', i)
    depth = 0
    k = j
    in_str = None
    while k < len(text):
        c = text[k]
        if in_str:
            if c == in_str and text[k - 1] != '\\':
                in_str = None
        elif c in '\'"`':
            in_str = c
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return text[j + 1:k].strip(), k
        k += 1
    raise ValueError('unbalanced')

def jsx_to_svg(jsx):
    if not jsx or jsx.strip() == 'null':
        return ''
    s = jsx
    s = re.sub(r'\{/\*.*?\*/\}', '', s, flags=re.S)                         # JSX comments
    s = re.sub(r"xlinkHref=\{'#' \+ (\w+)\}", r'xlink:href="#{{id:\1}}"', s)
    s = re.sub(r"xlinkHref=\{`#\$\{(\w+)\}`\}", r'xlink:href="#{{id:\1}}"', s)
    s = re.sub(r"(\w+)=\{`url\(#\$\{this\.props\.maskID\}\)`\}", r'\1="url(#{{mask}})"', s)
    s = re.sub(r"(\w+)=\{'url\(#' \+ this\.props\.maskID \+ '\)'\}", r'\1="url(#{{mask}})"', s)
    s = re.sub(r"(\w+)=\{`url\(#\$\{(\w+)\}\)`\}", r'\1="url(#{{id:\2}})"', s)
    s = re.sub(r"(\w+)=\{'url\(#' \+ (\w+) \+ '\)'\}", r'\1="url(#{{id:\2}})"', s)
    s = re.sub(r'\bid=\{(\w+)\}', r'id="{{id:\1}}"', s)
    s = re.sub(r'\bfill=\{color\}', 'fill="{{color}}"', s)
    s = s.replace('{this.props.children}', '{{children}}')
    # child components: <HairColor maskID={mask2} />, <FacialHair />, <Graphics maskID={mask1} />
    s = re.sub(r"<([A-Z]\w*)\s+maskID=\{(\w+)\}(?:\s+defaultColor=['\"](\w+)['\"])?\s*/>",
               lambda m: '{{slot:%s:%s:%s}}' % (m.group(1), m.group(2), m.group(3) or ''), s)
    s = re.sub(r'<([A-Z]\w*)\s*/>', r'{{slot:\1:}}', s)
    # attribute values: {'...'} / {"..."} / {123}
    s = re.sub(r"=\{'([^']*)'\}", r'="\1"', s)
    s = re.sub(r'=\{"([^"]*)"\}', r'="\1"', s)
    s = re.sub(r'=\{(-?[\d.]+)\}', r'="\1"', s)
    s = re.sub(r"='([^']*)'", r'="\1"', s)
    for a, b in ATTR.items():
        s = re.sub(r'\b' + a + r'=', b + '=', s)
    s = re.sub(r'\s+id="(?!\{\{)[^"]*"', '', s)                              # decorative ids (duplicates in the page)
    s = re.sub(r'\s+', ' ', s).replace('> <', '><').strip()
    if '{' in s.replace('{{', '').replace('}}', ''):
        leftovers = re.findall(r'[^{]\{[^{][^}]*\}', s)
        raise ValueError('unconverted JSX: ' + str(leftovers[:3]))
    return s

def classes(text):
    """[(className, optionValue, jsx)] for every class component in a file."""
    out = []
    for m in re.finditer(r'class (\w+) extends React\.Component', text):
        name = m.group(1)
        opt = re.search(r"static optionValue = '([^']+)'", text[m.end():m.end() + 400])
        jsx, _ = find_return_jsx(text, m.end())
        if jsx and '<Selector' in jsx:
            continue  # the option switch, not a drawing
        out.append((name, opt.group(1) if opt else name, jsx))
    return out

def make_colors(text):
    return {n: c for n, c in re.findall(r"makeColor\('(\w+)', '(#[0-9A-Fa-f]{3,6})'\)", text)}

def color_template(text):
    jsx, _ = find_return_jsx(text, text.index('function makeColor'))
    return jsx_to_svg(jsx)

data = {'groups': {}, 'colors': {}, 'colorTemplates': {}}
def group(name, folder, files=None, skip=()):
    g = {}
    for f in sorted((SRC / folder).glob('*.tsx')):
        if f.name in ('index.tsx', 'Colors.tsx', 'HairColor.tsx', 'HatColor.tsx', 'Graphics.tsx') or f.name in skip:
            continue
        if files and f.stem not in files:
            continue
        for cls, opt, jsx in classes(f.read_text(encoding='utf-8')):
            try:
                g[opt] = jsx_to_svg(jsx)
            except ValueError as e:
                raise ValueError(f'{f.name}: {e} :: ' + re.sub(r'\s+', ' ', jsx)[jsx.find('mask2') - 200:][:400])
    data['groups'][name] = g

group('top', 'top', skip=('index.tsx',))
group('accessories', 'top/accessories')
group('facialHair', 'top/facialHair')
group('clothes', 'clothes')
group('eyes', 'face/eyes')
group('eyebrow', 'face/eyebrow')
group('mouth', 'face/mouth')
group('nose', 'face/nose')
g = {}
for cls, opt, jsx in classes((SRC / 'clothes/Graphics.tsx').read_text(encoding='utf-8')):
    g[opt] = jsx_to_svg(jsx)
data['groups']['graphics'] = g
for key, path in [('hair', 'top/HairColor.tsx'), ('hat', 'top/HatColor.tsx'), ('facialHair', 'top/facialHair/Colors.tsx'),
                  ('clothes', 'clothes/Colors.tsx'), ('skin', 'Skin.tsx')]:
    t = (SRC / path).read_text(encoding='utf-8')
    data['colors'][key] = make_colors(t)
    data['colorTemplates'][key] = color_template(t)
face = (SRC / 'face/index.tsx').read_text(encoding='utf-8')
data['face'] = jsx_to_svg(find_return_jsx(face)[0])
OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
for k, v in data['groups'].items():
    print(k, len(v), list(v)[:40])
print({k: len(v) for k, v in data['colors'].items()})
print('face:', data['face'][:300])
