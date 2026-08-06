/**
 * Support bounded context — business rules and guards.
 */

/** Human-friendly ticket reference, e.g. "SUP-8F3K2". */
export function generateTicketCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — unambiguous
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SUP-${code}`;
}

/** Guard: subject must not be blank. */
export function assertSubject(subject: string): string {
  const s = subject.trim();
  if (!s) throw new Error("Subject is required");
  if (s.length > 200) throw new Error("Subject must be under 200 characters");
  return s;
}

/** Guard: message body must not be blank. */
export function assertMessageBody(body: string): string {
  const b = body.trim();
  if (!b) throw new Error("Message body is required");
  return b;
}
