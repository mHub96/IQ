// One stylesheet for every page, compiled ahead of time (`npm run css` in tools/).
// Same settings the pages used to pass to the in-browser Tailwind CDN.
module.exports = {
  content: ['../*.html', '../*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'sans-serif'],
      },
      colors: {
        // Apple system grays in place of slate (the neutral scale).
        slate: {
          50: '#F9F9FB',
          100: '#F2F2F7',
          200: '#E5E5EA',
          300: '#D1D1D6',
          400: '#AEAEB2',
          500: '#8A8A8E',
          600: '#636366',
          700: '#48484A',
          800: '#2C2C2E',
          900: '#1C1C1E',
          950: '#000000',
        },
        // iOS system blue in place of teal (the site accent), light #007AFF / dark #0A84FF.
        teal: {
          50: '#EEF6FF',
          100: '#D9EBFF',
          200: '#B3D7FF',
          300: '#80BDFF',
          400: '#409CFF',
          500: '#0A84FF',
          600: '#007AFF',
          700: '#0062CC',
          800: '#004A99',
          900: '#003270',
          950: '#001F47',
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
