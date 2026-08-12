import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
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
  type SingaPayWebhookPayload,
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

/**
 * Payment routes (mounted under /api):
 *   POST /api/orders/:orderId/payment        — create a payment attempt (public)
 *   GET  /api/orders/:orderId/payments       — payment status (public, for polling)
 *   POST /api/webhooks/xendit                — Xendit webhook (token-verified)
 *   POST /api/webhooks/singapay              — SingaPay webhook (HMAC-SHA512 verified)
 *   GET  /api/stores/:storeId/payments       — store payments (auth, owner)
 */

const paymentsRouter = new Hono<{ Bindings: Env }>();

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
  const canOnline = await new PlanService(new D1SubscriptionRepository(db)).canUseOnlineCheckout(store);
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
        const status = await createProviderClient(c.env, latest.provider).getInvoice(latest.externalId);
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
    },
  );
  const result = await useCase.execute(payload);

  if (!result.ok) {
    if (result.error instanceof PaymentNotFoundError) return c.json({ error: result.error }, 404);
    if (result.error instanceof WebhookAmountMismatchError) return c.json({ error: result.error }, 400);
    return c.json({ error: result.error }, 400);
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
  const secret = env.SINGAPAY_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: { code: "WEBHOOK_UNAVAILABLE", message: "Webhook SingaPay belum dikonfigurasi." } }, 503);
  }

  const rawBody = await c.req.text();
  // Headers → plain object (verify reads via bracket access, not Headers.get).
  const headerObj: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  const valid = await verifySingaPayWebhookSignature({
    rawBody,
    headers: headerObj,
    clientSecret: secret,
    endpoint: "/api/webhooks/singapay",
  });
  if (!valid) {
    return c.json({ error: { code: "WEBHOOK_UNAUTHORIZED" } }, 401);
  }

  let payload: SingaPayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SingaPayWebhookPayload;
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Payload JSON tidak valid." } }, 400);
  }

  const normalized = normalizeSingaPayWebhook(payload);
  if (!normalized) {
    return c.json({ handled: false });
  }

  // Subscriptions & pending plans are Xendit-backed — ignore their refs here.
  if (
    normalized.external_id.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX) ||
    normalized.external_id.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)
  ) {
    return c.json({ handled: false });
  }

  const db = createDb(env.DB);
  const useCase = new HandleXenditWebhook(
    new D1PaymentRepository(db),
    new D1OrderRepository(db),
    {
      storeRepo: new D1StoreRepository(db),
      ledger: new D1CommissionLedger(db),
    },
  );
  const result = await useCase.execute(normalized);

  if (!result.ok) {
    if (result.error instanceof PaymentNotFoundError) return c.json({ error: result.error }, 404);
    if (result.error instanceof WebhookAmountMismatchError) return c.json({ error: result.error }, 400);
    return c.json({ error: result.error }, 400);
  }

  return c.json({ handled: result.value.handled });
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
