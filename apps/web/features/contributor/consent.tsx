import { Check } from "lucide-react";
import { Card, CardTitle, Pill } from "./ui";

export const CONSENT_ITEMS = [
  { id: "self", text: "I'm the person in this clip, and nobody else can be seen or heard in it." },
  { id: "license", text: "I license this clip to the buyer for model training under the demo license (demo-consent-v1). The original stays in private storage." },
  { id: "testnet", text: "This is a testnet demo. Payment is test USDC on Base Sepolia, sent only after a person approves an accepted clip." },
] as const;

export type ConsentId = typeof CONSENT_ITEMS[number]["id"];

export function Consent({ value, onChange, locked }: { value: Record<ConsentId, boolean>; onChange: (next: Record<ConsentId, boolean>) => void; locked: boolean }) {
  const done = CONSENT_ITEMS.every(item => value[item.id]);
  return (
    <Card label="Consent">
      <CardTitle step="02" aside={done ? <Pill tone="neutral">AGREED</Pill> : <Pill tone="muted">REQUIRED</Pill>}>Consent</CardTitle>
      <p className="mt-2 text-[14px] leading-[1.35] text-slate-500">The camera stays off until all three are checked.</p>
      <fieldset className="mt-5 flex flex-col gap-1.5" disabled={locked}>
        <legend className="sr-only">Consent to record and license this clip</legend>
        {CONSENT_ITEMS.map(item => (
          <label key={item.id} className="group flex cursor-pointer items-start gap-3 rounded-[10px] bg-paper px-3 py-3 transition-colors duration-300 hover:bg-haze/50 has-[:disabled]:cursor-default has-[:disabled]:hover:bg-paper">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={value[item.id]}
              onChange={event => onChange({ ...value, [item.id]: event.target.checked })}
            />
            <span aria-hidden className="mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-haze text-transparent transition-colors duration-200 peer-checked:bg-slate-700 peer-checked:text-mist peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              <Check className="size-3" strokeWidth={2.5} />
            </span>
            <span className="text-[14px] leading-[1.35] text-ink">{item.text}</span>
          </label>
        ))}
      </fieldset>
      {locked && <p className="mt-3 text-[13px] leading-[1.35] text-slate-500">Consent is locked while this clip is being submitted.</p>}
    </Card>
  );
}
