import { orderPreparationRequestSchema } from "./orderPreparationContract";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";
import type { AssistantStructuredCard } from "@shared/assistantContracts";
import type { OrderIntakeService } from "./orderIntakeService";
import { createQuoteApplicationTools } from "./quoteApplicationTools";

const nullableText = { type: ["string", "null"] };
const lineFields = {
  productId: { type: "string", description: "Active PBV2 product ID from tenant catalog search. Inspect configuration first." },
  quantity: { type: "integer", minimum: 1 }, width: { type: ["number", "null"], description: "Finished inches; omit for configured fixed-size/quantity products. Never insert 1x1." }, height: { type: ["number", "null"] },
  description: { type: "string" }, productionNotes: nullableText,
  optionSelections: { type: "object", description: "Exact selection keys and values from the active PBV2 configuration. Do not invent options." },
  optionsText: { type: "string", description: "Supplied material, sides, finishing and other requirements, resolved against actual product options." },
  overridePriceCents: { type: ["integer", "null"], minimum: 0, description: "Exact line TOTAL, only if staff explicitly requests an override; requires overrideReason and pricing authorization. PO evidence alone is not authorization." },
  overrideReason: { type: "string" },
};
const lineSchema = { type: "object", additionalProperties: false, properties: lineFields };
const headerFields = Object.fromEntries([
  "customerId", "contactId", "label", "poNumber", "notesInternal", "dueDate", "shippingInstructions",
  "shipToName", "shipToCompany", "shipToEmail", "shipToPhone", "shipToAddress1", "shipToAddress2", "shipToCity", "shipToState", "shipToPostalCode", "shipToCountry",
].map(key => [key, nullableText]));
const deadline = { type: ["object", "null"], additionalProperties: false, required: ["date", "kind", "localTime", "timezone", "instant", "sourceText"], properties: {
  date: { type: "string", description: "YYYY-MM-DD" }, kind: { enum: ["date_only", "eod", "time"] }, localTime: nullableText,
  timezone: nullableText, instant: nullableText, sourceText: nullableText,
} };

/** Reconnect the proven intake service to the current Operator; execution is
 * still exclusively orders.create through the existing protected GO plan. */
export function createOrderPreparationTools(dependencies?: Pick<OrderIntakeService, "inspectPreparation" | "prepareStructuredOrder">): AssistantOperatorSemanticTool[] {
  const service = async () => dependencies ?? (await import("./orderIntakeService")).orderIntakeService;
  const permitted = (permissions: readonly string[]) => permissions.includes("assistant.orders.create") && permissions.includes("assistant.internal_staff");
  const inspectConfiguration = createQuoteApplicationTools()[0]!;
  return [{ ...inspectConfiguration, name: "orders.inspect_configuration", description: inspectConfiguration.description.replace(/Quote/g, "Order"), execute: input => permitted(input.context.permissions) ? inspectConfiguration.execute(input) : Promise.resolve({ status: "permission_denied" as const }) }, {
    name: "orders.inspect_preparation",
    description: "Read the current actor/conversation Order proposal, its intake version and editableLines with stable zero-based indices before corrections. Use editableLines indices even when incomplete lines cannot yet be priced. Reuses conversational and PO proposals. Changes nothing; no attachment is required. Use orders.inspect_configuration for current tenant customer contacts and PBV2 choices, or products.get_pricing/catalog search to investigate products.",
    inputSchema: { type: "object", additionalProperties: false, properties: { sessionId: { type: "string" } } },
    execute: async ({ arguments: args, context }) => {
      if (!permitted(context.permissions)) return { status: "permission_denied" };
      if (Object.keys(args).some(key => key !== "sessionId") || args.sessionId !== undefined && typeof args.sessionId !== "string") return { status: "rejected", failureCategory: "argument_validation", warning: "Supply only an optional sessionId." };
      const data = await (await service()).inspectPreparation({ ...context.scope, conversationId: context.conversationId, sessionId: args.sessionId as string | undefined });
      return { status: "succeeded", result: { status: "succeeded", data, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } } };
    },
  }, {
    name: "orders.prepare_create",
    description: "Prepare or correct a review-only Order from conversation, email or previously inspected document/image evidence using the EXISTING Order intake service. No PO or attachment is required. Resolve IDs through authorized reads. New proposal: header and lines.add. Corrections: inspect_preparation, then sessionId + expectedIntakeVersion and ONLY changed header fields / lines.update (zero-based indices), add or remove. Untouched values survive. Never resubmit all lines to change one field. Resolve relative dates in the organization timezone and ask if ambiguous. Put customer-requested dates in deadlineJson.requested; accepted requires explicit staff commitment. EOD is semantic, never a fake time. PO totals are reference-only customerPoTotalCents. Options lacking safe configured defaults require clarification. Missing artwork is permitted with production deferred; this adapter does not download external links or assign unverified uploads. The existing preview and exact-version GO are required to create the canonical Order and linked draft Invoice; no production release or payment occurs.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      sessionId: { type: "string" }, expectedIntakeVersion: { type: "string" }, customerPoTotalCents: { type: ["integer", "null"], minimum: 0 },
      header: { type: "object", additionalProperties: false, properties: { ...headerFields, priority: { enum: ["rush", "normal", "low"] }, shippingMethod: { enum: ["pickup", "ship", "deliver", null] }, shippingMode: { enum: ["single_shipment", "multi_shipment", null] }, discount: { type: "number", minimum: 0 }, deadlineJson: { type: ["object", "null"], additionalProperties: false, required: ["requested", "accepted"], properties: { requested: deadline, accepted: deadline } } } },
      lines: { type: "object", additionalProperties: false, properties: {
        add: { type: "array", maxItems: 100, items: lineSchema },
        update: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["index", "changes"], properties: { index: { type: "integer", minimum: 0 }, changes: lineSchema } } },
        remove: { type: "array", items: { type: "integer", minimum: 0 } },
      } },
    } },
    execute: async ({ arguments: args, context }) => {
      if (!permitted(context.permissions)) return { status: "permission_denied" };
      const parsed = orderPreparationRequestSchema.safeParse(args);
      if (!parsed.success) return { status: "rejected", failureCategory: "argument_validation", failureCode: "order_preparation_arguments_invalid", validationSchema: "canonical_order_preparation", validationIssuePaths: parsed.error.issues.slice(0, 20).map(issue => issue.path.join(".").slice(0, 160)), validationIssueCodes: parsed.error.issues.slice(0, 20).map(issue => issue.code), warning: "Order preparation arguments are invalid. Inspect the canonical fields and correct the identified paths; no Order was created." };
      try {
        const prepared = await (await service()).prepareStructuredOrder({ ...context.scope, conversationId: context.conversationId, request: parsed.data });
        return { status: "succeeded", result: { status: "succeeded", data: { response: prepared.response, taskDomain: "orders" }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } }, presentation: { cards: prepared.cards as AssistantStructuredCard[] } };
      } catch (error) {
        return { status: "rejected", failureCategory: "business_validation", failureCode: error && typeof error === "object" && "code" in error ? String(error.code) : "order_preparation_failed", warning: error instanceof Error ? error.message : "Order preparation failed. Existing source evidence and proposals are retained." };
      }
    },
  }];
}
