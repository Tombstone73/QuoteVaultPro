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
});
