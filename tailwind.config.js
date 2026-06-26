/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Microsoft YaHei"', '"PingFang SC"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
