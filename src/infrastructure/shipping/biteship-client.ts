/**
 * Biteship shipping provider client — Indonesian courier aggregator
 * (rates, delivery orders, tracking webhooks).
 *
 * Same provider pattern as the Xendit/AI layers: real calls when a
 * BITESHIP_API_KEY is configured, a deterministic mock in dev/tests, and
 * an explicit "unavailable" provider in prod-without-key so checkout falls
 * back gracefully (pickup/manual shipping only).
 *
 * Env:
 *   BITESHIP_API_KEY    (secret) — sandbox "biteship_test_..." or live "biteship_live_..."
 *   BITESHIP_FORCE_MOCK (var)    — "1" forces mock even with a key
 */

export interface RatesItem {
  name: string;
  description?: string;
  value: number;
  quantity: number;
  /** Weight in grams — required by Biteship. */
  weight: number;
  /** Dimensions in cm — optional; Biteship uses them for volumetric weight. */
  length?: number;
  width?: number;
  height?: number;
}

export interface CourierRate {
  /** Biteship courier company (e.g. "jne"). */
  courier: string;
  /** Courier service type (e.g. "reg"). */
  service: string;
  /** Human label (e.g. "Reguler"). */
  name: string;
  /** ETA label (e.g. "1 - 2 days"). */
  duration: string;
  /** Final price in Rupiah (custom rates + fees applied). */
  price: number;
  collectionMethod: string[];
}

/** A resolved area (area_id + coordinates) from the Biteship Maps API. */
export interface BiteshipArea {
  areaId: string;
  latitude: number;
  longitude: number;
}

export interface DeliveryOrderItem {
  name: string;
  value: number;
  quantity: number;
  weight: number; // grams
  length?: number;
  width?: number;
  height?: number;
}

export interface DeliveryOrderInput {
  referenceId: string; // order code (must be unique)
  shipper: {
    contactName: string;
    contactPhone: string;
    address: string;
    postalCode: string;
    areaId?: string | null;
    coordinates?: { latitude: number; longitude: number } | null;
  };
  recipient: {
    name: string;
    phone: string;
    address: string;
    postalCode: string;
    areaId?: string | null;
    coordinates?: { latitude: number; longitude: number } | null;
  };
  courierCompany: string;
  courierType: string;
  collectionMethod: "pickup" | "drop_off";
  items: DeliveryOrderItem[];
}

export interface DeliveryOrderResult {
  /** Biteship order id. */
  deliveryOrderId: string;
  /** Resi number (AWB) — courier.waybill_id. */
  waybillId: string;
  trackingId: string | null;
  status: string;
  price: number;
}

export interface ShippingProviderClient {
  getRates(req: {
    originPostalCode?: string;
    destinationPostalCode?: string;
    originLatitude?: number;
    originLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    couriers: string[];
    items: RatesItem[];
  }): Promise<CourierRate[]>;
  /** Postal code → coordinates (used to unlock instant couriers). */
  resolveCoordinates(postalCode: string): Promise<{ latitude: number; longitude: number } | null>;
  /** Postal code → area_id + coordinates (used for delivery orders). */
  resolveArea(postalCode: string): Promise<BiteshipArea | null>;
  /** Create a delivery order (pickup / drop_off) → waybill (resi). */
  createOrder(input: DeliveryOrderInput): Promise<DeliveryOrderResult>;
}

export interface BiteshipEnv {
  BITESHIP_API_KEY?: string;
  BITESHIP_FORCE_MOCK?: string;
  NODE_ENV?: string;
}

const BITESHIP_API = "https://api.biteship.com";

/** Real shipping is used whenever a non-mock key is configured. */
export function useRealShipping(env: BiteshipEnv): boolean {
  if (env.BITESHIP_FORCE_MOCK === "1" || env.BITESHIP_FORCE_MOCK === "true") return false;
  return !!env.BITESHIP_API_KEY && !env.BITESHIP_API_KEY.startsWith("biteship_mock");
}

export class BiteshipClient implements ShippingProviderClient {
  constructor(private readonly apiKey: string) {}

  private async request(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${BITESHIP_API}${path}`, {
      ...init,
      headers: {
        // Biteship accepts the API key directly as the Authorization header
        // (docs: `authorization: <<YOUR_API_KEY>>`).
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Biteship ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  async getRates(req: {
    originPostalCode?: string;
    destinationPostalCode?: string;
    originLatitude?: number;
    originLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    couriers: string[];
    items: RatesItem[];
  }): Promise<CourierRate[]> {
    const body: Record<string, unknown> = {
      couriers: req.couriers.join(","),
      items: req.items.map((i) => ({
        name: i.name,
        description: i.description,
        value: i.value,
        quantity: i.quantity,
        weight: i.weight,
        ...(i.length != null && i.width != null && i.height != null
          ? { length: i.length, width: i.width, height: i.height }
          : {}),
      })),
    };

    // Coordinates path unlocks instant couriers (Gojek/Grab); otherwise use
    // postal codes (standard couriers only).
    const hasCoords =
      req.originLatitude != null && req.originLongitude != null &&
      req.destinationLatitude != null && req.destinationLongitude != null;
    if (hasCoords) {
      body.origin_latitude = req.originLatitude;
      body.origin_longitude = req.originLongitude;
      body.destination_latitude = req.destinationLatitude;
      body.destination_longitude = req.destinationLongitude;
    } else {
      body.origin_postal_code = Number(req.originPostalCode);
      body.destination_postal_code = Number(req.destinationPostalCode);
    }

    const data = await this.request("/v1/rates/couriers", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return (data.pricing ?? []).map((p: any) => ({
      courier: p.company,
      service: p.type,
      name: p.courier_service_name ?? p.courier_service_code ?? "",
      duration: p.duration ?? "",
      price: p.price,
      collectionMethod: p.available_collection_method ?? [],
    }));
  }

  async resolveCoordinates(postalCode: string): Promise<{ latitude: number; longitude: number } | null> {
    const area = await this.resolveArea(postalCode);
    return area ? { latitude: area.latitude, longitude: area.longitude } : null;
  }

  /** Postal code → area_id + coordinates (used for delivery orders). */
  async resolveArea(postalCode: string): Promise<BiteshipArea | null> {
    try {
      const data = await this.request(`/v1/maps/areas?countries=ID&postal_code=${encodeURIComponent(postalCode)}`);
      const area = Array.isArray(data.areas) ? data.areas[0] : null;
      if (
        area &&
        typeof area.latitude === "number" &&
        typeof area.longitude === "number"
      ) {
        return {
          areaId: area.area_id ?? "",
          latitude: area.latitude,
          longitude: area.longitude,
        };
      }
      return null;
    } catch {
      return null; // area resolution is best-effort — never fail the order
    }
  }

  /** Create a delivery order (pickup / drop_off) → waybill (resi). */
  async createOrder(input: DeliveryOrderInput): Promise<DeliveryOrderResult> {
    const body: Record<string, unknown> = {
      shipper_contact_name: input.shipper.contactName,
      shipper_contact_phone: input.shipper.contactPhone,
      origin_contact_name: input.shipper.contactName,
      origin_contact_phone: input.shipper.contactPhone,
      origin_address: input.shipper.address,
      origin_postal_code: Number(input.shipper.postalCode),
      origin_collection_method: input.collectionMethod,
      destination_contact_name: input.recipient.name,
      destination_contact_phone: input.recipient.phone,
      destination_address: input.recipient.address,
      destination_postal_code: Number(input.recipient.postalCode),
      courier_company: input.courierCompany,
      courier_type: input.courierType,
      courier_insurance: 0,
      delivery_type: "now",
      reference_id: input.referenceId,
      items: input.items.map((i) => ({
        name: i.name,
        value: i.value,
        quantity: i.quantity,
        weight: i.weight,
        ...(i.length != null && i.width != null && i.height != null
          ? { length: i.length, width: i.width, height: i.height }
          : {}),
      })),
    };

    // Origin/destination resolution: area_id preferred, coordinates fallback.
    if (input.shipper.areaId) body.origin_area_id = input.shipper.areaId;
    if (input.shipper.coordinates) body.origin_coordinate = input.shipper.coordinates;
    if (input.recipient.areaId) body.destination_area_id = input.recipient.areaId;
    if (input.recipient.coordinates) body.destination_coordinate = input.recipient.coordinates;

    const data = await this.request("/v1/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      deliveryOrderId: data.id ?? "",
      waybillId: data.courier?.waybill_id ?? data.courier?.tracking_id ?? data.id ?? "",
      trackingId: data.courier?.tracking_id ?? null,
      status: data.status ?? "",
      price: data.price ?? 0,
    };
  }
}

/** Deterministic mock for dev/tests — no network, no keys. */
export class MockBiteshipClient implements ShippingProviderClient {
  async getRates(req: Parameters<ShippingProviderClient["getRates"]>[0]): Promise<CourierRate[]> {
    const totalGrams = req.items.reduce((sum, i) => sum + i.weight * i.quantity, 0);
    const base = Math.max(10000, Math.round(totalGrams / 250) * 5000);
    const rates: CourierRate[] = [
      { courier: "jne", service: "reg", name: "Reguler", duration: "2 - 3 hari", price: base, collectionMethod: ["pickup"] },
      { courier: "jnt", service: "ez", name: "EZ", duration: "2 - 3 hari", price: base + 2000, collectionMethod: ["pickup"] },
      { courier: "sicepat", service: "reg", name: "Reguler", duration: "1 - 2 hari", price: base + 3000, collectionMethod: ["pickup"] },
      { courier: "anteraja", service: "reg", name: "Reguler", duration: "2 - 3 hari", price: base + 1000, collectionMethod: ["pickup"] },
    ];
    // Deterministic "instant" option in mock when coordinates are present.
    if (req.originLatitude != null && req.destinationLatitude != null) {
      rates.push({ courier: "gosend", service: "instant", name: "GoSend", duration: "2 - 4 jam", price: base + 8000, collectionMethod: ["pickup"] });
    }
    return rates.sort((a, b) => a.price - b.price);
  }

  async resolveCoordinates(_postalCode: string): Promise<{ latitude: number; longitude: number } | null> {
    return null; // mock keeps the postal path
  }

  async resolveArea(_postalCode: string): Promise<BiteshipArea | null> {
    return null;
  }

  async createOrder(input: DeliveryOrderInput): Promise<DeliveryOrderResult> {
    return {
      deliveryOrderId: `mock-delivery-${input.referenceId}`,
      waybillId: `WYB-MOCK-${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      trackingId: `mock-tracking-${input.referenceId}`,
      status: "confirmed",
      price: 0,
    };
  }
}

/** Prod without a key — online shipping unavailable, checkout falls back to pickup/manual. */
export class UnavailableShippingProvider implements ShippingProviderClient {
  async getRates(): Promise<CourierRate[]> {
    throw new Error("Pengiriman online belum tersedia di toko ini");
  }
  async resolveCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
    return null;
  }
  async resolveArea(): Promise<BiteshipArea | null> {
    return null;
  }
  async createOrder(): Promise<DeliveryOrderResult> {
    throw new Error("Pengiriman online belum tersedia di toko ini");
  }
}

/** Pick the client based on env: real key → Biteship; dev/test → mock; prod → unavailable. */
export function createShippingProvider(env: BiteshipEnv): ShippingProviderClient {
  const key = env.BITESHIP_API_KEY;
  if (useRealShipping(env) && key) return new BiteshipClient(key);
  if (env.NODE_ENV === "production") return new UnavailableShippingProvider();
  return new MockBiteshipClient();
}
