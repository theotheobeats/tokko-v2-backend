/**
 * Plans router — pre-store plan purchase (the plan-selection gate at signup).
 *
 *   POST /api/plans/checkout  (auth)  { plan, cycle }
 *     → Xendit invoice (external_id tokko-pre::<userId>::<plan>::<cycle>::<nonce>)
 *     → on PAID, the webhook records a pending plan; onboarding consumes it
 *       to create the store's subscription (no trial). Free path skips this
 *       and the store starts a 14-day trial instead.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import type { Env } from "../../types";
import { createPaymentProvider, useRealPayments } from "../../infrastructure/payments/xendit-client";
import { pendingPlanExternalId, priceFor } from "../../domain/plan/pricing";

const plansRouter = new Hono<{ Bindings: Env }>();

plansRouter.post("/checkout", zValidator("json", z.object({
  plan: z.enum(["pro", "commerce"]),
  cycle: z.enum(["monthly", "annual"]).default("annual"),
})), async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }

  const { plan, cycle } = c.req.valid("json");
  const amount = priceFor(plan, cycle);

  // Real payments required — no mock invoices for paid plans.
  if (!useRealPayments(c.env)) {
    return c.json({ error: { code: "PAYMENT_UNAVAILABLE", message: "Pembayaran belum tersedia saat ini." } }, 502);
  }

  const provider = createPaymentProvider(c.env);
  const externalId = pendingPlanExternalId(session.user.id, plan, cycle, `${Date.now()}`);
  const frontendOrigin = c.env.FRONTEND_URL ?? "https://7okko.com";
  const invoice = await provider.createInvoice({
    externalId,
    amount,
    description: `Paket Tokko ${plan === "pro" ? "Pro" : "Commerce"} (${cycle === "annual" ? "tahunan" : "bulanan"})`,
    customer: { givenNames: session.user.name ?? undefined, email: session.user.email },
    successRedirectUrl: `${frontendOrigin}/onboarding`,
    failureRedirectUrl: `${frontendOrigin}/choose-plan`,
  });

  return c.json({ invoiceUrl: invoice.invoiceUrl, externalId, plan, cycle, amount }, 201);
});

export { plansRouter };
