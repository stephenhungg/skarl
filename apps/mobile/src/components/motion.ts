import { Platform } from 'react-native';
import { Easing, FadeIn, Keyframe } from 'react-native-reanimated';

// Calm motion: eased timing only, no springs or overshoot.
export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const timing = { duration: 300, easing: ease } as const;

/** Entrance: fade in while rising 8px. Web previews use a plain fade; Keyframe transforms misplace layout there. */
export const enter = (delay = 0, duration = 360) => Platform.OS === 'web'
  ? FadeIn.duration(duration).delay(delay)
  : new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 8 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: ease },
  }).duration(duration).delay(delay);
