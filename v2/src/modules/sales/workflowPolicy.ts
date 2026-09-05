/** Tenant policy for deliberately exceptional Order-line workflow paths.
 * Missing or malformed settings are STRICT, so existing tenants never become
 * more permissive until an authorized operator explicitly opts in. */
export type OrganizationWorkflowPolicy = "flexible" | "guided" | "strict";
export type WorkflowBypassAction = "direct_production" | "production_not_required";
export const DEFAULT_ORGANIZATION_WORKFLOW_POLICY: OrganizationWorkflowPolicy = "strict";

export const organizationWorkflowPolicy = (value: unknown): OrganizationWorkflowPolicy =>
  value === "flexible" || value === "guided" || value === "strict" ? value : DEFAULT_ORGANIZATION_WORKFLOW_POLICY;

/** Existing tenant settings JSON path; this intentionally creates no parallel
 * organization-settings authority. */
export const organizationWorkflowPolicyFromSettings = (settings: unknown): OrganizationWorkflowPolicy => {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return DEFAULT_ORGANIZATION_WORKFLOW_POLICY;
  const preferences = (settings as Record<string, unknown>).preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return DEFAULT_ORGANIZATION_WORKFLOW_POLICY;
  const workflow = (preferences as Record<string, unknown>).workflow;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return DEFAULT_ORGANIZATION_WORKFLOW_POLICY;
  return organizationWorkflowPolicy((workflow as Record<string, unknown>).policy);
};

export type WorkflowBypassDecision = Readonly<{ allowed: boolean; confirmationRequired: boolean; reason?: string }>;

/** Every exception requires the narrow workflow.override capability. GUIDED
 * and STRICT additionally make confirmation an explicit command fact. */
export const decideWorkflowBypass = (input: Readonly<{ policy: OrganizationWorkflowPolicy; hasWorkflowOverride: boolean; action: WorkflowBypassAction }>): WorkflowBypassDecision => {
  if (!input.hasWorkflowOverride) return { allowed: false, confirmationRequired: false, reason: "The principal does not have workflow override authority." };
  return input.policy === "flexible" ? { allowed: true, confirmationRequired: false } : { allowed: true, confirmationRequired: true };
};

export type LineProductionRequirement = "required" | "not_required" | "satisfied";
export const effectiveProductionRequirement = (input: Readonly<{ frozenRequiresProduction: boolean; override?: LineProductionRequirement | null }>): LineProductionRequirement =>
  input.override === "not_required" || input.override === "satisfied" ? input.override : input.frozenRequiresProduction ? "required" : "not_required";
