import { describe, expect, test } from "@jest/globals";
import {
  assistantIntentPlanSchema,
  fingerprintAssistantIntentPlan,
  normalizeAssistantIntentPlan,
} from "../services/assistant/aiFirstIntentPlannerContract";
import { assistantCapabilityCatalog, getAssistantCapability, validateAssistantCapabilityCatalog } from "../services/assistant/aiFirstCapabilityCatalog";

const productCreationPlan = {
  version: 1,
  operation: "create",
  domain: "products",
  mode: "mutation",
  capabilityId: "canonical_product_intent_compiler",
  confidence: "high",
  target: { kind: "new_entity", entityId: null },
  contextUsage: { workspaceIsAuthoritative: false, workspaceRelevance: "supporting", activeSessionId: null },
  requiresClarification: false,
  clarificationQuestion: null,
  reasonCode: "explicit_new_entity_request",
} as const;

describe("AI-first intent planner contract", () => {
  test("accepts a typed new-product plan without making workspace context authoritative", () => {
    expect(normalizeAssistantIntentPlan(productCreationPlan)).toMatchObject({
      capabilityId: "canonical_product_intent_compiler",
      target: { kind: "new_entity" },
      contextUsage: { workspaceIsAuthoritative: false },
    });
  });

  test("rejects provider prose, unknown fields, and invalid operation-mode combinations", () => {
    expect(assistantIntentPlanSchema.safeParse({ ...productCreationPlan, providerExplanation: "make a product" }).success).toBe(false);
    expect(assistantIntentPlanSchema.safeParse({ ...productCreationPlan, mode: "read" }).success).toBe(false);
    expect(assistantIntentPlanSchema.safeParse({ ...productCreationPlan, contextUsage: { ...productCreationPlan.contextUsage, workspaceIsAuthoritative: true } }).success).toBe(false);
  });

  test("requires a clarification question only for a clarification plan", () => {
    const clarification = {
      ...productCreationPlan,
      operation: "clarify",
      domain: "unknown",
      mode: "none",
      capabilityId: null,
      target: { kind: "none", entityId: null },
      requiresClarification: true,
      clarificationQuestion: "Which inactive product should I update?",
      reasonCode: "ambiguous_request",
    } as const;
    expect(assistantIntentPlanSchema.safeParse(clarification).success).toBe(true);
    expect(assistantIntentPlanSchema.safeParse({ ...clarification, clarificationQuestion: null }).success).toBe(false);
  });

  test("computes a stable server-side plan fingerprint without customer message content", () => {
    const first = fingerprintAssistantIntentPlan(normalizeAssistantIntentPlan(productCreationPlan));
    const reordered = fingerprintAssistantIntentPlan(normalizeAssistantIntentPlan({ ...productCreationPlan, target: { entityId: null, kind: "new_entity" } }));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(reordered);
  });

  test("contains only registered planner-visible capability references", () => {
    expect(() => validateAssistantCapabilityCatalog()).not.toThrow();
    expect(getAssistantCapability("canonical_product_intent_compiler").commandNames).toContain("products.create_from_canonical_intent");
    expect(assistantCapabilityCatalog).toHaveLength(25);
  });

  test("does not expose a runtime free-text routing mode", async () => {
    const plannerModule = await import("../services/assistant/assistantIntentPlanner");
    expect(plannerModule).not.toHaveProperty("resolveAssistantIntentPlannerMode");
    expect(plannerModule).not.toHaveProperty("assistantIntentPlannerModeValues");
  });
});
