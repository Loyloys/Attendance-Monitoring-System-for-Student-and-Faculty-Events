/** @type {import('tailwindcss').Config} */
export default {
  content: [
  "./index.html",
  "./src/**/*.{js,ts,jsx,tsx}",
],
  // AD004: the theme toggle flips the `dark` class on <html>, so dark: variants
  // follow the class strategy rather than the OS preference alone.
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
}

