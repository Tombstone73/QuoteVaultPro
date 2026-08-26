import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { FulfillmentTransaction, FulfillmentTransactionRunner } from "../../src/modules/fulfillment/fulfillmentApplication.js";
import { fulfillmentPhysicalIntegrityAnomaly, type FulfillmentAvailability, type FulfillmentHandoff, type FulfillmentHandoffLine } from "../../src/modules/fulfillment/contracts.js";
import { brandedId, type FulfillmentHandoffId, type OrganizationId, type OrderId } from "../../src/modules/shared/commercialValues.js";

type HandoffRow={id:string;organization_id:string;order_document_id:string;handoff_method:"pickup"|"shipment";completed_at:Date;customer_id:string|null;contact_id:string|null;completed_principal_kind:FulfillmentHandoff["completedPrincipalKind"];completed_principal_subject:string;completed_staff_actor_user_id:string|null};
type LineRow={id:string;organization_id:string;handoff_id:string;order_document_id:string;order_line_id:string;quantity:number};
type AvailabilityRow={order_document_id:string;order_line_id:string;ordered_quantity:number;pickup_quantity:string;shipment_quantity:string;completed_production_quantity:string};
const handoff=(r:HandoffRow):FulfillmentHandoff=>({handoffId:brandedId<"FulfillmentHandoffId">(r.id),organizationId:brandedId<"OrganizationId">(r.organization_id),orderId:brandedId<"OrderId">(r.order_document_id),method:r.handoff_method,completedAt:r.completed_at.toISOString(),...(r.customer_id?{customerId:brandedId<"CustomerId">(r.customer_id)}:{}),...(r.contact_id?{contactId:brandedId<"ContactId">(r.contact_id)}:{}),completedPrincipalKind:r.completed_principal_kind,completedPrincipalSubject:r.completed_principal_subject,...(r.completed_staff_actor_user_id?{completedStaffActorUserId:r.completed_staff_actor_user_id}:{})});
const allocation=(r:LineRow):FulfillmentHandoffLine=>({handoffLineId:brandedId<"FulfillmentHandoffLineId">(r.id),organizationId:brandedId<"OrganizationId">(r.organization_id),handoffId:brandedId<"FulfillmentHandoffId">(r.handoff_id),orderId:brandedId<"OrderId">(r.order_document_id),orderLineId:brandedId<"OrderLineId">(r.order_line_id),quantity:r.quantity});
const availability=(r:AvailabilityRow):FulfillmentAvailability=>{
 const pickup=Number(r.pickup_quantity),shipment=Number(r.shipment_quantity),completedFulfillment=pickup+shipment;
 const completedProduction=Math.min(r.ordered_quantity,Math.max(0,Number(r.completed_production_quantity)));
 const physicalAvailable=Math.max(0,completedProduction-completedFulfillment);
 const anomaly=fulfillmentPhysicalIntegrityAnomaly(completedProduction,completedFulfillment);
 return {orderId:brandedId<"OrderId">(r.order_document_id),orderLineId:brandedId<"OrderLineId">(r.order_line_id),orderedQuantity:r.ordered_quantity,completedPickupQuantity:pickup,completedShipmentQuantity:shipment,completedFulfillmentQuantity:completedFulfillment,completedProductionQuantity:completedProduction,availableFulfillmentQuantity:physicalAvailable,remainingProductionQuantity:Math.max(0,r.ordered_quantity-completedProduction),remainingFulfillmentQuantity:Math.max(0,r.ordered_quantity-completedFulfillment),...(anomaly?{physicalIntegrityAnomaly:anomaly}:{})};
};
/**
 * Production remains the source of physical output. A sellable unit is available only
 * when every frozen required production unit has completed that many good copies.
 * No requirement or no completed work therefore safely yields zero available output.
 */
const availabilitySql=`WITH production_output AS (
  SELECT l.id order_line_id,
    COALESCE(MIN(COALESCE(unit_output.completed_good_quantity,0)),0)::text completed_production_quantity
  FROM v2_sales_document_lines l
  LEFT JOIN v2_sales_line_production_requirements r ON r.organization_id=l.organization_id AND r.order_line_id=l.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.good_quantity) FILTER (WHERE a.completed_at IS NOT NULL),0) completed_good_quantity
    FROM v2_production_works w
    LEFT JOIN v2_production_attempts a ON a.organization_id=w.organization_id AND a.production_work_id=w.id
    WHERE w.organization_id=l.organization_id AND w.order_line_id=l.id AND w.requirement_key=r.requirement_key
  ) unit_output ON r.requirement_key IS NOT NULL
  WHERE l.organization_id=$1 AND l.document_id=$2
  GROUP BY l.id
), fulfillment_output AS (
  SELECT l.id order_line_id,
    COALESCE(SUM(fhl.quantity) FILTER (WHERE fh.handoff_method='pickup'),0)::text pickup_quantity,
    COALESCE(SUM(fhl.quantity) FILTER (WHERE fh.handoff_method='shipment'),0)::text shipment_quantity
  FROM v2_sales_document_lines l
  LEFT JOIN v2_fulfillment_handoff_lines fhl ON fhl.organization_id=l.organization_id AND fhl.order_document_id=l.document_id AND fhl.order_line_id=l.id
  LEFT JOIN v2_fulfillment_handoffs fh ON fh.organization_id=fhl.organization_id AND fh.id=fhl.handoff_id
  WHERE l.organization_id=$1 AND l.document_id=$2
  GROUP BY l.id
) SELECT l.document_id order_document_id,l.id order_line_id,l.quantity ordered_quantity,
  f.pickup_quantity,f.shipment_quantity,p.completed_production_quantity
  FROM v2_sales_document_lines l
  JOIN production_output p ON p.order_line_id=l.id
  JOIN fulfillment_output f ON f.order_line_id=l.id
  WHERE l.organization_id=$1 AND l.document_id=$2 ORDER BY l.id`;
export type FulfillmentPersistenceTestHooks=Readonly<{afterHandoff?:()=>Promise<void>;afterAllocation?:()=>Promise<void>;afterAudit?:()=>Promise<void>}>;

/** PostgreSQL adapter: Sales locks serialize handoffs; Production is read-only physical evidence. */
export class PostgresFulfillmentTransaction implements FulfillmentTransaction {
 private readonly requests=new PostgresOperationRequestRepository();
 constructor(private readonly client:PoolClient,private readonly hooks?:FulfillmentPersistenceTestHooks){}
 async reserve(input:Parameters<FulfillmentTransaction["reserve"]>[0]){const r=await this.requests.reserve(this.client,input);return {kind:r.kind,request:{id:r.request.id,resultJson:r.request.resultJson}};}
 async succeed(org:string,id:string,result:Parameters<FulfillmentTransaction["succeed"]>[2]){await this.requests.succeed(this.client,org,id,{resourceType:"fulfillment_handoff",resourceId:result.handoff.handoffId,resultJson:result});}
 async attribute(input:Parameters<FulfillmentTransaction["attribute"]>[0]){await this.requests.recordAttribution(this.client,{organizationId:input.organizationId,operationRequestId:input.requestId,operation:input.operation,resourceType:"fulfillment_handoff",resourceId:input.resourceId,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});}
 async audit(input:Parameters<FulfillmentTransaction["audit"]>[0]){await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'fulfillment_handoff',$5,$6,$7,$8,$9::jsonb)",[input.organizationId,input.requestId,input.operation,`fulfillment_${input.method}_completed`,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId??null,JSON.stringify(input.allocations.map(a=>({kind:"fulfillment_line_completed",method:input.method,orderLineId:a.orderLineId,quantity:a.quantity})))]);await this.hooks?.afterAudit?.();}
 async lockAvailability(org:OrganizationId,orderId:OrderId,lineIds:readonly string[]){if(!lineIds.length)return null;const ids=[...lineIds].sort();const locked=await this.client.query<{id:string;customer_id:string|null;contact_id:string|null}>("SELECT l.id,d.customer_id,d.contact_id FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='order' AND o.commercial_state='open' AND l.id=ANY($3::text[]) ORDER BY l.id FOR UPDATE OF d,o,l",[org,orderId,ids]);if(locked.rows.length!==ids.length)return null;const values=await this.client.query<AvailabilityRow>(availabilitySql,[org,orderId]);return {...(locked.rows[0]?.customer_id?{customerId:locked.rows[0].customer_id}:{}),...(locked.rows[0]?.contact_id?{contactId:locked.rows[0].contact_id}:{}),availability:values.rows.filter(x=>ids.includes(x.order_line_id)).map(availability)};}
 async createHandoff(input:Parameters<FulfillmentTransaction["createHandoff"]>[0]){const r=await this.client.query<HandoffRow>("INSERT INTO v2_fulfillment_handoffs(id,organization_id,order_document_id,handoff_method,customer_id,contact_id,completed_principal_kind,completed_principal_subject,completed_staff_actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[input.id,input.organizationId,input.orderId,input.method,input.customerId??null,input.contactId??null,input.principalKind,input.principalSubject,input.staffActorUserId??null]);await this.hooks?.afterHandoff?.();return handoff(r.rows[0]!);}
 async createAllocations(input:Parameters<FulfillmentTransaction["createAllocations"]>[0]){if(!input.allocations.length)return [];const rows:FulfillmentHandoffLine[]=[];for(const item of input.allocations){const r=await this.client.query<LineRow>("INSERT INTO v2_fulfillment_handoff_lines(id,organization_id,handoff_id,order_document_id,order_line_id,quantity) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[item.id,input.organizationId,input.handoffId,input.orderId,item.orderLineId,item.quantity]);rows.push(allocation(r.rows[0]!));await this.hooks?.afterAllocation?.();}return rows;}
 async readAvailability(org:OrganizationId,orderId:OrderId){const scope=await this.client.query<{customer_id:string|null;contact_id:string|null}>("SELECT customer_id,contact_id FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind='order'",[org,orderId]);if(!scope.rows[0])return null;const r=await this.client.query<AvailabilityRow>(availabilitySql,[org,orderId]);return {...(scope.rows[0].customer_id?{customerId:scope.rows[0].customer_id}:{}),...(scope.rows[0].contact_id?{contactId:scope.rows[0].contact_id}:{}),availability:r.rows.map(availability)};}
}
export class PostgresFulfillmentTransactionRunner implements FulfillmentTransactionRunner {constructor(private readonly pool:Pool,private readonly hooks?:FulfillmentPersistenceTestHooks){}async transaction<T>(action:(tx:FulfillmentTransaction)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const result=await action(new PostgresFulfillmentTransaction(client,this.hooks));await client.query("COMMIT");return result;}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}}
