import { z } from "zod";
export const REDO_REASONS = ["Print quality", "Production error", "Shipping damage", "Missing pieces", "Customer-requested replacement", "Other"] as const;
export const REDO_DISPOSITIONS = ["no_customer_charge", "charge_customer"] as const;
const cents = z.number().int().min(0).max(2147483647);
const redoOrderDetails = z.object({
  requestKey: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  lines: z.array(z.object({ sourceLineItemId: z.string().min(1), quantity: z.number().int().positive().max(2147483647), expectedUpdatedAt: z.string().datetime(), priceOverrideTotalCents: cents.optional() }).strict()).min(1).max(500),
  reason: z.enum(REDO_REASONS),
  explanation: z.string().trim().max(2000).default(""),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(value + "T12:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; }, "A valid promised date is required"),
  disposition: z.enum(REDO_DISPOSITIONS),
  shipping: z.object({ decision: z.enum(["free", "manual"]), amountCents: cents }).strict().optional(),
}).strict();
function validateDisposition(value: z.infer<typeof redoOrderDetails>, ctx: z.RefinementCtx) {
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
