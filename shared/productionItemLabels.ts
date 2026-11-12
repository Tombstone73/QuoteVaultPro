import { z } from "zod";
import type { OrderTravelerSource } from "./productionTicket";

export const productionLabelModeNames = {
  description: "Plain Description",
  panels: "Numbered Panels",
  batches: "Quantity Batches",
} as const;
export const productionLabelConfirmationThreshold = 100;
export const productionLabelJobLimit = 500;
export const defaultProductionLabelMedia = { widthMm: 80, heightMm: 50 };

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const selectionSchema = z.object({ start: positiveInteger, end: positiveInteger }).strict();
const fieldsSchema = z.object({ orderNumber: z.boolean(), lineNumber: z.boolean(), description: z.boolean(), dimensions: z.boolean() }).strict();
const mediaWidth = z.number().min(40).max(120);
const mediaHeight = z.number().min(20).max(160);
export const productionLabelMediaSchema = z.object({ widthMm: mediaWidth, heightMm: mediaHeight }).strict();
const common = { scope: z.enum(["order", "line", "partial"]), partialQuantity: positiveInteger.optional(), fields: fieldsSchema };
const line = { lineItemId: identifier, artworkReference: z.string().trim().max(120).optional() };

export const productionLabelOptionsSchema = z.discriminatedUnion("mode", [
  z.object({ ...common, mode: z.literal("description"), lines: z.array(z.object(line).strict()).min(1).max(productionLabelJobLimit) }).strict(),
  z.object({ ...common, mode: z.literal("panels"), lines: z.array(z.object({
    ...line, panelCount: positiveInteger, selection: selectionSchema.optional(),
  }).strict()).min(1).max(productionLabelJobLimit) }).strict(),
  z.object({ ...common, mode: z.literal("batches"), lines: z.array(z.object({
    ...line, total: positiveInteger, perBatch: positiveInteger, showRanges: z.boolean(), selection: selectionSchema.optional(),
  }).strict()).min(1).max(productionLabelJobLimit) }).strict(),
]);
export const productionLabelPreviewRequestSchema = z.object({
  options: productionLabelOptionsSchema,
  destination: z.discriminatedUnion("type", [
    z.object({ type: z.literal("browser"), media: productionLabelMediaSchema }).strict(),
    z.object({ type: z.literal("printer"), id: identifier }).strict(),
  ]),
}).strict();
export const productionLabelPrintRequestSchema = z.object({
  options: productionLabelOptionsSchema, destinationId: identifier, confirmedLargeJob: z.boolean(),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestKey: identifier,
}).strict();
const labelSchema = z.object({ lineItemId: identifier, lineNumber: positiveInteger, rows: z.array(z.string()).min(1).max(6) });
export const productionLabelDocumentSchema = z.object({
  mode: z.enum(["description", "panels", "batches"]),
  media: productionLabelMediaSchema,
  labels: z.array(labelSchema).min(1).max(productionLabelJobLimit),
});
export const claimedProductionLabelSchema = z.object({
  jobId: identifier, documentType: z.literal("production_item_label"), document: productionLabelDocumentSchema,
});
export const productionLabelPrintContextSchema = z.object({
  document: productionLabelDocumentSchema,
  labelCount: z.number().int().min(1).max(productionLabelJobLimit),
  mode: productionLabelDocumentSchema.shape.mode,
  lines: z.array(z.object({ lineItemId: identifier, lineNumber: positiveInteger, labelCount: positiveInteger })).min(1).max(productionLabelJobLimit),
  queueName: z.string().min(1).max(255),
  destinationName: z.string().min(1).max(160),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ProductionLabelOptions = z.infer<typeof productionLabelOptionsSchema>;
export type ProductionLabelDocument = z.infer<typeof productionLabelDocumentSchema>;
export type ProductionLabelMedia = z.infer<typeof productionLabelMediaSchema>;
export type ProductionLabelPreviewRequest = z.infer<typeof productionLabelPreviewRequestSchema>;
export type ProductionLabelSource = { orderNumber: string; lines: { id: string; number: number; description: string; dimensions: string | null; quantity: number }[] };
export type ProductionLabelDestination = { id: string; name: string; queueName: string | null; media: ProductionLabelMedia | null; isDefault: boolean; unavailableReason: string | null };

export function productionLabelSource(source: OrderTravelerSource): ProductionLabelSource {
  return {
    orderNumber: source.orderNumber,
    lines: source.lineItems.flatMap((line, index) => line.orderLineItemId ? [{
      id: line.orderLineItemId, number: index + 1, description: line.description, dimensions: line.size ?? null, quantity: line.quantity,
    }] : []),
  };
}

export function productionLabelBatchCount(total: number, perBatch: number) {
  return Math.floor((total - 1) / perBatch) + 1;
}

export function buildProductionLabelDocument(source: ProductionLabelSource, input: ProductionLabelOptions, media: ProductionLabelMedia): ProductionLabelDocument {
  const options = productionLabelOptionsSchema.parse(input);
  const dimensions = productionLabelMediaSchema.parse(media);
  const selectedIds = new Set(options.lines.map(item => item.lineItemId));
  if (selectedIds.size !== options.lines.length || (options.scope === "order" ? selectedIds.size !== source.lines.length : selectedIds.size !== 1)) {
    throw new Error("Select the saved Order lines for this scope.");
  }
  const savedLines = source.lines.filter(line => selectedIds.has(line.id));
  if (savedLines.length !== selectedIds.size) throw new Error("A selected line is no longer available on this Order.");
  const partial = options.partialQuantity;
  if (options.scope === "partial" ? partial === undefined || partial > savedLines[0].quantity : partial !== undefined) {
    throw new Error("Enter a partial quantity no greater than the ordered line quantity.");
  }
  const configurations = new Map(options.lines.map(item => [item.lineItemId, item]));
  const labels: ProductionLabelDocument["labels"] = [];
  const lineIdentities = new Set<string>();
  for (const line of savedLines) {
    const config = configurations.get(line.id)!;
    const prefix = options.fields.lineNumber ? (options.fields.description && line.description.trim() ? line.number + ". " : "Line " + line.number) : "";
    const rows = [
      options.fields.orderNumber && source.orderNumber ? "Order " + source.orderNumber : "",
      prefix + (options.fields.description ? line.description.trim() : ""),
      options.fields.dimensions ? line.dimensions ?? "" : "",
      config.artworkReference ? "Artwork: " + config.artworkReference : "",
      partial !== undefined && options.mode !== "batches" ? "Quantity " + partial + " of " + line.quantity : "",
    ].filter(Boolean);
    const identity = JSON.stringify(rows);
    if (lineIdentities.has(identity)) throw new Error("Include line numbers or other distinct information to identify each selected line.");
    lineIdentities.add(identity);
    if (options.mode === "description") {
      if (!rows.length) throw new Error("Choose at least one available identification field for line " + line.number + ".");
      labels.push({ lineItemId: line.id, lineNumber: line.number, rows });
      continue;
    }
    const batch = "perBatch" in config ? config : null;
    if (batch && partial !== undefined && batch.total !== partial) throw new Error("Batch total must match the selected partial quantity.");
    const count = batch ? productionLabelBatchCount(batch.total, batch.perBatch) : "panelCount" in config ? config.panelCount : 0;
    const selection = "selection" in config ? config.selection : undefined;
    const start = selection?.start ?? 1;
    const end = selection?.end ?? count;
    if (start > end || end > count) throw new Error("The label range for line " + line.number + " is outside 1–" + count + ".");
    if (end - start + 1 > productionLabelJobLimit - labels.length) {
      throw new Error("A print job can contain up to " + productionLabelJobLimit + " labels. Split this request into smaller ranges.");
    }
    for (let index = start; index <= end; index += 1) {
      let numbering = index + " of " + count;
      if (batch) {
        const last = index === count ? batch.total : index * batch.perBatch;
        const first = (index - 1) * batch.perBatch + 1;
        numbering = (batch.showRanges ? first + "-" + last : String(last)) + " of " + batch.total;
      }
      labels.push({ lineItemId: line.id, lineNumber: line.number, rows: [...rows, numbering] });
    }
  }
  return productionLabelDocumentSchema.parse({ mode: options.mode, media: dimensions, labels });
}

export function summarizeProductionLabels(document: ProductionLabelDocument) {
  const lines = new Map<string, { lineItemId: string; lineNumber: number; labelCount: number }>();
  for (const label of document.labels) {
    const entry = lines.get(label.lineItemId) ?? { lineItemId: label.lineItemId, lineNumber: label.lineNumber, labelCount: 0 };
    entry.labelCount += 1;
    lines.set(label.lineItemId, entry);
  }
  return { mode: document.mode, labelCount: document.labels.length, lines: Array.from(lines.values()) };
}
