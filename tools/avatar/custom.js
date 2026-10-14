// Parts and colours added to the Avataaars set for this site, drawn in the same style:
// flat fills, black/white overlays at low opacity for shading, the 264 x 280 canvas (head centre x 132,
// skull top y 36, eyes at (106,112) / (158,112), face group at (76,82), clothes group at (0,170)).
// A part's svg may be a function of the converted base data (to reuse an original shape).

// ---------- shared pieces ----------
const topWrap = inner => `<g stroke-width="1" fill-rule="evenodd"><defs><rect id="{{id:frame}}" x="0" y="0" width="264" height="280"/></defs>`
  + `<mask id="{{id:fm}}" fill="white"><use xlink:href="#{{id:frame}}"/></mask><g mask="url(#{{id:fm}})"><g transform="translate(-1, 0)">`
  + `{{slot:FacialHair:}}${inner}{{children}}</g></g></g>`;

// Short sideburns under caps (hair colour).
const sideburns = `<defs><path id="{{id:sb}}" d="M77,82 C77,88 77.5,96 78.5,103 L82,103 C81.5,96 81.4,90 82,84 Z M188,82 C188,88 187.5,96 186.5,103 L183,103 C183.5,96 183.6,90 183,84 Z"/></defs>`
  + `<mask id="{{id:sbm}}" fill="white"><use xlink:href="#{{id:sb}}"/></mask><use fill="#2C1B18" xlink:href="#{{id:sb}}"/>{{slot:HairColor:sbm:}}`;

// Scrub top body (clothes-local coordinates): deep V neck.
const SCRUB = 'M171.3,29.9 C205.7,35.4 232,65.1 232,101.1 L232,110 L32,110 L32,101.1 C32,65.1 58.3,35.4 92.7,29.9 C94.2,36.4 97.6,41.6 101.6,45.9 L132,80 L162.4,45.9 C166.4,41.6 169.8,36.4 171.3,29.9 Z';
const scrubs = extra => `<g transform="translate(0, 170)"><defs><path id="{{id:p1}}" d="${SCRUB}"/></defs>`
  + `<mask id="{{id:mask1}}" fill="white"><use xlink:href="#{{id:p1}}"/></mask><use fill="#E6E6E6" fill-rule="evenodd" xlink:href="#{{id:p1}}"/>{{slot:Colors:mask1:}}`
  // side shading and the darker V-neck binding
  + `<path d="M32,101.1 C32,79 40.6,59.2 54.5,45.7 C50,64 50.5,86 56,110 L32,110 Z M232,101.1 C232,79 223.4,59.2 209.5,45.7 C214,64 213.5,86 208,110 L232,110 Z" fill="#000" fill-opacity="0.08"/>`
  + `<path d="M92.7,29.9 C94.2,36.4 97.6,41.6 101.6,45.9 L132,80 L162.4,45.9 C166.4,41.6 169.8,36.4 171.3,29.9 L177,31 C175.5,38.9 172,45 167.3,50.1 L132,89.5 L96.7,50.1 C92,45 88.5,38.9 87,31 Z" fill="#000" fill-opacity="0.16"/>`
  // chest pocket with a pen
  + `<path d="M156,70 L182,70 L182,90 C182,92.8 179.8,95 177,95 L161,95 C158.2,95 156,92.8 156,90 Z" fill="#000" fill-opacity="0.1"/>`
  + `<path d="M156,70 L182,70" stroke="#000" stroke-opacity="0.16" stroke-width="2"/>`
  + `<rect x="173" y="60" width="4.5" height="16" rx="2.25" fill="#F3F3F3"/><rect x="173" y="60" width="4.5" height="5" rx="2" fill="#25557C"/>`
  + (extra || '') + `</g>`;

// White coat over a coloured shirt (BlazerShirt geometry; the shirt takes the clothes colour).
const coat = extra => `<g transform="translate(0, 170)"><defs><path id="{{id:p1}}" d="M134,0.3 C170.9,3.3 200,34.3 200,72.1 L200,81 L0,81 L0,72.1 C0,34 29.6,2.8 67,0.2 C67,0.6 67,1 67,1.3 C67,13.2 82,22.8 100.5,22.8 C119,22.8 134,13.2 134,1.3 C134,1 134,0.6 134,0.3 Z"/></defs>`
  + `<g transform="translate(32, 29)"><mask id="{{id:mask1}}" fill="white"><use xlink:href="#{{id:p1}}"/></mask><use fill="#E6E6E6" xlink:href="#{{id:p1}}"/>`
  + `{{slot:Colors:mask1:}}`
  + `<g opacity="0.6" mask="url(#{{id:mask1}})" fill-opacity="0.2" fill="#000"><g transform="translate(60, -25)"><ellipse cx="40.5" cy="27.8" rx="39.6" ry="26.9"/></g></g></g>`
  // coat panels
  + `<g transform="translate(32, 28)"><path d="M68.8,1.1 C30.5,2.8 0,34.4 0,73.1 L0,82 L69.4,82 C66,69.9 64,55.7 64,40.5 C64,26.2 65.7,12.7 68.8,1.1 Z M131.6,82 L200,82 L200,73.1 C200,34.7 170,3.4 132.2,1.2 C135.3,12.8 137,26.2 137,40.5 C137,55.7 135,69.9 131.6,82 Z" fill="#F4F6F8"/>`
  + `<path d="M0,73.1 C0,48 12.6,26 31.8,13 C24,30 22,54 26,82 L0,82 Z M200,73.1 C200,48 187.4,26 168.2,13 C176,30 178,54 174,82 L200,82 Z" fill="#000" fill-opacity="0.06"/>`
  // lapels
  + `<path d="M69,0 C65,19.3 66.7,46.7 74,82 L58,82 L44,46 L50,37 L44,31 L63,1 C65,0.4 67,0 69,0 Z" fill="#DCE2E7"/>`
  + `<path d="M151,0 C147,19.3 148.7,46.7 156,82 L140,82 L126,46 L132,37 L126,31 L145,1 C147,0.4 149,0 151,0 Z" fill="#DCE2E7" transform="translate(141, 41) scale(-1, 1) translate(-141, -41)"/>`
  // breast pocket, pen and a name badge
  + `<path d="M150,52 L172,52 L172,66 C172,68 170.6,69.5 168.5,69.5 L153.5,69.5 C151.4,69.5 150,68 150,66 Z" fill="#000" fill-opacity="0.07"/>`
  + `<rect x="164" y="44" width="4" height="14" rx="2" fill="#25557C"/>`
  + `<rect x="26" y="48" width="24" height="12" rx="2.5" fill="#5199E4"/><rect x="30" y="52" width="16" height="2" rx="1" fill="#fff" fill-opacity="0.85"/><rect x="30" y="55.5" width="10" height="1.6" rx=".8" fill="#fff" fill-opacity="0.6"/>`
  + `</g>${extra || ''}</g>`;

// Stethoscope around the neck (clothes-local coordinates).
const stethoscope = `<path d="M98,31 C94,46 94,60 101,73" stroke="#2F3B45" stroke-width="4.5" fill="none" stroke-linecap="round"/>`
  + `<path d="M166,31 C170,46 170,58 164,69" stroke="#2F3B45" stroke-width="4.5" fill="none" stroke-linecap="round"/>`
  + `<path d="M164,69 L159,79 M164,69 L169,79" stroke="#2F3B45" stroke-width="3" fill="none" stroke-linecap="round"/>`
  + `<circle cx="159" cy="80.5" r="2.6" fill="#C9D1D6"/><circle cx="169" cy="80.5" r="2.6" fill="#C9D1D6"/>`
  + `<circle cx="103.5" cy="80" r="8" fill="#B8C2C9"/><circle cx="103.5" cy="80" r="5" fill="#E3E8EB"/><circle cx="103.5" cy="80" r="2" fill="#8E9AA3"/>`;

// Rounded "plus" for the medical graphic.
const graphic = inner => `<g mask="url(#{{mask}})" fill-rule="evenodd">${inner}</g>`;

module.exports = {
  colors: {
    skin: ['#F1C27D', '#C68642', '#8D5524'],
    hair: ['#1B1B1B', '#5A3825', '#8A5A3B', '#B8B8B8'],
    hat: ['#1F3A5F', '#2E7D7A', '#6CA0DC', '#722F37', '#E9E2D0', '#3E4A3D'],
    facialHair: ['#5A3825', '#B8B8B8'],
    clothes: ['#2E7D7A', '#6CA0DC', '#1F3A5F', '#722F37', '#3E5E4E', '#8E7CC3'],
    bg: ['#65C9FF', '#5199E4', '#B1E2FF', '#A7FFC4', '#FFDEB5', '#FFAFB9', '#FFFFB1', '#E6E6E6', '#C9B8FF', '#9AD6C4', '#F6C28B', '#25557C', '#3C4F5C', '#FF8A80'],
  },
  parts: {
    top: [
      {
        k: 'ShortHairBuzz', label: 'قصير جداً', svg: topWrap(
          `<defs><path id="{{id:h}}" d="M75.5,93 C73.5,61 98,35 132,35 C166,35 190.5,61 188.5,93 C186.5,85 183,79 178.5,74.5 C170.5,66.5 160.5,63 150.5,62.5 C143,62 138,63.5 132,63.5 C126,63.5 121,62 113.5,62.5 C103.5,63 93.5,66.5 85.5,74.5 C81,79 77.5,85 75.5,93 Z"/></defs>`
          + `<mask id="{{id:hm}}" fill="white"><use xlink:href="#{{id:h}}"/></mask><use fill="#2C1B18" xlink:href="#{{id:h}}"/>{{slot:HairColor:hm:}}`
          + `<path d="M75.5,93 C73.5,61 98,35 132,35 C166,35 190.5,61 188.5,93 C186.5,85 183,79 178.5,74.5 C170.5,66.5 160.5,63 150.5,62.5 C143,62 138,63.5 132,63.5 C126,63.5 121,62 113.5,62.5 C103.5,63 93.5,66.5 85.5,74.5 C81,79 77.5,85 75.5,93 Z" fill="#fff" fill-opacity="0.12"/>`
          + `<path d="M85.5,74.5 C93.5,66.5 103.5,63 113.5,62.5 C121,62 126,63.5 132,63.5 C138,63.5 143,62 150.5,62.5 C160.5,63 170.5,66.5 178.5,74.5 L178,78 C170,70.5 160,67 150.5,66.5 C143,66 138,67.5 132,67.5 C126,67.5 121,66 113.5,66.5 C104,67 94,70.5 86,78 Z" fill="#000" fill-opacity="0.16"/>`),
      },
      {
        k: 'ShortHairSlick', label: 'مسرّح للخلف', svg: topWrap(
          `<defs><path id="{{id:h}}" d="M74,96 C70,63 84,34 112,25 C126,20.5 146,20.5 161,27 C183,37 195,62 190.5,96 C187,82 181,71.5 171,65 C161,58.5 150,56 139.5,56.5 C129,57 117,59 107,63.5 C93,70 81.5,80 74,96 Z"/></defs>`
          + `<mask id="{{id:hm}}" fill="white"><use xlink:href="#{{id:h}}"/></mask><use fill="#2C1B18" xlink:href="#{{id:h}}"/>{{slot:HairColor:hm:}}`
          + `<path d="M107,63.5 C117,59 129,57 139.5,56.5 C150,56 161,58.5 171,65 C181,71.5 187,82 190.5,96 C188,88 183,80 176,74.5 C167,67.5 156,63.5 145,63 C132,62.5 119,64.5 107,63.5 Z" fill="#000" fill-opacity="0.18"/>`
          + `<path d="M98,40 C116,28 146,26 170,40" stroke="#fff" stroke-opacity="0.22" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
          + `<path d="M92,52 C112,40 142,38 164,48" stroke="#fff" stroke-opacity="0.14" stroke-width="3" fill="none" stroke-linecap="round"/>`
          + `<path d="M120,26 C113,40 109,52 108,62" stroke="#000" stroke-opacity="0.16" stroke-width="2.5" fill="none" stroke-linecap="round"/>`),
      },
      {
        k: 'SurgicalCap', label: 'غطاء العمليات', meta: { both: true }, svg: topWrap(
          `<defs><path id="{{id:cap}}" d="M71.5,99 C69,56 97,28 132,28 C167,28 195,56 192.5,99 C186.5,86 176.5,77 163,73 C152,70 142,70 132,70 C122,70 112,70 101,73 C87.5,77 77.5,86 71.5,99 Z"/></defs>`
          + `<mask id="{{id:cm}}" fill="white"><use xlink:href="#{{id:cap}}"/></mask><use fill="#5199E4" xlink:href="#{{id:cap}}"/>{{slot:HatColor:cm:}}`
          // dots print, seam and the darker turned-up band
          + `<g mask="url(#{{id:cm}})" fill="#fff" fill-opacity="0.22"><circle cx="104" cy="44" r="2.4"/><circle cx="122" cy="38" r="2.4"/><circle cx="142" cy="38" r="2.4"/><circle cx="160" cy="44" r="2.4"/><circle cx="92" cy="58" r="2.4"/><circle cx="112" cy="54" r="2.4"/><circle cx="132" cy="52" r="2.4"/><circle cx="152" cy="54" r="2.4"/><circle cx="172" cy="58" r="2.4"/><circle cx="84" cy="74" r="2.4"/><circle cx="180" cy="74" r="2.4"/></g>`
          + `<path d="M132,29 C131,42 131,56 132,70" stroke="#000" stroke-opacity="0.12" stroke-width="2" fill="none"/>`
          + `<path d="M71.5,99 C77.5,86 87.5,77 101,73 C112,70 122,70 132,70 C142,70 152,70 163,73 C176.5,77 186.5,86 192.5,99 L192,90.5 C185.5,80 175.5,72 163,68.5 C152,65.5 142,65.5 132,65.5 C122,65.5 112,65.5 101,68.5 C88.5,72 78.5,80 72,90.5 Z" fill="#000" fill-opacity="0.2"/>`
          + `<path d="M72.5,62 C88,38 108,29 132,29" stroke="#fff" stroke-opacity="0.18" stroke-width="3" fill="none" stroke-linecap="round"/>`),
      },
      {
        k: 'Kufi', label: 'طاقية', svg: topWrap(
          `<defs><path id="{{id:k}}" d="M82,64 C85,41 106,29 132,29 C158,29 179,41 182,64 C166,58 150,55.5 132,55.5 C114,55.5 98,58 82,64 Z"/></defs>`
          + `<mask id="{{id:km}}" fill="white"><use xlink:href="#{{id:k}}"/></mask><use fill="#FFFFFF" xlink:href="#{{id:k}}"/>{{slot:HatColor:km:}}`
          + `<g mask="url(#{{id:km}})" fill="#000" fill-opacity="0.09"><path d="M80,58 C98,51 114,49 132,49 C150,49 166,51 184,58 L184,61 C166,54 150,52 132,52 C114,52 98,54 80,61 Z"/><path d="M84,47 C100,41 116,39.5 132,39.5 C148,39.5 164,41 180,47 L180,49.5 C164,44 148,42.5 132,42.5 C116,42.5 100,44 84,49.5 Z"/></g>`
          + `<g mask="url(#{{id:km}})" fill="#000" fill-opacity="0.1"><circle cx="104" cy="45" r="1.6"/><circle cx="118" cy="44" r="1.6"/><circle cx="132" cy="43.5" r="1.6"/><circle cx="146" cy="44" r="1.6"/><circle cx="160" cy="45" r="1.6"/></g>`
          + `<path d="M82,64 C98,58 114,55.5 132,55.5 C150,55.5 166,58 182,64 L181.5,67.5 C166,62 150,59.5 132,59.5 C114,59.5 98,62 82.5,67.5 Z" fill="#000" fill-opacity="0.14"/>`
          + `<path d="M98,38 C108,32.5 120,30.5 132,30.5" stroke="#fff" stroke-opacity="0.5" stroke-width="2.5" fill="none" stroke-linecap="round"/>`),
      },
    ],
    accessories: [
      {
        k: 'SurgicalMask', label: 'كمامة طبية', svg:
          `<g fill-rule="evenodd"><path d="M93.5,124 L78,112.5 M93,142 L77.5,127" stroke="#E8F2F8" stroke-width="2.4" stroke-linecap="round" fill="none"/>`
          + `<path d="M170.5,124 L186,112.5 M171,142 L186.5,127" stroke="#E8F2F8" stroke-width="2.4" stroke-linecap="round" fill="none"/>`
          + `<path d="M93,123.5 C110,117.5 154,117.5 171,123.5 L172.5,142 C165,157.5 149,165 132,165 C115,165 99,157.5 91.5,142 Z" fill="#A9D6EE"/>`
          + `<path d="M93,123.5 C110,117.5 154,117.5 171,123.5 L171.3,128 C154,122.5 110,122.5 92.7,128 Z" fill="#fff" fill-opacity="0.45"/>`
          + `<path d="M93.5,134 C112,129 152,129 170.5,134 M93,144 C112,139.5 152,139.5 171,144 M98,153.5 C114,150 150,150 166,153.5" stroke="#000" stroke-opacity="0.1" stroke-width="2" fill="none"/>`
          + `<path d="M91.5,142 C99,157.5 115,165 132,165 C149,165 165,157.5 172.5,142 L172.5,147 C164,160 148.5,167 132,167 C115.5,167 100,160 91.5,147 Z" fill="#000" fill-opacity="0.1"/></g>`,
      },
      {
        k: 'Aviators', label: 'نظارة طيار', svg:
          `<g fill-rule="evenodd"><path d="M85,104 C85,98.5 93,97.5 106,97.5 C121,97.5 127.5,99.5 127,105.5 C126,118 118.5,126.5 106.5,126.5 C94.5,126.5 85.5,118 85,104 Z M179,104 C179,98.5 171,97.5 158,97.5 C143,97.5 136.5,99.5 137,105.5 C138,118 145.5,126.5 157.5,126.5 C169.5,126.5 178.5,118 179,104 Z" fill="#2B3A42" fill-opacity="0.82"/>`
          + `<path d="M91,103 C93,100.5 100,100 106,100.3 M143,103 C145,100.5 152,100 158,100.3" stroke="#fff" stroke-opacity="0.5" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
          + `<path d="M85,104 C85,98.5 93,97.5 106,97.5 C121,97.5 127.5,99.5 127,105.5 C126,118 118.5,126.5 106.5,126.5 C94.5,126.5 85.5,118 85,104 Z M179,104 C179,98.5 171,97.5 158,97.5 C143,97.5 136.5,99.5 137,105.5 C138,118 145.5,126.5 157.5,126.5 C169.5,126.5 178.5,118 179,104 Z" stroke="#C9A227" stroke-width="2.2" fill="none"/>`
          + `<path d="M127,102.5 C130,99.5 134,99.5 137,102.5 M126.5,98.8 C130,97 134,97 137.5,98.8" stroke="#C9A227" stroke-width="2" fill="none" stroke-linecap="round"/>`
          + `<path d="M85,102.5 L75,103.5 M179,102.5 L189,103.5" stroke="#C9A227" stroke-width="2.2" stroke-linecap="round"/></g>`,
      },
      {
        k: 'HalfRim', label: 'نظارة قراءة', svg:
          `<g fill="none" stroke-linecap="round"><path d="M86.5,110.5 C86.5,122.5 95.5,128 106,128 C117.5,128 126,122 126,110.5 M138,110.5 C138,122 146.5,128 158,128 C168.5,128 177.5,122.5 177.5,110.5" stroke="#252C2F" stroke-width="3.6"/>`
          + `<path d="M86.5,110.5 C90,106.5 100,105.5 106,105.5 C114,105.5 122,106.5 126,110.5 M138,110.5 C142,106.5 150,105.5 158,105.5 C164,105.5 174,106.5 177.5,110.5" stroke="#252C2F" stroke-opacity="0.35" stroke-width="1.4"/>`
          + `<path d="M126,110 C129.5,107 134.5,107 138,110" stroke="#252C2F" stroke-width="3"/>`
          + `<path d="M86.5,109.5 L76,107.5 M177.5,109.5 L188,107.5" stroke="#252C2F" stroke-width="3"/></g>`,
      },
    ],
    facialHair: [
      {
        k: 'Stubble', label: 'لحية خفيفة جداً', svg: base => base.groups.facialHair.BeardLight.replace('<g transform="translate(49.000000, 72.000000)">', '<g transform="translate(49.000000, 72.000000)" opacity="0.42">'),
      },
      {
        k: 'Goatee', label: 'سكسوكة', svg:
          `<g transform="translate(49, 72)"><defs><path id="{{id:g}}" d="M84,71 C82.4,72.6 80,73.1 77.5,73.2 C73.5,73.4 68.5,72.6 65.5,75.5 C62.8,78.2 61.5,82 62,85 C64.5,81.2 68,79.2 72.5,78.8 C76.5,78.4 81,79.2 84,77.6 C87,79.2 91.5,78.4 95.5,78.8 C100,79.2 103.5,81.2 106,85 C106.5,82 105.2,78.2 102.5,75.5 C99.5,72.6 94.5,73.4 90.5,73.2 C88,73.1 85.6,72.6 84,71 Z M72,99 C73.5,106 77.5,113.5 84,114.5 C90.5,113.5 94.5,106 96,99 C92.5,101.5 88.5,102.6 84,102.6 C79.5,102.6 75.5,101.5 72,99 Z"/></defs>`
          + `<mask id="{{id:gm}}" fill="white"><use xlink:href="#{{id:g}}"/></mask><use fill="#331B0C" xlink:href="#{{id:g}}"/>{{slot:Colors:gm:}}</g>`,
      },
    ],
    clothes: [
      { k: 'Scrubs', label: 'زي العمليات (سكراب)', svg: scrubs() },
      { k: 'ScrubsStethoscope', label: 'سكراب وسماعة', svg: scrubs(stethoscope) },
      { k: 'WhiteCoat', label: 'صدرية بيضاء', svg: coat() },
      { k: 'WhiteCoatStethoscope', label: 'صدرية وسماعة', svg: coat(stethoscope) },
    ],
    graphics: [
      { k: 'Ecg', label: 'تخطيط القلب', svg: graphic(`<path d="M80,70 L104,70 L110,55 L118.5,86 L127,60 L133,70 L184,70" stroke="#FFFFFF" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`) },
      { k: 'Heart', label: 'قلب', svg: graphic(`<path d="M132,90 C119,80 108,72.5 108,61 C108,53.5 114,48.5 120.5,48.5 C125.5,48.5 129.5,51.3 132,55.5 C134.5,51.3 138.5,48.5 143.5,48.5 C150,48.5 156,53.5 156,61 C156,72.5 145,80 132,90 Z" fill="#FFFFFF"/>`) },
      { k: 'MedicalCross', label: 'صليب طبي', svg: graphic(`<circle cx="132" cy="70" r="23" stroke="#FFFFFF" stroke-width="3.5" fill="none"/><path d="M127,54 L137,54 C138.1,54 139,54.9 139,56 L139,63 L146,63 C147.1,63 148,63.9 148,65 L148,75 C148,76.1 147.1,77 146,77 L139,77 L139,84 C139,85.1 138.1,86 137,86 L127,86 C125.9,86 125,85.1 125,84 L125,77 L118,77 C116.9,77 116,76.1 116,75 L116,65 C116,63.9 116.9,63 118,63 L125,63 L125,56 C125,54.9 125.9,54 127,54 Z" fill="#FFFFFF"/>`) },
    ],
    eyes: [
      {
        k: 'Tired', label: 'متعبة (بعد الخفارة)', svg:
          `<g transform="translate(0, 8)"><path d="M24,22 A6,6 0 0 0 36,22 Z M76,22 A6,6 0 0 0 88,22 Z" fill="#000" fill-opacity="0.6"/>`
          + `<path d="M22.5,22 L37.5,22 M74.5,22 L89.5,22" stroke="#000" stroke-opacity="0.6" stroke-width="2.2" stroke-linecap="round"/>`
          + `<path d="M22,32 C25.5,36 34.5,36 38,32 M74,32 C77.5,36 86.5,36 90,32" stroke="#000" stroke-opacity="0.22" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`,
      },
    ],
  },
};
