import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../types";
import { requireUser } from "../middleware/auth";
import { requireAdmin } from "../middleware/admin";
import { createDb } from "../../infrastructure/db/drizzle";
import { D1TicketRepository } from "../../infrastructure/repos/d1-ticket-repo";
import { D1ReportRepository } from "../../infrastructure/repos/d1-report-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import {
  SubmitTicket,
  ListMyTickets,
  GetTicket,
  ReplyTicket,
  UpdateTicketStatus,
} from "../../application/support/ticket-use-cases";
import { SubmitReport, SelfReportError } from "../../application/support/report-use-cases";
import type { EntityId } from "../../domain/shared/types";
import { TicketStatus, TicketPriority, TicketCategory } from "../../domain/support/types";
import { ReportReason, ReportTargetType } from "../../domain/support/types";

/**
 * User-facing support routes (mounted under /api):
 *   POST   /api/tickets                    — store owner opens a ticket
 *   GET    /api/tickets/mine               — my tickets (paginated)
 *   GET    /api/tickets/:id                — ticket thread (owner or admin)
 *   POST   /api/tickets/:id/reply          — reply (owner or admin)
 *   PATCH  /api/tickets/:id/status         — change status (owner or admin)
 *   POST   /api/stores/:storeId/report     — public content-moderation report
 */

const ticketsRouter = new Hono<{ Bindings: Env }>();

const createTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  category: z.enum(Object.values(TicketCategory) as [string, ...string[]]).default(TicketCategory.General),
  priority: z.enum(Object.values(TicketPriority) as [string, ...string[]]).optional(),
  storeId: z.string().optional(),
  message: z.string().min(1),
});

const replySchema = z.object({ body: z.string().min(1) });
const statusSchema = z.object({ status: z.enum(Object.values(TicketStatus) as [string, ...string[]]) });

// ---------------------------------------------------------------------------
// POST /api/tickets
// ---------------------------------------------------------------------------
ticketsRouter.post("/tickets", zValidator("json", createTicketSchema), async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const input = c.req.valid("json");
  const db = createDb(c.env.DB);
  const useCase = new SubmitTicket(new D1TicketRepository(db));

  const result = await useCase.execute({
    userId: session.user.id as EntityId,
    storeId: input.storeId ? (input.storeId as EntityId) : null,
    subject: input.subject,
    category: input.category as TicketCategory,
    priority: input.priority as TicketPriority | undefined,
    messageBody: input.message,
  });

  if (!result.ok) {
    return c.json({ error: { code: "VALIDATION", message: result.error.message } }, 400);
  }
  return c.json({ ticket: result.value.toJSON() }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/tickets/mine
// ---------------------------------------------------------------------------
ticketsRouter.get("/tickets/mine", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const status = c.req.query("status") as TicketStatus | undefined;
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createDb(c.env.DB);
  const useCase = new ListMyTickets(new D1TicketRepository(db));
  const result = await useCase.execute({
    userId: session.user.id as EntityId,
    status,
    limit,
    offset,
  });
  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);

  return c.json({
    tickets: result.value.tickets.map((t) => t.toJSON()),
    total: result.value.total,
  });
});

// ---------------------------------------------------------------------------
// GET /api/tickets/:id
// ---------------------------------------------------------------------------
ticketsRouter.get("/tickets/:id", async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  // Admins may view any ticket; regular users only their own.
  const isAdmin = (session.user as { role?: string }).role === "admin";
  const db = createDb(c.env.DB);
  const useCase = new GetTicket(new D1TicketRepository(db));
  const result = await useCase.execute({
    ticketId: c.req.param("id") as EntityId,
    viewerId: session.user.id as EntityId,
    isAdmin,
  });

  if (!result.ok) {
    const status = result.error.code === "TICKET_FORBIDDEN" ? 403 : 404;
    return c.json({ error: result.error }, status);
  }
  return c.json({ ticket: result.value.toJSON() });
});

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/reply
// ---------------------------------------------------------------------------
ticketsRouter.post("/tickets/:id/reply", zValidator("json", replySchema), async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const isAdmin = (session.user as { role?: string }).role === "admin";
  const db = createDb(c.env.DB);
  const useCase = new ReplyTicket(new D1TicketRepository(db));
  const result = await useCase.execute({
    ticketId: c.req.param("id") as EntityId,
    authorId: session.user.id as EntityId,
    authorRole: isAdmin ? "admin" : "user",
    body: c.req.valid("json").body,
    isAdmin,
  });

  if (!result.ok) {
    const status = result.error.code === "TICKET_FORBIDDEN" ? 403 : 404;
    return c.json({ error: result.error }, status);
  }
  return c.json({ ticket: result.value.toJSON() });
});

// ---------------------------------------------------------------------------
// PATCH /api/tickets/:id/status
// ---------------------------------------------------------------------------
ticketsRouter.patch("/tickets/:id/status", zValidator("json", statusSchema), async (c) => {
  const session = await requireUser(c);
  if (session instanceof Response) return session;

  const isAdmin = (session.user as { role?: string }).role === "admin";
  const db = createDb(c.env.DB);
  const ticketRepo = new D1TicketRepository(db);
  const ticket = await ticketRepo.findById(c.req.param("id") as EntityId);
  if (!ticket) return c.json({ error: { code: "TICKET_NOT_FOUND" } }, 404);
  if (!isAdmin && ticket.userId !== session.user.id) {
    return c.json({ error: { code: "TICKET_FORBIDDEN" } }, 403);
  }

  const useCase = new UpdateTicketStatus(ticketRepo);
  const result = await useCase.execute({
    ticketId: ticket.id,
    status: c.req.valid("json").status as TicketStatus,
  });

  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ticket: result.value.toJSON() });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/report (public; auth optional → reporterId)
// ---------------------------------------------------------------------------
const reportsRouter = new Hono<{ Bindings: Env }>();

const reportSchema = z.object({
  targetType: z.enum(Object.values(ReportTargetType) as [string, ...string[]]),
  targetId: z.string().min(1),
  reason: z.enum(Object.values(ReportReason) as [string, ...string[]]),
  details: z.string().max(2000).optional(),
});

reportsRouter.post("/stores/:storeId/report", zValidator("json", reportSchema), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "STORE_NOT_FOUND" } }, 404);

  // Optional auth → reporterId (for self-report guard + audit).
  let reporterId: EntityId | null = null;
  try {
    const session = await requireUser(c);
    if (!(session instanceof Response)) {
      reporterId = session.user.id as EntityId;
      if (store.ownerId === session.user.id) {
        return c.json({ error: { code: "SELF_REPORT", message: "Tidak bisa melaporkan toko sendiri." } }, 400);
      }
    }
  } catch {
    // anonymous — allowed
  }

  const input = c.req.valid("json");
  const useCase = new SubmitReport(new D1ReportRepository(db));
  const result = await useCase.execute({
    reporterId,
    storeId,
    targetType: input.targetType as ReportTargetType,
    targetId: input.targetId,
    reason: input.reason as ReportReason,
    details: input.details,
  });

  if (!result.ok) {
    const status = result.error instanceof SelfReportError ? 400 : 400;
    return c.json({ error: { code: "VALIDATION", message: result.error.message } }, status);
  }
  return c.json({ report: result.value.toJSON() }, 201);
});

export { ticketsRouter, reportsRouter };
