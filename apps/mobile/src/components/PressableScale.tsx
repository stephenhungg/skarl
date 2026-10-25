import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { ease } from './motion';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const press = { duration: 160, easing: ease };
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children?: ReactNode; scale?: number };

/** Every tappable surface eases down slightly under the finger. */
export function PressableScale({ style, children, scale = 0.98, disabled, onPressIn, onPressOut, ...rest }: Props) {
  const pressed = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pressed.value }] }));
  return <AnimatedPressable {...rest} disabled={disabled}
    onPressIn={event => { pressed.value = withTiming(scale, press); onPressIn?.(event); }}
    onPressOut={event => { pressed.value = withTiming(1, press); onPressOut?.(event); }}
    style={[style, animated]}>{children}</AnimatedPressable>;
}
