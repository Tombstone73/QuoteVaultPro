import { createHash, randomUUID } from "node:crypto";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { revalidateDelegatedAiPrincipal } from "../../authorization/delegatedAiRevalidation.js";
import type { AuthenticatedIdentity, PrincipalIssuer } from "../../authorization/principalIssuer.js";
import type { StaffPrincipal } from "../../authorization/principals.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import type { AiConversation, AiConversationMessage, AiExecutionContext, AiPendingCommand, AiPreparedCommand } from "./contracts.js";
import { AiToolRegistry } from "./toolRegistry.js";
import { isAiHardDenied } from "./contracts.js";

export type AiAssistantStore = Readonly<{
  createConversation(input: Omit<AiConversation, "createdAt" | "updatedAt">): Promise<AiConversation>;
  listConversations(organizationId: string, userId: string, limit: number): Promise<readonly AiConversation[]>;
  messages(organizationId: string, userId: string, conversationId: string, limit: number): Promise<readonly AiConversationMessage[]>;
  appendMessage(input: Omit<AiConversationMessage, "id" | "createdAt">): Promise<AiConversationMessage>;
  setTitleIfMissing(organizationId: string, userId: string, conversationId: string, title: string): Promise<void>;
  cancelOtherPending(organizationId: string, userId: string, conversationId: string, reason: string): Promise<void>;
  createPending(input: AiPendingCommand): Promise<AiPendingCommand>;
  pending(organizationId: string, userId: string, conversationId: string): Promise<AiPendingCommand | null>;
  claimForGo(input: Readonly<{ organizationId: string; userId: string; conversationId: string; now: Date }>): Promise<AiPendingCommand | null>;
  complete(input: Readonly<{ id: string; organizationId: string; state: "succeeded" | "failed"; result?: unknown; failureCode?: string }>): Promise<void>;
  cancel(input: Readonly<{ organizationId: string; userId: string; conversationId: string; now: Date }>): Promise<AiPendingCommand | null>;
  audit(input: Readonly<{ organizationId: string; userId: string; conversationId: string; pendingCommandId?: string; eventType: string; toolName?: string; capability?: string; result: "succeeded" | "failed" | "denied"; detail: unknown }>): Promise<void>;
}>;

export type AiCommandHandler = Readonly<{
  name: string;
  /** The primary capability is persisted for proposal/audit compatibility. */
  capability: import("../../authorization/capabilities.js").Capability;
  /** Some canonical operations require a deliberate set of capabilities.
   * Every one is checked at prepare and revalidated at GO. */
  requiredCapabilities?: readonly import("../../authorization/capabilities.js").Capability[];
  prepare(context: AiExecutionContext, input: unknown): Promise<AiPreparedCommand>;
  execute(context: Readonly<{ organizationId: string; userId: string; conversationId: string; businessRequestId: string; delegatedPrincipal: import("../../authorization/principals.js").DelegatedAiPrincipal }>, input: unknown): Promise<unknown>;
}>;

const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const isGo = (value: string) => value.trim() === "GO";

/** A provider-free orchestration core. Commands are adapters over canonical V2
 * application services; the assistant cannot receive a database client. */
export class AiAssistantApplicationService {
  private readonly commands = new Map<string, AiCommandHandler>();
  private readonly authority = new AuthorityPolicy();
  constructor(private readonly store: AiAssistantStore, private readonly issuer: PrincipalIssuer, readonly tools: AiToolRegistry) {}
  registerCommand(handler: AiCommandHandler): void {
    if (isAiHardDenied(handler.name) || this.commands.has(handler.name)) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid or duplicate AI command registration.");
    this.commands.set(handler.name, handler);
  }
  private commandCapabilities(command: AiCommandHandler): readonly import("../../authorization/capabilities.js").Capability[] {
    const capabilities = command.requiredCapabilities?.length ? command.requiredCapabilities : [command.capability];
    if (!capabilities.includes(command.capability)) throw new V2ApplicationError("VALIDATION_ERROR", "AI command primary capability must be required.");
    return [...new Set(capabilities)];
  }
  listCommands(): readonly Readonly<{ name: string; capability: import("../../authorization/capabilities.js").Capability }>[] {
    return [...this.commands.values()].map((command) => ({ name: command.name, capability: command.capability }));
  }
  private assertAssistantAccess(principal: StaffPrincipal): void {
    if (!this.authority.decide(principal, { capability: "assistant.use", resource: { organizationId: principal.organizationId } }).allowed)
      throw new V2ApplicationError("FORBIDDEN", "The signed-in user does not have AI Assistant access.");
  }
  async createConversation(principal: StaffPrincipal, title?: string): Promise<ApplicationResult<AiConversation>> {
    try { this.assertAssistantAccess(principal); return success(await this.store.createConversation({ id: randomUUID(), organizationId: principal.organizationId, userId: principal.userId, ...(title?.trim()?{title:title.trim().slice(0,160)}:{}) })); }
    catch { return failure(new V2ApplicationError("INTERNAL_ERROR", "AI conversation could not be created.")); }
  }
  async listConversations(principal: StaffPrincipal): Promise<ApplicationResult<readonly AiConversation[]>> { try { this.assertAssistantAccess(principal); return success(await this.store.listConversations(principal.organizationId, principal.userId, 100)); } catch (cause) { return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "AI conversations are unavailable.")); } }
  async messages(principal: StaffPrincipal, conversationId: string): Promise<ApplicationResult<readonly AiConversationMessage[]>> { try { this.assertAssistantAccess(principal); return success(await this.store.messages(principal.organizationId, principal.userId, conversationId, 200)); } catch (cause) { return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "AI conversation messages are unavailable.")); } }
  async pending(principal: StaffPrincipal, conversationId: string): Promise<ApplicationResult<AiPendingCommand | null>> { try { this.assertAssistantAccess(principal); return success(await this.store.pending(principal.organizationId, principal.userId, conversationId)); } catch (cause) { return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "AI command state is unavailable.")); } }
  async read(context: AiExecutionContext, toolName: string, input: unknown): Promise<ApplicationResult<unknown>> {
    try { this.assertAssistantAccess(context.user); const result=await this.tools.executeRead(context,toolName,input); await this.store.audit({organizationId:context.organizationId,userId:context.user.userId,conversationId:context.conversationId,eventType:"ai_tool_read",toolName,result:"succeeded",detail:{requestId:context.requestId}}); return success(result); }
    catch (cause) { const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","AI read failed."); await this.store.audit({organizationId:context.organizationId,userId:context.user.userId,conversationId:context.conversationId,eventType:"ai_tool_read",toolName,result:error.code==="FORBIDDEN"?"denied":"failed",detail:{code:error.code}}); return failure(error); }
  }
  async prepare(context: AiExecutionContext, commandName: string, input: unknown): Promise<ApplicationResult<AiPendingCommand>> {
    try {
      this.assertAssistantAccess(context.user);
      const command=this.commands.get(commandName); if(!command) throw new V2ApplicationError("NOT_FOUND","This AI command is not supported.");
      for (const capability of this.commandCapabilities(command)) if(!this.authority.decide(context.user,{capability,resource:{organizationId:context.organizationId}}).allowed) throw new V2ApplicationError("FORBIDDEN","The signed-in user cannot prepare this action.");
      const prepared=await command.prepare(context,input);
      if(prepared.commandName!==commandName||prepared.capability!==command.capability||prepared.expiresAt<=new Date()) throw new V2ApplicationError("VALIDATION_ERROR","AI command proposal is invalid.");
      await this.store.cancelOtherPending(context.organizationId,context.user.userId,context.conversationId,"superseded");
      const pending:AiPendingCommand={id:randomUUID(),organizationId:context.organizationId,userId:context.user.userId,conversationId:context.conversationId,commandName,capability:command.capability,normalizedInput:prepared.normalizedInput,proposal:prepared.proposal,proposalFingerprint:fingerprint({commandName,input:prepared.normalizedInput,proposal:prepared.proposal}),state:"pending_confirmation",expiresAt:prepared.expiresAt,businessRequestId:`ai:${context.conversationId}:${randomUUID()}`,createdAt:new Date(),updatedAt:new Date()};
      const saved=await this.store.createPending(pending); await this.store.appendMessage({conversationId:context.conversationId,organizationId:context.organizationId,userId:context.user.userId,role:"assistant",content:prepared.proposal,toolName:commandName}); await this.store.audit({organizationId:context.organizationId,userId:context.user.userId,conversationId:context.conversationId,pendingCommandId:saved.id,eventType:"ai_command_prepared",toolName:commandName,capability:command.capability,result:"succeeded",detail:{proposalFingerprint:saved.proposalFingerprint}}); return success(saved);
    } catch(cause) { return failure(cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","AI command could not be prepared.")); }
  }
  /**
   * `identity` is the verified HTTP-session identity, deliberately supplied by
   * the authenticated route adapter.  Never synthesize it from a staff
   * principal: doing so would turn a planning-time authority snapshot into
   * authority at GO time.
   */
  async confirmGo(principal: StaffPrincipal, identity: AuthenticatedIdentity, conversationId: string, confirmation: string): Promise<ApplicationResult<unknown>> {
    let executing: AiPendingCommand | undefined;
    try {
      this.assertAssistantAccess(principal);
      if (identity.subjectId !== principal.userId)
        throw new V2ApplicationError("FORBIDDEN", "The verified session does not match the AI command owner.");
      if(!isGo(confirmation)) throw new V2ApplicationError("VALIDATION_ERROR","Reply exactly GO to execute the displayed action.");
      const pending=await this.store.claimForGo({organizationId:principal.organizationId,userId:principal.userId,conversationId,now:new Date()});
      if(!pending) throw new V2ApplicationError("CONFLICT","There is no pending AI command awaiting GO.");
      executing = pending;
      const command=this.commands.get(pending.commandName); if(!command) throw new V2ApplicationError("CONFLICT","The pending AI command is no longer supported.");
      const requiredCapabilities=this.commandCapabilities(command);
      const delegated=await revalidateDelegatedAiPrincipal(this.issuer,identity,{kind:"delegated_ai",organizationId:principal.organizationId,staff:principal,delegation:{commandId:pending.id,allowedCapabilities:requiredCapabilities,planApprovedAt:pending.createdAt,goApprovedAt:new Date(),revalidatedAt:new Date(),expiresAt:pending.expiresAt}});
      for (const capability of requiredCapabilities) if(!this.authority.decide(delegated,{capability,resource:{organizationId:principal.organizationId}}).allowed) throw new V2ApplicationError("FORBIDDEN","Current user permission no longer permits this AI action.");
      const result=await command.execute({organizationId:principal.organizationId,userId:principal.userId,conversationId,businessRequestId:pending.businessRequestId,delegatedPrincipal:delegated},pending.normalizedInput);
      await this.store.complete({id:pending.id,organizationId:principal.organizationId,state:"succeeded",result}); await this.store.audit({organizationId:principal.organizationId,userId:principal.userId,conversationId,pendingCommandId:pending.id,eventType:"ai_command_succeeded",toolName:pending.commandName,capability:pending.capability,result:"succeeded",detail:result}); return success(result);
    } catch(cause) {
      const error=cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","AI command execution failed.");
      // A claimed command must never be left executable after a failed
      // revalidation or canonical-service call.  The durable transition is
      // best-effort only after the original failure; a store outage still
      // fails closed because claimForGo is compare-and-set.
      if (executing) {
        try {
          await this.store.complete({ id: executing.id, organizationId: executing.organizationId, state: "failed", failureCode: error.code });
          await this.store.audit({organizationId:executing.organizationId,userId:executing.userId,conversationId:executing.conversationId,pendingCommandId:executing.id,eventType:"ai_command_failed",toolName:executing.commandName,capability:executing.capability,result:"failed",detail:{code:error.code}});
        } catch { /* No retry path may re-execute an already claimed command. */ }
      }
      return failure(error);
    }
  }
  async cancel(principal: StaffPrincipal, conversationId: string): Promise<ApplicationResult<AiPendingCommand>> { try { this.assertAssistantAccess(principal); const pending=await this.store.cancel({organizationId:principal.organizationId,userId:principal.userId,conversationId,now:new Date()}); if(!pending) throw new V2ApplicationError("CONFLICT","There is no pending AI command to cancel."); await this.store.audit({organizationId:principal.organizationId,userId:principal.userId,conversationId,pendingCommandId:pending.id,eventType:"ai_command_cancelled",toolName:pending.commandName,capability:pending.capability,result:"succeeded",detail:{}}); return success(pending); } catch(cause){return failure(cause instanceof V2ApplicationError?cause:new V2ApplicationError("INTERNAL_ERROR","AI command could not be cancelled."));} }
}
