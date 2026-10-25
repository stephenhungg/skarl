import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { ensureAuthMembership } from "./lib/authMemberships";
import { authRedirect, clearUnverifiedGoogleEmail, googleProfile } from "./lib/authPolicy";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google({ profile: googleProfile })],
  callbacks: {
    redirect: authRedirect,
    async afterUserCreatedOrUpdated(ctx, { userId, provider, profile }) {
      await clearUnverifiedGoogleEmail(ctx, userId, provider.id, profile);
      await ensureAuthMembership(ctx, userId);
    },
  },
});
