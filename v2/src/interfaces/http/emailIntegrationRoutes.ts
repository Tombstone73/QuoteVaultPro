import { Router } from "express";
import type { Request, Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { VerifiedV2PrincipalProvider } from "./quoteRoutes.js";
import type { TrustedHostIdentitySource } from "../../../infrastructure/authentication/trustedHostPrincipalProvider.js";
import type { PostgresEmailIntegrationService } from "../../../infrastructure/communications/postgresEmailIntegration.js";

export type EmailIntegrationHttpDependencies = Readonly<{ integrations: PostgresEmailIntegrationService; principals: VerifiedV2PrincipalProvider; identities: TrustedHostIdentitySource; publicWebOrigin?: string }>;
const status = (error:V2ApplicationError) => error.code==="FORBIDDEN"?403:error.code==="NOT_FOUND"?404:error.code==="RETRYABLE_FAILURE"?503:400;
const fail=(response:Response,cause:unknown)=>{ const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","Email integration is unavailable."); response.status(status(error)).json({ok:false,error:{code:error.code,message:error.publicMessage}}); };
const operator = async (request:Request,deps:EmailIntegrationHttpDependencies):Promise<{organizationId:string;principal:Principal}>=>{const organizationId=request.params.organizationId;if(!organizationId)throw new V2ApplicationError("VALIDATION_ERROR","organizationId is required.");const principal=await deps.principals.principal(request,organizationId);if(!new AuthorityPolicy().decide(principal,{capability:"communications.configure",resource:{organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","You do not have permission to configure Email / Communications.");return{organizationId,principal};};
const session = async (request:Request,deps:EmailIntegrationHttpDependencies) => { const identity=await deps.identities.authenticatedIdentity(request); if(!identity?.sessionId)throw new V2ApplicationError("FORBIDDEN","Authentication is required to connect Gmail."); return identity; };
const returnToSettings=(deps:EmailIntegrationHttpDependencies, response:Response, result:"connected"|"cancelled"|"error")=>{const origin=deps.publicWebOrigin?.replace(/\/$/u,"");if(!origin)return response.status(400).send("Email connection could not return to Settings.");return response.redirect(302,`${origin}/settings?email=${result}`);};

export const createEmailIntegrationRouter=(deps:EmailIntegrationHttpDependencies)=>{
  const router=Router({mergeParams:true});
  router.get("/",async(request,response)=>{try{const op=await operator(request,deps);response.json({ok:true,data:await deps.integrations.readiness(op.organizationId)});}catch(cause){fail(response,cause);}});
  router.post("/connect",async(request,response)=>{try{const op=await operator(request,deps),identity=await session(request,deps);response.json({ok:true,data:await deps.integrations.beginConnect(op.organizationId,op.principal,identity.sessionId!)});}catch(cause){fail(response,cause);}});
  router.post("/adopt-legacy",async(request,response)=>{try{const op=await operator(request,deps);response.json({ok:true,data:await deps.integrations.adoptLegacy(op.organizationId,op.principal)});}catch(cause){fail(response,cause);}});
  router.post("/disconnect",async(request,response)=>{try{const op=await operator(request,deps);response.json({ok:true,data:await deps.integrations.disconnect(op.organizationId,op.principal)});}catch(cause){fail(response,cause);}});
  return router;
};

/** Google redirects to this fixed server endpoint.  It still requires the
 * authenticated V2 session that began the flow; signed state alone is never
 * permission to bind a provider account. */
export const createEmailIntegrationCallback=(deps:EmailIntegrationHttpDependencies)=>(async(request:Request,response:Response)=>{
  const code=typeof request.query.code==="string"?request.query.code:""; const state=typeof request.query.state==="string"?request.query.state:"";
  if(typeof request.query.error==="string")return returnToSettings(deps,response,"cancelled");
  try { const identity=await session(request,deps); const payload=state.split(".")[0]; if(!payload)throw new V2ApplicationError("FORBIDDEN","Email connection state is invalid or expired."); let organizationId="";try{organizationId=String(JSON.parse(Buffer.from(payload,"base64url").toString("utf8")).organizationId??"");}catch{} if(!organizationId||!code)throw new V2ApplicationError("FORBIDDEN","Email connection state is invalid or expired."); const principal=await deps.principals.principal(request,organizationId); if(!new AuthorityPolicy().decide(principal,{capability:"communications.configure",resource:{organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","You do not have permission to configure Email / Communications."); await deps.integrations.finishConnect({state,code,principal,sessionId:identity.sessionId!}); return returnToSettings(deps,response,"connected"); }catch{return returnToSettings(deps,response,"error");}
});
