import { z } from "zod";

// Deliberately finite vocabularies. Provider messages and arbitrary codes can
// contain customer input; never forward them to the diagnostic transport.
const errorMessages = {
  incomplete_number: "Your card number is incomplete.",
  incomplete_expiry: "Your card expiration date is incomplete.",
  incomplete_cvc: "Your card security code is incomplete.",
  incomplete_zip: "Your postal code is incomplete.",
  invalid_number: "Your card number is invalid.",
  invalid_expiry_month: "Your card expiration month is invalid.",
  invalid_expiry_year: "Your card expiration year is invalid.",
  invalid_expiry_year_past: "Your card expiration year is in the past.",
  invalid_cvc: "Your card security code is invalid.",
  expired_card: "Your card has expired.",
  incorrect_cvc: "Your card security code is incorrect.",
  card_declined: "Your card was declined.",
  processing_error: "A payment processing error occurred.",
  payment_intent_unexpected_state: "The payment is in an unexpected state.",
  unknown: "Stripe reported an error; review the payment form.",
} as const;
const errorTypes = ["validation_error", "card_error", "api_error", "api_connection_error", "authentication_error", "invalid_request_error", "rate_limit_error", "idempotency_error", "unknown"] as const;
export function safeStripeDiagnosticError(error: unknown) {
  const source = error && typeof error === "object" ? error as { code?: unknown; type?: unknown } : {};
  const code = typeof source.code === "string" && Object.prototype.hasOwnProperty.call(errorMessages, source.code)
    ? source.code as keyof typeof errorMessages : "unknown";
  const type = errorTypes.includes(source.type as any) ? source.type as typeof errorTypes[number] : "unknown";
  return { code, type, message: errorMessages[code] };
}

export const stripeDiagnosticEventSchema = z.object({
  event: z.enum(["dialog_open", "element_mount", "element_unmount", "element_ready", "element_change", "element_load_error", "viewport_change", "submit_result", "confirm_result", "dialog_success", "dialog_close", "initialization_error"]),
  sequence: z.number().int().min(1).max(100),
  timestamp: z.string().datetime(),
  width: z.number().int().min(0).max(20000),
  height: z.number().int().min(0).max(20000),
  mountCount: z.number().int().min(0).max(100),
  ready: z.boolean(),
  elementType: z.literal("payment").optional(),
  complete: z.boolean().optional(),
  empty: z.boolean().optional(),
  success: z.boolean().optional(),
  error: z.object({
    code: z.enum(Object.keys(errorMessages) as [keyof typeof errorMessages, ...Array<keyof typeof errorMessages>]),
    type: z.enum(errorTypes),
    message: z.string().max(100),
  }).strict().transform(safeStripeDiagnosticError).optional(),
}).strict();
export const stripeDiagnosticBatchSchema = z.object({
  sessionId: z.string().uuid(),
  surface: z.enum(["guest_invoice", "portal_invoice", "grouped_portal_invoices", "staff_payment"]),
  events: z.array(stripeDiagnosticEventSchema).min(1).max(20),
}).strict();
export type StripeDiagnosticEvent = z.infer<typeof stripeDiagnosticEventSchema>;
export type StripeDiagnosticSurface = z.infer<typeof stripeDiagnosticBatchSchema>["surface"];
