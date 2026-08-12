import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../types";
import { requireAdmin } from "../middleware/admin";
import { createDb } from "../../infrastructure/db/drizzle";
import { writeAdminLog } from "../../infrastructure/db/admin-log";
import { D1AdminUserRepository } from "../../infrastructure/repos/d1-admin-user-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import { D1PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { D1OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import { D1TicketRepository } from "../../infrastructure/repos/d1-ticket-repo";
import { D1ReportRepository } from "../../infrastructure/repos/d1-report-repo";
import { D1ConsentRepository } from "../../infrastructure/repos/d1-consent-repo";
import { D1PaymentRepository } from "../../infrastructure/repos/d1-payment-repo";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { D1CommissionLedger } from "../../infrastructure/repos/d1-commission-ledger";
import { ListAdminSubscriptions, SetStorePlan, UpdateStoreTrial } from "../../application/admin/admin-subscriptions";
import { SyncPendingPayments } from "../../application/payment/sync-payments";
import { createProviderClient, resolveActivePaymentProvider } from "../../infrastructure/payments/registry";
import { D1AppSettingsRepository } from "../../infrastructure/repos/d1-app-settings-repo";
import { createAuth } from "../../lib/auth";
import { GetAdminStats } from "../../application/admin/admin-stats";
import {
  ListAdminUsers,
  GetAdminUser,
  BanUser,
  UnbanUser,
  SetUserRole,
  UserNotFoundError,
} from "../../application/admin/admin-users";
import {
  ListAdminStores,
  GetAdminStore,
  SuspendStore,
  UnsuspendStore,
  DeleteAdminStore,
  StoreNotFoundError,
} from "../../application/admin/admin-stores";
import { ListAdminOrders, ListConsentsByUser, ListAdminLogsUseCase } from "../../application/admin/admin-queries";
import { AdminListTickets, ReplyTicket, UpdateTicketStatus } from "../../application/support/ticket-use-cases";
import {
  AdminListReports,
  GetReport,
  ReviewReport,
  ResolveReport,
  ReportNotFoundError,
} from "../../application/support/report-use-cases";
import type { EntityId } from "../../domain/shared/types";
import type { TicketStatus } from "../../domain/support/types";
import type { OrderStatus } from "../../domain/order/types";
import { ReportResolution } from "../../domain/support/types";
import { resolveTier } from "../../domain/plan/types";

/**
 * Admin panel API — every route requires an admin session.
 * Mounted at /api/admin (see src/index.ts).
 */

const adminRouter = new Hono<{ Bindings: Env; Variables: { adminId: string } }>();

// Guard every route in this router.
adminRouter.use("*", async (c, next) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  c.set("adminId", session.user.id);
  return next();
});

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// ---------------------------------------------------------------------------
adminRouter.get("/stats", async (c) => {
  const db = createDb(c.env.DB);
  const useCase = new GetAdminStats(
    new D1AdminUserRepository(db),
    new D1StoreRepository(db),
    new D1OrderRepository(db),
    new D1TicketRepository(db),
    new D1ReportRepository(db),
  );
  return c.json({ stats: await useCase.execute() });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// GET /api/admin/users
adminRouter.get("/users", async (c) => {
  const q = c.req.query("q");
  const role = c.req.query("role");
  const banned = c.req.query("banned");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const useCase = new ListAdminUsers(new D1AdminUserRepository(db));
  const res = await useCase.execute({
    q,
    role,
    banned: banned !== undefined ? banned === "true" : undefined,
    limit,
    offset,
  });
  return c.json(res);
});

// GET /api/admin/users/:id
adminRouter.get("/users/:id", async (c) => {
  const db = createDb(c.env.DB);
  const useCase = new GetAdminUser(
    new D1AdminUserRepository(db),
    new D1StoreRepository(db),
    new D1OrderRepository(db),
  );
  const result = await useCase.execute({ userId: c.req.param("id") as EntityId });
  if (!result.ok) {
    return c.json({ error: result.error }, result.error instanceof UserNotFoundError ? 404 : 500);
  }
  return c.json(result.value);
});

// PATCH /api/admin/users/:id — { action: "ban"|"unban"|"setRole", reason?, role? }
const userPatchSchema = z.object({
  action: z.enum(["ban", "unban", "setRole"]),
  reason: z.string().max(500).optional(),
  role: z.string().optional(),
});

adminRouter.patch("/users/:id", zValidator("json", userPatchSchema), async (c) => {
  const adminId = c.get("adminId");
  const userId = c.req.param("id") as EntityId;
  const body = c.req.valid("json");

  // Nobody can ban/demote themselves — prevents lockout.
  if (userId === adminId && body.action !== "unban") {
    return c.json({ error: { code: "SELF_ACTION", message: "Tidak bisa mengubah akun sendiri." } }, 400);
  }

  const db = createDb(c.env.DB);
  const auth = createAuth(c.env);
  const userRepo = new D1AdminUserRepository(db);

  let result;
  switch (body.action) {
    case "ban":
      result = await new BanUser(auth.api, userRepo).execute({ userId, reason: body.reason });
      await writeAdminLog(db, { adminId, action: "user.ban", targetType: "user", targetId: userId, detail: { reason: body.reason } });
      break;
    case "unban":
      result = await new UnbanUser(auth.api, userRepo).execute({ userId });
      await writeAdminLog(db, { adminId, action: "user.unban", targetType: "user", targetId: userId });
      break;
    case "setRole":
      result = await new SetUserRole(auth.api, userRepo).execute({ userId, role: body.role ?? "user" });
      await writeAdminLog(db, { adminId, action: "user.role", targetType: "user", targetId: userId, detail: { role: body.role ?? "user" } });
      break;
  }

  if (!result.ok) {
    return c.json({ error: result.error }, result.error instanceof UserNotFoundError ? 404 : 500);
  }
  return c.json({ user: result.value });
});

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

// GET /api/admin/stores
adminRouter.get("/stores", async (c) => {
  const status = c.req.query("status") as "draft" | "published" | undefined;
  const suspended = c.req.query("suspended");
  const q = c.req.query("q");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const useCase = new ListAdminStores(new D1StoreRepository(db));
  const res = await useCase.execute({
    status,
    suspended: suspended !== undefined ? suspended === "true" : undefined,
    q,
    limit,
    offset,
  });
  return c.json({
    stores: res.stores.map((s) => s.toJSON()),
    total: res.total,
  });
});

// GET /api/admin/stores/:id
adminRouter.get("/stores/:id", async (c) => {
  const db = createDb(c.env.DB);
  const useCase = new GetAdminStore(
    new D1StoreRepository(db),
    new D1AdminUserRepository(db),
    new D1ProductRepository(db),
    new D1PageRepository(db),
    new D1OrderRepository(db),
  );
  const result = await useCase.execute({ storeId: c.req.param("id") as EntityId });
  if (!result.ok) {
    return c.json({ error: result.error }, result.error instanceof StoreNotFoundError ? 404 : 500);
  }
  return c.json(result.value);
});

// POST /api/admin/stores/:id/suspend
const suspendSchema = z.object({ reason: z.string().min(3).max(500) });

adminRouter.post("/stores/:id/suspend", zValidator("json", suspendSchema), async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const useCase = new SuspendStore(new D1StoreRepository(db));
  const result = await useCase.execute({
    storeId: c.req.param("id") as EntityId,
    reason: c.req.valid("json").reason,
  });
  if (!result.ok) return c.json({ error: result.error }, 404);
  await writeAdminLog(db, { adminId, action: "store.suspend", targetType: "store", targetId: result.value.storeId, detail: { reason: c.req.valid("json").reason } });
  return c.json(result.value, 200);
});

// POST /api/admin/stores/:id/unsuspend
adminRouter.post("/stores/:id/unsuspend", async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const useCase = new UnsuspendStore(new D1StoreRepository(db));
  const result = await useCase.execute({ storeId: c.req.param("id") as EntityId });
  if (!result.ok) return c.json({ error: result.error }, 404);
  await writeAdminLog(db, { adminId, action: "store.unsuspend", targetType: "store", targetId: result.value.storeId });
  return c.json(result.value, 200);
});

// DELETE /api/admin/stores/:id
adminRouter.delete("/stores/:id", async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const useCase = new DeleteAdminStore(
    new D1StoreRepository(db),
    new D1ProductRepository(db),
    new D1PageRepository(db),
    new D1OrderRepository(db),
  );
  const result = await useCase.execute({ storeId: c.req.param("id") as EntityId });
  if (!result.ok) return c.json({ error: result.error }, 404);
  await writeAdminLog(db, { adminId, action: "store.delete", targetType: "store", targetId: result.value.storeId });
  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// GET /api/admin/orders
adminRouter.get("/orders", async (c) => {
  const status = c.req.query("status") as OrderStatus | undefined;
  const storeId = c.req.query("storeId") as string | undefined;
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const useCase = new ListAdminOrders(new D1OrderRepository(db));
  const { orders, total } = await useCase.execute({
    status,
    storeId: storeId ? (storeId as EntityId) : undefined,
    limit,
    offset,
  });

  // Enrich with store name for display.
  const storeRepo = new D1StoreRepository(db);
  const storeNames: Record<string, string> = {};
  for (const o of orders) {
    if (!storeNames[o.storeId]) {
      const store = await storeRepo.findById(o.storeId);
      storeNames[o.storeId] = store ? store.name : "—";
    }
  }

  // Enrich with the latest payment attempt per order.
  const paymentRepo = new D1PaymentRepository(db);
  const paymentByOrder: Record<string, ReturnType<import("../../domain/payment/payment").Payment["toJSON"]>> = {};
  for (const o of orders) {
    const payments = await paymentRepo.findByOrderId(o.id);
    if (payments.length > 0) paymentByOrder[o.id] = payments[payments.length - 1].toJSON();
  }

  return c.json({
    orders: orders.map((o) => ({
      ...o.toJSON(),
      storeName: storeNames[o.storeId] ?? "—",
      payment: paymentByOrder[o.id] ?? null,
    })),
    total,
  });
});

// ---------------------------------------------------------------------------
// Tickets (admin inbox)
// ---------------------------------------------------------------------------

// GET /api/admin/tickets
adminRouter.get("/tickets", async (c) => {
  const status = c.req.query("status") as TicketStatus | undefined;
  const q = c.req.query("q");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const ticketRepo = new D1TicketRepository(db);
  const { tickets, total } = await new AdminListTickets(ticketRepo).execute({ status, q, limit, offset });

  // Enrich with user emails.
  const userRepo = new D1AdminUserRepository(db);
  const emails: Record<string, string> = {};
  for (const t of tickets) {
    if (!emails[t.userId]) {
      const u = await userRepo.findById(t.userId);
      emails[t.userId] = u ? u.email : "—";
    }
  }

  return c.json({
    tickets: tickets.map((t) => ({ ...t.toJSON(), userEmail: emails[t.userId] ?? "—" })),
    total,
  });
});

// GET /api/admin/tickets/:id
adminRouter.get("/tickets/:id", async (c) => {
  const db = createDb(c.env.DB);
  const ticketRepo = new D1TicketRepository(db);
  const ticket = await ticketRepo.findById(c.req.param("id") as EntityId);
  if (!ticket) return c.json({ error: { code: "TICKET_NOT_FOUND" } }, 404);

  const user = await new D1AdminUserRepository(db).findById(ticket.userId);
  return c.json({
    ticket: ticket.toJSON(),
    userEmail: user?.email ?? "—",
    userName: user?.name ?? "—",
  });
});

// POST /api/admin/tickets/:id/reply
const ticketReplySchema = z.object({ body: z.string().min(1).max(5000) });

adminRouter.post("/tickets/:id/reply", zValidator("json", ticketReplySchema), async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const ticketRepo = new D1TicketRepository(db);
  const result = await new ReplyTicket(ticketRepo).execute({
    ticketId: c.req.param("id") as EntityId,
    authorId: adminId as EntityId,
    authorRole: "admin",
    body: c.req.valid("json").body,
    isAdmin: true,
  });
  if (!result.ok) return c.json({ error: result.error }, 404);
  await writeAdminLog(db, { adminId, action: "ticket.reply", targetType: "ticket", targetId: result.value.id });
  return c.json({ ticket: result.value.toJSON() });
});

// PATCH /api/admin/tickets/:id — { status?, priority? }
const ticketPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

adminRouter.patch("/tickets/:id", zValidator("json", ticketPatchSchema), async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const ticketRepo = new D1TicketRepository(db);
  const ticket = await ticketRepo.findById(c.req.param("id") as EntityId);
  if (!ticket) return c.json({ error: { code: "TICKET_NOT_FOUND" } }, 404);

  const body = c.req.valid("json");
  if (body.status) {
    const result = await new UpdateTicketStatus(ticketRepo).execute({
      ticketId: ticket.id,
      status: body.status as TicketStatus,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
  }
  if (body.priority) {
    const fresh = await ticketRepo.findById(ticket.id);
    if (fresh) {
      fresh.setPriority(body.priority as never);
      await ticketRepo.save(fresh);
    }
  }

  await writeAdminLog(db, {
    adminId,
    action: "ticket.update",
    targetType: "ticket",
    targetId: ticket.id,
    detail: { status: body.status, priority: body.priority },
  });

  const updated = await ticketRepo.findById(ticket.id);
  return c.json({ ticket: updated!.toJSON() });
});

// ---------------------------------------------------------------------------
// Reports (moderation queue)
// ---------------------------------------------------------------------------

// GET /api/admin/reports
adminRouter.get("/reports", async (c) => {
  const status = c.req.query("status");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const reportRepo = new D1ReportRepository(db);
  const { reports, total } = await new AdminListReports(reportRepo).execute({
    status: (status as never) || undefined,
    limit,
    offset,
  });

  // Enrich with store subdomain + name.
  const storeRepo = new D1StoreRepository(db);
  const storeInfo: Record<string, { name: string; subdomain: string }> = {};
  for (const r of reports) {
    if (!storeInfo[r.storeId]) {
      const store = await storeRepo.findById(r.storeId);
      storeInfo[r.storeId] = store ? { name: store.name, subdomain: store.subdomain } : { name: "—", subdomain: "—" };
    }
  }

  return c.json({
    reports: reports.map((r) => ({
      ...r.toJSON(),
      storeName: storeInfo[r.storeId]?.name ?? "—",
      storeSubdomain: storeInfo[r.storeId]?.subdomain ?? "—",
    })),
    total,
  });
});

// GET /api/admin/reports/:id
adminRouter.get("/reports/:id", async (c) => {
  const db = createDb(c.env.DB);
  const result = await new GetReport(new D1ReportRepository(db)).execute({
    reportId: c.req.param("id") as EntityId,
  });
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json({ report: result.value.toJSON() });
});

// POST /api/admin/reports/:id/review — open → reviewing
adminRouter.post("/reports/:id/review", async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const result = await new ReviewReport(new D1ReportRepository(db)).execute({
    reportId: c.req.param("id") as EntityId,
  });
  if (!result.ok) return c.json({ error: result.error }, 404);
  await writeAdminLog(db, { adminId, action: "report.review", targetType: "report", targetId: result.value.id });
  return c.json({ report: result.value.toJSON() });
});

// POST /api/admin/reports/:id/resolve — { resolution: "suspended"|"warned"|"dismissed" }
const resolveSchema = z.object({
  resolution: z.enum(["suspended", "warned", "dismissed"]),
  suspendReason: z.string().max(500).optional(),
});

adminRouter.post("/reports/:id/resolve", zValidator("json", resolveSchema), async (c) => {
  const adminId = c.get("adminId");
  const db = createDb(c.env.DB);
  const reportRepo = new D1ReportRepository(db);
  const body = c.req.valid("json");

  const report = await reportRepo.findById(c.req.param("id") as EntityId);
  if (!report) return c.json({ error: { code: "REPORT_NOT_FOUND" } }, 404);

  const result = await new ResolveReport(reportRepo).execute({
    reportId: report.id,
    resolution: body.resolution as ReportResolution,
    adminId: adminId as EntityId,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);

  // resolution === "suspended" → actually suspend the store.
  if (body.resolution === "suspended") {
    const suspendResult = await new SuspendStore(new D1StoreRepository(db)).execute({
      storeId: report.storeId,
      reason: body.suspendReason ?? `Dilaporkan: ${report.reason}`,
    });
    if (suspendResult.ok) {
      await writeAdminLog(db, {
        adminId,
        action: "store.suspend",
        targetType: "store",
        targetId: suspendResult.value.storeId,
        detail: { via: "report", reportId: report.id, reason: report.reason },
      });
    }
  }

  await writeAdminLog(db, {
    adminId,
    action: "report.resolve",
    targetType: "report",
    targetId: report.id,
    detail: { resolution: body.resolution },
  });

  return c.json({ report: result.value.toJSON() });
});

// ---------------------------------------------------------------------------
// Consents (UU PDP audit) + admin logs
// ---------------------------------------------------------------------------

// GET /api/admin/consents?userId=
adminRouter.get("/consents", async (c) => {
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: { code: "VALIDATION", message: "userId diperlukan." } }, 400);

  const db = createDb(c.env.DB);
  const useCase = new ListConsentsByUser(new D1ConsentRepository(db));
  const res = await useCase.execute({ userId: userId as EntityId });
  return c.json(res);
});

// GET /api/admin/logs
adminRouter.get("/logs", async (c) => {
  const adminId = c.req.query("adminId");
  const action = c.req.query("action");
  const targetType = c.req.query("targetType");
  const limit = parseInt(c.req.query("limit") ?? "100");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const useCase = new ListAdminLogsUseCase(db);
  const res = await useCase.execute({ adminId, action, targetType, limit, offset });
  return c.json(res);
});

// ---------------------------------------------------------------------------
// Trial lifecycle — manual run (test the daily cron on demand)
// ---------------------------------------------------------------------------
adminRouter.post("/cron/trial-lifecycle", async (c) => {
  const db = createDb(c.env.DB);
  const { runTrialLifecycle } = await import("../cron/trial-lifecycle");
  const result = await runTrialLifecycle(c.env);
  await writeAdminLog(db, {
    adminId: c.get("adminId"),
    action: "cron.trial-lifecycle",
    targetType: "store",
    targetId: "cron",
    detail: { ...result },
  });
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Subscriptions / Plans (manual billing — Phase 1)
// ---------------------------------------------------------------------------

/** Default paid period end when not supplied (monthly ≈ 31d, annual ≈ 365d). */
function defaultPeriodEnd(plan: "pro" | "commerce", cycle?: "monthly" | "annual"): string {
  const days = cycle === "annual" ? 365 : 31;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// GET /api/admin/subscriptions?q=&limit=&offset=
adminRouter.get("/subscriptions", async (c) => {
  const q = c.req.query("q");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const useCase = new ListAdminSubscriptions(
    new D1StoreRepository(db),
    new D1SubscriptionRepository(db),
    new D1CommissionLedger(db),
  );
  const res = await useCase.execute({ q, limit, offset });
  return c.json(res);
});

// PATCH /api/admin/subscriptions/:storeId
// Body (any subset): { plan, cycle, currentPeriodEnd, clearTrial, extendTrialDays, commissionRate }
const subscriptionPatchSchema = z.object({
  plan: z.enum(["pro", "commerce"]).optional(),
  cycle: z.enum(["monthly", "annual"]).optional(),
  currentPeriodEnd: z.string().nullable().optional(),
  clearTrial: z.boolean().optional(),
  extendTrialDays: z.number().int().positive().max(365).optional(),
  setTrialEndsAt: z.string().nullable().optional(),
  commissionRate: z.number().min(0).max(100).nullable().optional(),
});

adminRouter.patch("/subscriptions/:storeId", zValidator("json", subscriptionPatchSchema), async (c) => {
  const db = createDb(c.env.DB);
  const storeId = c.req.param("storeId") as EntityId;
  const body = c.req.valid("json");

  const storeRepo = new D1StoreRepository(db);
  const subRepo = new D1SubscriptionRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);

  if (body.plan) {
    const result = await new SetStorePlan(storeRepo, subRepo).execute({
      storeId,
      plan: body.plan,
      cycle: body.cycle,
      currentPeriodEnd: body.currentPeriodEnd ?? defaultPeriodEnd(body.plan, body.cycle),
    });
    if (!result.ok) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  }

  if (body.clearTrial || body.extendTrialDays || body.setTrialEndsAt !== undefined) {
    const result = await new UpdateStoreTrial(storeRepo).execute({
      storeId,
      clearTrial: body.clearTrial,
      extendTrialDays: body.extendTrialDays,
      setTrialEndsAt: body.setTrialEndsAt,
    });
    if (!result.ok) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  }

  if (body.commissionRate !== undefined) {
    store.setCommissionRate(body.commissionRate);
    await storeRepo.save(store);
  }

  await writeAdminLog(db, {
    adminId: c.get("adminId"),
    action: "subscription.update",
    targetType: "store",
    targetId: storeId,
    detail: { ...body },
  });

  // Return the updated plan view.
  const updated = await storeRepo.findById(storeId);
  const sub = await subRepo.findActiveByStoreId(storeId);
  if (!updated) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({
    plan: {
      store: { id: updated.id, name: updated.name, subdomain: updated.subdomain, status: updated.status },
      tier: resolveTier(updated, sub),
      trialEndsAt: updated.trialEndsAt,
      commissionRate: updated.commissionRate,
      subscription: sub ? sub.toJSON() : null,
    },
  });
});

// ---------------------------------------------------------------------------
// Payment reconciliation — on-demand provider status sync (lost-webhook fallback)
// ---------------------------------------------------------------------------

// POST /api/admin/payments/sync?orderId=&storeId=
adminRouter.post("/payments/sync", async (c) => {
  const db = createDb(c.env.DB);
  const orderId = c.req.query("orderId");
  const storeId = c.req.query("storeId");

  const result = await new SyncPendingPayments(
    new D1PaymentRepository(db),
    new D1OrderRepository(db),
    (providerId) => createProviderClient(c.env, providerId),
    new D1StoreRepository(db),
  ).execute({
    storeId: storeId ? (storeId as EntityId) : undefined,
    orderId: orderId ? (orderId as EntityId) : undefined,
  });

  await writeAdminLog(db, {
    adminId: c.get("adminId"),
    action: "payments.sync",
    targetType: "payment",
    targetId: orderId ?? "all",
    detail: result.ok ? { ...result.value } : { failed: true },
  });

  return c.json(result.ok ? result.value : { error: "SYNC_FAILED" }, result.ok ? 200 : 500);
});

// ---------------------------------------------------------------------------
// Payment provider switch (admin) — which gateway handles NEW payments
// ---------------------------------------------------------------------------

const providerSwitchSchema = z.object({
  provider: z.enum(["singapay", "xendit"]),
});

// GET /api/admin/payments/provider
adminRouter.get("/payments/provider", async (c) => {
  const db = createDb(c.env.DB);
  const settings = new D1AppSettingsRepository(db);
  const provider = await resolveActivePaymentProvider((k) => settings.get(k));
  return c.json({ provider });
});

// PATCH /api/admin/payments/provider  { provider: "singapay" | "xendit" }
adminRouter.patch("/payments/provider", zValidator("json", providerSwitchSchema), async (c) => {
  const adminId = c.get("adminId");
  const { provider } = c.req.valid("json");
  const db = createDb(c.env.DB);

  const settings = new D1AppSettingsRepository(db);
  await settings.set("payment_provider", provider);

  await writeAdminLog(db, {
    adminId,
    action: "payments.provider",
    targetType: "settings",
    targetId: "payment_provider",
    detail: { provider },
  });

  return c.json({ provider });
});

export { adminRouter };
