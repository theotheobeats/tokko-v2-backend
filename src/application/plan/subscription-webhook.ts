/**
 * HandleSubscriptionInvoice — activates a paid plan when a Xendit
 * subscription invoice webhook (PAID) arrives. Amount re-verified against
 * pricing (forgery guard, same pattern as order payments).
 */

import type { Result } from "../../domain/shared/types";
import { ok, err, createEntityId } from "../../domain/shared/types";
import { parseSubscriptionExternalId, priceFor, PERIOD_DAYS } from "../../domain/plan/pricing";
import type { Plan, BillingCycle } from "../../domain/plan/types";
import { Subscription } from "../../domain/plan/subscription";
import type { StoreRepository } from "../store/store-repo";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";

export class SubscriptionStoreNotFoundError extends Error {
  code = "SUBSCRIPTION_STORE_NOT_FOUND";
  constructor() { super("Toko langganan tidak ditemukan"); }
}

export class SubscriptionAmountMismatchError extends Error {
  code = "SUBSCRIPTION_AMOUNT_MISMATCH";
  constructor() { super("Jumlah pembayaran langganan tidak cocok"); }
}

export interface SubscriptionWebhookPayload {
  external_id: string;
  status: string;
  amount?: number;
}

export class HandleSubscriptionInvoice {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly subRepo: SubscriptionRepository,
  ) {}

  async execute(payload: SubscriptionWebhookPayload): Promise<
    Result<{ handled: boolean; plan?: Plan; cycle?: BillingCycle }, SubscriptionStoreNotFoundError | SubscriptionAmountMismatchError>
  > {
    const parsed = parseSubscriptionExternalId(payload.external_id);
    if (!parsed) return ok({ handled: false });

    // Only PAID activates — EXPIRED/FAILED/PENDING are no-ops (no pending state).
    if (payload.status !== "PAID") return ok({ handled: false });

    const expected = priceFor(parsed.plan, parsed.cycle);
    // customer_pays_fee adds the processing fee on top of the charged amount
    // — accept base + fee (a lower amount is a forgery).
    if (payload.amount !== undefined && Number(payload.amount) < expected) {
      return err(new SubscriptionAmountMismatchError());
    }

    const store = await this.storeRepo.findById(parsed.storeId as never);
    if (!store) return err(new SubscriptionStoreNotFoundError());

    // Extend from the current period end if still running, else from now.
    const existing = await this.subRepo.findActiveByStoreId(store.id);

    if (existing) {
      // Same plan+cycle → renewal: extend the current period.
      // Different plan/cycle → CHANGE: prepaid for the NEXT term, applied at
      // current_period_end (upgrade/downgrade takes effect next term).
      const isRenewal = existing.plan === parsed.plan && existing.cycle === parsed.cycle;
      const baseMs =
        existing.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > Date.now()
          ? new Date(existing.currentPeriodEnd).getTime()
          : Date.now();
      const periodEnd = new Date(baseMs + PERIOD_DAYS[parsed.cycle] * 86_400_000).toISOString();

      await this.subRepo.save(Subscription.from({
        ...existing.toJSON(),
        // Renewal: same plan. Change: keep the CURRENT plan until term end.
        plan: isRenewal ? parsed.plan : existing.plan,
        cycle: isRenewal ? parsed.cycle : existing.cycle,
        status: "active",
        currentPeriodEnd: isRenewal ? periodEnd : existing.currentPeriodEnd,
        externalRef: payload.external_id,
        // A payment clears any pending auto-renewal invoice.
        renewalInvoiceExternalId: null,
        // Renewal keeps the current plan; a change schedules the new one.
        pendingPlan: isRenewal ? existing.pendingPlan : parsed.plan,
        pendingCycle: isRenewal ? existing.pendingCycle : parsed.cycle,
        updatedAt: new Date().toISOString(),
      }));
    } else {
      // First purchase — activate immediately (trial is not a paid term).
      await this.subRepo.save(Subscription.create({
        id: createEntityId(),
        storeId: store.id,
        plan: parsed.plan,
        cycle: parsed.cycle,
        currentPeriodEnd: new Date(Date.now() + PERIOD_DAYS[parsed.cycle] * 86_400_000).toISOString(),
        externalRef: payload.external_id,
      }));
    }

    // Payment clears the trial, resumes a paused store, and clears any pending renewal invoice.
    store.setTrialEndsAt(null);
    store.resume();
    await this.storeRepo.save(store);

    return ok({ handled: true, plan: parsed.plan, cycle: parsed.cycle, renewal: existing ? existing.plan === parsed.plan && existing.cycle === parsed.cycle : false });
  }
}
