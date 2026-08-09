/**
 * Store aggregate root.
 * 
 * TDD: See tests/domain/store/store.test.ts
 */

import type { EntityId } from "../shared/types";
import type { Result } from "../shared/types";
import { ok, err, createEntityId } from "../shared/types";
import { StoreStatus, type Aesthetic, type BusinessType } from "./types";
import { StoreMustHaveProductsError, generateSubdomain } from "./rules";

export interface StoreProps {
  id: EntityId;
  ownerId: EntityId;
  name: string;
  subdomain: string;
  description: string | null;
  businessType: BusinessType;
  aestheticPreference: Aesthetic;
  whatsappNumber: string;
  status: StoreStatus;
  heroImageUrl: string | null;
  logoUrl: string | null;
  productCount: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  designTokens: Record<string, string> | null;
  // Shipping origin (pickup location) — Biteship rates/orders.
  originAddress: string | null;
  originRt: string | null;
  originRw: string | null;
  originKelurahan: string | null;
  originKecamatan: string | null;
  originCity: string | null;
  originProvince: string | null;
  originPostalCode: string | null;
  originContactName: string | null;
  originContactPhone: string | null;
  originLatitude: number | null;
  originLongitude: number | null;
  // Payment config — online (Xendit) toggle + manual bank transfer details.
  paymentOnline: boolean;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  // Enabled payment methods / couriers (null = platform defaults, all).
  enabledPaymentMethods: string[] | null;
  enabledCouriers: string[] | null;
}

export class Store {
  private constructor(private readonly props: StoreProps) {}

  /** Create a new Store in draft status */
  static create(params: {
    ownerId: EntityId;
    name: string;
    businessType: BusinessType;
    aestheticPreference: Aesthetic;
    whatsappNumber: string;
    subdomain?: string;
  }): Store {
    const id = createEntityId();
    const subdomain = params.subdomain ?? generateSubdomain(params.name);

    return new Store({
      id,
      ownerId: params.ownerId,
      name: params.name,
      subdomain,
      description: null,
      businessType: params.businessType,
      aestheticPreference: params.aestheticPreference,
      whatsappNumber: params.whatsappNumber,
      status: StoreStatus.Draft,
      heroImageUrl: null,
      logoUrl: null,
      productCount: 0,
      suspendedAt: null,
      suspendedReason: null,
      createdAt: new Date().toISOString(),
      designTokens: null,
      originAddress: null,
      originRt: null,
      originRw: null,
      originKelurahan: null,
      originKecamatan: null,
      originCity: null,
      originProvince: null,
      originPostalCode: null,
      originContactName: null,
      originContactPhone: null,
      originLatitude: null,
      originLongitude: null,
      paymentOnline: true,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      enabledPaymentMethods: null,
      enabledCouriers: null,
    });
  }

  /** Reconstitute from persistence */
  static from(props: StoreProps): Store {
    return new Store({ ...props });
  }

  // Getters
  get id() { return this.props.id; }
  get ownerId() { return this.props.ownerId; }
  get name() { return this.props.name; }
  get subdomain() { return this.props.subdomain; }
  get description() { return this.props.description; }
  get businessType() { return this.props.businessType; }
  get aestheticPreference() { return this.props.aestheticPreference; }
  get whatsappNumber() { return this.props.whatsappNumber; }
  get status() { return this.props.status; }
  get heroImageUrl() { return this.props.heroImageUrl; }
  get logoUrl() { return this.props.logoUrl; }
  get productCount() { return this.props.productCount; }
  get suspendedAt() { return this.props.suspendedAt; }
  get suspendedReason() { return this.props.suspendedReason; }
  get createdAt() { return this.props.createdAt; }
  get designTokens() { return this.props.designTokens; }
  get originAddress() { return this.props.originAddress; }
  get originRt() { return this.props.originRt; }
  get originRw() { return this.props.originRw; }
  get originKelurahan() { return this.props.originKelurahan; }
  get originKecamatan() { return this.props.originKecamatan; }
  get originCity() { return this.props.originCity; }
  get originProvince() { return this.props.originProvince; }
  get originPostalCode() { return this.props.originPostalCode; }
  get originContactName() { return this.props.originContactName; }
  get originContactPhone() { return this.props.originContactPhone; }
  get originLatitude() { return this.props.originLatitude; }
  get originLongitude() { return this.props.originLongitude; }
  get paymentOnline() { return this.props.paymentOnline; }
  get bankName() { return this.props.bankName; }
  get bankAccountNumber() { return this.props.bankAccountNumber; }
  get bankAccountName() { return this.props.bankAccountName; }
  get enabledPaymentMethods() { return this.props.enabledPaymentMethods; }
  get enabledCouriers() { return this.props.enabledCouriers; }

  /** Manual transfer is configured when all three bank fields are filled. */
  get hasBankDetails(): boolean {
    return Boolean(this.props.bankName && this.props.bankAccountNumber && this.props.bankAccountName);
  }

  /** Shipping origin is fully configured when address + city + province + postal + contact exist. */
  get hasShippingOrigin(): boolean {
    return Boolean(
      this.props.originAddress &&
      this.props.originCity &&
      this.props.originProvince &&
      this.props.originPostalCode &&
      this.props.originContactName &&
      this.props.originContactPhone,
    );
  }

  /** Full human-readable origin address (for pickup display / courier orders). */
  get fullOriginAddress(): string | null {
    if (!this.props.originAddress) return null;
    const parts = [
      this.props.originAddress,
      [this.props.originRt, this.props.originRw].filter(Boolean).join("/") ? `RT ${this.props.originRt} / RW ${this.props.originRw}` : null,
      this.props.originKelurahan,
      this.props.originKecamatan,
      this.props.originCity,
      this.props.originProvince,
      this.props.originPostalCode,
    ].filter(Boolean);
    return parts.join(", ");
  }

  /** Publish the store — requires at least 1 product */
  publish(): Result<Store, StoreMustHaveProductsError> {
    if (this.props.productCount < 1) {
      return err(new StoreMustHaveProductsError());
    }
    this.props.status = StoreStatus.Published;
    return ok(this);
  }

  /** Unpublish the store */
  unpublish(): Store {
    this.props.status = StoreStatus.Draft;
    return this;
  }

  /** Update store details */
  updateDetails(params: {
    name?: string;
    description?: string | null;
    whatsappNumber?: string;
  }): Store {
    if (params.name !== undefined) this.props.name = params.name;
    if (params.description !== undefined) this.props.description = params.description;
    if (params.whatsappNumber !== undefined) this.props.whatsappNumber = params.whatsappNumber;
    return this;
  }

  /** Set hero image */
  setHeroImage(url: string | null): Store {
    this.props.heroImageUrl = url;
    return this;
  }

  /** Set the store logo (navbar/brand). */
  setLogo(url: string | null): Store {
    this.props.logoUrl = url;
    return this;
  }

  /** Change the subdomain (validated by the caller against rules/uniqueness). */
  changeSubdomain(subdomain: string): Store {
    this.props.subdomain = subdomain;
    return this;
  }

  /** Configure the shipping origin (pickup location) — Biteship rates/orders. */
  updateShippingOrigin(params: {
    originAddress?: string | null;
    originRt?: string | null;
    originRw?: string | null;
    originKelurahan?: string | null;
    originKecamatan?: string | null;
    originCity?: string | null;
    originProvince?: string | null;
    originPostalCode?: string | null;
    originContactName?: string | null;
    originContactPhone?: string | null;
    originLatitude?: number | null;
    originLongitude?: number | null;
  }): Store {
    if (params.originAddress !== undefined) this.props.originAddress = params.originAddress?.trim() || null;
    if (params.originRt !== undefined) this.props.originRt = params.originRt?.trim() || null;
    if (params.originRw !== undefined) this.props.originRw = params.originRw?.trim() || null;
    if (params.originKelurahan !== undefined) this.props.originKelurahan = params.originKelurahan?.trim() || null;
    if (params.originKecamatan !== undefined) this.props.originKecamatan = params.originKecamatan?.trim() || null;
    if (params.originCity !== undefined) this.props.originCity = params.originCity?.trim() || null;
    if (params.originProvince !== undefined) this.props.originProvince = params.originProvince?.trim() || null;
    if (params.originPostalCode !== undefined) this.props.originPostalCode = params.originPostalCode?.trim() || null;
    if (params.originContactName !== undefined) this.props.originContactName = params.originContactName?.trim() || null;
    if (params.originContactPhone !== undefined) this.props.originContactPhone = params.originContactPhone?.trim() || null;
    if (params.originLatitude !== undefined) this.props.originLatitude = params.originLatitude ?? null;
    if (params.originLongitude !== undefined) this.props.originLongitude = params.originLongitude ?? null;
    return this;
  }

  /** Configure the payment settings (online toggle + manual bank details). */
  updatePaymentConfig(params: {
    paymentOnline?: boolean;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankAccountName?: string | null;
    enabledPaymentMethods?: string[] | null;
    enabledCouriers?: string[] | null;
  }): Store {
    if (params.paymentOnline !== undefined) this.props.paymentOnline = params.paymentOnline;
    if (params.bankName !== undefined) this.props.bankName = params.bankName?.trim() || null;
    if (params.bankAccountNumber !== undefined) this.props.bankAccountNumber = params.bankAccountNumber?.trim() || null;
    if (params.bankAccountName !== undefined) this.props.bankAccountName = params.bankAccountName?.trim() || null;
    if (params.enabledPaymentMethods !== undefined) {
      this.props.enabledPaymentMethods = params.enabledPaymentMethods?.length ? [...params.enabledPaymentMethods] : null;
    }
    if (params.enabledCouriers !== undefined) {
      this.props.enabledCouriers = params.enabledCouriers?.length ? [...params.enabledCouriers] : null;
    }
    return this;
  }

  /** Update the internal product count reference */
  setProductCount(count: number): Store {
    this.props.productCount = count;
    return this;
  }

  /** Set the site-wide design tokens (theme). */
  setDesignTokens(tokens: Record<string, string> | null): Store {
    this.props.designTokens = tokens;
    return this;
  }

  /** Check if store is published */
  get isPublished(): boolean {
    return this.props.status === StoreStatus.Published;
  }

  /** Check if store is suspended (taken down by moderation). */
  get isSuspended(): boolean {
    return Boolean(this.props.suspendedAt);
  }

  /** Suspend the store — hides it from the public storefront. */
  suspend(reason: string): Store {
    if (this.props.suspendedAt) {
      throw new Error("Store is already suspended");
    }
    this.props.suspendedAt = new Date().toISOString();
    this.props.suspendedReason = reason.trim() || null;
    return this;
  }

  /** Lift a suspension — the store becomes visible again. */
  unsuspend(): Store {
    if (!this.props.suspendedAt) {
      throw new Error("Store is not suspended");
    }
    this.props.suspendedAt = null;
    this.props.suspendedReason = null;
    return this;
  }

  /** Snapshot for serialization */
  toJSON(): StoreProps {
    return { ...this.props };
  }
}
