import type { OperationContext } from "../../application/operation.js";
import type { PortalPrincipal } from "../../authorization/principals.js";
import { V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import type { CustomerContactReference } from "../customers/contracts.js";
import type { CreateOrderInput, OrderOperationResult } from "../sales/orderApplication.js";
import { brandedId, type ContactId, type CustomerId, type OrganizationId } from "../shared/commercialValues.js";

/** Resolves a session to its current CRM contact; browser IDs are never authority. */
export interface PortalOrderIdentityRead { customerContact(principal: PortalPrincipal): Promise<CustomerContactReference>; }
export interface PortalOrderService { create(context: OperationContext, input: CreateOrderInput): Promise<ApplicationResult<OrderOperationResult>>; }
export type PortalOrderCommand = Readonly<{ businessRequestId:string; purchaseOrderNumber?:string; requestedDueDate?:string; requestedFulfillment?:CreateOrderInput["requestedFulfillment"]; notes?:string; lines:CreateOrderInput["lines"] }>;

const requestText=(value:string|undefined,label:string):string|undefined=>{if(value===undefined)return undefined;const normalized=value.trim();if(!normalized)return undefined;if(normalized.length>10_000)throw new V2ApplicationError("VALIDATION_ERROR",`${label} is too long.`);return normalized;};

/** A narrow portal entry boundary over canonical Sales, never a parallel order writer. */
export class PortalOrderCreationApplicationService {
  constructor(private readonly identities:PortalOrderIdentityRead,private readonly orders:PortalOrderService) {}
  async create(principal:PortalPrincipal,input:PortalOrderCommand):Promise<ApplicationResult<OrderOperationResult>> {
    const customerContact=await this.identities.customerContact(principal);
    if(customerContact.organizationId!==principal.organizationId||customerContact.customerId!==principal.customerId)throw new V2ApplicationError("FORBIDDEN","Portal customer identity is unavailable.");
    const notes=requestText(input.notes,"Order notes"),purchaseOrderNumber=requestText(input.purchaseOrderNumber,"Purchase order number");
    return this.orders.create({principal,organizationId:principal.organizationId,operationId:"portal.order.create",businessRequest:{id:input.businessRequestId,payloadFingerprint:"portal-order-http-boundary"}},{businessRequestId:input.businessRequestId,customerContact,...(purchaseOrderNumber?{purchaseOrderNumber}:{}),...(input.requestedDueDate?{requestedDueDate:input.requestedDueDate}:{}),...(input.requestedFulfillment?{requestedFulfillment:input.requestedFulfillment}:{}),...(notes?{terms:{commercialNotes:notes}}:{}),lines:input.lines});
  }
}

/** Test helper for adapters that hold already-verified CRM IDs. */
export const portalCustomerContact=(organizationId:string,customerId:string,contactId:string):CustomerContactReference=>({organizationId:brandedId<"OrganizationId">(organizationId) as OrganizationId,customerId:brandedId<"CustomerId">(customerId) as CustomerId,contactId:brandedId<"ContactId">(contactId) as ContactId});
