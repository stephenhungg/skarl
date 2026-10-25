import { formatUsdc, USDC_SCALE } from "@skarl/ledger";

const CENT = USDC_SCALE / 100n;

/** Ledger formatter, padded to at least two decimals for display ("7.5" reads as "7.50"). Pure string work, no floats. */
export function usdc(micro: bigint): string {
  const text = formatUsdc(micro);
  const dot = text.indexOf(".");
  if (dot === -1) return `${text}.00`;
  return text.length - dot - 1 < 2 ? `${text}0` : text;
}

/** A fraction of an amount, floored to whole cents, for count-up frames. `step` runs 0..steps. */
export function centsAt(micro: bigint, step: number, steps: number): bigint {
  if (step >= steps) return micro;
  const part = (micro * BigInt(step)) / BigInt(steps);
  return part - (part % CENT);
}

/** Prose form: whole amounts read as "100", fractional ones keep cents ("7.50"). */
export function usdcShort(micro: bigint): string {
  return micro % USDC_SCALE === 0n ? formatUsdc(micro) : usdc(micro);
}
