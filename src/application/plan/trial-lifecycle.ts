/**
 * RunTrialLifecycle — the daily trial-expiry job (Phase 2).
 *
 * For every store with a trial deadline:
 *   - ends within REMINDER_WINDOW_MS and reminder not yet sent → day-10 email
 *   - deadline passed and not paused → pause (read-only storefront, orders off)
 *   - no active subscription → a paid store is never paused
 * Paused > ARCHIVE_AFTER_MS → archived (non-destructive retention hook).
 *
 * Runs on a Cloudflare cron trigger and via the admin test endpoint
 * (POST /api/admin/cron/trial-lifecycle).
 */

import type { Store } from "../../domain/store/store";
import type { StoreRepository } from "../store/store-repo";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";

export const REMINDER_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // day ~10 of a 14-day trial
export const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialEmailer {
  send(input: { to: string; subject: string; html: string; text?: string }): Promise<boolean>;
}

export interface TrialLifecycleResult {
  reminded: number;
  paused: number;
  archived: number;
}

export class RunTrialLifecycle {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly subRepo: SubscriptionRepository,
    private readonly emailer: TrialEmailer,
    private readonly ownerEmail: (userId: string) => Promise<string | null>,
    private readonly appOrigin = "https://7okko.com",
  ) {}

  async execute(now = new Date()): Promise<TrialLifecycleResult> {
    const result: TrialLifecycleResult = { reminded: 0, paused: 0, archived: 0 };
    const nowMs = now.getTime();

    const stores = await this.storeRepo.listByTrialSet();
    for (const store of stores) {
      if (!store.trialEndsAt || store.isPaused) continue;

      // Paid stores are never touched by the trial job.
      const sub = await this.subRepo.findActiveByStoreId(store.id);
      if (sub && sub.isActive) continue;

      const endsMs = new Date(store.trialEndsAt).getTime();
      const msLeft = endsMs - nowMs;

      if (msLeft <= REMINDER_WINDOW_MS && msLeft > 0 && !store.trialReminderSentAt) {
        // Day-10 reminder.
        const email = await this.ownerEmail(store.ownerId);
        if (email) {
          await this.emailer.send({
            to: email,
            subject: `Trial ${store.name} berakhir dalam ${Math.max(1, Math.ceil(msLeft / 86_400_000))} hari`,
            html: trialReminderHtml(store, this.appOrigin, Math.max(1, Math.ceil(msLeft / 86_400_000))),
            text: `Trial tokomu berakhir dalam ${Math.max(1, Math.ceil(msLeft / 86_400_000))} hari. Upgrade ke Pro di ${this.appOrigin} agar tokomu terus aktif — data kamu aman.`,
          });
        }
        store.markTrialReminderSent();
        await this.storeRepo.save(store);
        result.reminded += 1;
      } else if (msLeft <= 0) {
        // Trial over → pause (data kept, storefront read-only).
        store.pause();
        await this.storeRepo.save(store);
        result.paused += 1;
      }
    }

    // Retention: paused > 30 days → archive.
    const archived = await this.storeRepo.listPausedBefore(new Date(nowMs - ARCHIVE_AFTER_MS).toISOString());
    for (const store of archived) {
      store.archive();
      await this.storeRepo.save(store);
      result.archived += 1;
    }

    return result;
  }
}

function trialReminderHtml(store: Store, appOrigin: string, daysLeft: number): string {
  const url = `https://${store.subdomain}.7okko.com`;
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="font-size: 18px; margin: 0 0 12px;">Trial ${store.name} hampir berakhir ⏳</h2>
      <p style="font-size: 14px; color: #444; line-height: 1.6;">
        Masa trial kamu berakhir dalam <b>${daysLeft} hari</b>. Setelah itu tokomu <b>dijeda</b> — pengunjung
        masih bisa melihat halamanmu, tapi pesanan nonaktif.
      </p>
      <p style="font-size: 14px; color: #444; line-height: 1.6;">
        Upgrade ke <b>Pro (Rp 49rb/bln)</b> untuk lanjut tanpa jeda — watermark Tokko hilang, AI tanpa batas,
        riwayat pesanan 1 tahun. <i>3 tahun Tokko &lt; sekali bikin toko di jasa.</i>
      </p>
      <a href="${appOrigin}" style="display: inline-block; background: #f97316; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: 700; font-size: 14px; margin-top: 8px;">Upgrade sekarang</a>
      <p style="font-size: 12px; color: #888; margin-top: 20px;">Data kamu aman — bayar kapan pun untuk aktif kembali. <a href="${url}" style="color: #888;">${url}</a></p>
    </div>
  `;
}
