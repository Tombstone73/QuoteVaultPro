import { randomUUID } from "crypto";
import { z } from "zod";
import type { AssistantMaterialActionInput } from "./materialActionService";

const span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict();
const sourced = (value: z.ZodTypeAny) => z.object({ value, span }).strict();
const label = z.string().trim().min(1).max(255);
const price = z.object({ amount: z.number().positive().finite().max(999_999), unit: z.string().trim().min(1).max(50), span }).strict();
export const materialPartialCandidateSchema = z.object({
  familyName: sourced(label),
  dimension: z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), displayName: sourced(z.string().trim().min(1).max(100)) }).strict(),
  colors: z.array(sourced(label)).min(1).max(25),
  supplier: sourced(label),
  price,
  sku: z.null(),
}).strict();
export type MaterialPartialCandidate = z.infer<typeof materialPartialCandidateSchema>;

const pendingSchema = z.object({
  version: z.number().int().positive().max(128), conversationId: z.string().min(1), taskId: z.string().min(1), correlationId: z.string().min(1),
  status: z.enum(["awaiting_confirmation", "awaiting_skus"]), questionId: z.string().uuid(), question: z.string().min(1).max(1000),
  sourceMessage: z.string().min(1).max(20_000), candidate: materialPartialCandidateSchema,
  removedColors: z.array(label).max(24).default([]),
  skus: z.record(z.string().trim().min(1).max(100)).default({}),
}).strict();
export type MaterialPendingReview = z.infer<typeof pendingSchema>;
export const MATERIAL_REVIEW_KEY = "materialPendingReviewV1";

function matches(source: string, value: string, location: z.infer<typeof span>): boolean {
  return location.end <= source.length && source.slice(location.start, location.end).toLocaleLowerCase() === value.toLocaleLowerCase();
}

/** Source spans refer to the original user message, never a working summary or a model question. */
export function validateMaterialPartialCandidate(raw: unknown, source: string, removedColors: readonly string[] = []): MaterialPartialCandidate | null {
  if (source.length > 20_000) return null;
  const parsed = materialPartialCandidateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const candidate = parsed.data;
  if (candidate.familyName.value.length + candidate.supplier.value.length + candidate.colors.reduce((total, color) => total + color.value.length, 0) > 700) return null;
  if (![candidate.familyName, candidate.supplier, ...candidate.colors].every((field) => matches(source, field.value, field.span))) return null;
  if (candidate.dimension.key !== candidate.dimension.displayName.value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")) return null;
  const costText = source.slice(candidate.price.span.start, candidate.price.span.end);
  const costMatch = /^\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\/|per\s+)\s*(liter|litre|liters|litres|l)\b$/i.exec(costText);
  if (candidate.price.span.end > source.length || !costMatch || Number(costMatch[1]) !== candidate.price.amount || costMatch[2].toLocaleLowerCase() !== candidate.price.unit.toLocaleLowerCase()) return null;
  if (candidate.dimension.key !== "color" || !/^(?:liter|litre|liters|litres|l)$/i.test(candidate.price.unit)) return null;
  const firstColor = candidate.colors[0]!;
  const lastColor = candidate.colors.at(-1)!;
  const dimensionEvidence = source.slice(candidate.dimension.displayName.span.start, candidate.dimension.displayName.span.end);
  const list = /(?:comes?\s+in|colors?\s*(?:are|include|:))\s+(.+)$/i.exec(dimensionEvidence);
  const listedColors = list?.[1]?.split(/\s*,\s*|\s+and\s+/i).map((color) => color.trim().toLocaleLowerCase());
  const removed = removedColors.map((color) => color.toLocaleLowerCase());
  if (new Set(removed).size !== removed.length || removed.some((color) => !source.toLocaleLowerCase().includes(`remove ${color}`))) return null;
  const expectedColors = listedColors?.filter((color) => !removed.includes(color));
  if (candidate.dimension.displayName.value.toLocaleLowerCase() !== "color" || candidate.dimension.displayName.span.end > source.length
    || candidate.dimension.displayName.span.start > firstColor.span.start || candidate.dimension.displayName.span.end < lastColor.span.end
    || !listedColors || removed.some((color) => !listedColors.includes(color)) || expectedColors?.length !== candidate.colors.length
    || !expectedColors?.every((color, index) => color === candidate.colors[index]!.value.toLocaleLowerCase())) return null;
  if (candidate.colors.some((color) => color.span.start < candidate.familyName.span.end || color.span.end > candidate.price.span.start)) return null;
  if (!/\bfrom\s*$/i.test(source.slice(Math.max(0, candidate.supplier.span.start - 12), candidate.supplier.span.start))) return null;
  const names = candidate.colors.map((color) => color.value.toLocaleLowerCase());
  if (new Set(names).size !== names.length || !candidate.colors.every((color, index) => index === 0 || candidate.colors[index - 1]!.span.end <= color.span.start)) return null;
  return candidate;
}

export function readMaterialPendingReview(changes: Record<string, unknown>, conversationId: string, taskId: string): MaterialPendingReview | null {
  const parsed = pendingSchema.safeParse(changes[MATERIAL_REVIEW_KEY]);
  return parsed.success && parsed.data.conversationId === conversationId && parsed.data.taskId === taskId
    && validateMaterialPartialCandidate(parsed.data.candidate, parsed.data.sourceMessage, parsed.data.removedColors) ? parsed.data : null;
}

export function startMaterialPendingReview(input: { candidate: unknown; sourceMessage: string; question: string; conversationId: string; taskId: string; correlationId: string }): MaterialPendingReview | null {
  const candidate = validateMaterialPartialCandidate(input.candidate, input.sourceMessage);
  if (!candidate) return null;
  return pendingSchema.parse({ version: 1, conversationId: input.conversationId, taskId: input.taskId, correlationId: input.correlationId, status: "awaiting_confirmation", questionId: randomUUID(), question: input.question, sourceMessage: input.sourceMessage, candidate, removedColors: [], skus: {} });
}

export function materialSkuQuestion(review: MaterialPendingReview): string {
  return `What SKU should I use for each color: ${review.candidate.colors.map((color) => color.value).join(", ")}? Please provide each as Color: SKU.`;
}

export function materialConfirmationQuestion(review: MaterialPendingReview): string {
  const { candidate } = review;
  return `Should I set this up as a Material Family named '${candidate.familyName.value}' with one variant per color (${candidate.colors.map((color) => color.value).join(", ")}), each at $${candidate.price.amount} per ${candidate.price.unit} from ${candidate.supplier.value}?`;
}

export type MaterialReply = { kind: "awaiting"; review: MaterialPendingReview; response: string; missingInformation: string[] } | { kind: "cancelled"; response: string } | { kind: "invalid"; response: string } | { kind: "ready"; review: MaterialPendingReview; action: AssistantMaterialActionInput };

export function isAffirmativeMaterialReply(message: string): boolean {
  return /^(?:yes|yep|correct|that's right|go ahead|do it|yes,?\s+that's correct)[.!]?$/i.test(message.trim());
}

export function handleMaterialReply(review: MaterialPendingReview, message: string): MaterialReply {
  const reply = message.trim();
  if (review.version >= 128 || message.length + review.sourceMessage.length >= 20_000) return { kind: "invalid", response: "This Material review reached its safe size limit. No proposal was prepared." };
  if (/^(?:no|nope|cancel|don't do it|do not do it)[.!]?$/i.test(reply)) return { kind: "cancelled", response: "Cancelled the Material review. No Material was created." };
  const remove = /^(?:yes\s*,?\s*but\s+)?remove\s+(.+?)[.!]?$/i.exec(reply);
  const replacePrice = /^(?:make\s+it\s+)?\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\/|per\s+)\s*(liter|litre|liters|litres|l)\s+instead[.!]?$/i.exec(reply);
  if (remove || replacePrice) {
    const colors = remove ? review.candidate.colors.filter((color) => color.value.toLocaleLowerCase() !== remove[1]!.trim().toLocaleLowerCase()) : review.candidate.colors;
    if (!colors.length || (remove && colors.length === review.candidate.colors.length)) return { kind: "invalid", response: "That correction does not match an existing color. No Material was changed." };
    const offset = review.sourceMessage.length + 1;
    const nextPrice = replacePrice ? { amount: Number(replacePrice[1]), unit: replacePrice[2]!, span: { start: offset + message.indexOf("$"), end: offset + message.toLocaleLowerCase().indexOf(replacePrice[2]!.toLocaleLowerCase()) + replacePrice[2]!.length } } : review.candidate.price;
    if (!Number.isFinite(nextPrice.amount) || nextPrice.amount <= 0) return { kind: "invalid", response: "Please provide a positive price per liter. No Material was changed." };
    const candidate = { ...review.candidate, colors, price: nextPrice };
    const updated = pendingSchema.parse({ ...review, candidate, sourceMessage: `${review.sourceMessage}\n${message}`, removedColors: remove ? [...review.removedColors, remove[1]!.trim()] : review.removedColors, skus: {}, version: review.version + 1, status: "awaiting_confirmation", questionId: randomUUID(), question: "pending" });
    const next = { ...updated, question: materialConfirmationQuestion(updated) };
    return { kind: "awaiting", review: next, response: next.question, missingInformation: ["confirmation"] };
  }
  if (review.status === "awaiting_confirmation") {
    if (!isAffirmativeMaterialReply(reply)) return { kind: "invalid", response: `Please answer the current Material question or correct a color or price. ${review.question}` };
    const next = pendingSchema.parse({ ...review, status: "awaiting_skus", version: review.version + 1, questionId: randomUUID(), question: materialSkuQuestion(review) });
    return { kind: "awaiting", review: next, response: next.question, missingInformation: ["color SKUs"] };
  }
  const lines = reply.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const skus = { ...review.skus };
  if (!lines.length) return { kind: "invalid", response: materialSkuQuestion(review) };
  for (const line of lines) {
    const entry = /^([^:\n]{1,255}):\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,99})$/.exec(line);
    if (!entry) return { kind: "invalid", response: materialSkuQuestion(review) };
    const color = review.candidate.colors.find((item) => item.value.toLocaleLowerCase() === entry[1]!.trim().toLocaleLowerCase());
    if (!color || skus[color.value] || Object.values(skus).some((sku) => sku.toLocaleLowerCase() === entry[2]!.toLocaleLowerCase())) return { kind: "invalid", response: "The SKUs must use each existing color once, without duplicate SKUs. No Material was changed." };
    skus[color.value] = entry[2]!;
  }
  const next = pendingSchema.parse({ ...review, skus, version: review.version + 1, questionId: randomUUID() });
  if (Object.keys(skus).length !== next.candidate.colors.length) {
    const response = `Please provide Color: SKU for ${next.candidate.colors.filter((color) => !skus[color.value]).map((color) => color.value).join(", ")}.`;
    return { kind: "awaiting", review: { ...next, question: response }, response, missingInformation: ["color SKUs"] };
  }
  const { candidate } = next;
  const action: AssistantMaterialActionInput = {
    action: "materials.create_family", family: { name: candidate.familyName.value, dimensions: [{ key: candidate.dimension.key, displayName: candidate.dimension.displayName.value }] },
    variants: candidate.colors.map((color) => ({
      material: { name: `${candidate.familyName.value} / ${color.value}`, sku: skus[color.value], type: "liquid", materialForm: "liquid", inventoryUnit: "milliliter", consumptionUnit: "milliliter", purchaseUnit: candidate.price.unit, costPerPurchaseUnit: candidate.price.amount, preferredVendorName: candidate.supplier.value },
      values: [{ dimensionKey: candidate.dimension.key, value: color.value }],
    })),
  };
  return { kind: "ready", review: next, action };
}
