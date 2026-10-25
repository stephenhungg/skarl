import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors as c } from '../../theme';

type Props = { size?: number; color?: string; width?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const });

export const TasksIcon = ({ size = 24, color = c.ink, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Rect x="4" y="4" width="16" height="16" rx="4.5" stroke={color} strokeWidth={width} />
  <Path d="M8.5 9.5h7M8.5 14.5h4.5" stroke={color} strokeWidth={width} strokeLinecap="round" />
</Svg>;

export const CaptureIcon = ({ size = 24, color = c.ink, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Path d="M3.5 8.5a2 2 0 0 1 2-2h1.6l1.4-2h7l1.4 2h1.6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z" stroke={color} strokeWidth={width} strokeLinejoin="round" />
  <Circle cx="12" cy="13" r="3.6" stroke={color} strokeWidth={width} />
</Svg>;

export const WalletIcon = ({ size = 24, color = c.ink, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Path d="M4 7.5a2.5 2.5 0 0 1 2.5-2.5h10a1.5 1.5 0 0 1 1.5 1.5V8" stroke={color} strokeWidth={width} strokeLinecap="round" />
  <Rect x="4" y="7.5" width="16" height="12" rx="3" stroke={color} strokeWidth={width} />
  <Path d="M15.5 13.5h1.5" stroke={color} strokeWidth={width + 0.6} strokeLinecap="round" />
</Svg>;

export const ProfileIcon = ({ size = 24, color = c.ink, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Circle cx="12" cy="8.5" r="3.8" stroke={color} strokeWidth={width} />
  <Path d="M4.8 19.5c1.2-3.3 4-5 7.2-5s6 1.7 7.2 5" stroke={color} strokeWidth={width} strokeLinecap="round" />
</Svg>;

export const ChevronRight = ({ size = 18, color = c.slate500, width = 1.8 }: Props) => <Svg {...base(size)}>
  <Path d="m9.5 6 6 6-6 6" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;

export const ChevronLeft = ({ size = 22, color = c.ink, width = 1.9 }: Props) => <Svg {...base(size)}>
  <Path d="m14.5 6-6 6 6 6" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;

export const CloseIcon = ({ size = 22, color = c.ink, width = 1.9 }: Props) => <Svg {...base(size)}>
  <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke={color} strokeWidth={width} strokeLinecap="round" />
</Svg>;

export const CheckIcon = ({ size = 14, color = c.accentInk, width = 2.4 }: Props) => <Svg {...base(size)}>
  <Path d="m5 12.5 4.5 4.5L19 7.5" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;

export const ArrowUp = ({ size = 28, color = c.paper, width = 2.2 }: Props) => <Svg {...base(size)}>
  <Path d="M12 19V5.5M6 11.5l6-6 6 6" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;

export const ArrowRight = ({ size = 16, color = c.ink, width = 1.9 }: Props) => <Svg {...base(size)}>
  <Path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;

export const ImageIcon = ({ size = 24, color = c.ink, width = 1.6 }: Props) => <Svg {...base(size)}>
  <Rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke={color} strokeWidth={width} />
  <Circle cx="9" cy="10" r="1.8" stroke={color} strokeWidth={width} />
  <Path d="m4 17 4.5-4 3.5 3 3-2.5 5 4" stroke={color} strokeWidth={width} strokeLinejoin="round" />
</Svg>;

export const WaveIcon = ({ size = 24, color = c.ink, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Path d="M4 10v4M8 7v10M12 4.5v15M16 8v8M20 10.5v3" stroke={color} strokeWidth={width} strokeLinecap="round" />
</Svg>;

export const BadgeIcon = ({ size = 24, color = c.ink, width = 1.6 }: Props) => <Svg {...base(size)}>
  <Path d="m12 3 2.3 1.7 2.9-.1.9 2.7 2.3 1.7-.9 2.7.9 2.7-2.3 1.7-.9 2.7-2.9-.1L12 21l-2.3-1.7-2.9.1-.9-2.7-2.3-1.7.9-2.7-.9-2.7 2.3-1.7.9-2.7 2.9.1L12 3Z" stroke={color} strokeWidth={width} strokeLinejoin="round" />
  <Path d="m9 12 2 2 4-4" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;

export const ClockIcon = ({ size = 16, color = c.slate500, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth={width} />
  <Path d="M12 8v4.5l3 1.8" stroke={color} strokeWidth={width} strokeLinecap="round" />
</Svg>;

export const SensorIcon = ({ size = 16, color = c.slate500, width = 1.7 }: Props) => <Svg {...base(size)}>
  <Rect x="7" y="3.5" width="10" height="17" rx="2.5" stroke={color} strokeWidth={width} />
  <Path d="M3.5 9v6M20.5 9v6" stroke={color} strokeWidth={width} strokeLinecap="round" />
</Svg>;

export const LinkIcon = ({ size = 14, color = c.slate500, width = 1.8 }: Props) => <Svg {...base(size)}>
  <Path d="M14 5h5v5M19 5l-8 8M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
</Svg>;
