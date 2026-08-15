import { describe, it, expect } from "vitest";
import { Order } from "../../../src/domain/order/order";
import { OrderItem, type OrderItemProps } from "../../../src/domain/order/order-item";
import { OrderStatus } from "../../../src/domain/order/types";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

describe("OrderItem value object", () => {
  describe("create()", () => {
    it("should create an order item", () => {
      const item = OrderItem.create({
        productId: createEntityId(),
        productName: "Rainbow Cake",
        quantity: 2,
        unitPrice: 85000,
        productType: "product",
      });

      expect(item.productName).toBe("Rainbow Cake");
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe(85000);
      expect(item.subtotal).toBe(170000); // 2 * 85000
    });

    it("should throw when quantity < 1", () => {
      expect(() =>
        OrderItem.create({ productId: createEntityId(), productName: "X", quantity: 0, unitPrice: 100 })
      ).toThrow("Quantity must be >= 1");

      expect(() =>
        OrderItem.create({ productId: createEntityId(), productName: "X", quantity: -1, unitPrice: 100 })
      ).toThrow("Quantity must be >= 1");
    });

    it("should throw when unit price < 0", () => {
      expect(() =>
        OrderItem.create({ productId: createEntityId(), productName: "X", quantity: 1, unitPrice: -1 })
      ).toThrow("Unit price must be >= 0");
    });

    it("should compute subtotal correctly", () => {
      const item = OrderItem.create({
        productId: createEntityId(),
        productName: "Cake",
        quantity: 3,
        unitPrice: 50000,
        productType: "service",
      });
      expect(item.subtotal).toBe(150000);
    });

    it("should reject invalid productType", () => {
      expect(() =>
        OrderItem.create({
          productId: createEntityId(),
          productName: "X",
          quantity: 1,
          unitPrice: 100,
          productType: "digital" as never,
        })
      ).toThrow("Invalid product type");
    });

    it("should expose productType", () => {
      const item = OrderItem.create({
        productId: createEntityId(),
        productName: "Potong",
        quantity: 1,
        unitPrice: 50000,
        productType: "service",
      });
      expect(item.productType).toBe("service");
    });
  });

  describe("toJSON()", () => {
    it("should return plain data", () => {
      const item = OrderItem.create({
        productId: createEntityId(),
        productName: "Cake",
        quantity: 1,
        unitPrice: 50000,
        productType: "product",
      });
      const json = item.toJSON();
      expect(json.productName).toBe("Cake");
      expect(json.quantity).toBe(1);
    });
  });
});

describe("Order aggregate", () => {
  const items = [
    { productId: createEntityId(), productName: "Cake", quantity: 2, unitPrice: 85000, productType: "product" as const },
    { productId: createEntityId(), productName: "Cookie", quantity: 1, unitPrice: 25000, productType: "product" as const },
  ];

  describe("create()", () => {
    it("should create an order in pending status", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina Susanti",
        customerPhone: "+628111222333",
        items,
        shippingAddress: "Jl. Test No. 1",
      });

      expect(order.id).toBeDefined();
      expect(order.storeId).toBe(storeId);
      expect(order.customerName).toBe("Rina Susanti");
      expect(order.customerPhone).toBe("+628111222333");
      expect(order.status).toBe(OrderStatus.Pending);
      expect(order.items).toHaveLength(2);
      expect(order.totalAmount).toBe(195000); // 2*85000 + 1*25000
      expect(order.notes).toBeNull();
    });

    it("should create an order with optional notes", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items,
        shippingAddress: "Jl. Test No. 1",
        notes: "Please gift wrap",
      });

      expect(order.notes).toBe("Please gift wrap");
    });

    it("should throw when customer name is empty", () => {
      expect(() =>
        Order.create({ storeId, customerName: "", customerPhone: "+62", items })
      ).toThrow("Customer name is required");
    });

    it("should throw when customer phone is empty", () => {
      expect(() =>
        Order.create({ storeId, customerName: "Rina", customerPhone: "", items })
      ).toThrow("Customer phone is required");
    });

    it("should throw when no items", () => {
      expect(() =>
        Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items: [] })
      ).toThrow("Order must have at least 1 item");
    });

    it("should trim name and phone", () => {
      const order = Order.create({
        storeId,
        customerName: "  Rina  ",
        customerPhone: "  +62  ",
        items,
        shippingAddress: "Jl. Test No. 1",
      });

      expect(order.customerName).toBe("Rina");
      expect(order.customerPhone).toBe("+62");
    });

    it("should compute total amount from items", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [
          { productId: createEntityId(), productName: "A", quantity: 1, unitPrice: 10000, productType: "product" as const },
          { productId: createEntityId(), productName: "B", quantity: 3, unitPrice: 5000, productType: "product" as const },
        ],
        shippingAddress: "Jl. Test No. 1",
      });

      expect(order.totalAmount).toBe(25000); // 10000 + 15000
    });

    it("should add the delivery fee on top of the items total", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [
          { productId: createEntityId(), productName: "A", quantity: 1, unitPrice: 10000, productType: "product" as const },
        ],
        shippingAddress: "Jl. Test No. 1",
        shippingFee: 15000,
        shippingCourier: "jne",
        shippingService: "reg",
      });

      expect(order.shippingFee).toBe(15000);
      expect(order.totalAmount).toBe(25000); // 10000 items + 15000 delivery fee
    });

    it("records a manual-transfer payment method", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items,
        shippingAddress: "Jl. Test No. 1",
        paymentMethod: "manual",
      });

      expect(order.paymentMethod).toBe("manual");
      expect(order.toJSON().paymentMethod).toBe("manual");
    });

    it("records an online payment method", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items,
        shippingAddress: "Jl. Test No. 1",
        paymentMethod: "online",
      });

      expect(order.paymentMethod).toBe("online");
    });

    it("defaults paymentMethod to null for legacy orders", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items,
        shippingAddress: "Jl. Test No. 1",
      });

      expect(order.paymentMethod).toBeNull();
    });
  });

  describe("status transitions", () => {
    it("should advance from pending → contacted", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      order.markContacted();
      expect(order.status).toBe(OrderStatus.Contacted);
    });

    it("should advance from contacted → completed", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      order.markContacted();
      order.updateFulfillment({ trackingNumber: "JNE123" });
      order.markCompleted();
      expect(order.status).toBe(OrderStatus.Completed);
    });

    it("should throw when marking contacted on non-pending order", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      order.markContacted();
      expect(() => order.markContacted()).toThrow("Only pending orders can be marked as contacted");
    });

    it("should throw when marking completed on non-contacted order", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      expect(() => order.markCompleted()).toThrow("Only contacted orders can be marked as completed");
    });

    it("should throw when completing an already completed order", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      order.markContacted();
      order.updateFulfillment({ trackingNumber: "JNE123" });
      order.markCompleted();
      expect(() => order.markCompleted()).toThrow("Only contacted orders can be marked as completed");
    });

    it("should advance with generic advanceStatus()", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      expect(order.status).toBe(OrderStatus.Pending);

      order.advanceStatus();
      expect(order.status).toBe(OrderStatus.Contacted);

      order.updateFulfillment({ trackingNumber: "JNE123" });
      order.advanceStatus();
      expect(order.status).toBe(OrderStatus.Completed);
    });

    it("should throw when advancing from completed", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      order.markContacted();
      order.updateFulfillment({ trackingNumber: "JNE123" });
      order.markCompleted();

      expect(() => order.advanceStatus()).toThrow("Order already in final status");
    });
  });

  describe("from()", () => {
    it("should reconstitute from persistent props", () => {
      const id = createEntityId();
      const itemProps = { productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 50000, productType: "product" as const };

      const order = Order.from({
        id,
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [itemProps],
        totalAmount: 50000,
        status: OrderStatus.Contacted,
        notes: "Test notes",
      });

      expect(order.id).toBe(id);
      expect(order.status).toBe(OrderStatus.Contacted);
      expect(order.items).toHaveLength(1);
      expect(order.notes).toBe("Test notes");
    });

    it("should default productType on legacy items that predate the productType field", () => {
      // Rows written before the productType column existed serialize items
      // without productType. Reconstructing them must not throw (this used to
      // 500 the orders list / dashboard for stores with such orders).
      const legacyItem = {
        productId: createEntityId(),
        productName: "Paket Website",
        quantity: 2,
        unitPrice: 2500000,
      } as unknown as OrderItemProps;

      const order = Order.from({
        id: createEntityId(),
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [legacyItem],
        totalAmount: 5000000,
        status: OrderStatus.Completed,
        notes: null,
      });

      expect(order.items).toHaveLength(1);
      expect(order.items[0].productType).toBe("product");
    });
  });

  describe("toJSON()", () => {
    it("should return serializable snapshot", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items,
        shippingAddress: "Jl. Test No. 1",
        notes: "Urgent",
      });

      const json = order.toJSON();
      expect(json.customerName).toBe("Rina");
      expect(json.status).toBe(OrderStatus.Pending);
      expect(json.items).toHaveLength(2);
      expect(json.totalAmount).toBe(195000);
      expect(json.notes).toBe("Urgent");
    });
  });

  describe("orderCode", () => {
    it("should generate a TK-XXXXXX code on create", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      expect(order.orderCode).toMatch(/^TK-[A-Z2-9]{6}$/);
    });

    it("should generate unique codes", () => {
      const a = Order.create({ storeId, customerName: "A", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      const b = Order.create({ storeId, customerName: "B", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      expect(a.orderCode).not.toBe(b.orderCode);
    });

    it("should accept an explicit order code", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, orderCode: "TK-ABC123", shippingAddress: "Jl. Test No. 1" });
      expect(order.orderCode).toBe("TK-ABC123");
    });

    it("should keep the order code through toJSON", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items, shippingAddress: "Jl. Test No. 1" });
      expect(order.toJSON().orderCode).toBe(order.orderCode);
    });
  });

  describe("shipping address", () => {
    it("should require shipping address for product orders", () => {
      expect(() =>
        Order.create({
          storeId,
          customerName: "Rina",
          customerPhone: "+62",
          items: [{ productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 10000, productType: "product" }],
        })
      ).toThrow("Shipping address is required for product orders");
    });

    it("should store trimmed shipping address for product orders", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 10000, productType: "product" }],
        shippingAddress: "  Jl. Merdeka No. 1, Jakarta  ",
      });
      expect(order.shippingAddress).toBe("Jl. Merdeka No. 1, Jakarta");
    });

    it("should not require shipping address for service orders", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Potong Rambut", quantity: 1, unitPrice: 50000, productType: "service" }],
      });
      expect(order.shippingAddress).toBeNull();
    });
  });

  describe("fulfillment", () => {
    function bookingOrder() {
      return Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Konsultasi", quantity: 1, unitPrice: 50000, productType: "booking" }],
      });
    }

    it("should derive required fulfillment from item product type", () => {
      const productOrder = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 10000, productType: "product" }],
        shippingAddress: "Jl. A",
      });
      expect(productOrder.requiredFulfillment).toEqual(["trackingNumber"]);

      const serviceOrder = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Potong", quantity: 1, unitPrice: 50000, productType: "service" }],
      });
      expect(serviceOrder.requiredFulfillment).toEqual(["paymentConfirmed"]);

      expect(bookingOrder().requiredFulfillment).toEqual(["queueNumber"]);
    });

    it("should start with incomplete fulfillment", () => {
      expect(bookingOrder().isFulfillmentComplete).toBe(false);
    });

    it("should set fulfillment data", () => {
      const order = bookingOrder();
      order.updateFulfillment({ queueNumber: "A-001", paymentNote: null });
      expect(order.queueNumber).toBe("A-001");
      expect(order.isFulfillmentComplete).toBe(true);
    });

    it("should trim fulfillment strings", () => {
      const order = bookingOrder();
      order.updateFulfillment({ queueNumber: "  A-001  " });
      expect(order.queueNumber).toBe("A-001");
    });

    it("should mark product order complete once tracking number set", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 10000, productType: "product" }],
        shippingAddress: "Jl. A",
      });
      expect(order.isFulfillmentComplete).toBe(false);
      order.updateFulfillment({ trackingNumber: "JNE123", courier: "JNE" });
      expect(order.isFulfillmentComplete).toBe(true);
      expect(order.trackingNumber).toBe("JNE123");
      expect(order.courier).toBe("JNE");
    });

    it("should mark service order complete once payment confirmed", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items: [{ productId: createEntityId(), productName: "Potong", quantity: 1, unitPrice: 50000, productType: "service" }],
      });
      expect(order.isFulfillmentComplete).toBe(false);
      order.updateFulfillment({ paymentConfirmed: true });
      expect(order.isFulfillmentComplete).toBe(true);
    });

    it("should reject completing an order without fulfillment info", () => {
      const order = bookingOrder();
      order.markContacted();
      expect(() => order.markCompleted()).toThrow("fulfillment");
    });

    it("should allow completing an order once fulfillment is complete", () => {
      const order = bookingOrder();
      order.updateFulfillment({ queueNumber: "A-001" });
      order.markContacted();
      order.markCompleted();
      expect(order.status).toBe(OrderStatus.Completed);
    });

    it("should include fulfillment data in toJSON", () => {
      const order = bookingOrder();
      order.updateFulfillment({ queueNumber: "A-001" });
      const json = order.toJSON();
      expect(json.queueNumber).toBe("A-001");
      expect(json.shippingAddress).toBeNull();
      expect(json.paymentConfirmed).toBe(false);
    });
  });
});
