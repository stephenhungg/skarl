/** Test orders carry "DEMO / TESTNET" prefixes and long dashes in their titles; show the part a person reads. */
export function orderTitle(title: string) {
  const clean = title.replace(/^\s*DEMO\s*\/\s*TESTNET\s*[—–-]\s*/i, "").replace(/\s+[—–]\s+/g, ": ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
