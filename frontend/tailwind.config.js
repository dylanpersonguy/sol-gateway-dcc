/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        solana: '#9945ff',
        dcc: '#00d4aa',
      },
    },
  },
  plugins: [],
};
