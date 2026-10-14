// Builds hub-avatar.js (avatar version 3) from avataaars.json (converted artwork) + custom.js (new parts).
// usage: node build.js <avataaars.json> <custom.js> <out hub-avatar.js>
const fs = require('fs');
const [, , SRC, CUSTOM, OUT] = process.argv;
const base = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const custom = require(CUSTOM);

// Smaller numbers: 2 decimals are invisible at avatar sizes.
const tidy = s => s.replace(/-?\d+\.\d+(e-?\d+)?/g, n => { const v = Math.round(Number(n) * 100) / 100; return String(Object.is(v, -0) ? 0 : v); })
  .replace(/ ?(\/?>) ?/g, '$1').replace(/\s{2,}/g, ' ');

// Option lists in display order: [key in data, Arabic label]. Custom parts are appended per group.
const ORDER = {
  top: [
    ['NoHair', 'بدون شعر'], ['ShortHairShortFlat', 'قصير مسطح'], ['ShortHairShortRound', 'قصير دائري'], ['ShortHairShortWaved', 'قصير مموج'],
    ['ShortHairShortCurly', 'قصير مجعد'], ['ShortHairTheCaesar', 'سيزر'], ['ShortHairTheCaesarSidePart', 'سيزر بفرق جانبي'], ['ShortHairSides', 'جوانب فقط'],
    ['ShortHairFrizzle', 'منفوش'], ['ShortHairShaggy', 'أشعث'], ['ShortHairShaggyMullet', 'ماليت'], ['ShortHairDreads01', 'ضفائر قصيرة'],
    ['ShortHairDreads02', 'ضفائر قصيرة ٢'], ['LongHairNotTooLong', 'متوسط الطول'], ['LongHairBob', 'بوب'], ['LongHairBun', 'كعكة'],
    ['LongHairCurly', 'طويل مجعد'], ['LongHairCurvy', 'طويل مموج'], ['LongHairStraight', 'طويل ناعم'], ['LongHairStraight2', 'طويل ناعم ٢'],
    ['LongHairStraightStrand', 'طويل بخصلة'], ['LongHairBigHair', 'كثيف'], ['LongHairMiaWallace', 'غرة مستقيمة'], ['LongHairFrida', 'فريدا'],
    ['LongHairFro', 'أفرو'], ['LongHairFroBand', 'أفرو بعصابة'], ['LongHairDreads', 'ضفائر طويلة'], ['LongHairShavedSides', 'جانب محلوق'],
    ['Hijab', 'حجاب'], ['Turban', 'عمامة'], ['Hat', 'قبعة'], ['WinterHat1', 'قبعة شتوية'], ['WinterHat2', 'قبعة شتوية ٢'],
    ['WinterHat3', 'قبعة شتوية ٣'], ['WinterHat4', 'قبعة بأذنين'], ['Eyepatch', 'رقعة عين'],
  ],
  accessories: [['Blank', 'بدون'], ['Prescription01', 'نظارة طبية'], ['Prescription02', 'نظارة طبية ٢'], ['Round', 'نظارة دائرية'],
    ['Kurt', 'نظارة كيرت'], ['Wayfarers', 'نظارة شمسية'], ['Sunglasses', 'نظارة شمسية ٢']],
  facialHair: [['Blank', 'بدون'], ['BeardLight', 'لحية خفيفة'], ['BeardMedium', 'لحية متوسطة'], ['BeardMajestic', 'لحية كثيفة'],
    ['MoustacheFancy', 'شارب أنيق'], ['MoustacheMagnum', 'شارب كثيف']],
  clothes: [['BlazerShirt', 'سترة وقميص'], ['BlazerSweater', 'سترة وكنزة'], ['CollarSweater', 'كنزة بياقة'], ['GraphicShirt', 'تيشيرت برسمة'],
    ['Hoodie', 'هودي'], ['Overall', 'أوفرول'], ['ShirtCrewNeck', 'تيشيرت دائري'], ['ShirtScoopNeck', 'تيشيرت واسع'], ['ShirtVNeck', 'تيشيرت V']],
  graphics: [['Skull', 'جمجمة'], ['SkullOutline', 'جمجمة مفرغة'], ['Bat', 'خفاش'], ['Cumbia', 'كومبيا'], ['Deer', 'غزال'], ['Diamond', 'ماسة'],
    ['Hola', 'هولا'], ['Selena', 'سيلينا'], ['Pizza', 'بيتزا'], ['Resist', 'Resist'], ['Bear', 'دب']],
  eyes: [['Default', 'عادية'], ['Happy', 'سعيدة'], ['Wink', 'غمزة'], ['WinkWacky', 'غمزة مرحة'], ['Squint', 'مضيقة'], ['Side', 'جانبية'],
    ['Surprised', 'متفاجئة'], ['Close', 'مغمضة'], ['EyeRoll', 'تدوير'], ['Hearts', 'قلوب'], ['Dizzy', 'دائخة'], ['Cry', 'باكية']],
  eyebrow: [['Default', 'عادية'], ['DefaultNatural', 'طبيعية'], ['FlatNatural', 'مستقيمة'], ['RaisedExcited', 'مرفوعة'], ['RaisedExcitedNatural', 'مرفوعة طبيعية'],
    ['UpDown', 'واحدة مرفوعة'], ['UpDownNatural', 'واحدة مرفوعة طبيعية'], ['SadConcerned', 'قلقة'], ['SadConcernedNatural', 'قلقة طبيعية'],
    ['FrownNatural', 'عابسة'], ['Angry', 'غاضبة'], ['AngryNatural', 'غاضبة طبيعية'], ['UnibrowNatural', 'متصلة']],
  mouth: [['Smile', 'ابتسامة'], ['Default', 'عادي'], ['Twinkle', 'ابتسامة خفيفة'], ['Serious', 'جاد'], ['Tongue', 'لسان'], ['Eating', 'يأكل'],
    ['Concerned', 'قلق'], ['Disbelief', 'غير مصدق'], ['Grimace', 'تكشيرة'], ['Sad', 'حزين'], ['ScreamOpen', 'صراخ'], ['Vomit', 'غثيان']],
};

// Upstream bug (marked "XXX: some how the mask is broken" in avataaars): the hair-colour mask of
// ShortHairShaggy is mirrored around x = 0, so the colour never shows. Give it the hair's own transform.
base.groups.top.ShortHairShaggy = base.groups.top.ShortHairShaggy.replace(
  /(<mask id="\{\{id:mask1\}\}" fill="white"><use xlink:href="#\{\{id:path1\}\}") transform="scale\(-1, 1\)"/,
  '$1 transform="translate(143.465161, 67.234158) scale(-1, 1) translate(-143.465161, -67.234158)"');
if (!/translate\(143\.465161, 67\.234158\) scale\(-1, 1\) translate\(-143\.465161, -67\.234158\)" \/><\/mask>|translate\(143\.465161, 67\.234158\) scale\(-1, 1\) translate\(-143\.465161, -67\.234158\)"\/><\/mask>/.test(base.groups.top.ShortHairShaggy)) {
  console.warn('ShortHairShaggy fix did not apply');
}

function list(group) {
  const out = ORDER[group].map(([k, label]) => ({ k, label, svg: tidy(base.groups[group][k]) }));
  for (const c of custom.parts[group] || []) out.push({ k: c.k, label: c.label, svg: tidy(typeof c.svg === 'function' ? c.svg(base) : c.svg), ...(c.meta || {}) });
  return out;
}
const pal = (key, extra) => Object.values(base.colors[key]).concat(extra || []);

const data = {
  top: list('top'), accessories: list('accessories'), facialHair: list('facialHair'), clothes: list('clothes'),
  graphics: list('graphics'), eyes: list('eyes'), eyebrow: list('eyebrow'), mouth: list('mouth'),
  nose: tidy(base.groups.nose.Default),
  face: tidy(base.face),
  colors: {
    skin: pal('skin', custom.colors.skin), hair: pal('hair', custom.colors.hair), hat: pal('hat', custom.colors.hat),
    facialHair: pal('facialHair', custom.colors.facialHair), clothes: pal('clothes', custom.colors.clothes), bg: custom.colors.bg,
  },
  colorTemplate: tidy(base.colorTemplates.hair),
};
// Hat-coloured tops (their HatColor slot) and the default hat colour each one had in avataaars.
for (const t of data.top) {
  const m = t.svg.match(/\{\{slot:HatColor:\w+:(\w*)\}\}/);
  if (m) t.hatDefault = base.colors.hat[m[1]] ? Object.keys(base.colors.hat).indexOf(m[1]) : 4;
}

const tpl = fs.readFileSync(require('path').join(__dirname, 'runtime.js'), 'utf8');
const js = tpl.replace('/*__DATA__*/null', JSON.stringify(data));
fs.writeFileSync(OUT, js);
console.log('written', OUT, (js.length / 1024).toFixed(0) + ' KB',
  Object.fromEntries(['top', 'accessories', 'facialHair', 'clothes', 'graphics', 'eyes', 'eyebrow', 'mouth'].map(k => [k, data[k].length])),
  Object.fromEntries(Object.entries(data.colors).map(([k, v]) => [k, v.length])));
