import { describe, it, expect } from "vitest";
import { useRealAi } from "../../src/infrastructure/ai/ai-mode";

// The core regression: dev with a real key must hit the AI, not the mock.
describe("generation AI-mode smoke", () => {
  it("dev + real key => real AI (this was the regenerate-stuck bug)", () => {
    expect(useRealAi({ LLM_API_KEY: "sk-real", NODE_ENV: "development" })).toBe(true);
  });
  it("mock placeholder or missing key => mock", () => {
    expect(useRealAi({ LLM_API_KEY: "sk-mock-key", NODE_ENV: "production" })).toBe(false);
    expect(useRealAi({})).toBe(false);
  });
});
