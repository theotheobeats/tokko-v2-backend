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

  // Environment
  NODE_ENV?: string;
}
