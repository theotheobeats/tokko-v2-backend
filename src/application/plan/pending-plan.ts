/**
 * HandlePendingPlanPayment — a paid pre-store plan invoice (`tokko-pre::…`)
 * records a consumable pending plan for the user. Onboarding then consumes it
 * to create the store's subscription (no trial). Amount re-verified against
 * pricing (forgery guard, same pattern as order/subscription payments).
 */

import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { parsePendingPlanExternalId, priceFor, PERIOD_DAYS } from "../../domain/plan/pricing";
import type { PendingPlanRepository } from "../../infrastructure/repos/d1-pending-plan-repo";

export class PendingPlanAmountMismatchError extends Error {
  code = "PENDING_PLAN_AMOUNT_MISMATCH";
  constructor() { super("Jumlah pembayaran paket tidak cocok"); }
}

export interface PendingPlanWebhookPayload {
  external_id: string;
  status: string;
  amount?: number;
}

export class HandlePendingPlanPayment {
  constructor(private readonly pendingRepo: PendingPlanRepository) {}

  async execute(payload: PendingPlanWebhookPayload): Promise<
    Result<{ handled: boolean; plan?: string }, PendingPlanAmountMismatchError>
  > {
    const parsed = parsePendingPlanExternalId(payload.external_id);
    if (!parsed) return ok({ handled: false });
    if (payload.status !== "PAID") return ok({ handled: false });

    const expected = priceFor(parsed.plan, parsed.cycle);
    if (payload.amount !== undefined && Number(payload.amount) !== expected) {
      return err(new PendingPlanAmountMismatchError());
    }

    await this.pendingRepo.save({
      id: crypto.randomUUID(),
      userId: parsed.userId,
      plan: parsed.plan,
      cycle: parsed.cycle,
      currentPeriodEnd: new Date(Date.now() + PERIOD_DAYS[parsed.cycle] * 86_400_000).toISOString(),
      externalRef: payload.external_id,
    });

    return ok({ handled: true, plan: parsed.plan });
  }
}
