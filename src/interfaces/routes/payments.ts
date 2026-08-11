import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../types";
import { requireUser } from "../middleware/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import { D1PaymentRepository } from "../../infrastructure/repos/d1-payment-repo";
import { D1OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { PlanService } from "../../application/plan/plan-service";
import { createPaymentProvider } from "../../infrastructure/payments/xendit-client";
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

  // Gate: online checkout is Commerce-only (defense in depth — the storefront
  // also hides it via the payload's effective paymentOnline).
  const order = await new D1OrderRepository(db).findById(orderId);
  if (!order) return c.json({ error: { code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan." } }, 404);
  const store = await new D1StoreRepository(db).findById(order.storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);
  const canOnline = await new PlanService(new D1SubscriptionRepository(db)).canUseOnlineCheckout(store);
  if (!canOnline) {
    return c.json({
      error: { code: "PLAN_REQUIRED", message: "Pembayaran online tersedia di paket Commerce." },
    }, 403);
  }

  const useCase = new CreatePayment(
    new D1OrderRepository(db),
    new D1PaymentRepository(db),
    createPaymentProvider(c.env),
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
  const payments = await new ListOrderPayments(new D1PaymentRepository(db)).execute({ orderId });
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
  const useCase = new HandleXenditWebhook(new D1PaymentRepository(db), new D1OrderRepository(db));
  const result = await useCase.execute(payload);

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
