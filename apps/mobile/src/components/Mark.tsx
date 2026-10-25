import { Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors as c, fonts as f } from '../../theme';

const CELLS = [[1, 0], [3, 0], [0, 1], [2, 1], [4, 1], [1, 2], [3, 2]] as const;
const JOINS = 'M58,100 C85.3,100 100,85.3 100,58 L142,58 L142,100 C114.7,100 100,114.7 100,142 L58,142Z M158,100 C185.3,100 200,114.7 200,142 L242,142 L242,100 C214.7,100 200,85.3 200,58 L158,58Z M58,200 C85.3,200 100,214.7 100,242 L142,242 L142,200 C114.7,200 100,185.3 100,158 L58,158Z M258,200 C285.3,200 300,214.7 300,242 L342,242 L342,200 C314.7,200 300,185.3 300,158 L258,158Z M358,200 C385.3,200 400,185.3 400,158 L442,158 L442,200 C414.7,200 400,214.7 400,242 L358,242Z M358,100 C385.3,100 400,114.7 400,142 L442,142 L442,100 C414.7,100 400,85.3 400,58 L358,58Z';

/** Seven joined rounded squares in a diagonal checkerboard. */
export function SkarlMark({ width = 28, color = c.ink }: { width?: number; color?: string }) {
  return <Svg viewBox="0 0 500 300" width={width} height={width * 0.6} fill={color}>
    {CELLS.map(([x, y]) => <Rect key={`${x}-${y}`} x={x * 100} y={y * 100} width="100" height="100" rx="36" />)}
    <Path d={JOINS} />
  </Svg>;
}

export function Wordmark({ size = 20, color = c.ink }: { size?: number; color?: string }) {
  return <View accessibilityLabel="Skarl" style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.22 }}>
    <SkarlMark width={size * 1.4} color={color} />
    <Text style={{ fontFamily: f.medium, fontSize: size, letterSpacing: -size * 0.03, color }}>Skarl</Text>
  </View>;
}
