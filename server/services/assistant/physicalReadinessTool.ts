import { createHash } from "node:crypto";
import { z } from "zod";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";
import { readOrderFulfillmentReadiness } from "./orderFulfillmentReadinessRead";
import { previewPhysicalReadinessAdjustment, PhysicalReadinessAdjustmentError } from "./physicalReadinessAdjustment";
import { physicalReadinessCommandName, preparePhysicalReadinessCommandArguments } from "./execution/physicalReadinessCommand";

const requestSchema = z.object({
  lineId: z.string().min(1).optional(), lineNumber: z.number().int().positive().optional(),
  quantity: z.number().int().safe(), mode: z.enum(["target", "delta"]), reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine(v => Boolean(v.lineId) !== Boolean(v.lineNumber));

export function createPhysicalReadinessTool(read = readOrderFulfillmentReadiness, preview = previewPhysicalReadinessAdjustment): AssistantOperatorSemanticTool {
  return {
    name: "fulfillment.prepare_physical_readiness",
    description: "Prepare ONLY a directly requested physical ready/waiting quantity correction for one order line. This is NOT a production completion, boxing, pickup or shipment. For 'mark line 2 production complete' explain the distinction and ask if a physical ready-count adjustment is intended. Never substitute this operation. Resolve an explicit ID or the one-based displayed line number on the current Fulfillment order. Extract the requested integer as target (set to) or signed delta (add/remove); ask if ambiguous. Copy the operator's stated reason verbatim. Do not invent a reason. GO is required; this tool does not write.",
    inputSchema: { type: "object", additionalProperties: false, required: ["quantity", "mode"], properties: { lineId: { type: "string" }, lineNumber: { type: "integer", minimum: 1 }, quantity: { type: "integer" }, mode: { enum: ["target", "delta"] }, reason: { type: "string" } } },
    async execute({ arguments: raw, context }) {
      const clarify = (warning: string) => ({ status: "rejected" as const, failureCategory: "business_validation" as const, warning });
      const page = context.context;
      if (!context.permissions.includes("assistant.fulfillment.add_note") || !context.permissions.includes("assistant.internal_staff")) return { status: "permission_denied", warning: "Physical readiness permission is required." };
      if (page.entityType !== "order" || !page.entityId) return clarify("Open the specific fulfillment order first.");
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return clarify("Which single line and what exact quantity should be set, added or removed?");
      const { quantity, mode, lineId, lineNumber, reason } = parsed.data;
      const message = context.goal;
      // Do not turn production-completion language or a model-invented override into a physical attestation.
      const reasonClause = /(?:\breason\s*:\s*|\bbecause\s+)([^\n]+)$/i.exec(message);
      // A provider cannot erase part of the instruction by submitting it as the reason.
      const instruction = (reasonClause ? message.slice(0, reasonClause.index) : message).replace(/[\u2018\u2019]/g, "'").trim();
      if (reasonClause?.[1].trim() !== reason) return clarify("Specify the reason after 'because' or 'reason:' so it can be recorded verbatim.");
      if (/\border\b/i.test(instruction.replace(/\b(?:this|current) order\b/ig, ""))) return clarify("Use the current order page and specify its line; another named order cannot be adjusted here.");
      if (!/\b(?:ready|readiness)\b/i.test(instruction) || /\bunready\b/i.test(instruction) || !/^(?:(?:please|can you|could you|would you)\s+)*(?:set|adjust|correct|mark|record|add|remove|reduce|increase|decrease|override|change|confirm)\b/i.test(instruction)
        || /\b(?:not|never|don't|instead|if|unless|all lines|all items|every line)\b|\bproduction\s+complete\b/i.test(instruction)) return clarify("Physical readiness changes a quantity only. It does not complete production. Specify one physical ready-count correction you want.");
      const explicitOverride = /^(?:(?:please|can you|could you|would you)\s+)*override\b/i.test(instruction);
      const reference = /\bline\s*#?\s*(\d+)\b/ig;
      const numbered = Array.from(instruction.matchAll(reference));
      if (lineNumber ? numbered.length !== 1 || Number(numbered[0][1]) !== lineNumber : !lineId || !instruction.includes(lineId)) return clarify("Please identify exactly one line by its displayed line number or explicit ID.");
      const quantityText = lineId ? instruction.replace(lineId, "") : instruction.replace(reference, "");
      const numbers = quantityText.match(/[-+]?\d+(?:\.\d+)?/g) ?? [];
      const decrease = /\b(?:remove|reduce|decrease|subtract)\b/i.test(quantityText);
      const increase = /\b(?:add|increase)\b/i.test(quantityText);
      const target = /\b(?:set|total)\b|\b(?:to|at)\s*[-+]?\d/i.test(quantityText) && !/\bby\b/i.test(quantityText);
      const change = !target && (increase || decrease || /\bby\b/i.test(quantityText));
      const requested = numbers.length === 1 ? Number(numbers[0]) : NaN;
      if ((mode === "target" ? !target || requested !== quantity : !change || (decrease ? -Math.abs(requested) : requested) !== quantity) || (decrease && increase)) return clarify("Specify a single exact target (set to) or signed change (add/remove) for the reviewed line.");
      if (!reason && !explicitOverride || reason && !message.includes(reason)) return clarify("Restate the line and physical ready quantity with the reason PrintersHero should record (for example, 'because the pieces were inspected').");
      if (lineNumber && page.route.split(/[?#]/)[0] !== `/fulfillment/orders/${page.entityId}`) return clarify("Supply the line ID, or open the Fulfillment order to use its displayed line number.");
      const scope = { ...context.scope, orderId: page.entityId };
      try {
        const evidence = await read(scope);
        if (evidence.status !== "available" || !evidence.operationAuthority.canConfirmPhysicalReadiness) return { status: "permission_denied", warning: "Cannot verify permission or read the selected fulfillment order." };
        const selectedId = lineNumber ? page.displayedFulfillmentLineIds?.[lineNumber - 1] : lineId;
        const line = evidence.lines.find(item => item.id === selectedId);
        if (!line) return clarify("That line was not identified in the current fulfillment evidence. Verify the line in Fulfillment; nothing was changed.");
        const delta = mode === "target" ? quantity - line.quantities.readyWaitingQuantity : quantity;
        if (!delta) return clarify("That would not change the current physical ready quantity.");
        const result = await preview(scope, { orderLineItemId: line.id, quantityDelta: delta, reason: reason ?? "AI Override" });
        if (result.expectedReadyQuantity !== line.quantities.readyWaitingQuantity) return clarify("Readiness changed while preparing the review. Retrieve the current quantities again.");
        const args = preparePhysicalReadinessCommandArguments(result);
        const summary = `Order ${scope.orderId}, ${lineNumber ? `line ${lineNumber}: ` : ""}${line.productName} (${line.id}): physical ready quantity ${result.expectedReadyQuantity} to ${result.expectedReadyQuantity + delta} (${delta > 0 ? "+" : ""}${delta}); current fulfillment status: ${result.nativeStatus}. Reason: ${result.input.reason}. Production jobs remain unchanged. No adjustment until GO.`;
        return { status: "succeeded", result: { status: "succeeded", data: { response: summary } }, presentation: { cards: [{ kind: "action_proposal", title: "Review physical readiness adjustment", summary, sourceLinks: [{ label: "Open Fulfillment", href: evidence.navigation.fulfillment }], plan: { action: physicalReadinessCommandName, arguments: args, proposalFingerprint: createHash("sha256").update(JSON.stringify(args)).digest("hex") } }] } };
      } catch (error) {
        return clarify(error instanceof PhysicalReadinessAdjustmentError ? error.message : "Unable to verify the current fulfillment line. No adjustment was submitted.");
      }
    },
  };
}
