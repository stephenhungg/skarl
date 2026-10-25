import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import { colors as c } from '../../theme';

/** Drawing of the live task's own props: a red cup, a blue cup and a marked coaster. */
export function TaskArt({ style, compact }: { style?: StyleProp<ViewStyle>; compact?: boolean }) {
  // Gradient ids must be unique per drawing; web shares one id namespace per page.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return <View style={[{ backgroundColor: c.mist, overflow: 'hidden' }, style]}>
    <Svg width="100%" height="100%" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <Pattern id={`dots${id}`} width="16" height="16" patternUnits="userSpaceOnUse">
          <Circle cx="2" cy="2" r="1" fill={c.haze} />
        </Pattern>
        <LinearGradient id={`red${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#d9473a" /><Stop offset="1" stopColor="#b8342a" />
        </LinearGradient>
        <LinearGradient id={`blue${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#4f79c9" /><Stop offset="1" stopColor="#3a5fa8" />
        </LinearGradient>
      </Defs>
      <Rect width="320" height="200" fill={`url(#dots${id})`} />
      <Ellipse cx="226" cy="150" rx="46" ry="13" fill={c.paper} stroke={c.slate300} strokeWidth="1.5" strokeDasharray="4 4" />
      <Ellipse cx="226" cy="150" rx="28" ry="7.5" fill={c.accent} opacity={0.9} />
      <Ellipse cx="112" cy="152" rx="30" ry="7" fill={c.ink} opacity={0.08} />
      <Path d="M86 74 L138 74 L131 150 Q112 156 93 150 Z" fill={`url(#red${id})`} />
      <Ellipse cx="112" cy="74" rx="26" ry="6.5" fill="#e8665a" />
      <Ellipse cx="112" cy="74" rx="21" ry="4.5" fill="#9e2b22" />
      <Ellipse cx="176" cy="160" rx="20" ry="5" fill={c.ink} opacity={0.07} />
      {!compact && <>
        <Path d="M160 104 L192 104 L188 158 Q176 162 164 158 Z" fill={`url(#blue${id})`} />
        <Ellipse cx="176" cy="104" rx="16" ry="4.2" fill="#6f93d6" />
        <Ellipse cx="176" cy="104" rx="12.5" ry="2.8" fill="#2c4b88" />
        <Path d="M124 56 C150 30 196 34 218 120" stroke={c.slate500} strokeWidth="1.6" fill="none" strokeDasharray="3 5" strokeLinecap="round" />
        <Path d="M212 110 L218 121 L225 111" stroke={c.slate500} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>}
    </Svg>
  </View>;
}
