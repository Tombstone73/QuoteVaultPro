import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customerContacts, customerPaymentBatches, customers, invoices, organizations, payments, userOrganizations, users, customerAccountCredits } from '@shared/schema';
import { readPaymentReceiptHistory } from '../services/paymentReceiptHistoryService';

jest.unstable_mockModule('sharp',()=>({default:()=>{throw new Error('Unexpected image operation');}}));
let org:string, customer:string, actor:string, app:express.Express;
const orgs:string[]=[];
const receivedAt='2026-06-15T14:30:00.000Z';
beforeAll(async()=>{
 actor=(await db.insert(users).values({email:randomUUID()+'@example.invalid',role:'admin'}).returning())[0].id;
 app=express();app.use(express.json());
 const auth=(req:any,_res:any,next:any)=>{req.organizationId=org;req.orgRole='admin';req.actorOrgRole='admin';req.user={id:actor};next();};
 const {registerMvpInvoicingRoutes}=await import('../routes/mvpInvoicing.routes');
 await registerMvpInvoicingRoutes(app,{isAuthenticated:auth,tenantContext:auth});
},180000);
beforeEach(async()=>{
 org=(await db.insert(organizations).values({name:'Synthetic confirmed receipt',slug:'confirmed-receipt-'+randomUUID()}).returning())[0].id;orgs.push(org);
 await db.insert(userOrganizations).values({organizationId:org,userId:actor,role:'admin'});
 customer=(await db.insert(customers).values({organizationId:org,companyName:'Confirmed Cash App Buyer'}).returning())[0].id;
});
afterAll(async()=>{
 if(orgs.length)await db.delete(payments).where(inArray(payments.organizationId,orgs));
 for(const id of orgs){
  await db.delete(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,id));await db.delete(auditLogs).where(eq(auditLogs.organizationId,id));
  await db.delete(invoices).where(eq(invoices.organizationId,id));await db.delete(customerContacts).where(eq(customerContacts.organizationId,id));await db.delete(customers).where(eq(customers.organizationId,id));
  await db.delete(userOrganizations).where(eq(userOrganizations.organizationId,id));await db.delete(organizations).where(eq(organizations.id,id));
 }
 if(actor)await db.delete(users).where(eq(users.id,actor));
});
async function invoice(amount=20000, dueDate='2026-06-01', owner=customer, organizationId=org){return (await db.insert(invoices).values({organizationId,customerId:owner,invoiceNumber:Math.floor(Math.random()*1e9),displayNumber:'INV-'+randomUUID().slice(0,8),createdByUserId:actor,status:'billed',subtotal:(amount/100).toFixed(2),tax:'0',total:(amount/100).toFixed(2),subtotalCents:amount,totalCents:amount,taxCents:0,issueDate:new Date('2026-05-01'),dueDate:new Date(dueDate)}).returning())[0];}
async function preview(ids:string[], amountCents:number){
 const response=await request(app).post('/api/invoices/customer-payment/preview').send({invoiceIds:ids,amountCents,allocationMode:'oldest_first'});expect(response.status).toBe(200);return response.body.data;
}
function postBody(p:any, amountCents:number, extra:Record<string,unknown>={}){return {invoiceIds:p.invoices.map((row:any)=>row.invoiceId),amountCents,allocationMode:'oldest_first',method:'other',expectedCustomerId:customer,appliedAt:receivedAt,reference:'CashApp-confirmed',notes:'Cash App received',expectedRemainingCents:Object.fromEntries(p.invoices.map((row:any)=>[row.invoiceId,row.remainingCents])),expectedAllocations:p.allocations,...extra};}
const post=(body:Record<string,unknown>, key=randomUUID())=>request(app).post('/api/invoices/customer-payment').set('Idempotency-Key',key).send(body);
async function snapshot(){return {payments:await db.select().from(payments).where(eq(payments.organizationId,org)),batches:await db.select().from(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,org)),invoices:await db.select().from(invoices).where(eq(invoices.organizationId,org)),audits:await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org)),credits:await db.select().from(customerAccountCredits).where(eq(customerAccountCredits.organizationId,org))};}

test('route confirms one invoice, preserves metadata and idempotently reads back one receipt',async()=>{
 const i=await invoice(),p=await preview([i.id],20000);expect(p.customerName).toBe('Confirmed Cash App Buyer');expect(p.invoices[0].invoiceDisplayNumber).toBe(i.displayNumber);
 const key=randomUUID(),body=postBody(p,20000);expect((await post(body,key)).status).toBe(200);const before=await snapshot();
 expect(before.batches).toHaveLength(1);expect(before.payments).toHaveLength(1);expect(before.batches[0]).toMatchObject({amountCents:20000,method:'other',reference:'CashApp-confirmed',notes:'Cash App received',appliedAt:new Date(receivedAt)});
 expect(before.payments[0]).toMatchObject({amountCents:20000,syncStatus:'skipped'});expect(before.payments[0].syncError).toContain('accounting review');
 expect((await post(body,key)).status).toBe(200);expect(await snapshot()).toEqual(before);
 const history=await readPaymentReceiptHistory({organizationId:org,customerId:customer});expect(history.summary).toEqual({totalPayments:1,totalCollectedCents:20000});expect(history.rows[0].allocations[0].invoiceId).toBe(i.id);
});
test('$500 received, $475 applied, $25 change remain distinct from held credit',async()=>{
 const inv=await Promise.all([20000,17500,10000].map(c=>invoice(c))),p=await preview(inv.map(i=>i.id),50000);
 const response=await post(postBody(p,50000));expect(response.status).toBe(200);expect(response.body.data).toMatchObject({appliedAmountCents:47500,changeDueCents:2500});
 const saved=await snapshot();expect(saved.batches[0].amountCents).toBe(47500);expect(saved.payments.reduce((sum,p)=>sum+p.amountCents,0)).toBe(47500);expect(saved.credits).toEqual([]);
 expect(saved.audits[0].newValues).toMatchObject({tenderedAmountCents:50000,amountCents:47500,changeDueCents:2500});
 const r=await readPaymentReceiptHistory({organizationId:org,customerId:customer});expect(r.rows[0]).toMatchObject({amountCents:50000,retainedCents:47500,allocatedCents:47500,unappliedCents:0});expect(r.summary.totalCollectedCents).toBe(47500);
});
test('partial oldest-first uses due dates and exact cents',async()=>{
 const newer=await invoice(20000,'2026-06-10'),older=await invoice(20000,'2026-06-01'),p=await preview([newer.id,older.id],20001);
 expect(p.allocations).toEqual([{invoiceId:older.id,amountCents:20000},{invoiceId:newer.id,amountCents:1}]);expect((await post(postBody(p,20001))).status).toBe(200);
 const saved=await snapshot();expect(saved.invoices.find(i=>i.id===newer.id)?.balanceDue).toBe('199.99');
});
test('custom adjustments including zero allocations persist without empty payments',async()=>{
 const inv=await Promise.all([invoice(),invoice(),invoice()]),p=await preview(inv.map(i=>i.id),15000);
 const custom=inv.map((i,index)=>({invoiceId:i.id,amountCents:[5001,9999,0][index]}));
 const response=await post(postBody(p,15000,{allocationMode:'custom',customAllocations:custom,expectedAllocations:custom.filter(c=>c.amountCents>0)}));expect(response.status).toBe(200);
 expect((await snapshot()).payments.map(p=>p.amountCents).sort()).toEqual([5001,9999]);
});
test('changed balances reject confirmed ordinary allocations before writes',async()=>{
 const a=await invoice(),b=await invoice(),p=await preview([a.id,b.id],30000);
 await db.insert(payments).values({organizationId:org,invoiceId:a.id,amount:'10.00',amountCents:1000,method:'cash',status:'succeeded',provider:'manual'});
 const before=await snapshot(),response=await post(postBody(p,30000));expect(response.status).toBe(409);expect(response.body.code).toBe('PAYMENT_ALLOCATION_STALE');expect(await snapshot()).toEqual(before);
});
test('changed ordering with unchanged balances rejects stale confirmation',async()=>{
 const a=await invoice(20000,'2026-06-01'),b=await invoice(20000,'2026-06-10'),p=await preview([a.id,b.id],20000);
 await db.update(invoices).set({dueDate:new Date('2026-05-01')}).where(eq(invoices.id,b.id));const before=await snapshot();
 const response=await post(postBody(p,20000));expect(response.status).toBe(409);expect(response.body.code).toBe('PAYMENT_ALLOCATION_STALE');expect(await snapshot()).toEqual(before);
});
test('underallocated, empty, duplicate or wrong confirmations cannot create a receipt',async()=>{
 const i=await invoice(),p=await preview([i.id],10000),before=await snapshot();
 for(const extra of [{allocationMode:'custom',customAllocations:[{invoiceId:i.id,amountCents:5000}]},{expectedAllocations:[]},{expectedAllocations:[...p.allocations,...p.allocations]},{expectedAllocations:[{invoiceId:i.id,amountCents:9999}]},{expectedRemainingCents:{}}]){
  expect((await post(postBody(p,10000,extra))).status).toBeGreaterThanOrEqual(400);expect(await snapshot()).toEqual(before);
 }
});
test('customer and tenant boundaries remain authoritative',async()=>{
 const i=await invoice(),p=await preview([i.id],10000),before=await snapshot();expect((await post(postBody(p,10000,{expectedCustomerId:randomUUID()}))).status).toBe(409);
 const foreign=(await db.insert(organizations).values({name:'Other receipt tenant',slug:randomUUID()}).returning())[0];orgs.push(foreign.id);
 const owner=(await db.insert(customers).values({organizationId:foreign.id,companyName:'Foreign buyer'}).returning())[0],other=await invoice(10000,'2026-06-01',owner.id,foreign.id);
 expect((await post(postBody(p,10000,{invoiceIds:[other.id]}))).status).toBe(404);expect(await snapshot()).toEqual(before);
});
test.each([false,true])('verified Stripe partial refund groups by original identity (batch=%s)',async grouped=>{
 const i=await invoice();let batchId:string|null=null;
 if(grouped)batchId=(await db.insert(customerPaymentBatches).values({organizationId:org,customerId:customer,amountCents:20000,allocationMode:'oldest_first',method:'credit_card',provider:'stripe',status:'succeeded',appliedAt:new Date(receivedAt),idempotencyKey:randomUUID()}).returning())[0].id;
 const original=(await db.insert(payments).values({organizationId:org,invoiceId:i.id,customerPaymentBatchId:batchId,amount:'200.00',amountCents:20000,method:'credit_card',provider:'stripe',status:'succeeded',paidAt:new Date(receivedAt)}).returning())[0];
 await db.insert(payments).values({organizationId:org,invoiceId:i.id,amount:'25.00',amountCents:2500,method:'credit_card',provider:'stripe',status:'refunded',refundedAt:new Date('2026-07-01T12:00:00Z'),metadata:{stripeRefund:{id:'re_synthetic',originalPaymentId:original.id}}});
 const before=await snapshot(),r=await readPaymentReceiptHistory({organizationId:org,customerId:customer});expect(r.rows).toHaveLength(1);expect(r.summary).toEqual({totalPayments:1,totalCollectedCents:17500});
 expect(r.rows[0]).toMatchObject({amountCents:20000,allocatedCents:20000,refundedCents:2500,unappliedCents:0});expect(r.rows[0].allocations).toHaveLength(2);
 const filtered=await readPaymentReceiptHistory({organizationId:org,customerId:customer,from:new Date('2026-07-01'),until:new Date('2026-07-02')});expect(filtered.rows).toHaveLength(1);expect(filtered.rows[0].appliedAt).toBe(receivedAt);expect(await snapshot()).toEqual(before);
});
test('wrong-invoice refund reference stays separate',async()=>{
 const a=await invoice(),b=await invoice(),original=(await db.insert(payments).values({organizationId:org,invoiceId:a.id,amount:'200',amountCents:20000,method:'credit_card',provider:'stripe',status:'succeeded',paidAt:new Date(receivedAt)}).returning())[0];
 await db.insert(payments).values({organizationId:org,invoiceId:b.id,amount:'25',amountCents:2500,method:'credit_card',provider:'stripe',status:'refunded',metadata:{stripeRefund:{originalPaymentId:original.id}}});
 const r=await readPaymentReceiptHistory({organizationId:org,customerId:customer});expect(r.rows).toHaveLength(2);expect(r.rows.every(row=>row.allocations.length===1)).toBe(true);expect(r.summary.totalCollectedCents).toBe(17500);
});
test('foreign-tenant original refund reference cannot join a local receipt',async()=>{
 const local=await invoice(),foreign=(await db.insert(organizations).values({name:'Foreign Stripe receipt',slug:randomUUID()}).returning())[0];orgs.push(foreign.id);
 const owner=(await db.insert(customers).values({organizationId:foreign.id,companyName:'Private foreign Stripe customer'}).returning())[0],other=await invoice(20000,'2026-06-01',owner.id,foreign.id);
 const original=(await db.insert(payments).values({organizationId:foreign.id,invoiceId:other.id,amount:'200',amountCents:20000,method:'credit_card',provider:'stripe',status:'succeeded'}).returning())[0];
 await db.insert(payments).values({organizationId:org,invoiceId:local.id,amount:'25',amountCents:2500,method:'credit_card',provider:'stripe',status:'refunded',metadata:{stripeRefund:{originalPaymentId:original.id}}});
 const r=await readPaymentReceiptHistory({organizationId:org,customerId:customer});expect(r.rows).toHaveLength(1);expect(r.rows[0].allocations[0]).toMatchObject({invoiceId:local.id,originalPaymentId:null});expect(r.summary.totalCollectedCents).toBe(-2500);
});
