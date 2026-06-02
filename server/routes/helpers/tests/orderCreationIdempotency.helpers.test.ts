import { describe, expect, test } from "@jest/globals";

import {
  buildOrderCreationFingerprint,
  OrderCreationIdempotencyStore,
} from "../orderCreationIdempotency.helpers";

describe("order creation idempotency", () => {
  test("duplicate create requests with the same idempotency key return the first order", async () => {
    const store = new OrderCreationIdempotencyStore();
    let createCount = 0;
    const fingerprint = buildOrderCreationFingerprint({
      route: "POST /api/orders",
      body: { customerId: "customer-1", idempotencyKey: "same-key" },
    });
    const create = async () => {
      createCount += 1;
      return { id: `order-${createCount}`, orderNumber: 1000 + createCount };
    };

    const first = await store.run({ scope: "org-1:user-1:create-order", key: "same-key", fingerprint }, create);
    const second = await store.run({ scope: "org-1:user-1:create-order", key: "same-key", fingerprint }, create);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(createCount).toBe(1);
  });

  test("duplicate pending create requests with the same idempotency key share one in-flight order", async () => {
    const store = new OrderCreationIdempotencyStore();
    let createCount = 0;
    let releaseCreate: (value: { id: string }) => void = () => {
      throw new Error("create resolver was not initialized");
    };
    const fingerprint = buildOrderCreationFingerprint({ route: "POST /api/orders", body: { customerId: "customer-1" } });
    const create = async () => {
      createCount += 1;
      return new Promise<{ id: string }>((resolve) => {
        releaseCreate = resolve;
      });
    };

    const firstPromise = store.run({ scope: "org-1:user-1:create-order", key: "same-key", fingerprint }, create);
    const secondPromise = store.run({ scope: "org-1:user-1:create-order", key: "same-key", fingerprint }, create);
    await Promise.resolve();
    releaseCreate({ id: "order-1" });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.value.id).toBe("order-1");
    expect(second.value.id).toBe("order-1");
    expect(second.replayed).toBe(true);
    expect(createCount).toBe(1);
  });

  test("separate idempotency keys still create separate orders", async () => {
    const store = new OrderCreationIdempotencyStore();
    let createCount = 0;
    const fingerprint = buildOrderCreationFingerprint({ route: "POST /api/orders", body: { customerId: "customer-1" } });
    const create = async () => {
      createCount += 1;
      return { id: `order-${createCount}` };
    };

    const first = await store.run({ scope: "org-1:user-1:create-order", key: "key-1", fingerprint }, create);
    const second = await store.run({ scope: "org-1:user-1:create-order", key: "key-2", fingerprint }, create);

    expect(first.value.id).toBe("order-1");
    expect(second.value.id).toBe("order-2");
    expect(createCount).toBe(2);
  });
});
