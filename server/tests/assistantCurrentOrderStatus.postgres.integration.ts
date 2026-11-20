import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { customers, orders, organizations, users } from "@shared/schema";
import { db, pool } from "../db";
import { OrdersRepository } from "../storage/orders.repo";
import { createCurrentOrderStatusTool } from "../services/assistant/currentOrderStatusTool";
import { AssistantOrchestrationService } from "../services/assistant/orchestration";
import type { AssistantTrustedToolContext } from "../services/assistant/toolRegistry";

// Run only with jest.local-postgres.config.js and a disposable, schema-bootstrapped
// loopback TEST_DATABASE_URL. Its setup verifies DB identity before fixture writes.
// No readOrder injection or repository/driver mocks: the adapter's default path
// imports PH storage, and the harness maps Neon transport to real local pg.
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const userId = randomUUID();
const customerId = randomUUID();
const orderId = randomUUID();
const fallbackOrderId = randomUUID();
const repository = new OrdersRepository(db);

function trusted(id = orderId, org = organizationId): AssistantTrustedToolContext {
  return {
    scope: { organizationId: org, userId },
    actor: { userId, email: null },
    permissions: ["assistant.internal_staff"],
    correlationId: randomUUID(),
    signal: new AbortController().signal,
    context: assistantContextEnvelopeSchema.parse({
      contextVersion: "v1", route: `/orders/${id}`, pageTitle: "Order",
      entityType: "order", entityId: id, unsavedChanges: false,
      capturedAt: new Date().toISOString(),
    }),
  };
}

const service = () => new AssistantOrchestrationService({
  "orders.current_status": createCurrentOrderStatusTool(),
});

beforeAll(async () => {
  await db.transaction(async tx => {
    await tx.insert(organizations).values([
      { id: organizationId, name: "Synthetic order status tenant", slug: organizationId },
      { id: otherOrganizationId, name: "Unrelated synthetic tenant", slug: otherOrganizationId },
    ]);
    await tx.insert(users).values({ id: userId, email: `${userId}@example.invalid`, role: "employee" });
    await tx.insert(customers).values({ id: customerId, organizationId, companyName: "Synthetic status buyer" });
    await tx.insert(orders).values([
      { id: orderId, organizationId, customerId, createdByUserId: userId,
        orderNumber: "910001", displayNumber: "O-910001", state: "open",
        status: "new", statusPillValue: "Awaiting synthetic artwork" },
      { id: fallbackOrderId, organizationId, customerId, createdByUserId: userId,
        orderNumber: "910002", displayNumber: null, state: "closed", statusPillValue: null },
    ]);
  });
});

afterAll(async () => { await pool.end(); });

test("native PH repository reads function without constructing or invoking AI", async () => {
  const row = await repository.getOrderById(organizationId, orderId);
  expect(row).toMatchObject({ id: orderId, orderNumber: "910001", displayNumber: "O-910001",
    state: "open", statusPillValue: "Awaiting synthetic artwork", lineItems: [] });
  expect(await repository.getOrderById(otherOrganizationId, orderId)).toBeUndefined();
});

test("default adapter exactly projects native current status without changing stored orders", async () => {
  const before = await db.select().from(orders).where(eq(orders.organizationId, organizationId));
  const native = await repository.getOrderById(organizationId, orderId);
  expect(native).toBeDefined();
  const result = await service().executeTool("orders.current_status", {}, trusted());
  expect(result.status).toBe("succeeded");
  expect(result.result?.data).toEqual({ orderNumber: native!.displayNumber ?? native!.orderNumber,
    state: native!.state, statusPillValue: native!.statusPillValue });
  expect(result.result?.provenance?.sourceLinks).toMatchObject([
    { href: `/orders/${orderId}`, entityType: "order", entityId: orderId },
  ]);
  expect(await db.select().from(orders).where(eq(orders.organizationId, organizationId))).toEqual(before);
});

test("wrong tenant and missing order return not_found with no order data", async () => {
  for (const context of [trusted(orderId, otherOrganizationId), trusted(randomUUID())]) {
    expect(await repository.getOrderById(context.scope.organizationId, context.context.entityId!)).toBeUndefined();
    const result = await service().executeTool("orders.current_status", {}, context);
    expect(result.status).toBe("not_found");
    expect(result.result).toMatchObject({ status: "not_found", data: null });
    expect(result.result?.provenance).toBeUndefined();
  }
});

test("native null pill and fallback order number survive the adapter unchanged", async () => {
  const result = await service().executeTool("orders.current_status", {}, trusted(fallbackOrderId));
  expect(result.status).toBe("succeeded");
  expect(result.result?.data).toEqual({ orderNumber: "910002", state: "closed", statusPillValue: null });
});

test("next read observes committed native fixture changes, not a cached AI status", async () => {
  // Synthetic fixture mutation only; not a substitute for a native state-transition test.
  await db.transaction(async tx => {
    await tx.update(orders).set({ statusPillValue: "Synthetic artwork received" }).where(eq(orders.id, orderId));
  });
  const native = await repository.getOrderById(organizationId, orderId);
  const result = await service().executeTool("orders.current_status", {}, trusted());
  expect(result.result?.data).toEqual({ orderNumber: native!.displayNumber,
    state: native!.state, statusPillValue: "Synthetic artwork received" });
  // Native reads remain available after the conversational invocation as well.
  expect((await repository.getOrderById(organizationId, orderId))?.statusPillValue).toBe("Synthetic artwork received");
});
