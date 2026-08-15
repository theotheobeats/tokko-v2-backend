/**
 * Order aggregate root.
 */

import type { EntityId, ProductType as ProductTypeT } from "../shared/types";
import { createEntityId, ProductType } from "../shared/types";
import { OrderStatus, VALID_TRANSITIONS, type OrderStatus as OrderStatusType, type ShippingOption, type PaymentMethod } from "./types";
import type { FulfillmentData, FulfillmentField } from "./types";
import { OrderItem, type OrderItemProps } from "./order-item";
import { generateOrderCode } from "./rules";

export interface OrderProps {
  id: EntityId;
  storeId: EntityId;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatusType;
  notes: string | null;
  shippingAddress: string | null;
  trackingNumber: string | null;
  courier: string | null;
  paymentConfirmed: boolean;
  paymentNote: string | null;
  /** How the buyer pays: "manual" (bank transfer) | "online" (provider invoice) | null (legacy). */
  paymentMethod: PaymentMethod | null;
  queueNumber: string | null;
  createdAt?: string;
  // Shipping (Biteship) — option + cost.
  shippingOption: ShippingOption | null;
  shippingFee: number;
  shippingCourier: string | null;
  shippingService: string | null;
  shippingDuration: string | null;
  // Structured destination (from checkout) — powers Biteship delivery orders.
  destinationDetail: string | null;
  destinationKelurahan: string | null;
  destinationKecamatan: string | null;
  destinationCity: string | null;
  destinationProvince: string | null;
  destinationPostalCode: string | null;
  // Biteship delivery order refs (set when a resi is created).
  biteshipOrderId: string | null;
  biteshipTrackingId: string | null;
}

export class Order {
  private constructor(private readonly props: OrderProps) {}

  static create(params: {
    storeId: EntityId;
    customerName: string;
    customerPhone: string;
    items: { productId: EntityId; productName: string; quantity: number; unitPrice: number; productType: ProductTypeT }[];
    notes?: string;
    shippingAddress?: string;
    orderCode?: string;
    shippingOption?: ShippingOption | null;
    shippingFee?: number;
    shippingCourier?: string | null;
    shippingService?: string | null;
    shippingDuration?: string | null;
    paymentMethod?: PaymentMethod | null;
    destination?: {
      detail?: string | null;
      kelurahan?: string | null;
      kecamatan?: string | null;
      city?: string | null;
      province?: string | null;
      postalCode?: string | null;
    } | null;
  }): Order {
    if (!params.customerName.trim()) throw new Error("Customer name is required");
    if (!params.customerPhone.trim()) throw new Error("Customer phone is required");
    if (params.items.length === 0) throw new Error("Order must have at least 1 item");
    if (params.shippingFee !== undefined && params.shippingFee < 0) throw new Error("Shipping fee must be >= 0");

    // Physical products need a shipping address when shipped by courier
    // (pickup/manual/legacy-null behave like before: address required for
    // legacy null, optional for pickup/manual).
    const hasPhysicalItem = params.items.some((i) => i.productType === ProductType.Product);
    const shippingAddress = params.shippingAddress?.trim() || null;
    const shipsByCourier = params.shippingOption === undefined || params.shippingOption === null || params.shippingOption === "courier";
    if (hasPhysicalItem && shipsByCourier && !shippingAddress) {
      throw new Error("Shipping address is required for product orders");
    }

    const orderItems = params.items.map((i) => OrderItem.create(i));
    const itemsTotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const shippingFee = params.shippingFee ?? 0;
    const totalAmount = itemsTotal + shippingFee;

    return new Order({
      id: createEntityId(),
      storeId: params.storeId,
      orderCode: params.orderCode ?? generateOrderCode(),
      customerName: params.customerName.trim(),
      customerPhone: params.customerPhone.trim(),
      items: orderItems,
      totalAmount,
      status: OrderStatus.Pending,
      notes: params.notes?.trim() || null,
      shippingAddress,
      trackingNumber: null,
      courier: null,
      paymentConfirmed: false,
      paymentNote: null,
      paymentMethod: params.paymentMethod ?? null,
      queueNumber: null,
      createdAt: new Date().toISOString(),
      shippingOption: params.shippingOption ?? (hasPhysicalItem ? "courier" : null),
      shippingFee,
      shippingCourier: params.shippingCourier?.trim() || null,
      shippingService: params.shippingService?.trim() || null,
      shippingDuration: params.shippingDuration?.trim() || null,
      destinationDetail: params.destination?.detail?.trim() || null,
      destinationKelurahan: params.destination?.kelurahan?.trim() || null,
      destinationKecamatan: params.destination?.kecamatan?.trim() || null,
      destinationCity: params.destination?.city?.trim() || null,
      destinationProvince: params.destination?.province?.trim() || null,
      destinationPostalCode: params.destination?.postalCode?.trim() || null,
      biteshipOrderId: null,
      biteshipTrackingId: null,
    });
  }

  static from(props: Omit<OrderProps, 'items'> & { items: OrderItemProps[] }): Order {
    return new Order({
      ...props,
      orderCode: props.orderCode ?? generateOrderCode(),
      shippingAddress: props.shippingAddress ?? null,
      trackingNumber: props.trackingNumber ?? null,
      courier: props.courier ?? null,
      paymentConfirmed: props.paymentConfirmed ?? false,
      paymentNote: props.paymentNote ?? null,
      paymentMethod: props.paymentMethod ?? null,
      queueNumber: props.queueNumber ?? null,
      shippingOption: props.shippingOption ?? null,
      shippingFee: props.shippingFee ?? 0,
      shippingCourier: props.shippingCourier ?? null,
      shippingService: props.shippingService ?? null,
      shippingDuration: props.shippingDuration ?? null,
      // Legacy persisted orders (pre-productType schema) may have items without
      // productType — default to "product" so reconstruction never throws and
      // the orders list / dashboard stays available. Matches the repo default
      // (row.type ?? "product") and the frontend (product.type ?? "product").
      items: props.items.map((i) =>
        OrderItem.create({ ...i, productType: i.productType ?? ProductType.Product })
      ),
    });
  }

  get id() { return this.props.id; }
  get storeId() { return this.props.storeId; }
  get orderCode() { return this.props.orderCode; }
  get customerName() { return this.props.customerName; }
  get customerPhone() { return this.props.customerPhone; }
  get items() { return [...this.props.items]; }
  get totalAmount() { return this.props.totalAmount; }
  get status() { return this.props.status; }
  get notes() { return this.props.notes; }
  get shippingAddress() { return this.props.shippingAddress; }
  get trackingNumber() { return this.props.trackingNumber; }
  get courier() { return this.props.courier; }
  get paymentConfirmed() { return this.props.paymentConfirmed; }
  get paymentNote() { return this.props.paymentNote; }
  get paymentMethod() { return this.props.paymentMethod; }
  get queueNumber() { return this.props.queueNumber; }
  get shippingOption() { return this.props.shippingOption; }
  get shippingFee() { return this.props.shippingFee; }
  get shippingCourier() { return this.props.shippingCourier; }
  get shippingService() { return this.props.shippingService; }
  get shippingDuration() { return this.props.shippingDuration; }
  get destinationDetail() { return this.props.destinationDetail; }
  get destinationKelurahan() { return this.props.destinationKelurahan; }
  get destinationKecamatan() { return this.props.destinationKecamatan; }
  get destinationCity() { return this.props.destinationCity; }
  get destinationProvince() { return this.props.destinationProvince; }
  get destinationPostalCode() { return this.props.destinationPostalCode; }
  get biteshipOrderId() { return this.props.biteshipOrderId; }
  get biteshipTrackingId() { return this.props.biteshipTrackingId; }

  /**
   * Fulfillment fields required before this order can be completed,
   * derived from the ordered items' product types:
   *  - product  → nomor resi (trackingNumber)
   *  - service  → payment confirmation
   *  - booking  → queue number (nomor antrian)
   */
  get requiredFulfillment(): FulfillmentField[] {
    const required = new Set<FulfillmentField>();
    for (const item of this.props.items) {
      if (item.productType === ProductType.Product) required.add("trackingNumber");
      else if (item.productType === ProductType.Service) required.add("paymentConfirmed");
      else if (item.productType === ProductType.Booking) required.add("queueNumber");
    }
    return [...required];
  }

  /** True when every required fulfillment field is satisfied */
  get isFulfillmentComplete(): boolean {
    for (const field of this.requiredFulfillment) {
      if (field === "trackingNumber" && !this.props.trackingNumber?.trim()) return false;
      if (field === "paymentConfirmed" && !this.props.paymentConfirmed) return false;
      if (field === "queueNumber" && !this.props.queueNumber?.trim()) return false;
    }
    return true;
  }

  /** Attach fulfillment data (resi / payment confirmation / queue number) */
  updateFulfillment(data: FulfillmentData): Order {
    if (data.trackingNumber !== undefined) {
      this.props.trackingNumber = data.trackingNumber?.trim() || null;
    }
    if (data.courier !== undefined) {
      this.props.courier = data.courier?.trim() || null;
    }
    if (data.paymentConfirmed !== undefined) {
      this.props.paymentConfirmed = data.paymentConfirmed;
    }
    if (data.paymentNote !== undefined) {
      this.props.paymentNote = data.paymentNote?.trim() || null;
    }
    if (data.queueNumber !== undefined) {
      this.props.queueNumber = data.queueNumber?.trim() || null;
    }
    return this;
  }

  /** Attach Biteship delivery-order refs (created via the resi flow). */
  attachBiteship(refs: { deliveryOrderId: string; trackingId: string | null }): Order {
    this.props.biteshipOrderId = refs.deliveryOrderId?.trim() || null;
    this.props.biteshipTrackingId = refs.trackingId?.trim() || null;
    return this;
  }

  /** Transition to a new status */
  advanceStatus(): Order {
    const allowed = VALID_TRANSITIONS[this.props.status];
    if (allowed.length === 0) {
      throw new Error(`Order already in final status: ${this.props.status}`);
    }
    this.props.status = allowed[0]; // pending→contacted, contacted→completed
    return this;
  }

  /** Mark as contacted */
  markContacted(): Order {
    if (this.props.status !== OrderStatus.Pending) {
      throw new Error("Only pending orders can be marked as contacted");
    }
    this.props.status = OrderStatus.Contacted;
    return this;
  }

  /** Mark as completed — requires fulfillment info for the ordered items */
  markCompleted(): Order {
    if (this.props.status !== OrderStatus.Contacted) {
      throw new Error("Only contacted orders can be marked as completed");
    }
    if (!this.isFulfillmentComplete) {
      throw new Error("Order cannot be completed without fulfillment info");
    }
    this.props.status = OrderStatus.Completed;
    return this;
  }

  toJSON(): Omit<OrderProps, 'items'> & { items: OrderItemProps[] } {
    return {
      id: this.props.id,
      storeId: this.props.storeId,
      orderCode: this.props.orderCode,
      customerName: this.props.customerName,
      customerPhone: this.props.customerPhone,
      items: this.props.items.map((i) => i.toJSON()),
      totalAmount: this.props.totalAmount,
      status: this.props.status,
      notes: this.props.notes,
      shippingAddress: this.props.shippingAddress,
      trackingNumber: this.props.trackingNumber,
      courier: this.props.courier,
      paymentConfirmed: this.props.paymentConfirmed,
      paymentNote: this.props.paymentNote,
      paymentMethod: this.props.paymentMethod,
      queueNumber: this.props.queueNumber,
      shippingOption: this.props.shippingOption,
      shippingFee: this.props.shippingFee,
      shippingCourier: this.props.shippingCourier,
      shippingService: this.props.shippingService,
      shippingDuration: this.props.shippingDuration,
      destinationDetail: this.props.destinationDetail,
      destinationKelurahan: this.props.destinationKelurahan,
      destinationKecamatan: this.props.destinationKecamatan,
      destinationCity: this.props.destinationCity,
      destinationProvince: this.props.destinationProvince,
      destinationPostalCode: this.props.destinationPostalCode,
      biteshipOrderId: this.props.biteshipOrderId,
      biteshipTrackingId: this.props.biteshipTrackingId,
      createdAt: this.props.createdAt,
    };
  }
}
