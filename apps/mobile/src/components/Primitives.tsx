import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors as c, fonts as f, radius } from '../../theme';
import { PressableScale } from './PressableScale';
import { ChevronRight } from './Icons';
import { label } from '../data';

export function Card({ children, style, tone = 'card' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'card' | 'mist' }) {
  return <View style={[t.card, tone === 'mist' && { backgroundColor: c.mist }, style]}>{children}</View>;
}

type PillTone = 'muted' | 'accent' | 'ink' | 'positive' | 'warn' | 'danger' | 'night';
const pillTones: Record<PillTone, [string, string]> = {
  muted: [c.mist, c.slate700], accent: [c.accent, c.accentInk], ink: [c.ink, c.paper],
  positive: [c.positiveSoft, c.positive], warn: [c.warnSoft, c.warn], danger: [c.dangerSoft, c.danger],
  night: ['rgba(16,18,14,0.62)', c.paper],
};
export function Pill({ children, tone = 'muted', style, dot }: { children: ReactNode; tone?: PillTone; style?: StyleProp<ViewStyle>; dot?: boolean }) {
  const [bg, fg] = pillTones[tone];
  return <View style={[t.pill, { backgroundColor: bg }, style]}>
    {dot && <View style={[t.dot, { backgroundColor: fg }]} />}
    <Text style={[t.pillText, { color: fg }]}>{children}</Text>
  </View>;
}

export function statusTone(status: string): PillTone {
  if (status === 'accepted' || status === 'paid') return 'positive';
  if (status === 'needs_review' || status === 'needs_correction' || status === 'pending' || status === 'accrued' || status === 'payout_in_progress') return 'warn';
  if (status === 'rejected' || status === 'reversed') return 'danger';
  return 'muted';
}
export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)} dot>{label(status)}</Pill>;
}

export function Button({ title, onPress, disabled, kind = 'primary', loading, style, icon }: {
  title: string; onPress?: () => void; disabled?: boolean; kind?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'dark';
  loading?: boolean; style?: StyleProp<ViewStyle>; icon?: ReactNode;
}) {
  const bg = { primary: c.ink, secondary: c.card, accent: c.accent, ghost: 'transparent', dark: c.nightCard }[kind];
  const fg = { primary: c.paper, secondary: c.ink, accent: c.accentInk, ghost: c.ink, dark: c.paper }[kind];
  return <PressableScale accessibilityRole="button" accessibilityState={{ disabled: !!disabled, busy: !!loading }} disabled={disabled || loading} onPress={onPress}
    style={[t.button, { backgroundColor: bg }, kind === 'secondary' && t.outlined, disabled && (kind === 'dark' ? { opacity: 0.4 } : t.disabled), style]}>
    {loading ? <ActivityIndicator color={fg} /> : <>
      <Text style={[t.buttonText, { color: disabled && kind !== 'dark' ? c.slate500 : fg }]}>{title}</Text>{icon}</>}
  </PressableScale>;
}

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[t.h1, style]}>{children}</Text>;
}
export function Section({ title, aside }: { title: string; aside?: ReactNode }) {
  return <View style={t.section}><Text accessibilityRole="header" style={t.sectionTitle}>{title}</Text>{aside}</View>;
}
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[t.label, style]}>{children}</Text>;
}

export function ListRow({ title, detail, aside, onPress, leading }: {
  title: string; detail?: string; aside?: ReactNode; onPress?: () => void; leading?: ReactNode;
}) {
  const body = <>
    {leading}
    <View style={{ flex: 1, gap: 3 }}>
      <Text numberOfLines={1} style={t.rowTitle}>{title}</Text>
      {!!detail && <Text numberOfLines={2} style={t.rowDetail}>{detail}</Text>}
    </View>
    {aside}
    {onPress && <ChevronRight />}
  </>;
  return onPress ? <PressableScale accessibilityRole="button" onPress={onPress} style={t.row}>{body}</PressableScale>
    : <View style={t.row}>{body}</View>;
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return <View style={t.empty}>
    <Text style={t.emptyTitle}>{title}</Text>
    {!!body && <Text style={t.emptyBody}>{body}</Text>}
    {action}
  </View>;
}

export const t = StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, padding: 18 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: f.medium, fontSize: 12, lineHeight: 14 },
  button: { minHeight: 54, borderRadius: radius.pill, paddingHorizontal: 22, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  outlined: { borderWidth: 1, borderColor: c.hairline },
  disabled: { backgroundColor: c.mist, borderColor: c.mist },
  buttonText: { fontFamily: f.medium, fontSize: 16, lineHeight: 20, textAlign: 'center' },
  h1: { fontFamily: f.medium, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: c.ink },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionTitle: { fontFamily: f.medium, fontSize: 19, lineHeight: 24, letterSpacing: -0.2, color: c.ink },
  label: { fontFamily: f.mono, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, color: c.slate500, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: c.card,
    borderRadius: radius.inner + 4, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  rowTitle: { fontFamily: f.regular, fontSize: 15, lineHeight: 19, color: c.ink },
  rowDetail: { fontFamily: f.book, fontSize: 13, lineHeight: 17, color: c.slate500 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 30, paddingHorizontal: 24, borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, borderStyle: 'dashed', backgroundColor: c.paper },
  emptyTitle: { fontFamily: f.medium, fontSize: 16, lineHeight: 20, color: c.ink, textAlign: 'center' },
  emptyBody: { fontFamily: f.book, fontSize: 14, lineHeight: 19, color: c.slate500, textAlign: 'center' },
  body: { fontFamily: f.book, fontSize: 15, lineHeight: 21, color: c.slate500 },
  bodyInk: { fontFamily: f.book, fontSize: 15, lineHeight: 21, color: c.ink },
  meta: { fontFamily: f.mono, fontSize: 11, lineHeight: 16, color: c.slate500 },
});
