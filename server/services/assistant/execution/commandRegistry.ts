import { createHash, randomUUID } from "crypto";
import { z, type ZodTypeAny } from "zod";

/**
 * This is intentionally separate from the Stage 2 read-only tool registry.
 * A command is a future, explicitly reviewed mutation boundary; it is never a
 * route, repository, SQL, or HTTP wrapper.  Production registration is an
 * explicit composition step, never dynamic model or request input.
 */

export const assistantCommandRiskValues = ["low", "moderate", "high", "critical"] as const;
export const assistantCommandModeValues = ["write"] as const;
export const assistantCommandIdempotencyPolicyValues = [
  "server_generated_required",
  "server_generated_with_request_hash",
] as const;
export const assistantCommandTransactionPolicyValues = ["required", "best_effort"] as const;
export const assistantCommandPartialFailurePolicyValues = ["forbid", "record_and_stop"] as const;

export type AssistantCommandRisk = (typeof assistantCommandRiskValues)[number];
export type AssistantCommandMode = (typeof assistantCommandModeValues)[number];
export type AssistantCommandIdempotencyPolicy = (typeof assistantCommandIdempotencyPolicyValues)[number];
export type AssistantCommandTransactionPolicy = (typeof assistantCommandTransactionPolicyValues)[number];
export type AssistantCommandPartialFailurePolicy = (typeof assistantCommandPartialFailurePolicyValues)[number];

export const assistantCommandRuntimeValues = ["development", "production", "test"] as const;
export type AssistantCommandRuntime = (typeof assistantCommandRuntimeValues)[number];

/**
 * The complete production write-command allowlist. Every entry is a reviewed,
 * confirmation-bound canonical command; there is no dynamic registration.
 */
export const assistantProductionCommandAllowlist = [
  "quotes.add_internal_note",
  "products.create_inactive_draft",
  "products.update_inactive_draft",
  "quotes.create_draft",
  "quotes.update_draft",
  "orders.create",
  "orders.update_editable",
  "quotes.convert_to_order",
  "customers.create",
  "customers.update_profile",
  "customers.update_commercial_terms",
  "contacts.create",
  "contacts.update",
] as const;
/** The only injected command name accepted by the isolated test registry. */
export const assistantTestCommandAllowlist = ["test.assistant.synthetic_command"] as const;
export type AssistantTestCommandName = (typeof assistantTestCommandAllowlist)[number];

export interface AssistantCommandExecutionContext {
  organizationId: string;
  actorUserId: string;
  planId: string;
  idempotencyKey: string;
  correlationId: string;
  signal: AbortSignal;
}

/**
 * This adapter represents a canonical domain-service call.  Command registry
 * consumers must supply this interface directly; no Express request, database
 * repository, raw SQL string, fetch client, or model-produced function is ever
 * accepted here.
 */
export interface AssistantCanonicalCommandAdapter<TInput = unknown, TResult = unknown> {
  execute(input: TInput, context: AssistantCommandExecutionContext): Promise<TResult>;
}

export interface AssistantCommandDefinition<TInput = unknown, TPreview = unknown, TResult = unknown> {
  name: string;
  version: string;
  domain: string;
  mode: AssistantCommandMode;
  description: string;
  risk: AssistantCommandRisk;
  requiredCapability: string;
  allowedRoles: readonly string[];
  inputSchema: ZodTypeAny;
  previewSchema: ZodTypeAny;
  resultSchema: ZodTypeAny;
  maxAffectedRecords: number;
  bulkAllowed: boolean;
  confirmationRequired: true;
  reauthenticationRequired: boolean;
  confirmationExpiresInMs: number;
  idempotencyPolicy: AssistantCommandIdempotencyPolicy;
  recordFingerprintStrategy: "record_version" | "updated_at_and_critical_fields" | "stable_field_hash";
  transactionPolicy: AssistantCommandTransactionPolicy;
  partialFailurePolicy: AssistantCommandPartialFailurePolicy;
  auditCategory: string;
  undoSupport: "none" | "metadata_only" | "compensating_command";
  /** A command may support safe domain-specific abandonment without implying deletion or rollback. */
  abandonmentPolicy: "none" | "session_abandonment_only";
  /** Test-only registrations are excluded from every normal runtime. */
  testOnly: boolean;
  devEnabled: boolean;
  mainEnabled: boolean;
  adapter: AssistantCanonicalCommandAdapter<TInput, TResult>;
}

export type AssistantTestCommandDefinition<TInput = unknown, TPreview = unknown, TResult = unknown> =
  Omit<AssistantCommandDefinition<TInput, TPreview, TResult>, "name" | "testOnly" | "devEnabled" | "mainEnabled"> & {
    name: AssistantTestCommandName;
    testOnly?: true;
    devEnabled?: false;
    mainEnabled?: false;
  };

export class AssistantCommandRegistryError extends Error {
  constructor(
    message: string,
    readonly code: "COMMAND_NOT_REGISTERED" | "TEST_COMMAND_FORBIDDEN" | "PRODUCTION_COMMAND_FORBIDDEN" | "INVALID_COMMAND_DEFINITION" | "IDEMPOTENCY_KEY_INVALID",
  ) {
    super(message);
    this.name = "AssistantCommandRegistryError";
  }
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function validateDefinition(definition: AssistantCommandDefinition): void {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(definition.name)) {
    throw new AssistantCommandRegistryError("Command names must be explicit dotted identifiers.", "INVALID_COMMAND_DEFINITION");
  }
  if (!/^v[1-9][0-9]*$/.test(definition.version)) {
    throw new AssistantCommandRegistryError("Command versions must use an explicit vN format.", "INVALID_COMMAND_DEFINITION");
  }
  if (!definition.domain.trim() || !definition.description.trim() || !definition.requiredCapability.trim() || !definition.auditCategory.trim()) {
    throw new AssistantCommandRegistryError("Command metadata must be explicit and non-empty.", "INVALID_COMMAND_DEFINITION");
  }
  if (definition.mode !== "write" || definition.confirmationRequired !== true) {
    throw new AssistantCommandRegistryError("Assistant commands must explicitly be confirmed write commands.", "INVALID_COMMAND_DEFINITION");
  }
  if (!Number.isInteger(definition.maxAffectedRecords) || definition.maxAffectedRecords < 1 || definition.maxAffectedRecords > 100) {
    throw new AssistantCommandRegistryError("Command maxAffectedRecords must be a bounded positive integer.", "INVALID_COMMAND_DEFINITION");
  }
  if (!Number.isInteger(definition.confirmationExpiresInMs) || definition.confirmationExpiresInMs < 30_000 || definition.confirmationExpiresInMs > 15 * 60_000) {
    throw new AssistantCommandRegistryError("Command confirmation expiry must be between 30 seconds and 15 minutes.", "INVALID_COMMAND_DEFINITION");
  }
  if (!definition.allowedRoles.length || definition.allowedRoles.some((role) => !normalizeRole(role))) {
    throw new AssistantCommandRegistryError("Command allowed roles must be an explicit non-empty list.", "INVALID_COMMAND_DEFINITION");
  }
  if (!definition.adapter || typeof definition.adapter.execute !== "function") {
    throw new AssistantCommandRegistryError("Commands must use an explicit canonical-service adapter.", "INVALID_COMMAND_DEFINITION");
  }
  // Parse once to fail closed for malformed schemas.  This is deliberately not
  // a generic command schema: each command owns strict DTO schemas.
  for (const schema of [definition.inputSchema, definition.previewSchema, definition.resultSchema]) {
    if (!schema || typeof schema.safeParse !== "function") {
      throw new AssistantCommandRegistryError("Commands require strict input, preview, and result schemas.", "INVALID_COMMAND_DEFINITION");
    }
  }
}

export class AssistantCommandRegistry {
  private readonly commands: ReadonlyMap<string, Readonly<AssistantCommandDefinition>>;

  private constructor(commands: Iterable<AssistantCommandDefinition>) {
    const registered = new Map<string, Readonly<AssistantCommandDefinition>>();
    for (const command of Array.from(commands)) {
      validateDefinition(command);
      if (registered.has(command.name)) {
        throw new AssistantCommandRegistryError(`Duplicate assistant command: ${command.name}.`, "INVALID_COMMAND_DEFINITION");
      }
      // Freeze registry metadata without freezing caller-owned Zod schemas or
      // canonical-service adapters. Those objects may legitimately maintain
      // library internals; only the registry's policy surface is immutable.
      registered.set(command.name, Object.freeze({
        ...command,
        allowedRoles: Object.freeze([...command.allowedRoles]),
      }));
    }
    this.commands = registered;
  }

  static production(commands: readonly AssistantCommandDefinition[] = []): AssistantCommandRegistry {
    for (const command of commands) {
      if (!assistantProductionCommandAllowlist.includes(command.name as (typeof assistantProductionCommandAllowlist)[number])) {
        throw new AssistantCommandRegistryError("Only the static production command allowlist may be registered.", "PRODUCTION_COMMAND_FORBIDDEN");
      }
      if (command.testOnly || !command.devEnabled || !command.mainEnabled) {
        throw new AssistantCommandRegistryError("Production commands must be non-test-only and explicitly enabled for DEV and MAIN.", "PRODUCTION_COMMAND_FORBIDDEN");
      }
    }
    return new AssistantCommandRegistry(commands);
  }

  static forTests(commands: readonly AssistantTestCommandDefinition[]): AssistantCommandRegistry {
    const normalized = commands.map((command) => {
      if (!assistantTestCommandAllowlist.includes(command.name)) {
        throw new AssistantCommandRegistryError("Only the static isolated test command allowlist may be injected.", "TEST_COMMAND_FORBIDDEN");
      }
      return {
        ...command,
        testOnly: true,
        devEnabled: false,
        mainEnabled: false,
      } satisfies AssistantCommandDefinition;
    });
    return new AssistantCommandRegistry(normalized);
  }

  get(name: string): Readonly<AssistantCommandDefinition> | undefined {
    return this.commands.get(name);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  list(): readonly Readonly<AssistantCommandDefinition>[] {
    return Object.freeze(Array.from(this.commands.values()));
  }

  isEnabledForRuntime(name: string, runtime: AssistantCommandRuntime): boolean {
    const command = this.commands.get(name);
    if (!command) return false;
    if (runtime === "production") return !command.testOnly && command.mainEnabled;
    if (runtime === "development") return !command.testOnly && command.devEnabled;
    return command.testOnly || command.devEnabled;
  }

  requireTestCommand(name: string): Readonly<AssistantCommandDefinition> {
    const command = this.commands.get(name);
    if (!command) throw new AssistantCommandRegistryError("Assistant command is not registered.", "COMMAND_NOT_REGISTERED");
    if (!command.testOnly) throw new AssistantCommandRegistryError("Only a test-only command can be obtained from this isolated registry.", "TEST_COMMAND_FORBIDDEN");
    return command;
  }
}

/**
 * Safe default before application composition injects the canonical quote-note
 * service. This deliberately executes nothing by itself.
 */
export const assistantProductionCommandRegistry = AssistantCommandRegistry.production();

/** Application composition must pass exactly the reviewed command definition. */
export function createProductionAssistantCommandRegistry(
  ...commands: AssistantCommandDefinition[]
): AssistantCommandRegistry {
  return AssistantCommandRegistry.production(commands);
}

const idempotencyKeySchema = z.string().regex(/^aicmd_[a-f0-9-]{36}$/i).max(64);

/** A server-generated key is created only after a server-created plan exists. */
export function createAssistantCommandIdempotencyKey(planId: string): string {
  if (!planId || planId.length > 200) throw new AssistantCommandRegistryError("Plan ID is required to create an idempotency key.", "IDEMPOTENCY_KEY_INVALID");
  // planId is incorporated into the stored request hash by the execution
  // service; the random key itself stays opaque and safe to expose once.
  return `aicmd_${randomUUID()}`;
}

export function assertAssistantCommandIdempotencyKey(value: unknown): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new AssistantCommandRegistryError("Invalid assistant command idempotency key.", "IDEMPOTENCY_KEY_INVALID");
  return parsed.data;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new TypeError("Idempotency payload contains an unsupported value.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

/** Bind retries to exactly one plan, command version, and normalized request. */
export function hashAssistantCommandRequest(input: {
  organizationId: string;
  actorUserId: string;
  planId: string;
  commandName: string;
  commandVersion: string;
  idempotencyKey: string;
  normalizedInput: unknown;
}): string {
  assertAssistantCommandIdempotencyKey(input.idempotencyKey);
  return createHash("sha256").update(stableJson(input)).digest("hex");
}
