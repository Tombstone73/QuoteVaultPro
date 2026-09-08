import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { AiAssistantApplicationService } from "../../src/modules/ai/assistantApplication.js";
import { canonicalAiReadDefinitions, type AiReadPort } from "../../src/modules/ai/canonicalTools.js";
import { AiAssistantOrchestrator } from "../../src/modules/ai/orchestrator.js";
import { loadV2AiProviderConfig, OpenAiCompatibleAssistantProvider } from "../../src/modules/ai/provider.js";
import { AiToolRegistry } from "../../src/modules/ai/toolRegistry.js";
import type { AiAssistantHttpDependencies } from "../../src/interfaces/http/aiAssistantRoutes.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresCustomerWorkspaceReader } from "../compatibility/postgresCustomerWorkspaceRead.js";
import { PostgresProductWorkspaceReads } from "../products/postgresProductWorkspaceReads.js";
import { PostgresSalesWorkspaceReads } from "../sales/postgresSalesWorkspaceReads.js";
import { PostgresAiAssistantStore } from "./postgresAiAssistantStore.js";
import { orderProductionNotRequiredAiCommand } from "./orderWorkflowAiCommand.js";
import type { OrderWorkflowApplicationService } from "../../src/modules/sales/workflowApplication.js";

export type AuthenticatedAiAssistantRuntimeDependencies=Readonly<{pool:Pool;trustedHostIdentity:TrustedHostIdentitySource;trustedHostMiddleware:RequestHandler;workflow?:OrderWorkflowApplicationService;environment?:Readonly<Record<string,string|undefined>>}>;
export type AuthenticatedAiAssistantRuntime=Readonly<{dependencies:AiAssistantHttpDependencies;trustedHostMiddleware:RequestHandler}>;
const summary=(id:string,label:string,status?:string,detail?:string)=>({id,label,...(status?{status}:{}),...(detail?{detail}:{})});
const unsupported:AiReadPort={search:async()=>{throw new Error("This AI read tool is not composed in the current V2 runtime.");}};

/** Runtime composition is deliberately narrow: the first live AI reads reuse
 * Customer/Product/Sales projections, while uncomposed domains remain absent
 * from the registry rather than becoming raw database fallbacks. */
export const composeAuthenticatedAiAssistantRuntime=(input:AuthenticatedAiAssistantRuntimeDependencies):AuthenticatedAiAssistantRuntime=>{
  const customers=new PostgresCustomerWorkspaceReader(input.pool),products=new PostgresProductWorkspaceReads(input.pool),sales=new PostgresSalesWorkspaceReads(input.pool);
  const customerPort:AiReadPort={search:async request=>{if(request.id){const item=await customers.read(request.organizationId as never,request.id as never);return {items:item?[summary(item.customerId,item.displayName,item.contactReadiness.status,item.contacts.map(c=>c.displayName).join(", "))]:[]};}const page=await customers.list(request.organizationId as never,{query:request.query,limit:request.limit,cursor:request.cursor});return {items:page.items.map(item=>summary(item.customerId,item.displayName,undefined,item.primaryContact?.displayName)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const productPort:AiReadPort={search:async request=>{if(request.id){const item=await products.get(request.organizationId,request.id);return {items:item?[summary(item.productId,item.displayName,item.lifecycle,item.pricingSummary)]:[]};}const page=await products.list(request.organizationId,{query:request.query,page:1,pageSize:request.limit});return {items:page.items.map(item=>summary(item.productId,item.displayName,item.lifecycle,item.pricingSummary))};}};
  const quotePort:AiReadPort={search:async request=>{const page=await sales.listQuotes(request.organizationId as never,{search:request.query,limit:request.limit,cursor:request.cursor,sort:"updated_desc"});return {items:page.items.map(item=>summary(item.quoteId,`Quote ${item.number}`,item.lifecycle,item.customerDisplayName)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const orderPort:AiReadPort={search:async request=>{const page=await sales.listOrdersForWorkspace(request.organizationId as never,{search:request.query,limit:request.limit,cursor:request.cursor,sort:"updated_desc"});return {items:page.items.map(item=>summary(item.orderId,`Order ${item.number}`,item.lifecycle,item.customerDisplayName)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const definitions=canonicalAiReadDefinitions({customers:customerPort,products:productPort,quotes:quotePort,orders:orderPort,artwork:unsupported,proofs:unsupported,prepress:unsupported,production:unsupported,fulfillment:unsupported,invoices:unsupported,payments:unsupported,inbound:unsupported,pricingPreview:unsupported});
  const registry=new AiToolRegistry();for(const definition of definitions.filter(definition=>["customer.search","product.search","quote.search","order.search"].includes(definition.name)))registry.register(definition);
  const store=new PostgresAiAssistantStore(input.pool),issuer=new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool)),principals=new IssuedV2PrincipalProvider(input.trustedHostIdentity,issuer),service=new AiAssistantApplicationService(store,issuer,registry);
  if (input.workflow) service.registerCommand(orderProductionNotRequiredAiCommand(input.workflow));
  const config=loadV2AiProviderConfig(input.environment??process.env);
  const orchestrator=config.enabled?new AiAssistantOrchestrator(service,store,new OpenAiCompatibleAssistantProvider({apiKey:config.apiKey!,apiBaseUrl:config.apiBaseUrl!,model:config.model!,timeoutMs:config.timeoutMs})):undefined;
  return {dependencies:{service,principals,identity:request=>input.trustedHostIdentity.authenticatedIdentity(request),...(orchestrator?{orchestrator}:{})},trustedHostMiddleware:input.trustedHostMiddleware};
};
