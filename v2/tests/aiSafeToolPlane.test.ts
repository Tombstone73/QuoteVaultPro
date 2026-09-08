import assert from "node:assert/strict";
import { AiAssistantApplicationService, type AiAssistantStore } from "../src/modules/ai/assistantApplication.js";
import { canonicalAiReadDefinitions } from "../src/modules/ai/canonicalTools.js";
import type { AiConversation, AiConversationMessage, AiPendingCommand, AiPreparedCommand } from "../src/modules/ai/contracts.js";
import { AiToolRegistry } from "../src/modules/ai/toolRegistry.js";
import type { PrincipalIssuer } from "../src/authorization/principalIssuer.js";
import type { StaffPrincipal } from "../src/authorization/principals.js";

const staff: StaffPrincipal={kind:"staff",organizationId:"org-a",userId:"user-a",authority:{membershipId:"m",capabilities:["customer.view","customer.edit","order.view","order.create"]}};
class MemoryStore implements AiAssistantStore {
  conversations:AiConversation[]=[]; messages_:AiConversationMessage[]=[]; pendings:AiPendingCommand[]=[]; audits:any[]=[];
  async createConversation(i:any){const v={...i,createdAt:new Date(),updatedAt:new Date()} as AiConversation;this.conversations.push(v);return v;}
  async listConversations(){return this.conversations;} async messages(){return this.messages_;}
  async appendMessage(i:any){const v={...i,id:`message-${this.messages_.length}`,createdAt:new Date()} as AiConversationMessage;this.messages_.push(v);return v;}
  async cancelOtherPending(o:string,u:string,c:string){this.pendings=this.pendings.map(p=>p.organizationId===o&&p.userId===u&&p.conversationId===c&&p.state==="pending_confirmation"?{...p,state:"cancelled" as const}:p);}
  async createPending(p:AiPendingCommand){this.pendings.push(p);return p;} async pending(){return this.pendings.find(p=>p.state==="pending_confirmation")??null;}
  async claimForGo(i:any){const p=this.pendings.find(p=>p.organizationId===i.organizationId&&p.userId===i.userId&&p.conversationId===i.conversationId&&p.state==="pending_confirmation"&&p.expiresAt>i.now);if(!p)return null;const x={...p,state:"executing" as const};this.pendings=this.pendings.map(q=>q.id===p.id?x:q);return x;}
  async complete(i:any){this.pendings=this.pendings.map(p=>p.id===i.id?{...p,state:i.state,result:i.result,failureCode:i.failureCode}:p);} async cancel(i:any){const p=this.pendings.find(p=>p.organizationId===i.organizationId&&p.userId===i.userId&&p.conversationId===i.conversationId&&p.state==="pending_confirmation");if(!p)return null;const x={...p,state:"cancelled" as const};this.pendings=this.pendings.map(q=>q.id===p.id?x:q);return x;}
  async audit(i:any){this.audits.push(i);}
}
const issuer:PrincipalIssuer={issue:async identity=>identity.subjectId===staff.userId?staff:{...staff,userId:"wrong"}};
const prepared=(name:string,capability:any):AiPreparedCommand=>({commandName:name,capability,normalizedInput:{customerId:"c1"},proposal:"Create customer C1",expectedEntityReferences:[{type:"customer",id:"c1"}],expiresAt:new Date(Date.now()+60_000)});

async function main(){
  const store=new MemoryStore();const registry=new AiToolRegistry();let searches=0;
  registry.register(canonicalAiReadDefinitions({customers:{search:async i=>{searches++;assert.equal(i.organizationId,"org-a");return{items:[{id:"c1",label:"Customer"}]};}},products:{search:async()=>({items:[]})},quotes:{search:async()=>({items:[]})},orders:{search:async()=>({items:[]})},artwork:{search:async()=>({items:[]})},proofs:{search:async()=>({items:[]})},prepress:{search:async()=>({items:[]})},production:{search:async()=>({items:[]})},fulfillment:{search:async()=>({items:[]})},invoices:{search:async()=>({items:[]})},payments:{search:async()=>({items:[]})},inbound:{search:async()=>({items:[]})},pricingPreview:{search:async()=>({items:[]})}})[0]);
  assert.throws(()=>registry.register({name:"database.sql",description:"bad",kind:"read",capability:"customer.view",confirmationRequired:false,status:"available_read",parseInput:x=>x,execute:async()=>({})}));
  const app=new AiAssistantApplicationService(store,issuer,registry);let executions=0;
  app.registerCommand({name:"customer.create",capability:"customer.edit",prepare:async()=>prepared("customer.create","customer.edit"),execute:async context=>{executions++;assert.equal(context.delegatedPrincipal.kind,"delegated_ai");return{id:"c1"};}});
  const conversation=(await app.createConversation(staff,"Test")).value!;
  const context={organizationId:"org-a",user:staff,conversationId:conversation.id,requestId:"request-1"};
  assert.equal((await app.read(context,"customer.search",{query:"A",limit:1})).ok,true);assert.equal(searches,1);
  assert.equal((await app.read({...context,organizationId:"foreign-org"},"customer.search",{query:"A",limit:1})).ok,false);assert.equal(searches,1);
  const plan=await app.prepare(context,"customer.create",{});assert.equal(plan.ok,true);assert.equal(executions,0);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"yes")).ok,false);assert.equal(executions,0);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,true);assert.equal(executions,1);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,false);assert.equal(executions,1);
  const second=await app.prepare(context,"customer.create",{});assert.equal(second.ok,true);
  assert.equal((await app.cancel(staff,conversation.id)).ok,true);
  assert.equal((await app.confirmGo(staff,{subjectId:"user-a",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,false);assert.equal(executions,1);
  const third=await app.prepare(context,"customer.create",{});assert.equal(third.ok,true);
  assert.equal((await app.confirmGo(staff,{subjectId:"other-user",authenticatedAt:new Date(),authenticationMethod:"session"},conversation.id,"GO")).ok,false);assert.equal(executions,1);
  assert.ok(store.audits.some(a=>a.eventType==="ai_command_succeeded"));
  console.log("M7.6A AI safe tool plane tests passed");
}
void main();
