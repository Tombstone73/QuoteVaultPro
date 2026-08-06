/**
 * Public composition surface for the AI-first typed planner. Routing and
 * provider adapters depend on this module rather than on legacy router types.
 */
export * from "./aiFirstIntentPlannerContract";
export * from "./aiFirstCapabilityCatalog";

export const assistantIntentPlannerModeValues = ["shadow", "enabled", "disabled"] as const;
export type AssistantIntentPlannerMode = (typeof assistantIntentPlannerModeValues)[number];

export class AssistantIntentPlannerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantIntentPlannerConfigurationError";
  }
}

/**
 * Missing configuration deliberately selects AI-first. A legacy router must
 * therefore be an explicit temporary rollback, never an accidental default.
 */
export function resolveAssistantIntentPlannerMode(env: NodeJS.ProcessEnv = process.env): AssistantIntentPlannerMode {
  const raw = env.AI_FIRST_INTENT_PLANNER?.trim().toLowerCase();
  if (!raw) return "enabled";
  if (raw === "shadow") return "shadow";
  if (raw === "enabled" || raw === "ai_first") return "enabled";
  if (raw === "disabled" || raw === "legacy" || raw === "legacy_rollback") return "disabled";
  throw new AssistantIntentPlannerConfigurationError("AI_FIRST_INTENT_PLANNER must be shadow, enabled, or disabled.");
}
