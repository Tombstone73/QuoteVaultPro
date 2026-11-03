import { z } from "zod";
export const REDO_REASONS = ["Print quality", "Production error", "Shipping damage", "Missing pieces", "Customer-requested replacement", "Other"] as const;
export const REDO_DISPOSITIONS = ["no_customer_charge", "charge_customer"] as const;
const cents = z.number().int().min(0).max(2147483647);
const redoOrderDetails = z.object({
  requestKey: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  // Zero is an explicit reuse decision, never an Order/production line quantity.
  lines: z.array(z.object({ sourceLineItemId: z.string().min(1), quantity: z.number().int().min(0).max(2147483647), expectedUpdatedAt: z.string().datetime(), priceOverrideTotalCents: cents.optional() }).strict()).min(1).max(500),
  reason: z.enum(REDO_REASONS),
  explanation: z.string().trim().max(2000).default(""),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(value + "T12:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; }, "A valid promised date is required"),
  disposition: z.enum(REDO_DISPOSITIONS),
  shipping: z.object({ decision: z.enum(["free", "manual"]), amountCents: cents }).strict().optional(),
}).strict();
function validateDisposition(value: z.infer<typeof redoOrderDetails>, ctx: z.RefinementCtx) {
  if (!value.lines.some(line => line.quantity > 0)) ctx.addIssue({code:"custom",path:["lines"],message:"Select at least one item to reproduce."});
  value.lines.forEach((line,index) => {
    if (line.quantity === 0 && (line.priceOverrideTotalCents ?? 0) !== 0) ctx.addIssue({code:"custom",path:["lines",index,"priceOverrideTotalCents"],message:"Reused components cannot have a replacement charge."});
  });
  if (value.reason === "Other" && !value.explanation) ctx.addIssue({ code:"custom",path:["explanation"],message:"Explain the Other reason" });
  if (value.disposition === "no_customer_charge" && (value.lines.some(line => (line.priceOverrideTotalCents ?? 0) !== 0) || (value.shipping?.amountCents ?? 0) !== 0 || (value.shipping && value.shipping.decision !== "free"))) ctx.addIssue({code:"custom",path:["disposition"],message:"No-charge replacements must have zero customer charges."});
  if (value.disposition === "charge_customer" && !value.shipping) ctx.addIssue({code:"custom",path:["shipping"],message:"Choose an explicit shipping charge decision."});
  if (value.shipping?.decision === "free" && value.shipping.amountCents !== 0) ctx.addIssue({code:"custom",path:["shipping"],message:"Free shipping must have a zero charge."});
}
export const redoOrderPreviewSchema = redoOrderDetails.superRefine(validateDisposition);
export const createRedoOrderSchema = redoOrderDetails.extend({
  confirmed: z.literal(true),
  pricingReview: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value,ctx) => {
  validateDisposition(value,ctx);
  if (value.disposition === "charge_customer" && !value.pricingReview) ctx.addIssue({code:"custom",path:["pricingReview"],message:"Review the replacement customer total before confirming."});
});
export type RedoOrderDetails = z.infer<typeof redoOrderPreviewSchema>;
export type CreateRedoOrderRequest = z.infer<typeof createRedoOrderSchema>;
export type RedoPricingPreview = { reviewKey: string; subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number; taxRate: number; lines: Array<{ sourceLineItemId: string; quantity: number; sellingTotalCents: number; taxCents: number; includedInParent: boolean }> };
export type RedoOrderReference = { id: string; orderNumber: string; displayNumber: string | null; redoReason: string | null; promisedDate: string | null; status: string; state: string };

export type RedoSourceLine = {
  id: string;
  description: string;
  quantity: number;
  parentLineItemId?: string | null;
  lineItemRole?: string | null;
};

/** Group identity follows the saved links. A linked ordinary sales line is not
 * a synthetic `parent` pricing wrapper (see canonical lineItemBundles). */
export function redoSourceGroupId(line: RedoSourceLine, sources: readonly RedoSourceLine[]): string {
  const byId = new Map(sources.map(source => [source.id, source]));
  const visited = new Set<string>();
  let current = line;
  while (current.parentLineItemId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentLineItemId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/** Redo-only selection contract, shared by the form and authoritative command.
 * Every component needs an explicit reproduce/reuse decision. Normal Order
 * grouping, pricing and production validation remain unchanged. */
export function redoGroupSelectionError(sources: readonly RedoSourceLine[], selections: readonly { sourceLineItemId: string; quantity: number }[]): string | null {
  const byId = new Map(sources.map(line => [line.id, line]));
  const requested = new Map(selections.map(line => [line.sourceLineItemId, line.quantity]));
  if (requested.size !== selections.length) return "Each source line may be selected only once.";
  if (!selections.some(selection => selection.quantity > 0 && byId.get(selection.sourceLineItemId)?.lineItemRole !== "parent")) return "Select at least one physical item to reproduce.";
  for (const selection of selections) {
    const line = byId.get(selection.sourceLineItemId);
    if (!line) return "Selected lines must belong to this source Order.";
    if (!Number.isInteger(selection.quantity) || selection.quantity < 0 || selection.quantity > line.quantity) return `Enter a replacement quantity from 0 to ${line.quantity} for ${line.description}.`;
    const visited = new Set([line.id]);
    let current = line;
    while (current.parentLineItemId) {
      const parent = byId.get(current.parentLineItemId);
      if (!parent) return `The source link for ${current.description} is missing. Review its assembly before creating a replacement.`;
      if (visited.has(parent.id)) return "The source assembly contains a circular link. Correct the assembly before creating a replacement.";
      visited.add(parent.id);
      current = parent;
    }
    if (line.lineItemRole === "child" && !line.parentLineItemId) return `The source component ${line.description} has no assembly link. Review the source configuration.`;
    const children = sources.filter(child => child.parentLineItemId === line.id);
    if ((line.parentLineItemId && !requested.has(line.parentLineItemId)) || children.some(child => !requested.has(child.id))) return "Include every component of the selected assembly. Enter 0 for components being reused.";
    if (selection.quantity > 0 && line.parentLineItemId) {
      const parent = byId.get(line.parentLineItemId)!;
      // Only a pricing wrapper imposes bundle proportions. Operational links
      // retain independently selected physical replacement quantities.
      if (parent.lineItemRole === "parent" && (!requested.get(parent.id) || requested.get(parent.id)! * line.quantity !== selection.quantity * parent.quantity)) return "Keep reproduced bundle components in the original whole-piece proportions; enter 0 only for components being reused.";
    }
    if (selection.quantity > 0 && line.lineItemRole === "parent" && !children.some(child => (requested.get(child.id) ?? 0) > 0)) return `Select a component to reproduce in ${line.description}, or enter 0 to reuse the group.`;
  }
  return null;
}

/** Field names are mapped explicitly so concurrency errors never masquerade as promised-date errors. */
export function redoOrderValidationMessages(error: z.ZodError, lineLabels: string[] = []): string[] {
  return Array.from(new Set(error.issues.map(issue => {
    const [field, index, lineField] = issue.path;
    if (field === "lines") {
      if (typeof index !== "number") return "Select at least one item to reproduce.";
      const label = lineLabels[index] || "the selected item";
      if (lineField === "priceOverrideTotalCents") return "Enter a valid replacement selling price for " + label + ".";
      if (lineField === "quantity") return "Enter a replacement quantity for " + label + ".";
      return "Source information for " + label + " is missing or invalid. Refresh the source Order.";
    }
    if (field === "expectedUpdatedAt") return "The source Order timestamp is missing or invalid. Refresh the source Order.";
    if (field === "promisedDate") return "Select a valid promised date.";
    if (field === "shipping") return "Choose free shipping or enter an explicit shipping charge.";
    if (field === "pricingReview") return "Review the current replacement total before confirming the charge.";
    if (field === "disposition") return issue.message === "No-charge replacements must have zero customer charges." ? issue.message : "Choose a financial disposition.";
    if (field === "reason") return "Select a Redo reason.";
    if (field === "explanation") return "Enter an explanation for the Redo reason (up to 2000 characters).";
    if (field === "confirmed") return "Confirm the replacement details before creating the Redo.";
    return "The replacement request is invalid. Review the details and refresh the source Order.";
  })));
}
