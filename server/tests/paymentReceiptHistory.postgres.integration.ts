import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customerAccountCreditApplicationBatches, customerAccountCreditApplications, customerAccountCredits, customerContacts, customerPaymentBatches, customers, invoices, organizations, payments, users } from '@shared/schema';
import { readPaymentReceiptHistory, listPaymentReceipts } from '../services/paymentReceiptHistoryService';

jest.unstable_mockModule('sharp',()=>({default:()=>{throw new Error('No image processing in payment-history tests');}}));
let org:string, customer:string, actor:string, app:express.Express;
const orgs:string[]=[];
const date = new Date('2026-06-15T14:30:00.000Z');
beforeAll(async()=>{
 actor=(await db.insert(users).values({email:randomUUID()+'@example.invalid',role:'admin'}).returning())[0].id;
 app=express();app.use(express.json());
 const auth=(req:any,_res:any,next:any)=>{req.organizationId=org;req.orgRole='admin';req.actorOrgRole='admin';req.user={id:actor};next();};
 const {registerMvpInvoicingRoutes}=await import('../routes/mvpInvoicing.routes');await registerMvpInvoicingRoutes(app,{isAuthenticated:auth,tenantContext:auth});
 const {registerCustomerRelationsRoutes}=await import('../routes/customerRelations.routes');registerCustomerRelationsRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdmin:auth});
},180000);
beforeEach(async()=>{
 org=(await db.insert(organizations).values({name:'Synthetic payment receipt history',slug:'receipt-'+randomUUID()}).returning())[0].id;orgs.push(org);
 customer=(await db.insert(customers).values({organizationId:org,companyName:'Receipt Test Customer'}).returning())[0].id;
});
afterAll(async()=>{
 if(orgs.length)await db.delete(payments).where(inArray(payments.organizationId,orgs));
 for(const id of orgs){
  await db.delete(payments).where(eq(payments.organizationId,id));await db.delete(customerAccountCreditApplications).where(eq(customerAccountCreditApplications.organizationId,id));
  await db.delete(customerAccountCreditApplicationBatches).where(eq(customerAccountCreditApplicationBatches.organizationId,id));await db.delete(customerAccountCredits).where(eq(customerAccountCredits.organizationId,id));
  await db.delete(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,id));await db.delete(auditLogs).where(eq(auditLogs.organizationId,id));
  await db.delete(invoices).where(eq(invoices.organizationId,id));await db.delete(customerContacts).where(eq(customerContacts.organizationId,id));await db.delete(customers).where(eq(customers.organizationId,id));await db.delete(organizations).where(eq(organizations.id,id));
 }
 if(actor)await db.delete(users).where(eq(users.id,actor));
});
async function invoice(label:string, owner=customer, organizationId=org){return (await db.insert(invoices).values({organizationId,customerId:owner,invoiceNumber:Math.floor(Math.random()*1e9),displayNumber:label,createdByUserId:actor,status:'billed',subtotal:'1000',tax:'0',total:'1000',subtotalCents:100000,totalCents:100000,taxCents:0}).returning())[0];}
async function payment(invoiceId:string,cents:number,extra:Partial<typeof payments.$inferInsert>={}){return (await db.insert(payments).values({organizationId:org,invoiceId,amount:(cents/100).toFixed(2),amountCents:cents,method:'other',provider:'manual',status:'succeeded',paidAt:date,appliedAt:date,notes:'Cash App',...extra}).returning())[0];}
async function batch(amount=50000,extra:Partial<typeof customerPaymentBatches.$inferInsert>={}){return (await db.insert(customerPaymentBatches).values({organizationId:org,customerId:customer,amountCents:amount,method:'other',allocationMode:'custom',status:'succeeded',provider:'manual',idempotencyKey:randomUUID(),reference:'CashApp-500-REF',appliedAt:date,...extra}).returning())[0];}
async function grouped(){const b=await batch();const inv=await Promise.all(['INV-A','INV-B','INV-C'].map(label=>invoice(label)));const p=await Promise.all(inv.map((row,i)=>payment(row.id,[20000,17500,12500][i],{customerPaymentBatchId:b.id})));return {b,inv,p};}
const read=(extra:Partial<Parameters<typeof readPaymentReceiptHistory>[0]>={})=>readPaymentReceiptHistory({organizationId:org,customerId:customer,...extra});
async function snapshot(){return {p:await db.select().from(payments).where(eq(payments.organizationId,org)),b:await db.select().from(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,org)),i:await db.select().from(invoices).where(eq(invoices.organizationId,org)),a:await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org))};}

test('Cash App $500 receipt expands to $200/$175/$125 allocations without double counting or writes',async()=>{
 const {b,inv,p}=await grouped(),before=await snapshot();const result=await read();
 expect(result.summary).toEqual({totalPayments:1,totalCollectedCents:50000});expect(result.rows).toHaveLength(1);
 expect(result.rows[0]).toMatchObject({batchId:b.id,amountCents:50000,allocatedCents:50000,unappliedCents:0,reference:'CashApp-500-REF',appliedAt:date.toISOString()});
 expect(result.rows[0].allocations.map(a=>a.paymentId).sort()).toEqual(p.map(p=>p.id).sort());expect(result.rows[0].allocations.map(a=>a.invoiceId).sort()).toEqual(inv.map(i=>i.id).sort());
 expect(await snapshot()).toEqual(before);
 const response=await request(app).get('/api/customers/'+customer+'/transactions?type=payment');expect(response.status).toBe(200);expect(response.body.rows).toHaveLength(1);expect(response.body.rows[0].receipt.allocations).toHaveLength(3);expect(response.body.summary.paidTotal).toBe('500.00');
 const global=await request(app).get('/api/payments');expect(global.status).toBe(200);expect(global.body.data.summary.totalPayments).toBe(1);
});
test('one invoice payment retains its actual payment ID and canonical invoice link',async()=>{const i=await invoice('INV-SINGLE'),p=await payment(i.id,20000);const r=await read();expect(r.rows[0]).toMatchObject({paymentId:p.id,batchId:null,amountCents:20000,unappliedCents:0,allocations:[{invoiceId:i.id,invoiceNumber:'INV-SINGLE'}]});});
test('receipt filtering and pagination operate on whole groups, not matching allocations',async()=>{
 await grouped();for(const query of ['500','500.00','$500.00','Cash App','CashApp-500-REF','INV-B','2026-06-15','Receipt Test Customer']){const r=await read({search:query,pageSize:1});expect(r.summary.totalPayments).toBe(1);expect(r.rows[0].allocations).toHaveLength(3);}
 await payment((await invoice('LEGACY')).id,1000);const first=await read({pageSize:1}),second=await read({pageSize:1,page:2});expect(first.pagination.totalCount).toBe(2);expect(first.rows[0].id).not.toBe(second.rows[0].id);expect((await read({search:'not present'})).rows).toEqual([]);
});
test('partial allocation and no-allocation receipt show retained unapplied funds',async()=>{const b=await batch();await payment((await invoice('PARTIAL')).id,20000,{customerPaymentBatchId:b.id});expect((await read()).rows[0]).toMatchObject({allocatedCents:20000,unappliedCents:30000});const empty=await batch(10000);expect((await read()).rows.find(r=>r.batchId===empty.id)).toMatchObject({amountCents:10000,unappliedCents:10000,allocations:[]});});
test('refunds and voids keep original amounts and statuses, without becoming available cash',async()=>{
 const {b,p}=await grouped();await db.update(payments).set({status:'refunded',refundedAt:date}).where(eq(payments.id,p[2].id));let r=await read();expect(r.rows[0]).toMatchObject({batchId:b.id,amountCents:50000,allocatedCents:37500,refundedCents:12500,unappliedCents:0});expect(r.summary.totalCollectedCents).toBe(37500);const filtered=await request(app).get('/api/customers/'+customer+'/transactions?type=refund');expect(filtered.body.rows).toHaveLength(1);expect(filtered.body.rows[0].receipt.refundedCents).toBe(12500);
 await payment((await invoice('VOID')).id,10000,{status:'voided'});await payment((await invoice('REFUND')).id,1000,{status:'refunded'});r=await read();expect(r.rows.some(r=>r.status==='voided')).toBe(true);expect(r.summary.totalCollectedCents).toBe(36500);
});
test('Stripe batch and standalone settled Stripe payments are financial history; pending attempts are not',async()=>{const b=await batch(10000,{provider:'stripe',stripePaymentIntentId:'pi_'+randomUUID(),method:'credit_card'});await payment((await invoice('STRIPE')).id,10000,{customerPaymentBatchId:b.id,provider:'stripe',method:'credit_card'});await payment((await invoice('PENDING')).id,5000,{provider:'stripe',status:'pending',paidAt:null});const single=await payment((await invoice('SINGLE-STRIPE')).id,3000,{provider:'stripe',method:'credit_card',stripePaymentIntentId:'pi_'+randomUUID()});const r=await read();expect(r.rows).toHaveLength(2);expect(r.rows.find(row=>row.batchId===b.id)?.reference).toBe(b.reference);expect(r.rows.find(row=>row.paymentId===single.id)?.provider).toBe('stripe');expect(r.summary.totalCollectedCents).toBe(13000);});
test('matching historical dates, amounts, references and notes do not invent a common receipt',async()=>{const a=await invoice('OLD-A'),b=await invoice('OLD-B');await payment(a.id,20000,{metadata:{reference:'same-reference'}});await payment(b.id,20000,{metadata:{reference:'same-reference'}});const r=await read();expect(r.rows).toHaveLength(2);expect(r.rows.every(r=>r.batchId===null)).toBe(true);expect(r.summary.totalCollectedCents).toBe(40000);});
test('customer and tenant mismatches are never grouped or exposed through another customer',async()=>{const b=await batch(),other=(await db.insert(customers).values({organizationId:org,companyName:'Other Customer'}).returning())[0];await payment((await invoice('WRONG-OWNER',other.id)).id,50000,{customerPaymentBatchId:b.id});expect((await read()).rows).toHaveLength(0);const separate=await read({customerId:other.id});expect(separate.rows).toHaveLength(1);expect(separate.rows[0].batchId).toBeNull();expect(separate.rows[0].linkageWarning).toContain('could not be verified');const foreign=await read({organizationId:randomUUID(),customerId:other.id});expect(foreign.rows).toHaveLength(0);});
test('customer advances are received once; their later applications and reversals do not add receipts',async()=>{
 const advance=(await db.insert(customerAccountCredits).values({organizationId:org,customerId:customer,sourceType:'customer_advance',originalAmountCents:50000,receivedMethod:'other',receivedAt:date,reference:'Advance-CashApp',idempotencyKey:randomUUID()}).returning())[0];
 const ab=(await db.insert(customerAccountCreditApplicationBatches).values({organizationId:org,customerId:customer,allocationMode:'custom',idempotencyKey:randomUUID(),appliedAt:date}).returning())[0];
 const i=await invoice('ADVANCE-INV');const a=(await db.insert(customerAccountCreditApplications).values({organizationId:org,customerId:customer,customerAccountCreditId:advance.id,applicationBatchId:ab.id,invoiceId:i.id,amountCents:20000,appliedAt:date}).returning())[0];await payment(i.id,20000,{customerAccountCreditApplicationId:a.id,provider:'customer_credit'});
 let r=await read();expect(r.rows).toHaveLength(1);expect(r.rows[0]).toMatchObject({creditId:advance.id,amountCents:50000,allocatedCents:20000,unappliedCents:30000});expect(r.summary.totalCollectedCents).toBe(50000);
 const response=await request(app).get('/api/customers/'+customer+'/transactions');expect(response.body.rows.filter((r:any)=>r.type==='payment'||r.type==='credit')).toHaveLength(1);
 await db.update(payments).set({status:'canceled'}).where(eq(payments.customerAccountCreditApplicationId,a.id));await db.update(customerAccountCreditApplications).set({status:'reversed'}).where(eq(customerAccountCreditApplications.id,a.id));r=await read();expect(r.rows[0].unappliedCents).toBe(50000);expect(r.rows[0].allocations[0].status).toBe('canceled');expect(r.summary.totalCollectedCents).toBe(50000);
});
test('organization date/method filters and stable receipt sorting are preserved',async()=>{await grouped();expect((await listPaymentReceipts({organizationId:org,datePreset:'custom',dateFrom:'2026-06-15',dateTo:'2026-06-15',method:'other',sortBy:'amount'})).rows).toHaveLength(1);expect((await listPaymentReceipts({organizationId:org,datePreset:'custom',dateFrom:'2026-06-16',dateTo:'2026-06-16'})).rows).toHaveLength(0);expect((await read({method:'cash'})).rows).toHaveLength(0);});


test('audited tendered amount and returned change are distinct from unapplied funds',async()=>{
 const b=await batch(40000);await payment((await invoice('CHANGE')).id,40000,{customerPaymentBatchId:b.id});
 await db.insert(auditLogs).values({organizationId:org,userId:actor,entityType:'customer_payment_batch',entityId:b.id,actionType:'customer_payment_allocated',description:'Synthetic tendered money audit',newValues:{amountCents:40000,tenderedAmountCents:50000,changeDueCents:10000}});
 const r=await read();expect(r.rows[0]).toMatchObject({amountCents:50000,retainedCents:40000,allocatedCents:40000,unappliedCents:0});expect(r.summary.totalCollectedCents).toBe(40000);
});
test('invalid audited tender values cannot rewrite the original receipt or break history',async()=>{
 const b=await batch();await db.insert(auditLogs).values({organizationId:org,userId:actor,entityType:'customer_payment_batch',entityId:b.id,actionType:'customer_payment_allocated',description:'Synthetic tendered money audit',newValues:{amountCents:50000,tenderedAmountCents:'not a number',changeDueCents:0}});
 expect((await read()).rows[0].amountCents).toBe(50000);
});


test('foreign-tenant allocation linkage fails closed without exposing another tenant invoice',async()=>{
 const b=await batch();const foreign=(await db.insert(organizations).values({name:'Synthetic foreign payment tenant',slug:'foreign-receipt-'+randomUUID()}).returning())[0];orgs.push(foreign.id);
 const owner=(await db.insert(customers).values({organizationId:foreign.id,companyName:'Foreign receipt customer'}).returning())[0];const inv=await invoice('FOREIGN-PRIVATE-INVOICE',owner.id,foreign.id);
 await payment(inv.id,50000,{organizationId:foreign.id,customerPaymentBatchId:b.id});
 expect((await read()).rows).toEqual([]);
 const other=await read({organizationId:foreign.id,customerId:owner.id});expect(other.rows).toHaveLength(1);expect(other.rows[0].batchId).toBeNull();expect(other.rows[0].reference).not.toBe(b.reference);expect(other.rows[0].allocations[0].invoiceId).toBe(inv.id);
 const response=await request(app).get('/api/customers/'+owner.id+'/transactions');expect(response.status).toBe(404);
});
