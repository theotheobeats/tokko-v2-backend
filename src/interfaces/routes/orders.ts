import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { SubmitOrder } from "../../application/order/submit-order";
import { ListOrders } from "../../application/order/list-orders";
import { UpdateOrderStatus } from "../../application/order/update-order-status";
import { UpdateOrderFulfillment } from "../../application/order/update-order-fulfillment";
import { D1OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import { D1ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import type { EntityId } from "../../domain/shared/types";
import { OrderStatus } from "../../domain/order/types";

const ordersRouter = new Hono<{ Bindings: Env }>();

async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

const submitSchema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1),
  })).min(1),
  notes: z.string().optional(),
  shippingAddress: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["pending", "contacted", "completed"]),
});

const fulfillmentSchema = z.object({
  trackingNumber: z.string().optional(),
  courier: z.string().optional(),
  paymentConfirmed: z.boolean().optional(),
  paymentNote: z.string().optional(),
  queueNumber: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/orders (public)
// ---------------------------------------------------------------------------
ordersRouter.post("/:storeId/orders", zValidator("json", submitSchema), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  // Verify store exists and is published
  const store = await storeRepo.findById(storeId);
  if (!store) {
    return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }
  if (!store.isPublished) {
    return c.json({ error: { code: "STORE_NOT_PUBLISHED", message: "Toko belum dipublikasikan." } }, 404);
  }

  const input = c.req.valid("json");
  const orderRepo = new D1OrderRepository(db);
  const productRepo = new D1ProductRepository(db);
  const useCase = new SubmitOrder(orderRepo, productRepo);

  const result = await useCase.execute({
    storeId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    items: input.items.map((i) => ({ productId: i.productId as EntityId, quantity: i.quantity })),
    notes: input.notes,
    shippingAddress: input.shippingAddress,
  });

  if (!result.ok) {
    const status = result.error.code === "PRODUCT_UNAVAILABLE" ? 400 : 400;
    return c.json({ error: result.error }, status);
  }

  // Build WhatsApp deep link for the store owner
  const waMessage = encodeURIComponent(
    `Halo! Pesanan baru ${result.value.orderCode} dari ${result.value.customerName}:\n\n` +
    result.value.items.map((i: any) => `- ${i.productName} x${i.quantity} = Rp ${i.quantity * i.unitPrice}`).join("\n") +
    `\n\nTotal: Rp ${result.value.totalAmount}` +
    (result.value.shippingAddress ? `\n\nAlamat kirim: ${result.value.shippingAddress}` : "") +
    (result.value.notes ? `\n\nCatatan: ${result.value.notes}` : "")
  );
  const waDeepLink = `https://wa.me/${store.whatsappNumber.replace(/\D/g, "")}?text=${waMessage}`;

  return c.json({
    order: result.value,
    waDeepLink,
  }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/orders (auth, owner)
// ---------------------------------------------------------------------------
ordersRouter.get("/:storeId/orders", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const status = c.req.query("status") as OrderStatus | undefined;
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const orderRepo = new D1OrderRepository(db);
  const useCase = new ListOrders(orderRepo);

  const result = await useCase.execute({ storeId, status, limit, offset });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/orders/:id (auth, owner)
// ---------------------------------------------------------------------------
ordersRouter.patch("/:storeId/orders/:id", zValidator("json", updateStatusSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const orderId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const { status } = c.req.valid("json");
  const orderRepo = new D1OrderRepository(db);
  const useCase = new UpdateOrderStatus(orderRepo);

  const result = await useCase.execute({ orderId, status });

  if (!result.ok) {
    const httpStatus = result.error.code === "NOT_FOUND" ? 404 : 400;
    return c.json({ error: result.error }, httpStatus);
  }

  return c.json({ order: result.value });
});

// ---------------------------------------------------------------------------
// PUT /api/stores/:storeId/orders/:id/fulfillment (auth, owner)
// Attach resi / payment confirmation / queue number, then get a WhatsApp
// deep link to notify the customer.
// ---------------------------------------------------------------------------
ordersRouter.put("/:storeId/orders/:id/fulfillment", zValidator("json", fulfillmentSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const orderId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const input = c.req.valid("json");
  const orderRepo = new D1OrderRepository(db);
  const useCase = new UpdateOrderFulfillment(orderRepo);

  const result = await useCase.execute({ orderId, ...input });

  if (!result.ok) {
    const httpStatus = result.error.code === "NOT_FOUND" ? 404 : 400;
    return c.json({ error: result.error }, httpStatus);
  }

  // Build a WhatsApp deep link to the customer with the confirmation message
  const order = result.value;
  const parts: string[] = [`Halo ${order.customerName}! Pesanan ${order.orderCode} kamu:`];
  if (order.trackingNumber) {
    parts.push(`nomor resi: ${order.trackingNumber}${order.courier ? ` (${order.courier})` : ""}`);
  }
  if (order.paymentConfirmed) {
    parts.push(`pembayaran sudah kami konfirmasi ✅`);
  }
  if (order.queueNumber) {
    parts.push(`nomor antrian kamu: ${order.queueNumber}`);
  }
  parts.push("Terima kasih sudah berbelanja di toko kami! 💛");
  const waDeepLink = `https://wa.me/${order.customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(parts.join("\n"))}`;

  return c.json({ order, waDeepLink });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/orders/export (auth, owner)
// ---------------------------------------------------------------------------
ordersRouter.get("/:storeId/orders/export", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const orderRepo = new D1OrderRepository(db);
  const useCase = new ListOrders(orderRepo);
  const result = await useCase.execute({ storeId, limit: 1000 });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);

  const csv = [
    "orderCode,customer,phone,shippingAddress,items,total,status,trackingNumber,courier,paymentConfirmed,queueNumber,date",
    ...result.value.orders.map((o) => {
      const items = o.items.map((i: any) => `${i.productName} x${i.quantity}`).join("; ");
      return `"${o.orderCode}","${o.customerName}","${o.customerPhone}","${o.shippingAddress ?? ""}","${items}",${o.totalAmount},${o.status},"${o.trackingNumber ?? ""}","${o.courier ?? ""}",${o.paymentConfirmed ? "yes" : ""},"${o.queueNumber ?? ""}",${o.createdAt}`;
    }),
  ].join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="tokko-orders-${storeId}.csv"`);
  return c.body(csv);
});

export { ordersRouter };
