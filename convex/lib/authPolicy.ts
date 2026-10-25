import type { GoogleProfile } from "@auth/core/providers/google";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Convex Auth otherwise assumes OAuth email ownership, even without this claim. */
export function googleProfile(profile: GoogleProfile) {
  return {
    id: profile.sub,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
    emailVerified: profile.email_verified === true,
  };
}

/** A later unverified profile must not retain a previous email's verification. */
export async function clearUnverifiedGoogleEmail(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  providerId: string,
  profile: { emailVerified?: boolean },
) {
  if (providerId === "google" && profile.emailVerified !== true) {
    await ctx.db.patch(userId, { emailVerificationTime: undefined });
  }
}

/** Keep mobile schemes explicit; Expo Go's LAN/tunnel hostname changes per session. */
export async function authRedirect({ redirectTo }: { redirectTo: string }) {
  if (redirectTo !== redirectTo.trim() || /[\\\u0000-\u001f\u007f]/.test(redirectTo)) {
    throw new Error("invalid_auth_redirect");
  }
  const mobile = /^(skarl|exp):\/\/(.*)$/.exec(redirectTo);
  if (mobile) {
    const [, scheme, rest] = mobile;
    // Validate using HTTPS: the Convex runtime only parses HTTP(S) URL schemes.
    const mobileUrl = new URL(`https://${rest === "" || rest.startsWith("/") || rest.startsWith("?") ? "skarl.invalid" : ""}${rest}`);
    if (mobileUrl.username || mobileUrl.password || mobileUrl.hash || (scheme === "exp" && (!rest || /^[/?#]/.test(rest)))) {
      throw new Error("invalid_auth_redirect");
    }
    return redirectTo;
  }
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) throw new Error("SITE_URL must be configured");
  const site = new URL(siteUrl);
  const destination = new URL(redirectTo, site);
  if (!["http:", "https:"].includes(site.protocol) || destination.origin !== site.origin || destination.username || destination.password) {
    throw new Error("invalid_auth_redirect");
  }
  return destination.toString();
}
