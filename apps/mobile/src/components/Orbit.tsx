import { useEffect, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { colors as c } from '../../theme';
import { ArrowUp, BadgeIcon, CaptureIcon, ImageIcon, WaveIcon } from './Icons';
import { SkarlMark } from './Mark';
import { PressableScale } from './PressableScale';

type Glyph = { Icon: ComponentType<{ size?: number; color?: string }>; angle: number };
const RINGS: { r: number; glyphs: Glyph[]; dir: 1 | -1 }[] = [
  { r: 74, glyphs: [], dir: 1 },
  { r: 104, glyphs: [{ Icon: CaptureIcon, angle: -40 }], dir: -1 },
  { r: 134, glyphs: [{ Icon: WaveIcon, angle: 150 }], dir: 1 },
  { r: 164, glyphs: [{ Icon: ImageIcon, angle: 30 }, { Icon: BadgeIcon, angle: 215 }], dir: -1 },
  { r: 194, glyphs: [{ Icon: Mark, angle: -100 }], dir: 1 },
  { r: 224, glyphs: [], dir: -1 },
];
function Mark({ size = 22, color = c.ink }: { size?: number; color?: string }) { return <SkarlMark width={size * 1.2} color={color} />; }

function Ring({ r, glyphs, dir, index, spin, enter }: (typeof RINGS)[number] & { index: number; spin: SharedValue<number>; enter: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, enter.value * 1.6 - index * 0.12));
    return {
      opacity: local,
      transform: [{ scale: interpolate(local, [0, 1], [0.92, 1]) }, { rotate: `${spin.value * dir * (1 - index * 0.08)}deg` }],
    };
  });
  const upright = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * dir * (1 - index * 0.08)}deg` }] }));
  return <Animated.View pointerEvents="none" style={[s.ring, { width: r * 2, height: r * 2, borderRadius: r, marginLeft: -r, marginTop: -r,
    borderColor: index === 0 ? c.fog : c.haze }, style]}>
    {glyphs.map(({ Icon, angle }) => {
      const rad = angle * Math.PI / 180;
      return <Animated.View key={angle} style={[s.glyph, { left: r + Math.cos(rad) * r - 20, top: r + Math.sin(rad) * r - 20 }, upright]}>
        <Icon size={20} color={c.slate300} />
      </Animated.View>;
    })}
  </Animated.View>;
}

/** Concentric hairline rings around a single upload button, drifting slowly. */
export function Orbit({ onPress, size }: { onPress(): void; size: number }) {
  const spin = useSharedValue(0);
  const enter = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
    spin.value = withRepeat(withTiming(360, { duration: 90_000, easing: Easing.linear }), -1, false);
    pulse.value = withDelay(1100, withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [enter, spin, pulse]);
  // Ambient breathe: rings dim and brighten slowly, nothing scales.
  const breathe = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [1, 0.55]) }));
  const button = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ scale: interpolate(enter.value, [0, 1], [0.92, 1]) }] }));
  const scale = Math.min(1, size / 460);
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
    <Animated.View style={[{ position: 'absolute', left: size / 2, top: size / 2, transform: [{ scale }] }, breathe]}>
      {RINGS.map((ring, index) => <Ring key={ring.r} {...ring} index={index} spin={spin} enter={enter} />)}
    </Animated.View>
    <Animated.View style={button}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Continue as demo contributor" onPress={onPress} style={s.button} scale={0.96}>
        <SkarlMark width={44} color={c.paper} />
      </PressableScale>
    </Animated.View>
  </View>;
}

const s = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 1 },
  glyph: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
  wave: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: c.slate300 },
  button: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center',
    shadowColor: c.ink, shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
});
