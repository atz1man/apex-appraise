/** Tailwind preset generated from DESIGN_SYSTEM.md — colours, type, radius, shadow. */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          400: '#1E9E6A',
          500: '#1E7A55',
          600: '#1B6048',
          700: '#14503B',
          800: '#13402F',
          900: '#0F3528',
          950: '#0C2A20',
        },
        accent: {
          bright: '#3FD894',
          300: '#7FE3B4',
          'muted-1': '#5E9C80',
          'muted-2': '#7FB99E',
          'muted-3': '#AECBBC',
          'muted-4': '#BFE0CD',
        },
        // Semantic tokens resolve through CSS variables (RGB triplets defined in
        // apps/web/src/index.css — :root = light, .dark = dark). The fallbacks
        // keep the light values so nothing changes if the vars are absent.
        canvas: 'rgb(var(--canvas, 243 244 241) / <alpha-value>)',
        frame: 'rgb(var(--frame, 231 229 223) / <alpha-value>)',
        surface: 'rgb(var(--surface, 255 255 255) / <alpha-value>)',
        sunken: 'rgb(var(--sunken, 251 252 251) / <alpha-value>)',
        'sunken-2': 'rgb(var(--sunken-2, 240 239 233) / <alpha-value>)',
        'tint-success': 'rgb(var(--tint-success, 236 243 239) / <alpha-value>)',
        'tint-success-2': 'rgb(var(--tint-success-2, 228 241 234) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong, 230 229 222) / <alpha-value>)',
        'border-std': 'rgb(var(--border-std, 236 235 229) / <alpha-value>)',
        'border-faint': 'rgb(var(--border-faint, 240 239 233) / <alpha-value>)',
        ink: 'rgb(var(--ink, 22 32 27) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2, 95 102 95) / <alpha-value>)',
        'ink-2b': 'rgb(var(--ink-2b, 110 114 105) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3, 154 160 154) / <alpha-value>)',
        'ink-3b': 'rgb(var(--ink-3b, 182 181 173) / <alpha-value>)',
        inactive: 'rgb(var(--inactive, 138 144 138) / <alpha-value>)',
        'status-amber': 'rgb(var(--status-amber, 154 98 18) / <alpha-value>)',
        'status-amber-bg': 'rgb(var(--status-amber-bg, 248 240 222) / <alpha-value>)',
        'status-blue': 'rgb(var(--status-blue, 45 91 168) / <alpha-value>)',
        'status-blue-bg': 'rgb(var(--status-blue-bg, 229 234 246) / <alpha-value>)',
        'status-red': 'rgb(var(--status-red, 178 58 46) / <alpha-value>)',
        'status-red-bg': 'rgb(var(--status-red-bg, 249 234 231) / <alpha-value>)',
        'status-green': 'rgb(var(--status-green, 30 122 85) / <alpha-value>)',
        'status-green-bg': 'rgb(var(--status-green-bg, 228 241 234) / <alpha-value>)',
        'status-purple': 'rgb(var(--status-purple, 107 78 138) / <alpha-value>)',
        'status-purple-bg': 'rgb(var(--status-purple-bg, 237 230 244) / <alpha-value>)',
      },
      fontFamily: {
        ui: ["'Schibsted Grotesk'", 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        chip: '9px',
        input: '11px',
        card: '18px',
        panel: '22px',
        pill: '999px',
      },
      boxShadow: {
        // Apple-soft layered elevation: hairline definition + wide ambient falloff
        rest: '0 0 0 1px rgba(20,30,25,0.045), 0 1px 2px rgba(20,30,25,0.04), 0 12px 32px -16px rgba(20,30,25,0.14)',
        float: '0 0 0 1px rgba(20,30,25,0.05), 0 18px 44px -18px rgba(20,30,25,0.28)',
        drawer: '-24px 0 80px rgba(20,30,25,0.22)',
        'dark-card': '0 26px 60px -28px rgba(0,0,0,0.5)',
        pill: '0 1px 3px rgba(20,30,25,0.10), 0 1px 1px rgba(20,30,25,0.05)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        slideIn: {
          from: { transform: 'translateX(30px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '0.25' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        slideIn: 'slideIn 0.22s ease',
        pulseDot: 'pulseDot 1.2s ease-in-out infinite',
      },
    },
  },
};
