/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,.06), 0 1px 4px rgba(15,23,42,.04)',
      },
      colors: {
        ink: '#0f172a',
        navy: '#142348',
        orange: '#f59e0b',
        page: '#f8fafc',
      },
    },
  },
  plugins: [],
}
