export function shouldAutoScheduleCreatedOrderLineItem(input: {
  duplicateSourceLineItemId?: string | null;
  isServiceFee: boolean;
  sendToProductionDefault: boolean;
  workflowState: string;
}): boolean {
  return !input.duplicateSourceLineItemId
    && !input.isServiceFee
    && input.sendToProductionDefault
    && input.workflowState === "ready_for_production";
}
