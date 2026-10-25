import { describe, expect, it } from "vitest";
import { publicEvidenceUrl, scenarioPresentation, witnessPresentation } from "./witness-presentation";

describe("witness presentation preserves uncertainty", () => {
  it("does not turn absent, unavailable or unknown witnesses into agreement", () => {
    for (const value of ["missing", "unavailable", "", "provider_failed", "unknown"]) {
      expect(witnessPresentation(value)).toEqual({ label: "Missing", status: "idle" });
    }
    expect(witnessPresentation("pending").status).toBe("waiting");
    expect(witnessPresentation("mismatch").status).toBe("fail");
    expect(witnessPresentation("match").status).toBe("ok");
  });

  it("links only credential-free HTTPS evidence", () => {
    expect(publicEvidenceUrl("https://sepolia.basescan.org/tx/0x123")).toContain("https://sepolia.basescan.org/");
    for (const value of [null, undefined, "javascript:alert(1)", "data:text/html,test", "/relative", "http://example.com", "https://secret@example.com"]) {
      expect(publicEvidenceUrl(value)).toBeNull();
    }
  });

  it("keeps blocked scenarios and unsupported success claims distinct from passing controls", () => {
    expect(scenarioPresentation({ simulated: true, passed: false, observedOutcome: "requires an accepted original; no acceptance invented" }).label).toBe("Prerequisite missing");
    expect(scenarioPresentation({ simulated: true, passed: false, observedOutcome: "expected refusal not recorded" }).status).toBe("fail");
    expect(scenarioPresentation({ simulated: false, passed: true, observedOutcome: "ok" }).status).toBe("idle");
    expect(scenarioPresentation({ simulated: true, passed: true, observedOutcome: "second payable refused" }).label).toBe("Control held");
  });
});
