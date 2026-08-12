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

  // Payments — SingaPay (payment links API). Mocked when credentials unset.
  SINGAPAY_CLIENT_ID?: string;
  SINGAPAY_CLIENT_SECRET?: string;
  SINGAPAY_PARTNER_ID?: string;
  SINGAPAY_ACCOUNT_ID?: string;
  SINGAPAY_API_URL?: string;
  // Base host for merchant KYB self-onboarding links (SingaPay echoes the
  // caller's Host — through a proxy that would be unusable).
  SINGAPAY_KYB_URL_BASE?: string;
  // Optional static-IP reverse proxy (VPS) — overrides the API base so
  // SingaPay sees the proxy's fixed egress IP.
  SINGAPAY_PROXY_URL?: string;
  // Optional shared secret the proxy requires (X-Proxy-Token header).
  SINGAPAY_PROXY_TOKEN?: string;
  SINGAPAY_WEBHOOK_SECRET?: string;
  SINGAPAY_FORCE_MOCK?: string;
  // Platform settlement account number (commission sweep beneficiary for
  // merchant payouts — funds move from the merchant's sub-account to ours).
  SINGAPAY_SETTLEMENT_ACCOUNT_NUMBER?: string;
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
