import { z } from "zod";
import { productConfigurationChangesSchema } from "../products/canonicalProductConfigurationOperations";

const optionDefaultOperationSchema = z.object({ op: z.literal("set_option_default"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict();
const configurationOperationSchema = z.object({ op: z.literal("update_product_configuration"), changes: productConfigurationChangesSchema }).strict();

/** Shared DTO only: it contains no database or execution dependency, so command
 * registration can validate a proposal without importing a Product service. */
export const existingProductEditOperationListSchema = z.array(z.union([optionDefaultOperationSchema, configurationOperationSchema])).min(1).max(12);
export const existingProductEditOperationsSchema = z.object({
  operations: existingProductEditOperationListSchema,
}).strict().superRefine((value, ctx) => {
  const configurationOperations = value.operations.filter((operation) => operation.op === "update_product_configuration");
  if (configurationOperations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A product configuration operation cannot be mixed with PBV2 option-default operations." });
});
export type ExistingProductEditOperations = z.infer<typeof existingProductEditOperationsSchema>;
