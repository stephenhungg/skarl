/** Presentation never upgrades missing evidence into agreement or payment authority. */
export function witnessPresentation(status: string) {
  switch (status) {
    case "agree": case "match": return { label: "Agrees", status: "ok" as const };
    case "disagree": case "mismatch": return { label: "Disagrees", status: "fail" as const };
    case "pending": return { label: "Pending", status: "waiting" as const };
    case "not_applicable": return { label: "Not applicable", status: "idle" as const };
    default: return { label: "Missing", status: "idle" as const };
  }
}

export function publicEvidenceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function scenarioPresentation(run: { simulated: boolean; passed: boolean; observedOutcome: string }) {
  if (!run.simulated) return { label: "Unverified result", status: "idle" as const };
  if (run.passed) return { label: "Control held", status: "ok" as const };
  if (/^requires\b|prerequisite/i.test(run.observedOutcome)) return { label: "Prerequisite missing", status: "waiting" as const };
  return { label: "Needs investigation", status: "fail" as const };
}
