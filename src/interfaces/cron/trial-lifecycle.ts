/**
 * Trial-lifecycle job runner — wires the pure use case to env bindings.
 * Used by the cron `scheduled` handler and the admin test endpoint.
 */

import type { Env } from "../../types";
import { createDb } from "../../infrastructure/db/drizzle";
import { RunTrialLifecycle, type TrialLifecycleResult } from "../../application/plan/trial-lifecycle";
import { ResendEmailer } from "../../infrastructure/email/resend";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { D1AdminUserRepository } from "../../infrastructure/repos/d1-admin-user-repo";
import type { EntityId } from "../../domain/shared/types";

export async function runTrialLifecycle(env: Env): Promise<TrialLifecycleResult> {
  const db = createDb(env.DB);
  const userRepo = new D1AdminUserRepository(db);

  // Auto-renewal invoices need real payments (no mock invoices for billing).
  const { createPaymentProvider, useRealPayments } = await import("../../infrastructure/payments/xendit-client");
  const { subscriptionExternalId, priceFor } = await import("../../domain/plan/pricing");
  const provider = createPaymentProvider(env);
  const createRenewalInvoice = useRealPayments(env)
    ? async (input: { store: { id: string }; plan: "pro" | "commerce"; cycle: "monthly" | "annual" }) => {
        const externalId = subscriptionExternalId(input.store.id, input.plan, input.cycle, `renew-${Date.now()}`);
        const invoice = await provider.createInvoice({
          externalId,
          amount: priceFor(input.plan, input.cycle),
          description: `Perpanjangan langganan Tokko ${input.plan === "pro" ? "Pro" : "Commerce"} (${input.cycle})`,
        });
        return { externalId: invoice.externalId };
      }
    : undefined;

  const job = new RunTrialLifecycle(
    new D1StoreRepository(db),
    new D1SubscriptionRepository(db),
    new ResendEmailer(env),
    async (userId) => (await userRepo.findById(userId as EntityId))?.email ?? null,
    env.FRONTEND_URL ?? "https://7okko.com",
    createRenewalInvoice,
  );
  return job.execute();
}
