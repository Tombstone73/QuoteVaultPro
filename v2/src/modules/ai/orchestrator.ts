import { randomUUID } from "node:crypto";
import type { AuthenticatedIdentity } from "../../authorization/principalIssuer.js";
import type { StaffPrincipal } from "../../authorization/principals.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import type { AiAssistantStore } from "./assistantApplication.js";
import { AiAssistantApplicationService } from "./assistantApplication.js";
import type { AiPendingCommand } from "./contracts.js";
import type { AiAssistantProvider } from "./provider.js";

export type AiTurnResult=Readonly<{kind:"reply"|"proposal";text:string;toolResults:readonly Readonly<{toolName:string;result:unknown}>[];pending?:AiPendingCommand;usage?:Readonly<{model:string;inputTokens?:number;outputTokens?:number;durationMs:number}>}>;
const safeConversationTitle=(message:string):string=>/\binvoice|payment|balance\b/iu.test(message)?"Invoice questions":/\bquote\b/iu.test(message)?"Quote questions":/\border\b/iu.test(message)?"Order questions":/\bcustomer|contact\b/iu.test(message)?"Customer questions":/\bproduct|price|pricing\b/iu.test(message)?"Product and pricing questions":"Assistant conversation";
/** A bounded, provider-neutral orchestration loop.  It never gives a model a
 * mutation callable: model write intent is converted to `prepare`, which is
 * durable and non-mutating until the separately authenticated literal GO. */
export class AiAssistantOrchestrator {
  private readonly turnTimes=new Map<string,number[]>();
  constructor(private readonly app:AiAssistantApplicationService,private readonly store:AiAssistantStore,private readonly provider:AiAssistantProvider,private readonly maxToolCalls=5,private readonly maxTurnsPerMinute=12){}
  private admitTurn(principal:StaffPrincipal):void { const now=Date.now(),key=`${principal.organizationId}:${principal.userId}`,recent=(this.turnTimes.get(key)??[]).filter(time=>time>now-60_000);if(recent.length>=this.maxTurnsPerMinute)throw new V2ApplicationError("RETRYABLE_FAILURE","AI turn limit reached. Please wait a moment before sending another request.");recent.push(now);this.turnTimes.set(key,recent); }
  async turn(principal:StaffPrincipal,identity:AuthenticatedIdentity,conversationId:string,userMessage:string):Promise<ApplicationResult<AiTurnResult>>{
    try{
      if(identity.subjectId!==principal.userId)throw new V2ApplicationError("FORBIDDEN","The verified session does not match the AI conversation owner.");
      this.admitTurn(principal);
      const text=userMessage.trim();if(!text||text.length>4000)throw new V2ApplicationError("VALIDATION_ERROR","AI messages must contain at most 4,000 characters.");
      await this.store.appendMessage({organizationId:principal.organizationId,userId:principal.userId,conversationId,role:"user",content:text});
      await this.store.setTitleIfMissing(principal.organizationId,principal.userId,conversationId,safeConversationTitle(text));
      const observations:Readonly<{toolName:string;result:unknown}>[]=[];let decision=await this.provider.respond({systemPolicy:"server-owned",userMessage:text,observations,tools:this.app.tools.list(),commands:this.app.listCommands()});
      for(let step=0;step<=this.maxToolCalls;step++){
        if(decision.decision.kind==="reply") {await this.store.appendMessage({organizationId:principal.organizationId,userId:principal.userId,conversationId,role:"assistant",content:decision.decision.text});await this.store.audit({organizationId:principal.organizationId,userId:principal.userId,conversationId,eventType:"ai_provider_turn",result:"succeeded",detail:decision.usage});return success({kind:"reply",text:decision.decision.text,toolResults:observations,usage:decision.usage});}
        if(decision.decision.kind==="prepare_command") {const prepared=await this.app.prepare({organizationId:principal.organizationId,user:principal,conversationId,requestId:randomUUID()},decision.decision.commandName,decision.decision.input);if(!prepared.ok)return prepared;await this.store.audit({organizationId:principal.organizationId,userId:principal.userId,conversationId,pendingCommandId:prepared.value.id,eventType:"ai_provider_turn",result:"succeeded",detail:decision.usage});return success({kind:"proposal",text:prepared.value.proposal,toolResults:observations,pending:prepared.value,usage:decision.usage});}
        if(step===this.maxToolCalls)throw new V2ApplicationError("RETRYABLE_FAILURE","AI reached its safe tool-call limit. Please narrow the request.");
        const unique=new Set<string>();
        for(const call of decision.decision.calls){const key=JSON.stringify(call);if(unique.has(key))throw new V2ApplicationError("VALIDATION_ERROR","AI repeated the same tool request.");unique.add(key);const result=await this.app.read({organizationId:principal.organizationId,user:principal,conversationId,requestId:randomUUID()},call.toolName,call.input);if(!result.ok)return result;await this.store.appendMessage({organizationId:principal.organizationId,userId:principal.userId,conversationId,role:"tool",toolName:call.toolName,content:JSON.stringify(result.value)});observations.push({toolName:call.toolName,result:result.value});}
        decision=await this.provider.respond({systemPolicy:"server-owned",userMessage:text,observations,tools:this.app.tools.list(),commands:this.app.listCommands()});
      }
      throw new V2ApplicationError("RETRYABLE_FAILURE","AI could not complete this request.");
    }catch(cause){const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","AI conversation is unavailable.");try{await this.store.audit({organizationId:principal.organizationId,userId:principal.userId,conversationId,eventType:"ai_turn_failed",result:error.code==="FORBIDDEN"?"denied":"failed",detail:{code:error.code}});}catch{}return failure(error);}
  }
}
