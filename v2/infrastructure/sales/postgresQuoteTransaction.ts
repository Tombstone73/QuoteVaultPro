import type { Pool, PoolClient } from "pg";
import { PostgresCustomersCompatibilityReader } from "../compatibility/postgresCustomersRead.js";
import { PostgresProductsCompatibilityReader } from "../compatibility/postgresProductsRead.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { PostgresSalesDocumentNumberAllocator } from "./postgresCommercialPrimitives.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import type {
  QuoteOperationRequest,
  QuoteOperationResult,
  QuoteReservation,
  QuoteTransaction,
  QuoteTransactionRunner,
  QuoteConversionPersistencePort,
  QuoteReadModel,
} from "../../src/modules/sales/quoteApplication.js";
import {
  toQuoteCheckpointPersistenceEnvelope,
  toSalesDocumentTermsPersistence,
  toSalesLinePersistenceEnvelope,
} from "../../src/modules/sales/persistenceContracts.js";
import { removeProductionRequirementsForAbsentLines, synchronizeProductionRequirements } from "./postgresProductionRequirements.js";
import { composePostgresSalesTax } from "./postgresSalesTaxComposition.js";
import {
  brandedId,
  currencyCode,
  money,
  type OrganizationId,
  type QuoteId,
  type OrderId,
  type SalesLineId,
} from "../../src/modules/shared/commercialValues.js";
import type {
  QuoteCheckpoint,
  QuoteCurrentState,
  RequestedFulfillment,
  SalesOrderAdjustment,
  SalesLineSnapshot,
} from "../../src/modules/sales/contracts.js";
import type { CommercialCharge } from "../../src/modules/sales/taxComposition.js";

type HeaderRow = {
  id: string;
  organization_id: string;
  business_number: string;
  display_number: string;
  customer_id: string | null;
  contact_id: string | null;
  purchase_order_number: string | null;
  requested_due_date: string | null;
  currency: string;
  terms_json: unknown;
  tax_context_reference: string | null;
  sales_representative_id: string | null;
  commercial_notes: string | null;
  revision: string;
  expires_at: Date | null;
  delivery_state: "not_sent" | "sent";
  acceptance_state: "not_accepted" | "accepted";
  lifecycle_state: "open" | "declined" | "voided";
  requested_fulfillment_method: "pickup" | "shipping" | "local_delivery" | null;
  requested_destination: unknown;
  fulfillment_instructions: string | null;
  selling_adjustment_cents: string;
  selling_adjustment_reason: string | null;
  commercial_charge: unknown;
  tax_composition: unknown;
};
type LineRow = {
  id: string;
  product_id: string;
  product_type_id: string | null;
  description: string;
  quantity: number;
  calculated_line_cents: string;
  selling_line_cents: string;
  resolved_configuration: unknown;
  pricing_result: unknown;
  selling_price_decision: unknown;
  taxability_snapshot: unknown;
};
type CheckpointRow = {
  id: string;
  checkpoint_kind: QuoteCheckpoint["kind"];
  occurred_at: Date;
};
type CheckpointPayloadRow = CheckpointRow & { payload: unknown };

/** Operation-request results are JSONB. Preserve the bigint document-number core
 * explicitly so an idempotent replay rehydrates the same public value type. */
const operationResultForStorage = (result: QuoteOperationResult): unknown => ({
  ...result,
  quote: {
    ...result.quote,
    number: {
      ...result.quote.number,
      core: result.quote.number.core.toString(),
    },
  },
});
const operationResultFromStorage = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const result = value as QuoteOperationResult & {
    quote?: QuoteOperationResult["quote"] & { number?: { core?: unknown } };
  };
  if (typeof result.quote?.number?.core !== "string") return value;
  return {
    ...result,
    quote: {
      ...result.quote,
      number: {
        ...result.quote.number,
        core: BigInt(result.quote.number.core),
      },
    },
  };
};

const asObject = <T>(value: unknown): T => value as T;
const dateText = (value: Date | null): string | undefined =>
  value ? value.toISOString() : undefined;

export type QuotePersistenceTestHooks = Readonly<{
  afterDocument?: () => Promise<void>;
  afterLines?: () => Promise<void>;
  afterAudit?: () => Promise<void>;
  afterConvertedCheckpoint?: () => Promise<void>;
  afterConversionLineage?: () => Promise<void>;
}>;
export class PostgresQuoteTransaction implements QuoteConversionPersistencePort {
  readonly customers;
  readonly products;
  readonly pricing = new V2PricingParityAdapter();
  private readonly requests = new PostgresOperationRequestRepository();
  private readonly numbers = new PostgresSalesDocumentNumberAllocator();
  constructor(
    private readonly client: PoolClient,
    private readonly hooks?: QuotePersistenceTestHooks,
  ) {
    this.customers = new PostgresCustomersCompatibilityReader(client);
    this.products = new PostgresProductsCompatibilityReader(client);
  }
  async reserve(
    input: Parameters<QuoteTransaction["reserve"]>[0],
  ): Promise<QuoteReservation> {
    const result = await this.requests.reserve(this.client, input);
    return {
      kind: result.kind,
      request: {
        id: result.request.id,
        status: result.request.status,
        resultJson: operationResultFromStorage(result.request.resultJson),
      },
    };
  }
  async succeed(
    organizationId: string,
    requestId: string,
    result: QuoteOperationResult,
  ): Promise<void> {
    await this.requests.succeed(this.client, organizationId, requestId, {
      resourceType: "quote",
      resourceId: result.quote.quote.quoteId,
      resultJson: operationResultForStorage(result),
    });
  }
  async succeedConversion(
    organizationId: string,
    requestId: string,
    quoteId: QuoteId,
    result: unknown,
  ): Promise<void> {
    await this.requests.succeed(this.client, organizationId, requestId, {
      resourceType: "quote",
      resourceId: quoteId,
      resultJson: result,
    });
  }
  async attribute(
    input: Parameters<QuoteTransaction["attribute"]>[0],
  ): Promise<void> {
    await this.requests.recordAttribution(this.client, {
      organizationId: input.organizationId,
      operationRequestId: input.requestId,
      operation: input.operation,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      principalKind: input.principalKind,
      principalSubject: input.principalSubject,
      staffActorUserId: input.staffActorUserId,
    });
  }
  async audit(input: Parameters<QuoteTransaction["audit"]>[0]): Promise<void> {
    await this.client.query(
      `INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'quote',$5,$6,$7,$8,$9::jsonb)`,
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.event.eventType,
        input.event.resourceId,
        input.principalKind,
        input.principalSubject,
        input.staffActorUserId ?? null,
        JSON.stringify(input.event.changes),
      ],
    );
    await this.hooks?.afterAudit?.();
  }
  allocateNumber(organizationId: string) {
    return this.numbers.allocate(this.client, organizationId, "quote");
  }
  async create(
    input: Parameters<QuoteTransaction["create"]>[0],
  ): Promise<void> {
    const terms = toSalesDocumentTermsPersistence(input.terms);
    await this.client.query(
      `INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,contact_id,purchase_order_number,requested_due_date,currency,terms_json,tax_context_reference,sales_representative_id,commercial_notes) VALUES($1,$2,'quote',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
      [
        input.quoteId,
        input.organizationId,
        input.number.core.toString(),
        input.number.display,
        input.customerContact.customerId ?? null,
        input.customerContact.contactId ?? null,
        input.purchaseOrderNumber ?? null,
        input.requestedDueDate ?? null,
        input.lines[0]?.pricingResult.currency ?? "USD",
        JSON.stringify(terms.termsJson),
        terms.taxContextReference ?? null,
        terms.salesRepresentativeId ?? null,
        terms.commercialNotes ?? null,
      ],
    );
    await this.hooks?.afterDocument?.();
    await this.client.query(
      "INSERT INTO v2_sales_quote_details(document_id,organization_id,expires_at,requested_fulfillment_method,requested_destination,fulfillment_instructions,selling_adjustment_cents,selling_adjustment_reason,commercial_charge) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)",
      [input.quoteId, input.organizationId, input.expiresAt ?? null, input.requestedFulfillment?.method ?? null, input.requestedFulfillment?.destination ? JSON.stringify(input.requestedFulfillment.destination) : null, input.requestedFulfillment?.instructions ?? null, input.sellingAdjustment?.cents ?? 0, input.sellingAdjustment?.reason ?? null, input.commercialCharge ? JSON.stringify(input.commercialCharge) : null],
    );
    await this.writeLines(input.organizationId, input.quoteId, input.lines, []);
    await this.writeTaxComposition(input.organizationId, input.quoteId, input.customerContact.customerId, input.requestedFulfillment, input.lines, input.sellingAdjustment, input.commercialCharge);
    await this.hooks?.afterLines?.();
  }
  async read(
    organizationId: OrganizationId,
    quoteId: QuoteId,
    forUpdate = false,
  ): Promise<QuoteReadModel | null> {
    const header = await this.client.query<HeaderRow>(
      `SELECT d.id,d.organization_id,d.business_number,d.display_number,d.customer_id,d.contact_id,d.purchase_order_number,d.requested_due_date::text AS requested_due_date,d.currency,d.terms_json,d.tax_context_reference,d.sales_representative_id,d.commercial_notes,d.revision,q.expires_at,q.delivery_state,q.acceptance_state,q.lifecycle_state,q.requested_fulfillment_method,q.requested_destination,q.fulfillment_instructions,q.selling_adjustment_cents,q.selling_adjustment_reason,q.commercial_charge,q.tax_composition FROM v2_sales_documents d JOIN v2_sales_quote_details q ON q.document_id=d.id AND q.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='quote'${forUpdate ? " FOR UPDATE OF d,q" : ""}`,
      [organizationId, quoteId],
    );
    const row = header.rows[0];
    if (!row) return null;
    const lines = await this.client.query<LineRow>(
      "SELECT id,product_id,product_type_id,description,quantity,calculated_line_cents,selling_line_cents,resolved_configuration,pricing_result,selling_price_decision,taxability_snapshot FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position",
      [organizationId, quoteId],
    );
    const checkpoints = await this.client.query<CheckpointRow>(
      "SELECT id,checkpoint_kind,occurred_at FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2 ORDER BY checkpoint_sequence",
      [organizationId, quoteId],
    );
    const conversion = await this.client.query<{ order_document_id: string }>(
      "SELECT order_document_id FROM v2_sales_quote_conversions WHERE organization_id=$1 AND quote_document_id=$2",
      [organizationId, quoteId],
    );
    const terms = asObject<{ termsCode?: string }>(row.terms_json);
    const salesLines: SalesLineSnapshot[] = lines.rows.map((line) => {
      const pricing = asObject<SalesLineSnapshot["pricingResult"]>(
        line.pricing_result,
      );
      const decision = asObject<SalesLineSnapshot["sellingPriceDecision"]>(
        line.selling_price_decision,
      );
      return {
        lineId: brandedId<"SalesLineId">(line.id),
        productId: brandedId<"ProductId">(line.product_id),
        ...(line.product_type_id
          ? { productTypeId: brandedId<"ProductTypeId">(line.product_type_id) }
          : {}),
        description: line.description,
        quantity: line.quantity,
        resolvedConfiguration: asObject<
          SalesLineSnapshot["resolvedConfiguration"]
        >(line.resolved_configuration),
        pricingResult: pricing,
        sellingPriceDecision: decision,
        taxability: asObject<SalesLineSnapshot["taxability"]>(line.taxability_snapshot),
        calculatedLineAmount: money(
          currencyCode(row.currency),
          Number(line.calculated_line_cents),
        ),
        sellingLineAmount: money(
          currencyCode(row.currency),
          Number(line.selling_line_cents),
        ),
      };
    });
    const reference = row.customer_id
      ? {
          organizationId,
          customerId: brandedId<"CustomerId">(row.customer_id),
          ...(row.contact_id
            ? { contactId: brandedId<"ContactId">(row.contact_id) }
            : {}),
        }
      : { organizationId, contactId: brandedId<"ContactId">(row.contact_id!) };
    const quote: QuoteCurrentState = {
      organizationId,
      quoteId,
      customerContact: reference,
      currency: currencyCode(row.currency),
      ...(row.purchase_order_number
        ? { purchaseOrderNumber: row.purchase_order_number }
        : {}),
      ...(row.requested_due_date
        ? { requestedDueDate: row.requested_due_date }
        : {}),
      terms: {
        ...(terms.termsCode ? { termsCode: terms.termsCode } : {}),
        ...(row.tax_context_reference
          ? { taxContextReference: row.tax_context_reference }
          : {}),
        ...(row.sales_representative_id
          ? { salesRepresentativeId: row.sales_representative_id }
          : {}),
        ...(row.commercial_notes
          ? { commercialNotes: row.commercial_notes }
          : {}),
      },
      lines: salesLines,
      ...(dateText(row.expires_at)
        ? { expiresAt: dateText(row.expires_at) }
        : {}),
      deliveryState: row.delivery_state,
      acceptanceState: row.acceptance_state,
      lifecycleState: row.lifecycle_state,
      ...(row.requested_fulfillment_method ? { requestedFulfillment: { method: row.requested_fulfillment_method, ...(row.requested_destination ? { destination: asObject<NonNullable<QuoteCurrentState["requestedFulfillment"]>["destination"]>(row.requested_destination) } : {}), ...(row.fulfillment_instructions ? { instructions: row.fulfillment_instructions } : {}) } as RequestedFulfillment } : {}),
      ...(Number(row.selling_adjustment_cents) !== 0 && row.selling_adjustment_reason ? { sellingAdjustment: { cents: Number(row.selling_adjustment_cents), reason: row.selling_adjustment_reason } } : {}),
      ...(row.commercial_charge ? { commercialCharge: asObject<QuoteCurrentState["commercialCharge"]>(row.commercial_charge) } : {}),
      ...(row.tax_composition ? { taxComposition: asObject<QuoteCurrentState["taxComposition"]>(row.tax_composition) } : {}),
      ...(conversion.rows[0]
        ? { convertedOrderId: brandedId<"OrderId">(conversion.rows[0].order_document_id) }
        : {}),
    };
    return {
      quote,
      number: {
        kind: "quote",
        core: BigInt(row.business_number),
        display: row.display_number,
      },
      revision: row.revision,
      checkpoints: checkpoints.rows.map((c) => ({
        checkpointId: brandedId<"QuoteCheckpointId">(c.id),
        kind: c.checkpoint_kind,
        occurredAt: c.occurred_at.toISOString(),
      })),
    };
  }
  async update(
    input: Parameters<QuoteTransaction["update"]>[0],
  ): Promise<boolean> {
    const terms = toSalesDocumentTermsPersistence(input.terms);
    const header = await this.client.query(
      "UPDATE v2_sales_documents SET customer_id=$4,contact_id=$5,purchase_order_number=$6,requested_due_date=$7,terms_json=$8::jsonb,tax_context_reference=$9,sales_representative_id=$10,commercial_notes=$11,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3",
      [
        input.organizationId,
        input.quoteId,
        input.expectedRevision,
        input.customerContact.customerId ?? null,
        input.customerContact.contactId ?? null,
        input.purchaseOrderNumber ?? null,
        input.requestedDueDate ?? null,
        JSON.stringify(terms.termsJson),
        terms.taxContextReference ?? null,
        terms.salesRepresentativeId ?? null,
        terms.commercialNotes ?? null,
      ],
    );
    if (header.rowCount !== 1) return false;
    const old = (
      await this.client.query<{ id: string }>(
        "SELECT id FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2",
        [input.organizationId, input.quoteId],
      )
    ).rows.map((r) => r.id);
    await this.writeLines(
      input.organizationId,
      input.quoteId,
      input.lines,
      old,
    );
    await this.client.query("UPDATE v2_sales_quote_details SET requested_fulfillment_method=$3,requested_destination=$4::jsonb,fulfillment_instructions=$5,selling_adjustment_cents=$6,selling_adjustment_reason=$7,commercial_charge=$8::jsonb,updated_at=now() WHERE organization_id=$1 AND document_id=$2", [input.organizationId,input.quoteId,input.requestedFulfillment?.method ?? null,input.requestedFulfillment?.destination ? JSON.stringify(input.requestedFulfillment.destination) : null,input.requestedFulfillment?.instructions ?? null,input.sellingAdjustment?.cents ?? 0,input.sellingAdjustment?.reason ?? null,input.commercialCharge ? JSON.stringify(input.commercialCharge) : null]);
    await this.writeTaxComposition(input.organizationId, input.quoteId, input.customerContact.customerId, input.requestedFulfillment, input.lines, input.sellingAdjustment, input.commercialCharge);
    return true;
  }
  async transition(
    input: Parameters<QuoteTransaction["transition"]>[0],
  ): Promise<boolean> {
    // State is transitioned before the revision bump so an unsuccessful lifecycle
    // operation cannot commit a revision increment.
    const state = await this.client.query(
      input.kind === "send"
        ? "UPDATE v2_sales_quote_details SET delivery_state='sent',updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND lifecycle_state='open' AND delivery_state='not_sent'"
        : input.kind === "accept"
          ? "UPDATE v2_sales_quote_details SET acceptance_state='accepted',updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND lifecycle_state='open' AND delivery_state='sent' AND acceptance_state='not_accepted'"
          : input.kind === "decline"
            ? "UPDATE v2_sales_quote_details SET lifecycle_state='declined',updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND lifecycle_state='open' AND delivery_state='sent'"
            : "UPDATE v2_sales_quote_details SET lifecycle_state='voided',updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND lifecycle_state='open'",
      [input.organizationId, input.quoteId],
    );
    if (state.rowCount !== 1) return false;
    const header = await this.client.query(
      "UPDATE v2_sales_documents SET revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3",
      [input.organizationId, input.quoteId, input.expectedRevision],
    );
    if (header.rowCount !== 1)
      throw new Error(
        "Quote lifecycle state changed without the expected document revision.",
      );
    const count = await this.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2",
      [input.organizationId, input.quoteId],
    );
    const cp = toQuoteCheckpointPersistenceEnvelope(input.checkpoint);
    await this.client.query(
      `INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,schema_version,occurred_at,principal_kind,principal_subject,staff_actor_user_id,operation_request_id,source_checkpoint_id,evidence_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        cp.checkpointId,
        input.organizationId,
        input.quoteId,
        count.rows[0]!.count + 1,
        cp.checkpointKind,
        cp.schemaVersion,
        cp.occurredAt,
        input.checkpoint.principal.principalKind,
        input.checkpoint.principal.subjectId,
        "staffActorUserId" in input.checkpoint.principal
          ? input.checkpoint.principal.staffActorUserId
          : null,
        input.operationRequestId,
        cp.sourceCheckpointId ?? null,
        cp.evidenceFingerprint,
        cp.canonicalPayload,
      ],
    );
    return true;
  }
  async readCheckpoint(
    organizationId: OrganizationId,
    quoteId: QuoteId,
    checkpointId: import("../../src/modules/shared/commercialValues.js").QuoteCheckpointId,
  ): Promise<QuoteCheckpoint | null> {
    const result = await this.client.query<CheckpointPayloadRow>(
      "SELECT id,checkpoint_kind,occurred_at,payload FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2 AND id=$3",
      [organizationId, quoteId, checkpointId],
    );
    return result.rows[0] ? asObject<QuoteCheckpoint>(result.rows[0].payload) : null;
  }
  async appendConvertedCheckpoint(
    input: Parameters<QuoteConversionPersistencePort["appendConvertedCheckpoint"]>[0],
  ): Promise<void> {
    const count = await this.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2",
      [input.organizationId, input.quoteId],
    );
    const cp = toQuoteCheckpointPersistenceEnvelope(input.checkpoint);
    await this.client.query(
      `INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,schema_version,occurred_at,principal_kind,principal_subject,staff_actor_user_id,operation_request_id,source_checkpoint_id,evidence_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [cp.checkpointId,input.organizationId,input.quoteId,count.rows[0]!.count + 1,cp.checkpointKind,cp.schemaVersion,cp.occurredAt,input.checkpoint.principal.principalKind,input.checkpoint.principal.subjectId,"staffActorUserId" in input.checkpoint.principal ? input.checkpoint.principal.staffActorUserId : null,input.operationRequestId,cp.sourceCheckpointId ?? null,cp.evidenceFingerprint,cp.canonicalPayload],
    );
    await this.hooks?.afterConvertedCheckpoint?.();
  }
  async createConversionLineage(
    input: Parameters<QuoteConversionPersistencePort["createConversionLineage"]>[0],
  ): Promise<void> {
    await this.client.query(
      "INSERT INTO v2_sales_quote_conversions(organization_id,quote_document_id,source_checkpoint_id,order_document_id,conversion_checkpoint_id,operation_request_id) VALUES($1,$2,$3,$4,$5,$6)",
      [input.organizationId,input.quoteId,input.sourceCheckpointId,input.orderId,input.convertedCheckpointId,input.operationRequestId],
    );
    await this.hooks?.afterConversionLineage?.();
  }
  private async writeTaxComposition(
    organizationId: OrganizationId,
    quoteId: QuoteId,
    customerId: string | undefined,
    fulfillment: RequestedFulfillment | undefined,
    lines: readonly SalesLineSnapshot[],
    adjustment: SalesOrderAdjustment | undefined,
    charge: CommercialCharge | undefined,
  ): Promise<void> {
    const composition = await composePostgresSalesTax({ client: this.client, organizationId, ...(customerId ? { customerId } : {}), fulfillment, lines, adjustment, charge });
    await this.client.query("UPDATE v2_sales_quote_details SET tax_composition=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND document_id=$2", [organizationId, quoteId, JSON.stringify(composition)]);
  }
  private async writeLines(
    organizationId: OrganizationId,
    quoteId: QuoteId,
    lines: readonly SalesLineSnapshot[],
    oldIds: readonly string[],
  ): Promise<void> {
    const ids = lines.map((l) => l.lineId);
    if (ids.length) {
      await removeProductionRequirementsForAbsentLines(this.client, organizationId, quoteId, ids);
      await this.client.query(
        "DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id <> ALL($3::text[])",
        [organizationId, quoteId, ids],
      );
    } else if (oldIds.length) {
      await removeProductionRequirementsForAbsentLines(this.client, organizationId, quoteId, []);
      await this.client.query(
        "DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2",
        [organizationId, quoteId],
      );
    }
    for (const [position, line] of lines.entries()) {
      const e = toSalesLinePersistenceEnvelope(line);
      await this.client.query(
        `INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,product_type_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision,taxability_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb) ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,product_id=EXCLUDED.product_id,product_type_id=EXCLUDED.product_type_id,description=EXCLUDED.description,quantity=EXCLUDED.quantity,currency=EXCLUDED.currency,calculated_unit_cents=EXCLUDED.calculated_unit_cents,calculated_line_cents=EXCLUDED.calculated_line_cents,selling_unit_cents=EXCLUDED.selling_unit_cents,selling_line_cents=EXCLUDED.selling_line_cents,pricing_result_id=EXCLUDED.pricing_result_id,pricing_evidence_fingerprint=EXCLUDED.pricing_evidence_fingerprint,resolved_configuration=EXCLUDED.resolved_configuration,pricing_result=EXCLUDED.pricing_result,selling_price_decision=EXCLUDED.selling_price_decision,taxability_snapshot=EXCLUDED.taxability_snapshot,updated_at=now() WHERE v2_sales_document_lines.organization_id=EXCLUDED.organization_id AND v2_sales_document_lines.document_id=EXCLUDED.document_id`,
        [
          e.lineId,
          organizationId,
          quoteId,
          position,
          e.productId,
          e.productTypeId ?? null,
          e.description,
          e.quantity,
          e.currency,
          e.calculatedUnitAmount.cents,
          e.calculatedLineAmount.cents,
          e.sellingUnitAmount.cents,
          e.sellingLineAmount.cents,
          e.pricingResult.id,
          e.pricingResult.evidenceFingerprint,
          e.canonicalResolvedConfiguration,
          e.canonicalPricingResult,
          e.canonicalSellingPriceDecision,
          JSON.stringify(e.taxability),
        ],
      );
      await synchronizeProductionRequirements(this.client, organizationId, quoteId, line);
    }
  }
}
export class PostgresQuoteTransactionRunner implements QuoteTransactionRunner {
  constructor(
    private readonly pool: Pool,
    private readonly hooks?: QuotePersistenceTestHooks,
  ) {}
  async transaction<T>(
    action: (tx: QuoteTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(
        new PostgresQuoteTransaction(client, this.hooks),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
