import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customerContacts, customerPaymentBatches, customers, invoices, orders, organizations, payments, userOrganizations, users } from '@shared/schema';
import { previewCustomerPayment, recordCustomerPayment } from '../services/billing/customerPaymentOperations';
jest.unstable_mockModule('sharp',()=>({default:()=>{throw new Error('No image processing in synthetic payment tests');}}));
jest.unstable_mockModule('../lib/stripe',()=>({getStripeClient:()=>{throw new Error('Unexpected gateway request');},getStripeWebhookSecret:()=>'',getStripeModeFromSecretKey:()=> 'unknown',assertStripeServerConfig:()=>({ok:false,mode:'unknown',webhookSecretStatus:'missing',reason:'missing_secret_key'}),createInvoicePaymentIntent:()=>{throw new Error('Unexpected gateway request');}}));
let org:string,actor:string,customer:string,app:express.Express;
beforeAll(async()=>{
 const key=randomUUID();org=(await db.insert(organizations).values({name:'Synthetic native preview regression',slug:'native-preview-'+key}).returning())[0].id;
 actor=(await db.insert(users).values({email:key+'@example.test',role:'admin'}).returning())[0].id;
 await db.insert(userOrganizations).values({organizationId:org,userId:actor,role:'admin'});
 customer=(await db.insert(customers).values({organizationId:org,companyName:'Synthetic native customer'}).returning())[0].id;
 app=express();app.use(express.json());
 const auth=(req:any,_res:any,next:any)=>{req.organizationId=org;req.orgRole='admin';req.actorOrgRole='admin';req.user={id:actor};next();};
 const {registerMvpInvoicingRoutes}=await import('../routes/mvpInvoicing.routes');await registerMvpInvoicingRoutes(app,{isAuthenticated:auth,tenantContext:auth});
},180000);
afterAll(async()=>{
 if(org){await db.delete(payments).where(eq(payments.organizationId,org));await db.delete(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,org));await db.delete(auditLogs).where(eq(auditLogs.organizationId,org));await db.delete(invoices).where(eq(invoices.organizationId,org));await db.delete(orders).where(eq(orders.organizationId,org));await db.delete(customerContacts).where(eq(customerContacts.organizationId,org));await db.delete(customers).where(eq(customers.organizationId,org));await db.delete(organizations).where(eq(organizations.id,org));}if(actor)await db.delete(users).where(eq(users.id,actor));
});
async function nativeInvoice(){
 const order=(await db.insert(orders).values({organizationId:org,customerId:customer,orderNumber:'SYNTH-'+randomUUID(),createdByUserId:actor,state:'production_complete',status:'completed'}).returning())[0];
 const invoice=(await db.insert(invoices).values({organizationId:org,customerId:customer,orderId:order.id,invoiceNumber:Math.floor(Math.random()*1e9),createdByUserId:actor,status:'billed',subtotal:'100',tax:'0',total:'100',subtotalCents:10000,totalCents:10000,taxCents:0,amountPaid:'0',balanceDue:'100'}).returning())[0];
 return {order,invoice};
}
test('two native invoices with legitimate same-tenant Orders and null Redo provenance preview correctly',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice();expect(a.order.redoRootOrderId).toBeNull();
 const preview=await previewCustomerPayment({organizationId:org,invoiceIds:[a.invoice.id,b.invoice.id],amountCents:15000,allocationMode:'oldest_first',staffSelection:true});
 expect(preview).toMatchObject({selectedCount:2,eligibleCount:2,totalOutstandingCents:20000,appliedAmountCents:15000,customerId:customer});expect(preview.allocations.reduce((sum,a)=>sum+a.amountCents,0)).toBe(15000);
});

const previewInput=(ids:string[])=>({organizationId:org,invoiceIds:ids,amountCents:15000,allocationMode:'oldest_first' as const,staffSelection:true});
const recordInput=(ids:string[],extra:Record<string,unknown>={})=>({...previewInput(ids),actorUserId:actor,expectedCustomerId:customer,method:'check',appliedAt:new Date(),idempotencyKey:randomUUID(),...extra});
async function financialRows(){return {invoices:await db.select().from(invoices).where(eq(invoices.organizationId,org)),payments:await db.select().from(payments).where(eq(payments.organizationId,org)),batches:await db.select().from(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,org)),audits:await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org))};}
async function expectBlocked(a:any,b:any,code:string){
 const before=await financialRows(),ids=[a.invoice.id,b.invoice.id];
 await expect(previewCustomerPayment(previewInput(ids))).rejects.toMatchObject({code,blockedInvoice:{invoiceId:b.invoice.id,invoiceNumber:b.invoice.invoiceNumber}});
 await expect(recordCustomerPayment(recordInput(ids))).rejects.toMatchObject({code});expect(await financialRows()).toEqual(before);
}
test('three ordinary valid invoices preview with ledger balances and the existing manual allocation operation',async()=>{
 const selected=await Promise.all([nativeInvoice(),nativeInvoice(),nativeInvoice()]);const ids=selected.map(x=>x.invoice.id),before=await financialRows();
 const p=await previewCustomerPayment(previewInput(ids));expect(p).toMatchObject({eligibleCount:3,totalOutstandingCents:30000,appliedAmountCents:15000});expect(await financialRows()).toEqual(before);
 const key=randomUUID();const paid=await recordCustomerPayment(recordInput(ids,{amountCents:12000,idempotencyKey:key}));expect(paid.payments.map(x=>x.amountCents).sort((a,b)=>a-b)).toEqual([2000,10000]);
 const replay=await recordCustomerPayment(recordInput(ids,{amountCents:12000,idempotencyKey:key}));expect(replay.reused).toBe(true);expect(replay.batch.id).toBe(paid.batch.id);
});
test('valid plus a genuinely missing linked Order fails closed with the affected tenant Invoice',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice();
 // Fixture-only legacy corruption: FK checks are suspended solely inside this
 // verified disposable PG transaction, then automatically restored at commit.
 await db.transaction(async tx=>{await tx.execute(sql`SET LOCAL session_replication_role = replica`);await tx.update(invoices).set({orderId:randomUUID()}).where(eq(invoices.id,b.invoice.id));});
 await expectBlocked(a,b,'ORDER_NOT_FOUND');
});
test('foreign-organization Order relationship cannot be verified and exposes no foreign Order details',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),suffix=randomUUID();const foreign=(await db.insert(organizations).values({name:'Synthetic foreign tenant',slug:'foreign-'+suffix}).returning())[0];
 try{await db.update(orders).set({organizationId:foreign.id}).where(eq(orders.id,b.order.id));await expectBlocked(a,b,'ORDER_NOT_FOUND');}
 finally{await db.update(orders).set({organizationId:org}).where(eq(orders.id,b.order.id));await db.delete(organizations).where(eq(organizations.id,foreign.id));}
});
test('native standalone customer invoices use existing Invoice authority without a fabricated Order',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice();await db.update(invoices).set({orderId:null}).where(eq(invoices.id,b.invoice.id));
 const p=await previewCustomerPayment(previewInput([a.invoice.id,b.invoice.id]));expect(p).toMatchObject({eligibleCount:2,totalOutstandingCents:20000});
});
test.each(['quickbooks','historical'])('%s imported accounting authority blocks the entire selection before writes',async kind=>{
 const a=await nativeInvoice(),b=await nativeInvoice();await db.update(invoices).set(kind==='quickbooks'?{importSource:'quickbooks'}:{isHistorical:true}).where(eq(invoices.id,b.invoice.id));await expectBlocked(a,b,'IMPORTED_AR_PAYMENT_REVIEW_REQUIRED');
});
test('Contact-owned invoice cannot silently enter a Customer batch',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),contact=(await db.insert(customerContacts).values({organizationId:org,firstName:'Synthetic',lastName:'Contact',email:randomUUID()+'@example.test'}).returning())[0];
 await db.update(invoices).set({customerId:null,contactId:contact.id}).where(eq(invoices.id,b.invoice.id));await expectBlocked(a,b,'CONTACT_INVOICE_CUSTOMER_PAYMENT_UNSUPPORTED');
});
test('invoice/Order Customer mismatch blocks all allocations even if the list projected the Order customer',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),other=(await db.insert(customers).values({organizationId:org,companyName:'Synthetic second customer'}).returning())[0];
 await db.update(orders).set({customerId:other.id}).where(eq(orders.id,b.order.id));await expectBlocked(a,b,'BILLING_OWNERSHIP_REVIEW_REQUIRED');
});
test('mixed Customers fail before paid exclusions or allocation',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),other=(await db.insert(customers).values({organizationId:org,companyName:'Synthetic mixed customer'}).returning())[0];
 await db.update(orders).set({customerId:other.id}).where(eq(orders.id,b.order.id));await db.update(invoices).set({customerId:other.id}).where(eq(invoices.id,b.invoice.id));const before=await financialRows();
 await expect(previewCustomerPayment(previewInput([a.invoice.id,b.invoice.id]))).rejects.toMatchObject({code:'CUSTOMER_MISMATCH'});await expect(recordCustomerPayment(recordInput([a.invoice.id,b.invoice.id]))).rejects.toMatchObject({code:'CUSTOMER_MISMATCH'});expect(await financialRows()).toEqual(before);
});
test.each(['paid','void','cancelled-order'])('%s eligibility is explicitly reported; strict grouped provider validation cannot charge a smaller selection',async kind=>{
 const a=await nativeInvoice(),b=await nativeInvoice();
 if(kind==='paid')await db.insert(payments).values({organizationId:org,invoiceId:b.invoice.id,provider:'manual',status:'succeeded',method:'check',amount:'100',amountCents:10000});
 if(kind==='void')await db.update(invoices).set({status:'void'}).where(eq(invoices.id,b.invoice.id));
 if(kind==='cancelled-order')await db.update(orders).set({status:'canceled',state:'canceled'}).where(eq(orders.id,b.order.id));
 if(kind!=='paid'){await expectBlocked(a,b,kind==='void'?'INVOICE_NOT_PAYABLE':'ORDER_CANCELLED');return;}
 const before=await financialRows(),p=await previewCustomerPayment(previewInput([a.invoice.id,b.invoice.id]));expect(p).toMatchObject({selectedCount:2,eligibleCount:1,excludedCount:1,totalOutstandingCents:10000});expect(p.excludedInvoices[0]).toMatchObject({invoiceId:b.invoice.id});expect(await financialRows()).toEqual(before);
 const {prepareFullBalanceStripePayment}=await import('../services/billing/groupedStripePaymentOperations');await expect(prepareFullBalanceStripePayment(org,[a.invoice.id,b.invoice.id])).rejects.toThrow('Select only eligible invoices');expect(await financialRows()).toEqual(before);
});
test('a foreign tenant Invoice reveals only the submitted ID, never its number or owner',async()=>{
 const a=await nativeInvoice(),suffix=randomUUID(),foreign=(await db.insert(organizations).values({name:'Synthetic private organization',slug:'foreign-invoice-'+suffix}).returning())[0];
 const foreignCustomer=(await db.insert(customers).values({organizationId:foreign.id,companyName:'Synthetic private billing owner'}).returning())[0];
 const foreignNumber=987654321;const other=(await db.insert(invoices).values({organizationId:foreign.id,customerId:foreignCustomer.id,invoiceNumber:foreignNumber,createdByUserId:actor,totalCents:10000,total:'100',status:'billed'}).returning())[0];
 try{
  const before=await financialRows();const response=await request(app).post('/api/invoices/customer-payment/preview').send(previewInput([a.invoice.id,other.id]));expect(response.status).toBe(404);expect(response.body).toMatchObject({code:'INVOICE_NOT_FOUND',blockedInvoice:{invoiceId:other.id,invoiceNumber:null}});expect(JSON.stringify(response.body)).not.toContain(String(foreignNumber));expect(JSON.stringify(response.body)).not.toContain(foreign.id);expect(await financialRows()).toEqual(before);
 }finally{await db.delete(invoices).where(eq(invoices.id,other.id));await db.delete(customers).where(eq(customers.id,foreignCustomer.id));await db.delete(organizations).where(eq(organizations.id,foreign.id));}
});

test('stale custom balances reject atomically while ordinary staff tendering still recomputes under existing locks',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),ids=[a.invoice.id,b.invoice.id];const before=await previewCustomerPayment(previewInput(ids));
 await recordCustomerPayment(recordInput([a.invoice.id],{amountCents:2000}));const snapshot=await financialRows();
 await expect(recordCustomerPayment(recordInput(ids,{allocationMode:'custom',customAllocations:[{invoiceId:a.invoice.id,amountCents:10000},{invoiceId:b.invoice.id,amountCents:5000}],expectedRemainingCents:Object.fromEntries(before.invoices.map(i=>[i.invoiceId,i.remainingCents]))}))).rejects.toMatchObject({code:'PAYMENT_ALLOCATION_STALE'});expect(await financialRows()).toEqual(snapshot);
 const result=await recordCustomerPayment(recordInput(ids,{amountCents:19000}));expect(result.appliedAmountCents).toBe(18000);expect(result.changeDueCents).toBe(1000);
});
test('concurrent settlements retain canonical serialization, exact totals and replay protection',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),ids=[a.invoice.id,b.invoice.id];
 const results=await Promise.all([recordCustomerPayment(recordInput(ids)),recordCustomerPayment(recordInput(ids))]);expect(results.reduce((sum,r)=>sum+r.appliedAmountCents,0)).toBe(20000);expect(results.reduce((sum,r)=>sum+r.changeDueCents,0)).toBe(10000);
 const saved=await db.select().from(payments).where(and(eq(payments.organizationId,org),sql`${payments.invoiceId} in (${a.invoice.id},${b.invoice.id})`));expect(saved.reduce((sum,p)=>sum+p.amountCents,0)).toBe(20000);
});

test('HTTP preview and submit adapters return actionable invoice-scoped errors, preserve batch selection and perform no writes',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice();await db.transaction(async tx=>{await tx.execute(sql`SET LOCAL session_replication_role = replica`);await tx.update(invoices).set({orderId:randomUUID()}).where(eq(invoices.id,b.invoice.id));});
 const before=await financialRows(),body=previewInput([a.invoice.id,b.invoice.id]);
 for(const path of ['/api/invoices/customer-payment/preview','/api/invoices/customer-payment','/api/invoices/customer-payment/stripe/runtime-config']){
  const response=await request(app).post(path).set('Idempotency-Key',randomUUID()).send({...body,method:'check'});expect(response.status).toBe(path==='/api/invoices/customer-payment'?404:409);expect(response.body).toMatchObject({code:'ORDER_NOT_FOUND',blockedInvoice:{invoiceId:b.invoice.id,invoiceNumber:b.invoice.invoiceNumber}});expect(response.body.error).toContain('linked Order could not be verified');expect(response.body.error).toContain('Remove this invoice');
 }
 expect(await financialRows()).toEqual(before);
});
test('HTTP preview uses the canonical two/three native Invoice loader and cannot mutate finances',async()=>{
 const selected=await Promise.all([nativeInvoice(),nativeInvoice(),nativeInvoice()]);const before=await financialRows();
 for(const count of [2,3]){const response=await request(app).post('/api/invoices/customer-payment/preview').send(previewInput(selected.slice(0,count).map(x=>x.invoice.id)));expect(response.status).toBe(200);expect(response.body.data).toMatchObject({eligibleCount:count,totalOutstandingCents:count*10000});}
 expect(await financialRows()).toEqual(before);
});

test('existing single-invoice manual payment accepts the same legitimate Order and retains its invoice-only ledger contract',async()=>{
 const a=await nativeInvoice();const {recordManualPaymentCanonical}=await import('../invoicesService');
 const payment=await recordManualPaymentCanonical({organizationId:org,invoiceId:a.invoice.id,userId:actor,amount:10,method:'check',source:'ui',idempotencyKey:randomUUID()});expect(payment).toMatchObject({invoiceId:a.invoice.id,amountCents:1000,customerPaymentBatchId:null});
 const [saved]=await db.select().from(invoices).where(eq(invoices.id,a.invoice.id));expect(saved.balanceDue).toBe('90.00');
});
test('an Invoice Customer cannot override an independently Contact-owned linked Order',async()=>{
 const a=await nativeInvoice(),b=await nativeInvoice(),contact=(await db.insert(customerContacts).values({organizationId:org,firstName:'Synthetic independent',lastName:'Owner',email:randomUUID()+'@example.test'}).returning())[0];await db.update(orders).set({customerId:null,contactId:contact.id}).where(eq(orders.id,b.order.id));await expectBlocked(a,b,'BILLING_OWNERSHIP_REVIEW_REQUIRED');
});
