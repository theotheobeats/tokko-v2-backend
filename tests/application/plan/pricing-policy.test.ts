import { describe, it, expect } from "vitest";
import { isBetaPricing } from "../../../src/application/plan/pricing-policy";

describe("isBetaPricing", () => {
  it("defaults to beta when the setting is absent (current behavior)", async () => {
    const get = async () => null;
    expect(await isBetaPricing(get)).toBe(true);
  });

  it("treats '1' as beta", async () => {
    const get = async () => "1";
    expect(await isBetaPricing(get)).toBe(true);
  });

  it("treats '0' as out of beta (normal prices)", async () => {
    const get = async () => "0";
    expect(await isBetaPricing(get)).toBe(false);
  });
});
