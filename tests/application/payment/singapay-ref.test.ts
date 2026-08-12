import { describe, it, expect } from "vitest";
import { createRandomStringGenerator } from "@better-auth/utils/random";
import { encodeSingaPayRef, decodeSingaPayRef } from "../../../src/infrastructure/payments/singapay-ref";

/**
 * Mirrors better-auth core's generateId exactly (src/utils/id.ts):
 *   createRandomStringGenerator("a-z", "A-Z", "0-9")(size || 32)
 * The real generateId lives at @better-auth/core/dist/utils/id, which the
 * package exports map blocks — this uses the same shared primitive with the
 * same arguments, so a charset/length change in the primitive fails the test.
 */
const betterAuthGenerateId = () => createRandomStringGenerator("a-z", "A-Z", "0-9")(32);

const UUID = "550e8400-e29b-41d4-a716-446655440000";
/** better-auth default user id: 32-char base62 (generateId(size||32)). */
const USER_ID = "4yYR6t4m2NtknmI6xqCM85HztDAkVFOq";

function subExternalId(plan = "pro", cycle = "monthly", nonce = "1723456789012") {
  return `tokko-sub::${UUID}::${plan}::${cycle}::${nonce}`;
}

function preExternalId(plan = "commerce", cycle = "annual", nonce = "1723456789012") {
  return `tokko-pre::${USER_ID}::${plan}::${cycle}::${nonce}`;
}

describe("encodeSingaPayRef", () => {
  it("encodes subscription ids (UUID) into a 29-char ref", () => {
    const ref = encodeSingaPayRef(subExternalId());
    expect(ref.length).toBe(29);
    expect(ref.length).toBeLessThanOrEqual(40);
    expect(ref[0]).toBe("s");
  });

  it("encodes pending-plan ids (better-auth 32-char) into a 39-char ref", () => {
    const ref = encodeSingaPayRef(preExternalId());
    expect(ref.length).toBe(39);
    expect(ref.length).toBeLessThanOrEqual(40);
    expect(ref[0]).toBe("p");
  });

  it("passes order refs through unchanged (≤40 chars)", () => {
    const order = "tokko-528844df84a54724a60acfc31b4e7bd3"; // 38 chars
    expect(encodeSingaPayRef(order)).toBe(order);
  });

  it("throws on an unknown plan", () => {
    expect(() => encodeSingaPayRef(subExternalId("gold"))).toThrow();
  });

  it("throws on any other >40-char id (SingaPay cap regression guard)", () => {
    const longOrder = `tokko-${crypto.randomUUID()}`; // 42 chars
    expect(longOrder.length).toBeGreaterThan(40);
    expect(() => encodeSingaPayRef(longOrder)).toThrow(/terlalu panjang/);
  });

  it("throws on a pending-plan id that is not a 32-char base62 id", () => {
    const bad = `tokko-pre::short-id::pro::monthly::1`;
    expect(() => encodeSingaPayRef(bad)).toThrow(/ID pengguna tidak valid/);
  });
});

describe("decodeSingaPayRef", () => {
  it("round-trips a subscription id (prefix, id, plan, cycle preserved)", () => {
    const decoded = decodeSingaPayRef(encodeSingaPayRef(subExternalId("pro", "monthly")))!;
    expect(decoded.startsWith("tokko-sub::")).toBe(true);
    expect(decoded).toContain(`::${UUID}::pro::monthly::`);
    const nonce = decoded.split("::").pop()!;
    expect(nonce).toMatch(/^[0-9a-f]{4}$/);
  });

  it("round-trips a pending-plan id (better-auth user id, raw)", () => {
    const decoded = decodeSingaPayRef(encodeSingaPayRef(preExternalId()))!;
    expect(decoded.startsWith("tokko-pre::")).toBe(true);
    expect(decoded).toContain(`::${USER_ID}::commerce::annual::`);
  });

  it("round-trips a pending-plan ref with better-auth's real id generator output", () => {
    const userId = betterAuthGenerateId();
    // Guards the format contract itself — if better-auth ever changes shape,
    // this assertion (not just the round-trip) fails loudly.
    expect(userId).toMatch(/^[A-Za-z0-9]{32}$/);

    const canonical = `tokko-pre::${userId}::pro::monthly::1723456789012`;
    const ref = encodeSingaPayRef(canonical);
    expect(ref.length).toBeLessThanOrEqual(40);
    const decoded = decodeSingaPayRef(ref)!;
    expect(decoded).toContain(`::${userId}::pro::monthly::`);
  });

  it("round-trips all plan/cycle combos for both kinds", () => {
    for (const plan of ["pro", "commerce"] as const) {
      for (const cycle of ["monthly", "annual"] as const) {
        const sub = decodeSingaPayRef(encodeSingaPayRef(subExternalId(plan, cycle)))!;
        expect(sub).toContain(`::${UUID}::${plan}::${cycle}::`);
        const pre = decodeSingaPayRef(encodeSingaPayRef(preExternalId(plan, cycle)))!;
        expect(pre).toContain(`::${USER_ID}::${plan}::${cycle}::`);
      }
    }
  });

  it("returns null for non-encoded refs (order payments, foreign refs)", () => {
    expect(decodeSingaPayRef("tokko-528844df84a54724a60acfc31b4e7bd3")).toBeNull();
    expect(decodeSingaPayRef("18917720251110094037705")).toBeNull();
  });

  it("returns null for malformed refs", () => {
    expect(decodeSingaPayRef("s")).toBeNull(); // too short
    expect(decodeSingaPayRef("p")).toBeNull(); // too short
    // 's' with an invalid b64url id, correct length otherwise
    expect(decodeSingaPayRef(`s${"!".repeat(22)}omo0000`)).toBeNull();
    // 'p' with a non-base62 id
    expect(decodeSingaPayRef(`p${"0".repeat(31)}!omo0000`)).toBeNull();
    // valid shapes but invalid plan/cycle codes
    const sBad = `s${"A".repeat(22)}xx0000`;
    expect(sBad.length).toBe(29);
    expect(decodeSingaPayRef(sBad)).toBeNull();
  });
});
