"use client";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/** Convex deduplicates this subscription across the header and route gate. */
export function useSession() {
  const auth = useConvexAuth();
  const me = useQuery(api.auth.memberships.me, auth.isLoading ? "skip" : {});
  return { ...auth, me };
}
