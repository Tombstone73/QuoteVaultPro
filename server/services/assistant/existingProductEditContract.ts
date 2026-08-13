import { z } from "zod";
import { productConfigurationChangesSchema } from "../products/canonicalProductConfigurationOperations";
import { pbv2OptionConfigurationMutationsSchema } from "../products/canonicalPbv2OptionConfigurationOperations";
import { productPricingEngineConfigurationChangesSchema } from "../products/canonicalProductPricingEngineConfigurationOperations";

const optionDefaultOperationSchema = z.object({ op: z.literal("set_option_default"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict();
const configurationOperationSchema = z.object({ op: z.literal("update_product_configuration"), changes: productConfigurationChangesSchema }).strict();
const pbv2OptionConfigurationOperationSchema = z.object({ op: z.literal("update_pbv2_option_configuration"), mutations: pbv2OptionConfigurationMutationsSchema }).strict();
const materialOperationSchema = z.object({ op: z.literal("update_product_material"), materialLabel: z.string().trim().min(1).max(255).nullable() }).strict();
const lifecycleOperationSchema = z.object({ op: z.literal("update_product_lifecycle"), isActive: z.boolean(), confirmPublishWarnings: z.boolean().optional().default(false) }).strict();
const publishOperationSchema = z.object({ op: z.literal("publish_product_configuration"), confirmPublishWarnings: z.boolean().optional().default(false) }).strict();
const pricingEngineConfigurationOperationSchema = z.object({ op: z.literal("update_product_pricing_engine_configuration"), changes: productPricingEngineConfigurationChangesSchema }).strict();

/** Shared DTO only: it contains no database or execution dependency, so command
 * registration can validate a proposal without importing a Product service. */
export const existingProductEditOperationListSchema = z.array(z.union([optionDefaultOperationSchema, configurationOperationSchema, pbv2OptionConfigurationOperationSchema, materialOperationSchema, lifecycleOperationSchema, publishOperationSchema, pricingEngineConfigurationOperationSchema])).min(1).max(12);
export const existingProductEditOperationsSchema = z.object({
  operations: existingProductEditOperationListSchema,
}).strict().superRefine((value, ctx) => {
  const configurationOperations = value.operations.filter((operation) => operation.op === "update_product_configuration");
  if (configurationOperations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A product configuration operation cannot be mixed with PBV2 option-default operations." });
  const pbv2Operations = value.operations.filter((operation) => operation.op === "update_pbv2_option_configuration");
  if (pbv2Operations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A canonical PBV2 option operation cannot be mixed with compatibility operations." });
  const materialOperations = value.operations.filter((operation) => operation.op === "update_product_material");
  if (materialOperations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A Product material operation cannot be mixed with other Product edits." });
  const lifecycleOperations = value.operations.filter((operation) => operation.op === "update_product_lifecycle");
  if (lifecycleOperations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A Product lifecycle operation cannot be mixed with other Product edits." });
  const publishOperations = value.operations.filter((operation) => operation.op === "publish_product_configuration");
  if (publishOperations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A Product publish operation cannot be mixed with other Product edits." });
  const pricingEngineOperations = value.operations.filter((operation) => operation.op === "update_product_pricing_engine_configuration");
  if (pricingEngineOperations.length && value.operations.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A Product Pricing Engine configuration operation cannot be mixed with other Product edits." });
});
export type ExistingProductEditOperations = z.infer<typeof existingProductEditOperationsSchema>;

export function existingProductEditValidationDetails(error: z.ZodError): { paths: string[]; codes: string[] } {
  const paths = new Set<string>();
  const codes = new Set<string>();
  const visit = (issue: z.ZodIssue) => {
    const nestedErrors = (issue as z.ZodIssue & { unionErrors?: z.ZodError[] }).unionErrors;
    if (Array.isArray(nestedErrors) && nestedErrors.length) {
      nestedErrors.forEach((nested) => nested.issues.forEach(visit));
      return;
    }
    paths.add(issue.path.length ? issue.path.join(".") : "operations");
    codes.add(issue.code);
  };
  error.issues.forEach(visit);
  return { paths: Array.from(paths).slice(0, 20), codes: Array.from(codes).slice(0, 20) };
}

/** Model-facing projection of the same Existing Product operation DTO.
 *
 * Keep this beside the authoritative Zod contract so provider transport and
 * runtime validation cannot acquire independently maintained discriminators.
 * `oneOf` is intentional: provider adapters recognize and safely flatten this
 * discriminated operation list when their native function transport requires
 * a single object envelope.
 */
export const existingProductEditProviderInputSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["operations"],
  properties: {
    operations: {
      type: "array", minItems: 1, maxItems: 12,
      items: { oneOf: [
        { type: "object", additionalProperties: false, required: ["op", "changes"], properties: { op: { const: "update_product_configuration" }, changes: { type: "object", additionalProperties: false, minProperties: 1, properties: { name: { type: "string" }, description: { type: "string" }, category: { type: ["string", "null"] }, productTypeId: { type: ["string", "null"] }, measurementMode: { enum: ["dimensions_required", "quantity_only"] }, workflowIntent: { enum: ["standard_production", "fulfillment_only", "service_fee"] }, requiresProductionJob: { type: "boolean" }, requiresProofApproval: { type: "boolean" } } } } },
        { type: "object", additionalProperties: false, required: ["op", "materialLabel"], properties: { op: { const: "update_product_material" }, materialLabel: { type: ["string", "null"] } } },
        { type: "object", additionalProperties: false, required: ["op", "isActive"], properties: { op: { const: "update_product_lifecycle" }, isActive: { type: "boolean" } } },
        { type: "object", additionalProperties: false, required: ["op"], properties: { op: { const: "publish_product_configuration" } } },
        { type: "object", additionalProperties: false, required: ["op", "changes"], properties: { op: { const: "update_product_pricing_engine_configuration" }, changes: { type: "object", additionalProperties: false, required: ["allowRotation"], properties: { allowRotation: { type: "boolean" } } } } },
        { type: "object", additionalProperties: false, required: ["op", "mutations"], properties: { op: { const: "update_pbv2_option_configuration" }, mutations: { type: "array", minItems: 1, maxItems: 24, items: { type: "object", required: ["kind"], properties: {
          kind: { enum: ["add_group", "update_group", "add_input", "update_input", "add_choice", "update_choice", "reorder_groups", "reorder_choices"] },
          group: { anyOf: [{ type: "string" }, { type: "object" }] }, input: { anyOf: [{ type: "string" }, { type: "object" }] }, choice: { anyOf: [{ type: "string" }, { type: "object" }] }, changes: { type: "object" }, orderedGroups: { type: "array", items: { type: "string" } }, orderedValues: { type: "array", items: { type: "string" } },
        } } } } },
      ] },
    },
  },
};
