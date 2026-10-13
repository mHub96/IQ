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
