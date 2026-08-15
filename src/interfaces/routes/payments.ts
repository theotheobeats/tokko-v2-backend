import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import type { Env } from "../../types";
import { requireUser } from "../middleware/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import { D1PaymentRepository } from "../../infrastructure/repos/d1-payment-repo";
import { D1CommissionLedger } from "../../infrastructure/repos/d1-commission-ledger";
import { D1OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { PlanService } from "../../application/plan/plan-service";
import { createProviderClient, resolveActivePaymentProvider } from "../../infrastructure/payments/registry";
import { D1AppSettingsRepository } from "../../infrastructure/repos/d1-app-settings-repo";
import {
  verifySingaPayWebhookSignature,
  normalizeSingaPayWebhook,
  normalizeSingaPayDisbursementWebhook,
  normalizeSingaPaySettlementWebhook,
  resolveWebhookSecret,
  type SingaPayWebhookPayload,
  type SingaPayDisbursementWebhookPayload,
  type SingaPaySettlementWebhookPayload,
} from "../../infrastructure/payments/singapay-webhook";
import { SUBSCRIPTION_EXTERNAL_ID_PREFIX, PENDING_PLAN_EXTERNAL_ID_PREFIX } from "../../domain/plan/pricing";
import { D1PendingPlanRepository } from "../../infrastructure/repos/d1-pending-plan-repo";
import {
  CreatePayment,
  HandleXenditWebhook,
  ListOrderPayments,
  ListStorePayments,
  OrderNotFoundError,
  PaymentProviderError,
  WebhookUnauthorizedError,
  WebhookAmountMismatchError,
  PaymentNotFoundError,
  type XenditWebhookPayload,
} from "../../application/payment/payment-use-cases";
import type { EntityId } from "../../domain/shared/types";
import { PaymentChannel } from "../../domain/payment/types";
import { D1PayoutRepository } from "../../infrastructure/repos/d1-payout-repo";
import { GetPayoutSummary, HandleDisbursementWebhook, PayoutStoreNotFoundError } from "../../application/admin/admin-payouts";
import { createSingaPayAccountsClient } from "../../infrastructure/payments/singapay-client";
import { D1SettlementRepository } from "../../infrastructure/repos/d1-settlement-repo";
import { D1PayoutRequestRepository } from "../../infrastructure/repos/d1-payout-request-repo";
import { HandleSettlementWebhook } from "../../application/payout/settlement-webhook";
import {
  CreatePayoutRequest,
  CancelPayoutRequest,
  ListPayoutRequests,
  PayoutStoreNotFoundError as PayoutRequestStoreNotFoundError,
  PayoutNoAccountError as PayoutRequestNoAccountError,
  PayoutKYBNotVerifiedError as PayoutRequestKYBNotVerifiedError,
  PayoutNoBankError as PayoutRequestNoBankError,
  PayoutInsufficientBalanceError as PayoutRequestInsufficientBalanceError,
  PayoutRequestExistsError,
  PayoutRequestInvalidAmountError,
  PayoutTierRequiredError,
  PayoutRequestNotFoundError,
  PayoutRequestNotOwnedError,
  PayoutRequestNotReviewableError,
} from "../../application/payout/payout-requests";
import { GetEarningsDashboard, EarningsStoreNotFoundError } from "../../application/payout/earnings";
import { resolveTestAccess, isTestEmail } from "../../application/payout/test-access";

/**
 * Payment routes (mounted under /api):
 *   POST /api/orders/:orderId/payment        — create a payment attempt (public)
 *   GET  /api/orders/:orderId/payments       — payment status (public, for polling)
 *   POST /api/webhooks/xendit                — Xendit webhook (token-verified)
 *   POST /api/webhooks/singapay              — SingaPay webhook (HMAC-SHA512 verified)
 *   GET  /api/stores/:storeId/payments       — store payments (auth, owner)
 */

const paymentsRouter = new Hono<{ Bindings: Env }>();

/** Payment webhook email hooks (#5 merchant payment-received, #6 customer invoice) — best-effort. */
async function notifyPaidEmails(db: ReturnType<typeof createDb>, env: Env, externalId: string): Promise<void> {
  try {
    const payment = await new D1PaymentRepository(db).findByExternalId(externalId);
    if (!payment || !payment.isPaid) return;
    const order = await new D1OrderRepository(db).findById(payment.orderId);
    if (!order) return;
    const { notifyOrderPayment } = await import("../../application/order/notify-payment");
    await notifyOrderPayment({ db, env, payment, order });
  } catch (e) {
    console.error("[notify] paid-email hook failed:", e);
  }
}

const createPaymentSchema = z.object({
  channel: z
    .enum(Object.values(PaymentChannel) as [string, ...string[]])
    .optional(),
  paymentMethodIds: z.array(z.string()).max(20).optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  customerEmail: z.string().email().optional().or(z.literal("")),
  successRedirectUrl: z.string().max(500).optional(),
  failureRedirectUrl: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/payment (public)
// ---------------------------------------------------------------------------
paymentsRouter.post("/orders/:orderId/payment", zValidator("json", createPaymentSchema), async (c) => {
  const orderId = c.req.param("orderId") as EntityId;
  const db = createDb(c.env.DB);
  const input = c.req.valid("json");

  // Gate: online checkout is Pro & Commerce (defense in depth — the storefront
  // also hides it via the payload's effective paymentOnline).
  const order = await new D1OrderRepository(db).findById(orderId);
  if (!order) return c.json({ error: { code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan." } }, 404);
  const store = await new D1StoreRepository(db).findById(order.storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
  // Test-owner bypass (KYB_TEST_EMAILS): the whitelisted owner may pay their
  // own store online without a Pro/Commerce plan (staging checkout testing).
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const isTestOwner =
    !!session && session.user.id === store.ownerId && isTestEmail(session.user.email, resolveTestAccess(c.env));
  const canOnline =
    isTestOwner || (await new PlanService(new D1SubscriptionRepository(db)).canUseOnlineCheckout(store));
  if (!canOnline) {
    return c.json({
      error: { code: "PLAN_REQUIRED", message: "Pembayaran online tersedia di paket Pro dan Commerce." },
    }, 403);
  }

  // Route through the active payment provider (admin switch, app_settings).
  const settings = new D1AppSettingsRepository(db);
  const providerId = await resolveActivePaymentProvider((k) => settings.get(k));

  const useCase = new CreatePayment(
    new D1OrderRepository(db),
    new D1PaymentRepository(db),
    createProviderClient(c.env, providerId),
  );

  const result = await useCase.execute({
    orderId,
    channel: input.channel,
    paymentMethodIds: input.paymentMethodIds,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail || undefined,
    successRedirectUrl: input.successRedirectUrl,
    failureRedirectUrl: input.failureRedirectUrl,
    provider: providerId,
  });

  if (!result.ok) {
    if (result.error instanceof OrderNotFoundError) {
      return c.json({ error: result.error }, 404);
    }
    if (result.error instanceof PaymentProviderError) {
      return c.json({ error: result.error }, 502);
    }
    return c.json({ error: result.error }, 400);
  }

  return c.json({ payment: result.value.toJSON() }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/payments (public — status polling)
// ---------------------------------------------------------------------------
paymentsRouter.get("/orders/:orderId/payments", async (c) => {
  const orderId = c.req.param("orderId") as EntityId;
  const db = createDb(c.env.DB);
  const paymentRepo = new D1PaymentRepository(db);
  const payments = await new ListOrderPayments(paymentRepo).execute({ orderId });

  // Self-heal: if the latest attempt is still pending but older than 10
  // minutes, reconcile against Xendit directly — a webhook may have been
  // lost/delayed (Xendit retries, but never rely on it). Mutates the domain
  // object, so the response below reflects the corrected status.
  const latest = payments[payments.length - 1];
  if (latest && latest.status === "pending" && latest.createdAt) {
    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    if (ageMs > 10 * 60 * 1000) {
      try {
        // Reconcile against the store's own sub-account (merchant KYB).
        const store = await new D1StoreRepository(db).findById(latest.storeId);
        const status = await createProviderClient(c.env, latest.provider).getInvoice(
          latest.externalId,
          store?.singapayAccountId ?? undefined,
        );
        if (status.status === "PAID") latest.markPaid(status.paidAt ?? undefined);
        else if (status.status === "EXPIRED") latest.markExpired();
        else if (status.status === "FAILED") latest.markFailed();
        if (latest.status !== "pending") await paymentRepo.save(latest);
      } catch {
        // provider unavailable — keep polling
      }
    }
  }

  return c.json({
    payments: payments.map((p) => p.toJSON()),
    latest: payments.length > 0 ? payments[payments.length - 1].toJSON() : null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/xendit (Xendit server → verified)
// ---------------------------------------------------------------------------
paymentsRouter.post("/webhooks/xendit", async (c) => {
  const env = c.env as Env;

  // Verify the callback token header.
  const token = c.req.header("x-callback-token");
  if (!env.XENDIT_WEBHOOK_TOKEN || token !== env.XENDIT_WEBHOOK_TOKEN) {
    return c.json({ error: { code: "WEBHOOK_UNAUTHORIZED" } }, 401);
  }

  const payload = (await c.req.json().catch(() => null)) as XenditWebhookPayload | null;
  if (!payload?.external_id) {
    return c.json({ error: { code: "VALIDATION", message: "external_id diperlukan." } }, 400);
  }

  const db = createDb(env.DB);

  // Pre-store plan purchase (plan-selection gate at signup) → pending plan row.
  if (payload?.external_id?.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)) {
    const { HandlePendingPlanPayment, PendingPlanAmountMismatchError } =
      await import("../../application/plan/pending-plan");
    const pendingResult = await new HandlePendingPlanPayment(
      new D1PendingPlanRepository(db),
      new D1StoreRepository(db),
      new D1SubscriptionRepository(db),
    ).execute(payload);
    if (!pendingResult.ok) {
      if (pendingResult.error instanceof PendingPlanAmountMismatchError) {
        return c.json({ error: { code: "PENDING_PLAN_AMOUNT_MISMATCH" } }, 400);
      }
      return c.json({ error: { code: "UNKNOWN" } }, 400);
    }
    return c.json({ handled: pendingResult.value.handled });
  }

  // Subscription invoices (tokko-sub::…) route to plan activation;
  // everything else is an order payment.
  if (payload?.external_id?.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX)) {
    const { HandleSubscriptionInvoice, SubscriptionStoreNotFoundError, SubscriptionAmountMismatchError } =
      await import("../../application/plan/subscription-webhook");
    const subResult = await new HandleSubscriptionInvoice(
      new D1StoreRepository(db),
      new D1SubscriptionRepository(db),
    ).execute(payload);
    if (!subResult.ok) {
      if (subResult.error instanceof SubscriptionStoreNotFoundError) {
        return c.json({ error: { code: "SUBSCRIPTION_STORE_NOT_FOUND" } }, 404);
      }
      if (subResult.error instanceof SubscriptionAmountMismatchError) {
        return c.json({ error: { code: "SUBSCRIPTION_AMOUNT_MISMATCH" } }, 400);
      }
      return c.json({ error: { code: "UNKNOWN" } }, 400);
    }
    return c.json({ handled: subResult.value.handled });
  }

  const useCase = new HandleXenditWebhook(
    new D1PaymentRepository(db),
    new D1OrderRepository(db),
    {
      storeRepo: new D1StoreRepository(db),
      ledger: new D1CommissionLedger(db),
      subscriptionRepo: new D1SubscriptionRepository(db),
    },
  );
  const result = await useCase.execute(payload);

  if (!result.ok) {
    if (result.error instanceof PaymentNotFoundError) return c.json({ error: result.error }, 404);
    if (result.error instanceof WebhookAmountMismatchError) return c.json({ error: result.error }, 400);
    return c.json({ error: result.error }, 400);
  }

  if (result.ok && payload.status === "PAID") {
    await notifyPaidEmails(db, c.env, payload.external_id);
  }

  return c.json({ handled: result.value.handled });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/singapay (SingaPay server → HMAC-SHA512 verified)
//
// Register this path (https://staging-api.7okko.com/api/webhooks/singapay) as
// the merchant's `transaction_notif_url`. The endpoint string used for
// signature verification MUST match the configured path exactly.
// Order payments only — subscriptions/pending plans stay on Xendit for now.
// ---------------------------------------------------------------------------
paymentsRouter.post("/webhooks/singapay", async (c) => {
  const env = c.env as Env;
  // SingaPay signs inbound webhooks with the merchant CLIENT_SECRET (per their
  // docs). Fall back to the legacy webhook secret for older setups.
  const secret = resolveWebhookSecret(env);
  if (!secret) {
    return c.json({ error: { code: "WEBHOOK_UNAVAILABLE", message: "Webhook SingaPay belum dikonfigurasi." } }, 503);
  }

  const rawBody = await c.req.text();
  // Headers → plain object (verify reads via bracket access, not Headers.get).
  const headerObj: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headerObj[key] = value;
  });

  // Receipt log — every SingaPay webhook is visible in worker logs, with the
  // outcome, so lost/rejected deliveries (e.g. the 5-min replay-window 401
  // incident) are never invisible again.
  console.log("[webhook:singapay] received", {
    event: (() => { try { return (JSON.parse(rawBody) as { event?: string })?.event ?? null; } catch { return null; } })(),
    hasSignature: Boolean(headerObj["x-signature"]),
    hasTimestamp: Boolean(headerObj["x-timestamp"]),
  });

  const valid = await verifySingaPayWebhookSignature({
    rawBody,
    headers: headerObj,
    clientSecret: secret,
    endpoint: "/api/webhooks/singapay",
  });
  if (!valid) {
    console.warn("[webhook:singapay] unauthorized", {
      signature: headerObj["x-signature"] ? "present" : "missing",
      timestamp: headerObj["x-timestamp"] ?? "missing",
    });
    return c.json({ error: { code: "WEBHOOK_UNAUTHORIZED" } }, 401);
  }

  let payload: SingaPayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SingaPayWebhookPayload;
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Payload JSON tidak valid." } }, 400);
  }

  const normalized = normalizeSingaPayWebhook(payload);
  console.log("[webhook:singapay] verified", {
    externalId: normalized?.external_id ?? null,
    status: normalized?.status ?? null,
    event: payload?.event ?? null,
  });

  // Shared-endpoint resilience (docs: "Shared Webhook Endpoints" — events are
  // routed by payload shape when multiple notif_urls point at one URL). If the
  // disbursement/settlement URLs were configured to hit this path, dispatch by
  // shape so money-out events are never swallowed by the payment-link handler.
  if (!normalized) {
    const disb = normalizeSingaPayDisbursementWebhook(payload as SingaPayDisbursementWebhookPayload);
    if (disb) {
      const db = createDb(env.DB);
      const disbResult = await new HandleDisbursementWebhook(
        new D1PayoutRepository(db),
        new D1PayoutRequestRepository(db),
      ).execute(disb);
      if (!disbResult.ok) return c.json({ error: { code: "PAYOUT_NOT_FOUND" } }, 404);
      return c.json({ handled: disbResult.value.handled });
    }
    const settlement = normalizeSingaPaySettlementWebhook(payload as SingaPaySettlementWebhookPayload);
    if (settlement) {
      const db = createDb(env.DB);
      const settResult = await new HandleSettlementWebhook(
        new D1SettlementRepository(db),
        new D1StoreRepository(db),
      ).execute(settlement);
      if (!settResult.ok) return c.json({ error: { code: "UNKNOWN" } }, 400);
      return c.json({ handled: settResult.value.handled });
    }
    return c.json({ handled: false });
  }

  const db = createDb(env.DB);

  // Pre-store plan purchase (plan-selection gate at signup) → pending plan row.
  if (normalized.external_id.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)) {
    const { HandlePendingPlanPayment, PendingPlanAmountMismatchError } =
      await import("../../application/plan/pending-plan");
    const pendingResult = await new HandlePendingPlanPayment(
      new D1PendingPlanRepository(db),
      new D1StoreRepository(db),
      new D1SubscriptionRepository(db),
    ).execute(normalized);
    if (!pendingResult.ok) {
      if (pendingResult.error instanceof PendingPlanAmountMismatchError) {
        return c.json({ error: { code: "PENDING_PLAN_AMOUNT_MISMATCH" } }, 400);
      }
      return c.json({ error: { code: "UNKNOWN" } }, 400);
    }
    return c.json({ handled: pendingResult.value.handled });
  }

  // Subscription invoices (tokko-sub::…) route to plan activation.
  if (normalized.external_id.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX)) {
    const { HandleSubscriptionInvoice, SubscriptionStoreNotFoundError, SubscriptionAmountMismatchError } =
      await import("../../application/plan/subscription-webhook");
    const subResult = await new HandleSubscriptionInvoice(
      new D1StoreRepository(db),
      new D1SubscriptionRepository(db),
    ).execute(normalized);
    if (!subResult.ok) {
      if (subResult.error instanceof SubscriptionStoreNotFoundError) {
        return c.json({ error: { code: "SUBSCRIPTION_STORE_NOT_FOUND" } }, 404);
      }
      if (subResult.error instanceof SubscriptionAmountMismatchError) {
        return c.json({ error: { code: "SUBSCRIPTION_AMOUNT_MISMATCH" } }, 400);
      }
      return c.json({ error: { code: "UNKNOWN" } }, 400);
    }
    return c.json({ handled: subResult.value.handled });
  }

  const useCase = new HandleXenditWebhook(
    new D1PaymentRepository(db),
    new D1OrderRepository(db),
    {
      storeRepo: new D1StoreRepository(db),
      ledger: new D1CommissionLedger(db),
      subscriptionRepo: new D1SubscriptionRepository(db),
    },
  );
  const result = await useCase.execute(normalized);

  if (!result.ok) {
    if (result.error instanceof PaymentNotFoundError) return c.json({ error: result.error }, 404);
    if (result.error instanceof WebhookAmountMismatchError) return c.json({ error: result.error }, 400);
    return c.json({ error: result.error }, 400);
  }

  if (result.ok && normalized.status === "PAID") {
    await notifyPaidEmails(db, c.env, normalized.external_id);
  }

  return c.json({ handled: result.value.handled });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/singapay/disbursement (SingaPay server → verified)
//
// Money-out results. Register this path as the `disbursement_notif_url`;
// the signature endpoint string MUST match the configured path exactly.
// Flipping payouts `submitted → settled/failed` removes the manual inquiry
// step from the admin workflow.
// ---------------------------------------------------------------------------
paymentsRouter.post("/webhooks/singapay/disbursement", async (c) => {
  const env = c.env as Env;
  const secret = env.SINGAPAY_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: { code: "WEBHOOK_UNAVAILABLE", message: "Webhook SingaPay belum dikonfigurasi." } }, 503);
  }

  const rawBody = await c.req.text();
  const headerObj: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  const valid = await verifySingaPayWebhookSignature({
    rawBody,
    headers: headerObj,
    clientSecret: secret,
    endpoint: "/api/webhooks/singapay/disbursement",
  });
  if (!valid) {
    return c.json({ error: { code: "WEBHOOK_UNAUTHORIZED" } }, 401);
  }

  let payload: SingaPayDisbursementWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SingaPayDisbursementWebhookPayload;
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Payload JSON tidak valid." } }, 400);
  }

  const normalized = normalizeSingaPayDisbursementWebhook(payload);
  if (!normalized) {
    return c.json({ handled: false });
  }

  const db = createDb(env.DB);
  const result = await new HandleDisbursementWebhook(
    new D1PayoutRepository(db),
    new D1PayoutRequestRepository(db),
  ).execute(normalized);
  if (!result.ok) {
    // Unknown payout ref — 404 so SingaPay retries (covers the race where
    // the notification lands before the payout row is committed).
    return c.json({ error: { code: "PAYOUT_NOT_FOUND" } }, 404);
  }

  return c.json({ handled: result.value.handled });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/singapay/settlement (SingaPay server → verified)
//
// Clearing process: a settlement batch completed (pending_balance →
// available_balance) or a settled transaction was refunded. Register this path
// as the `settlement_notif_url`; the signature endpoint string MUST match the
// configured path exactly. Batches are recorded idempotently per reference_no.
// ---------------------------------------------------------------------------
paymentsRouter.post("/webhooks/singapay/settlement", async (c) => {
  const env = c.env as Env;
  const secret = env.SINGAPAY_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: { code: "WEBHOOK_UNAVAILABLE", message: "Webhook SingaPay belum dikonfigurasi." } }, 503);
  }

  const rawBody = await c.req.text();
  const headerObj: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  const valid = await verifySingaPayWebhookSignature({
    rawBody,
    headers: headerObj,
    clientSecret: secret,
    endpoint: "/api/webhooks/singapay/settlement",
  });
  if (!valid) {
    return c.json({ error: { code: "WEBHOOK_UNAUTHORIZED" } }, 401);
  }

  let payload: SingaPaySettlementWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SingaPaySettlementWebhookPayload;
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Payload JSON tidak valid." } }, 400);
  }

  const normalized = normalizeSingaPaySettlementWebhook(payload);
  if (!normalized) {
    // Unknown event or missing reference — acknowledge so SingaPay stops retrying.
    return c.json({ handled: false });
  }

  const db = createDb(env.DB);
  const result = await new HandleSettlementWebhook(
    new D1SettlementRepository(db),
    new D1StoreRepository(db),
  ).execute(normalized);
  if (!result.ok) {
    return c.json({ error: { code: "UNKNOWN" } }, 400);
  }

  return c.json({ handled: result.value.handled });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/payouts (auth, owner)
//
// Merchant-facing saldo + payout history (orange #8 — UU model: merchants
// see their SingaPay balance and disbursement status; only admins move money).
// ---------------------------------------------------------------------------
paymentsRouter.get("/stores/:storeId/payouts", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const summaryResult = await new GetPayoutSummary(
    storeRepo,
    new D1CommissionLedger(db),
    createSingaPayAccountsClient(c.env),
    resolveTestAccess(c.env),
  ).execute(storeId, session.user.email);
  if (!summaryResult.ok) {
    return c.json(
      { error: summaryResult.error },
      summaryResult.error instanceof PayoutStoreNotFoundError ? 404 : 502,
    );
  }

  const history = await new D1PayoutRepository(db).list({ storeId, limit: 20 });
  return c.json({
    summary: summaryResult.value,
    payouts: history.payouts,
    total: history.total,
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/earnings (auth, owner)
//
// Merchant earnings dashboard: live balance + ready-to-payout, period earnings
// from paid orders, clearing (pending balance + settlement batches) and the
// merged transaction log. Data source = our own orders/payments + live
// SingaPay balance (no provider statement polling).
// ---------------------------------------------------------------------------
paymentsRouter.get("/stores/:storeId/earnings", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const result = await new GetEarningsDashboard(
    storeRepo,
    new D1CommissionLedger(db),
    createSingaPayAccountsClient(c.env),
    new D1OrderRepository(db),
    new D1PayoutRepository(db),
    new D1PayoutRequestRepository(db),
    new D1SettlementRepository(db),
    resolveTestAccess(c.env),
  ).execute(storeId, session.user.email);

  if (!result.ok) {
    return c.json(
      { error: result.error },
      result.error instanceof EarningsStoreNotFoundError ? 404 : 502,
    );
  }
  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// Payout requests (auth, owner) — merchant requests a pencairan; admin reviews.
//   POST /api/stores/:storeId/payout-requests        { amount?, note? }
//   GET  /api/stores/:storeId/payout-requests?status=
//   POST /api/stores/:storeId/payout-requests/:id/cancel
// ---------------------------------------------------------------------------
paymentsRouter.post(
  "/stores/:storeId/payout-requests",
  zValidator("json", z.object({ amount: z.number().int().positive().optional(), note: z.string().max(500).optional() })),
  async (c) => {
    const session = await requireUser(c);
    if (session instanceof Response) return session;

    const storeId = c.req.param("storeId") as EntityId;
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);
    const storeRepo = new D1StoreRepository(db);
    const store = await storeRepo.findById(storeId);
    if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
    if (store.ownerId !== session.user.id) {
      return c.json({ error: { code: "FORBIDDEN" } }, 403);
    }

    const result = await new CreatePayoutRequest(
      storeRepo,
      new D1CommissionLedger(db),
      new D1PayoutRequestRepository(db),
      createSingaPayAccountsClient(c.env),
      resolveTestAccess(c.env),
      new D1SubscriptionRepository(db),
    ).execute(storeId, body, session.user.email);

    if (!result.ok) {
      const status =
        result.error instanceof PayoutRequestStoreNotFoundError ? 404
        : result.error instanceof PayoutRequestKYBNotVerifiedError ? 403
        : result.error instanceof PayoutRequestNoAccountError ? 400
        : result.error instanceof PayoutRequestNoBankError ? 400
        : result.error instanceof PayoutRequestInsufficientBalanceError ? 400
        : result.error instanceof PayoutRequestInvalidAmountError ? 400
        : result.error instanceof PayoutRequestExistsError ? 409
        : result.error instanceof PayoutTierRequiredError ? 403
        : 400;
      return c.json({ error: result.error }, status);
    }

    return c.json({ request: result.value.request, readyToPayout: result.value.readyToPayout }, 201);
  },
);

paymentsRouter.get("/stores/:storeId/payout-requests", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const res = await new ListPayoutRequests(new D1PayoutRequestRepository(db)).execute({
    storeId,
    limit: 50,
  });
  return c.json(res);
});

paymentsRouter.post("/stores/:storeId/payout-requests/:requestId/cancel", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const requestId = c.req.param("requestId");
  const db = createDb(c.env.DB);
  const result = await new CancelPayoutRequest(
    new D1PayoutRequestRepository(db),
    new D1StoreRepository(db),
  ).execute(requestId, session.user.id as EntityId);

  if (!result.ok) {
    const status =
      result.error instanceof PayoutRequestNotFoundError ? 404
      : result.error instanceof PayoutRequestNotOwnedError ? 403
      : result.error instanceof PayoutRequestNotReviewableError ? 409
      : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ request: result.value.request });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/payments (auth, owner)
// ---------------------------------------------------------------------------
paymentsRouter.get("/stores/:storeId/payments", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const status = c.req.query("status");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const useCase = new ListStorePayments(new D1PaymentRepository(db));
  const res = await useCase.execute({ storeId, status: status as never, limit, offset });
  return c.json({
    payments: res.payments.map((p) => p.toJSON()),
    total: res.total,
  });
});

export { paymentsRouter };
