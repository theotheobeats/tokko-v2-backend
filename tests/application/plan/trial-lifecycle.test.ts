import { describe, it, expect, vi } from "vitest";
import { RunTrialLifecycle, REMINDER_WINDOW_MS } from "../../../src/application/plan/trial-lifecycle";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { SubscriptionRepository } from "../../../src/infrastructure/repos/d1-subscription-repo";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic, StoreStatus } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import { Subscription } from "../../../src/domain/plan/subscription";

const DAY = 86_400_000;

function makeStore(trialDaysFromNow: number | null, overrides: Partial<Parameters<Store["pause"]>[0]> & { ownerId?: string } = {}): Store {
  const store = Store.create({
    ownerId: overrides.ownerId ?? createEntityId(),
    name: "Trial Store",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Minimal,
    whatsappNumber: "081234567890",
  });
  store.setTrialEndsAt(trialDaysFromNow === null ? null : new Date(Date.now() + trialDaysFromNow * DAY).toISOString());
  return store;
}

function stubRepos(stores: Store[], subActive: boolean): { storeRepo: StoreRepository; subRepo: SubscriptionRepository } {
  const storeRepo = {
    findById: vi.fn().mockResolvedValue(null),
    listByTrialSet: vi.fn().mockResolvedValue(stores),
    listPausedBefore: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as StoreRepository;
  const subRepo = {
    findActiveByStoreId: vi.fn().mockResolvedValue(subActive ? { isActive: true, plan: "pro" } : null),
    listActive: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubscriptionRepository;
  return { storeRepo, subRepo };
}

describe("RunTrialLifecycle", () => {
  it("pauses a store whose trial has expired", async () => {
    const store = makeStore(-1); // expired yesterday
    const { storeRepo, subRepo } = stubRepos([store], false);
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send: vi.fn().mockResolvedValue(true) },
      vi.fn().mockResolvedValue("owner@example.com"),
    );

    const result = await job.execute();

    expect(result).toEqual({ reminded: 0, paused: 1, archived: 0, renewals: 0 });
    expect(store.isPaused).toBe(true);
    expect(store.status).toBe(StoreStatus.Paused);
    expect(storeRepo.save).toHaveBeenCalled();
  });

  it("sends the day-10 reminder once and marks it sent", async () => {
    const store = makeStore(2); // ends in 2 days → inside the 4-day reminder window
    const { storeRepo, subRepo } = stubRepos([store], false);
    const send = vi.fn().mockResolvedValue(true);
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send },
      vi.fn().mockResolvedValue("owner@example.com"),
    );

    const result = await job.execute();
    expect(result.reminded).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com" }));
    expect(store.trialReminderSentAt).not.toBeNull();

    // Second run: no duplicate reminder.
    const second = await job.execute();
    expect(second.reminded).toBe(0);
  });

  it("never touches a store with an active subscription", async () => {
    const store = makeStore(-1); // expired, but paid
    const { storeRepo, subRepo } = stubRepos([store], true);
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send: vi.fn() },
      vi.fn(),
    );

    const result = await job.execute();
    expect(result.paused).toBe(0);
    expect(store.isPaused).toBe(false);
    expect(storeRepo.save).not.toHaveBeenCalled();
  });

  it("archives stores paused longer than 30 days", async () => {
    const oldStore = makeStore(null);
    oldStore.pause();
    // Backdate the pause beyond the archive window.
    (oldStore as unknown as { pause(): void }).pause();

    const { storeRepo, subRepo } = stubRepos([], false);
    (storeRepo.listPausedBefore as ReturnType<typeof vi.fn>).mockResolvedValue([oldStore]);
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send: vi.fn() },
      vi.fn(),
    );

    const result = await job.execute();
    expect(result.archived).toBe(1);
    expect(oldStore.isArchived).toBe(true);
  });

  it("does not remind when the trial is far from expiring", async () => {
    const store = makeStore(10);
    const { storeRepo, subRepo } = stubRepos([store], false);
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send: vi.fn() },
      vi.fn(),
    );

    const result = await job.execute();
    expect(result.reminded).toBe(0);
    expect(result.paused).toBe(0);
    expect(REMINDER_WINDOW_MS).toBe(4 * DAY);
  });

  it("creates a renewal invoice when the paid period ends within 3 days", async () => {
    const store = makeStore(null); // no trial — paid subscription
    const sub = Subscription.create({
      id: createEntityId(),
      storeId: store.id,
      plan: "pro",
      cycle: "monthly",
      currentPeriodEnd: new Date(Date.now() + 2 * DAY).toISOString(),
    });
    const { storeRepo, subRepo } = stubRepos([], false);
    (subRepo.listActive as ReturnType<typeof vi.fn>).mockResolvedValue([sub]);
    (storeRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(store);
    const createInvoice = vi.fn().mockResolvedValue({ externalId: "tokko-sub::x::pro::monthly::renew-1" });
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send: vi.fn() },
      vi.fn(),
      undefined,
      createInvoice,
    );

    const result = await job.execute();
    expect(result.renewals).toBe(1);
    expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({ plan: "pro", cycle: "monthly" }));
    expect(subRepo.save).toHaveBeenCalled();
  });

  it("pauses the store when the paid period has lapsed without payment", async () => {
    const store = makeStore(null);
    const sub = Subscription.create({
      id: createEntityId(),
      storeId: store.id,
      plan: "pro",
      cycle: "monthly",
      currentPeriodEnd: new Date(Date.now() - DAY).toISOString(),
    });
    const { storeRepo, subRepo } = stubRepos([], false);
    (subRepo.listActive as ReturnType<typeof vi.fn>).mockResolvedValue([sub]);
    (storeRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(store);
    const job = new RunTrialLifecycle(
      storeRepo, subRepo,
      { send: vi.fn() },
      vi.fn(),
    );

    const result = await job.execute();
    expect(result.paused).toBe(1);
    expect(store.isPaused).toBe(true);
  });
});
