import { describe, it, expect } from "vitest";
import { useRealAi } from "../../../src/infrastructure/ai/ai-mode";

describe("useRealAi", () => {
  it("uses real AI whenever a valid key is set, regardless of NODE_ENV", () => {
    expect(useRealAi({ LLM_API_KEY: "sk-real-123", NODE_ENV: "development" })).toBe(true);
    expect(useRealAi({ LLM_API_KEY: "sk-real-123", NODE_ENV: "production" })).toBe(true);
    expect(useRealAi({ LLM_API_KEY: "sk-real-123" })).toBe(true);
  });

  it("falls back to mock when key is missing or the mock placeholder", () => {
    expect(useRealAi({})).toBe(false);
    expect(useRealAi({ LLM_API_KEY: "" })).toBe(false);
    expect(useRealAi({ LLM_API_KEY: "sk-mock-key" })).toBe(false);
    expect(useRealAi({ LLM_API_KEY: "sk-mock-key", NODE_ENV: "production" })).toBe(false);
  });

  it("LLM_FORCE_MOCK forces the mock even with a valid key", () => {
    expect(useRealAi({ LLM_API_KEY: "sk-real-123", LLM_FORCE_MOCK: "1" })).toBe(false);
    expect(useRealAi({ LLM_API_KEY: "sk-real-123", LLM_FORCE_MOCK: "true" })).toBe(false);
  });
});
