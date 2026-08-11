/**
 * Admin — subscription/plan management use cases.
 *
 * Phase 1 is manual billing: admins set plans, extend trials and grant the
 * commission path. Phase 3 wires this to Xendit recurring / xenPlatform
 * webhooks (the same endpoints will be driven by the billing service).
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err, createEntityId } from "../../domain/shared/types";
import { resolveTier, type Plan, type BillingCycle, type SubscriptionStatus, type Tier } from "../../domain/plan/types";
import { Subscription } from "../../domain/plan/subscription";
import type { StoreRepository } from "../store/store-repo";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { StoreNotFoundError } from "./admin-stores";
import type { CommissionLedger } from "../../infrastructure/repos/d1-commission-ledger";

// ---------------------------------------------------------------------------
// ListAdminSubscriptions — every store + its effective plan (plans page)
// ---------------------------------------------------------------------------

export interface AdminSubscriptionView {
  store: {
    id: string;
    name: string;
    subdomain: string;
    status: string;
    productCount: number;
  };
  tier: Tier;
  trialEndsAt: string | null;
  commissionRate: number | null;
  aiStoreGenerations: number;
  aiDescriptions: number;
  /** Accrued commission for commission-path merchants (IDR). */
  commissionTotal: number;
  subscription: ReturnType<Subscription["toJSON"]> | null;
}

export class ListAdminSubscriptions {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly subRepo: SubscriptionRepository,
    private readonly commissionLedger?: CommissionLedger,
  ) {}

  async execute(input: { q?: string; limit?: number; offset?: number }): Promise<{ subscriptions: AdminSubscriptionView[]; total: number }> {
    const { stores, total } = await this.storeRepo.listAll({
      q: input.q,
      limit: input.limit,
      offset: input.offset,
    });
    const subs = await this.subRepo.listAll();
    const byStore = new Map(subs.map((s) => [s.storeId, s]));
    const commissionTotals = this.commissionLedger
      ? await Promise.all(stores.map((s) => this.commissionLedger!.sumByStoreId(s.id)))
      : stores.map(() => 0);

    return {
      total,
      subscriptions: stores.map((store, i) => {
        const sub = byStore.get(store.id) ?? null;
        return {
          store: {
            id: store.id,
            name: store.name,
            subdomain: store.subdomain,
            status: store.status,
            productCount: store.productCount,
          },
          tier: resolveTier(store, sub),
          trialEndsAt: store.trialEndsAt,
          commissionRate: store.commissionRate,
          aiStoreGenerations: store.aiStoreGenerations,
          aiDescriptions: store.aiDescriptions,
          commissionTotal: commissionTotals[i],
          subscription: sub ? sub.toJSON() : null,
        };
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// SetStorePlan — upsert an active subscription; paying clears the trial
// ---------------------------------------------------------------------------

export interface SetStorePlanInput {
  storeId: EntityId;
  plan: Plan;
  cycle?: BillingCycle;
  currentPeriodEnd?: string | null;
  status?: SubscriptionStatus;
}

export class SetStorePlan {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly subRepo: SubscriptionRepository,
  ) {}

  async execute(input: SetStorePlanInput): Promise<Result<{ storeId: string; plan: Plan }, StoreNotFoundError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new StoreNotFoundError());

    const existing = await this.subRepo.findActiveByStoreId(store.id);
    if (existing) {
      const updated = Subscription.from({
        ...existing.toJSON(),
        plan: input.plan,
        cycle: input.cycle ?? existing.cycle,
        currentPeriodEnd: input.currentPeriodEnd !== undefined ? input.currentPeriodEnd : existing.currentPeriodEnd,
        status: input.status ?? "active",
        updatedAt: new Date().toISOString(),
      });
      await this.subRepo.save(updated);
    } else {
      const created = Subscription.create({
        id: createEntityId(),
        storeId: store.id,
        plan: input.plan,
        cycle: input.cycle ?? "monthly",
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        status: input.status ?? "active",
      });
      await this.subRepo.save(created);
    }

    // First payment → trial ends (spec: "cleared on first payment") + resume if paused.
    store.setTrialEndsAt(null);
    store.resume();
    await this.storeRepo.save(store);

    return ok({ storeId: store.id, plan: input.plan });
  }
}

// ---------------------------------------------------------------------------
// UpdateStoreTrial — extend or clear the trial window
// ---------------------------------------------------------------------------

export interface UpdateStoreTrialInput {
  storeId: EntityId;
  /** Extend from now (or from the current deadline if still live). */
  extendTrialDays?: number;
  /** Set an exact deadline (ISO) — enables testing pause/reminder windows. */
  setTrialEndsAt?: string | null;
  clearTrial?: boolean;
}

export class UpdateStoreTrial {
  constructor(private readonly storeRepo: StoreRepository) {}

  async execute(input: UpdateStoreTrialInput): Promise<Result<{ storeId: string; trialEndsAt: string | null }, StoreNotFoundError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new StoreNotFoundError());

    if (input.clearTrial) {
      store.setTrialEndsAt(null);
    } else if (input.setTrialEndsAt !== undefined) {
      store.setTrialEndsAt(input.setTrialEndsAt);
      // A future deadline resumes a paused store (grace window).
      if (input.setTrialEndsAt && new Date(input.setTrialEndsAt).getTime() > Date.now()) {
        store.resume();
      }
    } else if (input.extendTrialDays) {
      const base = store.trialEndsAt && new Date(store.trialEndsAt).getTime() > Date.now()
        ? store.trialEndsAt
        : new Date().toISOString();
      store.setTrialEndsAt(new Date(new Date(base).getTime() + input.extendTrialDays * 86_400_000).toISOString());
      // Extending the trial also resumes a paused store (grace window).
      store.resume();
    }

    await this.storeRepo.save(store);
    return ok({ storeId: store.id, trialEndsAt: store.trialEndsAt });
  }
}
