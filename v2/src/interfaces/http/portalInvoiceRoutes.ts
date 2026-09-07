import { Router, type Request, type Response } from "express";
import { brandedId } from "../../modules/shared/commercialValues.js";
import type { PortalPrincipal, Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { InvoiceHttpDependencies } from "./invoiceRoutes.js";
import type { FinanceHttpDependencies } from "./financeRoutes.js";
import { stripeRuntimeReadiness } from "../../../../server/lib/stripe.js";
import { requireV2CsrfToken } from "../../../infrastructure/authentication/sessionCsrf.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { PortalCommercialRead } from "../../modules/portal/commercialReads.js";

export interface PortalProofRead { list(principal:PortalPrincipal):Promise<readonly unknown[]>;get(principal:PortalPrincipal,proofVersionId:string):Promise<unknown>;file(principal:PortalPrincipal,proofVersionId:string,artworkFileId:string):Promise<Readonly<{filename:string;contentType:string;bytes:Uint8Array}>>; }
export interface PortalProofResponseService { respond(context:ReturnType<typeof operation>,input:Readonly<Record<string,unknown>>):Promise<Readonly<{ok:true;value:unknown}|{ok:false;error:V2ApplicationError}>>; }
type Dependencies = InvoiceHttpDependencies & FinanceHttpDependencies & Readonly<{ portalPrincipal: Readonly<{principal(request:Request):Promise<Principal>}>;proofs?:PortalProofRead;proofing?:PortalProofResponseService;commercial?:PortalCommercialRead }>;
const fail=(response:Response,error:V2ApplicationError)=>response.status(error.code==="FORBIDDEN"?403:error.code==="NOT_FOUND"||error.code==="WRONG_TENANT"?404:error.code==="CONFLICT"||error.code==="STALE_STATE"?409:error.code==="VALIDATION_ERROR"?400:500).json({ok:false,error:{code:error.code,message:error.publicMessage}});
const operation=(principal:Principal,organizationId:string,id:string,businessRequestId?:string)=>({principal,organizationId,operationId:id,...(businessRequestId?{businessRequest:{id:businessRequestId,payloadFingerprint:"portal-http-boundary"}}:{})});
const requestId=(value:unknown)=>typeof value==="string"&&value.trim()?value.trim():"";

/** Customer-facing V2 projection. Organization and customer scope are only
 * obtained from the authenticated portal principal; neither is URL input. */
export const createPortalInvoiceRouter=(dependencies:Dependencies)=>{
  const router=Router();
  const principal=async(request:Request):Promise<PortalPrincipal>=>{const value=await dependencies.portalPrincipal.principal(request);if(value.kind!=="portal")throw new V2ApplicationError("FORBIDDEN","Portal access is required.");return value;};
  const commercial=async(request:Request,capability:"order.view"|"quote.view")=>{if(!dependencies.commercial)throw new V2ApplicationError("NOT_FOUND","Portal commercial access is unavailable.");const actor=await principal(request);if(!new AuthorityPolicy().decide(actor,{capability,resource:{organizationId:actor.organizationId,customerId:actor.customerId}}).allowed)throw new V2ApplicationError("FORBIDDEN","Portal access is unavailable.");return actor;};
  router.get("/orders",async(request,response)=>{try{const actor=await commercial(request,"order.view"),cursor=typeof request.query.cursor==="string"?request.query.cursor:undefined;return response.json({ok:true,data:await dependencies.commercial!.listOrders(actor,cursor)});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Orders are unavailable."));}});
  router.get("/orders/dashboard",async(request,response)=>{try{const actor=await commercial(request,"order.view");return response.json({ok:true,data:await dependencies.commercial!.ordersDashboard(actor)});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Orders are unavailable."));}});
  router.get("/orders/:orderId",async(request,response)=>{try{const actor=await commercial(request,"order.view"),value=await dependencies.commercial!.getOrder(actor,request.params.orderId);if(!value)throw new V2ApplicationError("NOT_FOUND","Order was not found.");return response.json({ok:true,data:value});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("NOT_FOUND","Order was not found."));}});
  router.get("/quotes",async(request,response)=>{try{const actor=await commercial(request,"quote.view"),cursor=typeof request.query.cursor==="string"?request.query.cursor:undefined;return response.json({ok:true,data:await dependencies.commercial!.listQuotes(actor,cursor)});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Quotes are unavailable."));}});
  router.get("/quotes/:quoteId",async(request,response)=>{try{const actor=await commercial(request,"quote.view"),value=await dependencies.commercial!.getQuote(actor,request.params.quoteId);if(!value)throw new V2ApplicationError("NOT_FOUND","Quote was not found.");return response.json({ok:true,data:value});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("NOT_FOUND","Quote was not found."));}});
  router.get("/invoices",async(request,response)=>{
    try { const actor=await principal(request); const result=await dependencies.financialRead.listInvoices(operation(actor,actor.organizationId,`portal:GET:${request.path}`)); if(!result.ok)return fail(response,result.error); return response.json({ok:true,data:{items:result.value.filter((item)=>item.source==="v2").sort((a,b)=>Number(b.balance.cents>0)-Number(a.balance.cents>0)||b.updatedAt.localeCompare(a.updatedAt))}}); }
    catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("FORBIDDEN","Portal invoice access is unavailable."));}
  });
  router.get("/invoices/:invoiceId",async(request,response)=>{
    try { const actor=await principal(request); const result=await dependencies.financialRead.readInvoice(operation(actor,actor.organizationId,`portal:GET:${request.path}`),brandedId<"InvoiceId">(request.params.invoiceId)); if(!result.ok)return fail(response,result.error); return response.json({ok:true,data:result.value}); }
    catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("FORBIDDEN","Portal invoice access is unavailable."));}
  });
  router.get("/invoices/:invoiceId/document.pdf",async(request,response)=>{
    try { if(!dependencies.documents)throw new V2ApplicationError("INTERNAL_ERROR","Invoice document runtime is unavailable."); const actor=await principal(request),invoiceId=brandedId<"InvoiceId">(request.params.invoiceId); const read=await dependencies.service.readInvoice(operation(actor,actor.organizationId,`portal:GET:${request.path}`),invoiceId); if(!read.ok)return fail(response,read.error); const [bytes,filename]=await Promise.all([dependencies.documents.pdf(brandedId<"OrganizationId">(actor.organizationId),invoiceId),dependencies.documents.filename(brandedId<"OrganizationId">(actor.organizationId),invoiceId)]); response.status(200).setHeader("content-type","application/pdf");response.setHeader("content-disposition",`inline; filename="${filename}"`);response.setHeader("cache-control","private, no-store");return response.send(Buffer.from(bytes)); }
    catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Invoice document is unavailable."));}
  });
  router.post("/payments/stripe/payment-intents",requireV2CsrfToken,async(request,response)=>{
    try {
      const actor=await principal(request),businessRequestId=requestId(request.body?.businessRequestId),raw=request.body?.allocations;
      if(!businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A payment request identity is required.");
      if(!Array.isArray(raw)||raw.length<1||raw.length>25)throw new V2ApplicationError("VALIDATION_ERROR","Choose between one and 25 Invoice allocations.");
      const seen=new Set<string>();
      const allocations=raw.map((value)=>{
        const invoiceId=typeof value?.invoiceId==="string"?value.invoiceId.trim():"",amountCents=value?.amountCents;
        if(!invoiceId||seen.has(invoiceId)||!Number.isSafeInteger(amountCents)||amountCents<=0)throw new V2ApplicationError("VALIDATION_ERROR","Each Invoice allocation must be unique and use positive exact cents.");
        seen.add(invoiceId); return {invoiceId,amountCents};
      });
      const invoices=await Promise.all(allocations.map(async(allocation)=>{
        const result=await dependencies.financialRead.readInvoice(operation(actor,actor.organizationId,`portal:GET:${request.path}:${allocation.invoiceId}`),brandedId<"InvoiceId">(allocation.invoiceId));
        if(!result.ok)throw result.error;
        if(result.value.invoice.lifecycle==="void")throw new V2ApplicationError("CONFLICT","A void Invoice cannot accept payment.");
        if(allocation.amountCents>result.value.settlement.balance.cents)throw new V2ApplicationError("CONFLICT","A Payment allocation exceeds the current Invoice balance.");
        return result.value;
      }));
      const currency=invoices[0]!.settlement.balance.currency;
      if(invoices.some((invoice)=>invoice.settlement.balance.currency!==currency))throw new V2ApplicationError("VALIDATION_ERROR","One card payment cannot span Invoice currencies.");
      const readiness=stripeRuntimeReadiness();if(readiness.status!=="ready"||!readiness.publishableKey)throw new V2ApplicationError("CONFLICT","Card payment is not ready for this account.");
      const result=await dependencies.stripePayments.beginPaymentAggregate(operation(actor,actor.organizationId,`portal:POST:${request.path}`,businessRequestId),{organizationId:actor.organizationId,currency,allocations,businessRequestId});
      if(!result.ok)return fail(response,result.error);
      return response.status(200).json({ok:true,data:{...result.value,publishableKey:readiness.publishableKey}});
    } catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("RETRYABLE_FAILURE","Card payment could not be prepared."));}
  });
  router.post("/invoices/:invoiceId/stripe/payment-intents",requireV2CsrfToken,async(request,response)=>{
    try { const actor=await principal(request),invoiceId=brandedId<"InvoiceId">(request.params.invoiceId),businessRequestId=requestId(request.body?.businessRequestId); if(!businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A payment request identity is required."); const read=await dependencies.financialRead.readInvoice(operation(actor,actor.organizationId,`portal:GET:${request.path}`),invoiceId); if(!read.ok)return fail(response,read.error); const balance=read.value.settlement.balance; if(balance.cents<=0)throw new V2ApplicationError("CONFLICT",balance.cents<0?"This Invoice has a credit due and cannot accept another payment.":"This Invoice is paid."); if(read.value.invoice.lifecycle==="void")throw new V2ApplicationError("CONFLICT","A void Invoice cannot accept payment."); const readiness=stripeRuntimeReadiness();if(readiness.status!=="ready"||!readiness.publishableKey)throw new V2ApplicationError("CONFLICT","Card payment is not ready for this account."); const result=await dependencies.stripePayments.beginPayment(operation(actor,actor.organizationId,`portal:POST:${request.path}`,businessRequestId),{organizationId:actor.organizationId,invoiceId,amountCents:balance.cents,currency:balance.currency,businessRequestId});if(!result.ok)return fail(response,result.error);return response.status(200).json({ok:true,data:{...result.value,publishableKey:readiness.publishableKey}}); }
    catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("RETRYABLE_FAILURE","Card payment could not be prepared."));}
  });
  router.get("/proofs",async(request,response)=>{try{if(!dependencies.proofs)throw new V2ApplicationError("INTERNAL_ERROR","Proof review is unavailable.");const actor=await principal(request);return response.json({ok:true,data:{items:await dependencies.proofs.list(actor)}});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Proof review is unavailable."));}});
  router.get("/proofs/:proofVersionId",async(request,response)=>{try{if(!dependencies.proofs)throw new V2ApplicationError("INTERNAL_ERROR","Proof review is unavailable.");const actor=await principal(request);return response.json({ok:true,data:await dependencies.proofs.get(actor,request.params.proofVersionId)});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("NOT_FOUND","Proof was not found."));}});
  router.get("/proofs/:proofVersionId/files/:artworkFileId",async(request,response)=>{try{if(!dependencies.proofs)throw new V2ApplicationError("INTERNAL_ERROR","Proof review is unavailable.");const actor=await principal(request),file=await dependencies.proofs.file(actor,request.params.proofVersionId,request.params.artworkFileId);const filename=file.filename.replace(/["\\\r\n]/gu,"");response.status(200).setHeader("content-type",file.contentType);response.setHeader("content-disposition",`inline; filename="${filename}"`);response.setHeader("cache-control","private, no-store");return response.send(Buffer.from(file.bytes));}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("NOT_FOUND","Proof file was not found."));}});
  router.post("/proofs/:proofVersionId/respond",requireV2CsrfToken,async(request,response)=>{try{if(!dependencies.proofing)throw new V2ApplicationError("INTERNAL_ERROR","Proof response is unavailable.");const actor=await principal(request),businessRequestId=requestId(request.body?.businessRequestId),outcome=request.body?.outcome,comment=typeof request.body?.comment==="string"?request.body.comment:undefined;if(!businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A response request identity is required.");if(outcome!=="approved"&&outcome!=="revision_requested")throw new V2ApplicationError("VALIDATION_ERROR","Choose Approve or Request Changes.");if(dependencies.proofs)await dependencies.proofs.get(actor,request.params.proofVersionId);const result=await dependencies.proofing.respond(operation(actor,actor.organizationId,`portal:POST:${request.path}`,businessRequestId),{businessRequestId,proofVersionId:request.params.proofVersionId,outcome,...(comment===undefined?{}:{comment})});if(!result.ok)return fail(response,result.error);return response.json({ok:true,data:result.value});}catch(error){return fail(response,error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Proof response could not be recorded."));}});
  return router;
};
