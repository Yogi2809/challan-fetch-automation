export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          blue:   '#4736FE',
          'blue-dark': '#3526EE',
          'blue-light': '#EEF0FF',
          mint:   '#63FFB1',
          orange: '#FF4F01',
        },
      },
      transitionProperty: {
        width: 'width',
      },
    },
  },
  plugins: [],
};
