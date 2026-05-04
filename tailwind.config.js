/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ───── C&C International brand palette (cnccosmetic.com) ─────
        // p1 = deepest indigo, p10 = lavender-white
        cc: {
          black: '#000000',
          p1:    '#0b001f', // deepest indigo (nav/header bg)
          p1_5:  '#130f29', // card on dark
          p2:    '#2a2640', // muted indigo
          p3:    '#49445f', // divider on dark
          p4:    '#5a5572',
          p5:    '#827a99',
          p6:    '#a49dbe',
          p7:    '#cac3e4', // soft lavender border
          p8:    '#dfd7f9',
          p9:    '#eee6ff', // input bg / hover
          p10:   '#f8f0ff', // page bg (lavender-white)
          pg1:   '#a4a1af',
          pg2:   '#575469',
          red:   '#f14654', // accent / error
        },
        // ───── App tokens (mapped to brand) ─────
        bg: {
          DEFAULT: '#f8f0ff',     // page background — lavender-white
          deep:    '#eee6ff',     // alt panel
          card:    '#ffffff',     // card surface
          line:    '#dfd7f9',     // divider — lavender-tint
          hover:   '#f8f0ff',     // row hover
        },
        accent: {
          purple: '#2a2640',  // brand deep violet
          violet: '#49445f',
          lilac:  '#cac3e4',
          blue:   '#3b3470',  // muted brand-aligned blue
          green:  '#059669',
          yellow: '#d97706',
          red:    '#f14654',  // brand red
          pink:   '#db2777',
          cyan:   '#0891b2',
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
        card: '0 1px 3px rgba(11,0,31,0.06), 0 1px 2px rgba(11,0,31,0.04)',
        glow: '0 0 0 1px rgba(73,68,95,0.18), 0 6px 20px -6px rgba(11,0,31,0.25)',
        soft: '0 6px 24px -8px rgba(11,0,31,0.12)',
        brand: '0 8px 32px -10px rgba(11,0,31,0.35)',
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
