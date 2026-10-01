import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ApplyShippingChargeRequest } from "../../src/modules/billing/shippingCharge.js";
import { composeSalesTax, type CommercialCharge, type FrozenTaxExemption, type TaxReceiptLocation, type TaxResolution, type TenantTaxJurisdiction } from "../../src/modules/sales/taxComposition.js";

type InvoiceRow = { id:string; sales_order_document_id:string; invoice_state:"draft"|"issued"|"void"; subtotal_cents:string; tax_total_cents:string; total_cents:string; tax_evidence:unknown; sales_adjustment_cents:string; sales_commercial_charge:unknown; synchronization_version:string };
type InvoiceLineRow = { source_sales_line_id:string; selling_line_cents:string; taxability_snapshot:unknown };
type ExistingCharge = { customer_charge_cents:string; charge_kind:"shipping" };
const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const text=(value:unknown):string|undefined=>typeof value==="string"&&value.trim()?value:undefined;
const integer=(value:unknown):number|undefined=>typeof value==="number"&&Number.isSafeInteger(value)?value:undefined;

/** Reuses the Invoice's frozen tax evidence without a jurisdiction lookup. */
const frozenResolution=(evidence:unknown):Readonly<{exemption:FrozenTaxExemption;resolution:TaxResolution}>=>{
  const source=record(evidence);
  if(source?.status==="unresolved") {
    const reason=source.reason;
    if(reason!=="tax_jurisdiction_not_configured"&&reason!=="tax_jurisdiction_conflict") throw new V2ApplicationError("CONFLICT","The destination Invoice has invalid frozen tax evidence.");
    return {exemption:{exempt:false},resolution:{status:"unresolved",reason}};
  }
  const jurisdictionEvidence=record(source?.jurisdiction),receipt=record(jurisdictionEvidence?.receiptLocation),exemption=record(source?.exemption);
  const jurisdictionId=text(jurisdictionEvidence?.id),name=text(jurisdictionEvidence?.name),country=text(receipt?.country),region=text(receipt?.region),rateBasisPoints=integer(jurisdictionEvidence?.rateBasisPoints);
  if(source?.status!=="resolved"||!jurisdictionId||!name||!country||!region||rateBasisPoints===undefined||typeof exemption?.exempt!=="boolean") throw new V2ApplicationError("CONFLICT","The destination Invoice has no reusable frozen tax evidence.");
  const receiptLocation:TaxReceiptLocation={country,region,...(text(receipt?.postalCode)?{postalCode:text(receipt?.postalCode)}:{})};
  const frozenJurisdiction:TenantTaxJurisdiction={jurisdictionId,name,receiptLocation,rateBasisPoints,active:true,homeBusiness:false};
  return {exemption:{exempt:exemption.exempt,...(text(exemption.reason)?{reason:text(exemption.reason)}:{}),...(text(exemption.certificateReference)?{certificateReference:text(exemption.certificateReference)}:{})},resolution:{status:"resolved",jurisdiction:frozenJurisdiction,receiptLocation}};
};
const commercialCharge=(value:unknown):CommercialCharge|undefined=>{const candidate=record(value),kind=candidate?.kind,candidateCents=integer(candidate?.cents),description=text(candidate?.description);return (kind==="shipping"||kind==="delivery"||kind==="handling"||kind==="packing"||kind==="crating"||kind==="postage")&&candidateCents!==undefined&&candidateCents>=0?{kind,cents:candidateCents,...(description?{description}:{})}:undefined;};

/** Billing-owned financial participant. The authorized Shipping coordinator owns
 * BEGIN/COMMIT/ROLLBACK; this operation only uses its already-open client. */
export async function applyShippingChargeInTransaction(client:PoolClient, request:ApplyShippingChargeRequest):Promise<void> {
  const {organizationId,invoiceId,orderId,shipmentId,shipmentAllocationId,customerChargeCents,orderNumbers,actor:a}=request;
  if(!Number.isSafeInteger(customerChargeCents)||customerChargeCents<0) throw new V2ApplicationError("VALIDATION_ERROR","Shipping charge must be a non-negative whole-cent amount.");
  const exists=await client.query<{id:string;invoice_id:string;sales_order_document_id:string}>("SELECT id,invoice_id,sales_order_document_id FROM v2_billing_invoice_additional_charges WHERE organization_id=$1 AND shipment_shipping_allocation_id=$2 FOR UPDATE",[organizationId,shipmentAllocationId]);
  if(exists.rows[0]) {
    if(exists.rows[0].invoice_id!==invoiceId||exists.rows[0].sales_order_document_id!==orderId) throw new V2ApplicationError("CONFLICT","Shipping allocation already belongs to another Invoice.");
    return;
  }
  const invoice=(await client.query<InvoiceRow>("SELECT id,sales_order_document_id,invoice_state,subtotal_cents::text,tax_total_cents::text,total_cents::text,tax_evidence,sales_adjustment_cents::text,sales_commercial_charge,synchronization_version::text FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE",[organizationId,invoiceId])).rows[0];
  if(!invoice) throw new V2ApplicationError("CONFLICT","Shipping destination Invoice changed before projection.");
  if(invoice.sales_order_document_id!==orderId||invoice.invoice_state==="void") throw new V2ApplicationError("CONFLICT","Shipping destination Invoice is unavailable for this Order.");
  const lines=await client.query<InvoiceLineRow>(`SELECT line.source_sales_line_id,line.selling_line_cents::text,sales.taxability_snapshot FROM v2_billing_invoice_lines line JOIN v2_sales_document_lines sales ON sales.organization_id=line.organization_id AND sales.id=line.source_sales_line_id AND sales.document_id=line.sales_order_document_id WHERE line.organization_id=$1 AND line.invoice_id=$2 ORDER BY line.position`,[organizationId,invoice.id]);
  const taxable=lines.rows.map(line=>{const flag=record(line.taxability_snapshot)?.taxable;if(typeof flag!=="boolean")throw new V2ApplicationError("CONFLICT","The destination Invoice lacks frozen line taxability evidence.");return {lineId:line.source_sales_line_id,amountCents:Number(line.selling_line_cents),taxable:flag};});
  const existing=(await client.query<ExistingCharge>("SELECT customer_charge_cents::text,charge_kind FROM v2_billing_invoice_additional_charges WHERE organization_id=$1 AND invoice_id=$2 ORDER BY created_at,id",[organizationId,invoice.id])).rows;
  const sourceCharge=commercialCharge(invoice.sales_commercial_charge),existingCharges=existing.map(row=>({kind:row.charge_kind,cents:Number(row.customer_charge_cents)} as CommercialCharge));
  const frozen=frozenResolution(invoice.tax_evidence);
  const prior=composeSalesTax({lines:taxable,adjustmentCents:Number(invoice.sales_adjustment_cents),charges:[...(sourceCharge?[sourceCharge]:[]),...existingCharges],...frozen});
  if(prior.status!=="resolved"&&frozen.resolution.status==="resolved")throw new V2ApplicationError("CONFLICT","The destination Invoice tax evidence cannot be recomposed safely.");
  if(prior.status==="resolved"&&prior.taxCents!==Number(invoice.tax_total_cents))throw new V2ApplicationError("CONFLICT","The destination Invoice tax total does not match its frozen evidence.");
  const next=composeSalesTax({lines:taxable,adjustmentCents:Number(invoice.sales_adjustment_cents),charges:[...(sourceCharge?[sourceCharge]:[]),...existingCharges,{kind:"shipping",cents:customerChargeCents}],...frozen});
  const tax=next.status==="resolved"?next.taxCents-Number(invoice.tax_total_cents):0;
  if(tax<0)throw new V2ApplicationError("CONFLICT","Shipping tax calculation produced an invalid tax change.");
  const note=orderNumbers.length>1?`Shipping charge split between Orders ${[...orderNumbers].sort((x,y)=>x.localeCompare(y)).join(", ")}.`:undefined;
  await client.query("INSERT INTO v2_billing_invoice_additional_charges(id,organization_id,invoice_id,sales_order_document_id,charge_kind,source_shipment_id,shipment_shipping_allocation_id,customer_charge_cents,tax_cents,tax_evidence,customer_note,created_principal_kind,created_principal_subject,created_staff_actor_user_id) VALUES($1,$2,$3,$4,'shipping',$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)",[randomUUID(),organizationId,invoice.id,invoice.sales_order_document_id,shipmentId,shipmentAllocationId,customerChargeCents,tax,JSON.stringify(next),note??null,a.principalKind,a.principalSubject,a.staffActorUserId??null]);
  await client.query("UPDATE v2_billing_invoices SET subtotal_cents=subtotal_cents+$3,tax_total_cents=tax_total_cents+$4,total_cents=total_cents+$3+$4,tax_evidence=$5::jsonb,synchronization_version=synchronization_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[organizationId,invoice.id,customerChargeCents,tax,JSON.stringify(next)]);
  const revision=await client.query<{next:string}>("SELECT COALESCE(max(revision_number),0)+1::int next FROM v2_billing_invoice_revisions WHERE organization_id=$1 AND invoice_id=$2",[organizationId,invoice.id]);
  await client.query("INSERT INTO v2_billing_invoice_revisions(id,organization_id,invoice_id,revision_number,revision_kind,detail,created_principal_kind,created_principal_subject,created_staff_actor_user_id) VALUES($1,$2,$3,$4,'additional_charge',$5::jsonb,$6,$7,$8)",[randomUUID(),organizationId,invoice.id,Number(revision.rows[0]!.next),JSON.stringify({chargeKind:"shipping",shipmentId,shipmentAllocationId,customerChargeCents,taxCents:tax,customerNote:note??null}),a.principalKind,a.principalSubject,a.staffActorUserId??null]);
}
