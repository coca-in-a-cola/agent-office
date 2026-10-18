/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        office: {
          bg: '#0a0e17',
          panel: '#111827',
          card: '#1e293b',
          border: '#334155',
          muted: '#94a3b8',
        }
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'typing': 'typing 1.2s ease-in-out infinite alternate',
      },
      keyframes: {
        typing: {
          '0%': { transform: 'translateY(0px)' },
          '100%': { transform: 'translateY(-3px)' },
        }
      }
    },
  },
  plugins: [],
}
