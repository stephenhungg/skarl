import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Text, type StyleProp, type TextStyle } from 'react-native';
import { money } from '../api';

/**
 * Counts from the previous value to the exact atomic amount. The final frame
 * always renders the precise string, so no rounded value is left on screen.
 */
export function CountUp({ atomic, style, duration = 900 }: { atomic: bigint; style?: StyleProp<TextStyle>; duration?: number }) {
  const [text, setText] = useState(money(0n));
  const from = useRef(0n);
  useEffect(() => {
    let frame = 0, cancelled = false;
    const start = from.current, end = atomic;
    from.current = atomic;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then(reduced => {
      if (cancelled) return;
      if (reduced || start === end) { setText(money(end)); return; }
      const began = Date.now();
      const tick = () => {
        const p = Math.min(1, (Date.now() - began) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const current = start + BigInt(Math.round(Number(end - start) * eased));
        setText(p >= 1 ? money(end) : money(current / 10_000n * 10_000n));
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [atomic, duration]);
  return <Text accessibilityLabel={`${money(atomic)} test USDC`} style={style}>{text}</Text>;
}
