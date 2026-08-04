/**
 * Resend — transactional email sender (verification links, notifications).
 *
 * Outbound email via the Resend REST API. Env-driven:
 *   RESEND_API_KEY  (secret) — when missing, sends are skipped (dev/no-op)
 *   RESEND_FROM     (var)    — from address, e.g. "no-reply@7okko.com"
 *
 * Resend free tier: 3,000 emails/mo, 100/day, hard caps (no overage billing).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

export class ResendEmailer {
  constructor(private readonly env: EmailEnv) {}

  /** Send a transactional email. Returns false when skipped (no API key). */
  async send(input: SendEmailInput): Promise<boolean> {
    const { RESEND_API_KEY, RESEND_FROM } = this.env;
    if (!RESEND_API_KEY) {
      console.warn("[email] RESEND_API_KEY not set — skipping email to", input.to);
      return false;
    }
    const from = RESEND_FROM ?? "no-reply@7okko.com";

    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend error ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  }
}
