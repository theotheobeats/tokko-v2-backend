/**
 * Central switch for AI generation mode.
 *
 * Use the real LLM whenever a non-mock LLM_API_KEY is configured — regardless
 * of NODE_ENV. The previous `isProd &&` gate meant dev/local with a valid key
 * silently fell back to the deterministic mock, which made "regenerate" return
 * the same page every time and never hit the AI API.
 *
 * Mock is now used only when no real key is set (explicit dev/test fallback,
 * zero API cost). Set LLM_FORCE_MOCK=1 to force the mock even with a key.
 */

export interface AiEnv {
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  LLM_FORCE_MOCK?: string;
  NODE_ENV?: string;
}

export function useRealAi(env: AiEnv): boolean {
  if (env.LLM_FORCE_MOCK === "1" || env.LLM_FORCE_MOCK === "true") return false;
  return Boolean(env.LLM_API_KEY) && env.LLM_API_KEY !== "sk-mock-key";
}
