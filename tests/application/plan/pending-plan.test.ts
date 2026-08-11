import { describe, it, expect, vi } from "vitest";
import {
  pendingPlanExternalId,
  parsePendingPlanExternalId,
  priceFor,
  PENDING_PLAN_EXTERNAL_ID_PREFIX,
} from "../../../src/domain/plan/pricing";
import {
  HandlePendingPlanPayment,
  PendingPlanAmountMismatchError,
} from "../../../src/application/plan/pending-plan";
import type { PendingPlanRepository } from "../../../src/infrastructure/repos/d1-pending-plan-repo";

const USER_ID = "user-123";

function stubRepo(): { repo: PendingPlanRepository; saved: unknown[] } {
  const saved: unknown[] = [];
  const repo = {
    findByUserIdConsumable: vi.fn().mockResolvedValue(null),
    save: vi.fn(async (row: unknown) => { saved.push(row); }),
    markConsumed: vi.fn().mockResolvedValue(undefined),
  } as unknown as PendingPlanRepository;
  return { repo, saved };
}

describe("pending-plan external-id", () => {
  it("round-trips the pre-store plan external_id", () => {
    const id = pendingPlanExternalId(USER_ID, "commerce", "annual", "n1");
    expect(id.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)).toBe(true);
    expect(parsePendingPlanExternalId(id)).toEqual({
      userId: USER_ID,
      plan: "commerce",
      cycle: "annual",
      nonce: "n1",
    });
  });

  it("rejects malformed ids and non-pending ids", () => {
    expect(parsePendingPlanExternalId("tokko-pre::user::nope::annual::1")).toBeNull();
    expect(parsePendingPlanExternalId("tokko-sub::x::pro::monthly::1")).toBeNull();
    expect(parsePendingPlanExternalId("")).toBeNull();
  });
});

describe("HandlePendingPlanPayment", () => {
  it("records a pending plan on a paid, amount-verified invoice", async () => {
    const { repo, saved } = stubRepo();
    const uc = new HandlePendingPlanPayment(repo);

    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "pro", "annual", "n1"),
      status: "PAID",
      amount: priceFor("pro", "annual"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ handled: true, plan: "pro" });
    expect(saved.length).toBe(1);
    const row = saved[0] as { userId: string; plan: string; cycle: string; currentPeriodEnd: string };
    expect(row.userId).toBe(USER_ID);
    expect(row.plan).toBe("pro");
    expect(row.cycle).toBe("annual");
    expect(row.currentPeriodEnd).toBeDefined();
  });

  it("rejects a paid invoice with a mismatched amount", async () => {
    const { repo, saved } = stubRepo();
    const uc = new HandlePendingPlanPayment(repo);

    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "commerce", "monthly", "n1"),
      status: "PAID",
      amount: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PendingPlanAmountMismatchError);
    expect(saved.length).toBe(0);
  });

  it("ignores non-PAID statuses", async () => {
    const { repo, saved } = stubRepo();
    const uc = new HandlePendingPlanPayment(repo);

    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "pro", "monthly", "n1"),
      status: "EXPIRED",
      amount: priceFor("pro", "monthly"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handled).toBe(false);
    expect(saved.length).toBe(0);
  });
});
