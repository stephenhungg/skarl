import GitHub from "@auth/core/providers/github";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { ensureAuthMembership, githubEnabled } from "./lib/authMemberships";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({
    profile(params) {
      const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError("invalid_email");
      // Ignore all submitted roles, verification flags, and destinations.
      return { email };
    },
  }), ...(githubEnabled() ? [GitHub] : [])],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await ensureAuthMembership(ctx, userId);
    },
  },
});
