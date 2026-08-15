/**
 * HandlePendingPlanPayment — a paid pre-store plan invoice (`tokko-pre::…`)
 * records a consumable pending plan for the user. Onboarding then consumes it
 * to create the store's subscription (no trial). Amount re-verified against
 * pricing (forgery guard, same pattern as order/subscription payments).
 *
 * Race guard: if the webhook lands AFTER onboarding (the user clicked
 * "lanjut" before paying), the user already has a store — we activate the
 * subscription on it immediately instead of leaving a dangling pending row.
 */

import type { Result } from "../../domain/shared/types";
import { ok, err, createEntityId } from "../../domain/shared/types";
import { parsePendingPlanExternalId, isValidInvoiceAmount, PERIOD_DAYS } from "../../domain/plan/pricing";
import { Subscription } from "../../domain/plan/subscription";
import type { Store } from "../../domain/store/store";
import type { StoreRepository } from "../store/store-repo";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import type { PendingPlanRepository, PendingPlanRow } from "../../infrastructure/repos/d1-pending-plan-repo";

export class PendingPlanAmountMismatchError extends Error {
  code = "PENDING_PLAN_AMOUNT_MISMATCH";
  constructor() { super("Jumlah pembayaran paket tidak cocok"); }
}

export interface PendingPlanWebhookPayload {
  external_id: string;
  status: string;
  amount?: number;
}

/** Create the store's subscription from a pending plan (shared by onboarding + webhook). */
export async function activatePendingPlan(
  store: Store,
  pending: PendingPlanRow,
  subRepo: SubscriptionRepository,
): Promise<void> {
  await subRepo.save(Subscription.create({
    id: createEntityId(),
    storeId: store.id,
    plan: pending.plan,
    cycle: pending.cycle,
    currentPeriodEnd: pending.currentPeriodEnd ?? new Date(Date.now() + PERIOD_DAYS[pending.cycle] * 86_400_000).toISOString(),
    externalRef: pending.externalRef ?? undefined,
  }));
  // A paid plan clears the trial and resumes a paused store.
  store.setTrialEndsAt(null);
  store.resume();
}

export class HandlePendingPlanPayment {
  constructor(
    private readonly pendingRepo: PendingPlanRepository,
    private readonly storeRepo?: StoreRepository,
    private readonly subRepo?: SubscriptionRepository,
  ) {}

  async execute(payload: PendingPlanWebhookPayload): Promise<
    Result<{ handled: boolean; plan?: string; activated?: boolean }, PendingPlanAmountMismatchError>
  > {
    const parsed = parsePendingPlanExternalId(payload.external_id);
    if (!parsed) return ok({ handled: false });
    if (payload.status !== "PAID") return ok({ handled: false });

    const expected = isValidInvoiceAmount(payload.amount ?? -1, parsed.plan, parsed.cycle);
    if (payload.amount !== undefined && !expected) {
      return err(new PendingPlanAmountMismatchError());
    }

    const pending: PendingPlanRow = {
      id: crypto.randomUUID(),
      userId: parsed.userId,
      plan: parsed.plan,
      cycle: parsed.cycle,
      currentPeriodEnd: new Date(Date.now() + PERIOD_DAYS[parsed.cycle] * 86_400_000).toISOString(),
      externalRef: payload.external_id,
      status: "pending",
      createdAt: new Date().toISOString(),
      consumedAt: null,
    };

    // Race guard: the user already onboarded before this webhook landed →
    // activate on their existing store right away (no dangling pending row).
    if (this.storeRepo && this.subRepo) {
      const store = await this.storeRepo.findByOwnerId(parsed.userId as never);
      if (store) {
        await activatePendingPlan(store, pending, this.subRepo);
        await this.storeRepo.save(store);
        pending.status = "consumed";
        pending.consumedAt = new Date().toISOString();
      }
    }

    await this.pendingRepo.save(pending);
    return ok({ handled: true, plan: parsed.plan, activated: pending.status === "consumed" });
  }
}
