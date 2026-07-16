/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Protect QuantumChat's design-system CSS from Tailwind Preflight resets
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          cyan: '#38bdf8',
          bg: '#07131f',
          surface: '#0d1b2a',
          text: '#f1f5f9',
          textMuted: '#94a3b8',
        },
      },
    },
  },
  plugins: [],
};
