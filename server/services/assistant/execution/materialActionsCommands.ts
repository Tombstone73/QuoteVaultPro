import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import { assistantMaterialActionInputSchema, assistantMaterialActionService, AssistantMaterialActionError, type AssistantMaterialActionInput } from "../materialActionService";

export const assistantMaterialActionCommandNames = ["materials.create", "materials.create_family", "materials.create_variant", "materials.assign_family"] as const;
export type AssistantMaterialActionCommandName = (typeof assistantMaterialActionCommandNames)[number];

const resultSchema = z.object({ status: z.enum(["succeeded", "partially_failed"]), summary: z.string(), material: z.unknown().optional(), family: z.unknown().optional(), created: z.array(z.object({ id: z.string(), name: z.string() })).optional(), variantValues: z.array(z.unknown()).optional(), failure: z.string().optional() }).passthrough();
const label: Record<AssistantMaterialActionCommandName, string> = {
  "materials.create": "Create Material",
  "materials.create_family": "Create Material Family",
  "materials.create_variant": "Create Material variant",
  "materials.assign_family": "Assign Material to Family",
};

function actionForName(name: AssistantMaterialActionCommandName): AssistantMaterialActionInput["action"] { return name; }
function inputFor(name: AssistantMaterialActionCommandName, raw: unknown) {
  const input = assistantMaterialActionInputSchema.parse(raw);
  if (input.action !== actionForName(name)) throw new ExecutionPlanError("MATERIAL_ACTION_INVALID", "The requested Material action does not match the protected command.");
  return input;
}

export function createMaterialActionCommandDefinition(name: AssistantMaterialActionCommandName): AssistantCommandDefinition {
  const adapter: AssistantCanonicalCommandAdapter = {
    async execute(raw, context: AssistantCommandExecutionContext) {
      const input = inputFor(name, raw);
      return resultSchema.parse(await assistantMaterialActionService.execute(context.organizationId, input));
    },
  };
  return {
    name, version: "v1", domain: "materials", mode: "write", description: `${label[name]} through canonical Material domain services.`,
    risk: name === "materials.create_family" ? "high" : "moderate", requiredCapability: `assistant.${name}`,
    allowedRoles: ["owner", "admin"], inputSchema: assistantMaterialActionInputSchema, previewSchema: z.object({}).passthrough(), resultSchema,
    maxAffectedRecords: name === "materials.create_family" ? 26 : 1, bulkAllowed: name === "materials.create_family",
    confirmationRequired: true, reauthenticationRequired: false, confirmationExpiresInMs: 5 * 60_000,
    idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash",
    transactionPolicy: name === "materials.create_family" ? "best_effort" : "required",
    partialFailurePolicy: name === "materials.create_family" ? "record_and_stop" : "forbid",
    auditCategory: `assistant_${name.replaceAll(".", "_")}`, undoSupport: "metadata_only", abandonmentPolicy: name === "materials.create_family" ? "session_abandonment_only" : "none",
    testOnly: false, devEnabled: true, mainEnabled: true, adapter,
  };
}

export function createMaterialActionExecutionCommand(name: AssistantMaterialActionCommandName): ExecutionCommandDefinition {
  const command = createMaterialActionCommandDefinition(name);
  return {
    name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      try {
        const input = await assistantMaterialActionService.prepare(scope.organizationId, inputFor(name, raw));
        const title = label[name];
        const summary = name === "materials.create_family"
          ? `Create one organizational Material Family${input.action === "materials.create_family" && input.variants.length ? ` and ${input.variants.length} concrete Material variants` : ""}.`
          : `${title} using the canonical Material domain service.`;
        const preview: ExecutionPlanPreview = {
          title, summary,
          sideEffects: [summary, "Material Families remain organizational only; concrete Materials retain the sole inventory identity."],
          affectedRecords: [{ entityType: "material", entityId: `proposed:${assistantMaterialActionService.fingerprint(input)}`, fingerprint: assistantMaterialActionService.fingerprint(input) }],
        };
        return { arguments: input, preview };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Material action could not be prepared.";
        throw new ExecutionPlanError(error instanceof AssistantMaterialActionError ? error.code : "MATERIAL_ACTION_INVALID", message);
      }
    },
    async revalidate({ plan, scope }) {
      try { await assistantMaterialActionService.prepare(scope.organizationId, inputFor(name, plan.sanitizedArguments)); return { valid: true as const }; }
      catch (error) { return { valid: false as const, code: error instanceof AssistantMaterialActionError ? error.code : "MATERIAL_ACTION_INVALID", summary: error instanceof Error ? error.message : "Material action is no longer valid." }; }
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      try {
        const result = resultSchema.parse(await command.adapter.execute(inputFor(name, plan.sanitizedArguments), { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal }));
        return { status: result.status, summary: result.summary, steps: [{ commandName: `${name}@${command.version}`, status: result.status === "succeeded" ? "succeeded" : "failed", summary: result.summary }] };
      } catch (error) { return { status: "failed", summary: error instanceof Error ? error.message : "Material action failed.", steps: [{ commandName: `${name}@${command.version}`, status: "failed", summary: error instanceof Error ? error.message : "Material action failed." }] }; }
    },
  };
}
