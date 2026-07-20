import { z } from "zod";

export const workflowStatusPillTriggerValues = [
  "order_created",
  "order_needs_review",
  "artwork_requested",
  "proof_sent",
  "proof_approved",
  "sent_to_prepress",
  "sent_to_production",
  "production_started",
  "production_completed",
  "sent_to_fulfillment",
  "ready_for_pickup",
  "ready_to_ship",
  "shipped",
  "picked_up",
  "invoice_created",
  "invoice_finalized",
  "payment_received",
  "order_completed",
  "order_closed",
  "order_canceled",
  "order_on_hold",
  "order_problem",
] as const;

export const workflowStatusPillTriggerSchema = z.enum(workflowStatusPillTriggerValues);
export type WorkflowStatusPillTrigger = z.infer<typeof workflowStatusPillTriggerSchema>;

export const workflowStatusPillAssignmentSourceValues = ["system", "automation"] as const;
export const workflowStatusPillAssignmentSourceSchema = z.enum(workflowStatusPillAssignmentSourceValues);
export type WorkflowStatusPillAssignmentSource = z.infer<typeof workflowStatusPillAssignmentSourceSchema>;

export type DefaultWorkflowStatusPillMapping = {
  triggerKey: WorkflowStatusPillTrigger;
  targetStatusKey: string;
  source: WorkflowStatusPillAssignmentSource;
  overwriteExceptionStatus: boolean;
};

/**
 * Tenant rows are seeded from this list. Runtime resolution never falls back to
 * this constant: a missing or inactive tenant mapping intentionally means skip.
 */
export const DEFAULT_WORKFLOW_STATUS_PILL_MAPPINGS: ReadonlyArray<DefaultWorkflowStatusPillMapping> = [
  { triggerKey: "order_created", targetStatusKey: "new", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "sent_to_prepress", targetStatusKey: "prepress", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "sent_to_production", targetStatusKey: "in_production", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "sent_to_fulfillment", targetStatusKey: "fulfillment", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "production_completed", targetStatusKey: "complete", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "ready_for_pickup", targetStatusKey: "ready_for_pickup", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "ready_to_ship", targetStatusKey: "ready_to_ship", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "shipped", targetStatusKey: "shipped", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "picked_up", targetStatusKey: "picked_up", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "invoice_finalized", targetStatusKey: "invoiced", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "payment_received", targetStatusKey: "paid", source: "system", overwriteExceptionStatus: false },
  { triggerKey: "order_completed", targetStatusKey: "complete", source: "system", overwriteExceptionStatus: true },
  { triggerKey: "order_closed", targetStatusKey: "closed", source: "system", overwriteExceptionStatus: true },
  { triggerKey: "order_canceled", targetStatusKey: "canceled", source: "system", overwriteExceptionStatus: true },
  { triggerKey: "order_on_hold", targetStatusKey: "on_hold", source: "system", overwriteExceptionStatus: true },
  { triggerKey: "order_problem", targetStatusKey: "problem", source: "system", overwriteExceptionStatus: true },
] as const;
