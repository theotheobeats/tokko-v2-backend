import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SubmitTicket,
  GetTicket,
  ReplyTicket,
  UpdateTicketStatus,
  TicketNotFoundError,
  TicketForbiddenError,
} from "../../../src/application/support/ticket-use-cases";
import type { TicketRepository } from "../../../src/infrastructure/repos/d1-ticket-repo";
import { Ticket } from "../../../src/domain/support/ticket";
import { TicketStatus } from "../../../src/domain/support/types";
import { createEntityId } from "../../../src/domain/shared/types";

function mockTicketRepo(overrides?: Partial<TicketRepository>): TicketRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ tickets: [], total: 0 }),
    countByStatus: vi.fn().mockResolvedValue({ open: 0, in_progress: 0, resolved: 0, closed: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const userId = createEntityId();

describe("SubmitTicket", () => {
  it("should create and persist a ticket", async () => {
    const repo = mockTicketRepo();
    const result = await new SubmitTicket(repo).execute({
      userId,
      subject: "Bantuan publish",
      category: "technical",
      messageBody: "Muncul error saat publish",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subject).toBe("Bantuan publish");
      expect(result.value.messages).toHaveLength(1);
    }
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("should fail on blank subject", async () => {
    const result = await new SubmitTicket(mockTicketRepo()).execute({
      userId,
      subject: "   ",
      category: "general",
      messageBody: "isi",
    });
    expect(result.ok).toBe(false);
  });
});

describe("GetTicket", () => {
  it("should allow the owner to read their ticket", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const result = await new GetTicket(repo).execute({ ticketId: ticket.id, viewerId: userId });
    expect(result.ok).toBe(true);
  });

  it("should forbid another user", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const result = await new GetTicket(repo).execute({ ticketId: ticket.id, viewerId: createEntityId() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(TicketForbiddenError);
  });

  it("should allow admins to read any ticket", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const result = await new GetTicket(repo).execute({
      ticketId: ticket.id,
      viewerId: createEntityId(),
      isAdmin: true,
    });
    expect(result.ok).toBe(true);
  });

  it("should return not-found for unknown tickets", async () => {
    const result = await new GetTicket(mockTicketRepo()).execute({ ticketId: createEntityId(), viewerId: userId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(TicketNotFoundError);
  });
});

describe("ReplyTicket", () => {
  it("should append an admin reply", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const adminId = createEntityId();
    const result = await new ReplyTicket(repo).execute({
      ticketId: ticket.id,
      authorId: adminId,
      authorRole: "admin",
      body: "Kami cek ya",
      isAdmin: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.messages).toHaveLength(2);
  });

  it("should forbid a non-owner reply", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const result = await new ReplyTicket(repo).execute({
      ticketId: ticket.id,
      authorId: createEntityId(),
      authorRole: "user",
      body: "hack",
    });
    expect(result.ok).toBe(false);
  });
});

describe("UpdateTicketStatus", () => {
  it("should transition status", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const result = await new UpdateTicketStatus(repo).execute({ ticketId: ticket.id, status: TicketStatus.InProgress });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(TicketStatus.InProgress);
  });

  it("should reject invalid transitions", async () => {
    const ticket = Ticket.create({
      userId,
      subject: "S",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const repo = mockTicketRepo({ findById: vi.fn().mockResolvedValue(ticket) });

    const result = await new UpdateTicketStatus(repo).execute({ ticketId: ticket.id, status: TicketStatus.Resolved });
    expect(result.ok).toBe(false);
  });
});
