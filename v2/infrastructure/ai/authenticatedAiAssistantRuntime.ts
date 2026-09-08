import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { AiAssistantApplicationService } from "../../src/modules/ai/assistantApplication.js";
import { canonicalAiReadDefinitions, type AiPricingPreviewPort, type AiReadPort } from "../../src/modules/ai/canonicalTools.js";
import { AiAssistantOrchestrator } from "../../src/modules/ai/orchestrator.js";
import { loadV2AiProviderConfig, OpenAiCompatibleAssistantProvider } from "../../src/modules/ai/provider.js";
import { AiToolRegistry } from "../../src/modules/ai/toolRegistry.js";
import type { AiAssistantHttpDependencies } from "../../src/interfaces/http/aiAssistantRoutes.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresCustomerWorkspaceReader } from "../compatibility/postgresCustomerWorkspaceRead.js";
import { PostgresProductWorkspaceReads } from "../products/postgresProductWorkspaceReads.js";
import { PostgresSalesWorkspaceReads } from "../sales/postgresSalesWorkspaceReads.js";
import { PostgresArtworkWorkspaceReads } from "../artwork/postgresArtworkWorkspaceReads.js";
import { PostgresFulfillmentWorkspaceReads } from "../fulfillment/postgresFulfillmentWorkspaceReads.js";
import { PostgresAiAssistantStore } from "./postgresAiAssistantStore.js";
import { orderProductionNotRequiredAiCommand } from "./orderWorkflowAiCommand.js";
import { inboundMarkDuplicateAiCommand } from "./inboundAiCommand.js";
import { fulfillmentPickupAiCommand, fulfillmentShipmentAiCommand, prepressSendToProductionAiCommand, productionCompleteAiCommand, productionRecordOutputAiCommand, productionStartAiCommand, proofIssueAiCommand, proofRetryDeliveryAiCommand } from "./operationalAiCommands.js";
import { recordManualPaymentAiCommand, recordManualRefundAiCommand } from "./financialAiCommands.js";
import { artworkAssignExistingAiCommand } from "./artworkAiCommand.js";
import { productAbandonDraftAiCommand, productCreateDraftAiCommand } from "./productLifecycleAiCommand.js";
import { customerAdministrationAiCommandHandlers, type CustomerAdministrationAiCommandDependencies } from "./customerAdministrationAiCommands.js";
import type { OrderWorkflowApplicationService } from "../../src/modules/sales/workflowApplication.js";
import type { ProofingApplicationService } from "../../src/modules/proofing/proofingApplication.js";
import type { PrepressApplicationService } from "../../src/modules/prepress/prepressApplication.js";
import type { ProductionApplicationService } from "../../src/modules/production/productionApplication.js";
import type { FinancialReadApplicationService } from "../../src/modules/billing/financialReadApplication.js";
import type { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import type { InboundIntakeApplicationService } from "../../src/modules/inbound/inboundIntakeApplication.js";
import type { FulfillmentApplicationService } from "../../src/modules/fulfillment/fulfillmentApplication.js";
import type { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import type { ProductVersionLifecycleApplicationService } from "../../src/modules/products/productVersionLifecycle.js";
import type { CustomerCommercialApplicationService, CustomerCommercialPricingAdapter } from "../../src/modules/products/customerCommercial.js";
import type { ProductPricingCompatibilityPort } from "../../src/modules/products/contracts.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { ApplicationResult } from "../../src/errors/applicationError.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

export type AuthenticatedAiAssistantRuntimeDependencies=Readonly<{pool:Pool;trustedHostIdentity:TrustedHostIdentitySource;trustedHostMiddleware:RequestHandler;workflow?:OrderWorkflowApplicationService;customerAdministration?:CustomerAdministrationAiCommandDependencies;artwork?:ArtworkApplicationService;productLifecycle?:ProductVersionLifecycleApplicationService;proofing?:ProofingApplicationService;prepress?:PrepressApplicationService;production?:ProductionApplicationService;fulfillmentService?:FulfillmentApplicationService;financialRead?:FinancialReadApplicationService;payments?:BillingPaymentsApplicationService;inbound?:InboundIntakeApplicationService;commercial?:Readonly<{service:CustomerCommercialApplicationService;pricing:CustomerCommercialPricingAdapter;products:ProductPricingCompatibilityPort}>;environment?:Readonly<Record<string,string|undefined>>}>;
export type AuthenticatedAiAssistantRuntime=Readonly<{dependencies:AiAssistantHttpDependencies;trustedHostMiddleware:RequestHandler}>;
const summary=(id:string,label:string,status?:string,detail?:string)=>({id,label,...(status?{status}:{}),...(detail?{detail}:{})});
const operation=(request:Parameters<AiReadPort["search"]>[0],name:string):OperationContext=>({principal:request.context.user,organizationId:request.organizationId,operationId:`ai:read:${name}:${request.context.requestId}`});
const result=<T>(value:ApplicationResult<T>):T=>{if(!value.ok)throw value.error;return value.value;};
const unsupported:AiReadPort={search:async()=>{throw new V2ApplicationError("NOT_FOUND","This AI read tool is not composed in the current V2 runtime.");}};
const unsupportedPricing:AiPricingPreviewPort={preview:async()=>{throw new V2ApplicationError("NOT_FOUND","Canonical pricing preview is not composed in the current V2 runtime.");}};

/** Runtime composition is deliberately narrow: the first live AI reads reuse
 * Customer/Product/Sales projections, while uncomposed domains remain absent
 * from the registry rather than becoming raw database fallbacks. */
export const composeAuthenticatedAiAssistantRuntime=(input:AuthenticatedAiAssistantRuntimeDependencies):AuthenticatedAiAssistantRuntime=>{
  const customers=new PostgresCustomerWorkspaceReader(input.pool),products=new PostgresProductWorkspaceReads(input.pool),sales=new PostgresSalesWorkspaceReads(input.pool),artwork=new PostgresArtworkWorkspaceReads(input.pool),fulfillment=new PostgresFulfillmentWorkspaceReads(input.pool);
  const customerPort:AiReadPort={search:async request=>{if(request.id){const item=await customers.read(request.organizationId as never,request.id as never);return {items:item?[summary(item.customerId,item.displayName,item.contactReadiness.status,item.contacts.map(c=>c.displayName).join(", "))]:[]};}const page=await customers.list(request.organizationId as never,{query:request.query,limit:request.limit,cursor:request.cursor});return {items:page.items.map(item=>summary(item.customerId,item.displayName,undefined,item.primaryContact?.displayName)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const customerActivityPort:AiReadPort={search:async request=>{if(!request.id)throw new V2ApplicationError("VALIDATION_ERROR","Customer activity requires an exact customer ID.");const customer=await customers.read(request.organizationId as never,request.id as never);if(!customer)return {items:[]};const page=await customers.activity(request.organizationId as never,request.id as never,{limit:request.limit,cursor:request.cursor});return {items:page.items.map(item=>summary(item.entityId,item.title,item.kind,item.detail)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const productPort:AiReadPort={search:async request=>{if(request.id){const item=await products.get(request.organizationId,request.id);return {items:item?[summary(item.productId,item.displayName,item.lifecycle,item.pricingSummary)]:[]};}const page=await products.list(request.organizationId,{query:request.query,page:1,pageSize:request.limit});return {items:page.items.map(item=>summary(item.productId,item.displayName,item.lifecycle,item.pricingSummary))};}};
  const quotePort:AiReadPort={search:async request=>{const page=await sales.listQuotes(request.organizationId as never,{search:request.query,limit:request.limit,cursor:request.cursor,sort:"updated_desc"});return {items:page.items.map(item=>summary(item.quoteId,`Quote ${item.number}`,item.lifecycle,item.customerDisplayName)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const orderPort:AiReadPort={search:async request=>{const page=await sales.listOrdersForWorkspace(request.organizationId as never,{search:request.query,limit:request.limit,cursor:request.cursor,sort:"updated_desc"});return {items:page.items.map(item=>summary(item.orderId,`Order ${item.number}`,item.lifecycle,item.customerDisplayName)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const artworkPort:AiReadPort={search:async request=>{
    const page=await artwork.list(request.organizationId as never,request.query??"");
    return {items:page.slice(0,request.limit).map(item=>summary(item.assignment.id,item.file.displayFilename,item.assignment.purpose,`${item.orderNumber??"Order"}${item.lineDescription?` — ${item.lineDescription}`:""}`))};
  }};
  const proofPort:AiReadPort=input.proofing?{search:async request=>{
    const page=result(await input.proofing!.listWorkQueue(operation(request,"proof"),{page:1,pageSize:request.limit>25?50:25,search:request.query}));
    return {items:page.items.slice(0,request.limit).map(item=>summary(item.work.proofWorkId,`Proof ${item.orderNumber}`,item.latest?.outcome??item.latest?.deliveryState??"pending",item.lineDescription))};
  }}:unsupported;
  const prepressPort:AiReadPort=input.prepress?{search:async request=>{
    const page=result(await input.prepress!.listQueue(operation(request,"prepress"),{page:1,pageSize:request.limit>25?50:25,search:request.query,requirementState:"all"}));
    return {items:page.items.slice(0,request.limit).map(item=>summary(item.orderLineId,`Order ${item.orderNumber}`,item.operational.readiness.ready?"ready":"blocked",[item.lineDescription,item.operational.productionDestination?`destination ${item.operational.productionDestination}`:undefined,...item.operational.readiness.blockers].filter(Boolean).join("; "))) };
  }}:unsupported;
  const productionPort:AiReadPort=input.production?{search:async request=>{
    const size=request.limit>25?50:25;
    const [flatbed,roll]=await Promise.all([input.production!.listStationQueue(operation(request,"production:flatbed"),"flatbed",{page:1,pageSize:size,search:request.query}),input.production!.listStationQueue(operation(request,"production:roll"),"roll",{page:1,pageSize:size,search:request.query})]);
    const items=[...result(flatbed).items,...result(roll).items].slice(0,request.limit);
    return {items:items.map(item=>summary(item.work.productionWorkId,item.operatorContext?.orderNumber?`Order ${item.operatorContext.orderNumber}`:"Production work",item.unitQuantitySatisfied?"complete":item.activeAttempt?"in progress":"queued",`recorded ${item.recordedGoodQuantity}/${item.work.orderedQuantity}; remaining ${item.remainingGoodQuantity}`))};
  }}:unsupported;
  const fulfillmentPort:AiReadPort={search:async request=>{const page=await fulfillment.list(request.organizationId as never,{limit:request.limit,search:request.query,cursor:request.cursor});return {items:page.items.map(item=>{const remaining=item.lines.reduce((total,line)=>total+line.remainingFulfillmentQuantity,0);const tracking=item.handoffs.find(handoff=>handoff.shipment?.trackingNumber)?.shipment?.trackingNumber;return summary(item.orderId,`Order ${item.number}`,remaining===0?"fulfilled":"remaining",`${remaining} remaining${tracking?`; tracking ${tracking}`:""}`);}),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}};
  const invoicePort:AiReadPort=input.financialRead?{search:async request=>{const page=result(await input.financialRead!.pageInvoices(operation(request,"invoices"),{page:1,pageSize:request.limit,search:request.query,sort:"updated",direction:"desc"}));return {items:page.items.map(item=>summary(item.invoiceId,`Invoice ${item.sourceOrderNumber}`,item.settlement??item.lifecycle,`${item.currency} balance ${item.balance.cents}`)),...(page.hasNextPage?{nextCursor:String(page.page+1)}:{})};}}:unsupported;
  const paymentPort:AiReadPort=input.financialRead?{search:async request=>{const page=result(await input.financialRead!.pageLedger(operation(request,"payments"),{page:1,pageSize:request.limit,search:request.query,sort:"occurred_at",direction:"desc"}));return {items:page.items.map(item=>summary(item.id,`${item.kind} for Order ${item.sourceOrderNumber}`,item.source,`${item.amount.currency} ${item.amount.cents}; balance ${item.balanceAfter.cents}`)),...(page.hasNextPage?{nextCursor:String(page.page+1)}:{})};}}:unsupported;
  const inboundPort:AiReadPort=input.inbound?{search:async request=>{if(request.id){const item=result(await input.inbound!.detail(operation(request,"inbound"),request.id as never));return {items:[summary(item.intake.id,item.intake.subject??"Inbound request",item.intake.state,item.intake.convertedOrderId?`converted to ${item.intake.convertedOrderId}`:item.intake.failureCode)]};}const page=result(await input.inbound!.list(operation(request,"inbound"),{limit:request.limit,cursor:request.cursor,search:request.query}));return {items:page.records.map(item=>summary(item.id,item.subject??"Inbound request",item.state,item.convertedOrderId?`converted to ${item.convertedOrderId}`:item.failureCode)),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};}}:unsupported;
  const pricingPort:AiPricingPreviewPort=input.commercial?{preview:async request=>{const context:OperationContext={principal:request.context.user,organizationId:request.organizationId,operationId:`ai:read:pricing:${request.context.requestId}`};await input.commercial!.service.catalogForCustomer(context,request.request.customerId as never);const resolved=await input.commercial!.products.resolveActivePricingInput({organizationId:request.organizationId as never,productId:request.request.productId as never,quantity:request.request.quantity,...(request.request.selections?{selections:request.request.selections as never}:{}),...(request.request.dimensions?{dimensions:request.request.dimensions as never}:{})});if(!resolved.ok)throw resolved.error;const priced=await input.commercial!.pricing.calculateForCustomer(request.request.customerId as never,{organizationId:request.organizationId as never,sellableProduct:resolved.value.sellableProduct,resolvedConfiguration:resolved.value.resolvedConfiguration,pricingContext:{channel:"ai",effectiveAt:new Date().toISOString()},rules:resolved.value.rules,...(resolved.value.nestingEstimate?{nestingEstimate:resolved.value.nestingEstimate}:{})});return {items:[summary(priced.id,priced.normalizedInput.productId,priced.customerPricing?"customer agreement applied":"standard price",`${priced.currency} line ${priced.calculatedLineAmount.cents}`)]};}}:unsupportedPricing;
  const definitions=canonicalAiReadDefinitions({customers:customerPort,customerActivity:customerActivityPort,products:productPort,quotes:quotePort,orders:orderPort,artwork:artworkPort,proofs:proofPort,prepress:prepressPort,production:productionPort,fulfillment:fulfillmentPort,invoices:invoicePort,payments:paymentPort,inbound:inboundPort,pricingPreview:pricingPort});
  const registry=new AiToolRegistry();for(const definition of definitions)registry.register(definition);
  const store=new PostgresAiAssistantStore(input.pool),issuer=new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool)),principals=new IssuedV2PrincipalProvider(input.trustedHostIdentity,issuer),service=new AiAssistantApplicationService(store,issuer,registry);
  if (input.workflow) service.registerCommand(orderProductionNotRequiredAiCommand(input.workflow));
  if (input.inbound) service.registerCommand(inboundMarkDuplicateAiCommand(input.inbound));
  if (input.customerAdministration) for (const command of customerAdministrationAiCommandHandlers(input.customerAdministration)) service.registerCommand(command);
  if (input.artwork) service.registerCommand(artworkAssignExistingAiCommand(input.artwork));
  if (input.productLifecycle) {
    service.registerCommand(productCreateDraftAiCommand(input.productLifecycle));
    service.registerCommand(productAbandonDraftAiCommand(input.productLifecycle));
  }
  if (input.proofing) {
    service.registerCommand(proofIssueAiCommand(input.proofing));
    service.registerCommand(proofRetryDeliveryAiCommand(input.proofing));
  }
  if (input.prepress) service.registerCommand(prepressSendToProductionAiCommand(input.prepress));
  if (input.production) {
    service.registerCommand(productionStartAiCommand(input.production));
    service.registerCommand(productionRecordOutputAiCommand(input.production));
    service.registerCommand(productionCompleteAiCommand(input.production));
  }
  if (input.fulfillmentService) {
    service.registerCommand(fulfillmentPickupAiCommand(input.fulfillmentService));
    service.registerCommand(fulfillmentShipmentAiCommand(input.fulfillmentService));
  }
  if (input.payments && input.financialRead) {
    service.registerCommand(recordManualPaymentAiCommand(input.payments,input.financialRead));
    service.registerCommand(recordManualRefundAiCommand(input.payments,input.financialRead));
  }
  const config=loadV2AiProviderConfig(input.environment??process.env);
  const orchestrator=config.enabled?new AiAssistantOrchestrator(service,store,new OpenAiCompatibleAssistantProvider({apiKey:config.apiKey!,apiBaseUrl:config.apiBaseUrl!,model:config.model!,timeoutMs:config.timeoutMs})):undefined;
  return {dependencies:{service,principals,identity:request=>input.trustedHostIdentity.authenticatedIdentity(request),...(orchestrator?{orchestrator}:{})},trustedHostMiddleware:input.trustedHostMiddleware};
};
