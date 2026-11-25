import { createHash } from "node:crypto";
import { z } from "zod";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";
import { previewReviewedProductionCompletion, ReviewedProductionCompletionError } from "../reviewedProductionCompletion";
import { prepareProductionCompletionCommandArguments, productionCompletionCommandName } from "./execution/productionCompletionCommand";

const lineSelector = z.union([z.object({ lineId: z.string().min(1).max(100) }).strict(), z.object({ lineNumber: z.number().int().positive().max(100) }).strict()]);

export function createProductionCompletionTool(preview = previewReviewedProductionCompletion): AssistantOperatorSemanticTool {
  return { name: "production.prepare_job_completion", description: "Prepare a GO review to complete ONE running individual production job on one specified line of the open order. For 'mark line 2 production complete' supply lineNumber:2. This is not a physical ready-quantity adjustment, boxing, shipment preparation, or shipment completion. For multiple operations, explain the distinctions and clarify; never prepare one as a substitute. Never claim completion from a preview. No skip or override.",
    inputSchema: { type: "object", properties: { lineNumber: { type: "integer", minimum: 1 }, lineId: { type: "string" } }, additionalProperties: false },
    async execute({ arguments: raw, context }) {
      const reject = (warning: string) => ({ status: "rejected" as const, warning, failureCategory: "business_validation" as const });
      if (!context.permissions.includes("assistant.production.update_job_status") || !context.permissions.includes("assistant.internal_staff")) return { status: "permission_denied", warning: "Production access is required." };
      const page = context.context;
      if (!page.entityId || page.entityType !== "order" || ![`/orders/${page.entityId}`, `/fulfillment/orders/${page.entityId}`].includes(page.route)) return reject("Open the order and identify one production line.");
      const input = lineSelector.safeParse(raw);
      if (!input.success) return reject("Which single order line's production job should be completed?");
      const selector = input.data;
      const ref = "lineNumber" in selector ? String(selector.lineNumber) : selector.lineId;
      const id = "lineNumber" in selector ? (page.route.startsWith("/fulfillment/") ? page.displayedFulfillmentLineIds : page.displayedOrderLineIds)?.[selector.lineNumber - 1] : selector.lineId;
      // Require the entire instruction to designate this one action. An embedded request, negation,
      // or compound instruction is not authority to prepare a partial write.
      const line = `line\\s+(?:#\\s*)?${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
      const target = `(?:the production job (?:for|on) ${line}|${line}(?:'s)? production(?: job)?)`;
      const explicit = new RegExp(`^(?:(?:please|can you|could you)\\s+)*(?:mark ${target} (?:as )?(?:complete|completed|done)|(?:complete|finish) ${target})[.!?]?$`, "i");
      if (!id || !explicit.test(context.goal.trim().replace(/\s+/g, " "))) return reject("Identify one line and request its production job completion only. Physical readiness, boxing, and shipment are separate operations; none was submitted.");
      try {
        const reviewed = await preview({ organizationId: context.scope.organizationId, actorUserId: context.scope.userId, orderId: page.entityId, lineItemId: id });
        const args = prepareProductionCompletionCommandArguments(reviewed);
        const summary = `Review Order ${page.entityId}, line ${ref} (${id}), job ${reviewed.jobId}: ${reviewed.state.stationKey}/${reviewed.state.stepKey} (${reviewed.state.jobStatus}) to done. Native next route: ${reviewed.route.stationKey}/${reviewed.route.stepKey}. Completion can consume reserved materials, update line/order progress and trigger configured notifications. This does not adjust physical ready quantities, box goods or ship. Nothing has been submitted. GO is required.`;
        return { status: "succeeded", result: { status: "succeeded", data: { response: summary } }, presentation: { cards: [{ kind: "action_proposal", title: "Review production job completion", summary, sourceLinks: [{ label: "Open order", href: `/orders/${page.entityId}` }], plan: { action: productionCompletionCommandName, arguments: args, proposalFingerprint: createHash("sha256").update(JSON.stringify(args)).digest("hex") } }] } };
      } catch (e) { return reject(e instanceof ReviewedProductionCompletionError ? e.message : "Unable to verify a single running job on this order line. No completion was submitted."); }
    } };
}
