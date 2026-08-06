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
  productCount: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
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
      productCount: 0,
      suspendedAt: null,
      suspendedReason: null,
      createdAt: new Date().toISOString(),
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
  get productCount() { return this.props.productCount; }
  get suspendedAt() { return this.props.suspendedAt; }
  get suspendedReason() { return this.props.suspendedReason; }
  get createdAt() { return this.props.createdAt; }

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

  /** Update the internal product count reference */
  setProductCount(count: number): Store {
    this.props.productCount = count;
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
