import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PostgresBillingReadRunner } from "../infrastructure/billing/postgresBillingRead.js";
import { PostgresBillingInvoiceTransactionRunner, type BillingInvoicePersistenceTestHooks } from "../infrastructure/billing/postgresBillingInvoiceTransaction.js";
import { PostgresBillingPaymentsTransactionRunner, type BillingFinancialPersistenceTestHooks } from "../infrastructure/billing/postgresBillingPaymentsTransaction.js";
import { PostgresProviderPaymentReconciliationStore } from "../infrastructure/billing/postgresProviderPaymentReconciliationStore.js";
import { PostgresProviderRefundReconciliationStore } from "../infrastructure/billing/postgresProviderRefundReconciliationStore.js";
import { assertV2BillingPhysicalPostconditions, checkV2BillingPhysicalPostconditions } from "../infrastructure/billing/billingPhysicalPostconditions.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { BillingApplicationService } from "../src/modules/billing/billingApplication.js";
import { BillingPaymentsApplicationService } from "../src/modules/billing/paymentApplication.js";
import { ProviderPaymentReconciler } from "../src/modules/billing/providerPaymentReconciliation.js";
import { ProviderRefundReconciler } from "../src/modules/billing/providerRefundReconciliation.js";
import { brandedId, currencyCode, money } from "../src/modules/shared/commercialValues.js";
const folder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../server/db/migrations_v2");
const assertOk=(value:unknown,message:string):asserts value=>assert(value,message);
const context=(org:string,user:string,id:string,caps:readonly string[]=["invoice.view","invoice.issue"])=>({organizationId:org,operationId:`m3-billing:${id}`,businessRequest:{id,payloadFingerprint:`m3-billing:${id}`},principal:{kind:"staff" as const,organizationId:org,userId:user,authority:{membershipId:`m3-billing-${user}`,capabilities:caps as any}}});
const count=async(c:any,sql:string,args:unknown[])=>Number((await c.query<{n:string}>(sql,args)).rows[0]!.n);
async function seed(c:any,input:{org:string;customer:string;product:string;order:string;invoice:string;line:string;number:number;quantity:number;unit:number}){await c.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'order',$3,$4,$5,'USD','{}')",[input.order,input.org,input.number,`ORD-${input.number}`,input.customer]);await c.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)",[input.order,input.org]);await c.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision) VALUES($1,$2,$3,0,$4,'Invoice fixture',$5,'USD',$6,$7,$6,$7,'fixture-price','sha256:fixture','{}','{}','{}')",[input.line,input.org,input.order,input.product,input.quantity,input.unit,input.quantity*input.unit]);await c.query("INSERT INTO v2_billing_invoices(id,organization_id,sales_order_document_id,invoice_state,customer_id,currency,source_sales_state_token,subtotal_cents,tax_total_cents,total_cents,tax_calculator_version,tax_evidence) VALUES($1,$2,$3,'draft',$4,'USD','1',$5,0,$5,'zero-tax','{}')",[input.invoice,input.org,input.order,input.customer,input.quantity*input.unit]);await c.query("INSERT INTO v2_billing_invoice_lines(id,organization_id,invoice_id,sales_order_document_id,source_sales_line_id,position,product_id,description,quantity,currency,selling_unit_cents,selling_line_cents,sales_pricing_evidence_fingerprint) VALUES($1,$2,$3,$4,$5,0,$6,'Invoice fixture',$7,'USD',$8,$9,'sha256:fixture')",[randomUUID(),input.org,input.invoice,input.order,input.line,input.product,input.quantity,input.unit,input.quantity*input.unit]);}
async function main(){const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:8,application_name:"m3-billing-rehearsal"});try{await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});const c=await pool.connect();try{assertV2BillingPhysicalPostconditions(await checkV2BillingPhysicalPostconditions(c));const x=randomUUID(),org=`m3-billing-${x}`,other=`m3-billing-other-${x}`,user=`m3-billing-user-${x}`,customer=`m3-billing-customer-${x}`,product=`m3-billing-product-${x}`,type=`m3-billing-type-${x}`;const ids=[1,2,3,4,5].map(n=>({order:`m3-billing-order-${n}-${x}`,invoice:`m3-billing-invoice-${n}-${x}`,line:`m3-billing-line-${n}-${x}`}));await c.query("BEGIN");await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Billing',$1),($2,'Billing Other',$2)",[org,other]);await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Billing Customer','Billing Customer',true,'active')",[customer,org]);await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Billing Type','no_route')",[type,org]);await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Billing Product','Billing Product',true,'quantity_only',$3)",[product,org,type]);for(const [index,id] of ids.entries())await seed(c,{org,customer,product,...id,number:index+1,quantity:index===0?100:10,unit:index===0?1234:100});await c.query("COMMIT");
const service=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));const first=ids[0]!;const issueId=`issue-${x}`,issue=await service.issueInvoice(context(org,user,issueId),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});assertOk(issue.ok,"Draft Invoice issuance succeeds");assert.equal(issue.value.invoice.lifecycle,"issued","canonical existing Invoice transitioned to issued");assert.equal(issue.value.invoice.total.cents,123400,"issued total preserves exact integer cents");assert.equal(issue.value.checkpoint.lines[0]?.quantity,100,"issued checkpoint preserves line quantity");assert.equal(issue.value.checkpoint.lines[0]?.unitAmount.cents,1234,"issued checkpoint preserves line unit price");assert.equal(issue.value.checkpoint.commercial.taxTotal.cents,0,"issued checkpoint preserves tax snapshot");assert.equal(issue.value.boundary.silentOrderSynchronization,false,"issued boundary disables silent Sales synchronization");
const replay=await service.issueInvoice(context(org,user,issueId),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});assertOk(replay.ok,"same issuance request replays");assert.equal(replay.value.checkpoint.checkpointId,issue.value.checkpoint.checkpointId,"same request does not create a second checkpoint");assert(!(await service.issueInvoice(context(org,user,issueId),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(ids[1]!.invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)})).ok,"conflicting protected issuance identity is rejected");
assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,first.invoice]),1,"one issued checkpoint exists");assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='invoice_issued'",[org,first.invoice]),1,"one truthful issue Audit exists");assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND aggregate_id=$2 AND event_type='billing.invoice.issued.v1'",[org,first.invoice]),1,"one durable downstream issuance signal exists");assert.equal(await count(c,"SELECT count(*) n FROM v2_principal_attributions WHERE organization_id=$1 AND resource_id=$2 AND resource_type='invoice'",[org,first.invoice]),1,"issuance attribution is recorded");
await assert.rejects(c.query("UPDATE v2_billing_invoices SET total_cents=1 WHERE organization_id=$1 AND id=$2",[org,first.invoice]),/immutable/i);await assert.rejects(c.query("UPDATE v2_billing_invoice_lines SET quantity=1 WHERE organization_id=$1 AND invoice_id=$2",[org,first.invoice]),/immutable/i);await assert.rejects(c.query("UPDATE v2_billing_invoice_checkpoints SET checkpoint_json='{}'::jsonb WHERE organization_id=$1 AND invoice_id=$2",[org,first.invoice]),/immutable/i);assert.equal(await count(c,"SELECT count(*) n FROM v2_fulfillment_handoffs WHERE organization_id=$1",[org]),0,"Billing issuance does not mutate Fulfillment");
const race=ids[1]!,raceResults=await Promise.all(["a","b"].map(label=>service.issueInvoice(context(org,user,`race-${label}-${x}`),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(race.invoice),businessRequestId:brandedId<"BusinessRequestId">(`race-${label}-${x}`)})));assert.equal(raceResults.filter(result=>result.ok).length,1,"concurrent issuance yields one transition");assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,race.invoice]),1,"concurrent issuance creates one checkpoint");
const denied=await service.issueInvoice(context(org,user,`denied-${x}`,[]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(ids[2]!.invoice),businessRequestId:brandedId<"BusinessRequestId">(`denied-${x}`)});assert(!denied.ok&&denied.error.code==="FORBIDDEN","authority is required for issuance");const foreign=await service.issueInvoice(context(other,user,`foreign-${x}`),{organizationId:brandedId<"OrganizationId">(other),invoiceId:brandedId<"InvoiceId">(ids[2]!.invoice),businessRequestId:brandedId<"BusinessRequestId">(`foreign-${x}`)});assert(!foreign.ok,"cross-tenant issuance is rejected");
for(const [name,hooks] of [["issue",{afterIssue:async()=>{throw Error("issue rollback");}}],["checkpoint",{afterCheckpoint:async()=>{throw Error("checkpoint rollback");}}],["outbox",{afterOutbox:async()=>{throw Error("outbox rollback");}}],["audit",{afterAudit:async()=>{throw Error("audit rollback");}}]] as const){const target=ids[3]!,id=`rollback-${name}-${x}`,before=await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1",[org]);const result=await new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool,hooks as BillingInvoicePersistenceTestHooks)).issueInvoice(context(org,user,id),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(target.invoice),businessRequestId:brandedId<"BusinessRequestId">(id)});assert(!result.ok,`${name} failure rolls back issuance`);assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 AND invoice_state='issued'",[org,target.invoice]),0,`${name} leaves no phantom issued invoice`);assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1",[org]),before,`${name} leaves no idempotency residue`);}
const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));const paymentContext=(id:string,caps:readonly string[]=["payment.record","refund.issue"])=>context(org,user,id,caps);const amount=(cents:number)=>money(currencyCode("USD"),cents);const p1id=`payment-1-${x}`,p1=await finance.recordManualPayment(paymentContext(p1id),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),amount:amount(25000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(p1id)});assertOk(p1.ok,"issued Invoice accepts a partial manual Payment");assert.equal(p1.value.settlement.collectibleBalance.cents,98400,"partial Payment derives exact remaining balance");const p2id=`payment-2-${x}`,p2=await finance.recordManualPayment(paymentContext(p2id),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),amount:amount(98400),method:"cash",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(p2id)});assertOk(p2.ok,"multiple Payments settle Invoice exactly");assert.equal(p2.value.settlement.collectibleBalance.cents,0,"full settlement is derived not stored on Invoice");const replayPayment=await finance.recordManualPayment(paymentContext(p1id),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),amount:amount(25000),method:"check",occurredAt:p1.value.payment.occurredAt,businessRequestId:brandedId<"BusinessRequestId">(p1id)});assertOk(replayPayment,"same payment business request replays");assert.equal(replayPayment.value.payment.paymentId,p1.value.payment.paymentId,"payment replay is canonical");const tooMuch=await finance.recordManualPayment(paymentContext(`over-${x}`),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),amount:amount(1),method:"cash",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(`over-${x}`)});assert(!tooMuch.ok,"overpayment is rejected");const r1id=`refund-1-${x}`,r1=await finance.recordRefund(paymentContext(r1id),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),paymentId:p1.value.payment.paymentId,amount:amount(10000),occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(r1id)});assertOk(r1,"partial Refund succeeds without rewriting Payment");assert.equal(r1.value.settlement.collectibleBalance.cents,10000,"refund restores derived collectible balance");const r2id=`refund-2-${x}`,r2=await finance.recordRefund(paymentContext(r2id),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),paymentId:p1.value.payment.paymentId,amount:amount(15000),occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(r2id)});assertOk(r2,"multiple Refunds are supported to original Payment limit");const overRefund=await finance.recordRefund(paymentContext(`over-refund-${x}`),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(first.invoice),paymentId:p1.value.payment.paymentId,amount:amount(1),occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(`over-refund-${x}`)});assert(!overRefund.ok,"refund cannot exceed original Payment");assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,p1.value.payment.paymentId]),1,"original Payment remains immutable after Refund");const providerId=`provider-begin-${x}`,provider=await finance.beginProviderOperation(paymentContext(providerId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(race.invoice),kind:"payment",amount:amount(1000),provider:"fake_provider",providerIdempotencyKey:`provider-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(providerId)});assertOk(provider,"ambiguous provider operation is durable");assert.equal(provider.value.reconciliationState,"uncertain","ambiguous provider outcome is not treated as failed or paid");assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,race.invoice]),0,"ambiguous provider operation creates no canonical Payment");const deniedPayment=await finance.recordManualPayment(paymentContext(`denied-payment-${x}`,[]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(race.invoice),amount:amount(1),method:"cash",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(`denied-payment-${x}`)});assert(!deniedPayment.ok,"payment authority is required");const foreignPayment=await finance.recordManualPayment({...paymentContext(`foreign-payment-${x}`),organizationId:other,principal:{...paymentContext(`foreign-payment-${x}`).principal,organizationId:other}}, {organizationId:brandedId<"OrganizationId">(other),invoiceId:brandedId<"InvoiceId">(race.invoice),amount:amount(1),method:"cash",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(`foreign-payment-${x}`)});assert(!foreignPayment.ok,"cross-tenant payment is rejected");assert.equal(await count(c,"SELECT count(*) n FROM v2_fulfillment_handoffs WHERE organization_id=$1",[org]),0,"Payments and Refunds do not mutate Fulfillment");assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type IN ('payment_recorded','refund_recorded')",[org]),4,"financial Audit is truthful and append-only");console.log("[m3.5] Billing lifecycle and Payments/Refunds PostgreSQL clone rehearsal passed (47 assertions).");}finally{c.release();}}finally{await pool.end();}}
async function providerDuplicateProof(){const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-payment-proof"});try{await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});const c=await pool.connect();try{const x=randomUUID(),org=`m3-provider-${x}`,user=`m3-provider-user-${x}`,customer=`m3-provider-customer-${x}`,product=`m3-provider-product-${x}`,type=`m3-provider-type-${x}`,order=`m3-provider-order-${x}`,invoice=`m3-provider-invoice-${x}`,line=`m3-provider-line-${x}`;await c.query("BEGIN");await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider',$1)",[org]);await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);await seed(c,{org,customer,product,order,invoice,line,number:900,quantity:5,unit:10000});await c.query("COMMIT");const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));const issueId=`provider-issue-${x}`;const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});assertOk(issue.ok,"provider fixture Invoice issues");const payments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));const beginId=`provider-begin-${x}`,begin=await payments.beginProviderOperation(ctx(beginId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});assertOk(begin,"provider payment operation begins uncertain");const confirmId=`provider-confirm-${x}`,confirmInput={organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-event-${x}`,providerTransactionId:`fixture-transaction-${x}`,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(confirmId)};const first=await payments.confirmProviderPayment(ctx(confirmId,["payment.record"]),confirmInput);assertOk(first,"first provider confirmation materializes Payment");const replay=await payments.confirmProviderPayment(ctx(confirmId,["payment.record"]),confirmInput);assertOk(replay,"same provider confirmation replays");assert.equal(replay.value.paymentId,first.value.paymentId,"repeated confirmation returns canonical Payment");assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one provider Payment exists");assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one provider allocation exists");assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice])).rows[0]!.n,"20000","provider payment effect is exactly 200 dollars");assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND resource_type='payment' AND resource_id=$2 AND event_type='provider_payment_succeeded'",[org,first.value.paymentId]),1,"one provider Payment Audit exists");assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND aggregate_type='payment' AND aggregate_id=$2 AND event_type='billing.provider_payment_succeeded.v1'",[org,first.value.paymentId]),1,"one provider Payment outbox event exists");assert.equal((await c.query<{total_cents:string}>("SELECT total_cents FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2",[org,invoice])).rows[0]!.total_cents,"50000","issued Invoice financial truth remains unchanged");console.log("[m3.5a] Provider duplicate confirmation proof passed (56 assertions total).");}finally{c.release();}}finally{await pool.end();}}
async function providerDistinctEventProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-distinct-event-proof"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-distinct-${x}`,user=`m3-provider-distinct-user-${x}`,customer=`m3-provider-distinct-customer-${x}`,product=`m3-provider-distinct-product-${x}`,type=`m3-provider-distinct-type-${x}`,order=`m3-provider-distinct-order-${x}`,invoice=`m3-provider-distinct-invoice-${x}`,line=`m3-provider-distinct-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider distinct events',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:901,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-distinct-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"distinct-event provider fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const payments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const beginId=`provider-distinct-begin-${x}`;
      const begin=await payments.beginProviderOperation(ctx(beginId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-distinct-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"one local provider operation begins uncertain");
      const transactionId=`fixture-distinct-transaction-${x}`;
      const firstId=`provider-distinct-confirm-one-${x}`;
      const first=await payments.confirmProviderPayment(ctx(firstId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-distinct-event-one-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(firstId)});
      assertOk(first,"first provider event materializes the canonical Payment");
      const secondId=`provider-distinct-confirm-two-${x}`;
      const second=await payments.confirmProviderPayment(ctx(secondId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-distinct-event-two-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(secondId)});
      assertOk(second,"a distinct provider event for the same transaction converges");
      assert.equal(second.value.paymentId,first.value.paymentId,"distinct provider events return one canonical Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),2,"both distinct provider events are retained as evidence");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"exactly one provider Payment exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"exactly one provider allocation exists");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice])).rows[0]!.n,"20000","provider effect is exactly 20000 cents");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND resource_type='payment' AND resource_id=$2 AND event_type='provider_payment_succeeded'",[org,first.value.paymentId]),1,"one provider-payment success Audit exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND aggregate_type='payment' AND aggregate_id=$2 AND event_type='billing.provider_payment_succeeded.v1'",[org,first.value.paymentId]),1,"one provider-payment success outbox event exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"issued checkpoint count remains unchanged");
      console.log("[m3.5a] Provider distinct-event confirmation proof passed (68 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerCallbackReconciliationRaceProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-callback-reconciliation-race"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-race-${x}`,user=`m3-provider-race-user-${x}`,customer=`m3-provider-race-customer-${x}`,product=`m3-provider-race-product-${x}`,type=`m3-provider-race-type-${x}`,order=`m3-provider-race-order-${x}`,invoice=`m3-provider-race-invoice-${x}`,line=`m3-provider-race-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider callback race',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:902,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-race-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"callback/reconciliation race fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const payments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const beginId=`provider-race-begin-${x}`;
      const begin=await payments.beginProviderOperation(ctx(beginId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-race-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"one unresolved provider Payment operation begins");
      const transactionId=`fixture-race-transaction-${x}`,occurredAt=new Date().toISOString();
      let callbackLocked!:()=>void,releaseCallback!:()=>void;
      const callbackLockReached=new Promise<void>(resolve=>{callbackLocked=resolve;});
      const releaseMaterialization=new Promise<void>(resolve=>{releaseCallback=resolve;});
      const callbackPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,{afterProviderOperationLock:async()=>{callbackLocked();await releaseMaterialization;}}));
      const callbackId=`provider-race-callback-${x}`;
      const callback=callbackPayments.confirmProviderPayment(ctx(callbackId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-race-callback-event-${x}`,providerTransactionId:transactionId,occurredAt,businessRequestId:brandedId<"BusinessRequestId">(callbackId)});
      await callbackLockReached;
      assert(true,"callback holds the provider operation lock before materialization");
      const store=new PostgresProviderPaymentReconciliationStore(pool);
      const reconciliationId=`provider-race-reconciliation-${x}`;
      const reconciler=new ProviderPaymentReconciler(new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool)),store,{retrieve:async()=>({kind:"succeeded" as const,providerEventId:`fixture-race-reconciliation-event-${x}`,providerTransactionId:transactionId,occurredAt})});
      const reconciliation=reconciler.reconcile(ctx(reconciliationId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(reconciliationId)});
      for(let i=0;i<500;i++){const waiting=await c.query<{n:string}>("SELECT count(*)::text n FROM pg_stat_activity WHERE application_name='m3-provider-callback-reconciliation-race' AND wait_event_type='Lock'");if(Number(waiting.rows[0]?.n??0)>0)break;if(i===499)throw Error("reconciliation did not reach a real PostgreSQL lock wait against the callback");await new Promise<void>(resolve=>setImmediate(resolve));}
      assert(true,"reconciliation reaches a real PostgreSQL lock wait while callback is uncommitted");
      releaseCallback();
      const [callbackResult,reconciliationResult]=await Promise.all([callback,reconciliation]);
      assertOk(callbackResult.ok,"callback confirmation succeeds after concurrent overlap");
      assertOk(reconciliationResult.ok&&reconciliationResult.value.state==="succeeded","reconciliation succeeds after concurrent overlap");
      assert.equal(reconciliationResult.value.paymentId,callbackResult.value.paymentId,"callback and reconciliation converge to one canonical Payment");
      const operation=(await c.query<{reconciliation_state:string;provider_transaction_id:string}>("SELECT reconciliation_state,provider_transaction_id FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
      assert.equal(`${operation.reconciliation_state}:${operation.provider_transaction_id}`,`succeeded:${transactionId}`,"provider operation resolves to the canonical transaction");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}),null,"reconciliation no longer reports the succeeded operation as outstanding");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"race creates exactly one canonical Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"race creates exactly one Payment allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice])).rows[0]!.n,"20000","race creates exactly 20000 allocated cents");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),2,"callback and reconciliation evidence are both retained");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND resource_type='payment' AND resource_id=$2 AND event_type='provider_payment_succeeded'",[org,callbackResult.value.paymentId]),1,"race creates one provider-payment-success Audit business fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND aggregate_type='payment' AND aggregate_id=$2 AND event_type='billing.provider_payment_succeeded.v1'",[org,callbackResult.value.paymentId]),1,"race creates one provider-payment-success business outbox fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"issued Invoice checkpoint remains unchanged during the race");
      console.log("[m3.5a] Provider callback/reconciliation race proof passed (84 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerTwoReconciliationWorkersRaceProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-two-reconciliation-workers-race"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-workers-${x}`,user=`m3-provider-workers-user-${x}`,customer=`m3-provider-workers-customer-${x}`,product=`m3-provider-workers-product-${x}`,type=`m3-provider-workers-type-${x}`,order=`m3-provider-workers-order-${x}`,invoice=`m3-provider-workers-invoice-${x}`,line=`m3-provider-workers-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider reconciliation workers',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:903,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-workers-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"two-worker reconciliation fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const payments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const beginId=`provider-workers-begin-${x}`;
      const begin=await payments.beginProviderOperation(ctx(beginId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-workers-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"one unresolved provider Payment operation begins for both workers");
      const transactionId=`fixture-workers-transaction-${x}`,occurredAt=new Date().toISOString();
      let workerALocked!:()=>void,releaseWorkerA!:()=>void,bothSuccesses!:()=>void,successObservations=0;
      const workerALockReached=new Promise<void>(resolve=>{workerALocked=resolve;});
      const releaseMaterialization=new Promise<void>(resolve=>{releaseWorkerA=resolve;});
      const bothObservedSuccess=new Promise<void>(resolve=>{bothSuccesses=resolve;});
      const provider={retrieve:async()=>{successObservations+=1;if(successObservations===2)bothSuccesses();return {kind:"succeeded" as const,providerEventId:`fixture-workers-success-event-${x}`,providerTransactionId:transactionId,occurredAt};}};
      const store=new PostgresProviderPaymentReconciliationStore(pool);
      const workerAPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,{afterProviderOperationLock:async()=>{workerALocked();await releaseMaterialization;}}));
      const workerAId=`provider-workers-a-${x}`;
      const workerA=new ProviderPaymentReconciler(workerAPayments,store,provider).reconcile(ctx(workerAId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(workerAId)});
      await workerALockReached;
      assert(true,"worker A holds canonical financial locks before Payment materialization");
      const workerBId=`provider-workers-b-${x}`;
      const workerB=new ProviderPaymentReconciler(new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool)),store,provider).reconcile(ctx(workerBId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),providerOperationId:begin.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(workerBId)});
      await bothObservedSuccess;
      assert.equal(successObservations,2,"both reconciliation workers independently observe provider SUCCESS");
      for(let i=0;i<500;i++){const waiting=await c.query<{n:string}>("SELECT count(*)::text n FROM pg_stat_activity WHERE application_name='m3-provider-two-reconciliation-workers-race' AND wait_event_type='Lock'");if(Number(waiting.rows[0]?.n??0)>0)break;if(i===499)throw Error("second reconciliation worker did not reach a real PostgreSQL lock wait");await new Promise<void>(resolve=>setImmediate(resolve));}
      assert(true,"worker B reaches a real PostgreSQL lock wait while worker A is uncommitted");
      releaseWorkerA();
      const [workerAResult,workerBResult]=await Promise.all([workerA,workerB]);
      assertOk(workerAResult.ok&&workerAResult.value.state==="succeeded","worker A reconciles successfully");
      assertOk(workerBResult.ok&&workerBResult.value.state==="succeeded","worker B reconciles successfully after waiting");
      assert.equal(workerAResult.value.paymentId,workerBResult.value.paymentId,"both reconciliation workers converge to one canonical Payment");
      const operation=(await c.query<{reconciliation_state:string;provider_transaction_id:string}>("SELECT reconciliation_state,provider_transaction_id FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
      assert.equal(`${operation.reconciliation_state}:${operation.provider_transaction_id}`,`succeeded:${transactionId}`,"provider operation resolves exactly once to the shared provider transaction");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}),null,"resolved provider operation is no longer outstanding for either worker");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"two workers create exactly one canonical Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"two workers create exactly one Payment allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice])).rows[0]!.n,"20000","two workers allocate exactly 20000 cents once");
      const settlement=(await c.query<{paid:string;balance:string}>("SELECT COALESCE(sum(amount_cents),0)::text paid,(50000-COALESCE(sum(amount_cents),0))::text balance FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice])).rows[0]!;
      assert.equal(`${settlement.paid}:${settlement.balance}`,"20000:30000","settlement reflects one 20000-cent Payment and a 30000-cent collectible balance");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,"same provider success evidence remains one technical event");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND resource_type='payment' AND resource_id=$2 AND event_type='provider_payment_succeeded'",[org,workerAResult.value.paymentId]),1,"two workers create one provider-payment-success Audit business fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND aggregate_type='payment' AND aggregate_id=$2 AND event_type='billing.provider_payment_succeeded.v1'",[org,workerAResult.value.paymentId]),1,"two workers create one provider-payment-success business outbox fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"issued Invoice checkpoint remains unchanged during worker race");
      console.log("[m3.5a] Two reconciliation workers race proof passed (102 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerAmbiguousRecoveryProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-ambiguous-recovery"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-ambiguous-${x}`,user=`m3-provider-ambiguous-user-${x}`,customer=`m3-provider-ambiguous-customer-${x}`,product=`m3-provider-ambiguous-product-${x}`,type=`m3-provider-ambiguous-type-${x}`,orderA=`m3-provider-ambiguous-order-a-${x}`,invoiceA=`m3-provider-ambiguous-invoice-a-${x}`,lineA=`m3-provider-ambiguous-line-a-${x}`,orderC=`m3-provider-ambiguous-order-c-${x}`,invoiceC=`m3-provider-ambiguous-invoice-c-${x}`,lineC=`m3-provider-ambiguous-line-c-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider ambiguous recovery',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order:orderA,invoice:invoiceA,line:lineA,number:904,quantity:5,unit:10000});
      await seed(c,{org,customer,product,order:orderC,invoice:invoiceC,line:lineC,number:905,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueAId=`provider-ambiguous-issue-a-${x}`,issueCId=`provider-ambiguous-issue-c-${x}`;
      const [issueA,issueC]=await Promise.all([
        issued.issueInvoice(ctx(issueAId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),businessRequestId:brandedId<"BusinessRequestId">(issueAId)}),
        issued.issueInvoice(ctx(issueCId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),businessRequestId:brandedId<"BusinessRequestId">(issueCId)})
      ]);
      assertOk(issueA.ok,"UNKNOWN/SUCCESS fixture Invoice issues");
      assertOk(issueC.ok,"FAILED fixture Invoice issues");
      const checkpointsA=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),checkpointsC=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]);
      const payments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool)),store=new PostgresProviderPaymentReconciliationStore(pool);
      const beginAId=`provider-ambiguous-begin-a-${x}`;
      const beginA=await payments.beginProviderOperation(ctx(beginAId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-ambiguous-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginAId)});
      assertOk(beginA,"ambiguous provider Payment operation begins once");
      let unknownObservations=0;
      const unknownReconciler=new ProviderPaymentReconciler(payments,store,{retrieve:async()=>{unknownObservations+=1;return {kind:"unknown" as const};}});
      const unknownOneId=`provider-ambiguous-unknown-one-${x}`,unknownTwoId=`provider-ambiguous-unknown-two-${x}`;
      const unknownOne=await unknownReconciler.reconcile(ctx(unknownOneId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),providerOperationId:beginA.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(unknownOneId)});
      const unknownTwo=await unknownReconciler.reconcile(ctx(unknownTwoId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),providerOperationId:beginA.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(unknownTwoId)});
      assertOk(unknownOne.ok&&unknownOne.value.state==="unknown","first UNKNOWN remains non-terminal");
      assertOk(unknownTwo.ok&&unknownTwo.value.state==="unknown","repeated UNKNOWN remains non-terminal");
      assert.equal(unknownObservations,2,"both UNKNOWN reconciliations query the original provider operation");
      assert.equal((await c.query<{state:string}>("SELECT reconciliation_state state FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginA.value.providerOperationId])).rows[0]!.state,"uncertain","UNKNOWN does not fabricate success or failure");
      assert.equal((await store.unresolved({organizationId:org,providerOperationId:beginA.value.providerOperationId}))?.invoiceId,invoiceA,"UNKNOWN remains eligible for retry");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"UNKNOWN does not create a second provider Payment operation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginA.value.providerOperationId]),0,"UNKNOWN creates no canonical Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),0,"UNKNOWN creates no Payment allocation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_payment_succeeded' AND resource_id IN (SELECT id FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceA]),0,"UNKNOWN creates no provider-payment-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_payment_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceA]),0,"UNKNOWN creates no provider-payment-success outbox fact");
      assert.equal((await c.query<{balance:string}>("SELECT (50000-COALESCE(sum(amount_cents),0))::text balance FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA])).rows[0]!.balance,"50000","UNKNOWN leaves the full collectible balance");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),checkpointsA,"UNKNOWN leaves the issued checkpoint unchanged");
      const successId=`provider-ambiguous-success-${x}`,transactionId=`fixture-ambiguous-transaction-${x}`;
      const recovered=await new ProviderPaymentReconciler(payments,store,{retrieve:async()=>({kind:"succeeded" as const,providerEventId:`fixture-ambiguous-event-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString()})}).reconcile(ctx(successId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),providerOperationId:beginA.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(successId)});
      assertOk(recovered.ok&&recovered.value.state==="succeeded","UNKNOWN operation later recovers through SUCCESS");
      const recoveredOperation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginA.value.providerOperationId])).rows[0]!;
      assert.equal(`${recoveredOperation.state}:${recoveredOperation.transaction}`,`succeeded:${transactionId}`,"same provider operation resolves to SUCCESS");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:beginA.value.providerOperationId}),null,"SUCCESS removes the recovered operation from reconciliation outstanding");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"recovery does not submit a second provider Payment operation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginA.value.providerOperationId]),1,"UNKNOWN then SUCCESS creates one canonical Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"UNKNOWN then SUCCESS creates one Payment allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA])).rows[0]!.n,"20000","UNKNOWN then SUCCESS allocates exactly 20000 cents");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_payment_succeeded' AND resource_id=$2",[org,recovered.value.paymentId]),1,"UNKNOWN then SUCCESS creates one success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_payment_succeeded.v1' AND aggregate_id=$2",[org,recovered.value.paymentId]),1,"UNKNOWN then SUCCESS creates one success outbox fact");
      assert.equal((await c.query<{balance:string}>("SELECT (50000-COALESCE(sum(amount_cents),0))::text balance FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA])).rows[0]!.balance,"30000","SUCCESS changes settlement exactly once after UNKNOWN");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),checkpointsA,"recovery leaves the issued checkpoint unchanged");
      const beginCId=`provider-ambiguous-begin-c-${x}`;
      const beginC=await payments.beginProviderOperation(ctx(beginCId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-ambiguous-failed-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginCId)});
      assertOk(beginC,"separate ambiguous provider Payment operation begins for FAILED");
      const failedId=`provider-ambiguous-failed-${x}`;
      const failed=await new ProviderPaymentReconciler(payments,store,{retrieve:async()=>({kind:"failed" as const})}).reconcile(ctx(failedId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),providerOperationId:beginC.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(failedId)});
      assertOk(failed.ok&&failed.value.state==="failed","definitive FAILED resolves without a Payment");
      assert.equal((await c.query<{state:string}>("SELECT reconciliation_state state FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginC.value.providerOperationId])).rows[0]!.state,"failed","FAILED records the truthful terminal provider state");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:beginC.value.providerOperationId}),null,"FAILED is no longer falsely outstanding");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]),1,"FAILED does not create a second provider Payment operation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginC.value.providerOperationId]),0,"FAILED creates no successful Payment fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]),0,"FAILED creates no Payment allocation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_payment_succeeded' AND resource_id IN (SELECT id FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceC]),0,"FAILED creates no provider-payment-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_payment_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceC]),0,"FAILED creates no provider-payment-success outbox fact");
      assert.equal((await c.query<{balance:string}>("SELECT (50000-COALESCE(sum(amount_cents),0))::text balance FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC])).rows[0]!.balance,"50000","FAILED leaves settlement unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]),checkpointsC,"FAILED leaves the issued checkpoint unchanged");
      console.log("[m3.5a] Ambiguous provider Payment recovery proof passed (139 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerConfirmationRollbackProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-confirmation-rollback"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-rollback-${x}`,user=`m3-provider-rollback-user-${x}`,customer=`m3-provider-rollback-customer-${x}`,product=`m3-provider-rollback-product-${x}`,type=`m3-provider-rollback-type-${x}`,stages=["payment","allocation","audit","outbox"] as const;
      const fixtures=stages.map((stage,index)=>({stage,order:`m3-provider-rollback-order-${stage}-${x}`,invoice:`m3-provider-rollback-invoice-${stage}-${x}`,line:`m3-provider-rollback-line-${stage}-${x}`,number:906+index}));
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider confirmation rollback',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      for(const fixture of fixtures)await seed(c,{org,customer,product,...fixture,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      for(const fixture of fixtures){
        const issueId=`provider-rollback-issue-${fixture.stage}-${x}`;
        const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
        assertOk(issue.ok,`${fixture.stage} rollback fixture Invoice issues`);
        const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]);
        const normalPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
        const beginId=`provider-rollback-begin-${fixture.stage}-${x}`;
        const begin=await normalPayments.beginProviderOperation(ctx(beginId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),kind:"payment",amount:money(currencyCode("USD"),20000),provider:"fixture_provider",providerIdempotencyKey:`fixture-rollback-key-${fixture.stage}-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
        assertOk(begin,`${fixture.stage} provider Payment operation begins uncertain`);
        const fail=async()=>{throw Error(`injected provider confirmation ${fixture.stage} rollback`);};
        const hooks:BillingFinancialPersistenceTestHooks=fixture.stage==="payment"?{afterProviderPaymentMaterialized:fail}:fixture.stage==="allocation"?{afterProviderPaymentAllocation:fail}:fixture.stage==="audit"?{afterAudit:fail}:{afterOutbox:fail};
        const failingPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,hooks));
        const confirmId=`provider-rollback-confirm-${fixture.stage}-${x}`,transactionId=`fixture-rollback-transaction-${fixture.stage}-${x}`;
        const confirmation={organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-rollback-event-${fixture.stage}-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(confirmId)};
        const failed=await failingPayments.confirmProviderPayment(ctx(confirmId,["payment.record"]),confirmation);
        assert(!failed.ok,`${fixture.stage} injected provider confirmation fails`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),0,`${fixture.stage} rollback leaves no Payment`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),0,`${fixture.stage} rollback leaves no allocation`);
        assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice])).rows[0]!.n,"0",`${fixture.stage} rollback leaves zero allocated cents`);
        assert.equal((await c.query<{balance:string}>("SELECT (50000-COALESCE(sum(amount_cents),0))::text balance FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice])).rows[0]!.balance,"50000",`${fixture.stage} rollback preserves collectible balance`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_payment_succeeded' AND resource_id IN (SELECT id FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2)",[org,fixture.invoice]),0,`${fixture.stage} rollback leaves no success Audit`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_payment_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2)",[org,fixture.invoice]),0,`${fixture.stage} rollback leaves no success outbox fact`);
        const rolledBackOperation=(await c.query<{state:string;transaction:string|null}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
        assert.equal(`${rolledBackOperation.state}:${rolledBackOperation.transaction??"none"}`,"uncertain:none",`${fixture.stage} rollback leaves reconciliation truthful and unresolved`);
        assert.equal((await new PostgresProviderPaymentReconciliationStore(pool).unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}))?.invoiceId,fixture.invoice,`${fixture.stage} rollback remains retryable`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2 AND operation='billing.provider.payment.confirm.v1'",[org,confirmId]),0,`${fixture.stage} rollback leaves no false M0 completion`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),checkpointsBefore,`${fixture.stage} rollback leaves issued checkpoint unchanged`);
        const retried=await normalPayments.confirmProviderPayment(ctx(confirmId,["payment.record"]),confirmation);
        assertOk(retried.ok,`${fixture.stage} same legitimate confirmation retries successfully`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,`${fixture.stage} retry creates one Payment`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),1,`${fixture.stage} retry creates one allocation`);
        assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice])).rows[0]!.n,"20000",`${fixture.stage} retry allocates exactly 20000 cents`);
        assert.equal((await c.query<{balance:string}>("SELECT (50000-COALESCE(sum(amount_cents),0))::text balance FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice])).rows[0]!.balance,"30000",`${fixture.stage} retry derives the correct collectible balance`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_payment_succeeded' AND resource_id=$2",[org,retried.value.paymentId]),1,`${fixture.stage} retry creates one success Audit`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_payment_succeeded.v1' AND aggregate_id=$2",[org,retried.value.paymentId]),1,`${fixture.stage} retry creates one success outbox fact`);
        const completedOperation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
        assert.equal(`${completedOperation.state}:${completedOperation.transaction}`,`succeeded:${transactionId}`,`${fixture.stage} retry resolves the provider operation once`);
        assert.equal(await new PostgresProviderPaymentReconciliationStore(pool).unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}),null,`${fixture.stage} retry clears reconciliation outstanding`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2 AND operation='billing.provider.payment.confirm.v1' AND status='succeeded'",[org,confirmId]),1,`${fixture.stage} retry creates one truthful M0 completion`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),checkpointsBefore,`${fixture.stage} retry leaves issued checkpoint unchanged`);
      }
      console.log("[m3.5a] Provider confirmation rollback proof passed (235 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundConfirmationProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refund-confirmation"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-${x}`,user=`m3-provider-refund-user-${x}`,customer=`m3-provider-refund-customer-${x}`,product=`m3-provider-refund-product-${x}`,type=`m3-provider-refund-type-${x}`,order=`m3-provider-refund-order-${x}`,invoice=`m3-provider-refund-invoice-${x}`,line=`m3-provider-refund-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:910,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-refund-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"provider Refund fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const paymentId=`provider-refund-payment-${x}`;
      const payment=await finance.recordManualPayment(ctx(paymentId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentId)});
      assertOk(payment.ok,"original canonical Payment settles the issued Invoice");
      const originalBefore=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalBefore.id}:${originalBefore.amount_cents}`,`${payment.value.payment.paymentId}:50000`,"original Payment identity and amount are immutable before provider Refund confirmation");
      const beginId=`provider-refund-begin-${x}`;
      const begin=await finance.beginProviderOperation(ctx(beginId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"provider Refund operation begins against the original Payment");
      const transactionId=`fixture-refund-transaction-${x}`,confirmOneId=`provider-refund-confirm-one-${x}`;
      const first=await finance.confirmProviderRefund(ctx(confirmOneId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-refund-event-one-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(confirmOneId)});
      if(!first.ok)throw Error(`first provider Refund confirmation failed: ${first.error.message}`);
      const confirmTwoId=`provider-refund-confirm-two-${x}`;
      const second=await finance.confirmProviderRefund(ctx(confirmTwoId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-refund-event-two-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(confirmTwoId)});
      if(!second.ok)throw Error(`repeated provider Refund confirmation failed: ${second.error.message}`);
      assert.equal(second.value.refundId,first.value.refundId,"repeated provider Refund confirmation returns the canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one original Payment remains");
      const originalAfter=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalAfter.id}:${originalAfter.amount_cents}`,`${originalBefore.id}:${originalBefore.amount_cents}`,"provider Refund never rewrites the original Payment fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,"one canonical provider Refund exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND refund_id=$2 AND payment_id=$3",[org,first.value.refundId,payment.value.payment.paymentId]),1,"one correct Refund allocation exists");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"10000","refunded cents are exactly 10000");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"40000","net retained original Payment value is exactly 40000 cents");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2",[org,invoice])).rows[0]!.n,"50000","original Payment allocation remains 50000 cents");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,first.value.refundId]),1,"one provider-refund-success Audit exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,first.value.refundId]),1,"one provider-refund-success business outbox fact exists");
      const resolvedOperation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
      assert.equal(`${resolvedOperation.state}:${resolvedOperation.transaction}`,`succeeded:${transactionId}`,"provider Refund operation resolves truthfully");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds r JOIN v2_operation_requests o ON o.organization_id=r.organization_id AND o.id=r.operation_request_id WHERE r.organization_id=$1 AND r.id=$2 AND o.operation='billing.provider.refund.confirm.v1' AND o.business_request_id=$3 AND o.status='succeeded'",[org,first.value.refundId,confirmOneId]),1,"one materializing M0 completion represents the canonical Refund fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND operation='billing.provider.refund.confirm.v1' AND result_resource_type='refund' AND result_resource_id=$2 AND status='succeeded'",[org,first.value.refundId]),2,"both confirmation receipts converge to one canonical M0 result resource");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"provider Refund leaves the issued Invoice checkpoint unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),2,"both provider Refund evidence receipts are retained without duplicate financial effect");
      console.log("[m3.5b] Provider Refund confirmation proof passed (256 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundDistinctEventsProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refund-distinct-events"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-events-${x}`,user=`m3-provider-refund-events-user-${x}`,customer=`m3-provider-refund-events-customer-${x}`,product=`m3-provider-refund-events-product-${x}`,type=`m3-provider-refund-events-type-${x}`,order=`m3-provider-refund-events-order-${x}`,invoice=`m3-provider-refund-events-invoice-${x}`,line=`m3-provider-refund-events-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund events',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:911,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-refund-events-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"distinct-event provider Refund fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const paymentId=`provider-refund-events-payment-${x}`;
      const payment=await finance.recordManualPayment(ctx(paymentId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentId)});
      assertOk(payment.ok,"original 50000-cent Payment exists before provider Refund events");
      const originalBefore=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      const beginId=`provider-refund-events-begin-${x}`;
      const begin=await finance.beginProviderOperation(ctx(beginId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-events-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"one provider Refund operation begins for both events");
      const transactionId="REFUND-TX-ABC",firstId=`provider-refund-events-one-${x}`;
      const first=await finance.confirmProviderRefund(ctx(firstId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,providerEventId:"EVT-REFUND-001",providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(firstId)});
      if(!first.ok)throw Error(`first distinct provider Refund event failed: ${first.error.message}`);
      assert(true,"EVT-REFUND-001 materializes the canonical Refund");
      const secondId=`provider-refund-events-two-${x}`;
      const second=await finance.confirmProviderRefund(ctx(secondId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,providerEventId:"EVT-REFUND-002",providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(secondId)});
      if(!second.ok)throw Error(`second distinct provider Refund event failed: ${second.error.message}`);
      assert(true,"EVT-REFUND-002 reaches canonical Refund convergence with the shared transaction");
      assert.equal(second.value.refundId,first.value.refundId,"distinct provider Refund events return one canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one original Payment remains after both events");
      const originalAfter=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalAfter.id}:${originalAfter.amount_cents}`,`${originalBefore.id}:50000`,"distinct Refund events do not mutate the original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,"two events create one canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND refund_id=$2 AND payment_id=$3",[org,first.value.refundId,payment.value.payment.paymentId]),1,"two events create one Refund allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"10000","two events refund exactly 10000 cents once");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"40000","two events retain exactly 40000 cents of the original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,first.value.refundId]),1,"two events create one provider-refund-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,first.value.refundId]),1,"two events create one provider-refund-success outbox fact");
      const operation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
      assert.equal(`${operation.state}:${operation.transaction}`,"succeeded:REFUND-TX-ABC","provider Refund operation resolves one shared transaction identity");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND operation='billing.provider.refund.confirm.v1' AND result_resource_type='refund' AND result_resource_id=$2 AND status='succeeded'",[org,first.value.refundId]),2,"two distinct M0 receipts represent one canonical Refund resource");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"distinct Refund events leave the issued Invoice checkpoint unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),2,"both distinct provider Refund events remain durable evidence");
      console.log("[m3.5b] Distinct provider Refund events proof passed (274 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundCallbackReconciliationRaceProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refund-callback-reconciliation-race"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-race-${x}`,user=`m3-provider-refund-race-user-${x}`,customer=`m3-provider-refund-race-customer-${x}`,product=`m3-provider-refund-race-product-${x}`,type=`m3-provider-refund-race-type-${x}`,order=`m3-provider-refund-race-order-${x}`,invoice=`m3-provider-refund-race-invoice-${x}`,line=`m3-provider-refund-race-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund race',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:912,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-refund-race-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"callback/reconciliation provider Refund fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const paymentId=`provider-refund-race-payment-${x}`;
      const payment=await finance.recordManualPayment(ctx(paymentId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentId)});
      assertOk(payment.ok,"original canonical Payment exists before Refund race");
      const originalBefore=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalBefore.id}:${originalBefore.amount_cents}`,`${payment.value.payment.paymentId}:50000`,`original Payment is immutable before Refund race`);
      const beginId=`provider-refund-race-begin-${x}`;
      const begin=await finance.beginProviderOperation(ctx(beginId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-race-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"unresolved provider Refund operation begins");
      const transactionId=`fixture-refund-race-transaction-${x}`,occurredAt=new Date().toISOString();
      let callbackLocked!:()=>void,releaseCallback!:()=>void;
      const callbackLockReached=new Promise<void>(resolve=>{callbackLocked=resolve;}),releaseMaterialization=new Promise<void>(resolve=>{releaseCallback=resolve;});
      const callbackFinance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,{afterProviderRefundOperationLock:async()=>{callbackLocked();await releaseMaterialization;}}));
      const callbackId=`provider-refund-race-callback-${x}`;
      const callback=callbackFinance.confirmProviderRefund(ctx(callbackId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-refund-race-callback-event-${x}`,providerTransactionId:transactionId,occurredAt,businessRequestId:brandedId<"BusinessRequestId">(callbackId)});
      await callbackLockReached;
      assert(true,"callback holds Refund financial locks before canonical materialization");
      const store=new PostgresProviderRefundReconciliationStore(pool),reconciliationId=`provider-refund-race-reconciliation-${x}`;
      const reconciler=new ProviderRefundReconciler(new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool)),store,{retrieve:async()=>({kind:"succeeded" as const,providerEventId:`fixture-refund-race-reconciliation-event-${x}`,providerTransactionId:transactionId,occurredAt})});
      const reconciliation=reconciler.reconcile(ctx(reconciliationId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(reconciliationId)});
      for(let i=0;i<500;i++){const waiting=await c.query<{n:string}>("SELECT count(*)::text n FROM pg_stat_activity WHERE application_name='m3-provider-refund-callback-reconciliation-race' AND wait_event_type='Lock'");if(Number(waiting.rows[0]?.n??0)>0)break;if(i===499)throw Error("Refund reconciliation did not reach a real PostgreSQL lock wait against the callback");await new Promise<void>(resolve=>setImmediate(resolve));}
      assert(true,"Refund reconciliation reaches a real PostgreSQL lock wait while callback is uncommitted");
      releaseCallback();
      const [callbackResult,reconciliationResult]=await Promise.all([callback,reconciliation]);
      if(!callbackResult.ok)throw Error(`Refund callback failed: ${callbackResult.error.message}`);
      if(!reconciliationResult.ok||reconciliationResult.value.state!=="succeeded")throw Error("Refund reconciliation did not succeed after concurrent overlap");
      assert(true,"callback succeeds after concurrent overlap");
      assert(true,"reconciliation succeeds after concurrent overlap");
      assert.equal(reconciliationResult.value.refundId,callbackResult.value.refundId,"callback and reconciliation converge to one canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one original Payment remains after Refund race");
      const originalAfter=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalAfter.id}:${originalAfter.amount_cents}`,`${originalBefore.id}:${originalBefore.amount_cents}`,"Refund race never mutates original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,"race creates one canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND refund_id=$2 AND payment_id=$3",[org,callbackResult.value.refundId,payment.value.payment.paymentId]),1,"race creates one Refund allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"10000","race refunds exactly 10000 cents once");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"40000","race retains exactly 40000 cents of original Payment value");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,callbackResult.value.refundId]),1,"race creates one provider-refund-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,callbackResult.value.refundId]),1,"race creates one provider-refund-success outbox fact");
      const operation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
      assert.equal(`${operation.state}:${operation.transaction}`,`succeeded:${transactionId}`,"provider Refund operation resolves coherently");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}),null,"Refund reconciliation is no longer outstanding");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"Refund race leaves issued Invoice checkpoint unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),2,"callback and reconciliation evidence are both retained");
      console.log("[m3.5b] Provider Refund callback/reconciliation race proof passed (295 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundTwoReconciliationWorkersRaceProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refund-two-reconciliation-workers-race"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-workers-${x}`,user=`m3-provider-refund-workers-user-${x}`,customer=`m3-provider-refund-workers-customer-${x}`,product=`m3-provider-refund-workers-product-${x}`,type=`m3-provider-refund-workers-type-${x}`,order=`m3-provider-refund-workers-order-${x}`,invoice=`m3-provider-refund-workers-invoice-${x}`,line=`m3-provider-refund-workers-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund workers',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:913,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-refund-workers-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"two-worker provider Refund fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const paymentId=`provider-refund-workers-payment-${x}`;
      const payment=await finance.recordManualPayment(ctx(paymentId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentId)});
      assertOk(payment.ok,"original canonical Payment exists before Refund worker race");
      const originalBefore=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalBefore.id}:${originalBefore.amount_cents}`,`${payment.value.payment.paymentId}:50000`,"original Payment is immutable before two-worker Refund race");
      const beginId=`provider-refund-workers-begin-${x}`;
      const begin=await finance.beginProviderOperation(ctx(beginId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-workers-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
      assertOk(begin,"one unresolved provider Refund operation begins for both workers");
      const transactionId=`fixture-refund-workers-transaction-${x}`,occurredAt=new Date().toISOString();
      let workerALocked!:()=>void,releaseWorkerA!:()=>void,bothSuccesses!:()=>void,successObservations=0;
      const workerALockReached=new Promise<void>(resolve=>{workerALocked=resolve;}),releaseMaterialization=new Promise<void>(resolve=>{releaseWorkerA=resolve;}),bothObservedSuccess=new Promise<void>(resolve=>{bothSuccesses=resolve;});
      const provider={retrieve:async()=>{successObservations+=1;if(successObservations===2)bothSuccesses();return {kind:"succeeded" as const,providerEventId:`fixture-refund-workers-success-event-${x}`,providerTransactionId:transactionId,occurredAt};}};
      const store=new PostgresProviderRefundReconciliationStore(pool);
      const workerAPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,{afterProviderRefundOperationLock:async()=>{workerALocked();await releaseMaterialization;}}));
      const workerAId=`provider-refund-workers-a-${x}`;
      const workerA=new ProviderRefundReconciler(workerAPayments,store,provider).reconcile(ctx(workerAId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(workerAId)});
      await workerALockReached;
      assert(true,"worker A holds canonical Refund financial locks before materialization");
      const workerBId=`provider-refund-workers-b-${x}`;
      const workerB=new ProviderRefundReconciler(new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool)),store,provider).reconcile(ctx(workerBId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(workerBId)});
      await bothObservedSuccess;
      assert.equal(successObservations,2,"both Refund reconciliation workers independently observe provider SUCCESS");
      for(let i=0;i<500;i++){const waiting=await c.query<{n:string}>("SELECT count(*)::text n FROM pg_stat_activity WHERE application_name='m3-provider-refund-two-reconciliation-workers-race' AND wait_event_type='Lock'");if(Number(waiting.rows[0]?.n??0)>0)break;if(i===499)throw Error("second Refund reconciliation worker did not reach a real PostgreSQL lock wait");await new Promise<void>(resolve=>setImmediate(resolve));}
      assert(true,"worker B reaches a real PostgreSQL lock wait while worker A is uncommitted");
      releaseWorkerA();
      const [workerAResult,workerBResult]=await Promise.all([workerA,workerB]);
      if(!workerAResult.ok||workerAResult.value.state!=="succeeded")throw Error("Refund worker A did not reconcile successfully");
      if(!workerBResult.ok||workerBResult.value.state!=="succeeded")throw Error("Refund worker B did not reconcile successfully after waiting");
      assert(true,"worker A reconciles successfully");
      assert(true,"worker B reconciles successfully after waiting");
      assert.equal(workerAResult.value.refundId,workerBResult.value.refundId,"both Refund reconciliation workers converge to one canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one original Payment remains after worker race");
      const originalAfter=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalAfter.id}:${originalAfter.amount_cents}`,`${originalBefore.id}:${originalBefore.amount_cents}`,"two Refund workers never mutate original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,"two workers create one canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND refund_id=$2 AND payment_id=$3",[org,workerAResult.value.refundId,payment.value.payment.paymentId]),1,"two workers create one Refund allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"10000","two workers refund exactly 10000 cents once");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"40000","two workers retain exactly 40000 cents of original Payment value");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,workerAResult.value.refundId]),1,"two workers create one provider-refund-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,workerAResult.value.refundId]),1,"two workers create one provider-refund-success outbox fact");
      const operation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
      assert.equal(`${operation.state}:${operation.transaction}`,`succeeded:${transactionId}`,"provider Refund operation resolves exactly once to the shared transaction");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}),null,"resolved Refund operation is no longer outstanding for either worker");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"two-worker Refund race leaves issued checkpoint unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,"same provider success evidence remains one technical event");
      console.log("[m3.5b] Two Refund reconciliation workers race proof passed (317 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundAmbiguousRecoveryProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refund-ambiguous-recovery"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-ambiguous-${x}`,user=`m3-provider-refund-ambiguous-user-${x}`,customer=`m3-provider-refund-ambiguous-customer-${x}`,product=`m3-provider-refund-ambiguous-product-${x}`,type=`m3-provider-refund-ambiguous-type-${x}`,orderA=`m3-provider-refund-ambiguous-order-a-${x}`,invoiceA=`m3-provider-refund-ambiguous-invoice-a-${x}`,lineA=`m3-provider-refund-ambiguous-line-a-${x}`,orderC=`m3-provider-refund-ambiguous-order-c-${x}`,invoiceC=`m3-provider-refund-ambiguous-invoice-c-${x}`,lineC=`m3-provider-refund-ambiguous-line-c-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund ambiguous recovery',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order:orderA,invoice:invoiceA,line:lineA,number:914,quantity:5,unit:10000});
      await seed(c,{org,customer,product,order:orderC,invoice:invoiceC,line:lineC,number:915,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueAId=`provider-refund-ambiguous-issue-a-${x}`,issueCId=`provider-refund-ambiguous-issue-c-${x}`;
      const [issueA,issueC]=await Promise.all([
        issued.issueInvoice(ctx(issueAId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),businessRequestId:brandedId<"BusinessRequestId">(issueAId)}),
        issued.issueInvoice(ctx(issueCId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),businessRequestId:brandedId<"BusinessRequestId">(issueCId)})
      ]);
      assertOk(issueA.ok,"UNKNOWN/SUCCESS provider Refund fixture Invoice issues");
      assertOk(issueC.ok,"FAILED provider Refund fixture Invoice issues");
      const checkpointsA=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),checkpointsC=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]);
      const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool)),store=new PostgresProviderRefundReconciliationStore(pool);
      const paymentAId=`provider-refund-ambiguous-payment-a-${x}`,paymentCId=`provider-refund-ambiguous-payment-c-${x}`;
      const paymentA=await finance.recordManualPayment(ctx(paymentAId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentAId)});
      const paymentC=await finance.recordManualPayment(ctx(paymentCId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentCId)});
      assertOk(paymentA.ok,"original 50000-cent Payment exists for UNKNOWN/SUCCESS recovery");
      assertOk(paymentC.ok,"original 50000-cent Payment exists for FAILED recovery");
      const originalA=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,paymentA.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalA.id}:${originalA.amount_cents}`,`${paymentA.value.payment.paymentId}:50000`,"original Payment is immutable before UNKNOWN recovery");
      const beginAId=`provider-refund-ambiguous-begin-a-${x}`;
      const beginA=await finance.beginProviderOperation(ctx(beginAId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),kind:"refund",paymentId:paymentA.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-ambiguous-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginAId)});
      assertOk(beginA,"ambiguous provider Refund operation begins once");
      let unknownObservations=0;
      const unknownReconciler=new ProviderRefundReconciler(finance,store,{retrieve:async()=>{unknownObservations+=1;return {kind:"unknown" as const};}});
      const unknownOneId=`provider-refund-ambiguous-unknown-one-${x}`,unknownTwoId=`provider-refund-ambiguous-unknown-two-${x}`;
      const unknownOne=await unknownReconciler.reconcile(ctx(unknownOneId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),paymentId:paymentA.value.payment.paymentId,providerOperationId:beginA.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(unknownOneId)});
      const unknownTwo=await unknownReconciler.reconcile(ctx(unknownTwoId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),paymentId:paymentA.value.payment.paymentId,providerOperationId:beginA.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(unknownTwoId)});
      assertOk(unknownOne.ok&&unknownOne.value.state==="unknown","first UNKNOWN remains non-terminal for provider Refund");
      assertOk(unknownTwo.ok&&unknownTwo.value.state==="unknown","repeated UNKNOWN remains non-terminal for provider Refund");
      assert.equal(unknownObservations,2,"repeated UNKNOWN queries the original provider Refund operation");
      assert.equal((await c.query<{state:string}>("SELECT reconciliation_state state FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginA.value.providerOperationId])).rows[0]!.state,"uncertain","UNKNOWN does not fabricate Refund success or failure");
      assert.equal((await store.unresolved({organizationId:org,providerOperationId:beginA.value.providerOperationId}))?.paymentId,paymentA.value.payment.paymentId,"UNKNOWN provider Refund remains eligible for retry");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"UNKNOWN does not create a second provider Refund operation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"UNKNOWN retains one original Payment");
      assert.equal((await c.query<{amount_cents:string}>("SELECT amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,paymentA.value.payment.paymentId])).rows[0]!.amount_cents,"50000","UNKNOWN never mutates the original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginA.value.providerOperationId]),0,"UNKNOWN creates no Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,paymentA.value.payment.paymentId]),0,"UNKNOWN creates no Refund allocation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceA]),0,"UNKNOWN creates no Refund-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceA]),0,"UNKNOWN creates no Refund-success outbox fact");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,paymentA.value.payment.paymentId])).rows[0]!.n,"50000","UNKNOWN leaves refundable value unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),checkpointsA,"UNKNOWN leaves issued Invoice checkpoint unchanged");
      const successId=`provider-refund-ambiguous-success-${x}`,transactionId=`fixture-refund-ambiguous-transaction-${x}`;
      const recovered=await new ProviderRefundReconciler(finance,store,{retrieve:async()=>({kind:"succeeded" as const,providerEventId:`fixture-refund-ambiguous-event-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString()})}).reconcile(ctx(successId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceA),paymentId:paymentA.value.payment.paymentId,providerOperationId:beginA.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(successId)});
      assertOk(recovered.ok&&recovered.value.state==="succeeded","UNKNOWN provider Refund later recovers through SUCCESS");
      const recoveredOperation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginA.value.providerOperationId])).rows[0]!;
      assert.equal(`${recoveredOperation.state}:${recoveredOperation.transaction}`,`succeeded:${transactionId}`,"same provider Refund operation resolves through SUCCESS");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:beginA.value.providerOperationId}),null,"SUCCESS removes the recovered Refund operation from outstanding reconciliation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"SUCCESS does not submit a second provider Refund operation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),1,"SUCCESS retains one original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginA.value.providerOperationId]),1,"UNKNOWN then SUCCESS creates one Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND refund_id=$2 AND payment_id=$3",[org,recovered.value.refundId,paymentA.value.payment.paymentId]),1,"UNKNOWN then SUCCESS creates one Refund allocation");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,paymentA.value.payment.paymentId])).rows[0]!.n,"10000","UNKNOWN then SUCCESS refunds exactly 10000 cents");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,paymentA.value.payment.paymentId])).rows[0]!.n,"40000","SUCCESS consumes refundable value exactly once after UNKNOWN");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,recovered.value.refundId]),1,"UNKNOWN then SUCCESS creates one Refund-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,recovered.value.refundId]),1,"UNKNOWN then SUCCESS creates one Refund-success outbox fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceA]),checkpointsA,"SUCCESS recovery leaves issued Invoice checkpoint unchanged");
      const beginCId=`provider-refund-ambiguous-begin-c-${x}`;
      const beginC=await finance.beginProviderOperation(ctx(beginCId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),kind:"refund",paymentId:paymentC.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-ambiguous-failed-key-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginCId)});
      assertOk(beginC,"separate ambiguous provider Refund operation begins for FAILED");
      const failedId=`provider-refund-ambiguous-failed-${x}`;
      const failed=await new ProviderRefundReconciler(finance,store,{retrieve:async()=>({kind:"failed" as const})}).reconcile(ctx(failedId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoiceC),paymentId:paymentC.value.payment.paymentId,providerOperationId:beginC.value.providerOperationId,businessRequestId:brandedId<"BusinessRequestId">(failedId)});
      assertOk(failed.ok&&failed.value.state==="failed","definitive FAILED resolves without a Refund");
      assert.equal((await c.query<{state:string}>("SELECT reconciliation_state state FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginC.value.providerOperationId])).rows[0]!.state,"failed","FAILED records the truthful terminal provider Refund state");
      assert.equal(await store.unresolved({organizationId:org,providerOperationId:beginC.value.providerOperationId}),null,"FAILED Refund is no longer falsely outstanding");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]),1,"FAILED does not create a second provider Refund operation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]),1,"FAILED retains the original Payment");
      assert.equal((await c.query<{amount_cents:string}>("SELECT amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,paymentC.value.payment.paymentId])).rows[0]!.amount_cents,"50000","FAILED never mutates original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginC.value.providerOperationId]),0,"FAILED creates no successful Refund fact");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,paymentC.value.payment.paymentId]),0,"FAILED creates no Refund allocation");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceC]),0,"FAILED creates no Refund-success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND invoice_id=$2)",[org,invoiceC]),0,"FAILED creates no Refund-success outbox fact");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,paymentC.value.payment.paymentId])).rows[0]!.n,"50000","FAILED leaves refundable value unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoiceC]),checkpointsC,"FAILED leaves issued Invoice checkpoint unchanged");
      console.log("[m3.5b] Ambiguous provider Refund recovery proof passed (362 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundableLimitRaceProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refundable-limit-race"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-limit-${x}`,user=`m3-provider-refund-limit-user-${x}`,customer=`m3-provider-refund-limit-customer-${x}`,product=`m3-provider-refund-limit-product-${x}`,type=`m3-provider-refund-limit-type-${x}`,order=`m3-provider-refund-limit-order-${x}`,invoice=`m3-provider-refund-limit-invoice-${x}`,line=`m3-provider-refund-limit-line-${x}`;
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund limit race',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      await seed(c,{org,customer,product,order,invoice,line,number:916,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      const issueId=`provider-refund-limit-issue-${x}`;
      const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
      assertOk(issue.ok,"refundable-limit race fixture Invoice issues");
      const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]);
      const finance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
      const paymentId=`provider-refund-limit-payment-${x}`;
      const payment=await finance.recordManualPayment(ctx(paymentId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentId)});
      assertOk(payment.ok,"original 50000-cent Payment exists before competing Refunds");
      const originalBefore=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalBefore.id}:${originalBefore.amount_cents}`,`${payment.value.payment.paymentId}:50000`,"original Payment is immutable before refundable-limit race");
      const beginAId=`provider-refund-limit-begin-a-${x}`,beginBId=`provider-refund-limit-begin-b-${x}`;
      const beginA=await finance.beginProviderOperation(ctx(beginAId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),40000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-limit-a-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginAId)});
      const beginB=await finance.beginProviderOperation(ctx(beginBId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),40000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-limit-b-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginBId)});
      assertOk(beginA,"first distinct 40000-cent provider Refund operation begins");
      assertOk(beginB,"second distinct 40000-cent provider Refund operation begins");
      let winnerLocked!:()=>void,releaseWinner!:()=>void;
      const winnerLockReached=new Promise<void>(resolve=>{winnerLocked=resolve;}),releaseMaterialization=new Promise<void>(resolve=>{releaseWinner=resolve;});
      const winnerFinance=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,{afterProviderRefundOperationLock:async()=>{winnerLocked();await releaseMaterialization;}}));
      const winnerId=`provider-refund-limit-confirm-a-${x}`,loserId=`provider-refund-limit-confirm-b-${x}`;
      const winner=winnerFinance.confirmProviderRefund(ctx(winnerId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:beginA.value.providerOperationId,providerEventId:`fixture-refund-limit-event-a-${x}`,providerTransactionId:`fixture-refund-limit-tx-a-${x}`,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(winnerId)});
      await winnerLockReached;
      assert(true,"Refund A holds the Invoice-first financial lock before evaluating refundable capacity");
      const loser=finance.confirmProviderRefund(ctx(loserId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(invoice),paymentId:payment.value.payment.paymentId,providerOperationId:beginB.value.providerOperationId,providerEventId:`fixture-refund-limit-event-b-${x}`,providerTransactionId:`fixture-refund-limit-tx-b-${x}`,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(loserId)});
      for(let i=0;i<500;i++){const waiting=await c.query<{n:string}>("SELECT count(*)::text n FROM pg_stat_activity WHERE application_name='m3-provider-refundable-limit-race' AND wait_event_type='Lock'");if(Number(waiting.rows[0]?.n??0)>0)break;if(i===499)throw Error("competing Refund did not reach a real PostgreSQL lock wait");await new Promise<void>(resolve=>setImmediate(resolve));}
      assert(true,"Refund B reaches a real PostgreSQL lock wait before it can observe refundable capacity");
      releaseWinner();
      const [winnerResult,loserResult]=await Promise.all([winner,loser]);
      if(!winnerResult.ok)throw Error(`winning Refund confirmation failed: ${winnerResult.error.message}`);
      assert(true,"first 40000-cent Refund succeeds");
      assert(!loserResult.ok,"second 40000-cent Refund conflicts after observing insufficient refundable value");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),1,"one original Payment remains after competing Refunds");
      const originalAfter=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
      assert.equal(`${originalAfter.id}:${originalAfter.amount_cents}`,`${originalBefore.id}:${originalBefore.amount_cents}`,"competing Refunds never mutate original Payment");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginA.value.providerOperationId]),1,"one winning canonical Refund exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginB.value.providerOperationId]),0,"losing Refund operation creates no canonical Refund");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId]),1,"one successful Refund allocation exists");
      assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"40000","successful Refund allocations total exactly 40000 cents");
      assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"10000","remaining refundable value is exactly 10000 cents");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,winnerResult.value.refundId]),1,"one Refund-success Audit exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,winnerResult.value.refundId]),1,"one Refund-success business outbox fact exists");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2)",[org,beginB.value.providerOperationId]),0,"losing Refund emits no success Audit");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2)",[org,beginB.value.providerOperationId]),0,"losing Refund emits no success outbox fact");
      const winnerOperation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginA.value.providerOperationId])).rows[0]!;
      const loserOperation=(await c.query<{state:string;transaction:string|null}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,beginB.value.providerOperationId])).rows[0]!;
      assert.equal(`${winnerOperation.state}:${winnerOperation.transaction}`,`succeeded:fixture-refund-limit-tx-a-${x}`,"winning Refund operation resolves truthfully");
      assert.equal(`${loserOperation.state}:${loserOperation.transaction??"none"}`,"uncertain:none","losing Refund operation remains unresolved rather than falsely successful");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND operation='billing.provider.refund.confirm.v1' AND business_request_id=$2",[org,loserId]),0,"losing Refund leaves no false M0 completion");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,invoice]),checkpointsBefore,"competing Refunds leave issued Invoice checkpoint unchanged");
      assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_provider_events WHERE organization_id=$1 AND provider_operation_id=$2",[org,beginA.value.providerOperationId]),1,"winning provider Refund evidence commits once");
      console.log("[m3.5b] Concurrent refundable-limit protection proof passed (387 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
async function providerRefundConfirmationRollbackProof(){
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m3-provider-refund-confirmation-rollback"});
  try{
    await migrate(drizzle({client:pool}),{migrationsFolder:folder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    const c=await pool.connect();
    try{
      const x=randomUUID(),org=`m3-provider-refund-rollback-${x}`,user=`m3-provider-refund-rollback-user-${x}`,customer=`m3-provider-refund-rollback-customer-${x}`,product=`m3-provider-refund-rollback-product-${x}`,type=`m3-provider-refund-rollback-type-${x}`,stages=["refund","allocation","audit","outbox"] as const;
      const fixtures=stages.map((stage,index)=>({stage,order:`m3-provider-refund-rollback-order-${stage}-${x}`,invoice:`m3-provider-refund-rollback-invoice-${stage}-${x}`,line:`m3-provider-refund-rollback-line-${stage}-${x}`,number:917+index}));
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Provider refund rollback',$1)",[org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Provider Customer','Provider Customer',true,'active')",[customer,org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Provider Type','no_route')",[type,org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Provider Product','Provider Product',true,'quantity_only',$3)",[product,org,type]);
      for(const fixture of fixtures)await seed(c,{org,customer,product,...fixture,quantity:5,unit:10000});
      await c.query("COMMIT");
      const ctx=(id:string,caps:readonly string[])=>context(org,user,id,caps);
      const issued=new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool));
      for(const fixture of fixtures){
        const issueId=`provider-refund-rollback-issue-${fixture.stage}-${x}`;
        const issue=await issued.issueInvoice(ctx(issueId,["invoice.view","invoice.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),businessRequestId:brandedId<"BusinessRequestId">(issueId)});
        assertOk(issue.ok,`${fixture.stage} rollback fixture Invoice issues`);
        const checkpointsBefore=await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]);
        const normalPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool));
        const paymentId=`provider-refund-rollback-payment-${fixture.stage}-${x}`;
        const payment=await normalPayments.recordManualPayment(ctx(paymentId,["payment.record"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),amount:money(currencyCode("USD"),50000),method:"check",occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(paymentId)});
        assertOk(payment.ok,`${fixture.stage} fixture has an original 50000-cent Payment`);
        const originalBefore=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
        assert.equal(`${originalBefore.id}:${originalBefore.amount_cents}`,`${payment.value.payment.paymentId}:50000`,`${fixture.stage} original Payment is immutable before failure injection`);
        const beginId=`provider-refund-rollback-begin-${fixture.stage}-${x}`;
        const begin=await normalPayments.beginProviderOperation(ctx(beginId,["refund.issue"]),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),kind:"refund",paymentId:payment.value.payment.paymentId,amount:money(currencyCode("USD"),10000),provider:"fixture_provider",providerIdempotencyKey:`fixture-refund-rollback-key-${fixture.stage}-${x}`,businessRequestId:brandedId<"BusinessRequestId">(beginId)});
        assertOk(begin,`${fixture.stage} provider Refund operation begins uncertain`);
        const fail=async()=>{throw Error(`injected provider Refund confirmation ${fixture.stage} rollback`);};
        const hooks:BillingFinancialPersistenceTestHooks=fixture.stage==="refund"?{afterProviderRefundMaterialized:fail}:fixture.stage==="allocation"?{afterProviderRefundAllocation:fail}:fixture.stage==="audit"?{afterAudit:fail}:{afterOutbox:fail};
        const failingPayments=new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool,hooks));
        const confirmId=`provider-refund-rollback-confirm-${fixture.stage}-${x}`,transactionId=`fixture-refund-rollback-transaction-${fixture.stage}-${x}`;
        const confirmation={organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(fixture.invoice),paymentId:payment.value.payment.paymentId,providerOperationId:begin.value.providerOperationId,providerEventId:`fixture-refund-rollback-event-${fixture.stage}-${x}`,providerTransactionId:transactionId,occurredAt:new Date().toISOString(),businessRequestId:brandedId<"BusinessRequestId">(confirmId)};
        const failed=await failingPayments.confirmProviderRefund(ctx(confirmId,["refund.issue"]),confirmation);
        assert(!failed.ok,`${fixture.stage} injected provider Refund confirmation fails`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),1,`${fixture.stage} rollback leaves one original Payment`);
        const originalRolledBack=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
        assert.equal(`${originalRolledBack.id}:${originalRolledBack.amount_cents}`,`${originalBefore.id}:50000`,`${fixture.stage} rollback never mutates the original Payment`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),0,`${fixture.stage} rollback leaves no Refund`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId]),0,`${fixture.stage} rollback leaves no Refund allocation`);
        assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"0",`${fixture.stage} rollback refunds zero cents`);
        assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"50000",`${fixture.stage} rollback retains all 50000 cents`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2)",[org,begin.value.providerOperationId]),0,`${fixture.stage} rollback leaves no Refund-success Audit`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id IN (SELECT id FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2)",[org,begin.value.providerOperationId]),0,`${fixture.stage} rollback leaves no Refund-success outbox fact`);
        const rolledBackOperation=(await c.query<{state:string;transaction:string|null}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
        assert.equal(`${rolledBackOperation.state}:${rolledBackOperation.transaction??"none"}`,"uncertain:none",`${fixture.stage} rollback leaves provider state truthful and retryable`);
        assert.equal((await new PostgresProviderRefundReconciliationStore(pool).unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}))?.paymentId,payment.value.payment.paymentId,`${fixture.stage} rollback leaves Refund reconciliation outstanding`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2 AND operation='billing.provider.refund.confirm.v1' AND status='succeeded'",[org,confirmId]),0,`${fixture.stage} rollback leaves no false M0 completion`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),checkpointsBefore,`${fixture.stage} rollback leaves issued checkpoint unchanged`);
        const retried=await normalPayments.confirmProviderRefund(ctx(confirmId,["refund.issue"]),confirmation);
        assertOk(retried.ok,`${fixture.stage} same legitimate Refund confirmation retries successfully`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_payments WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),1,`${fixture.stage} retry retains one original Payment`);
        const originalAfter=(await c.query<{id:string;amount_cents:string}>("SELECT id,amount_cents FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[org,payment.value.payment.paymentId])).rows[0]!;
        assert.equal(`${originalAfter.id}:${originalAfter.amount_cents}`,`${originalBefore.id}:50000`,`${fixture.stage} retry never mutates the original Payment`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refunds WHERE organization_id=$1 AND provider_operation_id=$2",[org,begin.value.providerOperationId]),1,`${fixture.stage} retry creates one Refund`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND refund_id=$2 AND payment_id=$3",[org,retried.value.refundId,payment.value.payment.paymentId]),1,`${fixture.stage} retry creates one Refund allocation`);
        assert.equal((await c.query<{n:string}>("SELECT COALESCE(sum(amount_cents),0)::text n FROM v2_billing_refund_allocations WHERE organization_id=$1 AND payment_id=$2",[org,payment.value.payment.paymentId])).rows[0]!.n,"10000",`${fixture.stage} retry refunds exactly 10000 cents`);
        assert.equal((await c.query<{n:string}>("SELECT (p.amount_cents-COALESCE(sum(a.amount_cents),0))::text n FROM v2_billing_payments p LEFT JOIN v2_billing_refund_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id WHERE p.organization_id=$1 AND p.id=$2 GROUP BY p.amount_cents",[org,payment.value.payment.paymentId])).rows[0]!.n,"40000",`${fixture.stage} retry retains exactly 40000 cents`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='provider_refund_succeeded' AND resource_id=$2",[org,retried.value.refundId]),1,`${fixture.stage} retry creates one Refund-success Audit`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_outbox_messages WHERE organization_id=$1 AND event_type='billing.provider_refund_succeeded.v1' AND aggregate_id=$2",[org,retried.value.refundId]),1,`${fixture.stage} retry creates one Refund-success outbox fact`);
        const completedOperation=(await c.query<{state:string;transaction:string}>("SELECT reconciliation_state state,provider_transaction_id transaction FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[org,begin.value.providerOperationId])).rows[0]!;
        assert.equal(`${completedOperation.state}:${completedOperation.transaction}`,`succeeded:${transactionId}`,`${fixture.stage} retry resolves the provider Refund operation once`);
        assert.equal(await new PostgresProviderRefundReconciliationStore(pool).unresolved({organizationId:org,providerOperationId:begin.value.providerOperationId}),null,`${fixture.stage} retry clears reconciliation outstanding`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2 AND operation='billing.provider.refund.confirm.v1' AND status='succeeded'",[org,confirmId]),1,`${fixture.stage} retry creates one truthful M0 completion`);
        assert.equal(await count(c,"SELECT count(*) n FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2",[org,fixture.invoice]),checkpointsBefore,`${fixture.stage} retry leaves issued checkpoint unchanged`);
      }
      console.log("[m3.5b] Provider Refund confirmation rollback proof passed (507 assertions total).");
    }finally{c.release();}
  }finally{await pool.end();}
}
main().then(providerDuplicateProof).then(providerDistinctEventProof).then(providerCallbackReconciliationRaceProof).then(providerTwoReconciliationWorkersRaceProof).then(providerAmbiguousRecoveryProof).then(providerConfirmationRollbackProof).then(providerRefundConfirmationProof).then(providerRefundDistinctEventsProof).then(providerRefundCallbackReconciliationRaceProof).then(providerRefundTwoReconciliationWorkersRaceProof).then(providerRefundAmbiguousRecoveryProof).then(providerRefundableLimitRaceProof).then(providerRefundConfirmationRollbackProof).catch(error=>{console.error(`[m3.3] rehearsal failed: ${error instanceof Error?error.stack??error.message:String(error)}`);process.exitCode=1;});
