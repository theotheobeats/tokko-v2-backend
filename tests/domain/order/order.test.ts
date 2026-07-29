import { describe, it, expect } from "vitest";
import { Order } from "../../../src/domain/order/order";
import { OrderItem } from "../../../src/domain/order/order-item";
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
      });
      expect(item.subtotal).toBe(150000);
    });
  });

  describe("toJSON()", () => {
    it("should return plain data", () => {
      const item = OrderItem.create({
        productId: createEntityId(),
        productName: "Cake",
        quantity: 1,
        unitPrice: 50000,
      });
      const json = item.toJSON();
      expect(json.productName).toBe("Cake");
      expect(json.quantity).toBe(1);
    });
  });
});

describe("Order aggregate", () => {
  const items = [
    { productId: createEntityId(), productName: "Cake", quantity: 2, unitPrice: 85000 },
    { productId: createEntityId(), productName: "Cookie", quantity: 1, unitPrice: 25000 },
  ];

  describe("create()", () => {
    it("should create an order in pending status", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina Susanti",
        customerPhone: "+628111222333",
        items,
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
          { productId: createEntityId(), productName: "A", quantity: 1, unitPrice: 10000 },
          { productId: createEntityId(), productName: "B", quantity: 3, unitPrice: 5000 },
        ],
      });

      expect(order.totalAmount).toBe(25000); // 10000 + 15000
    });
  });

  describe("status transitions", () => {
    it("should advance from pending → contacted", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      order.markContacted();
      expect(order.status).toBe(OrderStatus.Contacted);
    });

    it("should advance from contacted → completed", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      order.markContacted();
      order.markCompleted();
      expect(order.status).toBe(OrderStatus.Completed);
    });

    it("should throw when marking contacted on non-pending order", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      order.markContacted();
      expect(() => order.markContacted()).toThrow("Only pending orders can be marked as contacted");
    });

    it("should throw when marking completed on non-contacted order", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      expect(() => order.markCompleted()).toThrow("Only contacted orders can be marked as completed");
    });

    it("should throw when completing an already completed order", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      order.markContacted();
      order.markCompleted();
      expect(() => order.markCompleted()).toThrow("Only contacted orders can be marked as completed");
    });

    it("should advance with generic advanceStatus()", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      expect(order.status).toBe(OrderStatus.Pending);

      order.advanceStatus();
      expect(order.status).toBe(OrderStatus.Contacted);

      order.advanceStatus();
      expect(order.status).toBe(OrderStatus.Completed);
    });

    it("should throw when advancing from completed", () => {
      const order = Order.create({ storeId, customerName: "Rina", customerPhone: "+62", items });
      order.markContacted();
      order.markCompleted();

      expect(() => order.advanceStatus()).toThrow("Order already in final status");
    });
  });

  describe("from()", () => {
    it("should reconstitute from persistent props", () => {
      const id = createEntityId();
      const itemProps = { productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 50000 };

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
  });

  describe("toJSON()", () => {
    it("should return serializable snapshot", () => {
      const order = Order.create({
        storeId,
        customerName: "Rina",
        customerPhone: "+62",
        items,
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
});
