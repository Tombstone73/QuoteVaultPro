import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getTableColumns, getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { purchaseOrderCorrection, purchaseOrderLineTotal } from "../services/assistant/purchaseOrderCorrections";
import { resolvePersistedLineItemPricing } from "../lib/lineItemPricingPersistence";

// No database or Order write: exercise real intake, selection, fingerprint,
// override and tax operations against a predicate-aware repository double.
const tables = new Map<string, any[]>();
const dialect = new PgDialect();
let sequence = 0;
const predicates: string[] = [];
const locks: string[] = [];
const rows = (table: any) => tables.get(getTableName(table)) ?? [];
function matches(table: any, row: any, condition: any) {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition);
  predicates.push(query.sql);
  const columns = getTableColumns(table);
  const key = (name: string) => Object.entries(columns).find(([, col]) => col.name === name)?.[0] ?? name;
  for (const match of query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)) {
    if (row[key(match[1])] !== query.params[Number(match[2]) - 1]) return false;
  }
  for (const match of query.sql.matchAll(/"[^"]+"\."([^"]+)" in \(([^)]+)\)/g)) {
    const values = [...match[2].matchAll(/\$(\d+)/g)].map(entry => query.params[Number(entry[1]) - 1]);
    if (!values.includes(row[key(match[1])])) return false;
  }
  if (query.sql.includes("->'purchaseOrder' is not null") && !row.intakeJson?.purchaseOrder) return false;
  if (query.sql.includes("lower(btrim(")) return String(row.poNumber ?? "").trim().toLowerCase() === query.params.at(-1);
  return true;
}
function selection(projection?: any) {
  let table: any, condition: any, max = Infinity, sorted = false;
  const builder: any = {
    from(value: any) { table = value; return builder; },
    where(value: any) { condition = value; return builder; },
    limit(value: number) { max = value; return builder; },
    orderBy() { sorted = true; return builder; },
    then(resolve: any, reject: any) {
      try {
        let result = rows(table).filter(row => matches(table, row, condition));
        if (sorted) result = result.slice().reverse();
        result = result.slice(0, max);
        if (projection) result = result.map(row => Object.fromEntries(Object.entries(projection).map(([key, col]: any) => [key, row[Object.entries(getTableColumns(table)).find(([, column]) => column.name === col.name)![0]]])));
        return Promise.resolve(structuredClone(result)).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    },
  };
  return builder;
}
const database: any = {
  select: (projection?: any) => selection(projection),
  insert: (table: any) => ({ values: (value: any) => ({ returning: async () => {
    const row = { id: `session_${++sequence}`, status: "collecting", proposalFingerprint: null, orderId: null, ...structuredClone(value) };
    tables.set(getTableName(table), [...rows(table), row]); return [structuredClone(row)];
  }, then: (resolve: any) => Promise.resolve().then(resolve) }) }),
  update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => {
    const run = () => rows(table).filter(row => matches(table, row, condition)).map(row => { Object.assign(row, structuredClone(value)); return structuredClone(row); });
    return { then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject), returning: async () => run() };
  } }) }),
  execute: async (statement: any) => { locks.push(dialect.sqlToQuery(statement).sql); return []; },
  transaction: async (callback: any) => callback(database),
};
let saved: any;
const create = jest.fn(async (_tx: any, input: any) => {
  const line = input.payload.lineItems[0];
  const pricing = resolvePersistedLineItemPricing({ baseCalculatedTotalCents: line.pbv2SnapshotJson.pricing.totalCents, quantity: line.quantity, body: line, specsJson: line.specsJson });
  saved = { id: "mock_order", displayNumber: "O-MOCK", total: input.payload.taxAmount + pricing.effectiveTotalCents / 100, payload: input.payload, pricing };
  tables.set("orders", [...rows(schema.orders), { id: saved.id, organizationId: input.organizationId, poNumber: input.payload.poNumber }]);
  return saved;
});
const price = jest.fn(async (input: any) => {
  const tree = rows(schema.pbv2TreeVersions).find(row => row.id === input.pbv2TreeVersionIdOverride)!.treeJson;
  return { lineTotalCents: 12100, pbv2TreeVersionId: input.pbv2TreeVersionIdOverride,
    pbv2SnapshotJson: { treeJson: tree, pricing: { totalCents: 12100 }, selectedOptions: Object.entries(input.pbv2ExplicitSelections).map(([optionId, value]) => ({ optionId, value })) } };
});
jest.unstable_mockModule("../db", () => ({ db: database }));
jest.unstable_mockModule("../storage", () => ({ storage: { getOrderById: async (org: string, id: string) => org === "org" && id === saved?.id ? saved : null } }));
jest.unstable_mockModule("../services/orders/canonicalOrderOperations", () => ({ canonicalOrderOperations: { createInTransaction: create, create: jest.fn() } }));
jest.unstable_mockModule("../services/pricing/PricingService", () => ({ priceLineItem: price }));
const { OrderIntakeService } = await import("../services/assistant/orderIntakeService");
const { createDeferredOrderExecutionCommand } = await import("../services/assistant/execution/deferredOrderCommands");
const service = new OrderIntakeService();
const scope = { organizationId: "org", userId: "staff", conversationId: "conversation" };
const tree = (id: string) => ({ schemaVersion: 2, rootNodeIds: [id], nodes: { [id]: { id, kind: "question", label: "Sides", input: { type: "select", selectionKey: id, defaultValue: "single" }, choices: [{ value: "single", label: "Single Sided" }, { value: "double", label: "Double Sided" }] } } });
const request = () => ({ ...scope, customerName: "Brainstorm Print", dueDate: "2026-11-05", lines: [{ productName: "Coroplast", quantity: 28, width: 24, height: 18, options: "", versionCount: 28 }],
  source: { attachmentId: "attachment", fileName: "po152918.pdf", poNumber: "152918", requestedDate: "2026-11-05", address: null, instructions: "28 versions, one each. MUST EOD 11/5", extractedFieldsVerified: true, warnings: [], linePricesCents: [null], linePrices: [{ basis: "line_total" as const, amountCents: 16500 }] } });
const pending = () => rows(schema.assistantOrderIntakeSessions).filter(row => row.status !== "abandoned").at(-1)!;
const plan = (result: any) => result.cards.find((card: any) => card.kind === "action_proposal")?.plan;

beforeEach(() => {
  tables.clear(); sequence = 0; saved = null; predicates.length = 0; locks.length = 0; create.mockClear(); price.mockClear();
  tables.set("customers", [{ id: "customer", companyName: "Brainstorm Print", organizationId: "org", isTaxExempt: false }]);
  tables.set("organizations", [{ id: "org", defaultTaxRate: "0.07", taxEnabled: true }]);
  tables.set("user_organizations", [{ userId: "staff", organizationId: "org", role: "admin" }]);
  tables.set("products", [
    { id: "coro", name: "Coroplast", organizationId: "org", isActive: true, pbv2ActiveTreeVersionId: "coro_tree", measurementMode: "dimensions_required", isTaxable: true },
    { id: "yard", name: "Yard Signs", organizationId: "org", isActive: true, pbv2ActiveTreeVersionId: "yard_tree", measurementMode: "dimensions_required", isTaxable: true },
    { id: "other_yard", name: "Yard Signs", organizationId: "other", isActive: true, pbv2ActiveTreeVersionId: "other_tree" },
  ]);
  tables.set("pbv2_tree_versions", [
    { id: "coro_tree", organizationId: "org", productId: "coro", status: "ACTIVE", treeJson: tree("coro_sides"), updatedAt: new Date(0) },
    { id: "yard_tree", organizationId: "org", productId: "yard", status: "ACTIVE", treeJson: tree("yard_sides"), updatedAt: new Date(0) },
  ]);
});

describe("persisted PO corrections (mock repositories, no actual orders)", () => {
  it("recognizes the supplied multi-turn corrections and distinguishes monetary bases", () => {
    expect(purchaseOrderCorrection("product should be yard signs").productName).toBe("yard signs");
    expect(purchaseOrderCorrection("1. use the product ‘yard signs’ 2. use the PO pricing")).toMatchObject({ productName: "yard signs", usePoPricing: true });
    expect(purchaseOrderLineTotal({ basis: "line_total", amountCents: 16500 }, 28)).toBe(16500);
    expect(purchaseOrderLineTotal({ basis: "unit", amountCents: 16500 }, 28)).toBe(462000);
    expect(purchaseOrderLineTotal({ basis: "order_total", amountCents: 16500 }, 28)).toBeNull();
  });

  it("persists incomplete intake, resets product schema, and carries exact PO pricing through GO payload", async () => {
    const input = request(); input.lines[0].options = "Prints4/4";
    const originalTree = rows(schema.pbv2TreeVersions)[0].treeJson;
    originalTree.rootNodeIds.push("finish");
    originalTree.nodes.finish = { id: "finish", kind: "question", label: "Finish", input: { type: "select" }, choices: [{ value: "matte", label: "Matte" }] };
    const initial = await service.prepareFromPurchaseOrder(input);
    expect(initial.cards[0].kind).toBe("order_option_selection");
    const original = pending();
    const corrected = await service.continuePurchaseOrder({ ...scope, message: "product should be yard signs" });
    expect(original.status).toBe("abandoned");
    expect(plan(corrected)).toBeDefined();
    expect(pending().intakeJson.lines[0]).toMatchObject({ productId: "yard", pbv2TreeVersionId: "yard_tree", pbv2Selections: { selected: { yard_sides: { value: "double" } } } });
    expect(pending().intakeJson.lines[0].pbv2Selections.selected).not.toHaveProperty("coro_sides");
    expect(pending().intakeJson.lines[0].pbv2Selections.selected).not.toHaveProperty("finish");
    const stale = plan(corrected);
    const paid = await service.continuePurchaseOrder({ ...scope, message: "1. use the product ‘yard signs’ 2. use the PO pricing" });
    const latest = plan(paid);
    expect(latest).toBeDefined();
    await expect(service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...stale })).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
    const validation = await service.revalidateCreateProposal({ organizationId: "org", orderIntakeSessionId: latest.orderIntakeSessionId, expectedProposalFingerprint: latest.proposalFingerprint });
    expect(validation).toMatchObject({ valid: true, proposal: { taxCents: 1155, totalCents: 17655, lines: [{ productId: "yard", quantity: 28, totalCents: 16500, pricingSource: "po", versionCount: 28 }] } });
    const command = createDeferredOrderExecutionCommand("orders.create", service);
    const preview = await command.buildPreview({ scope: { ...scope, permissions: ["assistant.orders.create"], environment: "test" }, arguments: { orderIntakeSessionId: latest.orderIntakeSessionId, proposalFingerprint: latest.proposalFingerprint } } as any);
    expect(preview.preview.sideEffects.join(" ")).toContain("PO $165.00 line total");
    expect(preview.preview.sideEffects.join(" ")).not.toContain("$165.00 per unit");
    await service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...latest });
    expect(create).toHaveBeenCalledTimes(1);
    expect(saved.payload).toMatchObject({ poNumber: "152918", dueDate: "2026-11-05", productionIntakePolicy: "deferred", lineItems: [{ productId: "yard", quantity: 28, totalPrice: 165, overridePriceCents: 16500, specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 16500, baseCalculatedTotalCents: 12100 } } }] });
    expect(saved.payload.lineItems[0].productionNotes).toContain("28 versions across 28 pieces");
    expect(saved.pricing.effectiveTotalCents).toBe(16500);
    expect(saved.payload).not.toHaveProperty("shippingCents");
    await service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...latest });
    expect(create).toHaveBeenCalledTimes(1);
    expect(locks.some(value => value.includes("for update"))).toBe(true);
    expect(locks.some(value => value.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it.each(["absent", "ambiguous"])("invalidates old GO and clarifies %s requested products", async kind => {
    const input = request(); input.lines[0].options = "Single Sided";
    const old = plan(await service.prepareFromPurchaseOrder(input));
    if (kind === "ambiguous") tables.get("products")!.push({ ...rows(schema.products)[1], id: "yard_duplicate" });
    const result = await service.continuePurchaseOrder({ ...scope, message: `product should be ${kind === "absent" ? "Missing Product" : "Yard Signs"}` });
    expect(result.cards[0].kind).toBe("missing_information"); expect(plan(result)).toBeUndefined();
    expect(pending().intakeJson.lines).toEqual([]);
    await expect(service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...old })).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unauthorized PO override, including permission loss after preview", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    await service.prepareFromPurchaseOrder(input);
    tables.get("user_organizations")![0].role = "manager";
    const denied = await service.continuePurchaseOrder({ ...scope, message: "use the PO pricing" });
    expect(plan(denied)).toBeUndefined(); expect(denied.response).toContain("pricing override permission");
    tables.get("user_organizations")![0].role = "admin";
    const allowed = plan(await service.continuePurchaseOrder({ ...scope, message: "use the PO pricing" }));
    tables.get("user_organizations")![0].role = "member";
    await expect(service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...allowed })).rejects.toMatchObject({ code: "ORDER_PRICE_OVERRIDE_FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  it("cannot publish an older pricing result after a product correction supersedes its session", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    const implementation = price.getMockImplementation()!;
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    price.mockImplementationOnce(async value => { started(); await waiting; return implementation(value); });
    const older = service.prepareFromPurchaseOrder(input);
    // Attach the rejection handler immediately to avoid an unhandled rejection.
    const rejected = expect(older).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
    await entered;
    const corrected = await service.continuePurchaseOrder({ ...scope, message: "product should be Yard Signs" });
    expect(plan(corrected)).toBeDefined();
    release(); await rejected;
    expect(pending().intakeJson.lines[0].productId).toBe("yard");
    expect(rows(schema.assistantOrderIntakeSessions).filter(row => row.status === "preview_ready")).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps duplicate-PO and tenant/user boundaries enforced", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    const current = plan(await service.prepareFromPurchaseOrder(input));
    expect(await service.continuePurchaseOrder({ ...scope, organizationId: "other", message: "use the PO pricing" })).toMatchObject({ handled: false });
    await expect(service.createConfirmedOrder({ organizationId: "org", actorUserId: "other_user", ...current })).rejects.toMatchObject({ code: "SESSION_FORBIDDEN" });
    tables.set("orders", [{ id: "existing", organizationId: "org", poNumber: "152918" }]);
    await expect(service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...current })).rejects.toMatchObject({ code: "CUSTOMER_PO_DUPLICATE" });
    expect(create).not.toHaveBeenCalled();
    expect(predicates.some(value => value.includes('"organization_id"'))).toBe(true);
  });

  it("preserves canonical selling prices when staff have not chosen a PO override", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    tables.get("user_organizations")![0].role = "member";
    const current = plan(await service.prepareFromPurchaseOrder(input));
    await service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...current });
    expect(saved.payload.lineItems[0]).toMatchObject({ productId: "coro", totalPrice: 121, overridePriceCents: null });
    expect(saved.pricing.hasPriceOverride).toBe(false);
    expect(saved.total).toBe(129.47);
  });

  it("retains the PO price decision through the existing option selection interface", async () => {
    const missingSides = request(); missingSides.source.instructions = "28 versions, one each";
    await service.prepareFromPurchaseOrder(missingSides);
    const response = await service.continuePurchaseOrder({ ...scope, message: "use the PO pricing" });
    expect(response.cards[0].kind).toBe("order_option_selection");
    const session = pending();
    const selected = await service.submitOptionSelections({ ...scope, orderIntakeSessionId: session.id, expectedIntakeVersion: (response.cards[0].details as any).orderOptionSelection.expectedIntakeVersion, productId: "coro", pbv2TreeVersionId: "coro_tree", selections: [{ nodeId: "coro_sides", valueId: "double" }], useRemainingDefaults: false });
    expect(plan(selected)).toBeDefined();
    expect(session.intakeJson.purchaseOrder.pricingChoice).toBe("po");
    const reviewed = selected.cards.find(card => card.kind === "order_intake_summary");
    expect(reviewed?.details).toMatchObject({ lines: [{ totalCents: 16500, pricingSource: "po" }] });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires reinspection before using legacy prices without an explicit monetary basis", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    const old = plan(await service.prepareFromPurchaseOrder(input));
    const source = pending().intakeJson.purchaseOrder;
    delete source.linePrices; delete source.requestedLines; source.linePricesCents = [16500];
    const result = await service.continuePurchaseOrder({ ...scope, message: "use the PO pricing" });
    expect(plan(result)).toBeUndefined();
    expect(result.response).toContain("unit price or line total");
    await expect(service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...old })).rejects.toMatchObject({ code: "ORDER_PROPOSAL_STALE" });
    const product = await service.continuePurchaseOrder({ ...scope, message: "product should be Yard Signs" });
    expect(plan(product)).toBeUndefined(); expect(product.response).toContain("Reinspect the attached PO");
    expect(create).not.toHaveBeenCalled();
  });

  it("honors an actual PO unit price without losing the canonical price comparison", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4"; input.lines[0].quantity = 2;
    input.source.linePrices = [{ basis: "unit" as any, amountCents: 5900 }]; input.source.linePricesCents = [5900] as any;
    (input.source as any).pricingChoice = "po";
    const response = await service.prepareFromPurchaseOrder(input);
    expect(response.cards.find(card => card.kind === "order_intake_summary")?.details).toMatchObject({ lines: [{ unitPriceCents: 5900, totalCents: 11800, canonicalTotalCents: 12100, poPriceDifferenceCents: 150 }] });
  });

  it("cannot confirm a product that does not support required 4/4 or an unallocated order total", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    rows(schema.pbv2TreeVersions)[0].treeJson.nodes.coro_sides.choices.pop();
    const conflict = await service.prepareFromPurchaseOrder(input);
    expect(plan(conflict)).toBeUndefined(); expect(conflict.response).toContain("4/4");
    expect(await service.revalidateCreateProposal({ organizationId: "org", orderIntakeSessionId: pending().id, expectedProposalFingerprint: "" })).toMatchObject({ valid: false, code: "ORDER_OPTION_CONTRADICTORY" });
    input.lines[0].productName = "Yard Signs";
    input.source.linePrices[0].basis = "order_total" as any;
    (input.source as any).pricingChoice = "po";
    const ambiguous = await service.prepareFromPurchaseOrder(input);
    expect(plan(ambiguous)).toBeUndefined(); expect(ambiguous.response).toContain("order total");
  });
  it.each(["click", "type"])("clarifies missing sides by %s on the same PO proposal and preserves all evidence and price decisions", async mode => {
    const input = request(); input.source.instructions = "28 versions, one each. MUST EOD 11/5"; input.lines[0].productName = "Yard Signs"; (input.source as any).pricingChoice = "po";
    const question = await service.prepareFromPurchaseOrder(input);
    expect(question.response).toContain("Should these signs be single-sided or double-sided?");
    const payload = (question.cards[0].details as any).orderOptionSelection;
    expect(payload.groups[0].choices.map((v: any) => v.valueId)).toEqual(["single", "double"]);
    expect(pending().intakeJson.lines[0].pbv2SelectionSources?.yard_sides).toBeUndefined();
    expect(plan(question)).toBeUndefined();
    const before = structuredClone(pending());
    const answer = mode === "click" ? await service.submitOptionSelections({ ...scope, ...payload, selections: [{ nodeId: "yard_sides", valueId: "double" }], useRemainingDefaults: false })
      : await service.continuePurchaseOrder({ ...scope, message: "Double-sided" });
    expect(pending().id).toBe(before.id);
    expect(pending().intakeJson).toMatchObject({ customerId: "customer", dueDate: input.dueDate, purchaseOrder: before.intakeJson.purchaseOrder, lines: [{ productId: "yard", quantity: 28, width: 24, height: 18, versionCount: 28, pbv2Selections: { selected: { yard_sides: { value: "double" } } } }] });
    expect(plan(answer)).toBeDefined();
    const reviewed = answer.cards.find(card => card.kind === "order_intake_summary")?.details as any;
    expect(reviewed.lines[0]).toMatchObject({ productId: "yard", totalCents: 16500, versionCount: 28, selections: [{ groupId: "yard_sides", valueId: "double", source: "explicit" }] });
    expect(create).not.toHaveBeenCalled();
    await service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...plan(answer) });
    const readback = await (await import("../storage")).storage.getOrderById("org", "mock_order");
    expect(readback).toBe(saved); // Mock readback only: no claim of PostgreSQL persistence.
    expect(saved.payload.lineItems[0]).toMatchObject({ productId: "yard", quantity: 28, width: 24, height: 18, totalPrice: 165, pbv2SnapshotJson: { selectedOptions: [{ optionId: "yard_sides", value: "double" }] } });
    expect(saved.payload.lineItems[0].productionNotes).toContain("28 versions across 28 pieces");
  });

  it.each(["Prints 4/4", "Prints 4/0"])("explicit %s skips clarification and reaches the canonical saved payload", async options => {
    const input = request(); input.lines[0].options = options; input.source.instructions = options;
    const response = await service.prepareFromPurchaseOrder(input);
    expect(response.cards.some(card => card.kind === "order_option_selection")).toBe(false);
    await service.createConfirmedOrder({ organizationId: "org", actorUserId: "staff", ...plan(response) });
    expect(saved.payload.lineItems[0].pbv2SnapshotJson.selectedOptions).toEqual([{ optionId: "coro_sides", value: options.endsWith("4/0") ? "single" : "double" }]);
  });

  it("rejects old clickable questions after proposal edits or a catalog revision, even with the same product ID", async () => {
    const missingSides = request(); missingSides.source.instructions = "28 versions, one each";
    const question = await service.prepareFromPurchaseOrder(missingSides);
    const payload = (question.cards[0].details as any).orderOptionSelection;
    const answer = { ...scope, ...payload, selections: [{ nodeId: "coro_sides", valueId: "double" }], useRemainingDefaults: false };
    pending().intakeJson.lines[0].quantity = 29;
    await expect(service.submitOptionSelections(answer)).rejects.toMatchObject({ code: "ORDER_OPTION_SELECTION_STALE" });
    pending().intakeJson.lines[0].quantity = 28;
    rows(schema.products)[0].updatedAt = new Date(1000);
    await expect(service.submitOptionSelections(answer)).rejects.toMatchObject({ code: "ORDER_OPTION_SELECTION_STALE" });
    delete rows(schema.products)[0].updatedAt;
    rows(schema.pbv2TreeVersions)[0].updatedAt = new Date(1000);
    await expect(service.submitOptionSelections(answer)).rejects.toMatchObject({ code: "ORDER_OPTION_SELECTION_STALE" });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires explicit resolution of an unsupported PO option and retains the original source instructions", async () => {
    const input = request(); input.lines[0].options = "Prints 4/4";
    rows(schema.pbv2TreeVersions)[0].treeJson.nodes.coro_sides.choices.pop();
    const conflict = await service.prepareFromPurchaseOrder(input);
    expect(conflict.cards[0].kind).toBe("order_option_selection");
    expect(conflict.response).toContain("no unique compatible");
    expect((conflict.cards[0].details as any).orderOptionSelection.allowDefaults).toBe(false);
    expect(plan(await service.continuePurchaseOrder({ ...scope, message: "use defaults" }))).toBeUndefined();
    const resolved = await service.continuePurchaseOrder({ ...scope, message: "Single-sided" });
    expect(plan(resolved)).toBeDefined();
    expect(pending().intakeJson.purchaseOrder.instructions).toBe(input.source.instructions);
    expect(pending().intakeJson.purchaseOrder.warnings.join(" ")).toContain("Staff explicitly resolved");
  });

  it("uses explicit PO print instructions even when the extracted options field omitted them", async () => {
    const input = request(); input.source.instructions += ". Prints 4/4";
    const response = await service.prepareFromPurchaseOrder(input);
    expect(plan(response)).toBeDefined();
    expect(pending().intakeJson.lines[0].pbv2Selections.selected.coro_sides.value).toBe("double");
  });

});
