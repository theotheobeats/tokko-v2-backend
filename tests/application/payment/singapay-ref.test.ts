import { describe, it, expect } from "vitest";
import { encodeSingaPayRef, decodeSingaPayRef, SINGAPAY_REF_MARKER } from "../../../src/infrastructure/payments/singapay-ref";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function subExternalId(plan = "pro", cycle = "monthly", nonce = "1723456789012") {
  return `tokko-sub::${UUID}::${plan}::${cycle}::${nonce}`;
}

function preExternalId(plan = "commerce", cycle = "annual", nonce = "1723456789012") {
  return `tokko-pre::${UUID}::${plan}::${cycle}::${nonce}`;
}

describe("encodeSingaPayRef", () => {
  it("encodes subscription ids into a ≤40-char ref under the marker", () => {
    const ref = encodeSingaPayRef(subExternalId());
    expect(ref.length).toBeLessThanOrEqual(40);
    expect(ref.startsWith(SINGAPAY_REF_MARKER)).toBe(true);
    expect(ref.length).toBe(33);
  });

  it("encodes pending-plan ids the same way", () => {
    const ref = encodeSingaPayRef(preExternalId());
    expect(ref.length).toBeLessThanOrEqual(40);
    expect(ref.startsWith(SINGAPAY_REF_MARKER)).toBe(true);
  });

  it("passes order refs through unchanged (≤40 chars, no marker)", () => {
    const order = "tokko-3f7c9a2e-1111-4222-8333-444455556666";
    expect(encodeSingaPayRef(order)).toBe(order);
  });

  it("throws on an unknown plan", () => {
    expect(() => encodeSingaPayRef(subExternalId("gold"))).toThrow();
  });
});

describe("decodeSingaPayRef", () => {
  it("round-trips a subscription id (prefix, id, plan, cycle preserved)", () => {
    const canonical = subExternalId("pro", "monthly");
    const decoded = decodeSingaPayRef(encodeSingaPayRef(canonical))!;
    expect(decoded.startsWith("tokko-sub::")).toBe(true);
    expect(decoded).toContain(`::${UUID}::pro::monthly::`);
    // nonce is regenerated — must still be a valid 6-char marker
    const nonce = decoded.split("::").pop()!;
    expect(nonce).toMatch(/^[0-9a-f]{6}$/);
  });

  it("round-trips all plan/cycle combos", () => {
    for (const plan of ["pro", "commerce"] as const) {
      for (const cycle of ["monthly", "annual"] as const) {
        const decoded = decodeSingaPayRef(encodeSingaPayRef(subExternalId(plan, cycle)))!;
        expect(decoded).toContain(`::${UUID}::${plan}::${cycle}::`);
        const pre = decodeSingaPayRef(encodeSingaPayRef(preExternalId(plan, cycle)))!;
        expect(pre.startsWith("tokko-pre::")).toBe(true);
        expect(pre).toContain(`::${UUID}::${plan}::${cycle}::`);
      }
    }
  });

  it("returns null for non-encoded refs (order payments)", () => {
    expect(decodeSingaPayRef("tokko-3f7c9a2e-1111-4222-8333-444455556666")).toBeNull();
    expect(decodeSingaPayRef("18917720251110094037705")).toBeNull();
  });

  it("returns null for malformed refs", () => {
    expect(decodeSingaPayRef("tkXAAAAAAAAAAAAAAAAAAAAAAomo000000")).toBeNull(); // bad kind
    expect(decodeSingaPayRef("tkstoo-short")).toBeNull(); // wrong length
    expect(decodeSingaPayRef("tkp!!!!!!!!!!!!!!!!!!!!!!omo000000")).toBeNull(); // bad b64
  });

  it("rejects refs with invalid plan/cycle codes", () => {
    // build a valid-length ref with bad codes: tk s <22b64> x x <nonce6>
    const ref = `tks${"A".repeat(22)}xx000000`;
    expect(ref.length).toBe(33);
    expect(decodeSingaPayRef(ref)).toBeNull();
  });
});
