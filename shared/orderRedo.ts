import { z } from "zod";
export const REDO_REASONS = ["Print quality", "Production error", "Shipping damage", "Missing pieces", "Customer-requested replacement", "Other"] as const;
export const createRedoOrderSchema = z.object({
  requestKey: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  lines: z.array(z.object({ sourceLineItemId: z.string().min(1), quantity: z.number().int().positive().max(2147483647), expectedUpdatedAt: z.string().datetime() }).strict()).min(1).max(500),
  reason: z.enum(REDO_REASONS),
  explanation: z.string().trim().max(2000).default(""),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(value + "T12:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; }, "A valid promised date is required"),
  disposition: z.literal("no_customer_charge"),
  confirmed: z.literal(true),
}).strict().refine(value => value.reason !== "Other" || !!value.explanation, { message: "Explain the Other reason", path: ["explanation"] });
export type CreateRedoOrderRequest = z.infer<typeof createRedoOrderSchema>;
export type RedoOrderReference = { id: string; orderNumber: string; displayNumber: string | null; redoReason: string | null; promisedDate: string | null; status: string; state: string };

/** Field names are mapped explicitly so concurrency errors never masquerade as promised-date errors. */
export function redoOrderValidationMessages(error: z.ZodError, lineLabels: string[] = []): string[] {
  return Array.from(new Set(error.issues.map(issue => {
    const [field, index, lineField] = issue.path;
    if (field === "lines") {
      if (typeof index !== "number") return "Select at least one item to reproduce.";
      const label = lineLabels[index] || "the selected item";
      if (lineField === "quantity") return "Enter a replacement quantity for " + label + ".";
      return "Source information for " + label + " is missing or invalid. Refresh the source Order.";
    }
    if (field === "expectedUpdatedAt") return "The source Order timestamp is missing or invalid. Refresh the source Order.";
    if (field === "promisedDate") return "Select a valid promised date.";
    if (field === "reason") return "Select a Redo reason.";
    if (field === "explanation") return "Enter an explanation for the Redo reason (up to 2000 characters).";
    if (field === "confirmed") return "Confirm the replacement details before creating the Redo.";
    return "The replacement request is invalid. Review the details and refresh the source Order.";
  })));
}
