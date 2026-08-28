import { randomUUID } from "node:crypto";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type {
  BillingPort,
  BillingReadPort,
  DraftInvoiceReadModel,
  InvoiceListItem,
  InvoiceListRequest,
  IssuedInvoiceCheckpoint,
  CreateDraftInvoiceInput,
  DraftInvoiceSynchronizationInput,
  DraftInvoiceSynchronizationResult,
} from "../../src/modules/billing/contracts.js";
import {
  brandedId,
  currencyCode,
  money,
  type InvoiceId,
  type OrganizationId,
  type OrderId,
} from "../../src/modules/shared/commercialValues.js";
import type { TransactionalClient } from "../persistence/types.js";
import type { SalesTaxComposition } from "../../src/modules/sales/taxComposition.js";

type InvoiceState = "draft" | "issued" | "void";

type InvoiceRow = Readonly<{
  id: string;
  invoice_state: InvoiceState;
  source_sales_state_token: string;
  synchronization_version: string;
}>;

const zeroTaxCalculatorVersion = "v2-billing-zero-tax-compatibility-v1";

const sumCents = (lines: DraftInvoiceSynchronizationInput["salesLines"], adjustment = 0): number => {
  let total = 0;
  for (const line of lines) {
    total += line.sellingLineAmount.cents;
    if (!Number.isSafeInteger(total)) {
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Draft Invoice total is outside the safe money range.",
      );
    }
  }
  if (!Number.isSafeInteger(adjustment) || !Number.isSafeInteger(total + adjustment) || total + adjustment < 0) throw new V2ApplicationError("VALIDATION_ERROR", "Draft Invoice adjustment is outside the safe money range.");
  return total + adjustment;
};

const assertLineCurrencies = (input: DraftInvoiceSynchronizationInput): void => {
  if (!input.sourceSalesStateToken.trim()) {
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "Draft Invoice synchronization requires a Sales state token.",
    );
  }
  for (const line of input.salesLines) {
    if (line.sellingUnitAmount.currency !== input.currency
      || line.sellingLineAmount.currency !== input.currency) {
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Draft Invoice lines must use the Order currency.",
      );
    }
    if (!line.salesPricingEvidenceFingerprint.trim()) {
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Draft Invoice lines require Sales pricing evidence.",
      );
    }
  }
};

const taxEnvelope = (input: DraftInvoiceSynchronizationInput): Readonly<{
  calculatorVersion: string;
  evidence: Readonly<Record<string, string>>;
}> => {
  const calculatorVersion = zeroTaxCalculatorVersion;
  return {
    calculatorVersion,
    evidence: {
      kind: "zero_tax_compatibility",
      calculatorVersion,
      ...(input.taxInput.taxContextReference
        ? { taxContextReference: input.taxInput.taxContextReference }
        : {}),
    },
  };
};

/** Optional JSONB fields must remain SQL NULL when absent. PostgreSQL JSON
 * `null` is a value, and would violate the schema's object-or-null contract. */
const jsonObjectOrNull = (value: unknown): string | null => value == null ? null : JSON.stringify(value);

/**
 * Billing-owned Draft Invoice persistence participant. It deliberately takes
 * an already-open transaction client and never starts, commits, or rolls back
 * a transaction; M1.9's Order coordinator owns that boundary.
 */
export class PostgresBillingDraftInvoiceTransaction implements BillingPort, BillingReadPort {
  constructor(private readonly client: TransactionalClient) {}

  async createDraftInvoice(
    input: CreateDraftInvoiceInput,
  ): Promise<DraftInvoiceSynchronizationResult> {
    assertLineCurrencies(input);
    const existing = await this.readInvoicesForOrder(input, true);
    if (existing.length > 0) return this.applyExisting(input, existing);

    const invoiceId = brandedId<"InvoiceId">(randomUUID());
    const totals = await this.totals(input);
    const inserted = await this.client.query<{ id: string; synchronization_version: string }>(
      `INSERT INTO v2_billing_invoices(
        id,organization_id,sales_order_document_id,invoice_state,customer_id,contact_id,
        purchase_order_number,currency,terms_code,source_sales_state_token,
        subtotal_cents,tax_total_cents,total_cents,tax_context_reference,
        tax_calculator_version,tax_evidence,sales_adjustment_cents,sales_adjustment_reason,sales_commercial_charge,sales_tax_composition
      ) VALUES(
        $1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18::jsonb,$19::jsonb
      )
      ON CONFLICT (organization_id,sales_order_document_id) WHERE invoice_state='draft'
      DO NOTHING
      RETURNING id,synchronization_version`,
      [
        invoiceId,
        input.organizationId,
        input.orderId,
        input.customerContact.customerId ?? null,
        input.customerContact.contactId ?? null,
        input.purchaseOrderNumber ?? null,
        input.currency,
        input.termsCode ?? null,
        input.sourceSalesStateToken,
        totals.subtotalCents, totals.taxCents, totals.totalCents,
        input.taxInput.taxContextReference ?? null,
        totals.taxCalculatorVersion,
        JSON.stringify(totals.taxEvidence), input.salesAdjustment?.cents ?? 0, input.salesAdjustment?.reason ?? null, jsonObjectOrNull(totals.charge), jsonObjectOrNull(totals.composition),
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      // The partial unique index is the concurrent exactly-one Draft guard.
      // After its conflict-safe wait, re-read only within the caller's tenant.
      return this.applyExisting(input, await this.readInvoicesForOrder(input, true));
    }
    await this.writeLines(input, brandedId<"InvoiceId">(row.id));
    return {
      invoiceId: brandedId<"InvoiceId">(row.id),
      status: "created",
      synchronizationVersion: row.synchronization_version,
    };
  }

  async synchronizeDraftInvoice(
    input: DraftInvoiceSynchronizationInput,
  ): Promise<DraftInvoiceSynchronizationResult> {
    assertLineCurrencies(input);
    return this.applyExisting(input, await this.readInvoicesForOrder(input, true));
  }

  async readInvoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<DraftInvoiceReadModel | null> {
    return this.readModel("i.id=$2", organizationId, invoiceId);
  }

  async readDraftForOrder(organizationId: OrganizationId, orderId: OrderId): Promise<DraftInvoiceReadModel | null> {
    return this.readModel("i.sales_order_document_id=$2 AND i.invoice_state='draft'", organizationId, orderId);
  }
  async readInvoiceForOrder(organizationId: OrganizationId, orderId: OrderId): Promise<DraftInvoiceReadModel | null> {
    return this.readModel("i.sales_order_document_id=$2 ORDER BY CASE i.invoice_state WHEN 'draft' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END,i.updated_at DESC LIMIT 1", organizationId, orderId);
  }

  async listInvoices(organizationId: OrganizationId, request: InvoiceListRequest): Promise<readonly InvoiceListItem[]> {
    const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(request.limit!, 50)) : 25;
    const rows = await this.client.query<{ id: string; sales_order_document_id: string; display_number: string; invoice_state: InvoiceState; currency: string; customer_id: string | null; total_cents: string; issued_at: Date | null; updated_at: Date; customer_display_name: string | null }>(
      `SELECT i.id,i.sales_order_document_id,d.display_number,i.invoice_state,i.currency,i.customer_id,i.total_cents,i.issued_at,i.updated_at,
        COALESCE(c.display_name,c.company_name) AS customer_display_name
       FROM v2_billing_invoices i
       JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
       LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
       WHERE i.organization_id=$1
         AND ($2::text IS NULL OR d.display_number ILIKE '%' || $2 || '%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR i.invoice_state=$3)
       ORDER BY i.updated_at DESC,i.id DESC LIMIT $4`,
      [organizationId, request.query?.trim() || null, request.lifecycle ?? null, limit],
    );
    return rows.rows.map((row) => {
      const currency = currencyCode(row.currency);
      return {
        invoiceId: brandedId<"InvoiceId">(row.id), sourceOrderId: brandedId<"OrderId">(row.sales_order_document_id), sourceOrderNumber: row.display_number, ...(row.customer_id ? { customerId: brandedId<"CustomerId">(row.customer_id) } : {}),
        lifecycle: row.invoice_state, currency, total: money(currency, Number(row.total_cents)), updatedAt: row.updated_at.toISOString(),
        ...(row.customer_display_name ? { customerPresentation: { customerDisplayName: row.customer_display_name } } : {}),
        ...(row.issued_at ? { issuedAt: row.issued_at.toISOString() } : {}),
      };
    });
  }

  private async readModel(predicate: string, organizationId: OrganizationId, identity: string): Promise<DraftInvoiceReadModel | null> {
    const result = await this.client.query<{
      id: string; sales_order_document_id: string; display_number: string; invoice_state: InvoiceState; currency: string; customer_id: string | null;
      synchronization_version: string; subtotal_cents: string; tax_total_cents: string; total_cents: string; sales_adjustment_cents: string; sales_adjustment_reason: string | null;
      purchase_order_number: string | null; terms_code: string | null; issued_at: Date | null; created_at: Date; updated_at: Date; customer_display_name: string | null;
    }>(`SELECT i.id,i.sales_order_document_id,d.display_number,i.invoice_state,i.currency,i.customer_id,i.synchronization_version,i.subtotal_cents,i.tax_total_cents,i.total_cents,i.sales_adjustment_cents,i.sales_adjustment_reason,i.purchase_order_number,i.terms_code,i.issued_at,i.created_at,i.updated_at,COALESCE(c.display_name,c.company_name) AS customer_display_name FROM v2_billing_invoices i JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id WHERE i.organization_id=$1 AND ${predicate}`, [organizationId, identity]);
    const invoice = result.rows[0];
    if (!invoice) return null;
    const currency = currencyCode(invoice.currency);
    const lines = await this.client.query<{ source_sales_line_id: string; product_id: string; description: string; quantity: number; selling_unit_cents: string; selling_line_cents: string }>(
      "SELECT source_sales_line_id,product_id,description,quantity,selling_unit_cents,selling_line_cents FROM v2_billing_invoice_lines WHERE organization_id=$1 AND invoice_id=$2 AND sales_order_document_id=$3 ORDER BY position",
      [organizationId, invoice.id, invoice.sales_order_document_id],
    );
    const checkpoint = invoice.invoice_state === "issued" ? await this.client.query<{ checkpoint_json: IssuedInvoiceCheckpoint }>("SELECT checkpoint_json FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2", [organizationId, invoice.id]) : undefined;
    const currentPresentation = invoice.customer_display_name ? { customerDisplayName: invoice.customer_display_name } : undefined;
    const issuedCheckpoint = checkpoint?.rows[0]?.checkpoint_json;
    return {
      invoiceId: brandedId<"InvoiceId">(invoice.id), organizationId,
      sourceOrderId: brandedId<"OrderId">(invoice.sales_order_document_id), sourceOrderNumber: invoice.display_number, lifecycle: invoice.invoice_state,
      ...(invoice.customer_id ? { customerId: brandedId<"CustomerId">(invoice.customer_id) } : {}),
      ...(issuedCheckpoint ? { customerPresentation: issuedCheckpoint.customerPresentation, issuedCheckpoint } : currentPresentation ? { customerPresentation: currentPresentation } : {}),
      currency, synchronizationVersion: invoice.synchronization_version,
      lines: lines.rows.map((line) => ({ sourceOrderLineId: brandedId<"OrderLineId">(line.source_sales_line_id), productId: brandedId<"ProductId">(line.product_id), description: line.description, quantity: line.quantity, sellingUnitAmount: money(currency, Number(line.selling_unit_cents)), lineAmount: money(currency, Number(line.selling_line_cents)) })),
      subtotal: money(currency, Number(invoice.subtotal_cents)), ...(Number(invoice.sales_adjustment_cents) !== 0 && invoice.sales_adjustment_reason ? { salesAdjustment: { amount: money(currency, Number(invoice.sales_adjustment_cents)), reason: invoice.sales_adjustment_reason } } : {}), taxTotal: money(currency, Number(invoice.tax_total_cents)), total: money(currency, Number(invoice.total_cents)),
      ...(invoice.purchase_order_number ? { purchaseOrderNumber: invoice.purchase_order_number } : {}), ...(invoice.terms_code ? { termsCode: invoice.terms_code } : {}), ...(invoice.issued_at ? { issuedAt: invoice.issued_at.toISOString() } : {}),
      createdAt: invoice.created_at.toISOString(), updatedAt: invoice.updated_at.toISOString(),
    };
  }

  private async applyExisting(
    input: DraftInvoiceSynchronizationInput,
    invoices: readonly InvoiceRow[],
  ): Promise<DraftInvoiceSynchronizationResult> {
    const drafts = invoices.filter((invoice) => invoice.invoice_state === "draft");
    if (drafts.length > 1) {
      return {
        invoiceId: brandedId<"InvoiceId">(drafts[0]!.id),
        status: "not_editable",
        reason: "multiple_active_invoices",
      };
    }
    const draft = drafts[0];
    if (!draft) {
      const issued = invoices.find((invoice) => invoice.invoice_state === "issued");
      const voided = invoices.find((invoice) => invoice.invoice_state === "void");
      if (issued) {
        return {
          invoiceId: brandedId<"InvoiceId">(issued.id),
          status: "not_editable",
          reason: "invoice_issued",
          synchronizationVersion: issued.synchronization_version,
        };
      }
      if (voided) {
        return {
          invoiceId: brandedId<"InvoiceId">(voided.id),
          status: "not_editable",
          reason: "invoice_void",
          synchronizationVersion: voided.synchronization_version,
        };
      }
      return {
        status: "not_editable",
        reason: "invoice_missing",
      };
    }
    if (draft.source_sales_state_token === input.sourceSalesStateToken) {
      return {
        invoiceId: brandedId<"InvoiceId">(draft.id),
        status: "unchanged",
        synchronizationVersion: draft.synchronization_version,
      };
    }
    const totals = await this.totals(input);
    const updated = await this.client.query<{ synchronization_version: string }>(
      `UPDATE v2_billing_invoices SET
        customer_id=$4,contact_id=$5,purchase_order_number=$6,currency=$7,
        terms_code=$8,source_sales_state_token=$9,synchronization_version=synchronization_version+1,
        subtotal_cents=$10,tax_total_cents=$11,total_cents=$12,
        tax_context_reference=$13,tax_calculator_version=$14,tax_evidence=$15::jsonb,sales_adjustment_cents=$16,sales_adjustment_reason=$17,sales_commercial_charge=$18::jsonb,sales_tax_composition=$19::jsonb,
        updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND sales_order_document_id=$3
         AND invoice_state='draft'
       RETURNING synchronization_version`,
      [
        input.organizationId,
        draft.id,
        input.orderId,
        input.customerContact.customerId ?? null,
        input.customerContact.contactId ?? null,
        input.purchaseOrderNumber ?? null,
        input.currency,
        input.termsCode ?? null,
        input.sourceSalesStateToken,
        totals.subtotalCents, totals.taxCents, totals.totalCents,
        input.taxInput.taxContextReference ?? null,
        totals.taxCalculatorVersion,
        JSON.stringify(totals.taxEvidence), input.salesAdjustment?.cents ?? 0, input.salesAdjustment?.reason ?? null, jsonObjectOrNull(totals.charge), jsonObjectOrNull(totals.composition),
      ],
    );
    if (!updated.rows[0]) {
      return {
        invoiceId: brandedId<"InvoiceId">(draft.id),
        status: "not_editable",
        reason: "invoice_issued",
      };
    }
    await this.writeLines(input, brandedId<"InvoiceId">(draft.id));
    return {
      invoiceId: brandedId<"InvoiceId">(draft.id),
      status: "synchronized",
      synchronizationVersion: updated.rows[0].synchronization_version,
    };
  }

  private async readInvoicesForOrder(
    input: DraftInvoiceSynchronizationInput,
    forUpdate: boolean,
  ): Promise<readonly InvoiceRow[]> {
    const result = await this.client.query<InvoiceRow>(
      `SELECT id,invoice_state,source_sales_state_token,synchronization_version
       FROM v2_billing_invoices
       WHERE organization_id=$1 AND sales_order_document_id=$2
       ORDER BY created_at
       ${forUpdate ? "FOR UPDATE" : ""}`,
      [input.organizationId, input.orderId],
    );
    return result.rows;
  }

  private async totals(input: DraftInvoiceSynchronizationInput): Promise<Readonly<{
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    taxCalculatorVersion: string;
    taxEvidence: Readonly<Record<string, unknown>>;
    composition?: SalesTaxComposition;
    charge?: unknown;
  }>> {
    const orderCommercial = await this.client.query<{ tax_composition: SalesTaxComposition | null; commercial_charge: unknown }>(
      "SELECT tax_composition,commercial_charge FROM v2_sales_order_details WHERE organization_id=$1 AND document_id=$2",
      [input.organizationId, input.orderId],
    );
    const composition = orderCommercial.rows[0]?.tax_composition ?? undefined;
    const charge = orderCommercial.rows[0]?.commercial_charge;
    if (composition?.status === "resolved") return {
      subtotalCents: composition.finalTotalCents - composition.taxCents,
      taxCents: composition.taxCents,
      totalCents: composition.finalTotalCents,
      taxCalculatorVersion: composition.calculatorVersion,
      taxEvidence: composition,
      composition,
      charge,
    };
    const tax = taxEnvelope(input);
    const subtotalCents = sumCents(input.salesLines, input.salesAdjustment?.cents ?? 0);
    return {
      subtotalCents,
      taxCents: 0,
      totalCents: subtotalCents,
      taxCalculatorVersion: tax.calculatorVersion,
      taxEvidence: tax.evidence,
      ...(composition ? { composition } : {}),
      ...(charge ? { charge } : {}),
    };
  }

  private async writeLines(
    input: DraftInvoiceSynchronizationInput,
    invoiceId: InvoiceId,
  ): Promise<void> {
    await this.client.query(
      "DELETE FROM v2_billing_invoice_lines WHERE organization_id=$1 AND invoice_id=$2 AND sales_order_document_id=$3",
      [input.organizationId, invoiceId, input.orderId],
    );
    for (const [position, line] of input.salesLines.entries()) {
      await this.client.query(
        `INSERT INTO v2_billing_invoice_lines(
          id,organization_id,invoice_id,sales_order_document_id,source_sales_line_id,
          position,product_id,description,quantity,currency,selling_unit_cents,
          selling_line_cents,sales_pricing_evidence_fingerprint
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          input.organizationId,
          invoiceId,
          input.orderId,
          line.lineId,
          position,
          line.productId,
          line.description,
          line.quantity,
          input.currency,
          line.sellingUnitAmount.cents,
          line.sellingLineAmount.cents,
          line.salesPricingEvidenceFingerprint,
        ],
      );
    }
  }
}
