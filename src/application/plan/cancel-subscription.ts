/**
 * CancelSubscription — store-owner cancellation, Stripe-style:
 * `cancel_at_period_end` is set/cleared. The plan keeps working until the
 * current term ends (no mid-period feature loss), the auto-renewal job skips
 * it, and at period end the store pauses (existing lifecycle) with data kept
 * 30 days before archiving (existing retention job).
 */

import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Subscription } from "../../domain/plan/subscription";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";

export class SubscriptionNotFoundError extends Error {
  code = "SUBSCRIPTION_NOT_FOUND";
  constructor() { super("Langganan tidak ditemukan"); }
}

export class SubscriptionAlreadyCanceledError extends Error {
  code = "SUBSCRIPTION_ALREADY_CANCELED";
  constructor() { super("Langganan sudah dibatalkan"); }
}

export class SubscriptionChangePendingError extends Error {
  code = "SUBSCRIPTION_CHANGE_PENDING";
  constructor() { super("Ada perubahan paket terjadwal — selesaikan dulu sebelum membatalkan"); }
}

export class CancelSubscription {
  constructor(private readonly subRepo: SubscriptionRepository) {}

  async execute(input: {
    storeId: string;
    cancel: boolean;
  }): Promise<Result<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }, SubscriptionNotFoundError | SubscriptionAlreadyCanceledError | SubscriptionChangePendingError>> {
    const sub = await this.subRepo.findActiveByStoreId(input.storeId as never);
    if (!sub) return err(new SubscriptionNotFoundError());

    if (input.cancel) {
      if (sub.cancelAtPeriodEnd) return err(new SubscriptionAlreadyCanceledError());
      if (sub.pendingPlan) return err(new SubscriptionChangePendingError());
    }

    await this.subRepo.save(Subscription.from({
      ...sub.toJSON(),
      cancelAtPeriodEnd: input.cancel,
      updatedAt: new Date().toISOString(),
    }));

    return ok({ cancelAtPeriodEnd: input.cancel, currentPeriodEnd: sub.currentPeriodEnd });
  }
}
