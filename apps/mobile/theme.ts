// Mirrors apps/web/app/globals.css. Keep native color/type decisions here.
export const colors = {
  paper: 'rgb(253,253,250)', mist: 'rgb(239,241,237)', haze: 'rgb(220,224,217)',
  fog: 'rgb(185,191,180)', slate300: 'rgb(150,158,143)', slate500: 'rgb(115,124,110)',
  slate700: 'rgb(80,90,76)', deep: 'rgb(24,36,20)', ink: 'rgb(16,18,14)',
  hazeMuted: 'rgba(220,224,217,0.4)', hazeSoft: 'rgba(220,224,217,0.6)',
  accent: 'rgb(199,241,142)', accentInk: 'rgb(22,32,12)',
  // App roles built from the palette above.
  card: '#ffffff', hairline: 'rgb(220,224,217)', positive: '#1c6a43', positiveSoft: 'rgba(28,106,67,0.1)',
  warn: '#8a5a12', warnSoft: 'rgba(196,140,40,0.14)', danger: '#9b2c22', dangerSoft: 'rgba(155,44,34,0.1)',
  scrim: 'rgba(16,18,14,0.38)',
  // Capture stays dark because it is a full-screen camera.
  night: '#0e0f0d', nightCard: '#1a1b19', nightLine: 'rgba(255,255,255,0.1)', nightMuted: 'rgba(255,255,255,0.6)',
} as const;
export const fonts = {
  book: 'MontrealBook', regular: 'MontrealRegular', medium: 'MontrealMedium', mono: 'Fono',
} as const;
export const radius = { card: 20, inner: 14, pill: 999, button: 16 } as const;
export const settle = [0.43, 0.42, 0.37, 0.97] as const;
export const gutter = 18;
export const spring = { damping: 18, stiffness: 220, mass: 0.7 } as const;
