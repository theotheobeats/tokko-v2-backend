import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../infrastructure/db/schema";
import { ResendEmailer } from "../infrastructure/email/resend";
import type { Env } from "../types";

export function createAuth(env: Env) {
  const db = drizzle(env.DB, { schema });
  const frontendUrl = env.FRONTEND_URL ?? "http://localhost:3000";
  const isLocal = env.BETTER_AUTH_URL.includes("localhost");

  // Same-site cookies whenever the API and the app share a registrable root
  // domain (api.7okko.com + 7okko.com → "7okko.com"). Only when they live on
  // different roots (e.g. workers.dev origins) do we need cross-site cookies.
  const sameRoot = (() => {
    try {
      const host = (u: string) => new URL(u).hostname;
      const root = (h: string) => h.split(".").slice(-2).join(".");
      return root(host(env.BETTER_AUTH_URL)) === root(host(frontendUrl));
    } catch {
      return false;
    }
  })();

  const crossSite = !isLocal && !sameRoot;

  // Google OAuth — enabled once credentials are configured (secrets). The
  // redirect URI must match exactly what's registered in Google Cloud Console.
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  // Email verification for email/password signups (Google accounts are already
  // verified). Sent through Resend; skipped when no API key is set.
  const emailConfigured = Boolean(env.RESEND_API_KEY);
  const emailer = new ResendEmailer(env);
  const dashboardUrl = `${frontendUrl}/dashboard`;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: {
      enabled: true,
    },
    ...(googleConfigured
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID!,
              clientSecret: env.GOOGLE_CLIENT_SECRET!,
              redirectURI: `${env.BETTER_AUTH_URL}/api/auth/callback/google`,
            },
          },
        }
      : {}),
    ...(emailConfigured
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({ user, url }) => {
              const verifyUrl = `${url}&callbackURL=${encodeURIComponent(dashboardUrl)}`;
              await emailer.send({
                to: user.email,
                subject: "Verifikasi email 7okko",
                html: `
                  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
                    <h2 style="color:#1c1917;margin:0 0 12px">Verifikasi email kamu</h2>
                    <p style="color:#57534b;font-size:15px;line-height:1.6;margin:0 0 20px">
                      Klik tombol di bawah untuk mengonfirmasi email dan mengaktifkan akun 7okko kamu.
                    </p>
                    <a href="${verifyUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:9999px">
                      Verifikasi email
                    </a>
                    <p style="color:#a8a29a;font-size:12px;margin:24px 0 0">
                      Atau buka: ${verifyUrl}
                    </p>
                  </div>`,
                text: `Verifikasi email kamu: ${verifyUrl}`,
              });
            },
          },
        }
      : {}),
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      frontendUrl,
      "http://localhost:3000",
      "https://7okko.com",
      "https://www.7okko.com",
      "https://*.7okko.com", // store subdomains (annas-bakery.7okko.com)
    ],
    advanced: crossSite
      ? {
          useSecureCookies: true,
          // Frontend and API are on different registrable domains (workers.dev)
          // → the session cookie must be SameSite=None + Secure to be sent cross-site.
          defaultCookieAttributes: { sameSite: "none", secure: true },
        }
      : {},
  });
}

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  NODE_ENV?: string;
}
