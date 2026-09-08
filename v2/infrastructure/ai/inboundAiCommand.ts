import type { AiCommandHandler } from "../../src/modules/ai/assistantApplication.js";
import type { AiExecutionContext, AiPreparedCommand } from "../../src/modules/ai/contracts.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { InboundIntakeApplicationService } from "../../src/modules/inbound/inboundIntakeApplication.js";

type MarkDuplicateInput = Readonly<{ intakeId: string; reason: string }>;
const parse = (raw: unknown): MarkDuplicateInput => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new V2ApplicationError("VALIDATION_ERROR", "An inbound intake and concise duplicate reason are required.");
  const value = raw as Record<string, unknown>;
  const text = (name: string, maximum: number) => typeof value[name] === "string" ? value[name].trim() : "";
  const intakeId = text("intakeId", 128), reason = text("reason", 500);
  if (!intakeId || !reason || intakeId.length > 128 || reason.length > 500) throw new V2ApplicationError("VALIDATION_ERROR", "An inbound intake and concise duplicate reason are required.");
  return Object.freeze({ intakeId, reason });
};
const operation = (context: AiExecutionContext) => ({ principal: context.user, organizationId: context.organizationId, operationId: `ai:prepare:inbound:${context.requestId}` });

/** A deliberately narrow inbound write: it is an explicit, reversible queue
 * decision with a reason.  Conversion remains unavailable until the AI
 * command protocol can delegate both inbound.review and order.create. */
export const inboundMarkDuplicateAiCommand = (inbound: InboundIntakeApplicationService): AiCommandHandler => ({
  name: "inbound.mark_duplicate",
  capability: "inbound.review",
  prepare: async (context, raw): Promise<AiPreparedCommand> => {
    const command = parse(raw);
    const current = await inbound.detail(operation(context), command.intakeId as never);
    if (!current.ok) throw current.error;
    if (!["received", "needs_review", "ready", "failed", "action_required"].includes(current.value.intake.state))
      throw new V2ApplicationError("CONFLICT", "This inbound item is no longer eligible to be marked duplicate.");
    const proposal = `Mark inbound request as duplicate\n\nInbound: ${current.value.intake.subject ?? command.intakeId}\nState: ${current.value.intake.state}\nReason: ${command.reason}\n\nNo changes have been made yet.`;
    return { commandName: "inbound.mark_duplicate", capability: "inbound.review", normalizedInput: command, proposal, expectedEntityReferences: [{ type: "inbound_intake", id: command.intakeId }], expiresAt: new Date(Date.now() + 5 * 60_000) };
  },
  execute: async (context, raw) => {
    const command = parse(raw);
    const saved = await inbound.markTerminal({ principal: context.delegatedPrincipal, organizationId: context.organizationId, operationId: `ai:${context.businessRequestId}`, businessRequest: { id: context.businessRequestId, payloadFingerprint: "ai-inbound-duplicate" } }, command.intakeId as never, context.businessRequestId, "duplicate", command.reason);
    if (!saved.ok) throw saved.error;
    return Object.freeze({ intakeId: saved.value.id, state: saved.value.state });
  },
});
