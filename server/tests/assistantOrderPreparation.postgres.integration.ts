import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { OrderIntakeService } from "../services/assistant/orderIntakeService";
import { OrdersRepository } from "../storage/orders.repo";
import type { OrderPreparationRequest } from "../services/assistant/orderPreparationContract";
import { priceLineItem } from "../services/pricing/PricingService";

const org = `conversation-${randomUUID()}`, otherOrg = `other-${randomUUID()}`, actor = randomUUID(), buyer = randomUUID(), contact = randomUUID();
const area = randomUUID(), fixed = randomUUID();
const service = new OrderIntakeService(), reader = new OrdersRepository(db);
const context = () => ({ organizationId: org, userId: actor, conversationId: randomUUID() });
beforeAll(async () => {
  await db.insert(schema.organizations).values([{ id: org, name: "Conversation QA", slug: org, settings: { timezone: "America/Indiana/Indianapolis" } }, { id: otherOrg, name: "Other QA", slug: otherOrg }]);
  await db.insert(schema.users).values({ id: actor, email: `${actor}@example.invalid`, role: "owner" });
  await db.insert(schema.userOrganizations).values({ organizationId: org, userId: actor, role: "owner" });
  await db.insert(schema.customers).values({ id: buyer, organizationId: org, companyName: "Conversation buyer", status: "active", creditLimit: "1000000", creditLimitConfiguredAt: new Date() });
  await db.insert(schema.customerContacts).values({ id: contact, organizationId: org, customerId: buyer, firstName: "QA", lastName: "Contact" });
  for (const [id, quantity] of [[area, false], [fixed, true]] as const) {
    await db.insert(schema.products).values({ id, organizationId: org, name: quantity ? "Synthetic Fixed Sign" : "Synthetic Area Product", description: "Synthetic only", isActive: true, measurementMode: quantity ? "quantity_only" : "dimensions_required", pricingProfileKey: quantity ? "qty_only" : "default", pricingMode: quantity ? "quantity" : "area", requiresProductionJob: false });
    const [version] = await db.insert(schema.pbv2TreeVersions).values({ organizationId: org, productId: id, status: "ACTIVE", schemaVersion: 2, treeJson: {
      schemaVersion: 2, rootNodeIds: ["sides"], nodes: { sides: { id: "sides", kind: "question", label: "Sides", input: { type: "select", required: true, selectionKey: "sides", defaultValue: "single" }, choices: [{ id: "single", value: "single", label: "Single sided", isDefault: true }, { id: "double", value: "double", label: "Double sided" }] } },
      meta: { ...(quantity ? { fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" } } : {}), pricingV2: { base: quantity ? { perPieceCents: 400 } : { perSqftCents: 400 }, qtyTiers: [], tierBasis: "line_item_quantity" } },
    } }).returning();
    await db.update(schema.products).set({ pbv2ActiveTreeVersionId: version!.id }).where(eq(schema.products.id, id));
  }
});
afterAll(async () => { await pool.end(); });
async function prepare(input: ReturnType<typeof context>, request: OrderPreparationRequest) {
  const result = await service.prepareStructuredOrder({ ...input, request });
  const state = await service.inspectPreparation(input);
  expect(state.sessionId).toBeTruthy();
  return { result, state, sessionId: state.sessionId!, expectedIntakeVersion: state.expectedIntakeVersion! };
}
const base = (): OrderPreparationRequest => ({ header: { customerId: buyer, contactId: contact, label: "Synthetic conversational job", shippingMethod: "pickup", notesInternal: "Artwork arriving later" }, lines: { add: [{ productId: area, quantity: 10, width: 15.5, height: 24, optionsText: "double sided", productionNotes: "Contour cut; review art before production" }] } });
function plan(result: Awaited<ReturnType<typeof prepare>>["result"]) {
  const card = result.cards.find(card => card.kind === "action_proposal");
  if (!card) throw new Error(`Expected an executable proposal: ${result.response}`);
  return card!.plan as { orderIntakeSessionId: string; proposalFingerprint: string };
}

test("conversation-only preparation → GO → actual canonical persisted Order/Invoice; no production release", async () => {
  const input = context();
  const prepared = await prepare(input, base());
  const proposal = plan(prepared.result);
  const before = await db.select().from(schema.orders).where(eq(schema.orders.organizationId, org));
  expect(before).toHaveLength(0);
  const created = await service.createConfirmedOrder({ organizationId: org, actorUserId: actor, ...proposal });
  const saved = await reader.getOrderById(org, created.id);
  expect(saved).toMatchObject({ customerId: buyer, contactId: contact, label: "Synthetic conversational job", shippingMethod: "pickup" });
  const lines = await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId, created.id));
  expect(lines).toHaveLength(1); expect(lines[0]).toMatchObject({ quantity: 10, productId: area });
  expect(Number(lines[0]!.width)).toBe(15.5); expect(lines[0]!.optionSelectionsJson).toMatchObject({ selected: { sides: { value: "double" } } });
  expect(await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, created.id))).toHaveLength(1);
  expect(await db.select().from(schema.productionJobs).where(eq(schema.productionJobs.orderId, created.id))).toHaveLength(0);
  expect(await reader.getOrderById(otherOrg, created.id)).toBeUndefined();
});

test("multi-line correction preserves untouched fields, fixed size, EOD and exact authorized $165 total", async () => {
  await priceLineItem({ organizationId: org, productId: fixed, quantity: 28, widthIn: 0, heightIn: 0, pbv2ExplicitSelections: { sides: "single" } });
  const input = context(); const request = base();
  request.customerPoTotalCents = 71825;
  request.header!.deadlineJson = { requested: { date: "2026-11-10", kind: "eod", sourceText: "Customer requests November 10 EOD", localTime: null, timezone: null, instant: null }, accepted: null };
  request.lines!.add!.push({ productId: fixed, quantity: 28, overridePriceCents: 16500, overrideReason: "Explicit synthetic staff approval" });
  const initial = await prepare(input, request), oldPlan = plan(initial.result);
  const corrected = await prepare(input, { sessionId: initial.sessionId, expectedIntakeVersion: initial.expectedIntakeVersion, lines: { update: [{ index: 0, changes: { quantity: 20 } }] } });
  await expect(service.createConfirmedOrder({ organizationId: org, actorUserId: actor, ...oldPlan })).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
  const created = await service.createConfirmedOrder({ organizationId: org, actorUserId: actor, ...plan(corrected.result) });
  const saved = await reader.getOrderById(org, created.id);
  expect(saved?.label).toBe(request.header!.label); expect(saved?.dueDate).toBeNull();
  expect(saved?.deadlineJson?.requested).toMatchObject({ kind: "eod", timezone: "America/Indiana/Indianapolis" });
  expect(saved?.notesInternal).toContain("$718.25");
  const lines = await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId, created.id)).orderBy(schema.orderLineItems.sortOrder);
  expect(lines.map(line => line.quantity)).toEqual([20, 28]);
  expect([Number(lines[1]!.width), Number(lines[1]!.height), Number(lines[1]!.totalPrice)]).toEqual([24, 18, 165]);
  expect(lines[1]!.overridePriceCents).toBe(16500);
});

test("incomplete intent survives inspection and correction; no GO on missing dimensions or foreign identity", async () => {
  const input = context(); const request = base(); delete request.lines!.add![0]!.width;
  const incomplete = await prepare(input, request);
  expect(incomplete.result.cards.some(card => card.kind === "action_proposal")).toBe(false);
  expect(incomplete.result.response).toContain("dimensions");
  const corrected = await prepare(input, { sessionId: incomplete.sessionId, expectedIntakeVersion: incomplete.expectedIntakeVersion, lines: { update: [{ index: 0, changes: { width: 15.5 } }] } });
  plan(corrected.result);
  expect((await service.inspectPreparation({ ...input, organizationId: otherOrg })).proposal).toBeNull();
  await expect(service.prepareStructuredOrder({ ...input, organizationId: otherOrg, request: base() })).rejects.toMatchObject({ code: "ORDER_IDENTITY_REQUIRED" });
});

test("concurrent GO and retries create exactly one Order and linked Invoice", async () => {
  const input = context(), prepared = await prepare(input, base()); const proposal = plan(prepared.result);
  await expect(service.prepareStructuredOrder({ ...input, request: base() })).rejects.toMatchObject({ code: "ORDER_PROPOSAL_EXISTS" });
  const args = { organizationId: org, actorUserId: actor, ...proposal };
  const results = await Promise.all([service.createConfirmedOrder(args), service.createConfirmedOrder(args)]);
  expect(results[0]!.id).toBe(results[1]!.id);
  expect((await service.createConfirmedOrder(args)).id).toBe(results[0]!.id);
  expect(await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, results[0]!.id))).toHaveLength(1);
});

test("stale correction, actor mismatch, changed product/pricing and duplicate PO fail closed", async () => {
  const input = context(), first = await prepare(input, { ...base(), header: { ...base().header, poNumber: `QA-${randomUUID()}` } });
  const args = { organizationId: org, actorUserId: actor, ...plan(first.result) };
  await expect(service.createConfirmedOrder({ ...args, actorUserId: randomUUID() })).rejects.toMatchObject({ code: "SESSION_FORBIDDEN" });
  await expect(service.prepareStructuredOrder({ ...input, request: { sessionId: first.sessionId, expectedIntakeVersion: "0".repeat(64), header: { label: "stale" } } })).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
  await db.update(schema.products).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(schema.products.id, area));
  await expect(service.createConfirmedOrder(args)).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
  const current = await prepare(input, { sessionId: first.sessionId, expectedIntakeVersion: first.expectedIntakeVersion, header: { label: "Current" } });
  await service.createConfirmedOrder({ organizationId: org, actorUserId: actor, ...plan(current.result) });
  const duplicate = await prepare(context(), { ...base(), header: (first.state.proposal as { header: OrderPreparationRequest["header"] }).header });
  expect(duplicate.result.response).toContain("already exists"); expect(duplicate.result.cards.some(card => card.kind === "action_proposal")).toBe(false);
});

test("canonical failure rolls back Order, Invoice, audit and intake completion together", async () => {
  const prepared = await prepare(context(), base()); const proposal = plan(prepared.result);
  // A local test-only trigger simulates a durable finalization failure after creation.
  await db.execute(sql`create function qa_fail_intake() returns trigger language plpgsql as $$ begin if new.status='created' then raise exception 'QA finalization failure'; end if; return new; end $$`);
  await db.execute(sql`create trigger qa_fail_intake before update on assistant_order_intake_sessions for each row execute function qa_fail_intake()`);
  const before = await db.select().from(schema.orders).where(eq(schema.orders.organizationId, org));
  try { await expect(service.createConfirmedOrder({ organizationId: org, actorUserId: actor, ...proposal })).rejects.toThrow("QA finalization failure"); }
  finally { await db.execute(sql`drop trigger qa_fail_intake on assistant_order_intake_sessions`); await db.execute(sql`drop function qa_fail_intake()`); }
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId, org))).toHaveLength(before.length);
  expect((await db.select().from(schema.assistantOrderIntakeSessions).where(and(eq(schema.assistantOrderIntakeSessions.id, prepared.sessionId), eq(schema.assistantOrderIntakeSessions.organizationId, org))))[0]!.status).toBe("preview_ready");
  expect((await service.createConfirmedOrder({ organizationId: org, actorUserId: actor, ...proposal })).id).toBeTruthy();
});

test("multi-line clarification uses the existing option card, targets each line and rejects stale answers", async () => {
  const input = context();
  const [product] = await db.insert(schema.products).values({ organizationId: org, name: "Clarification fixture", description: "QA", isActive: true, measurementMode: "dimensions_required", requiresProductionJob: false }).returning();
  const [version] = await db.insert(schema.pbv2TreeVersions).values({ organizationId: org, productId: product!.id, schemaVersion: 2, status: "ACTIVE", treeJson: { schemaVersion: 2, rootNodeIds: ["finish"], nodes: { finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish", required: true }, choices: [{ value: "matte", label: "Matte" }, { value: "gloss", label: "Gloss" }] } }, meta: { pricingV2: { base: { perSqftCents: 400 } } } } }).returning();
  await db.update(schema.products).set({ pbv2ActiveTreeVersionId: version!.id }).where(eq(schema.products.id, product!.id));
  const first = await prepare(input, { header: { customerId: buyer }, lines: { add: [1, 2].map(quantity => ({ productId: product!.id, quantity, width: 24, height: 36 })) } });
  const cardInput = (result: typeof first.result) => {
    const card = result.cards.find(card => card.kind === "order_option_selection")!;
    const value = card.details!.orderOptionSelection as { orderIntakeSessionId: string; expectedIntakeVersion: string; lineIndex: number; productId: string; pbv2TreeVersionId: string };
    return { ...input, ...value, selections: [{ nodeId: "finish", valueId: "matte" }], useRemainingDefaults: false };
  };
  const answer = cardInput(first.result); expect(answer.lineIndex).toBe(0);
  const next = await service.submitOptionSelections(answer);
  const secondAnswer = cardInput(next); expect(secondAnswer.lineIndex).toBe(1);
  await expect(service.submitOptionSelections(answer)).rejects.toMatchObject({ code: "ORDER_OPTION_SELECTION_STALE" });
  const ready = await service.submitOptionSelections(secondAnswer);
  plan(ready);
  const readback = await service.inspectPreparation(input);
  expect((readback.proposal as { lines: Array<{ pbv2Selections: unknown }> }).lines.map(line => line.pbv2Selections)).toEqual([expect.objectContaining({ selected: { finish: { value: "matte" } } }), expect.objectContaining({ selected: { finish: { value: "matte" } } })]);
});

test("account modifiers never silently become normal pricing; customer/contact boundaries and pricing authority are enforced", async () => {
  const input = context();
  await db.update(schema.customers).set({ defaultDiscountPercent: "10" }).where(eq(schema.customers.id, buyer));
  try { const result = await prepare(input, base()); expect(result.result.response).toContain("pricing modifiers"); expect(result.result.cards.some(card => card.kind === "action_proposal")).toBe(false); }
  finally { await db.update(schema.customers).set({ defaultDiscountPercent: "0" }).where(eq(schema.customers.id, buyer)); }
  const [otherCustomer] = await db.insert(schema.customers).values({ organizationId: org, companyName: "Different QA buyer" }).returning();
  await expect(service.prepareStructuredOrder({ ...context(), request: { ...base(), header: { customerId: otherCustomer!.id, contactId: contact } } })).rejects.toMatchObject({ code: "ORDER_IDENTITY_REQUIRED" });
});

test("priced PO line changes cannot silently reassign another source line's override or reference price", async () => {
  const input = context(), prepared = await prepare(input, base());
  const intake = prepared.state.proposal!;
  await db.update(schema.assistantOrderIntakeSessions).set({ intakeJson: { ...intake, purchaseOrder: { attachmentId: randomUUID(), fileName: "synthetic-po.pdf", poNumber: "QA-PRICE-MAPPING", requestedDate: null, address: null, instructions: null, extractedFieldsVerified: false, warnings: [], linePricesCents: [1200], linePrices: [{ basis: "line_total", amountCents: 1200 }], pricingChoice: "po" } } }).where(eq(schema.assistantOrderIntakeSessions.id, prepared.sessionId));
  const current = await service.inspectPreparation(input);
  const request = { sessionId: prepared.sessionId, expectedIntakeVersion: current.expectedIntakeVersion! };
  await expect(service.prepareStructuredOrder({ ...input, request: { ...request, lines: { remove: [0] } } })).rejects.toMatchObject({ code: "ORDER_PO_LINE_MAPPING_REVIEW_REQUIRED" });
  await expect(service.prepareStructuredOrder({ ...input, request: { ...request, lines: { update: [{ index: 0, changes: { productId: fixed } }] } } })).rejects.toMatchObject({ code: "ORDER_PO_PRICE_REVIEW_REQUIRED" });
  expect((await service.inspectPreparation(input)).expectedIntakeVersion).toBe(current.expectedIntakeVersion);
});

test("concurrent corrections admit one revision and preserve the winning intent", async () => {
  const input = context(), prepared = await prepare(input, base());
  const results = await Promise.allSettled([20, 30].map(quantity => service.prepareStructuredOrder({ ...input, request: { sessionId: prepared.sessionId, expectedIntakeVersion: prepared.expectedIntakeVersion, lines: { update: [{ index: 0, changes: { quantity } }] } } })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
  const latest = await service.inspectPreparation(input);
  expect([20, 30]).toContain(latest.editableLines![0]!.quantity);
  expect((latest.proposal as { header: unknown }).header).toMatchObject({ label: base().header!.label, notesInternal: "Artwork arriving later" });
});
