// Mirrors apps/web/app/globals.css. Keep native color/type decisions here.
export const colors = {
  paper: 'rgb(253,253,250)', mist: 'rgb(239,241,237)', haze: 'rgb(220,224,217)',
  fog: 'rgb(185,191,180)', slate300: 'rgb(150,158,143)', slate500: 'rgb(115,124,110)',
  slate700: 'rgb(80,90,76)', deep: 'rgb(24,36,20)', ink: 'rgb(16,18,14)',
  hazeMuted: 'rgba(220,224,217,0.4)', hazeSoft: 'rgba(220,224,217,0.6)',
  accent: 'rgb(199,241,142)', accentInk: 'rgb(22,32,12)',
} as const;
export const fonts = {
  book: 'MontrealBook', regular: 'MontrealRegular', medium: 'MontrealMedium', mono: 'Fono',
} as const;
export const settle = [0.43, 0.42, 0.37, 0.97] as const;
export const gutter = 18;
