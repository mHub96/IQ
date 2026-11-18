// One stylesheet for every page, compiled ahead of time (`npm run css` in tools/).
// Same settings the pages used to pass to the in-browser Tailwind CDN.
module.exports = {
  content: ['../*.html', '../*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'sans-serif'],
        display: ['"Readex Pro"', '"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      colors: {
        // Sage neutrals (redesign v4): a faintly green-tinted gray scale that sits with the teal brand.
        slate: {
          50: '#F6F8F6',
          100: '#EEF2EF',
          200: '#DEE5E1',
          300: '#C5CFCA',
          400: '#98A49F',
          500: '#6E7B76',
          600: '#525E5A',
          700: '#3B4542',
          800: '#202927',
          900: '#141B1A',
          950: '#090D0D',
        },
        // Surgical teal: the site accent (redesign v4).
        teal: {
          50: '#ECF8F5',
          100: '#D0F0E8',
          200: '#A3E1D3',
          300: '#69CDB8',
          400: '#33B39C',
          500: '#13977F',
          600: '#0B7A6E',
          700: '#0A6259',
          800: '#0C4E48',
          900: '#0C403B',
          950: '#032623',
        },
        brand: {
          50: '#fff1f2',
          100: '#ffe4e6',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337',
        },
      },
    },
  },
};
