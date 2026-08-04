import { describe, it, expect, vi, afterEach } from "vitest";
import { ResendEmailer } from "../../../src/infrastructure/email/resend";

describe("ResendEmailer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips sending (returns false) when no API key is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const emailer = new ResendEmailer({});
    const ok = await emailer.send({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to Resend with the right headers/body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchSpy);
    const emailer = new ResendEmailer({ RESEND_API_KEY: "re_secret", RESEND_FROM: "no-reply@7okko.com" });
    const ok = await emailer.send({ to: "user@example.com", subject: "Verifikasi", html: "<p>Klik</p>", text: "Klik" });

    expect(ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_secret");
    const body = JSON.parse(init.body);
    expect(body.from).toBe("no-reply@7okko.com");
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toBe("Verifikasi");
  });

  it("returns false on non-2xx responses", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    vi.stubGlobal("fetch", fetchSpy);
    const emailer = new ResendEmailer({ RESEND_API_KEY: "re_secret" });
    const ok = await emailer.send({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(ok).toBe(false);
  });
});
