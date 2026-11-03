import { afterAll, beforeEach, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { auditLogs, customers, fulfillmentEvents, orders, organizations, shipmentOrders, shipments, userOrganizations, users } from '@shared/schema';
import { registerFulfillmentRoutes } from '../routes/fulfillment.routes';
import { canonicalCustomerContactOperations } from '../services/customers/canonicalCustomerContactOperations';
import type { ShipmentCustomerAddressTarget } from '@shared/fulfillmentCustomerAddress';

const competitor = new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:'customer-address-competitor'});
let org:string,actor:string,customerId:string,shipmentId:string,orderId:string,historicalShipmentId:string;
const destination={name:'One shipment recipient',company:'Recipient display only',address1:'100 Corrected Street',address2:'Dock 2',city:'Carmel',state:'IN',postalCode:'46032',country:'US',phone:'3175550123',email:'recipient@example.invalid'};
let app:express.Express;
function application(organizationId=org,actorUserId=actor) {
  const instance=express();instance.use(express.json());
  registerFulfillmentRoutes(instance,{
    isAuthenticated:(req:express.Request,_res:express.Response,next:express.NextFunction)=>{Object.assign(req,{user:{id:actorUserId}});next();},
    tenantContext:(req:express.Request,_res:express.Response,next:express.NextFunction)=>{Object.assign(req,{organizationId});next();},
    requireOrgOwnerAdmin:(_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
  });
  return instance;
}
beforeEach(async()=>{
  org=`customer-shipping-${randomUUID()}`;actor=randomUUID();customerId=randomUUID();orderId=randomUUID();shipmentId=randomUUID();historicalShipmentId=randomUUID();
  await db.insert(organizations).values({id:org,name:'Isolated customer address QA',slug:org});
  await db.insert(users).values({id:actor,email:`${actor}@example.invalid`,role:'employee'});
  await db.insert(userOrganizations).values({organizationId:org,userId:actor,role:'member'});
  await db.insert(customers).values({id:customerId,organizationId:org,companyName:'Canonical ordering customer',email:'billing@example.invalid',phone:'5550100',notes:'Preserve notes',
    billingStreet1:'99 Billing Street',billingState:'TX',shippingStreet1:'100 Corrected Street',shippingCity:'Carmel',shippingState:null,shippingPostalCode:'46032',shippingCountry:'US',shippingAddress:'Legacy address missing state'});
  await db.insert(orders).values({id:orderId,organizationId:org,orderNumber:`QA-${randomUUID()}`,customerId,status:'ready_for_fulfillment',shippingMethod:'ship',createdByUserId:actor,
    shipToAddress1:'Historical Order address',shipToState:null});
  await db.insert(shipments).values([{id:shipmentId,organizationId:org,orderId,primaryOrderId:orderId,status:'DRAFT',scope:'SINGLE_ORDER',createdByUserId:actor,
    shippingContext:{version:1,source:'staff',sourceOrderId:orderId,destination:{...destination,state:null},blindShipping:false,blindSender:null}},
    {id:historicalShipmentId,organizationId:org,orderId,primaryOrderId:orderId,status:'SHIPPED',scope:'SINGLE_ORDER',createdByUserId:actor,
      shippingContext:{version:1,source:'staff',sourceOrderId:orderId,destination:{...destination,address1:'Original historical address',state:'TX'},blindShipping:false,blindSender:null}}]);
  await db.insert(shipmentOrders).values([{organizationId:org,shipmentId,orderId},{organizationId:org,shipmentId:historicalShipmentId,orderId}]);
  app=application();
});
afterAll(async()=>{await competitor.end();await pool.end();});
const endpoint=()=>`/api/fulfillment/shipments/${shipmentId}/customer-shipping-address`;
async function target():Promise<ShipmentCustomerAddressTarget>{const response=await request(app).get(endpoint());expect(response.status).toBe(200);return response.body.data;}
async function currentShipment(){return (await db.select().from(shipments).where(eq(shipments.id,shipmentId)))[0];}
async function currentCustomer(){return (await db.select().from(customers).where(eq(customers.id,customerId)))[0];}
async function profileAudits(){return db.select().from(auditLogs).where(and(eq(auditLogs.organizationId,org),eq(auditLogs.entityId,customerId)));}
async function correctShipment(){
  const current=await currentShipment();
  const response=await request(app).patch(`/api/fulfillment/shipments/${shipmentId}`).send({expectedUpdatedAt:current.updatedAt.toISOString(),clientRequestId:randomUUID(),shippingContext:{...current.shippingContext,destination}});
  expect(response.status).toBe(200);
  const saved=await currentShipment();expect(saved.shippingContext?.destination.state).toBe('IN');return saved;
}
async function submission(reviewed?:ShipmentCustomerAddressTarget){
  const customer=reviewed??await target();const shipment=await currentShipment();
  return {customerId:customer.customerId,expectedCustomerUpdatedAt:customer.updatedAt,expectedShipmentUpdatedAt:shipment.updatedAt.toISOString()};
}

test('shipment-only / one-time drop correction persists without touching the customer or history',async()=>{
  const beforeCustomer=await currentCustomer();const beforeOrders=await db.select().from(orders).where(eq(orders.organizationId,org));
  const history=(await db.select().from(shipments).where(eq(shipments.id,historicalShipmentId)))[0];
  await correctShipment();
  expect(await currentCustomer()).toEqual(beforeCustomer);expect(await profileAudits()).toEqual([]);
  expect(await db.select().from(orders).where(eq(orders.organizationId,org))).toEqual(beforeOrders);
  expect((await db.select().from(shipments).where(eq(shipments.id,historicalShipmentId)))[0]).toEqual(history);
});
test('route to real canonical Customer operation saves missing state, preserving billing, identity, history and audit',async()=>{
  const reviewed=await target();const before=await currentCustomer();const order=(await db.select().from(orders).where(eq(orders.id,orderId)))[0];
  const historical=(await db.select().from(shipments).where(eq(shipments.id,historicalShipmentId)))[0];
  await correctShipment();const savedShipment=await currentShipment();const input=await submission(reviewed);
  const response=await request(app).post(endpoint()).send(input);expect(response.status).toBe(200);
  const persisted=await currentCustomer();
  expect(persisted).toMatchObject({shippingState:'IN',shippingStreet1:destination.address1,shippingStreet2:'Dock 2',billingStreet1:before.billingStreet1,billingState:'TX',companyName:before.companyName,email:before.email,phone:before.phone,notes:before.notes});
  expect(persisted.shippingAddress).toContain('IN');expect(response.body.data.updatedAt).toBe(persisted.updatedAt.toISOString());
  expect(await currentShipment()).toEqual(savedShipment);
  expect((await db.select().from(orders).where(eq(orders.id,orderId)))[0]).toEqual(order);
  expect((await db.select().from(shipments).where(eq(shipments.id,historicalShipmentId)))[0]).toEqual(historical);
  expect(await profileAudits()).toHaveLength(1);
  expect(await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId,shipmentId),eq(fulfillmentEvents.eventType,'CUSTOMER_SHIPPING_ADDRESS_UPDATED')))).toHaveLength(1);
  expect((await request(app).post(endpoint()).send(input)).status).toBe(409);expect(await profileAudits()).toHaveLength(1);
});
test('genuine missing state and blind-shipping destinations cannot replace the default profile',async()=>{
  const before=await currentCustomer();let response=await request(app).post(endpoint()).send(await submission());
  expect(response.status).toBe(409);expect(response.body.code).toBe('DESTINATION_INCOMPLETE');
  await correctShipment();const input=await submission();const current=await currentShipment();
  await db.update(shipments).set({shippingContext:{...current.shippingContext!,blindShipping:true},updatedAt:new Date(current.updatedAt.getTime()+1)}).where(eq(shipments.id,shipmentId));
  response=await request(app).post(endpoint()).send({...input,expectedShipmentUpdatedAt:(await currentShipment()).updatedAt.toISOString()});
  expect(response.status).toBe(409);expect(response.body.code).toBe('BLIND_DESTINATION');expect(await currentCustomer()).toEqual(before);
});
test('customer authorization, tenant scope, and linked customer identity are enforced',async()=>{
  await correctShipment();const input=await submission();
  const [other]=await db.insert(customers).values({organizationId:org,companyName:'Unrelated customer'}).returning();
  expect((await request(app).post(endpoint()).send({...input,customerId:other.id})).body.code).toBe('CUSTOMER_CHANGED');
  await db.delete(userOrganizations).where(eq(userOrganizations.userId,actor));
  expect((await request(app).post(endpoint()).send(input)).status).toBe(403);
  const otherOrg=`other-${randomUUID()}`;await db.insert(organizations).values({id:otherOrg,name:'Other tenant',slug:otherOrg});
  await db.insert(userOrganizations).values({organizationId:otherOrg,userId:actor,role:'member'});
  expect((await request(application(otherOrg)).get(endpoint())).status).toBe(404);
  expect((await request(application(otherOrg)).post(endpoint()).send(input)).status).toBe(404);
  expect((await currentCustomer()).shippingState).toBeNull();expect((await db.select().from(customers).where(eq(customers.id,other.id)))[0].shippingState).toBeNull();
});
test('concurrent Customer edits reject stale profile saves and preserve staff changes',async()=>{
  await correctShipment();const reviewed=await target();const input=await submission(reviewed);
  await canonicalCustomerContactOperations.updateCustomer({organizationId:org,customerId,actorUserId:actor,patch:{notes:'Concurrent staff notes',shippingState:'OH'}});
  const response=await request(app).post(endpoint()).send(input);
  expect(response.status).toBe(409);expect(response.body.code).toBe('CUSTOMER_STALE');
  expect(await currentCustomer()).toMatchObject({notes:'Concurrent staff notes',shippingState:'OH'});
});
test('a real row-lock race rejects a late stale profile write',async()=>{
  await correctShipment();const input=await submission();const holder=await competitor.connect();
  let pending:Promise<request.Response>|undefined;
  try{
    await holder.query('begin');await holder.query('update customers set shipping_state=$1, updated_at=updated_at+interval \'1 second\' where id=$2',['CA',customerId]);
    pending=request(app).post(endpoint()).send(input).then(response=>response);
    let blocked=false;
    for(let i=0;i<100;i++){
      const waits=await competitor.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%customers%' and pid<>pg_backend_pid()");
      if(waits.rowCount){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
    }
    expect(blocked).toBe(true);await holder.query('commit');
    expect((await pending).body.code).toBe('CUSTOMER_STALE');expect((await currentCustomer()).shippingState).toBe('CA');
  }finally{await holder.query('rollback');holder.release();if(pending)await pending.catch(()=>{});}
});
test('failed profile event rolls back Customer fields and audit; the already-saved shipment is retained',async()=>{
  await correctShipment();const input=await submission();const before=await currentCustomer();const shipment=await currentShipment();
  await db.execute(sql`create function qa_reject_profile_event() returns trigger language plpgsql as $$ begin raise exception 'Synthetic profile audit failure'; end; $$`);
  await db.execute(sql`create trigger qa_reject_profile_event before insert on fulfillment_events for each row when (new.event_type='CUSTOMER_SHIPPING_ADDRESS_UPDATED') execute function qa_reject_profile_event()`);
  try{
    const response=await request(app).post(endpoint()).send(input);expect(response.status).toBe(500);
    expect(response.body.message).toContain('saved shipment address is unchanged');
    expect(await currentCustomer()).toEqual(before);expect(await profileAudits()).toEqual([]);expect(await currentShipment()).toEqual(shipment);
  }finally{await db.execute(sql`drop trigger qa_reject_profile_event on fulfillment_events`);await db.execute(sql`drop function qa_reject_profile_event()`);}
});
test('changed shipment revisions, changed owners and historical shipments fail closed',async()=>{
  await correctShipment();const input=await submission();
  await db.update(shipments).set({updatedAt:new Date(Date.now()+1000)}).where(eq(shipments.id,shipmentId));
  expect((await request(app).post(endpoint()).send(input)).body.code).toBe('SHIPMENT_STALE');
  const fresh={...input,expectedShipmentUpdatedAt:(await currentShipment()).updatedAt.toISOString()};
  const [other]=await db.insert(customers).values({organizationId:org,companyName:'Changed owner'}).returning();
  await db.update(orders).set({customerId:other.id}).where(eq(orders.id,orderId));
  expect((await request(app).post(endpoint()).send(fresh)).body.code).toBe('CUSTOMER_CHANGED');
  expect((await request(app).post(`/api/fulfillment/shipments/${historicalShipmentId}/customer-shipping-address`).send(input)).body.code).toBe('INVALID_STATE');
  expect((await currentCustomer()).shippingState).toBeNull();
});
test('combined shipments with different customers cannot select an arbitrary default address',async()=>{
  await correctShipment();const input=await submission();
  const [other]=await db.insert(customers).values({organizationId:org,companyName:'Other ordering customer'}).returning();
  const [otherOrder]=await db.insert(orders).values({organizationId:org,orderNumber:`QA-${randomUUID()}`,customerId:other.id,createdByUserId:actor,shippingMethod:'ship'}).returning();
  await db.insert(shipmentOrders).values({organizationId:org,shipmentId,orderId:otherOrder.id});
  expect((await request(app).get(endpoint())).body.code).toBe('CUSTOMER_AMBIGUOUS');
  expect((await request(app).post(endpoint()).send(input)).body.code).toBe('CUSTOMER_AMBIGUOUS');
  expect((await currentCustomer()).shippingState).toBeNull();
  expect((await db.select().from(customers).where(eq(customers.id,other.id)))[0].shippingState).toBeNull();
});
