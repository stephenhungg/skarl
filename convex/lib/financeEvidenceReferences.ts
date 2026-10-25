/** Collect structural references from deterministic reads, never citations planted
 * inside narration, notes or other explicitly untrusted user/model payloads. */
export function collectFinanceReferences(value: unknown, refs: Set<string>, key = "") {
  if (Array.isArray(value)) { value.forEach(item => collectFinanceReferences(item, refs, key)); return; }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (row.trust === "untrusted_data" || row.untrusted === true) return;
    for (const [field, item] of Object.entries(row)) {
      if (field !== "untrustedEvidence") collectFinanceReferences(item, refs, field);
    }
    return;
  }
  if (typeof value === "string" && /(?:^id$|^_id$|Id$|Ids$|^evidenceCited$|^evidenceRefs$|^evidenceReferences$|^journalEntryIds$)/.test(key) && /^[a-zA-Z0-9_-]{1,128}$/.test(value)) refs.add(value);
}
