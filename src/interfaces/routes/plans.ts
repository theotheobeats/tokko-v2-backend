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
import { createDb } from "../../infrastructure/db/drizzle";
import {
  createProviderClient,
  resolveActivePaymentProvider,
  providerIsReal,
} from "../../infrastructure/payments/registry";
import { D1AppSettingsRepository } from "../../infrastructure/repos/d1-app-settings-repo";
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

  // Route through the active provider (admin switch); real payments only —
  // no mock invoices for paid plans.
  const db = createDb(c.env.DB);
  const providerId = await resolveActivePaymentProvider((k) => new D1AppSettingsRepository(db).get(k));
  if (!providerIsReal(c.env, providerId)) {
    return c.json({ error: { code: "PAYMENT_UNAVAILABLE", message: "Pembayaran belum tersedia saat ini." } }, 502);
  }

  const provider = createProviderClient(c.env, providerId);
  const externalId = pendingPlanExternalId(session.user.id, plan, cycle, `${Date.now()}`);
  const frontendOrigin = c.env.FRONTEND_URL ?? "https://7okko.com";
  let invoice;
  try {
    invoice = await provider.createInvoice({
      externalId,
      amount,
      description: `Paket Tokko ${plan === "pro" ? "Pro" : "Commerce"} (${cycle === "annual" ? "tahunan" : "bulanan"})`,
      customer: { givenNames: session.user.name ?? undefined, email: session.user.email },
      successRedirectUrl: `${frontendOrigin}/onboarding`,
      failureRedirectUrl: `${frontendOrigin}/choose-plan`,
    });
  } catch (e) {
    return c.json({
      error: { code: "PAYMENT_PROVIDER_ERROR", message: e instanceof Error ? e.message : "Gagal membuat pembayaran." },
    }, 502);
  }

  // #10: email the invoice + payment link to the merchant (best-effort).
  try {
    const { notifyPlanInvoice } = await import("../../application/order/notify-payment");
    await notifyPlanInvoice({
      env: c.env,
      email: session.user.email,
      plan,
      cycle,
      amount,
      invoiceUrl: invoice.invoiceUrl,
    });
  } catch { /* non-blocking */ }

  return c.json({ invoiceUrl: invoice.invoiceUrl, externalId, plan, cycle, amount }, 201);
});

export { plansRouter };
