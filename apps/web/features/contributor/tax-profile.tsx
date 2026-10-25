"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/glaze/ui/button";
import { DEMO_IDENTITY } from "./api";

type TaxForm = "none" | "w9_on_file" | "w8ben_on_file";

export function TaxProfile() {
  const profile = useQuery(api.tax.myProfile, { demoIdentity: DEMO_IDENTITY });
  if (profile === undefined) return <p className="type-body-sm text-text-2">Loading tax profile…</p>;
  return <TaxProfileForm key={profile.updatedAt ?? "new"} country={profile.country ?? ""} taxForm={profile.taxForm} />;
}

function TaxProfileForm({ country: initialCountry, taxForm: initialForm }: { country: string; taxForm: TaxForm }) {
  const save = useMutation(api.tax.setProfile);
  const [country, setCountry] = useState(initialCountry);
  const [taxForm, setTaxForm] = useState<TaxForm>(initialForm);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await save({ demoIdentity: DEMO_IDENTITY, country: country.toUpperCase(), taxForm });
      setMessage("Profile saved with an audit record.");
    } catch { setMessage("Could not save. Check the two-letter country code and try again."); }
    finally { setBusy(false); }
  }
  return <section className="mb-6 rounded-xl border border-line-faint bg-shell p-5 md:p-6" aria-label="Tax profile">
    <div className="flex flex-wrap items-center gap-3"><h2 className="type-heading-sm">Tax-ready ledger</h2>
      <span className="rounded-tag bg-page px-2 py-1 type-caption text-text-2">Not tax advice — demo data</span></div>
    <p className="mt-2 type-body-sm text-text-2">Attest to a form already held outside Skarl. Only country and form status are stored. Do not enter tax IDs or upload forms. No tax is computed, withheld or filed.</p>
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 type-label-sm">Country (ISO-2)
        <input aria-label="Country (ISO-2)" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="US" value={country}
          onChange={event => setCountry(event.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off"
          className="w-28 rounded-tag border border-line-control bg-field px-3 py-2" /></label>
      <label className="flex flex-col gap-1 type-label-sm">Form-on-file attestation
        <select value={taxForm} onChange={event => setTaxForm(event.target.value as TaxForm)} className="rounded-tag border border-line-control bg-field px-3 py-2">
          <option value="none">No form on file</option><option value="w9_on_file">I attest W-9 is on file</option><option value="w8ben_on_file">I attest W-8BEN is on file</option>
        </select></label>
      <Button type="submit" size="sm" disabled={busy} pending={busy}>Save tax profile</Button>
    </form>
    <p className="mt-3 type-caption text-text-3">A missing form sends automatic payouts to buyer review. A saved status is an attestation, not verification of a form.</p>
    {message ? <p role="status" className="mt-2 type-body-sm">{message}</p> : null}
  </section>;
}
