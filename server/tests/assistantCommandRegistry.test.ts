import { z } from "zod";
import {
  AssistantCommandRegistry,
  AssistantCommandRegistryError,
  assertAssistantCommandIdempotencyKey,
  assistantProductionCommandRegistry,
  createProductionAssistantCommandRegistry,
  createAssistantCommandIdempotencyKey,
  hashAssistantCommandRequest,
} from "../services/assistant/execution/commandRegistry";
import {
  createQuoteInternalNoteCommandDefinition,
  quoteInternalNoteCommandInputSchema,
  quoteInternalNoteCommandName,
  quoteInternalNoteCommandResultSchema,
  quoteInternalNoteCommandVersion,
} from "../services/assistant/execution/quoteInternalNoteCommand";
import {
  createProductInactiveDraftCommandDefinition,
  productInactiveDraftCommandInputSchema,
  productInactiveDraftCommandName,
  productInactiveDraftCommandResultSchema,
  productInactiveDraftCommandVersion,
} from "../services/assistant/execution/productInactiveDraftCommand";
import {
  createProductInactiveDraftUpdateCommandDefinition,
  productInactiveDraftUpdateCommandInputSchema,
  productInactiveDraftUpdateCommandName,
  productInactiveDraftUpdateCommandResultSchema,
  productInactiveDraftUpdateCommandVersion,
} from "../services/assistant/execution/productInactiveDraftUpdateCommand";
import {
  createQuoteDraftCreateCommandDefinition,
  quoteDraftCreateCommandInputSchema,
  quoteDraftCreateCommandName,
  quoteDraftCreateCommandResultSchema,
  quoteDraftCreateCommandVersion,
} from "../services/assistant/execution/quoteDraftCreateCommand";
import {
  createQuoteDraftUpdateCommandDefinition,
  quoteDraftUpdateCommandInputSchema,
  quoteDraftUpdateCommandName,
  quoteDraftUpdateCommandResultSchema,
  quoteDraftUpdateCommandVersion,
} from "../services/assistant/execution/quoteDraftUpdateCommand";

const inputSchema = z.object({ recordId: z.string().uuid() }).strict();
const resultSchema = z.object({ changed: z.literal(true) }).strict();

function testCommand() {
  return {
    name: "test.assistant.synthetic_command" as const,
    version: "v1",
    domain: "test",
    mode: "write" as const,
    description: "Synthetic command used only by execution safety tests.",
    risk: "low" as const,
    requiredCapability: "assistant.test_execute",
    allowedRoles: ["owner"],
    inputSchema,
    previewSchema: z.object({ message: z.string() }).strict(),
    resultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    confirmationRequired: true as const,
    reauthenticationRequired: false,
    confirmationExpiresInMs: 60_000,
    idempotencyPolicy: "server_generated_with_request_hash" as const,
    recordFingerprintStrategy: "record_version" as const,
    transactionPolicy: "required" as const,
    partialFailurePolicy: "record_and_stop" as const,
    auditCategory: "assistant_test_command",
    undoSupport: "metadata_only" as const,
    abandonmentPolicy: "none" as const,
    adapter: { execute: async () => ({ changed: true as const }) },
  };
}

describe("assistant command registry", () => {
  it("keeps the default registry inert until application composition injects approved commands", () => {
    expect(assistantProductionCommandRegistry.list()).toEqual([]);
    expect(assistantProductionCommandRegistry.has("test.assistant.synthetic_command")).toBe(false);
  });

  it("accepts only the isolated static test command and never enables it in production", () => {
    const registry = AssistantCommandRegistry.forTests([testCommand()]);
    const command = registry.requireTestCommand("test.assistant.synthetic_command");

    expect(registry.isEnabledForRuntime(command.name, "test")).toBe(true);
    expect(registry.isEnabledForRuntime(command.name, "production")).toBe(false);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.allowedRoles)).toBe(true);
  });

  it("rejects dynamic or non-test command registration", () => {
    expect(() => AssistantCommandRegistry.forTests([{
      ...testCommand(),
      name: "orders.update_status" as "test.assistant.synthetic_command",
    }])).toThrow(AssistantCommandRegistryError);
  });

  it("uses server-shaped idempotency keys and binds hashes to the complete request", () => {
    const key = createAssistantCommandIdempotencyKey("plan_1");
    expect(assertAssistantCommandIdempotencyKey(key)).toBe(key);
    expect(() => assertAssistantCommandIdempotencyKey("client-provided-key")).toThrow("Invalid assistant command idempotency key");

    const base = {
      organizationId: "org_1",
      actorUserId: "user_1",
      planId: "plan_1",
      commandName: "test.assistant.synthetic_command",
      commandVersion: "v1",
      idempotencyKey: key,
      normalizedInput: { recordId: "b39c27d8-5988-4da0-b5fe-a373f98c4bd7", nested: { b: 2, a: 1 } },
    };
    expect(hashAssistantCommandRequest(base)).toBe(hashAssistantCommandRequest({ ...base, normalizedInput: { nested: { a: 1, b: 2 }, recordId: "b39c27d8-5988-4da0-b5fe-a373f98c4bd7" } }));
    expect(hashAssistantCommandRequest({ ...base, planId: "plan_2" })).not.toBe(hashAssistantCommandRequest(base));
  });

  it("registers exactly the reviewed production quote-note command through an injected canonical service", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    const service = {
      addInternalNote: async (input: Record<string, unknown>) => {
        receivedInput = input;
        return quoteInternalNoteCommandResultSchema.parse({
        quote: { id: "quote_1", displayNumber: "Q-1042", sourceLink: "/quotes/quote_1" },
        note: { id: "note_1", content: "Artwork arrives tomorrow.", createdAt: "2026-07-21T00:00:00.000Z", classification: "internal_only" },
        domainAuditReference: "audit_1",
        });
      },
    };
    const registry = createProductionAssistantCommandRegistry(createQuoteInternalNoteCommandDefinition(service));
    const [command] = registry.list();

    expect(registry.list()).toHaveLength(1);
    expect(command).toMatchObject({ name: quoteInternalNoteCommandName, version: quoteInternalNoteCommandVersion, domain: "quotes", mode: "write", risk: "low", maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, testOnly: false });
    expect(registry.isEnabledForRuntime(command.name, "development")).toBe(true);
    expect(registry.isEnabledForRuntime(command.name, "production")).toBe(true);
    expect(() => quoteInternalNoteCommandInputSchema.parse({ quoteId: "quote_1", noteText: "hi", organizationId: "attacker" })).toThrow();
    await expect(command.adapter.execute(
      quoteInternalNoteCommandInputSchema.parse({ quoteId: "quote_1", noteText: " Artwork arrives tomorrow. " }),
      { organizationId: "org_1", actorUserId: "user_1", planId: "plan_1", idempotencyKey: "aicmd_123e4567-e89b-12d3-a456-426614174000", correlationId: "corr_1", signal: new AbortController().signal },
    )).resolves.toMatchObject({ note: { classification: "internal_only" } });
    expect(receivedInput).toMatchObject({ organizationId: "org_1", actorUserId: "user_1", assistantPlanId: "plan_1", noteText: "Artwork arrives tomorrow." });
  });

  it("registers the proposal-reference-only inactive product draft command without an activation path", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    const service = {
      createInactiveDraft: async (input: Record<string, unknown>) => {
        receivedInput = input;
        return productInactiveDraftCommandResultSchema.parse({
          product: { id: "product_1", name: "13 oz Banner", active: false, sourceLink: "/products/product_1" },
          intakeSession: { id: "session_1", status: "draft_created", sourceLink: "/admin/catalog-migration-lab/session_1" },
          pbv2DraftTreeVersionId: "tree_1",
          domainAuditReference: "audit_2",
        });
      },
    };
    const proposalFingerprint = "a".repeat(64);
    const productCommand = createProductInactiveDraftCommandDefinition(service);
    const quoteService = { addInternalNote: async () => quoteInternalNoteCommandResultSchema.parse({
      quote: { id: "quote_1", displayNumber: "Q-1042", sourceLink: "/quotes/quote_1" },
      note: { id: "note_1", content: "Internal note", createdAt: "2026-07-21T00:00:00.000Z", classification: "internal_only" },
    }) };
    const registry = createProductionAssistantCommandRegistry(
      createQuoteInternalNoteCommandDefinition(quoteService),
      productCommand,
    );

    expect(registry.list()).toHaveLength(2);
    expect(productCommand).toMatchObject({ name: productInactiveDraftCommandName, version: productInactiveDraftCommandVersion, domain: "products", mode: "write", risk: "high", maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: true });
    expect(() => productInactiveDraftCommandInputSchema.parse({ intakeSessionId: "session_1", proposalFingerprint, active: true })).toThrow();
    await expect(productCommand.adapter.execute(
      productInactiveDraftCommandInputSchema.parse({ intakeSessionId: "session_1", proposalFingerprint }),
      { organizationId: "org_1", actorUserId: "user_1", planId: "plan_2", idempotencyKey: "aicmd_123e4567-e89b-12d3-a456-426614174001", correlationId: "corr_2", signal: new AbortController().signal },
    )).resolves.toMatchObject({ product: { active: false } });
    expect(receivedInput).toMatchObject({ intakeSessionId: "session_1", proposalFingerprint, organizationId: "org_1", actorUserId: "user_1", assistantPlanId: "plan_2" });
    expect(receivedInput).not.toHaveProperty("active");
  });

  it("registers exactly three reviewed production commands including the fingerprint-only inactive draft update", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    const proposalFingerprint = "b".repeat(64);
    const updateService = {
      updateInactiveDraft: async (input: Record<string, unknown>) => {
        receivedInput = input;
        return productInactiveDraftUpdateCommandResultSchema.parse({
          product: { id: "product_1", name: "13 oz Banner", active: false, sourceLink: "/products/product_1" },
          productIntakeSession: { id: "session_1", sourceLink: "/admin/catalog-migration-lab/session_1" },
          pbv2DraftTreeVersionId: "tree_2",
          readiness: "not_ready",
          domainAuditReference: "audit_3",
        });
      },
    };
    const quoteService = { addInternalNote: async () => quoteInternalNoteCommandResultSchema.parse({
      quote: { id: "quote_1", displayNumber: "Q-1042", sourceLink: "/quotes/quote_1" },
      note: { id: "note_1", content: "Internal note", createdAt: "2026-07-21T00:00:00.000Z", classification: "internal_only" },
    }) };
    const createService = { createInactiveDraft: async () => productInactiveDraftCommandResultSchema.parse({
      product: { id: "product_2", name: "13 oz Banner", active: false, sourceLink: "/products/product_2" },
      intakeSession: { id: "session_2", status: "draft_created", sourceLink: "/admin/catalog-migration-lab/session_2" },
      pbv2DraftTreeVersionId: "tree_1",
    }) };
    const updateCommand = createProductInactiveDraftUpdateCommandDefinition(updateService);
    const registry = createProductionAssistantCommandRegistry(
      createQuoteInternalNoteCommandDefinition(quoteService),
      createProductInactiveDraftCommandDefinition(createService),
      updateCommand,
    );
    expect(registry.list()).toHaveLength(3);
    expect(registry.list().map((command) => command.name)).toEqual([
      quoteInternalNoteCommandName,
      productInactiveDraftCommandName,
      productInactiveDraftUpdateCommandName,
    ]);
    expect(updateCommand).toMatchObject({
      name: productInactiveDraftUpdateCommandName,
      version: productInactiveDraftUpdateCommandVersion,
      domain: "products",
      mode: "write",
      risk: "high",
      requiredCapability: "assistant.products.update_inactive_draft",
      allowedRoles: ["owner", "admin"],
      maxAffectedRecords: 1,
      bulkAllowed: false,
      confirmationRequired: true,
      reauthenticationRequired: true,
      recordFingerprintStrategy: "updated_at_and_critical_fields",
      transactionPolicy: "required",
      partialFailurePolicy: "forbid",
    });
    expect(() => productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1",
      proposalFingerprint,
      patch: { basePricing: { isActive: true } },
    })).toThrow();
    expect(productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1",
      proposalFingerprint,
      patch: { basePricing: { perSqftCents: 0, perPieceCents: null } },
    }).patch.basePricing).toEqual({ perSqftCents: 0, perPieceCents: null });
    expect(productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1",
      proposalFingerprint,
      patch: { configuration: { isTaxable: false, allowRotation: false, fixedDimensions: { widthIn: 24, heightIn: 18 } } },
    }).patch.configuration).toMatchObject({ isTaxable: false, allowRotation: false, fixedDimensions: { widthIn: 24, heightIn: 18 } });
    expect(productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1",
      proposalFingerprint,
      patch: { relationships: { routing: { operation: "set_primary", station: { name: "Flatbed" } }, options: { operation: "add", templates: [{ id: "template_flatbed_finish" }] } } },
    }).patch.relationships).toMatchObject({ routing: { operation: "set_primary" }, options: { operation: "add" } });
    expect(() => productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1", proposalFingerprint,
      patch: { basePricing: { minimumChargeCents: 1500 }, configuration: { isTaxable: true } },
    })).toThrow();
    expect(() => productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1", proposalFingerprint,
      patch: { basePricing: { minimumChargeCents: 1500 }, relationships: { routing: { operation: "clear" } } },
    })).toThrow();
    expect(() => productInactiveDraftUpdateCommandInputSchema.parse({
      productIntakeSessionId: "session_1", proposalFingerprint,
      patch: { basePricing: { minimumChargeCents: 1500 } }, active: true,
    })).toThrow();
    await expect(updateCommand.adapter.execute(
      productInactiveDraftUpdateCommandInputSchema.parse({
        productIntakeSessionId: "session_1", proposalFingerprint,
        patch: { basePricing: { minimumChargeCents: 1500 } },
      }),
      { organizationId: "org_1", actorUserId: "user_1", planId: "plan_3", idempotencyKey: "aicmd_123e4567-e89b-12d3-a456-426614174002", correlationId: "corr_3", signal: new AbortController().signal },
    )).resolves.toMatchObject({ product: { active: false }, readiness: "not_ready" });
    expect(receivedInput).toMatchObject({
      productIntakeSessionId: "session_1",
      proposalFingerprint,
      patch: { basePricing: { minimumChargeCents: 1500 } },
      organizationId: "org_1",
      actorUserId: "user_1",
      assistantPlanId: "plan_3",
    });
    expect(receivedInput).not.toHaveProperty("active");
  });

  it("registers reference-only canonical draft quote create and update commands", async () => {
    const proposalFingerprint = "c".repeat(64);
    const quoteFingerprint = "d".repeat(64);
    let createInput: Record<string, unknown> | undefined;
    let updateInput: Record<string, unknown> | undefined;
    const createService = {
      createDraft: async (input: Record<string, unknown>) => {
        createInput = input;
        return quoteDraftCreateCommandResultSchema.parse({
          quote: { id: "quote_1", displayNumber: "Q-1042", status: "draft", totalCents: 12500, sourceLink: "/quotes/quote_1" },
          domainAuditReference: "audit_quote_create",
        });
      },
    };
    const updateService = {
      updateDraft: async (input: Record<string, unknown>) => {
        updateInput = input;
        return quoteDraftUpdateCommandResultSchema.parse({
          quote: { id: "quote_1", displayNumber: "Q-1042", status: "draft", totalCents: 15000, sourceLink: "/quotes/quote_1" },
          domainAuditReference: "audit_quote_update",
        });
      },
    };
    const createCommand = createQuoteDraftCreateCommandDefinition(createService);
    const updateCommand = createQuoteDraftUpdateCommandDefinition(updateService);
    const registry = createProductionAssistantCommandRegistry(createCommand, updateCommand);
    const context = { organizationId: "org_1", actorUserId: "user_1", planId: "plan_4", idempotencyKey: "aicmd_123e4567-e89b-12d3-a456-426614174003", correlationId: "corr_4", signal: new AbortController().signal };

    expect(registry.list().map((command) => command.name)).toEqual([quoteDraftCreateCommandName, quoteDraftUpdateCommandName]);
    expect(createCommand).toMatchObject({ name: quoteDraftCreateCommandName, version: quoteDraftCreateCommandVersion, risk: "high", maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, transactionPolicy: "required" });
    expect(updateCommand).toMatchObject({ name: quoteDraftUpdateCommandName, version: quoteDraftUpdateCommandVersion, risk: "high", recordFingerprintStrategy: "updated_at_and_critical_fields", transactionPolicy: "required" });
    expect(() => quoteDraftCreateCommandInputSchema.parse({ quoteIntakeSessionId: "session_1", proposalFingerprint, finalPrice: 1 })).toThrow();
    expect(() => quoteDraftUpdateCommandInputSchema.parse({ quoteId: "quote_1", quoteIntakeSessionId: "session_1", proposalFingerprint, expectedQuoteFingerprint: quoteFingerprint, patch: {} })).toThrow();

    await expect(createCommand.adapter.execute(
      quoteDraftCreateCommandInputSchema.parse({ quoteIntakeSessionId: "session_1", proposalFingerprint }), context,
    )).resolves.toMatchObject({ quote: { id: "quote_1", status: "draft" } });
    await expect(updateCommand.adapter.execute(
      quoteDraftUpdateCommandInputSchema.parse({ quoteId: "quote_1", quoteIntakeSessionId: "session_1", proposalFingerprint, expectedQuoteFingerprint: quoteFingerprint }), context,
    )).resolves.toMatchObject({ quote: { id: "quote_1", totalCents: 15000 } });
    expect(createInput).toMatchObject({ quoteIntakeSessionId: "session_1", proposalFingerprint, organizationId: "org_1", actorUserId: "user_1", assistantPlanId: "plan_4" });
    expect(createInput).not.toHaveProperty("finalPrice");
    expect(updateInput).toMatchObject({ quoteId: "quote_1", expectedQuoteFingerprint: quoteFingerprint, organizationId: "org_1", actorUserId: "user_1", assistantPlanId: "plan_4" });
    expect(updateInput).not.toHaveProperty("patch");
  });
});
