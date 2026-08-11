/**
 * Subscription value object — paid tier state for a store.
 */

import type { BillingCycle, Plan, SubscriptionStatus } from "./types";

export interface SubscriptionProps {
  id: string;
  storeId: string;
  plan: Plan;
  cycle: BillingCycle;
  priceId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  externalRef: string | null;
  startedAt: string;
  updatedAt: string;
}

export class Subscription {
  private constructor(private readonly props: SubscriptionProps) {}

  static create(params: {
    id: string;
    storeId: string;
    plan: Plan;
    cycle?: BillingCycle;
    priceId?: string | null;
    status?: SubscriptionStatus;
    currentPeriodEnd?: string | null;
    externalRef?: string | null;
    startedAt?: string;
    updatedAt?: string;
  }): Subscription {
    return new Subscription({
      id: params.id,
      storeId: params.storeId,
      plan: params.plan,
      cycle: params.cycle ?? "monthly",
      priceId: params.priceId ?? null,
      status: params.status ?? "active",
      currentPeriodEnd: params.currentPeriodEnd ?? null,
      externalRef: params.externalRef ?? null,
      startedAt: params.startedAt ?? new Date().toISOString(),
      updatedAt: params.updatedAt ?? new Date().toISOString(),
    });
  }

  static from(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  get id() { return this.props.id; }
  get storeId() { return this.props.storeId; }
  get plan() { return this.props.plan; }
  get cycle() { return this.props.cycle; }
  get priceId() { return this.props.priceId; }
  get status() { return this.props.status; }
  get currentPeriodEnd() { return this.props.currentPeriodEnd; }
  get externalRef() { return this.props.externalRef; }
  get startedAt() { return this.props.startedAt; }
  get updatedAt() { return this.props.updatedAt; }

  /** Active = status active AND the paid period hasn't ended. */
  get isActive(): boolean {
    if (this.props.status !== "active") return false;
    if (!this.props.currentPeriodEnd) return true;
    return new Date(this.props.currentPeriodEnd).getTime() > Date.now();
  }

  toJSON(): SubscriptionProps {
    return { ...this.props };
  }
}
