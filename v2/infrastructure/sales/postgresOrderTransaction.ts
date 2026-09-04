import type { Pool, PoolClient } from "pg";
import { PostgresCustomersCompatibilityReader } from "../compatibility/postgresCustomersRead.js";
import { PostgresProductsCompatibilityReader } from "../compatibility/postgresProductsRead.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { PostgresBillingDraftInvoiceTransaction } from "../billing/postgresBillingDraftInvoiceTransaction.js";
import { PostgresRoutingRepository } from "../routing/postgresRoutingRepository.js";
import { readRoutePrerequisite } from "../routing/postgresRoutePrerequisites.js";
import { PostgresOrderMaterialRequirements } from "./postgresOrderMaterialRequirements.js";
import { PostgresSalesDocumentNumberAllocator } from "./postgresCommercialPrimitives.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { summarizeOrderTotals, type OrderOperationResult, type OrderReadModel, type OrderReservation, type OrderTransaction, type OrderTransactionRunner } from "../../src/modules/sales/orderApplication.js";
import { toSalesDocumentTermsPersistence, toSalesLinePersistenceEnvelope } from "../../src/modules/sales/persistenceContracts.js";
import { removeProductionRequirementsForAbsentLines, synchronizeProductionRequirements } from "./postgresProductionRequirements.js";
import { composePostgresSalesTax } from "./postgresSalesTaxComposition.js";
import { brandedId, currencyCode, money, type OrderId, type OrganizationId, type SalesLineId } from "../../src/modules/shared/commercialValues.js";
import type { AttributionSnapshot, OrderCurrentState, RequestedFulfillment, SalesLineSnapshot, SalesOrderAdjustment } from "../../src/modules/sales/contracts.js";
import type { CommercialCharge } from "../../src/modules/sales/taxComposition.js";
import type { BillingPort, BillingReadPort } from "../../src/modules/billing/contracts.js";
import type { RoutingPort } from "../../src/modules/routing/contracts.js";
import type { QuoteConversionTrace } from "../../src/modules/sales/quoteConversionApplication.js";
import { orderCompletionEligibility } from "../../src/modules/sales/orderLifecycle.js";

type HeaderRow = Readonly<{
  id: string; organization_id: string; business_number: string; display_number: string;
  customer_id: string | null; contact_id: string | null; purchase_order_number: string | null;
  requested_due_date: string | null; currency: string; terms_json: unknown;
  tax_context_reference: string | null; sales_representative_id: string | null;
  commercial_notes: string | null; revision: string; commercial_state: "open" | "completed" | "cancelled";
  completed_at: Date | null; completed_principal_kind: "staff" | "delegated_ai" | "portal" | "service" | null;
  completed_principal_subject: string | null; completed_staff_actor_user_id: string | null;
  archived_at: Date | null; archived_principal_kind: "staff" | "delegated_ai" | "portal" | "service" | null;
  archived_principal_subject: string | null; archived_staff_actor_user_id: string | null;
  requested_fulfillment_method: "pickup" | "shipping" | "local_delivery" | null; requested_destination: unknown; fulfillment_instructions: string | null;
  selling_adjustment_cents: string; selling_adjustment_reason: string | null;
  commercial_charge: unknown; tax_composition: unknown;
}>;
type LineRow = Readonly<{
  id: string; product_id: string; product_type_id: string | null; description: string; quantity: number;
  calculated_line_cents: string; selling_line_cents: string; resolved_configuration: unknown;
  pricing_result: unknown; selling_price_decision: unknown; taxability_snapshot: unknown;
}>;
const asObject = <T>(value: unknown): T => value as T;
const lifecycleActor = (
  principalKind: NonNullable<HeaderRow["completed_principal_kind"]>,
  subjectId: string,
  staffActorUserId: string | null,
): AttributionSnapshot => {
  if (principalKind === "delegated_ai") {
    if (!staffActorUserId) throw new Error("Delegated Order lifecycle attribution is incomplete.");
    return { principalKind, subjectId, staffActorUserId };
  }
  return { principalKind, subjectId };
};

const storedResult = (result: OrderOperationResult): unknown => ({
  ...result, order: { ...result.order, number: { ...result.order.number, core: result.order.number.core.toString() } },
});
const restoredResult = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const candidate = value as { order?: { number?: { core?: unknown } } };
  if (typeof candidate.order?.number?.core !== "string") return value;
  return { ...(value as object), order: { ...(candidate.order as object), number: { ...(candidate.order.number as object), core: BigInt(candidate.order.number.core) } } };
};

/** One client backs Sales, Billing, Routing, M0 attribution and Audit. */
export type OrderPersistenceTestHooks = Readonly<{
  afterSales?: () => Promise<void>;
  afterMaterialRequirements?: () => Promise<void>;
  afterBilling?: () => Promise<void>;
  afterRoute?: () => Promise<void>;
  afterAudit?: () => Promise<void>;
}>;
export class PostgresOrderTransaction implements OrderTransaction {
  readonly customers;
  readonly products;
  readonly pricing = new V2PricingParityAdapter();
  readonly billing: BillingPort & Pick<BillingReadPort, "readDraftForOrder" | "readInvoiceForOrder">;
  readonly routing: RoutingPort;
  readonly materialRequirements: OrderTransaction["materialRequirements"];
  private readonly requests = new PostgresOperationRequestRepository();
  private readonly numbers = new PostgresSalesDocumentNumberAllocator();
  constructor(private readonly client: PoolClient, private readonly hooks?: OrderPersistenceTestHooks) {
    this.customers = new PostgresCustomersCompatibilityReader(client);
    this.products = new PostgresProductsCompatibilityReader(client);
    const billing = new PostgresBillingDraftInvoiceTransaction(client);
    this.billing = {
      createDraftInvoice: async (input) => { const result = await billing.createDraftInvoice(input); await hooks?.afterBilling?.(); return result; },
      readInvoiceForOrder: (organizationId, orderId) => billing.readInvoiceForOrder(organizationId, orderId),
      synchronizeDraftInvoice: async (input) => { const result = await billing.synchronizeDraftInvoice(input); await hooks?.afterBilling?.(); return result; },
      readDraftForOrder: (...args) => billing.readDraftForOrder(...args),
    };
    const routing = new PostgresRoutingRepository(client);
    this.routing = {
      resolveRouteTemplate: (...args) => routing.resolveRouteTemplate(...args),
      readRouteInstance: (...args) => routing.readRouteInstance(...args),
      readRouteForWork: (...args) => routing.readRouteForWork(...args),
      instantiateRoute: async (input) => { const result = await routing.instantiateRoute(input); await hooks?.afterRoute?.(); return result; },
    };
    const requirements = new PostgresOrderMaterialRequirements(client);
    this.materialRequirements = {
      freeze: async (organizationId, orderId, lines) => {
        await requirements.freeze(organizationId, orderId, lines);
        await hooks?.afterMaterialRequirements?.();
      },
      hasFrozen: (organizationId, orderLineId) => requirements.hasFrozen(organizationId, orderLineId),
    };
  }
  async reserve(input: Parameters<OrderTransaction["reserve"]>[0]): Promise<OrderReservation> {
    const result = await this.requests.reserve(this.client, input);
    return { kind: result.kind, request: { id: result.request.id, status: result.request.status, resultJson: restoredResult(result.request.resultJson) } };
  }
  async succeed(organizationId: string, requestId: string, result: OrderOperationResult): Promise<void> {
    await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "order", resourceId: result.order.order.orderId, resultJson: storedResult(result) });
  }
  async attribute(input: Parameters<OrderTransaction["attribute"]>[0]): Promise<void> {
    await this.requests.recordAttribution(this.client, input);
  }
  async audit(input: Parameters<OrderTransaction["audit"]>[0]): Promise<void> {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'order',$5,$6,$7,$8,$9::jsonb)",
      [input.organizationId, input.requestId, input.operation, input.event.eventType, input.event.resourceId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null, JSON.stringify(input.event.changes)],
    );
    await this.hooks?.afterAudit?.();
  }
  allocateNumber(organizationId: string) { return this.numbers.allocate(this.client, organizationId, "order"); }
  async create(input: Parameters<OrderTransaction["create"]>[0], trace?: QuoteConversionTrace): Promise<void> {
    const terms = toSalesDocumentTermsPersistence(input.terms);
    trace?.event("order_insert", "started");
    await this.client.query(
      "INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,contact_id,purchase_order_number,requested_due_date,currency,terms_json,tax_context_reference,sales_representative_id,commercial_notes) VALUES($1,$2,'order',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)",
      [input.orderId,input.organizationId,input.number.core.toString(),input.number.display,input.customerContact.customerId ?? null,input.customerContact.contactId ?? null,input.purchaseOrderNumber ?? null,input.requestedDueDate ?? null,input.lines[0]?.pricingResult.currency ?? "USD",JSON.stringify(terms.termsJson),terms.taxContextReference ?? null,terms.salesRepresentativeId ?? null,terms.commercialNotes ?? null],
    );
    await this.client.query("INSERT INTO v2_sales_order_details(document_id,organization_id,requested_fulfillment_method,requested_destination,fulfillment_instructions,selling_adjustment_cents,selling_adjustment_reason,commercial_charge) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb)", [input.orderId,input.organizationId,input.requestedFulfillment?.method ?? null,input.requestedFulfillment?.destination ? JSON.stringify(input.requestedFulfillment.destination) : null,input.requestedFulfillment?.instructions ?? null,input.sellingAdjustment?.cents ?? 0,input.sellingAdjustment?.reason ?? null,input.commercialCharge ? JSON.stringify(input.commercialCharge) : null]);
    trace?.event("order_insert", "ok");
    trace?.event("order_lines_insert", "started");
    await this.writeLines(input.organizationId, input.orderId, input.lines);
    trace?.event("order_lines_insert", "ok");
    if (input.taxComposition) await this.client.query("UPDATE v2_sales_order_details SET tax_composition=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND document_id=$2", [input.organizationId, input.orderId, JSON.stringify(input.taxComposition)]);
    else await this.writeTaxComposition(input.organizationId, input.orderId, input.customerContact.customerId, input.requestedFulfillment, input.lines, input.sellingAdjustment, input.commercialCharge);
    await this.hooks?.afterSales?.();
  }
  async read(organizationId: OrganizationId, orderId: OrderId, forUpdate = false): Promise<OrderReadModel | null> {
    const header = await this.client.query<HeaderRow>(
      `SELECT d.id,d.organization_id,d.business_number,d.display_number,d.customer_id,d.contact_id,d.purchase_order_number,d.requested_due_date::text,d.currency,d.terms_json,d.tax_context_reference,d.sales_representative_id,d.commercial_notes,d.revision,o.commercial_state,o.completed_at,o.completed_principal_kind,o.completed_principal_subject,o.completed_staff_actor_user_id,o.archived_at,o.archived_principal_kind,o.archived_principal_subject,o.archived_staff_actor_user_id,o.requested_fulfillment_method,o.requested_destination,o.fulfillment_instructions,o.selling_adjustment_cents,o.selling_adjustment_reason,o.commercial_charge,o.tax_composition FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.document_id=d.id AND o.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='order'${forUpdate ? " FOR UPDATE OF d,o" : ""}`,
      [organizationId, orderId],
    );
    const row = header.rows[0]; if (!row) return null;
    const lineRows = await this.client.query<LineRow>("SELECT id,product_id,product_type_id,description,quantity,calculated_line_cents,selling_line_cents,resolved_configuration,pricing_result,selling_price_decision,taxability_snapshot FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position", [organizationId,orderId]);
    const terms = asObject<{termsCode?: string}>(row.terms_json);
    const lines: SalesLineSnapshot[] = lineRows.rows.map((line) => ({
      lineId: brandedId<"SalesLineId">(line.id), productId: brandedId<"ProductId">(line.product_id),
      ...(line.product_type_id ? { productTypeId: brandedId<"ProductTypeId">(line.product_type_id) } : {}),
      description: line.description, quantity: line.quantity,
      resolvedConfiguration: asObject<SalesLineSnapshot["resolvedConfiguration"]>(line.resolved_configuration),
      pricingResult: asObject<SalesLineSnapshot["pricingResult"]>(line.pricing_result),
      sellingPriceDecision: asObject<SalesLineSnapshot["sellingPriceDecision"]>(line.selling_price_decision),
      taxability: asObject<SalesLineSnapshot["taxability"]>(line.taxability_snapshot),
      calculatedLineAmount: money(currencyCode(row.currency), Number(line.calculated_line_cents)),
      sellingLineAmount: money(currencyCode(row.currency), Number(line.selling_line_cents)),
    }));
    const customerContact = row.customer_id
      ? { organizationId, customerId: brandedId<"CustomerId">(row.customer_id), ...(row.contact_id ? { contactId: brandedId<"ContactId">(row.contact_id) } : {}) }
      : { organizationId, contactId: brandedId<"ContactId">(row.contact_id!) };
    const billingInvoice = await this.billing.readInvoiceForOrder(organizationId, orderId);
    const conversion = await this.client.query<{ quote_document_id: string; source_checkpoint_id: string }>(
      "SELECT quote_document_id,source_checkpoint_id FROM v2_sales_quote_conversions WHERE organization_id=$1 AND order_document_id=$2",
      [organizationId, orderId],
    );
    const orderCurrency = currencyCode(row.currency);
    const order: OrderCurrentState = { organizationId, orderId, customerContact, currency: orderCurrency,
      ...(row.purchase_order_number ? {purchaseOrderNumber: row.purchase_order_number} : {}), ...(row.requested_due_date ? {requestedDueDate: row.requested_due_date} : {}),
      terms: {...(terms.termsCode ? {termsCode:terms.termsCode}: {}), ...(row.tax_context_reference ? {taxContextReference:row.tax_context_reference}: {}), ...(row.sales_representative_id ? {salesRepresentativeId:row.sales_representative_id}: {}), ...(row.commercial_notes ? {commercialNotes:row.commercial_notes}: {})},
      lines, commercialState: row.commercial_state,
      ...(row.completed_at && row.completed_principal_kind && row.completed_principal_subject ? { completedAt: row.completed_at.toISOString(), completedBy: lifecycleActor(row.completed_principal_kind, row.completed_principal_subject, row.completed_staff_actor_user_id) } : {}),
      ...(row.archived_at && row.archived_principal_kind && row.archived_principal_subject ? { archivedAt: row.archived_at.toISOString(), archivedBy: lifecycleActor(row.archived_principal_kind, row.archived_principal_subject, row.archived_staff_actor_user_id) } : {}),
      ...(billingInvoice ? {billingInvoiceReference: billingInvoice.invoiceId} : {}),
      ...(row.requested_fulfillment_method ? { requestedFulfillment: { method: row.requested_fulfillment_method, ...(row.requested_destination ? { destination: asObject<any>(row.requested_destination) } : {}), ...(row.fulfillment_instructions ? { instructions: row.fulfillment_instructions } : {}) } } : {}),
      ...(Number(row.selling_adjustment_cents) !== 0 && row.selling_adjustment_reason ? { sellingAdjustment: { cents: Number(row.selling_adjustment_cents), reason: row.selling_adjustment_reason } } : {}),
      ...(row.commercial_charge ? { commercialCharge: asObject<OrderCurrentState["commercialCharge"]>(row.commercial_charge) } : {}),
      ...(row.tax_composition ? { taxComposition: asObject<OrderCurrentState["taxComposition"]>(row.tax_composition) } : {}),
      ...(conversion.rows[0] ? { sourceQuoteId: brandedId<"QuoteId">(conversion.rows[0].quote_document_id), sourceQuoteCheckpointId: brandedId<"QuoteCheckpointId">(conversion.rows[0].source_checkpoint_id) } : {}),
    };
    const routes = (await Promise.all(lines.map(async (line) => {
      const route = await this.routing.readRouteForWork(organizationId, brandedId<"OrderLineId">(line.lineId));
      if (!route) return null;
      const current = route.steps.find((step) => step.routeInstanceStepId === route.currentStepId);
      return current ? { ...route, currentPrerequisite: await readRoutePrerequisite(this.client, organizationId, brandedId<"OrderLineId">(line.lineId), current.kind) } : route;
    }))).filter((route): route is NonNullable<typeof route> => route !== null);
    const completionEligibility = await this.completionEligibility(organizationId, orderId);
    return {
      order,
      number: {kind:"order",core:BigInt(row.business_number),display:row.display_number},
      revision: row.revision,
      totals: summarizeOrderTotals(lines, orderCurrency, Number(row.selling_adjustment_cents)),
      ...(billingInvoice?.lifecycle === "draft" ? { draftInvoice: { invoiceId: billingInvoice.invoiceId, lifecycle: "draft" as const, synchronizationVersion: billingInvoice.synchronizationVersion, lineCount: billingInvoice.lines.length, total: billingInvoice.total } } : {}),
      routes,
      completionEligibility,
    };
  }
  async update(input: Parameters<OrderTransaction["update"]>[0]): Promise<boolean> {
    const terms = toSalesDocumentTermsPersistence(input.terms);
    const result = await this.client.query(
      "UPDATE v2_sales_documents SET customer_id=$4,contact_id=$5,purchase_order_number=$6,requested_due_date=$7,terms_json=$8::jsonb,tax_context_reference=$9,sales_representative_id=$10,commercial_notes=$11,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3 AND document_kind='order'",
      [input.organizationId,input.orderId,input.expectedRevision,input.customerContact.customerId ?? null,input.customerContact.contactId ?? null,input.purchaseOrderNumber ?? null,input.requestedDueDate ?? null,JSON.stringify(terms.termsJson),terms.taxContextReference ?? null,terms.salesRepresentativeId ?? null,terms.commercialNotes ?? null],
    );
    if (result.rowCount !== 1) return false;
    await this.client.query("UPDATE v2_sales_order_details SET requested_fulfillment_method=$3,requested_destination=$4::jsonb,fulfillment_instructions=$5,selling_adjustment_cents=$6,selling_adjustment_reason=$7,commercial_charge=$8::jsonb,updated_at=now() WHERE organization_id=$1 AND document_id=$2", [input.organizationId,input.orderId,input.requestedFulfillment?.method ?? null,input.requestedFulfillment?.destination ? JSON.stringify(input.requestedFulfillment.destination) : null,input.requestedFulfillment?.instructions ?? null,input.sellingAdjustment?.cents ?? 0,input.sellingAdjustment?.reason ?? null,input.commercialCharge ? JSON.stringify(input.commercialCharge) : null]);
    // Vacate the document's position namespace before stable-ID upserts. Rows
    // intentionally removed remain temporarily high until Billing drops its
    // source projection, then removeLinesNotIn deletes them in this transaction.
    await this.client.query("UPDATE v2_sales_document_lines SET position=position+100000,updated_at=now() WHERE organization_id=$1 AND document_id=$2", [input.organizationId, input.orderId]);
    await this.writeLines(input.organizationId, input.orderId, input.lines);
    await this.writeTaxComposition(input.organizationId, input.orderId, input.customerContact.customerId, input.requestedFulfillment, input.lines, input.sellingAdjustment, input.commercialCharge);
    return true;
  }
  async removeLinesNotIn(organizationId: OrganizationId, orderId: OrderId, retainedLineIds: readonly SalesLineId[]): Promise<void> {
    await removeProductionRequirementsForAbsentLines(this.client, organizationId, orderId, retainedLineIds);
    await this.client.query(
      "DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id <> ALL($3::text[])",
      [organizationId, orderId, retainedLineIds],
    );
  }
  async hasRoute(organizationId: OrganizationId, orderId: OrderId, lineId: SalesLineId): Promise<boolean> {
    const route = await this.routing.readRouteForWork(organizationId, brandedId<"OrderLineId">(lineId));
    return route?.work.orderId === orderId;
  }
  async cancellationBlockers(organizationId: OrganizationId, orderId: OrderId): Promise<readonly string[]> {
    const checks: readonly [string, string][] = [
      ["Proofing evidence exists", "SELECT EXISTS(SELECT 1 FROM v2_proof_works WHERE organization_id=$1 AND order_document_id=$2) AS exists"],
      ["Prepress work exists", "SELECT EXISTS(SELECT 1 FROM v2_prepress_units WHERE organization_id=$1 AND order_document_id=$2) AS exists"],
      ["Production work exists", "SELECT EXISTS(SELECT 1 FROM v2_production_works WHERE organization_id=$1 AND order_document_id=$2) AS exists"],
      ["Fulfillment handoff exists", "SELECT EXISTS(SELECT 1 FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND order_document_id=$2) AS exists"],
      ["an Invoice has been issued", "SELECT EXISTS(SELECT 1 FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 AND invoice_state='issued') AS exists"],
      ["a Payment has been recorded", "SELECT EXISTS(SELECT 1 FROM v2_billing_payments p JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id WHERE p.organization_id=$1 AND i.sales_order_document_id=$2) AS exists"],
    ];
    const results = await Promise.all(checks.map(async ([label, sql]) => ({ label, result: await this.client.query<{ exists: boolean }>(sql, [organizationId, orderId]) })));
    return results.filter(({ result }) => result.rows[0]?.exists).map(({ label }) => label);
  }
  async completionEligibility(organizationId: OrganizationId, orderId: OrderId) {
    type Row = { id:string; description:string; quantity:number; workflow_intent:string|null; requires_production:boolean; production_complete:boolean; fulfilled_quantity:string; route_complete:boolean };
    const result = await this.client.query<Row>(`SELECT l.id,l.description,l.quantity,
      CASE WHEN COALESCE(l.resolved_configuration#>>'{productFacts,workflowIntent}',v.tree_json#>>'{meta,general,workflowIntent}') IN ('standard_production','fulfillment_only','service_fee')
        THEN COALESCE(l.resolved_configuration#>>'{productFacts,workflowIntent}',v.tree_json#>>'{meta,general,workflowIntent}') ELSE NULL END workflow_intent,
      COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false) requires_production,
      CASE WHEN COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false)=false THEN true ELSE
        COALESCE((SELECT count(*)>0 AND bool_and(COALESCE((SELECT sum(a.good_quantity) FROM v2_production_works w LEFT JOIN v2_production_attempts a ON a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.completed_at IS NOT NULL WHERE w.organization_id=req.organization_id AND w.order_line_id=req.order_line_id AND w.requirement_key=req.requirement_key),0)>=l.quantity) FROM v2_sales_line_production_requirements req WHERE req.organization_id=l.organization_id AND req.order_line_id=l.id),false) END production_complete,
      COALESCE((SELECT sum(hl.quantity) FROM v2_fulfillment_handoff_lines hl WHERE hl.organization_id=l.organization_id AND hl.order_document_id=l.document_id AND hl.order_line_id=l.id),0)::text fulfilled_quantity,
      CASE WHEN EXISTS(SELECT 1 FROM v2_route_instances ri WHERE ri.organization_id=l.organization_id AND ri.order_line_id=l.id)
        THEN NOT EXISTS(SELECT 1 FROM v2_route_instances ri WHERE ri.organization_id=l.organization_id AND ri.order_line_id=l.id AND ri.route_state<>'completed')
        ELSE NOT COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false) END route_complete
      FROM v2_sales_document_lines l
      LEFT JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.id=l.resolved_configuration->>'pricingConfigurationId'
      WHERE l.organization_id=$1 AND l.document_id=$2 ORDER BY l.position,l.id`, [organizationId, orderId]);
    return orderCompletionEligibility(result.rows.map((row) => ({ orderLineId: row.id, description: row.description,
      workflowIntent: row.workflow_intent === "standard_production" || row.workflow_intent === "fulfillment_only" || row.workflow_intent === "service_fee" ? row.workflow_intent : null,
      requiresProduction: row.requires_production, orderedQuantity: row.quantity, productionComplete: row.production_complete,
      fulfilledQuantity: Number(row.fulfilled_quantity), routeComplete: row.route_complete })));
  }
  async reopen(organizationId: OrganizationId, orderId: OrderId): Promise<boolean> {
    const state = await this.client.query("UPDATE v2_sales_order_details SET commercial_state='open',completed_at=NULL,completed_principal_kind=NULL,completed_principal_subject=NULL,completed_staff_actor_user_id=NULL,archived_at=NULL,archived_principal_kind=NULL,archived_principal_subject=NULL,archived_staff_actor_user_id=NULL,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state='completed'", [organizationId, orderId]);
    return state.rowCount === 1;
  }
  async complete(input: Parameters<OrderTransaction["complete"]>[0]): Promise<boolean> {
    const state = await this.client.query("UPDATE v2_sales_order_details SET commercial_state='completed',completed_at=now(),completed_principal_kind=$3,completed_principal_subject=$4,completed_staff_actor_user_id=$5,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state='open'", [input.organizationId,input.orderId,input.principalKind,input.principalSubject,input.staffActorUserId??null]);
    if (state.rowCount !== 1) return false;
    const header = await this.client.query("UPDATE v2_sales_documents SET updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3 AND document_kind='order'", [input.organizationId,input.orderId,input.expectedRevision]);
    if (header.rowCount !== 1) throw new Error("Order completion state changed without the expected commercial revision.");
    return true;
  }
  async archive(input: Parameters<OrderTransaction["archive"]>[0]): Promise<boolean> {
    const state = await this.client.query("UPDATE v2_sales_order_details SET archived_at=now(),archived_principal_kind=$3,archived_principal_subject=$4,archived_staff_actor_user_id=$5,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state IN ('completed','cancelled') AND archived_at IS NULL", [input.organizationId,input.orderId,input.principalKind,input.principalSubject,input.staffActorUserId??null]);
    if (state.rowCount !== 1) return false;
    const header = await this.client.query("UPDATE v2_sales_documents SET updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3 AND document_kind='order'", [input.organizationId,input.orderId,input.expectedRevision]);
    if (header.rowCount !== 1) throw new Error("Order archive state changed without the expected commercial revision.");
    return true;
  }
  async unarchive(input: Parameters<OrderTransaction["unarchive"]>[0]): Promise<boolean> {
    const state = await this.client.query("UPDATE v2_sales_order_details SET archived_at=NULL,archived_principal_kind=NULL,archived_principal_subject=NULL,archived_staff_actor_user_id=NULL,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state IN ('completed','cancelled') AND archived_at IS NOT NULL", [input.organizationId,input.orderId]);
    if (state.rowCount !== 1) return false;
    const header = await this.client.query("UPDATE v2_sales_documents SET updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3 AND document_kind='order'", [input.organizationId,input.orderId,input.expectedRevision]);
    if (header.rowCount !== 1) throw new Error("Order restore state changed without the expected commercial revision.");
    return true;
  }
  async cancel(input: Parameters<OrderTransaction["cancel"]>[0]): Promise<boolean> {
    const state = await this.client.query(
      "UPDATE v2_sales_order_details SET commercial_state='cancelled',cancelled_at=now(),cancellation_reason=$4,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state='open'",
      [input.organizationId, input.orderId, input.expectedRevision, input.reason],
    );
    if (state.rowCount !== 1) return false;
    const header = await this.client.query(
      "UPDATE v2_sales_documents SET revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3 AND document_kind='order'",
      [input.organizationId, input.orderId, input.expectedRevision],
    );
    if (header.rowCount !== 1) throw new Error("Order cancellation state changed without the expected document revision.");
    return true;
  }
  private async writeTaxComposition(organizationId: OrganizationId, orderId: OrderId, customerId: string | undefined, fulfillment: RequestedFulfillment | undefined, lines: readonly SalesLineSnapshot[], adjustment: SalesOrderAdjustment | undefined, charge: CommercialCharge | undefined): Promise<void> {
    const composition = await composePostgresSalesTax({ client: this.client, organizationId, ...(customerId ? { customerId } : {}), fulfillment, lines, adjustment, charge });
    await this.client.query("UPDATE v2_sales_order_details SET tax_composition=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND document_id=$2", [organizationId, orderId, JSON.stringify(composition)]);
  }
  private async writeLines(organizationId: OrganizationId, orderId: OrderId, lines: readonly SalesLineSnapshot[], replace = false): Promise<void> {
    if (replace) {
      const ids = lines.map((line) => line.lineId);
      await removeProductionRequirementsForAbsentLines(this.client, organizationId, orderId, ids);
      await this.client.query(
        ids.length
          ? "DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id <> ALL($3::text[])"
          : "DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2",
        ids.length ? [organizationId, orderId, ids] : [organizationId, orderId],
      );
    }
    for (const [position,line] of lines.entries()) {
      const e = toSalesLinePersistenceEnvelope(line);
      await this.client.query(
        "INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,product_type_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision,taxability_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb) ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,product_id=EXCLUDED.product_id,product_type_id=EXCLUDED.product_type_id,description=EXCLUDED.description,quantity=EXCLUDED.quantity,currency=EXCLUDED.currency,calculated_unit_cents=EXCLUDED.calculated_unit_cents,calculated_line_cents=EXCLUDED.calculated_line_cents,selling_unit_cents=EXCLUDED.selling_unit_cents,selling_line_cents=EXCLUDED.selling_line_cents,pricing_result_id=EXCLUDED.pricing_result_id,pricing_evidence_fingerprint=EXCLUDED.pricing_evidence_fingerprint,resolved_configuration=EXCLUDED.resolved_configuration,pricing_result=EXCLUDED.pricing_result,selling_price_decision=EXCLUDED.selling_price_decision,taxability_snapshot=EXCLUDED.taxability_snapshot,updated_at=now() WHERE v2_sales_document_lines.organization_id=EXCLUDED.organization_id AND v2_sales_document_lines.document_id=EXCLUDED.document_id",
        [e.lineId,organizationId,orderId,position,e.productId,e.productTypeId ?? null,e.description,e.quantity,e.currency,e.calculatedUnitAmount.cents,e.calculatedLineAmount.cents,e.sellingUnitAmount.cents,e.sellingLineAmount.cents,e.pricingResult.id,e.pricingResult.evidenceFingerprint,e.canonicalResolvedConfiguration,e.canonicalPricingResult,e.canonicalSellingPriceDecision,JSON.stringify(e.taxability)],
      );
      await synchronizeProductionRequirements(this.client, organizationId, orderId, line);
      // A ProductionWork is durable attempt history, but its target remains a
      // projection of the current commercial line.  A later quantity revision
      // must expose the remaining output to Production rather than leaving a
      // previously satisfied one-unit work falsely complete.
      await this.client.query(
        "UPDATE v2_production_works SET ordered_quantity=$4 WHERE organization_id=$1 AND order_document_id=$2 AND order_line_id=$3 AND ordered_quantity IS DISTINCT FROM $4",
        [organizationId, orderId, line.lineId, line.quantity],
      );
    }
  }
}

export class PostgresOrderTransactionRunner implements OrderTransactionRunner {
  constructor(private readonly pool: Pool, private readonly hooks?: OrderPersistenceTestHooks) {}
  async transaction<T>(action: (transaction: OrderTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(new PostgresOrderTransaction(client, this.hooks)); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
