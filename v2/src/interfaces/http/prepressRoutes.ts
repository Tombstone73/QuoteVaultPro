import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { PrepressMutationResult } from "../../modules/prepress/prepressApplication.js";
import type { OrderLineId, PrepressUnitId } from "../../modules/shared/commercialValues.js";

export interface PrepressHttpService {
  listQueue(context: OperationContext, limit?: number): Promise<ApplicationResult<unknown>>;
  getOrderLineCoverage(context: OperationContext, orderLineId: OrderLineId): Promise<ApplicationResult<unknown>>;
  listOrderLineUnits(context: OperationContext, orderLineId: OrderLineId): Promise<ApplicationResult<unknown>>;
  open(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<PrepressMutationResult>>;
  start(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<PrepressMutationResult>>;
  complete(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<PrepressMutationResult>>;
}
export interface VerifiedV2PrepressPrincipalProvider { principal(request: Request, organizationId: string): Promise<Principal>; }
export type PrepressHttpDependencies = Readonly<{ service: PrepressHttpService; principals: VerifiedV2PrepressPrincipalProvider }>;
const status=(code:string)=>code==="VALIDATION_ERROR"?400:code==="FORBIDDEN"?403:code==="NOT_FOUND"||code==="WRONG_TENANT"?404:code==="CONFLICT"||code==="STALE_STATE"||code==="IDEMPOTENCY_CONFLICT"?409:code==="RETRYABLE_FAILURE"?503:500;
const send=(response:Response,result:ApplicationResult<unknown>)=>{if(!result.ok)return response.status(status(result.error.code)).json({ok:false,error:{code:result.error.code,message:result.error.publicMessage}});return response.status(200).json({ok:true,data:result.value});};
const body=(value:unknown):Readonly<Record<string,unknown>>=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new V2ApplicationError("VALIDATION_ERROR","A Prepress command object is required.");return value as Readonly<Record<string,unknown>>;};
const context=async(request:Request,deps:PrepressHttpDependencies,mutation=false):Promise<OperationContext>=>{const organizationId=request.params.organizationId;if(!organizationId)throw new V2ApplicationError("VALIDATION_ERROR","organizationId is required.");const command=mutation?body(request.body):undefined;const id=command?.businessRequestId;if(mutation&&(typeof id!=="string"||!id.trim()))throw new V2ApplicationError("VALIDATION_ERROR","businessRequestId is required.");return{principal:await deps.principals.principal(request,organizationId),organizationId,operationId:`http:${request.method}:${request.path}`,...(mutation?{businessRequest:{id:id as string,payloadFingerprint:"route-fingerprint-is-derived-by-operation"}}:{})};};
const run=async(response:Response,operation:()=>Promise<ApplicationResult<unknown>>)=>{try{send(response,await operation());}catch(cause){const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","Prepress operation is unavailable.");response.status(status(error.code)).json({ok:false,error:{code:error.code,message:error.publicMessage}});}};

/** Authenticated transport for bounded queue reads and unit-scoped Prepress work. */
export const createPrepressRouter=(deps:PrepressHttpDependencies):Router=>{const router=expressRouter({mergeParams:true});
  router.get("/queue",(request,response)=>void run(response,async()=>deps.service.listQueue(await context(request,deps),Number(request.query.limit??50))));
  router.get("/lines/:orderLineId/coverage",(request,response)=>void run(response,async()=>deps.service.getOrderLineCoverage(await context(request,deps),request.params.orderLineId as OrderLineId)));
  router.get("/lines/:orderLineId/units",(request,response)=>void run(response,async()=>deps.service.listOrderLineUnits(await context(request,deps),request.params.orderLineId as OrderLineId)));
  router.post("/units",(request,response)=>void run(response,async()=>deps.service.open(await context(request,deps,true),body(request.body))));
  router.post("/units/:prepressUnitId/start",(request,response)=>void run(response,async()=>deps.service.start(await context(request,deps,true),{...body(request.body),prepressUnitId:request.params.prepressUnitId as PrepressUnitId})));
  router.post("/units/:prepressUnitId/complete",(request,response)=>void run(response,async()=>deps.service.complete(await context(request,deps,true),{...body(request.body),prepressUnitId:request.params.prepressUnitId as PrepressUnitId})));
  return router;
};
