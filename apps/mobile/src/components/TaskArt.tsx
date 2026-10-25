import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors as c, fonts as f } from '../../theme';

type Props = { style?: StyleProp<ViewStyle>; compact?: boolean; title?: string; object?: string; target?: string; distractors?: string[] };
const label = (value: string) => value.replace(/[_-]/g, ' ');

/** Actual frozen task props, with a neutral title treatment while extraction is pending. */
export function TaskArt({ style, compact, title, object, target, distractors = [] }: Props) {
  return <View accessibilityLabel={title} style={[s.art, style]}>
    <View style={[s.card, compact && s.compact]}>
      <Text numberOfLines={compact ? 2 : 3} style={[s.object, compact && s.small]}>{object ? label(object) : title ?? 'Task'}</Text>
      {!!target && <Text numberOfLines={2} style={s.target}>→ {label(target)}</Text>}
      {!compact && distractors.length > 0 && <Text style={s.note}>Distinguish from {distractors.map(label).join(', ')}</Text>}
    </View>
  </View>;
}
const s = StyleSheet.create({
  art: { backgroundColor: c.mist, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: c.haze, backgroundColor: c.paper, padding: 20, gap: 10, maxWidth: '100%' },
  compact: { padding: 6, borderRadius: 8, borderWidth: 0, backgroundColor: 'transparent' },
  object: { fontFamily: f.medium, fontSize: 25, color: c.ink },
  small: { fontSize: 13 },
  target: { fontFamily: f.regular, fontSize: 15, color: c.slate700 },
  note: { fontFamily: f.book, fontSize: 12, color: c.slate500 },
});
