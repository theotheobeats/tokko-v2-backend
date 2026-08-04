import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../infrastructure/db/schema";
import type { Env } from "../types";

export function createAuth(env: Env) {
  const db = drizzle(env.DB, { schema });
  const frontendUrl = env.FRONTEND_URL ?? "http://localhost:3000";
  // Local dev (localhost:8787) keeps Lax cookies; anything remote gets
  // cross-site cookies (frontend + API live on different origins).
  const isLocal = env.BETTER_AUTH_URL.includes("localhost");

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: {
      enabled: true,
    },
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      frontendUrl,
      "http://localhost:3000",
      "https://7okko.com",
      "https://www.7okko.com",
      "https://*.7okko.com", // store subdomains (annas-bakery.7okko.com)
    ],
    advanced: isLocal
      ? {}
      : {
          useSecureCookies: true,
          // Frontend and API are on different origins (workers.dev) → the
          // session cookie must be SameSite=None + Secure to be sent cross-site.
          defaultCookieAttributes: { sameSite: "none", secure: true },
        },
  });
}

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  NODE_ENV?: string;
}
