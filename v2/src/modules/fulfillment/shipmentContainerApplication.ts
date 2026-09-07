import { randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { FulfillmentHandoffId, OrganizationId } from "../shared/commercialValues.js";
import { manualCarrierShipment, type ManualCarrierShipment } from "./carrierShipment.js";
import type { FulfillmentShipmentContainer } from "./shipmentContainer.js";

type Actor=Readonly<{principalKind:OperationContext["principal"]["kind"];principalSubject:string;staffActorUserId?:string}>;
const actor=(c:OperationContext):Actor=>({principalKind:c.principal.kind,principalSubject:principalSubject(c.principal),...(staffActorId(c.principal)?{staffActorUserId:staffActorId(c.principal)}:{})});
export interface ShipmentContainerTransaction {
  create(input:Readonly<{id:string;organizationId:OrganizationId;customerId?:string;destination?:unknown;carrier:ManualCarrierShipment}&Actor>):Promise<FulfillmentShipmentContainer>;
  markShipped(input:Readonly<{organizationId:OrganizationId;shipmentId:string;carrier:ManualCarrierShipment}&Actor>):Promise<FulfillmentShipmentContainer|null>;
  attach(input:Readonly<{organizationId:OrganizationId;shipmentId:string;handoffIds:readonly FulfillmentHandoffId[]}>):Promise<boolean>;
}
export interface ShipmentContainerRunner { transaction<T>(work:(tx:ShipmentContainerTransaction)=>Promise<T>):Promise<T> }
export class ShipmentContainerApplicationService {
 constructor(private readonly runner:ShipmentContainerRunner,private readonly authority=new AuthorityPolicy()){}
 private allow(c:OperationContext){if(!this.authority.decide(c.principal,{capability:"fulfillment.ship",resource:{organizationId:c.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have shipment authority.");}
 async create(c:OperationContext,input:Readonly<{customerId?:string;destination?:unknown;carrier?:Omit<ManualCarrierShipment,"status"|"shippedAt">}>):Promise<ApplicationResult<FulfillmentShipmentContainer>>{try{requireOperationPrincipalScope(c);this.allow(c);const org=c.organizationId as OrganizationId;return success(await this.runner.transaction(tx=>tx.create({id:randomUUID(),organizationId:org,...(input.customerId?{customerId:input.customerId}:{}),...(input.destination?{destination:input.destination}:{}),carrier:manualCarrierShipment({status:"prepared",...(input.carrier??{})}),...actor(c)})));}catch(e){return failure(e instanceof V2ApplicationError?e:new V2ApplicationError("VALIDATION_ERROR",e instanceof Error?e.message:"Shipment could not be created."));}}
 async ship(c:OperationContext,input:Readonly<{shipmentId:string;carrier?:Omit<ManualCarrierShipment,"status"|"shippedAt">}>):Promise<ApplicationResult<FulfillmentShipmentContainer>>{try{requireOperationPrincipalScope(c);this.allow(c);const result=await this.runner.transaction(tx=>tx.markShipped({organizationId:c.organizationId as OrganizationId,shipmentId:input.shipmentId,carrier:manualCarrierShipment({status:"shipped",shippedAt:new Date().toISOString(),...(input.carrier??{})}),...actor(c)}));if(!result)throw new V2ApplicationError("NOT_FOUND","Shipment was not found.");return success(result);}catch(e){return failure(e instanceof V2ApplicationError?e:new V2ApplicationError("VALIDATION_ERROR",e instanceof Error?e.message:"Shipment could not be marked shipped."));}}
 async attach(c:OperationContext,input:Readonly<{shipmentId:string;handoffIds:readonly FulfillmentHandoffId[]}>):Promise<ApplicationResult<void>>{try{requireOperationPrincipalScope(c);this.allow(c);if(!input.handoffIds.length||new Set(input.handoffIds).size!==input.handoffIds.length)throw new V2ApplicationError("VALIDATION_ERROR","Attach one or more distinct shipment handoffs.");const attached=await this.runner.transaction(tx=>tx.attach({organizationId:c.organizationId as OrganizationId,...input}));if(!attached)throw new V2ApplicationError("CONFLICT","Shipment is not shipped, handoffs are incompatible, or an attachment already exists.");return success(undefined);}catch(e){return failure(e instanceof V2ApplicationError?e:new V2ApplicationError("VALIDATION_ERROR",e instanceof Error?e.message:"Shipment handoffs could not be attached."));}}
}
