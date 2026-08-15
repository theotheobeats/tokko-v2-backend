/**
 * D1 Store Repository — implements StoreRepository using Drizzle + D1.
 */

import { eq, and, or, like, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Store, type StoreProps } from "../../domain/store/store";
import type { StoreRepository, StoreListFilters } from "../../application/store/store-repo";
import type { DbClient } from "../db/drizzle";
import { stores } from "../db/schema";

export class D1StoreRepository implements StoreRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.id, id as string))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  async findBySubdomain(subdomain: string): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.subdomain, subdomain))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  async findByOwnerId(ownerId: EntityId): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.ownerId, ownerId as string))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  /** Settlement webhook attribution: find the store owning this SingaPay sub-account. */
  async findBySingapayAccountId(accountId: string): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.singapayAccountId, accountId))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  async save(store: Store): Promise<void> {
    const data = this._toRow(store.toJSON());
    const existing = await this.findById(store.id);

    if (existing) {
      await this.db.update(stores)
        .set(data)
        .where(eq(stores.id, store.id as string));
    } else {
      await this.db.insert(stores).values(data);
    }
  }

  async delete(id: EntityId): Promise<void> {
    await this.db.delete(stores).where(eq(stores.id, id as string));
  }

  /** Count products belonging to this store (for publish invariant) */
  async countProducts(storeId: EntityId): Promise<number> {
    const { products } = await import("../db/schema");
    const { count } = await import("drizzle-orm");
    const result = await this.db
      .select({ count: count() })
      .from(products)
      .where(eq(products.storeId, storeId as string))
      .get();
    return result?.count ?? 0;
  }

  /**
   * Count physical products missing weight/dimensions (Biteship needs all four
   * for shipping rates) — publish invariant, same pattern as countProducts().
   */
  async countPhysicalProductsMissingShipping(storeId: EntityId): Promise<number> {
    const { products } = await import("../db/schema");
    const { count, and, eq, isNull } = await import("drizzle-orm");
    const result = await this.db
      .select({ count: count() })
      .from(products)
      .where(
        and(
          eq(products.storeId, storeId as string),
          eq(products.type, "product"),
          isNull(products.weight),
          isNull(products.width),
          isNull(products.length),
          isNull(products.height),
        ),
      )
      .get();
    return result?.count ?? 0;
  }

  /** Admin: list stores across all owners with filters + pagination. */
  async listAll(filters: StoreListFilters = {}): Promise<{ stores: Store[]; total: number }> {
    const { count } = await import("drizzle-orm");
    const conditions = [];
    if (filters.status) conditions.push(eq(stores.status, filters.status));
    if (filters.suspended === true) conditions.push(sql`${stores.suspendedAt} IS NOT NULL`);
    if (filters.suspended === false) conditions.push(sql`${stores.suspendedAt} IS NULL`);
    if (filters.q?.trim()) {
      const likeQ = `%${filters.q.trim()}%`;
      conditions.push(or(like(stores.name, likeQ), like(stores.subdomain, likeQ))!);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const totalRow = await this.db
      .select({ count: count() })
      .from(stores)
      .where(where)
      .get();

    const rows = await this.db
      .select()
      .from(stores)
      .where(where)
      .orderBy(sql`${stores.createdAt} DESC`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    const list = rows.map((r) => this._toDomain(r));
    // Attach product counts in parallel (admin tables show product counts).
    await Promise.all(list.map((s) => this.countProducts(s.id).then((n) => s.setProductCount(n))));

    return { stores: list, total: totalRow?.count ?? 0 };
  }

  /** Admin: aggregate counts for the dashboard. */
  async countAll(): Promise<{ total: number; published: number; draft: number; suspended: number }> {
    const { count } = await import("drizzle-orm");
    const [totalRow, publishedRow, draftRow, suspendedRow] = await Promise.all([
      this.db.select({ count: count() }).from(stores).get(),
      this.db.select({ count: count() }).from(stores).where(eq(stores.status, "published")).get(),
      this.db.select({ count: count() }).from(stores).where(eq(stores.status, "draft")).get(),
      this.db.select({ count: count() }).from(stores).where(sql`${stores.suspendedAt} IS NOT NULL`).get(),
    ]);
    return {
      total: totalRow?.count ?? 0,
      published: publishedRow?.count ?? 0,
      draft: draftRow?.count ?? 0,
      suspended: suspendedRow?.count ?? 0,
    };
  }

  /** Trial lifecycle: all stores with a trial deadline set. */
  async listByTrialSet(): Promise<Store[]> {
    const rows = await this.db
      .select()
      .from(stores)
      .where(sql`${stores.trialEndsAt} IS NOT NULL`)
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  /** Trial lifecycle: stores paused before the given ISO cutoff (archive job). */
  async listPausedBefore(cutoffIso: string): Promise<Store[]> {
    const rows = await this.db
      .select()
      .from(stores)
      .where(and(sql`${stores.pausedAt} IS NOT NULL`, sql`${stores.archivedAt} IS NULL`, sql`${stores.pausedAt} < ${cutoffIso}`))
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  // -----------------------------------------------------------------------
  // Mapping helpers
  // -----------------------------------------------------------------------

  private _toDomain(row: typeof stores.$inferSelect): Store {
    return Store.from({
      id: row.id as EntityId,
      ownerId: row.ownerId as EntityId,
      name: row.name,
      subdomain: row.subdomain,
      description: row.description,
      businessType: row.businessType as StoreProps["businessType"],
      aestheticPreference: row.aestheticPreference as StoreProps["aestheticPreference"],
      whatsappNumber: row.whatsappNumber,
      status: row.status as StoreProps["status"],
      heroImageUrl: row.heroImageUrl,
      logoUrl: row.logoUrl,
      productCount: 0, // populated separately via countProducts()
      physicalProductsMissingShipping: 0, // transient — set by the publish use case
      suspendedAt: row.suspendedAt,
      suspendedReason: row.suspendedReason,
      createdAt: row.createdAt,
      designTokens: row.designTokens ? (JSON.parse(row.designTokens) as Record<string, string>) : null,
      originAddress: row.originAddress,
      originRt: row.originRt,
      originRw: row.originRw,
      originKelurahan: row.originKelurahan,
      originKecamatan: row.originKecamatan,
      originCity: row.originCity,
      originProvince: row.originProvince,
      originPostalCode: row.originPostalCode,
      originContactName: row.originContactName,
      originContactPhone: row.originContactPhone,
      originLatitude: row.originLatitude,
      originLongitude: row.originLongitude,
      paymentOnline: row.paymentOnline === 1,
      bankName: row.bankName,
      bankAccountNumber: row.bankAccountNumber,
      bankAccountName: row.bankAccountName,
      singapayAccountId: row.singapayAccountId,
      kybStatus: row.kybStatus,
      payoutBankCode: row.payoutBankCode,
      payoutBankAccountNumber: row.payoutBankAccountNumber,
      payoutBankAccountName: row.payoutBankAccountName,
      enabledPaymentMethods: row.enabledPaymentMethods ? (JSON.parse(row.enabledPaymentMethods) as string[]) : null,
      enabledCouriers: row.enabledCouriers ? (JSON.parse(row.enabledCouriers) as string[]) : null,
      trialEndsAt: row.trialEndsAt,
      commissionRate: row.commissionRate,
      aiStoreGenerations: row.aiStoreGenerations,
      aiDescriptions: row.aiDescriptions,
      customDomain: row.customDomain,
      trialReminderSentAt: row.trialReminderSentAt,
      pausedAt: row.pausedAt,
      archivedAt: row.archivedAt,
    });
  }

  private _toRow(props: StoreProps) {
    return {
      id: props.id as string,
      ownerId: props.ownerId as string,
      name: props.name,
      subdomain: props.subdomain,
      description: props.description,
      businessType: props.businessType,
      aestheticPreference: props.aestheticPreference,
      whatsappNumber: props.whatsappNumber,
      status: props.status,
      heroImageUrl: props.heroImageUrl,
      logoUrl: props.logoUrl,
      suspendedAt: props.suspendedAt,
      suspendedReason: props.suspendedReason,
      createdAt: props.createdAt,
      designTokens: props.designTokens ? JSON.stringify(props.designTokens) : null,
      originAddress: props.originAddress,
      originRt: props.originRt,
      originRw: props.originRw,
      originKelurahan: props.originKelurahan,
      originKecamatan: props.originKecamatan,
      originCity: props.originCity,
      originProvince: props.originProvince,
      originPostalCode: props.originPostalCode,
      originContactName: props.originContactName,
      originContactPhone: props.originContactPhone,
      originLatitude: props.originLatitude,
      originLongitude: props.originLongitude,
      paymentOnline: props.paymentOnline ? 1 : 0,
      bankName: props.bankName,
      bankAccountNumber: props.bankAccountNumber,
      bankAccountName: props.bankAccountName,
      singapayAccountId: props.singapayAccountId,
      kybStatus: props.kybStatus,
      payoutBankCode: props.payoutBankCode,
      payoutBankAccountNumber: props.payoutBankAccountNumber,
      payoutBankAccountName: props.payoutBankAccountName,
      enabledPaymentMethods: props.enabledPaymentMethods ? JSON.stringify(props.enabledPaymentMethods) : null,
      enabledCouriers: props.enabledCouriers ? JSON.stringify(props.enabledCouriers) : null,
      trialEndsAt: props.trialEndsAt,
      commissionRate: props.commissionRate,
      aiStoreGenerations: props.aiStoreGenerations,
      aiDescriptions: props.aiDescriptions,
      customDomain: props.customDomain,
      trialReminderSentAt: props.trialReminderSentAt,
      pausedAt: props.pausedAt,
      archivedAt: props.archivedAt,
    };
  }
}
