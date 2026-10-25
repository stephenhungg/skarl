"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LivenessChallenge } from "./api";

type ChallengeState =
  | { phase: "loading"; challenge?: undefined }
  | { phase: "ready"; challenge: LivenessChallenge }
  | { phase: "unavailable"; challenge?: undefined };

/** Preview-only refreshes: words must never change during a recording or repair an old take. */
export function useLiveness(preview: boolean, issueChallenge?: () => Promise<LivenessChallenge>) {
  const [state, setState] = useState<ChallengeState>({ phase: "unavailable" });
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current++;
    setState({ phase: issueChallenge ? "loading" : "unavailable" });
  }, [issueChallenge]);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!issueChallenge) { setState({ phase: "unavailable" }); return; }
    setState({ phase: "loading" });
    // A stalled optional request must not prevent recording for human review.
    const timeout = window.setTimeout(() => {
      if (generation.current !== request) return;
      generation.current++;
      setState({ phase: "unavailable" });
    }, 8000);
    try {
      const challenge = await issueChallenge();
      if (generation.current === request) {
        setState(challenge.expiresAt > Date.now() ? { phase: "ready", challenge } : { phase: "unavailable" });
      }
    } catch {
      if (generation.current === request) setState({ phase: "unavailable" });
    } finally { window.clearTimeout(timeout); }
  }, [issueChallenge]);

  useEffect(() => {
    if (preview) void refresh();
    return () => { generation.current++; };
  }, [preview, refresh]);

  const expiresAt = state.challenge?.expiresAt;
  useEffect(() => {
    if (!preview || expiresAt === undefined) return;
    const timeout = window.setTimeout(() => void refresh(), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [preview, expiresAt, refresh]);

  return { ...state, refresh, clear };
}
