import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { timing } from './motion';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors as c, fonts as f } from '../../theme';
import { CaptureIcon, ProfileIcon, TasksIcon, WalletIcon } from './Icons';
import { PressableScale } from './PressableScale';

const ICONS = { Tasks: TasksIcon, Wallet: WalletIcon, Profile: ProfileIcon } as const;
const tap = () => { if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {}); };

function TabItem({ name, focused, onPress }: { name: keyof typeof ICONS; focused: boolean; onPress(): void }) {
  const active = useSharedValue(focused ? 1 : 0);
  useEffect(() => { active.value = withTiming(focused ? 1 : 0, timing); }, [focused, active]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -1.5 * active.value }] }));
  const dot = useAnimatedStyle(() => ({ opacity: active.value }));
  const Icon = ICONS[name];
  return <PressableScale accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={name}
    onPress={onPress} style={s.item} scale={0.96}>
    <Animated.View style={lift}><Icon color={focused ? c.ink : c.slate300} width={focused ? 1.9 : 1.7} /></Animated.View>
    <Text style={[s.label, focused && { color: c.ink }]}>{name}</Text>
    <Animated.View style={[s.dot, dot]} />
  </PressableScale>;
}

export function TabBar({ state, navigation, onCapture }: BottomTabBarProps & { onCapture(): void }) {
  const insets = useSafeAreaInsets();
  return <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
    <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, s.glass]} />
    <View style={s.row}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        if (route.name === 'CaptureTab') return <PressableScale key={route.key} accessibilityRole="button" accessibilityLabel="Capture"
          onPress={() => { tap(); onCapture(); }} style={s.captureSlot} scale={0.96}>
          <View style={s.capture}><CaptureIcon color={c.ink} width={1.7} size={24} /></View>
          <Text style={[s.label, { color: c.ink }]}>Capture</Text>
        </PressableScale>;
        return <TabItem key={route.key} name={route.name as keyof typeof ICONS} focused={focused} onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) { tap(); navigation.navigate(route.name); }
        }} />;
      })}
    </View>
  </View>;
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
  glass: { backgroundColor: 'rgba(253,253,250,0.78)' },
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 8, paddingHorizontal: 8 },
  item: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  captureSlot: { flex: 1, alignItems: 'center', gap: 3 },
  capture: { alignItems: 'center', justifyContent: 'center', paddingTop: 4 },
  label: { fontFamily: f.medium, fontSize: 11, color: c.slate300 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.ink, marginTop: 1 },
});
