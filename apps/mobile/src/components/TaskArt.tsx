import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import { colors as c } from '../../theme';

export type ArtKind = 'cup' | 'can';

/** Prefer the frozen task object; titles support deployments that predate task specs. */
export const artFor = (title?: string, object?: string): ArtKind => /\bcan\b/i.test((object ?? title ?? '').replace(/[_-]/g, ' ')) ? 'can' : 'cup';

/** Drawing of a task's own props: red and blue cups with a coaster, or a can moved toward the hat beside a lamp. */
export function TaskArt({ style, compact, kind = 'cup' }: { style?: StyleProp<ViewStyle>; compact?: boolean; kind?: ArtKind }) {
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
      {kind === 'can' ? <CanScene id={id} compact={compact} /> : <>
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
      </>}
    </Svg>
  </View>;
}

function CanScene({ id, compact }: { id: string; compact?: boolean }) {
  return <>
    <Defs>
      <LinearGradient id={`can${id}`} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor="#c9ced6" /><Stop offset="0.45" stopColor="#f1f3f6" /><Stop offset="1" stopColor="#9aa2ad" />
      </LinearGradient>
      <LinearGradient id={`shade${id}`} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#f4e6bf" /><Stop offset="1" stopColor="#e2cd92" />
      </LinearGradient>
    </Defs>
    {/* lamp */}
    <Path d="M248 46 L284 46 L294 84 L238 84 Z" fill={`url(#shade${id})`} />
    <Ellipse cx="266" cy="84" rx="28" ry="4" fill="#d3bc7d" />
    <Rect x="264.5" y="86" width="3" height="66" fill={c.slate500} />
    <Ellipse cx="266" cy="154" rx="20" ry="5" fill={c.slate700} />
    {/* hat beside the lamp, with its target zone */}
    <Ellipse cx="196" cy="157" rx="40" ry="11" fill={c.paper} stroke={c.slate300} strokeWidth="1.5" strokeDasharray="4 4" />
    <Ellipse cx="206" cy="152" rx="30" ry="7" fill="#3b3631" />
    <Path d="M190 152 L192 122 Q206 114 220 122 L222 152 Z" fill="#4a443d" />
    <Rect x="191" y="140" width="30" height="5" fill={c.accent} />
    {/* can */}
    <Ellipse cx="92" cy="154" rx="22" ry="5" fill={c.ink} opacity={0.08} />
    <Path d="M74 96 L110 96 L110 150 Q92 156 74 150 Z" fill={`url(#can${id})`} />
    <Rect x="74" y="114" width="36" height="18" fill="#c8453a" />
    <Ellipse cx="92" cy="96" rx="18" ry="5" fill="#dfe3e8" stroke="#9aa2ad" strokeWidth="1" />
    <Ellipse cx="96" cy="95.5" rx="4" ry="1.6" fill="#9aa2ad" />
    {!compact && <>
      <Path d="M104 82 C126 50 162 52 172 132" stroke={c.slate500} strokeWidth="1.6" fill="none" strokeDasharray="3 5" strokeLinecap="round" />
      <Path d="M165 122 L172 133 L178 122" stroke={c.slate500} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>}
  </>;
}
