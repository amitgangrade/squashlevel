/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // Boast — charcoal / court-floor primary. High-contrast on white,
        // clean black-text-on-white feel that pairs with the yellow accent.
        brand: {
          50:  '#f6f7f9',
          100: '#eceef2',
          200: '#d3d8e0',
          300: '#a5adba',
          400: '#6b7280',
          500: '#374151',
          600: '#1f2937',
          700: '#111827',
          800: '#0b1220',
          900: '#06090f',
        },
        // Accent: pro double-yellow-dot squash ball.
        // Used for the FAB, level highlights, "you" tags. Contrast-safe on black.
        accent: {
          50:  '#fffceb',
          100: '#fff8c5',
          200: '#ffef8a',
          300: '#ffe14d',
          400: '#fcd61f',
          500: '#f5e000', // canonical squash-ball yellow
          600: '#caa800',
          700: '#a07f00',
          800: '#7a5f00',
          900: '#5a4500',
        },
        // The tin: the red strip at the bottom of the front wall.
        // Used sparingly — destructive actions, "tin" badges, accent borders.
        tin: {
          50:  '#fdf3f3',
          100: '#fbe5e5',
          200: '#f5c2c2',
          300: '#ee9999',
          400: '#e36767',
          500: '#e03a3a',
          600: '#c4262a',
          700: '#9f1f23',
          800: '#7c191c',
          900: '#5b1316',
        },
      },
    },
  },
  plugins: [],
}
