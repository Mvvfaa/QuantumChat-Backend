/** Quantum Chat — Light Professional Theme */
import type { WebsiteBranding } from '@quantum-chat/shared';

export const theme = {
  colors: {
    navy950: '#F8FAFC',
    navy900: '#FFFFFF',
    navy800: '#F1F5F9',
    navy700: '#E2E8F0',
    navy600: '#CBD5E1',
    navy500: '#94A3B8',
    accent: '#3B82F6',
    accentLight: '#2563EB',
    accentDark: '#4F46E5',
    accentGlow: 'rgba(59, 130, 246, 0.2)',
    text: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#64748B',
    border: 'rgba(15, 23, 42, 0.08)',
    borderLight: 'rgba(15, 23, 42, 0.12)',
    success: '#16A34A',
    error: '#EF4444',
    bubbleOwn: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
    bubbleOther: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
    inputBg: '#FFFFFF',
  },
  shadow: {
    widget: '0 25px 50px -12px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(59, 130, 246, 0.08)',
    launcher: '0 8px 32px rgba(59, 130, 246, 0.25), 0 0 0 1px rgba(59, 130, 246, 0.12)',
    bubble: '0 2px 8px rgba(15, 23, 42, 0.06)',
  },
  radius: {
    widget: 20,
    bubble: 18,
    input: 14,
  },
} as const;

export interface ResolvedTheme {
  colors: {
    navy950: string;
    navy900: string;
    navy800: string;
    navy700: string;
    navy600: string;
    navy500: string;
    accent: string;
    accentLight: string;
    accentDark: string;
    accentGlow: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    borderLight: string;
    success: string;
    error: string;
    bubbleOwn: string;
    bubbleOther: string;
    inputBg: string;
  };
  shadow: {
    widget: string;
    launcher: string;
    bubble: string;
  };
  radius: {
    widget: number;
    bubble: number;
    input: number;
  };
}

export function resolveTheme(branding?: Partial<WebsiteBranding>): ResolvedTheme {
  const accent = branding?.accentColor || theme.colors.accent;
  const primary = branding?.primaryColor || '#6366F1';

  return {
    ...theme,
    colors: {
      ...theme.colors,
      accent,
      accentLight: accent,
      accentDark: primary,
      accentGlow: `${accent}33`,
      bubbleOwn: `linear-gradient(135deg, ${accent} 0%, ${primary} 100%)`,
      bubbleOther: theme.colors.bubbleOther,
    },
    shadow: {
      ...theme.shadow,
      launcher: `0 8px 32px ${accent}40, 0 0 0 1px ${accent}20`,
    },
  };
}
