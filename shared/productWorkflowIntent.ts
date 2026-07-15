export const PRODUCT_WORKFLOW_INTENTS = ["standard_production", "fulfillment_only", "service_fee"] as const;
export type ProductWorkflowIntent = (typeof PRODUCT_WORKFLOW_INTENTS)[number];

export function isFulfillmentOnlyWorkflow(product: { workflowIntent?: ProductWorkflowIntent | null } | null | undefined): boolean {
  return product?.workflowIntent === "fulfillment_only";
}

export function getProductWorkflowDefaults(product: {
  workflowIntent?: ProductWorkflowIntent | null;
  requiresProductionJob?: boolean | null;
} | null | undefined) {
  const intent = product?.workflowIntent ?? "standard_production";
  if (intent === "fulfillment_only") {
    return { intent, requiresDesign: false, requiresPrepress: false, requiresProofApproval: false, requiresProductionJob: false };
  }
  if (intent === "service_fee") {
    return { intent, requiresDesign: false, requiresPrepress: false, requiresProofApproval: false, requiresProductionJob: false };
  }
  return { intent, requiresDesign: undefined, requiresPrepress: undefined, requiresProofApproval: undefined, requiresProductionJob: product?.requiresProductionJob !== false };
}
