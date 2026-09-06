import { z } from "zod";

export const CUSTOMER_PAYMENT_TERMS = [
  { value: "due_on_receipt", label: "Due on Receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "custom", label: "Custom" },
] as const;

export const CUSTOMER_PAYMENT_TERM_VALUES = [
  "due_on_receipt",
  "net_15",
  "net_30",
  "net_45",
  "custom",
] as const;

export type CustomerPaymentTerm = typeof CUSTOMER_PAYMENT_TERM_VALUES[number];

const customerIdsSchema = z.array(z.string().trim().min(1)).min(1).max(100).superRefine((customerIds, context) => {
  if (new Set(customerIds).size !== customerIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Customer IDs must not contain duplicates." });
  }
});

export const bulkCustomerCommercialConfigurationSchema = z.discriminatedUnion("operation", [
  z.object({
    customerIds: customerIdsSchema,
    operation: z.literal("set_payment_terms"),
    paymentTerms: z.enum(CUSTOMER_PAYMENT_TERM_VALUES),
  }).strict(),
  z.object({
    customerIds: customerIdsSchema,
    operation: z.literal("set_credit_limit"),
    // Null is the explicit "Not set" instruction. The persisted amount stays
    // at zero while creditLimitConfiguredAt distinguishes it from a real $0.
    creditLimit: z.number().finite().min(0).max(99_999_999.99).nullable(),
  }).strict(),
]);

export type BulkCustomerCommercialConfigurationInput = z.infer<typeof bulkCustomerCommercialConfigurationSchema>;
import { z } from "zod";
