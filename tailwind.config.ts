import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0B0F1A',
        surface: '#131829',
        surfaceRaised: '#1B2237',
        accent: '#E8B54A',
        accentMuted: '#B98F3B',
        success: '#2DD4BF',
        danger: '#E5484D',
        ink: '#F5F3EC',
        inkMuted: '#8A93A6',
      },
      borderRadius: { ticket: '4px' },
    },
  },
  plugins: [],
};

export default config;
