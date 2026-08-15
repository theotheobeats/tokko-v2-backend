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
import { Subscription } from "../../domain/plan/subscription";
import { PERIOD_DAYS } from "../../domain/plan/pricing";
import type { Plan, BillingCycle } from "../../domain/plan/types";

export const REMINDER_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // day ~10 of a 14-day trial
/** Auto-renewal invoice is created when the paid period ends within this window. */
export const RENEWAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialEmailer {
  send(input: { to: string; subject: string; html: string; text?: string }): Promise<boolean>;
}

/** Creates the auto-renewal invoice for a subscription (wired to the payment provider in the runner). */
export interface RenewalInvoiceCreator {
  (input: { store: Store; plan: Plan; cycle: BillingCycle }): Promise<{ externalId: string }>;
}

export interface TrialLifecycleResult {
  reminded: number;
  paused: number;
  archived: number;
  renewals: number;
  /** Next-term plan changes applied at their period boundary. */
  switches: number;
}

export class RunTrialLifecycle {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly subRepo: SubscriptionRepository,
    private readonly emailer: TrialEmailer,
    private readonly ownerEmail: (userId: string) => Promise<string | null>,
    private readonly appOrigin = "https://7okko.com",
    private readonly createRenewalInvoice?: RenewalInvoiceCreator,
  ) {}

  async execute(now = new Date()): Promise<TrialLifecycleResult> {
    const result: TrialLifecycleResult = { reminded: 0, paused: 0, archived: 0, renewals: 0, switches: 0 };
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

    // Subscriptions: auto-renew within 3 days of the period end, pause when lapsed.
    const subs = await this.subRepo.listActive();
    for (const sub of subs) {
      if (!sub.currentPeriodEnd) continue;
      const store = await this.storeRepo.findById(sub.storeId as never);
      if (!store || store.isPaused) continue;

      const msLeft = new Date(sub.currentPeriodEnd).getTime() - nowMs;
      if (msLeft <= 0) {
        if (sub.pendingPlan && sub.pendingCycle) {
          // Prepaid next-term change (upgrade/downgrade) applies now.
          const baseMs = Math.max(new Date(sub.currentPeriodEnd).getTime(), nowMs);
          await this.subRepo.save(Subscription.from({
            ...sub.toJSON(),
            plan: sub.pendingPlan,
            cycle: sub.pendingCycle,
            currentPeriodEnd: new Date(baseMs + PERIOD_DAYS[sub.pendingCycle] * 86_400_000).toISOString(),
            pendingPlan: null,
            pendingCycle: null,
            updatedAt: new Date().toISOString(),
          }));
          store.resume();
          await this.storeRepo.save(store);
          result.switches += 1;
        } else {
          // Period ended without payment → pause (data kept). A canceled
          // subscription flips to canceled at the boundary.
          store.pause();
          await this.storeRepo.save(store);
          if (sub.cancelAtPeriodEnd) {
            await this.subRepo.save(Subscription.from({
              ...sub.toJSON(),
              status: "canceled",
              cancelAtPeriodEnd: false,
              updatedAt: new Date().toISOString(),
            }));
          }
          result.paused += 1;
        }
      } else if (
        msLeft <= RENEWAL_WINDOW_MS &&
        !sub.renewalInvoiceExternalId &&
        !sub.pendingPlan && // next term already prepaid via a plan change
        !sub.cancelAtPeriodEnd && // canceled — no auto-renewal
        this.createRenewalInvoice
      ) {
        // Auto-renewal invoice (disclosed at checkout; cancel anytime).
        try {
          const invoice = await this.createRenewalInvoice({ store, plan: sub.plan, cycle: sub.cycle });
          await this.subRepo.save(Subscription.from({
            ...sub.toJSON(),
            renewalInvoiceExternalId: invoice.externalId,
            updatedAt: new Date().toISOString(),
          }));
          result.renewals += 1;
        } catch (e) {
          console.error("[billing] renewal invoice failed:", e);
        }
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
