import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { CustomerId, OrganizationId } from "../shared/commercialValues.js";
import { resolveShippingPricingPolicy, shippingPriceFromResolvedPolicy, type ResolvedShippingPricingPolicy, type ShippingPricingMode, type ShippingPricingPolicy, type ShippingResponsibility } from "./replacementShippingEconomics.js";

export type ShippingPricingPolicyInput = Readonly<{ mode: ShippingPricingMode; flatAmountCents?: number; percentageBasisPoints?: number; currency: string }>;
export type ShippingPolicyRead = Readonly<{ organizationDefault?: ShippingPricingPolicy; customerOverride?: ShippingPricingPolicy }>;
export type StaffShippingEconomics = Readonly<{ shipmentId:string; customerId?:string; estimatedCarrierCostCents?:number; actualCarrierCostCents?:number; customerShippingPriceCents?:number; customerPriceFrozen:boolean; pricingPolicySnapshot?: Readonly<{ policy:ShippingPricingPolicy; source:ResolvedShippingPricingPolicy["source"]; establishedAt:string }>; }>;
type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject:string; staffActorUserId?:string }>;

export interface ShippingEconomicsPort {
  policy(organizationId:OrganizationId, customerId?:CustomerId):Promise<ShippingPolicyRead>;
  savePolicy(input:Readonly<{organizationId:OrganizationId;customerId?:CustomerId;policy?:ShippingPricingPolicyInput}>&Actor):Promise<ShippingPolicyRead>;
  shipment(organizationId:OrganizationId, shipmentId:string, lock?:boolean):Promise<StaffShippingEconomics|null>;
  setEstimated(input:Readonly<{organizationId:OrganizationId;shipmentId:string;estimatedCarrierCostCents:number}>&Actor):Promise<StaffShippingEconomics|null>;
  setActual(input:Readonly<{organizationId:OrganizationId;shipmentId:string;actualCarrierCostCents:number;responsibility:ShippingResponsibility;reason:string;note?:string}>&Actor):Promise<StaffShippingEconomics|null>;
  freezeCustomerPrice(input:Readonly<{organizationId:OrganizationId;shipmentId:string;customerShippingPriceCents:number;snapshot:StaffShippingEconomics["pricingPolicySnapshot"]}>&Actor):Promise<StaffShippingEconomics|null>;
}
export interface ShippingEconomicsRunner { transaction<T>(work:(port:ShippingEconomicsPort)=>Promise<T>):Promise<T> }
const actor=(context:OperationContext):Actor=>({principalKind:context.principal.kind,principalSubject:principalSubject(context.principal),...(staffActorId(context.principal)?{staffActorUserId:staffActorId(context.principal)}:{})});
const money=(value:number,label:string)=>{if(!Number.isSafeInteger(value)||value<0)throw new V2ApplicationError("VALIDATION_ERROR",`${label} must be a non-negative whole-cent amount.`);return value;};
const policy=(input:ShippingPricingPolicyInput, version=1):ShippingPricingPolicy=>{
  if(!/^[A-Z]{3}$/.test(input.currency))throw new V2ApplicationError("VALIDATION_ERROR","Shipping policy currency must be a three-letter uppercase code.");
  if(input.mode==="flat"&&input.flatAmountCents===undefined)throw new V2ApplicationError("VALIDATION_ERROR","Flat shipping policy requires a whole-cent markup.");
  if(input.mode!=="flat"&&input.flatAmountCents!==undefined)throw new V2ApplicationError("VALIDATION_ERROR","Only flat shipping policy accepts a flat markup.");
  if(input.flatAmountCents!==undefined)money(input.flatAmountCents,"Flat shipping markup");
  if(input.mode==="percent"&&(input.percentageBasisPoints===undefined||!Number.isSafeInteger(input.percentageBasisPoints)||input.percentageBasisPoints<0))throw new V2ApplicationError("VALIDATION_ERROR","Percentage shipping policy requires non-negative whole basis points.");
  if(input.mode!=="percent"&&input.percentageBasisPoints!==undefined)throw new V2ApplicationError("VALIDATION_ERROR","Only percentage shipping policy accepts basis points.");
  return {mode:input.mode,currency:input.currency,version,...(input.flatAmountCents===undefined?{}:{flatAmountCents:input.flatAmountCents}),...(input.percentageBasisPoints===undefined?{}:{percentageBasisPoints:input.percentageBasisPoints})};
};

/** Canonical staff-only policy and shipment-economics authority. Portal principals are never admitted. */
export class ShippingEconomicsApplicationService {
  constructor(private readonly runner:ShippingEconomicsRunner,private readonly authority=new AuthorityPolicy()){}
  private allow(context:OperationContext, capability:"fulfillment.shipping.cost"|"fulfillment.shipping.price"){requireOperationPrincipalScope(context);if(context.principal.kind!=="staff"||!this.authority.decide(context.principal,{capability,resource:{organizationId:context.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","Shipment economics are staff-only.");}
  async readPolicy(context:OperationContext,customerId?:CustomerId){this.allow(context,"fulfillment.shipping.price");return this.runner.transaction(port=>port.policy(context.organizationId as OrganizationId,customerId));}
  async saveOrganizationPolicy(context:OperationContext,input:ShippingPricingPolicyInput){this.allow(context,"fulfillment.shipping.price");policy(input);return this.runner.transaction(port=>port.savePolicy({organizationId:context.organizationId as OrganizationId,policy:input,...actor(context)}));}
  async saveCustomerPolicy(context:OperationContext,customerId:CustomerId,input?:ShippingPricingPolicyInput){this.allow(context,"fulfillment.shipping.price");if(input)policy(input);return this.runner.transaction(port=>port.savePolicy({organizationId:context.organizationId as OrganizationId,customerId,policy:input,...actor(context)}));}
  async readShipment(context:OperationContext,shipmentId:string){this.allow(context,"fulfillment.shipping.cost");return this.runner.transaction(port=>port.shipment(context.organizationId as OrganizationId,shipmentId));}
  async setEstimatedCost(context:OperationContext,input:Readonly<{shipmentId:string;estimatedCarrierCostCents:number}>){this.allow(context,"fulfillment.shipping.cost");money(input.estimatedCarrierCostCents,"Estimated carrier cost");return this.runner.transaction(port=>port.setEstimated({organizationId:context.organizationId as OrganizationId,...input,...actor(context)}));}
  async setActualCost(context:OperationContext,input:Readonly<{shipmentId:string;actualCarrierCostCents:number;responsibility:ShippingResponsibility;reason:string;note?:string}>){this.allow(context,"fulfillment.shipping.cost");money(input.actualCarrierCostCents,"Actual carrier cost");if(!input.reason.trim())throw new V2ApplicationError("VALIDATION_ERROR","Actual carrier cost requires a reason.");return this.runner.transaction(port=>port.setActual({organizationId:context.organizationId as OrganizationId,...input,reason:input.reason.trim(),...(input.note?.trim()?{note:input.note.trim()}:{}),...actor(context)}));}
  async establishCustomerPrice(context:OperationContext,input:Readonly<{shipmentId:string;manualCustomerPriceCents?:number}>){this.allow(context,"fulfillment.shipping.price");return this.runner.transaction(async port=>{const shipment=await port.shipment(context.organizationId as OrganizationId,input.shipmentId,true);if(!shipment)throw new V2ApplicationError("NOT_FOUND","Shipment was not found.");if(shipment.customerPriceFrozen)throw new V2ApplicationError("CONFLICT","Customer shipping price is already frozen.");const policies=await port.policy(context.organizationId as OrganizationId,shipment.customerId as CustomerId|undefined);const resolved=resolveShippingPricingPolicy(policies.organizationDefault,policies.customerOverride);let customerShippingPriceCents:number;try{customerShippingPriceCents=shippingPriceFromResolvedPolicy({estimatedCarrierCostCents:shipment.estimatedCarrierCostCents,resolved,manualCustomerPriceCents:input.manualCustomerPriceCents});}catch(error){throw new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Customer shipping price cannot be established.");}const snapshot={policy:resolved.policy,source:resolved.source,establishedAt:new Date().toISOString()} as const;const saved=await port.freezeCustomerPrice({organizationId:context.organizationId as OrganizationId,shipmentId:input.shipmentId,customerShippingPriceCents,snapshot,...actor(context)});if(!saved)throw new V2ApplicationError("CONFLICT","Shipment changed before customer shipping price could be frozen.");return saved;});}
}
