/**
 * Store bounded context — domain events.
 */

import type { EntityId } from "../shared/types";
import type { Aesthetic, BusinessType, StoreStatus } from "./types";

export interface StoreCreatedEvent {
  type: "StoreCreated";
  storeId: EntityId;
  ownerId: EntityId;
  subdomain: string;
  businessType: BusinessType;
}

export interface StorePublishedEvent {
  type: "StorePublished";
  storeId: EntityId;
  subdomain: string;
}

export interface ProductAddedEvent {
  type: "ProductAdded";
  storeId: EntityId;
  productId: EntityId;
  productName: string;
}

export interface PageGeneratedEvent {
  type: "PageGenerated";
  storeId: EntityId;
  pageId: EntityId;
  sectionCount: number;
}

export type StoreDomainEvent =
  | StoreCreatedEvent
  | StorePublishedEvent
  | ProductAddedEvent
  | PageGeneratedEvent;
