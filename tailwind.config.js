/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './ppt.html',
    './views/**/*.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
