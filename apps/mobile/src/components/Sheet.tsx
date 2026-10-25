import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { ease } from './motion';
import { colors as c } from '../../theme';

/** Bottom sheet: tap the dimmed area to dismiss. */
export function Sheet({ open, onClose, children, dark }: { open: boolean; onClose?: () => void; children: ReactNode; dark?: boolean }) {
  const insets = useSafeAreaInsets();
  return <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
    {open && <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View entering={SlideInDown.duration(340).easing(ease)} exiting={SlideOutDown.duration(200)}
        style={[s.sheet, dark && { backgroundColor: c.nightCard }, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
        <View style={[s.grabber, dark && { backgroundColor: c.nightLine }]} />
        {children}
      </Animated.View>
    </View>}
  </Modal>;
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, gap: 10 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.haze, marginBottom: 6 },
});
