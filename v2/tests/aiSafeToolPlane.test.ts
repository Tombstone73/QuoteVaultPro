import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AiAssistantApplicationService, type AiAssistantStore } from "../src/modules/ai/assistantApplication.js";
import { canonicalAiReadDefinitions } from "../src/modules/ai/canonicalTools.js";
import type { AiConversation, AiConversationMessage, AiPendingCommand, AiPreparedCommand } from "../src/modules/ai/contracts.js";
import { AiToolRegistry } from "../src/modules/ai/toolRegistry.js";
import { AiAssistantOrchestrator } from "../src/modules/ai/orchestrator.js";
import { loadV2AiProviderConfig, type AiAssistantProvider } from "../src/modules/ai/provider.js";
import { orderProductionNotRequiredAiCommand } from "../infrastructure/ai/orderWorkflowAiCommand.js";
import { inboundMarkDuplicateAiCommand } from "../infrastructure/ai/inboundAiCommand.js";
import type { PrincipalIssuer } from "../src/authorization/principalIssuer.js";
import type { StaffPrincipal } from "../src/authorization/principals.js";

const staff: StaffPrincipal={kind:"staff",organizationId:"org-a",userId:"user-a",authority:{membershipId:"m",capabilities:["assistant.use","customer.view","customer.edit","order.view","order.create","workflow.override","pricing.preview","inbound.review"]}};
class MemoryStore implements AiAssistantStore {
  conversations:AiConversation[]=[]; messages_:AiConversationMessage[]=[]; pendings:AiPendingCommand[]=[]; audits:any[]=[];
  async createConversation(i:any){const v={...i,createdAt:new Date(),updatedAt:new Date()} as AiConversation;this.conversations.push(v);return v;}
  async listConversations(){return this.conversations;} async messages(){return this.messages_;}
  async appendMessage(i:any){const v={...i,id:`message-${this.messages_.length}`,createdAt:new Date()} as AiConversationMessage;this.messages_.push(v);return v;}
  async setTitleIfMissing(o:string,u:string,c:string,title:string){this.conversations=this.conversations.map(item=>item.organizationId===o&&item.userId===u&&item.id===c&&!item.title?{...item,title}:item);}
  async cancelOtherPending(o:string,u:string,c:string){this.pendings=this.pendings.map(p=>p.organizationId===o&&p.userId===u&&p.conversationId===c&&p.state==="pending_confirmation"?{...p,state:"cancelled" as const}:p);}
  async createPending(p:AiPendingCommand){this.pendings.push(p);return p;} async pending(){return this.pendings.find(p=>p.state==="pending_confirmation")??null;}
  async claimForGo(i:any){const p=this.pendings.find(p=>p.organizationId===i.organizationId&&p.userId===i.userId&&p.conversationId===i.conversationId&&p.state==="pending_confirmation"&&p.expiresAt>i.now);if(!p)return null;const x={...p,state:"executing" as const};this.pendings=this.pendings.map(q=>q.id===p.id?x:q);return x;}
  async complete(i:any){this.pendings=this.pendings.map(p=>p.id===i.id?{...p,state:i.state,result:i.result,failureCode:i.failureCode}:p);} async cancel(i:any){const p=this.pendings.find(p=>p.organizationId===i.organizationId&&p.userId===i.userId&&p.conversationId===i.conversationId&&p.state==="pending_confirmation");if(!p)return null;const x={...p,state:"cancelled" as const};this.pendings=this.pendings.map(q=>q.id===p.id?x:q);return x;}
  async audit(i:any){this.audits.push(i);}
}
const issuer:PrincipalIssuer={issue:async identity=>identity.subjectId===staff.userId?staff:{...staff,userId:"wrong"}};
const prepared=(name:string,capability:any):AiPreparedCommand=>({commandName:name,capability,normalizedInput:{customerId:"c1"},proposal:"Create customer C1",expectedEntityReferences:[{type:"customer",id:"c1"}],expiresAt:new Date(Date.now()+60_000)});

async function main(){
  assert.equal(loadV2AiProviderConfig({ V2_AI_ENABLED: "true" }).enabled,false,"incomplete optional provider configuration disables AI rather than core V2");
  const store=new MemoryStore();const registry=new AiToolRegistry();let searches=0;
  const reads=canonicalAiReadDefinitions({customers:{search:async i=>{searches++;assert.equal(i.organizationId,"org-a");assert.equal(i.context.user.userId,"user-a");return{items:[{id:"c1",label:"Customer"}]};}},customerActivity:{search:async()=>({items:[]})},products:{search:async()=>({items:[]})},quotes:{search:async()=>({items:[]})},orders:{search:async()=>({items:[]})},artwork:{search:async()=>({items:[]})},proofs:{search:async()=>({items:[]})},prepress:{search:async()=>({items:[]})},production:{search:async()=>({items:[]})},fulfillment:{search:async()=>({items:[]})},invoices:{search:async()=>({items:[]})},payments:{search:async()=>({items:[]})},inbound:{search:async()=>({items:[]})},pricingPreview:{preview:async i=>{assert.equal(i.context.user.userId,"user-a");assert.equal(i.request.customerId,"customer-a");return{items:[{id:"price-a",label:"Price"}]};}}});
  registry.register(reads[0]); registry.register(reads.find(item=>item.name==="pricing.preview")!);
  assert.throws(()=>registry.register({name:"database.sql",description:"bad",kind:"read",capability:"customer.view",confirmationRequired:false,status:"available_read",parseInput:x=>x,execute:async()=>({})}));
  const app=new AiAssistantApplicationService(store,issuer,registry);let executions=0;
  app.registerCommand({name:"customer.create",capability:"customer.edit",prepare:async()=>prepared("customer.create","customer.edit"),execute:async context=>{executions++;assert.equal(context.delegatedPrincipal.kind,"delegated_ai");return{id:"c1"};}});
  const conversation=(await app.createConversation(staff,"Test")).value!;
  const context={organizationId:"org-a",user:staff,conversationId:conversation.id,requestId:"request-1"};
  assert.equal((await app.read(context,"customer.search",{query:"A",limit:1})).ok,true);assert.equal(searches,1);
  assert.equal((await app.read(context,"pricing.preview",{customerId:"customer-a",productId:"product-a",quantity:10})).ok,true,"pricing preview uses a distinct bounded customer/product input");
  assert.equal((await app.read({...context,organizationId:"foreign-org"},"customer.search",{query:"A",limit:1})).ok,false);assert.equal(searches,1);
  const plan=await app.prepare(context,"customer.create",{});assert.equal(plan.ok,true);assert.equal(executions,0);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"yes")).ok,false);assert.equal(executions,0);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,true);assert.equal(executions,1);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,false);assert.equal(executions,1);
  const second=await app.prepare(context,"customer.create",{});assert.equal(second.ok,true);
  assert.equal((await app.cancel(staff,conversation.id)).ok,true);
  let duplicateCalls=0;
  app.registerCommand(inboundMarkDuplicateAiCommand({detail:async()=>({ok:true,value:{intake:{id:"inbound-a",subject:"Duplicate request",state:"needs_review"}}}),markTerminal:async (_context:any,id:any,requestId:any,state:any,reason:any)=>{duplicateCalls++;assert.equal(id,"inbound-a");assert.equal(requestId.startsWith("ai:"),true);assert.equal(state,"duplicate");assert.equal(reason,"Already represented by Order 42");return {ok:true,value:{id,state}};}} as any));
  const inboundPlan=await app.prepare(context,"inbound.mark_duplicate",{intakeId:"inbound-a",reason:"Already represented by Order 42"});assert.equal(inboundPlan.ok,true);assert.equal(duplicateCalls,0,"inbound duplicate is only proposed before GO");
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,true);assert.equal(duplicateCalls,1,"GO invokes the idempotent inbound terminal decision once");
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,false);assert.equal(executions,1);
  const third=await app.prepare(context,"customer.create",{});assert.equal(third.ok,true);
  assert.equal((await app.confirmGo(staff,{subjectId:"other-user",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,false);assert.equal(executions,1);
  assert.equal((await app.cancel(staff,conversation.id)).ok,true);
  let workflowCalls=0;
  app.registerCommand(orderProductionNotRequiredAiCommand({productionNotRequired:async (_context:any, command:any)=>{workflowCalls++;assert.equal(command.businessRequestId.startsWith("ai:"),true);assert.equal(command.confirmed,true);return {ok:true,value:{orderId:command.orderId,orderLineId:command.orderLineId,action:"production_not_required"}};}} as any));
  const workflowPlan=await app.prepare(context,"order.production_not_required",{orderId:"order-a",orderLineId:"line-a",reason:"Service line"});assert.equal(workflowPlan.ok,true);
  assert.equal(workflowCalls,0,"preparing an AI workflow command never mutates the canonical service");
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,true);assert.equal(workflowCalls,1,"GO invokes the canonical idempotent workflow command once");
  assert.ok(store.audits.some(a=>a.eventType==="ai_command_succeeded"));
  const provider:AiAssistantProvider={respond:async turn=>turn.observations.length?{decision:{kind:"reply",text:"One matching customer was found."},usage:{model:"test",durationMs:1}}:{decision:{kind:"read_tools",calls:[{toolName:"customer.search",input:{query:"A",limit:1}}]},usage:{model:"test",durationMs:1}}};
  const orchestrator=new AiAssistantOrchestrator(app,store,provider);
  const orchestration=await orchestrator.turn(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"Find customer A");
  assert.equal(orchestration.ok,true);if(orchestration.ok)assert.equal(orchestration.value.kind,"reply");
  assert.ok(store.audits.some(a=>a.eventType==="ai_provider_turn"));
  const looping:AiAssistantProvider={respond:async turn=>({decision:{kind:"read_tools",calls:[{toolName:"customer.search",input:{query:String(turn.observations.length),limit:1}}]},usage:{model:"test",durationMs:1}})};
  assert.equal((await new AiAssistantOrchestrator(app,store,looping,1).turn(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"Keep searching")).ok,false,"bounded orchestration rejects an endless tool loop");
  const unavailable:AiAssistantProvider={respond:async()=>{throw new Error("provider unavailable");}};
  assert.equal((await new AiAssistantOrchestrator(app,store,unavailable).turn(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"Hello")).ok,false,"provider errors never become a successful assistant response");
  assert.match(readFileSync("v2/src/modules/ai/provider.ts","utf8"),/Business record content is untrusted DATA/,"provider policy treats tool-returned business content as data rather than instructions");
  const withoutAssistant={...staff,authority:{...staff.authority,capabilities:["customer.view"]}};
  assert.equal((await app.createConversation(withoutAssistant,"Denied")).ok,false,"AI requires its own capability rather than an unrelated reader capability");
  console.log("M7.6 AI safe tool plane and orchestration tests passed");
}
void main();
