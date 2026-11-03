import { randomUUID } from 'node:crypto';
import { afterAll, expect, test } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { db, pool } from '../db';
import * as s from '@shared/schema';
import type { CarrierTrackingEvent } from '@shared/shipmentTracking';
import { loadPortalShipments, pollShipmentTracking, seedShipmentTracking } from '../services/shipmentTrackingService';
import { getPortalOrder, listPortalOrders } from '../services/portal.service';

const reader = new Pool({connectionString:process.env.TEST_DATABASE_URL});
afterAll(async () => { await reader.end(); await pool.end(); });
async function fixture(carrier='UPS', number: string|null='1Z1234567890123456') {
  const id=randomUUID(); const [org]=await db.insert(s.organizations).values({name:'Tracking QA',slug:id}).returning();
  const [user]=await db.insert(s.users).values({email:`${id}@example.invalid`,role:'admin'}).returning();
  const [customer]=await db.insert(s.customers).values({organizationId:org.id,companyName:'Tracking QA'}).returning();
  const [order]=await db.insert(s.orders).values({organizationId:org.id,customerId:customer.id,orderNumber:id,createdByUserId:user.id,
    subtotal:'0',tax:'0',total:'0',shippingMethod:'ship',fulfillmentStatus:'shipped',status:'ready_for_fulfillment',state:'production_complete'}).returning();
  const [shipment]=await db.insert(s.shipments).values({organizationId:org.id,orderId:order.id,primaryOrderId:order.id,status:'SHIPPED',carrier,trackingNumber:number,shippedAt:new Date()}).returning();
  await db.insert(s.shipmentOrders).values({organizationId:org.id,shipmentId:shipment.id,orderId:order.id});
  const req={user:{id:user.id},organizationId:org.id,portalCustomerId:customer.id,portalCustomer:customer} as unknown as Parameters<typeof getPortalOrder>[0];
  await seedShipmentTracking(org.id,[shipment.id]);
  const [state]=await db.select().from(s.shipmentTrackingStates).where(eq(s.shipmentTrackingStates.shipmentId,shipment.id));
  return {org,user,customer,order,shipment,state,req};
}
const observed=(status:CarrierTrackingEvent['status'], occurredAt='2026-11-01T12:00:00Z'):CarrierTrackingEvent=>({status,occurredAt,description:status,estimatedDeliveryDate:status==='delivered'?null:'2026-11-05'});
async function due(f: Awaited<ReturnType<typeof fixture>>) { await db.update(s.shipmentTrackingStates).set({nextCheckAt:new Date(0)}).where(eq(s.shipmentTrackingStates.id,f.state.id)); }

test('portal list and detail expose cached single UPS shipment, with independent DB readback and no fulfillment mutation', async () => {
  const f=await fixture(); await db.update(s.shipments).set({internalNotes:'PRIVATE-SHIPMENT-NOTE',carrierRawResponse:{private:'PRIVATE-CARRIER-DATA'}}).where(eq(s.shipments.id,f.shipment.id));
  await pollShipmentTracking(f.org.id,f.state.id,async()=>[observed('in_transit')]);
  const detail=await getPortalOrder(f.req,f.order.id); const list=await listPortalOrders(f.req);
  expect(detail?.fulfillmentSummary.trackingPackages?.[0]).toMatchObject({carrier:'UPS',status:'in_transit',trackingNumber:f.shipment.trackingNumber,estimatedDeliveryDate:'2026-11-05'});
  expect(list[0].fulfillmentSummary).toEqual(detail?.fulfillmentSummary);
  expect(JSON.stringify(detail)).not.toContain('PRIVATE-');
  const read=await reader.query('select status,delivered_at from shipments where id=$1',[f.shipment.id]); expect(read.rows[0]).toMatchObject({status:'SHIPPED',delivered_at:null});
  const order=await reader.query('select fulfillment_status from orders where id=$1',[f.order.id]); expect(order.rows[0].fulfillment_status).toBe('shipped');
});
test('duplicates and older carrier events preserve history once and never regress delivered', async()=>{
  const f=await fixture(); const event=observed('exception');
  await pollShipmentTracking(f.org.id,f.state.id,async()=>[event,event,observed('in_transit','2026-10-31T12:00:00Z')]);
  await due(f); await pollShipmentTracking(f.org.id,f.state.id,async()=>[event,observed('delivered','2026-11-02T12:00:00Z'),observed('in_transit','2026-11-02T12:30:00Z')]);
  const [state]=await db.select().from(s.shipmentTrackingStates).where(eq(s.shipmentTrackingStates.id,f.state.id));
  expect(state.status).toBe('delivered'); expect(state.deliveredAt?.toISOString()).toBe('2026-11-02T12:00:00.000Z');
  const events=await db.select().from(s.shipmentTrackingEvents).where(eq(s.shipmentTrackingEvents.trackingStateId,f.state.id)); expect(events).toHaveLength(4);
  await due(f); let called=false; expect(await pollShipmentTracking(f.org.id,f.state.id,async()=>{called=true;return[event];})).toBe(false); expect(called).toBe(false);
});
test('provider failure is neutral, bounded and retryable without erasing a confirmed event', async()=>{
  const f=await fixture(); await pollShipmentTracking(f.org.id,f.state.id,async()=>[observed('exception')]); await due(f);
  expect(await pollShipmentTracking(f.org.id,f.state.id,async()=>{throw new Error('503');})).toBe(false);
  const [state]=await db.select().from(s.shipmentTrackingStates).where(eq(s.shipmentTrackingStates.id,f.state.id));
  expect(state).toMatchObject({status:'exception',errorCode:'CARRIER_UPDATES_UNAVAILABLE',attempts:1}); expect(state.nextCheckAt.getTime()).toBeGreaterThan(Date.now()+29*60_000);
  let called=false; await pollShipmentTracking(f.org.id,f.state.id,async()=>{called=true;return[];}); expect(called).toBe(false);
});
test('customer and tenant identity are required even if arbitrary Order or shipment IDs are supplied', async()=>{
  const f=await fixture(); const foreign=await fixture();
  expect((await loadPortalShipments(f.org.id,foreign.customer.id,[f.order.id])).size).toBe(0);
  expect((await loadPortalShipments(foreign.org.id,f.customer.id,[f.order.id])).size).toBe(0);
  expect(await getPortalOrder(foreign.req,f.order.id)).toBeNull();
  expect(await pollShipmentTracking(foreign.org.id,f.state.id,async()=>[observed('delivered')])).toBe(false);
  await expect(db.insert(s.shipmentTrackingStates).values({organizationId:foreign.org.id,shipmentId:f.shipment.id,carrier:'UPS',trackingNumber:'FOREIGN'})).rejects.toThrow();
});
test('voided shipments and cancelled UPS purchases never reappear through legacy fallback', async()=>{
  const f=await fixture(); await db.update(s.orders).set({trackingNumber:f.shipment.trackingNumber}).where(eq(s.orders.id,f.order.id));
  await db.update(s.shipments).set({status:'VOIDED'}).where(eq(s.shipments.id,f.shipment.id));
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages).toEqual([]);
  expect(await pollShipmentTracking(f.org.id,f.state.id,async()=>[observed('delivered')])).toBe(false);
});
test('tracking replacement and concurrent late responses are fenced without losing history', async()=>{
  const f=await fixture(); let started!:()=>void, release!:(events:CarrierTrackingEvent[])=>void;
  const barrier=new Promise<void>(resolve=>{started=resolve;});
  const old=pollShipmentTracking(f.org.id,f.state.id,async()=>{started(); return new Promise(resolve=>{release=resolve;});});
  await barrier; await db.update(s.shipmentTrackingStates).set({claimUntil:new Date(0)}).where(eq(s.shipmentTrackingStates.id,f.state.id));
  await pollShipmentTracking(f.org.id,f.state.id,async()=>[observed('out_for_delivery')]); release([observed('in_transit','2026-10-31T12:00:00Z')]); expect(await old).toBe(false);
  await due(f); await db.update(s.shipments).set({trackingNumber:'1ZREPLACED123456789'}).where(eq(s.shipments.id,f.shipment.id));
  expect(await pollShipmentTracking(f.org.id,f.state.id,async()=>[observed('delivered')])).toBe(false);
  const [state]=await db.select().from(s.shipmentTrackingStates).where(eq(s.shipmentTrackingStates.id,f.state.id)); expect(state.status).toBe('out_for_delivery');
});
test('unknown carrier and missing number remain neutral, historical legacy Orders retain copyable numbers', async()=>{
  const f=await fixture('Other','MANUAL-123'); const missing=await fixture('USPS',null);
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages?.[0]).toMatchObject({status:'unavailable',trackingUrl:null,trackingNumber:'MANUAL-123'});
  expect((await getPortalOrder(missing.req,missing.order.id))?.fulfillmentSummary.trackingPackages).toEqual([]);
  await db.delete(s.shipmentOrders).where(eq(s.shipmentOrders.shipmentId,f.shipment.id)); await db.delete(s.shipments).where(eq(s.shipments.id,f.shipment.id));
  await db.update(s.orders).set({trackingNumber:'HISTORIC-123'}).where(eq(s.orders.id,f.order.id));
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages?.[0]).toMatchObject({carrier:null,status:'unavailable',trackingNumber:'HISTORIC-123'});
});
test('multiple packages from live UPS labels retain existing package identity and hide sandbox or void history', async()=>{
  const f=await fixture();
  const packages=await db.insert(s.shipmentPackages).values([1,2].map(ordinal=>({organizationId:f.org.id,shipmentId:f.shipment.id,ordinal,packageReference:`Box ${ordinal}`}))).returning();
  const [quote]=await db.insert(s.upsShipmentRateQuotes).values({organizationId:f.org.id,shipmentId:f.shipment.id,environment:'live',requestFingerprint:'fixture',rates:[],expiresAt:new Date()}).returning();
  const [purchase]=await db.insert(s.upsLabelPurchases).values({organizationId:f.org.id,shipmentId:f.shipment.id,quoteId:quote.id,environment:'live',status:'PURCHASED',serviceCode:'03',serviceName:'Ground',estimateCents:0,estimateCurrency:'USD',providerTransactionId:randomUUID().replaceAll('-',''),requestFingerprint:'fixture'}).returning();
  await db.insert(s.upsPackageLabels).values(packages.map((pkg,index)=>({organizationId:f.org.id,purchaseId:purchase.id,packageId:pkg.id,providerResultOrdinal:index+1,trackingNumber:`1ZPACKAGE${index}12345678`,labelFormat:'GIF',labelBytes:Buffer.from('fixture'),labelSha256:'fixture'})));
  const detail=await getPortalOrder(f.req,f.order.id); expect(detail?.fulfillmentSummary.trackingPackages).toHaveLength(2); expect(detail?.fulfillmentSummary.trackingPackages?.map(pkg=>pkg.packageId)).toEqual(packages.map(pkg=>pkg.id));
  const [otherCustomer]=await db.insert(s.customers).values({organizationId:f.org.id,companyName:'Other customer'}).returning();
  const [otherOrder]=await db.insert(s.orders).values({organizationId:f.org.id,customerId:otherCustomer.id,createdByUserId:f.user.id,orderNumber:randomUUID(),subtotal:'0',tax:'0',total:'0'}).returning();
  const [product]=await db.insert(s.products).values({organizationId:f.org.id,name:'Synthetic tracking fixture',description:'QA only',isActive:true}).returning();
  for(const [index,order] of [f.order,otherOrder].entries()) {
    const [line]=await db.insert(s.orderLineItems).values({orderId:order.id,productId:product.id,quantity:1,unitPrice:'1',totalPrice:'1',description:'Synthetic package ownership'}).returning();
    await db.insert(s.shipmentItems).values({organizationId:f.org.id,shipmentId:f.shipment.id,packageId:packages[index].id,orderId:order.id,orderLineItemId:line.id,quantity:1});
  }
  await db.update(s.shipments).set({scope:'MULTI_ORDER'}).where(eq(s.shipments.id,f.shipment.id));
  await db.insert(s.shipmentOrders).values({organizationId:f.org.id,shipmentId:f.shipment.id,orderId:otherOrder.id});
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages?.map(pkg=>pkg.packageId)).toEqual([packages[0].id]);
  const otherReq={...f.req,portalCustomerId:otherCustomer.id,portalCustomer:otherCustomer} as unknown as typeof f.req;
  expect((await getPortalOrder(otherReq,otherOrder.id))?.fulfillmentSummary.trackingPackages?.map(pkg=>pkg.packageId)).toEqual([packages[1].id]);
  await db.update(s.upsLabelPurchases).set({status:'VOID_ACCEPTED'}).where(eq(s.upsLabelPurchases.id,purchase.id));
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages).toEqual([]);
  await db.update(s.shipments).set({carrier:'FedEx',trackingNumber:'123456789012'}).where(eq(s.shipments.id,f.shipment.id));
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages?.[0]).toMatchObject({carrier:'FedEx',trackingNumber:'123456789012',status:'unavailable'});
  await db.update(s.shipments).set({carrier:'UPS',trackingNumber:f.shipment.trackingNumber}).where(eq(s.shipments.id,f.shipment.id));
  await db.update(s.upsLabelPurchases).set({status:'PURCHASED',environment:'test'}).where(eq(s.upsLabelPurchases.id,purchase.id));
  expect((await getPortalOrder(f.req,f.order.id))?.fulfillmentSummary.trackingPackages).toEqual([]);
});
test('multiple active shipments are retained while cancelled shipment numbers remain excluded',async()=>{
  const f=await fixture('FedEx','123456789012');
  await db.insert(s.shipments).values([{organizationId:f.org.id,orderId:f.order.id,status:'SHIPPED',carrier:'USPS',trackingNumber:'9400123456789012345678'},
    {organizationId:f.org.id,orderId:f.order.id,status:'VOIDED',carrier:'UPS',trackingNumber:'VOIDED-TRACK'}]);
  const detail=await getPortalOrder(f.req,f.order.id);
  expect(detail?.fulfillmentSummary.trackingPackages?.map(pkg=>pkg.carrier).sort()).toEqual(['FedEx','USPS']);
  expect(JSON.stringify(detail?.fulfillmentSummary)).not.toContain('VOIDED-TRACK');
});
