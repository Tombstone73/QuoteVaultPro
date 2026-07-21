import { z } from "zod";
import {
  AssistantCommandRegistry,
  AssistantCommandRegistryError,
  assertAssistantCommandIdempotencyKey,
  assistantProductionCommandRegistry,
  createAssistantCommandIdempotencyKey,
  hashAssistantCommandRequest,
} from "../services/assistant/execution/commandRegistry";

const inputSchema = z.object({ recordId: z.string().uuid() }).strict();
const resultSchema = z.object({ changed: z.literal(true) }).strict();

function testCommand() {
  return {
    name: "test.assistant.synthetic_command" as const,
    version: "v1",
    domain: "test",
    description: "Synthetic command used only by execution safety tests.",
    risk: "low" as const,
    requiredCapability: "assistant.test_execute",
    allowedRoles: ["owner"],
    inputSchema,
    previewSchema: z.object({ message: z.string() }).strict(),
    resultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    reauthenticationRequired: false,
    confirmationExpiresInMs: 60_000,
    idempotencyPolicy: "server_generated_with_request_hash" as const,
    recordFingerprintStrategy: "record_version" as const,
    transactionPolicy: "required" as const,
    partialFailurePolicy: "record_and_stop" as const,
    auditCategory: "assistant_test_command",
    undoSupport: "metadata_only" as const,
    adapter: { execute: async () => ({ changed: true as const }) },
  };
}

describe("assistant command registry", () => {
  it("ships with zero production mutation commands", () => {
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
});
