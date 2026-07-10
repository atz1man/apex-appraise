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
        canvas: '#F3F4F1',
        frame: '#E7E5DF',
        surface: '#FFFFFF',
        sunken: '#FBFCFB',
        'sunken-2': '#F0EFE9',
        'tint-success': '#ECF3EF',
        'tint-success-2': '#E4F1EA',
        'border-strong': '#E6E5DE',
        'border-std': '#ECEBE5',
        'border-faint': '#F0EFE9',
        ink: '#16201B',
        'ink-2': '#5F665F',
        'ink-2b': '#6E7269',
        'ink-3': '#9AA09A',
        'ink-3b': '#B6B5AD',
        inactive: '#8A908A',
        'status-amber': '#9A6212',
        'status-amber-bg': '#F8F0DE',
        'status-blue': '#2D5BA8',
        'status-blue-bg': '#E5EAF6',
        'status-red': '#B23A2E',
        'status-red-bg': '#F9EAE7',
        'status-green': '#1E7A55',
        'status-green-bg': '#E4F1EA',
        'status-purple': '#6B4E8A',
        'status-purple-bg': '#EDE6F4',
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
