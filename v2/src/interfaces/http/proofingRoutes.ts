import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { ProofingMutationResult } from "../../modules/proofing/proofingApplication.js";
import { brandedId, type OrderId, type ProofWorkId } from "../../modules/shared/commercialValues.js";

export interface ProofingHttpService {
  listWorkQueue(context: OperationContext, limit?: number): Promise<ApplicationResult<unknown>>;
  listOrderWorks(context: OperationContext, orderId: OrderId): Promise<ApplicationResult<unknown>>;
  getWork(context: OperationContext, proofWorkId: ProofWorkId): Promise<ApplicationResult<unknown>>;
  start(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<ProofingMutationResult>>;
  createVersion(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<ProofingMutationResult>>;
  issue(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<ProofingMutationResult>>;
  retryDelivery(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<ProofingMutationResult>>;
  respond(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<ProofingMutationResult>>;
}
export interface VerifiedV2ProofingPrincipalProvider { principal(request: Request, organizationId: string): Promise<Principal>; }
export type ProofingHttpDependencies = Readonly<{ service: ProofingHttpService; principals: VerifiedV2ProofingPrincipalProvider }>;
const status=(code:string)=>code==="VALIDATION_ERROR"?400:code==="FORBIDDEN"?403:code==="NOT_FOUND"||code==="WRONG_TENANT"?404:code==="CONFLICT"||code==="STALE_STATE"||code==="IDEMPOTENCY_CONFLICT"?409:code==="RETRYABLE_FAILURE"?503:500;
const send=(response:Response,result:ApplicationResult<unknown>)=>{if(!result.ok)return response.status(status(result.error.code)).json({ok:false,error:{code:result.error.code,message:result.error.publicMessage}});return response.status(200).json({ok:true,data:result.value});};
const body=(value:unknown):Readonly<Record<string,unknown>>=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new V2ApplicationError("VALIDATION_ERROR","A Proofing command object is required.");return value as Readonly<Record<string,unknown>>;};
const context=async(request:Request,dependencies:ProofingHttpDependencies,mutation=false):Promise<OperationContext>=>{const organizationId=request.params.organizationId;if(!organizationId)throw new V2ApplicationError("VALIDATION_ERROR","organizationId is required.");const command=mutation?body(request.body):undefined;const id=command?.businessRequestId;if(mutation&&(typeof id!=="string"||!id.trim()))throw new V2ApplicationError("VALIDATION_ERROR","businessRequestId is required.");return {principal:await dependencies.principals.principal(request,organizationId),organizationId,operationId:`http:${request.method}:${request.path}`,...(mutation?{businessRequest:{id:id as string,payloadFingerprint:"route-fingerprint-is-derived-by-operation"}}:{})};};
const run=async(response:Response,operation:()=>Promise<ApplicationResult<unknown>>)=>{try{send(response,await operation());}catch(cause){const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","Proofing operation is unavailable.");response.status(status(error.code)).json({ok:false,error:{code:error.code,message:error.publicMessage}});}};

/** Authenticated bounded Proofing transport; it never owns Artwork, Sales, or Routing state. */
export const createProofingRouter=(dependencies:ProofingHttpDependencies):Router=>{const router=expressRouter({mergeParams:true});
  router.get("/orders/:orderId/works",(request,response)=>void run(response,async()=>dependencies.service.listOrderWorks(await context(request,dependencies),brandedId<"OrderId">(request.params.orderId))));
  router.get("/works",(request,response)=>void run(response,async()=>dependencies.service.listWorkQueue(await context(request,dependencies),Number(request.query.limit??50))));
  router.get("/works/:proofWorkId",(request,response)=>void run(response,async()=>dependencies.service.getWork(await context(request,dependencies),request.params.proofWorkId as ProofWorkId)));
  router.post("/works",(request,response)=>void run(response,async()=>dependencies.service.start(await context(request,dependencies,true),body(request.body))));
  router.post("/works/:proofWorkId/versions", (request,response) => void run(response, async () => dependencies.service.createVersion(await context(request,dependencies,true), {...body(request.body),proofWorkId:request.params.proofWorkId})));
  router.post("/versions/:proofVersionId/issue", (request,response) => void run(response, async () => dependencies.service.issue(await context(request,dependencies,true), {...body(request.body),proofVersionId:request.params.proofVersionId})));
  router.post("/versions/:proofVersionId/delivery/retry", (request,response) => void run(response, async () => dependencies.service.retryDelivery(await context(request,dependencies,true), {...body(request.body),proofVersionId:request.params.proofVersionId})));
  router.post("/versions/:proofVersionId/respond", (request,response) => void run(response, async () => dependencies.service.respond(await context(request,dependencies,true), {...body(request.body),proofVersionId:request.params.proofVersionId})));
  return router;
};
