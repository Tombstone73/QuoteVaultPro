import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OrderApplicationService, type OrderOperationResult, type OrderReadModel, type OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import { orderCompletionEligibility, type OrderCompletionEligibility, type OrderCompletionLineEvidence } from "../../src/modules/sales/orderLifecycle.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const standard = (overrides: Partial<OrderCompletionLineEvidence> = {}): OrderCompletionLineEvidence => ({
  orderLineId: "line-standard",
  description: "Standard printed line",
  workflowIntent: "standard_production",
  requiresProduction: true,
  orderedQuantity: 10,
  productionComplete: true,
  fulfilledQuantity: 10,
  routeComplete: true,
  ...overrides,
});

assert.equal(orderCompletionEligibility([standard()]).eligible, true, "eligible standard-production Order completes");
assert.equal(orderCompletionEligibility([standard({ productionComplete: false })]).blockers[0]?.kind, "production_incomplete", "incomplete Production blocks completion");
assert.equal(orderCompletionEligibility([standard({ fulfilledQuantity: 9 })]).blockers[0]?.kind, "fulfillment_remaining", "remaining Fulfillment blocks completion");
assert.equal(orderCompletionEligibility([standard({ routeComplete: false })]).blockers[0]?.kind, "route_incomplete", "incomplete canonical Route blocks completion");
assert.equal(orderCompletionEligibility([{ ...standard(), workflowIntent: "fulfillment_only", requiresProduction: false, productionComplete: false, routeComplete: false }]).eligible, true, "fulfillment-only work requires only its canonical handoff and does not invent Production or Routing");
assert.equal(orderCompletionEligibility([{ ...standard(), workflowIntent: "service_fee", requiresProduction: false, productionComplete: false, fulfilledQuantity: 0, routeComplete: false }]).eligible, true, "service work may complete explicitly without physical work");
assert.equal(orderCompletionEligibility([standard(), { ...standard({ orderLineId: "line-fee" }), workflowIntent: "service_fee", requiresProduction: false, productionComplete: false, fulfilledQuantity: 0 }]).eligible, true, "every eligible line in a mixed Order completes");
assert.equal(orderCompletionEligibility([standard(), standard({ orderLineId: "line-blocked", fulfilledQuantity: 0 })]).eligible, false, "one incomplete mixed-workflow line blocks the entire Order");
assert.equal(orderCompletionEligibility([standard({ workflowIntent: null })]).blockers[0]?.kind, "workflow_unavailable", "missing frozen workflow facts fail closed");
assert.equal(orderCompletionEligibility([]).eligible, false, "empty Orders cannot complete");

const org = brandedId<"OrganizationId">("org-a");
const orderId = brandedId<"OrderId">("order-a");
const invoiceId = brandedId<"InvoiceId">("invoice-a");
const usd = currencyCode("USD");
const staff = (capabilities: StaffPrincipal["authority"]["capabilities"] = ["order.edit"]): StaffPrincipal => ({
  kind: "staff", organizationId: org, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});
const context = (requestId: string, principal = staff(), organizationId = org): OperationContext => ({
  principal,
  organizationId,
  operationId: `test:${requestId}`,
  businessRequest: { id: requestId, payloadFingerprint: "derived-by-application" },
});
const eligible = orderCompletionEligibility([standard()]);
const read = (state: "open" | "completed" | "cancelled", archivedAt?: string, completion: OrderCompletionEligibility = eligible, withInvoice = true): OrderReadModel => ({
  order: {
    organizationId: org,
    orderId,
    customerContact: { organizationId: org, customerId: brandedId<"CustomerId">("customer-a") },
    currency: usd,
    terms: {},
    lines: [],
    commercialState: state,
    ...(withInvoice ? { billingInvoiceReference: invoiceId } : {}),
    ...(state === "completed" ? { completedAt: "2026-09-03T12:00:00.000Z", completedBy: { principalKind: "staff", subjectId: "staff-a" } } : {}),
    ...(archivedAt ? { archivedAt, archivedBy: { principalKind: "staff", subjectId: "staff-a" } } : {}),
  },
  number: { kind: "order", core: 1001n, display: "ORD-1001" },
  revision: "7",
  totals: { calculated: money(usd, 10000), selling: money(usd, 10000) },
  routes: [],
  completionEligibility: completion,
});

class LifecycleHarness {
  current: OrderReadModel | null;
  eligibility: OrderCompletionEligibility;
  completed = 0;
  archived = 0;
  unarchived = 0;
  auditKinds: string[] = [];
  private readonly withInvoice: boolean;
  private readonly stored = new Map<string, OrderOperationResult>();
  constructor(state: "open" | "completed" | "cancelled", completion = eligible, archivedAt?: string, withInvoice = true) {
    this.withInvoice = withInvoice;
    this.current = read(state, archivedAt, completion, withInvoice);
    this.eligibility = completion;
  }
  transaction: OrderTransaction = {
    customers: {} as never,
    products: {} as never,
    pricing: {} as never,
    billing: {} as never,
    routing: {} as never,
    materialRequirements: {} as never,
    reserve: async (input) => {
      const result = this.stored.get(input.businessRequestId);
      return result
        ? { kind: "replay", request: { id: input.businessRequestId, status: "succeeded", resultJson: result } }
        : { kind: "new", request: { id: input.businessRequestId, status: "in_progress", resultJson: null } };
    },
    succeed: async (_organizationId, requestId, result) => { this.stored.set(requestId, result); },
    attribute: async () => undefined,
    audit: async (input) => { this.auditKinds.push(input.event.eventType); },
    allocateNumber: async () => { throw new Error("not used"); },
    create: async () => { throw new Error("not used"); },
    read: async () => this.current,
    update: async () => { throw new Error("not used"); },
    removeLinesNotIn: async () => undefined,
    hasRoute: async () => false,
    cancellationBlockers: async () => [],
    completionEligibility: async () => this.eligibility,
    complete: async () => {
      if (!this.current || this.current.order.commercialState !== "open") return false;
      this.completed += 1;
      this.current = read("completed", undefined, this.eligibility, this.withInvoice);
      return true;
    },
    archive: async () => {
      if (!this.current || this.current.order.commercialState === "open" || this.current.order.archivedAt) return false;
      this.archived += 1;
      this.current = read(this.current.order.commercialState, "2026-09-03T13:00:00.000Z", this.eligibility, this.withInvoice);
      return true;
    },
    unarchive: async () => {
      if (!this.current?.order.archivedAt) return false;
      this.unarchived += 1;
      this.current = read(this.current.order.commercialState, undefined, this.eligibility, this.withInvoice);
      return true;
    },
    cancel: async () => false,
  };
  service() { return new OrderApplicationService({ transaction: async (work) => work(this.transaction) }); }
}

const completeHarness = new LifecycleHarness("open");
const completeService = completeHarness.service();
const completeCommand = { organizationId: org, orderId, businessRequestId: brandedId<"BusinessRequestId">("complete-a"), expectedStateToken: "7" };
const completed = await completeService.complete(context("complete-a"), completeCommand);
assert.equal(completed.ok && completed.value.order.order.commercialState, "completed", "explicit authorized completion persists the terminal state");
assert.equal(completeHarness.completed, 1);
assert.deepEqual(completeHarness.auditKinds, ["order_completed"], "completion uses the canonical Sales audit convention");
assert.equal(completed.ok && completed.value.order.order.billingInvoiceReference, invoiceId, "completion preserves the Invoice identity despite positive Order value");
const noInvoiceCompletion = await new LifecycleHarness("open", eligible, undefined, false).service().complete(context("complete-without-invoice"), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">("complete-without-invoice") });
assert.equal(noInvoiceCompletion.ok && noInvoiceCompletion.value.order.order.commercialState, "completed", "operational completion does not require or create an Invoice");
assert.equal(noInvoiceCompletion.ok && noInvoiceCompletion.value.draftInvoiceId, undefined, "operational completion does not manufacture a Billing reference");
const replay = await completeService.complete(context("complete-a"), completeCommand);
assert.equal(replay.ok, true, "the same durable completion request replays safely");
assert.equal(completeHarness.completed, 1, "completion replay does not perform a second transition");

const blockedHarness = new LifecycleHarness("open", orderCompletionEligibility([standard({ productionComplete: false })]));
const blocked = await blockedHarness.service().complete(context("blocked-a"), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">("blocked-a") });
assert.equal(!blocked.ok && blocked.error.code, "CONFLICT", "ordinary incomplete workflow state returns a controlled conflict");
assert.equal(blockedHarness.completed, 0);

const unauthorizedHarness = new LifecycleHarness("open");
const unauthorized = await unauthorizedHarness.service().complete(context("unauthorized-a", staff([])), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">("unauthorized-a") });
assert.equal(!unauthorized.ok && unauthorized.error.code, "FORBIDDEN", "completion authority is enforced server-side");
assert.equal(unauthorizedHarness.completed, 0);
const wrongTenant = await new LifecycleHarness("open").service().complete(context("tenant-a", staff(), brandedId<"OrganizationId">("org-b")), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">("tenant-a") });
assert.equal(!wrongTenant.ok && wrongTenant.error.code, "WRONG_TENANT", "cross-tenant lifecycle mutation is rejected before repository access");

const openArchive = await new LifecycleHarness("open").service().archive(context("archive-open"), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">("archive-open") });
assert.equal(!openArchive.ok && openArchive.error.code, "CONFLICT", "open Orders cannot archive");
for (const state of ["completed", "cancelled"] as const) {
  const harness = new LifecycleHarness(state);
  const service = harness.service();
  const requestId = `archive-${state}`;
  const archived = await service.archive(context(requestId), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">(requestId) });
  assert.equal(archived.ok && Boolean(archived.value.order.order.archivedAt), true, `${state} Orders may archive without deleting facts`);
  const archiveReplay = await service.archive(context(requestId), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">(requestId) });
  assert.equal(archiveReplay.ok, true);
  assert.equal(harness.archived, 1, "archive replay performs one transition");
  const restored = await service.unarchive(context(`restore-${state}`), { ...completeCommand, businessRequestId: brandedId<"BusinessRequestId">(`restore-${state}`) });
  assert.equal(restored.ok && restored.value.order.order.commercialState, state, "unarchive changes visibility without reopening operational state");
  assert.equal(restored.ok && restored.value.order.order.archivedAt, undefined);
}

const [applicationSource, persistenceSource, migration, billingSource, workspaceSource, orderWorkspaceSource, productionSource, prepressSource, proofingSource, fulfillmentSource] = await Promise.all([
  readFile(new URL("../../src/modules/sales/orderApplication.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresOrderTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../server/db/migrations_v2/0258_v2_order_completion_archive_lifecycle.sql", import.meta.url), "utf8"),
  readFile(new URL("../../src/modules/billing/billingApplication.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresSalesWorkspaceReads.ts", import.meta.url), "utf8"),
  readFile(new URL("../../ui/src/OrderWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/production/postgresProductionTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/prepress/postgresPrepressTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/proofing/postgresProofingTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/fulfillment/postgresFulfillmentWorkspaceReads.ts", import.meta.url), "utf8"),
]);
assert.match(applicationSource, /Only an open Order can be edited/);
assert.match(persistenceSource, /FROM v2_sales_document_lines/);
assert.doesNotMatch(persistenceSource.slice(persistenceSource.indexOf("async complete("), persistenceSource.indexOf("async cancel(")), /v2_billing_payments|v2_billing_refunds|v2_quickbooks/);
assert.match(migration, /archived_at IS NOT NULL AND commercial_state IN \('completed', 'cancelled'\)/);
assert.match(migration, /Production attempts require an open Order/);
assert.match(billingSource, /commercial_state==="cancelled"/, "completed Orders retain independent Billing issuance");
assert.match(workspaceSource, /o\.archived_at IS NULL/);
assert.match(workspaceSource, /o\.archived_at IS NOT NULL/);
assert.match(orderWorkspaceSource, /canUpload=\{props\.canViewArtwork && editable\}/, "terminal Order artwork replacement is not offered");
for (const queueSource of [productionSource, prepressSource, proofingSource, fulfillmentSource])
  assert.match(queueSource, /archived_at IS NULL/, "archived Orders are absent from normal operational queues");

console.log("Order completion/archive lifecycle tests passed (workflow, authority, idempotency, preservation, and terminal visibility)." );
