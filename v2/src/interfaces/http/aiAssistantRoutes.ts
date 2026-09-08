import { Router } from "express";
import type { AuthenticatedIdentity } from "../../authorization/principalIssuer.js";
import type { StaffPrincipal } from "../../authorization/principals.js";
import type { AiAssistantApplicationService } from "../../modules/ai/assistantApplication.js";
import type { ApplicationResult } from "../../errors/applicationError.js";
import type { VerifiedV2PrincipalProvider } from "./quoteRoutes.js";

export type AiAssistantHttpDependencies = Readonly<{
  service: AiAssistantApplicationService;
  principals: VerifiedV2PrincipalProvider;
  /** Same trusted server session source used to issue a fresh GO-time principal. */
  identity(request: import("express").Request): Promise<AuthenticatedIdentity | null>;
}>;
const org = (request: import("express").Request): string | null => typeof request.params.organizationId === "string" && request.params.organizationId ? request.params.organizationId : null;
const staff = async (d: AiAssistantHttpDependencies, request: import("express").Request): Promise<StaffPrincipal> => { const organizationId=org(request); if(!organizationId)throw new Error("missing org");const p=await d.principals.principal(request,organizationId);if(p.kind!=="staff")throw new Error("staff required");return p; };
const reply = <T>(response: import("express").Response, result: ApplicationResult<T>) => result.ok ? response.status(200).json({ok:true,data:result.value}) : response.status(result.error.code==="FORBIDDEN"?403:400).json({ok:false,error:{code:result.error.code,message:result.error.publicMessage}});

/** There is intentionally no generic client-executed tool route.  M7.6B
 * drives prepare/read internally; HTTP only exposes owned conversation state
 * and the literal GO/CANCEL boundary. */
export const createAiAssistantRouter = (dependencies: AiAssistantHttpDependencies) => {
  const router=Router({mergeParams:true});
  router.get("/conversations",async(req,res)=>{try{return reply(res,await dependencies.service.listConversations(await staff(dependencies,req)));}catch{return res.status(403).json({ok:false,error:{code:"FORBIDDEN",message:"Authenticated staff access is required."}});}});
  router.post("/conversations",async(req,res)=>{try{const r=await dependencies.service.createConversation(await staff(dependencies,req),typeof req.body?.title==="string"?req.body.title:undefined);return reply(res,r);}catch{return res.status(403).json({ok:false,error:{code:"FORBIDDEN",message:"Authenticated staff access is required."}});}});
  router.get("/conversations/:conversationId/messages",async(req,res)=>{try{return reply(res,await dependencies.service.messages(await staff(dependencies,req),req.params.conversationId));}catch{return res.status(403).json({ok:false,error:{code:"FORBIDDEN",message:"Authenticated staff access is required."}});}});
  router.post("/conversations/:conversationId/confirm",async(req,res)=>{try{const identity=await dependencies.identity(req);if(!identity)return res.status(403).json({ok:false,error:{code:"FORBIDDEN",message:"Authentication is required."}});return reply(res,await dependencies.service.confirmGo(await staff(dependencies,req),identity,req.params.conversationId,typeof req.body?.confirmation==="string"?req.body.confirmation:""));}catch{return res.status(403).json({ok:false,error:{code:"FORBIDDEN",message:"Authenticated staff access is required."}});}});
  router.post("/conversations/:conversationId/cancel",async(req,res)=>{try{return reply(res,await dependencies.service.cancel(await staff(dependencies,req),req.params.conversationId));}catch{return res.status(403).json({ok:false,error:{code:"FORBIDDEN",message:"Authenticated staff access is required."}});}});
  return router;
};
