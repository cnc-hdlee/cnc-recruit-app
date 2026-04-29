/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0a23',
          deep: '#06061a',
          card: '#181838',
          line: '#23234a',
          hover: '#22224d',
        },
        accent: {
          purple: '#7c5cff',
          blue: '#4a8dff',
          green: '#3ad29f',
          yellow: '#ffd166',
          red: '#ff5c7a',
          pink: '#ff7ac6',
          cyan: '#5ad1e6',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans KR',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 8px 32px -8px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.05) inset',
        glow: '0 0 0 1px rgba(124,92,255,0.35), 0 8px 32px -6px rgba(124,92,255,0.4)',
        soft: '0 4px 16px -4px rgba(124,92,255,0.15)',
      },
      animation: {
        'fade-in': 'fadeIn 280ms ease-out',
        'slide-up': 'slideUp 260ms cubic-bezier(0.2, 0.6, 0.2, 1)',
        'breathe': 'breathe 4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.85', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
      },
    },
  },
  plugins: [],
};
