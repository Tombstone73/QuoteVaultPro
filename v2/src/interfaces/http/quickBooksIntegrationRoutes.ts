import { Router } from "express";
import type { Request, Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { VerifiedV2PrincipalProvider } from "./quoteRoutes.js";
import type { QuickBooksIntegrationReadinessService } from "../../../infrastructure/accounting/quickBooksIntegrationReadiness.js";

export type QuickBooksIntegrationHttpDependencies=Readonly<{integrations:QuickBooksIntegrationReadinessService;principals:VerifiedV2PrincipalProvider}>;
const fail=(response:Response,cause:unknown)=>{const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","QuickBooks integration is unavailable.");response.status(error.code==="FORBIDDEN"?403:400).json({ok:false,error:{code:error.code,message:error.publicMessage}});};
const operator=async(request:Request,deps:QuickBooksIntegrationHttpDependencies):Promise<string>=>{const organizationId=request.params.organizationId;if(!organizationId)throw new V2ApplicationError("VALIDATION_ERROR","organizationId is required.");const principal:Principal=await deps.principals.principal(request,organizationId);if(!new AuthorityPolicy().decide(principal,{capability:"organization.configure",resource:{organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","You do not have permission to configure Accounting.");return organizationId;};
export const createQuickBooksIntegrationRouter=(deps:QuickBooksIntegrationHttpDependencies)=>{const router=Router({mergeParams:true});router.get("/",async(req,res)=>{try{const organizationId=await operator(req,deps);res.json({ok:true,data:await deps.integrations.readiness(organizationId)});}catch(error){fail(res,error);}});router.post("/connect",async(req,res)=>{try{const organizationId=await operator(req,deps);res.json({ok:true,data:await deps.integrations.beginConnect(organizationId)});}catch(error){fail(res,error);}});router.post("/disconnect",async(req,res)=>{try{const organizationId=await operator(req,deps);res.json({ok:true,data:await deps.integrations.disconnect(organizationId)});}catch(error){fail(res,error);}});return router;};
