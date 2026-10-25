import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { timing } from './motion';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors as c, fonts as f } from '../../theme';

/** A white thumb slides under the active label. */
export function Segmented<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange(next: T): void }) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.indexOf(value));
  const x = useSharedValue(0);
  const segment = width ? (width - 8) / options.length : 0;
  useEffect(() => { x.value = withTiming(index * segment, timing); }, [index, segment, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <View accessibilityRole="tablist" style={s.track} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {!!segment && <Animated.View style={[s.thumb, { width: segment }, thumb]} />}
    {options.map(option => <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected: option === value }}
      onPress={() => onChange(option)} style={s.option}>
      <Text style={[s.text, option === value && { color: c.ink }]}>{option}</Text>
    </Pressable>)}
  </View>;
}

const s = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: c.mist },
  thumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, shadowColor: c.ink, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  option: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: f.medium, fontSize: 14, color: c.slate500 },
});
