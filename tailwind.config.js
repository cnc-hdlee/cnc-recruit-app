/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ───── Light theme — 흰 배경 + 노랑 강조 ─────
        bg: {
          DEFAULT: '#f3f4f6',     // page background (slate-100)
          deep: '#e5e7eb',        // subtle alt (slate-200) — 어두운 강조부
          card: '#ffffff',        // card surface
          line: '#e5e7eb',        // divider (gray-200)
          hover: '#f9fafb',       // row hover (gray-50)
        },
        accent: {
          // 그래픽 강조 톤 — 라이트 톤에 맞춰 충분한 채도
          purple: '#6366f1',  // indigo-500
          blue:   '#2563eb',  // blue-600
          green:  '#059669',  // emerald-600
          yellow: '#d97706',  // amber-600 (강조용)
          red:    '#dc2626',  // red-600
          pink:   '#db2777',  // pink-600
          cyan:   '#0891b2',  // cyan-600
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
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        glow: '0 0 0 1px rgba(99,102,241,0.25), 0 4px 16px -4px rgba(99,102,241,0.25)',
        soft: '0 4px 16px -4px rgba(0,0,0,0.08)',
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
