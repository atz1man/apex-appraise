/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@apex/ui-tokens/tailwind-preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};
