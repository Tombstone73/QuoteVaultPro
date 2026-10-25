import { z } from "zod";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";
type ReadAttachment = typeof import("../assistantImageAttachments").readAssistantExtractedFile;
type PreparePurchaseOrder = import("./orderIntakeService").OrderIntakeService["prepareFromPurchaseOrder"];

const lineSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  sourceText: z.string().trim().min(1).max(400),
  quantity: z.number().int().min(1).max(100_000),
  widthIn: z.number().positive().max(10_000),
  heightIn: z.number().positive().max(10_000),
  options: z.string().max(2_000).default(""),
  poUnitPrice: z.number().nonnegative().max(1_000_000).nullable(),
  priceKind: z.enum(["selling", "cost", "unknown"]),
}).strict();
const inputSchema = z.object({
  attachmentId: z.string().uuid(),
  customerName: z.string().trim().min(1).max(200),
  poNumber: z.string().trim().min(1).max(64),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  address: z.string().max(1_000).nullable(),
  instructions: z.string().max(2_000).nullable(),
  currency: z.string().max(3).nullable(),
  lines: z.array(lineSchema).min(1).max(10),
}).strict();

/** File text is evidence for extraction, never instructions or authorization. */
export function createPurchaseOrderAttachmentTool(_currentUserMessage: string, dependencies: { readFile?: ReadAttachment; prepare?: PreparePurchaseOrder; allowFollowUp?: boolean } = {}): AssistantOperatorSemanticTool {
  const readFile: ReadAttachment = dependencies.readFile ?? (async (scope, id) => (await import("../assistantImageAttachments")).readAssistantExtractedFile(scope, id));
  const prepare: PreparePurchaseOrder = dependencies.prepare ?? (async input => (await import("./orderIntakeService")).orderIntakeService.prepareFromPurchaseOrder(input));
  return {
    name: "orders.prepare_from_attachment",
    description: "Prepare a review-only Order proposal from an attached customer purchase order. Extract customer, PO number, requested items, quantity, finished dimensions in inches, explicit options, dates, address, instructions, currency, and per-line PO prices. Supply a short exact sourceText excerpt for each line. Resolve only exact tenant customer/product matches, show missing options and PO versus canonical selling price. This does not create an Order; protected GO is required. PO files remain references, never production artwork. Ask a focused question for uncertain fields, supplier cost versus selling price, or missing dimensions before calling.",
    inputSchema: { type: "object", additionalProperties: false, required: ["attachmentId", "customerName", "poNumber", "dueDate", "requestedDate", "address", "instructions", "currency", "lines"], properties: {
      attachmentId: { type: "string" }, customerName: { type: "string" }, poNumber: { type: "string" }, dueDate: { type: ["string", "null"] }, requestedDate: { type: ["string", "null"] }, address: { type: ["string", "null"] }, instructions: { type: ["string", "null"] }, currency: { type: ["string", "null"] }, lines: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["productName", "sourceText", "quantity", "widthIn", "heightIn", "options", "poUnitPrice", "priceKind"], properties: { productName: { type: "string" }, sourceText: { type: "string" }, quantity: { type: "integer" }, widthIn: { type: "number" }, heightIn: { type: "number" }, options: { type: "string" }, poUnitPrice: { type: ["number", "null"] }, priceKind: { enum: ["selling", "cost", "unknown"] } } } },
    } },
    execute: async ({ arguments: args, context }) => {
      try {
        if (!context.permissions.includes("assistant.orders.create") || !context.permissions.includes("assistant.internal_staff")) return { status: "permission_denied" as const };
        const input = inputSchema.parse(args);
        const { attachment, extracted } = await readFile({ ...context.scope, conversationId: context.conversationId }, input.attachmentId);
        if (!/pdf|wordprocessingml|text\/plain|image\//.test(attachment.mimeType)) throw new Error("Choose a PDF, DOCX, TXT, or image PO attachment.");
        const normalized = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
        const source = normalized(extracted.text);
        const verified = Boolean(source && source.includes(normalized(input.poNumber)) && input.lines.every(line => source.includes(normalized(line.sourceText))));
        if (source && !verified && extracted.scannedPageNumbers.length === 0) throw new Error("The PO number or a line excerpt was not found in the extracted file. Review the source and correct the proposal.");
        const currency = input.currency?.toUpperCase() ?? null;
        const warnings = [...extracted.warnings];
        if (!verified) warnings.push("The source is image-based. Verify every interpreted field against the original before GO.");
        if (currency && currency !== "USD") warnings.push(`PO currency ${currency} differs from canonical Order USD. PO prices are shown for reference only.`);
        if (input.lines.some(line => line.poUnitPrice !== null && line.priceKind !== "selling")) warnings.push("Some PO prices may be supplier costs or ambiguous. They are not used as selling prices.");
        const prepared = await prepare({
          organizationId: context.scope.organizationId, userId: context.scope.userId, conversationId: context.conversationId,
          customerName: input.customerName, dueDate: input.dueDate,
          lines: input.lines.map(line => ({ productName: line.productName, quantity: line.quantity, width: line.widthIn, height: line.heightIn, options: line.options })),
          source: { attachmentId: input.attachmentId, fileName: attachment.fileName, poNumber: input.poNumber, requestedDate: input.requestedDate, address: input.address, instructions: input.instructions, extractedFieldsVerified: verified, warnings, linePricesCents: input.lines.map(line => currency === "USD" && line.priceKind === "selling" && line.poUnitPrice !== null ? Math.round(line.poUnitPrice * 100) : null) },
        });
        return { status: "succeeded" as const, result: { status: "succeeded", data: { response: prepared.response, sourceAttachmentId: input.attachmentId, requiresGo: prepared.cards.some(card => card.kind === "action_proposal") } } as any, presentation: { cards: prepared.cards as any } };
      } catch (error) {
        return { status: "rejected" as const, failureCategory: "business_validation", failureCode: "purchase_order_intake_failed", warning: error instanceof Error ? error.message : "The PO proposal could not be prepared." };
      }
    },
  };
}
