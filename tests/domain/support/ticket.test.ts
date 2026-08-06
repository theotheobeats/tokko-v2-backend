import { describe, it, expect } from "vitest";
import { Ticket, TicketMessage } from "../../../src/domain/support/ticket";
import { TicketStatus, TicketPriority } from "../../../src/domain/support/types";
import { generateTicketCode } from "../../../src/domain/support/rules";
import { createEntityId } from "../../../src/domain/shared/types";

const userId = createEntityId();
const storeId = createEntityId();

describe("TicketMessage value object", () => {
  it("should create a message", () => {
    const m = TicketMessage.create({ authorId: userId, authorRole: "user", body: "Halo, bantuan dong" });
    expect(m.body).toBe("Halo, bantuan dong");
    expect(m.authorRole).toBe("user");
  });

  it("should reject empty body", () => {
    expect(() => TicketMessage.create({ authorId: userId, authorRole: "user", body: "   " })).toThrow("Message body is required");
  });
});

describe("Ticket aggregate", () => {
  it("should open a ticket with an initial message", () => {
    const t = Ticket.create({
      userId,
      storeId,
      subject: "Toko tidak bisa publish",
      category: "technical",
      message: { authorId: userId, authorRole: "user", body: "Muncul error saat publish" },
    });

    expect(t.status).toBe(TicketStatus.Open);
    expect(t.priority).toBe(TicketPriority.Normal);
    expect(t.ticketCode).toMatch(/^SUP-[A-Z2-9]{5}$/);
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0].authorRole).toBe("user");
  });

  it("should reject blank subject", () => {
    expect(() =>
      Ticket.create({
        userId,
        subject: "  ",
        category: "general",
        message: { authorId: userId, authorRole: "user", body: "isi" },
      })
    ).toThrow("Subject is required");
  });

  it("should append replies and bump updatedAt", () => {
    const t = Ticket.create({
      userId,
      subject: "Bantuan",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    const before = t.updatedAt;
    t.addReply({ authorId: createEntityId(), authorRole: "admin", body: "Baik, kami cek." });
    expect(t.messages).toHaveLength(2);
    expect(t.messages[1].authorRole).toBe("admin");
    expect(t.updatedAt >= before).toBe(true);
  });

  it("should not reply to a closed ticket", () => {
    const t = Ticket.create({
      userId,
      subject: "Selesai",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "terima kasih" },
    });
    t.changeStatus(TicketStatus.Closed);
    expect(() => t.addReply({ authorId: createEntityId(), authorRole: "admin", body: "late reply" })).toThrow("Cannot reply to a closed ticket");
  });

  it("should follow the status flow open → in_progress → resolved", () => {
    const t = Ticket.create({
      userId,
      subject: "Flow",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    t.changeStatus(TicketStatus.InProgress);
    expect(t.status).toBe(TicketStatus.InProgress);
    t.changeStatus(TicketStatus.Resolved);
    expect(t.status).toBe(TicketStatus.Resolved);
  });

  it("should reject invalid transitions", () => {
    const t = Ticket.create({
      userId,
      subject: "Flow",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    expect(() => t.changeStatus(TicketStatus.Resolved)).toThrow("Invalid ticket transition");
  });

  it("should support reopening a closed ticket", () => {
    const t = Ticket.create({
      userId,
      subject: "Reopen",
      category: "general",
      message: { authorId: userId, authorRole: "user", body: "isi" },
    });
    t.changeStatus(TicketStatus.Closed);
    t.changeStatus(TicketStatus.Open);
    expect(t.status).toBe(TicketStatus.Open);
  });
});

describe("generateTicketCode", () => {
  it("should produce unique unambiguous codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateTicketCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toMatch(/^SUP-[A-Z2-9]{5}$/);
    }
  });
});
