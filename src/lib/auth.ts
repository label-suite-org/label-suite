import "dotenv/config";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { passkey } from "@better-auth/passkey";
import { Pool } from "pg";
import { queuePasswordResetEmail } from "../server/email";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required. Set it in .env");
}

const pool = new Pool({ connectionString });
const publicSiteUrl = process.env.PUBLIC_SITE_URL || "http://localhost:4321";
const passkeyUrl = new URL(publicSiteUrl);
const configuredTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? [];
const trustedOrigins = Array.from(new Set([
  process.env.PUBLIC_SITE_URL,
  "http://localhost:4321",
  "http://localhost:4322",
  "http://127.0.0.1:4321",
  "http://127.0.0.1:4322",
  "https://label-suite.truenature.online",
  ...configuredTrustedOrigins,
].filter((origin): origin is string => Boolean(origin))));
const nextcloudClientId = process.env.NEXTCLOUD_OIDC_CLIENT_ID;
const nextcloudClientSecret = process.env.NEXTCLOUD_OIDC_CLIENT_SECRET;
const nextcloudOidcEnabled = Boolean(nextcloudClientId && nextcloudClientSecret);

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: publicSiteUrl,
  user: {
    modelName: "label_suite.user",
  },
  session: {
    modelName: "label_suite.session",
    // Persistent sign-in for seven days from authentication, not indefinitely
    // extended by activity. Existing credentials and signing secret are unchanged.
    expiresIn: 60 * 60 * 24 * 7,
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  account: {
    modelName: "label_suite.account",
    accountLinking: {
      trustedProviders: nextcloudOidcEnabled ? ["nextcloud"] : [],
    },
  },
  verification: {
    modelName: "label_suite.verification",
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      queuePasswordResetEmail({
        toEmail: user.email,
        resetUrl: url,
      });
    },
  },
  plugins: [
    ...(nextcloudOidcEnabled
      ? [genericOAuth({
          config: [{
            providerId: "nextcloud",
            discoveryUrl: "https://cloud.truenature.online/.well-known/openid-configuration",
            issuer: "https://cloud.truenature.online",
            clientId: nextcloudClientId!,
            clientSecret: nextcloudClientSecret!,
            scopes: ["openid", "profile", "email"],
            pkce: true,
          }],
        })]
      : []),
    passkey({
      rpID: passkeyUrl.hostname,
      rpName: "Label Suite",
      origin: passkeyUrl.origin,
      schema: {
        passkey: {
          modelName: "label_suite.passkey",
        },
      },
    }),
  ],
  trustedOrigins,
});
