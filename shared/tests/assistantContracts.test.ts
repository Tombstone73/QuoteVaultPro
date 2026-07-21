import { describe, expect, test } from "@jest/globals";
import {
  assistantCapabilitySchema,
  assistantContextEnvelopeSchema,
  assistantTurnRequestSchema,
} from "../assistantContracts";

describe("assistant contracts", () => {
  const validContext = {
    contextVersion: "v1",
    route: "/orders/order_123",
    pageTitle: "Order",
    entityType: "order",
    entityId: "order_123",
    selectedRecordIds: ["line_1"],
    activeFilters: [{ key: "status", value: "active" }],
    capturedAt: "2026-07-21T12:00:00.000Z",
    unsavedChanges: false,
  };

  test("accepts bounded, identifier-only presentation context", () => {
    expect(assistantContextEnvelopeSchema.parse(validContext)).toEqual(validContext);
  });

  test("rejects context that carries unsaved values or too many selected records", () => {
    expect(() => assistantContextEnvelopeSchema.parse({
      ...validContext,
      unsavedValues: { customerName: "Do not send" },
    })).toThrow();

    expect(() => assistantContextEnvelopeSchema.parse({
      ...validContext,
      selectedRecordIds: Array.from({ length: 26 }, (_, index) => "record_" + index),
    })).toThrow();
  });

  test("turn requests cannot supply tenant identity", () => {
    expect(() => assistantTurnRequestSchema.parse({
      message: "What is open?",
      context: validContext,
      organizationId: "untrusted_org",
    })).toThrow();
  });

  test("capabilities make all Stage 1 tool and write flags false", () => {
    const base = {
      enabled: true,
      conversationsEnabled: true,
      toolsEnabled: false,
      providerConfigured: false,
      readToolsEnabled: false,
      registeredReadTools: [],
      writeFrameworkEnabled: false,
      writeActionsEnabled: false,
      productionCommandsEnabled: [],
      productionCommandsPermittedForUser: [],
      externalResearchEnabled: false,
      mcpEnabled: false,
      productActivationEnabled: false,
      activeProductEditingEnabled: false,
      composerHelperText: "Business questions are unavailable.",
      assistantVersion: "v1",
      unavailableReason: null,
      actorScope: { organizationId: "org_1", userId: "user_1" },
    } as const;
    expect(assistantCapabilitySchema.parse(base).toolsEnabled).toBe(false);

    expect(() => assistantCapabilitySchema.parse({
      ...base,
      externalResearchEnabled: true,
    })).toThrow();
  });
});
