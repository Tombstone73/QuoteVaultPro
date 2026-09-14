import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { composeSalesTax, type FrozenTaxExemption, type SalesTaxComposition, type TaxReceiptLocation, type TenantTaxJurisdiction } from "../../src/modules/sales/taxComposition.js";
import { nextReplacementInvoiceSequence, proportionalReplacementLineCents, replacementInvoiceSuffix } from "../../src/modules/billing/replacementInvoice.js";
import { brandedId, currencyCode, money, type InvoiceId, type OrderId, type OrderLineId, type OrganizationId, type ReplacementObligationId } from "../../src/modules/shared/commercialValues.js";

type ExistingReplacementInvoice = Readonly<{ id:string; invoice_display_number:string; invoice_state:"draft"|"issued"|"void"; currency:string; total_cents:string }>;
type OrderRow = Readonly<{ id:string; display_number:string }>;
type SourceRow = Readonly<{
  id:string; customer_id:string|null; contact_id:string|null; purchase_order_number:string|null; currency:string; terms_code:string|null;
  tax_context_reference:string|null; tax_calculator_version:string; tax_evidence:unknown;
  source_sales_line_id:string; product_id:string; description:string;
  source_quantity:number; source_selling_unit_cents:string; source_selling_line_cents:string; source_pricing_evidence_fingerprint:string;
  taxability_snapshot:unknown;
}>;

export type ReplacementInvoiceProjection = Readonly<{
  invoiceId: InvoiceId;
  invoiceNumber: string;
  lifecycle: "draft"|"issued"|"void";
  currency: string;
  totalCents: number;
}>;

const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const string=(value:unknown):string|undefined=>typeof value==="string"&&value.trim()?value:undefined;
const integer=(value:unknown):number|undefined=>typeof value==="number"&&Number.isSafeInteger(value)?value:undefined;

const replacementTax=(evidence:unknown,taxability:unknown,lineId:string,lineCents:number):Readonly<{taxCents:number;evidence:SalesTaxComposition}>=>{
  const source=record(evidence), status=source?.status;
  if(status==="unresolved") {
    const reason=source?.reason;
    if(reason!=="tax_jurisdiction_not_configured"&&reason!=="tax_jurisdiction_conflict") throw new V2ApplicationError("CONFLICT","The original Invoice has invalid frozen tax evidence.");
    return {taxCents:0,evidence:{status:"unresolved",calculatorVersion:"v2-sales-receipt-jurisdiction-v1",reason,finalTotalCents:lineCents}};
  }
  if(status!=="resolved") throw new V2ApplicationError("CONFLICT","The original Invoice has no reusable frozen tax evidence.");
  const jurisdiction=record(source?.jurisdiction), receipt=record(jurisdiction?.receiptLocation), exemption=record(source?.exemption), taxable=record(taxability)?.taxable;
  const jurisdictionId=string(jurisdiction?.id), name=string(jurisdiction?.name), country=string(receipt?.country), region=string(receipt?.region), rateBasisPoints=integer(jurisdiction?.rateBasisPoints);
  if(!jurisdictionId||!name||!country||!region||rateBasisPoints===undefined||typeof taxable!=="boolean"||typeof exemption?.exempt!=="boolean") throw new V2ApplicationError("CONFLICT","The original Invoice tax facts cannot be safely reused for this replacement.");
  const receiptLocation:TaxReceiptLocation={country,region,...(string(receipt?.postalCode)?{postalCode:string(receipt?.postalCode)}:{})};
  const frozenJurisdiction:TenantTaxJurisdiction={jurisdictionId,name,receiptLocation,rateBasisPoints,active:true,homeBusiness:false};
  const frozenExemption:FrozenTaxExemption={exempt:exemption.exempt,...(string(exemption.reason)?{reason:string(exemption.reason)}:{}),...(string(exemption.certificateReference)?{certificateReference:string(exemption.certificateReference)}:{})};
  const composition=composeSalesTax({lines:[{lineId,amountCents:lineCents,taxable}],exemption:frozenExemption,resolution:{status:"resolved",jurisdiction:frozenJurisdiction,receiptLocation}});
  if(composition.status!=="resolved") throw new V2ApplicationError("CONFLICT","The original Invoice tax facts cannot be safely reused for this replacement.");
  return {taxCents:composition.taxCents,evidence:composition};
};

const projection=(row:ExistingReplacementInvoice):ReplacementInvoiceProjection=>({invoiceId:brandedId<"InvoiceId">(row.id),invoiceNumber:row.invoice_display_number,lifecycle:row.invoice_state,currency:row.currency,totalCents:Number(row.total_cents)});

/** Creates the single canonical draft Invoice for a billable replacement.
 * The caller owns the surrounding transaction, which also creates the
 * replacement obligation and its Production authority. */
export const createOrReadReplacementInvoice=async(client:PoolClient,input:Readonly<{organizationId:OrganizationId;orderId:OrderId;orderLineId:OrderLineId;replacementObligationId:ReplacementObligationId;replacementQuantity:number}>):Promise<ReplacementInvoiceProjection>=>{
  const existing=await client.query<ExistingReplacementInvoice>("SELECT id,invoice_display_number,invoice_state,currency,total_cents FROM v2_billing_invoices WHERE organization_id=$1 AND replacement_obligation_id=$2 FOR UPDATE",[input.organizationId,input.replacementObligationId]);
  if(existing.rows[0]) return projection(existing.rows[0]);

  // This serializes suffix allocation with canonical Invoice issuance for the
  // same Order; the unique indexes remain the database backstop.
  const order=await client.query<OrderRow>("SELECT d.id,d.display_number FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='order' FOR UPDATE OF d,o",[input.organizationId,input.orderId]);
  const base=order.rows[0];
  if(!base?.display_number) throw new V2ApplicationError("CONFLICT","The Order / Job base number is unavailable for this replacement Invoice.");

  const source=await client.query<SourceRow>(`SELECT i.id,i.customer_id,i.contact_id,i.purchase_order_number,i.currency,i.terms_code,i.tax_context_reference,i.tax_calculator_version,i.tax_evidence,
      line.source_sales_line_id,line.product_id,line.description,
      sales_line.quantity AS source_quantity,sales_line.selling_unit_cents AS source_selling_unit_cents,sales_line.selling_line_cents AS source_selling_line_cents,sales_line.pricing_evidence_fingerprint AS source_pricing_evidence_fingerprint,
      sales_line.taxability_snapshot
    FROM v2_billing_invoices i
    JOIN v2_billing_invoice_lines line ON line.organization_id=i.organization_id AND line.invoice_id=i.id AND line.sales_order_document_id=i.sales_order_document_id
    JOIN v2_sales_document_lines sales_line ON sales_line.organization_id=line.organization_id AND sales_line.id=line.source_sales_line_id AND sales_line.document_id=line.sales_order_document_id
    WHERE i.organization_id=$1 AND i.sales_order_document_id=$2 AND i.replacement_obligation_id IS NULL
      AND i.invoice_state='issued' AND i.invoice_sequence=1 AND i.invoice_display_number=$3 AND line.source_sales_line_id=$4
    FOR UPDATE OF i,line,sales_line`,[input.organizationId,input.orderId,base.display_number,input.orderLineId]);
  const original=source.rows[0];
  if(!original) throw new V2ApplicationError("CONFLICT","A billable replacement requires the canonical issued base Invoice and its original Order-line pricing evidence.");
  if(original.currency!==currencyCode(original.currency)) throw new V2ApplicationError("CONFLICT","The original Invoice currency is invalid.");
  const originalLineCents=Number(original.source_selling_line_cents), originalUnitCents=Number(original.source_selling_unit_cents);
  if(!Number.isSafeInteger(originalLineCents)||!Number.isSafeInteger(originalUnitCents)||!Number.isSafeInteger(original.source_quantity)||original.source_quantity<=0||!original.source_pricing_evidence_fingerprint.trim()) throw new V2ApplicationError("CONFLICT","The original Order line cannot safely price this replacement.");
  const lineCents=proportionalReplacementLineCents(originalLineCents,original.source_quantity,input.replacementQuantity);
  const tax=replacementTax(original.tax_evidence,original.taxability_snapshot,original.source_sales_line_id,lineCents);

  const allocated=await client.query<{invoice_sequence:number}>("SELECT invoice_sequence FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 AND invoice_sequence IS NOT NULL FOR UPDATE",[input.organizationId,input.orderId]);
  const sequence=nextReplacementInvoiceSequence(allocated.rows.map(row=>row.invoice_sequence));
  const invoiceNumber=`${base.display_number}-${replacementInvoiceSuffix(sequence)}`;
  const legacy=await client.query("SELECT 1 FROM invoices WHERE organization_id=$1 AND (display_number=$2 OR qb_doc_number=$2 OR invoice_number::text=$2) LIMIT 1",[input.organizationId,invoiceNumber]);
  if(legacy.rows[0]) throw new V2ApplicationError("CONFLICT",`Invoice number ${invoiceNumber} conflicts with a preserved historical invoice.`);

  const invoiceId=randomUUID(), totalCents=lineCents+tax.taxCents;
  const inserted=await client.query<ExistingReplacementInvoice>(`INSERT INTO v2_billing_invoices(
      id,organization_id,sales_order_document_id,replacement_obligation_id,invoice_state,invoice_display_number,invoice_sequence,
      customer_id,contact_id,purchase_order_number,currency,terms_code,source_sales_state_token,
      subtotal_cents,tax_total_cents,total_cents,tax_context_reference,tax_calculator_version,tax_evidence,
      sales_adjustment_cents,sales_adjustment_reason,sales_commercial_charge,sales_tax_composition
    ) VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,0,NULL,NULL,NULL)
    ON CONFLICT DO NOTHING RETURNING id,invoice_display_number,invoice_state,currency,total_cents`,[
    invoiceId,input.organizationId,input.orderId,input.replacementObligationId,invoiceNumber,sequence,
    original.customer_id,original.contact_id,original.purchase_order_number,original.currency,original.terms_code,`replacement:${input.replacementObligationId}`,
    lineCents,tax.taxCents,totalCents,original.tax_context_reference,original.tax_calculator_version,JSON.stringify(tax.evidence),
  ]);
  const invoice=inserted.rows[0];
  if(!invoice) {
    const raced=await client.query<ExistingReplacementInvoice>("SELECT id,invoice_display_number,invoice_state,currency,total_cents FROM v2_billing_invoices WHERE organization_id=$1 AND replacement_obligation_id=$2 FOR UPDATE",[input.organizationId,input.replacementObligationId]);
    if(!raced.rows[0]) throw new Error("Replacement Invoice creation race could not reload its authoritative Invoice.");
    return projection(raced.rows[0]);
  }
  await client.query(`INSERT INTO v2_billing_invoice_lines(
      id,organization_id,invoice_id,sales_order_document_id,source_sales_line_id,position,product_id,description,quantity,currency,selling_unit_cents,selling_line_cents,sales_pricing_evidence_fingerprint
    ) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12)`,[
    randomUUID(),input.organizationId,invoiceId,input.orderId,original.source_sales_line_id,original.product_id,original.description,input.replacementQuantity,original.currency,originalUnitCents,lineCents,original.source_pricing_evidence_fingerprint,
  ]);
  return projection(invoice);
};
