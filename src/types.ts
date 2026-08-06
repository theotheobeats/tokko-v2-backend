/**
 * Application environment bindings.
 * These are provided by Cloudflare Workers (bindings in wrangler.jsonc).
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Bucket
  IMAGES: R2Bucket;

  // Auth
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;

  // AI — OpenAI-compatible provider (DeepSeek, Synthetic/Kimi, OpenAI, etc.)
  LLM_API_KEY: string;
  LLM_MODEL: string;
  LLM_BASE_URL?: string;  // optional — defaults to DeepSeek

  // Payments — Xendit (Invoices API). Mocked when no key is set.
  XENDIT_SECRET_KEY?: string;
  XENDIT_WEBHOOK_TOKEN?: string;
  XENDIT_FORCE_MOCK?: string;
  // Public API origin used for payment success/failure redirects.
  API_PUBLIC_URL?: string;

  // Google OAuth (better-auth social sign-in)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // Transactional email (Resend)
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  // Frontend origin (deployed URL) — used for CORS + better-auth trusted origins
  FRONTEND_URL?: string;
  // Extra comma-separated CORS origins (optional, e.g. custom domain)
  ALLOWED_ORIGINS?: string;

  // Environment
  NODE_ENV?: string;
}
