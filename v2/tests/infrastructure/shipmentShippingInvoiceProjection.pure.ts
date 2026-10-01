import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { applyShippingChargeInTransaction } from "../../infrastructure/billing/postgresShippingCharge.js";
import { PostgresShipmentShippingAllocationService } from "../../infrastructure/fulfillment/postgresShipmentShippingAllocation.js";
import type { ApplyShippingChargeRequest } from "../../src/modules/billing/shippingCharge.js";
import type { OperationContext } from "../../src/application/operation.js";
import { composeSalesTax, type CommercialCharge, type FrozenTaxExemption, type TaxResolution } from "../../src/modules/sales/taxComposition.js";

const organizationId="org-shipping", orderId="order-a", invoiceId="invoice-a", shipmentId="shipment-a";
const context:OperationContext={organizationId,operationId:"shipping-project",principal:{kind:"staff",organizationId,userId:"operator",authority:{membershipId:"member",capabilities:["fulfillment.shipping.price"]}}};
const request:ApplyShippingChargeRequest={organizationId,orderId,invoiceId,shipmentId,shipmentAllocationId:"allocation-a",customerChargeCents:101,orderNumbers:["ORD-2","ORD-1"],actor:{principalKind:"staff",principalSubject:"operator",staffActorUserId:"operator"}};
const resolution:TaxResolution={status:"resolved",jurisdiction:{jurisdictionId:"tax-frozen",name:"Frozen jurisdiction",receiptLocation:{country:"US",region:"WA",postalCode:"98101"},rateBasisPoints:1000,active:true,homeBusiness:false},receiptLocation:{country:"US",region:"WA",postalCode:"98101"}};
type Charge={id:string;invoice_id:string;sales_order_document_id:string;customer_charge_cents:string;charge_kind:"shipping";tax_cents:number;allocationId:string;evidence:unknown;note:unknown};
type Options={state?:"draft"|"issued"|"void";missingInvoice?:boolean;wrongOrder?:boolean;exemption?:FrozenTaxExemption;unresolved?:boolean;corruptTax?:boolean;badTaxability?:boolean;invalidEvidence?:boolean;failRevision?:boolean;replacement?:"no_charge"|"billable"|"pending";amount?:number;noAllocations?:boolean;stale?:boolean};
const fixture=(options:Options={})=>{
  const lines=[{lineId:"taxable-line",amountCents:1000,taxable:true},{lineId:"nontaxable-line",amountCents:1000,taxable:false}];
  const sourceCharge:CommercialCharge={kind:"handling",cents:100,description:"Frozen handling"};
  const exemption=options.exemption??{exempt:false};
  const taxResolution:TaxResolution=options.unresolved?{status:"unresolved",reason:"tax_jurisdiction_not_configured"}:resolution;
  const initial=composeSalesTax({lines,adjustmentCents:-200,charges:[sourceCharge],exemption,resolution:taxResolution});
  const tax=initial.status==="resolved"?initial.taxCents:0;
  const invoice={id:invoiceId,sales_order_document_id:options.wrongOrder?"other-order":orderId,invoice_state:options.state??"draft",subtotal_cents:"1900",tax_total_cents:String(options.corruptTax?tax+1:tax),total_cents:String(1900+tax),tax_evidence:options.invalidEvidence?{}:initial,sales_adjustment_cents:"-200",sales_commercial_charge:sourceCharge,synchronization_version:"3",issued_checkpoint:{total:1900+tax,evidence:initial}};
  const authority={order_document_id:orderId,replacement_obligation_id:options.replacement?"replacement-a":null,display_number:"ORD-1",billing_treatment:options.replacement??null};
  const member=`sha256:${createHash("sha256").update(`${orderId}:${authority.replacement_obligation_id??"original"}`).digest("hex")}`;
  const amount=options.amount??101;
  const state={invoice,charges:[] as Charge[],revisions:[] as unknown[],allocations:options.noAllocations?[]:[{id:"allocation-a",order_document_id:orderId,customer_shipping_price_cents:String(amount),allocation_kind:"equal_split",invoiced_invoice_id:null as string|null,membership_fingerprint:options.stale?"old-members":member}],economics:[] as unknown[]};
  const calls:{sql:string;values:readonly unknown[]}[]=[];
  let snapshot:typeof state|undefined, connections=0;
  const client={query:async(sql:string,values:readonly unknown[]=[])=>{
    calls.push({sql,values});
    if(sql==="BEGIN"){snapshot=structuredClone(state);return {rows:[]};}
    if(sql==="ROLLBACK"){Object.assign(state,snapshot);return {rows:[]};}
    if(sql==="COMMIT"||sql.includes("pg_advisory_xact_lock"))return {rows:[]};
    if(sql.startsWith("SELECT")&&sql.includes("FROM v2_billing_")&&values[0]!==organizationId)return {rows:[]};
    assert.equal(values[0]===organizationId||sql.startsWith("INSERT INTO"),true,"all reads/updates retain tenant scope");
    if(sql.includes("FROM v2_fulfillment_shipments"))return {rows:[{customer_shipping_price_cents:String(amount),customer_shipping_price_frozen_at:new Date()}]};
    if(sql.includes("FROM v2_fulfillment_shipment_handoffs"))return {rows:[authority]};
    if(sql.startsWith("SELECT id,order_document_id"))return {rows:state.allocations};
    if(sql.startsWith("DELETE FROM v2_fulfillment_shipment_shipping_allocations")){state.allocations=[];return {rows:[]};}
    if(sql.startsWith("INSERT INTO v2_fulfillment_shipment_shipping_allocations")){state.allocations.push({id:String(values[0]),order_document_id:String(values[3]),customer_shipping_price_cents:String(values[4]),allocation_kind:String(values[5]),invoiced_invoice_id:null,membership_fingerprint:String(values[6])});return {rows:[]};}
    if(sql.startsWith("INSERT INTO v2_fulfillment_shipment_economics_events")){state.economics.push(values);return {rows:[]};}
    if(sql.startsWith("UPDATE v2_fulfillment_shipment_shipping_allocations")){state.allocations.find(value=>value.id===values[2])!.invoiced_invoice_id=String(values[3]);return {rows:[]};}
    if(sql.startsWith("SELECT id FROM v2_billing_invoices"))return {rows:options.missingInvoice||options.state==="void"?[]:[{id:invoiceId}]};
    if(sql.startsWith("SELECT id,invoice_id,sales_order_document_id FROM v2_billing_invoice_additional_charges"))return {rows:state.charges.filter(value=>value.allocationId===values[1])};
    if(sql.startsWith("SELECT id,sales_order_document_id,invoice_state"))return {rows:options.missingInvoice||values[1]!==invoiceId?[]:[state.invoice]};
    if(sql.includes("FROM v2_billing_invoice_lines"))return {rows:lines.map(line=>({source_sales_line_id:line.lineId,selling_line_cents:String(line.amountCents),taxability_snapshot:options.badTaxability?{}:{taxable:line.taxable}}))};
    if(sql.startsWith("SELECT customer_charge_cents"))return {rows:state.charges};
    if(sql.startsWith("INSERT INTO v2_billing_invoice_additional_charges")){state.charges.push({id:String(values[0]),invoice_id:String(values[2]),sales_order_document_id:String(values[3]),allocationId:String(values[5]),customer_charge_cents:String(values[6]),tax_cents:Number(values[7]),charge_kind:"shipping",evidence:JSON.parse(String(values[8])),note:values[9]});return {rows:[]};}
    if(sql.startsWith("UPDATE v2_billing_invoices")){state.invoice.subtotal_cents=String(Number(state.invoice.subtotal_cents)+Number(values[2]));state.invoice.tax_total_cents=String(Number(state.invoice.tax_total_cents)+Number(values[3]));state.invoice.total_cents=String(Number(state.invoice.total_cents)+Number(values[2])+Number(values[3]));state.invoice.tax_evidence=JSON.parse(String(values[4]));state.invoice.synchronization_version=String(Number(state.invoice.synchronization_version)+1);return {rows:[]};}
    if(sql.startsWith("SELECT COALESCE(max(revision_number)"))return {rows:[{next:String(state.revisions.length+1)}]};
    if(sql.startsWith("INSERT INTO v2_billing_invoice_revisions")){if(options.failRevision)throw new Error("revision write failed");state.revisions.push(values);return {rows:[]};}
    throw new Error(`Unexpected SQL: ${sql}`);
  },release:()=>undefined} as unknown as PoolClient;
  const pool={connect:async()=>{connections++;return client;}} as unknown as Pool;
  return {state,calls,client,service:new PostgresShipmentShippingAllocationService(pool),connections:()=>connections};
};

let cases=0;
const check=async(name:string,work:()=>Promise<void>)=>{await work();cases++;console.log(`PASS ${name}`);};
await check("Billing totals, mixed taxability, adjustment, source charge, rounding, evidence and actor",async()=>{
  const f=fixture();assert.equal(f.state.invoice.tax_total_cents,"95");assert.equal(f.state.invoice.total_cents,"1995");await applyShippingChargeInTransaction(f.client,request);
  assert.equal(f.state.invoice.subtotal_cents,"2001");assert.equal(f.state.invoice.tax_total_cents,"100");assert.equal(f.state.invoice.total_cents,"2101");
  assert.equal(f.state.charges[0].tax_cents,5);assert.equal(f.state.charges[0].note,"Shipping charge split between Orders ORD-1, ORD-2.");
  assert.equal(f.state.revisions.length,1);assert.equal(f.state.invoice.synchronization_version,"4");
  assert.deepEqual(f.state.charges[0].evidence,f.state.invoice.tax_evidence);
  const charge=f.calls.find(call=>call.sql.startsWith("INSERT INTO v2_billing_invoice_additional_charges"))!;
  assert.deepEqual(charge.values.slice(10),["staff","operator","operator"]);
  assert.equal(f.calls.some(call=>["BEGIN","COMMIT","ROLLBACK"].includes(call.sql)),false,"Billing participates without opening another transaction");
});
await check("multiple charges and replay are exactly once with cumulative rounded tax",async()=>{
  const f=fixture();await applyShippingChargeInTransaction(f.client,request);await applyShippingChargeInTransaction(f.client,{...request,shipmentAllocationId:"allocation-b",customerChargeCents:99});
  const before=structuredClone(f.state);await applyShippingChargeInTransaction(f.client,request);assert.deepEqual(f.state,before);
  assert.equal(f.state.invoice.subtotal_cents,"2100");assert.equal(f.state.invoice.tax_total_cents,"105");assert.equal(f.state.invoice.total_cents,"2205");
  assert.deepEqual(f.state.charges.map(value=>value.tax_cents),[5,5]);assert.equal(f.state.revisions.length,2);
});
await check("issued invoice accepts revision while issued snapshot remains immutable",async()=>{
  const f=fixture({state:"issued"}),checkpoint=structuredClone(f.state.invoice.issued_checkpoint);await applyShippingChargeInTransaction(f.client,request);
  assert.equal(f.state.invoice.invoice_state,"issued");assert.deepEqual(f.state.invoice.issued_checkpoint,checkpoint);
  assert.equal(f.calls.some(call=>/\b(?:UPDATE|INSERT INTO|DELETE FROM) v2_billing_invoice_checkpoints/.test(call.sql)),false);
});
for(const options of [{exemption:{exempt:true,reason:"Certificate",certificateReference:"cert-1"}},{unresolved:true}] satisfies Options[])await check(options.unresolved?"unresolved frozen tax retains zero incremental tax":"frozen exemption retains zero tax",async()=>{
  const f=fixture(options);await applyShippingChargeInTransaction(f.client,request);assert.equal(f.state.charges[0].tax_cents,0);assert.equal(f.state.invoice.total_cents,"2001");
});
for(const options of [{state:"void"},{wrongOrder:true},{missingInvoice:true},{corruptTax:true},{badTaxability:true},{invalidEvidence:true}] satisfies Options[])await check(`invalid Billing reference/evidence ${JSON.stringify(options)} makes no financial writes`,async()=>{
  const f=fixture(options),before=structuredClone(f.state);await assert.rejects(()=>applyShippingChargeInTransaction(f.client,request));assert.deepEqual(f.state,before);
  assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
});
await check("replay cannot redirect another Invoice or Order and amount validation precedes I/O",async()=>{
  const f=fixture();await applyShippingChargeInTransaction(f.client,request);const before=structuredClone(f.state);
  await assert.rejects(()=>applyShippingChargeInTransaction(f.client,{...request,invoiceId:"other-invoice"}),/another Invoice/);
  await assert.rejects(()=>applyShippingChargeInTransaction(f.client,{...request,orderId:"other-order"}),/another Invoice/);assert.deepEqual(f.state,before);
  const count=f.calls.length;await assert.rejects(()=>applyShippingChargeInTransaction(f.client,{...request,customerChargeCents:0.5}),/whole-cent/);assert.equal(f.calls.length,count);
});
await check("Billing cannot read or mutate another organization's Invoice",async()=>{
  const f=fixture(),before=structuredClone(f.state);await assert.rejects(()=>applyShippingChargeInTransaction(f.client,{...request,organizationId:"other-org"}),/Shipping destination Invoice changed/);
  assert.deepEqual(f.state,before);assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
  assert.ok(f.calls.every(call=>call.values[0]==="other-org"));
});
await check("Shipping delegates Billing on its sole client, marks allocation only after owner revision, and replays",async()=>{
  const f=fixture();const result=await f.service.project(context,shipmentId);assert.equal(result.allocationState,"projected");assert.equal(result.allocations[0].invoicedInvoiceId,invoiceId);
  assert.equal(f.connections(),1);assert.equal(f.calls[0].sql,"BEGIN");assert.equal(f.calls.at(-1)!.sql,"COMMIT");
  const revisionAt=f.calls.findIndex(call=>call.sql.startsWith("INSERT INTO v2_billing_invoice_revisions")),allocationAt=f.calls.findIndex(call=>call.sql.startsWith("UPDATE v2_fulfillment_shipment_shipping_allocations"));assert.ok(revisionAt>0&&allocationAt>revisionAt);
  const before=structuredClone(f.state);await f.service.project(context,shipmentId);assert.deepEqual(f.state,before);
  const source=readFileSync("v2/infrastructure/fulfillment/postgresShipmentShippingAllocation.ts","utf8");assert.match(source,/applyShippingChargeInTransaction\(client,/);
  assert.doesNotMatch(source,/(?:INSERT INTO|UPDATE|DELETE FROM) v2_billing_/);assert.doesNotMatch(source,/taxComposition|composeSalesTax|frozenResolution/);
});
for(const options of [{failRevision:true,noAllocations:true},{wrongOrder:true,noAllocations:true},{invalidEvidence:true,noAllocations:true},{missingInvoice:true,noAllocations:true},{stale:true}] satisfies Options[])await check(`coordinator rollback restores financial/allocation state ${JSON.stringify(options)}`,async()=>{
  const f=fixture(options),before=structuredClone(f.state);await assert.rejects(()=>f.service.project(context,shipmentId));assert.deepEqual(f.state,before);
  assert.equal(f.calls.at(-1)!.sql,"ROLLBACK");assert.equal(f.calls.some(call=>call.sql==="COMMIT"),false);
});
await check("no-charge replacement zero skips Invoice mutation, positive and pending reject, billable projects",async()=>{
  const zero=fixture({replacement:"no_charge",amount:0});await zero.service.project(context,shipmentId);assert.equal(zero.calls.some(call=>call.sql.includes("v2_billing_")),false);assert.equal(zero.state.charges.length,0);
  for(const replacement of ["no_charge","pending"] as const){const f=fixture({replacement});await assert.rejects(()=>f.service.project(context,shipmentId));assert.equal(f.state.charges.length,0);assert.equal(f.calls.at(-1)!.sql,"ROLLBACK");}
  const billable=fixture({replacement:"billable"});await billable.service.project(context,shipmentId);assert.equal(billable.state.charges.length,1);
});
await check("wrong tenant, missing capability and nonstaff callers fail before connecting",async()=>{
  const f=fixture();for(const denied of [{...context,organizationId:"other-org"},{...context,principal:{...context.principal,authority:{membershipId:"member",capabilities:[]}}},{...context,principal:{kind:"service",organizationId,clientId:"service",capabilities:["fulfillment.shipping.price"]}}] as OperationContext[])await assert.rejects(()=>f.service.project(denied,shipmentId));
  assert.equal(f.connections(),0);assert.equal(f.calls.length,0);
});
console.log(`Shipment Shipping/Billing owner projection: ${cases} cases passed.`);
