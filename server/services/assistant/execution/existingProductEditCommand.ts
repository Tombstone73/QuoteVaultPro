import { z } from "zod";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import type { AssistantCommandDefinition } from "./commandRegistry";
import type { ExistingProductEditService } from "../existingProductEditService";
import { existingProductEditOperationListSchema } from "../existingProductEditContract";

export const existingProductEditCommandName = "products.update_existing_product" as const;
const inputSchema = z.object({ productId: z.string().trim().min(1).max(128), operations: existingProductEditOperationListSchema, proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
type Input = z.infer<typeof inputSchema>;

function preview(proposal: Awaited<ReturnType<ExistingProductEditService["buildProposal"]>>): ExecutionPlanPreview {
  const changeSummary = proposal.changes.map((change) => `${change.field}: ${change.before} → ${change.after}`).join("; ");
  return {
    title: `Update existing product: ${proposal.productName}`,
    summary: `${changeSummary}. This is a protected existing-product edit; no pricing rate, dependency, active-tree pointer, publishing, or activation changes before GO.`,
    sideEffects: proposal.changes.map((change) => `${change.field}: ${change.before} → ${change.after}.`),
    affectedRecords: [{ entityType: "product", entityId: proposal.productId, fingerprint: proposal.fingerprint }],
  } as ExecutionPlanPreview;
}

export function createExistingProductEditCommandDefinition(service: ExistingProductEditService): AssistantCommandDefinition<Input, unknown, unknown> {
  return {
    name: existingProductEditCommandName, version: "v1", domain: "products", mode: "write",
    description: "Apply a confirmed existing-product edit through the shared canonical Product configuration or PBV2 option-configuration operation. Legacy option-default plans are translated through the PBV2 operation.",
    risk: "high", requiredCapability: "assistant.products.update_existing_product", allowedRoles: ["owner", "admin"],
    inputSchema, previewSchema: z.unknown(), resultSchema: z.unknown(), maxAffectedRecords: 1, bulkAllowed: false,
    confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: 10 * 60_000,
    idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "updated_at_and_critical_fields", transactionPolicy: "required", partialFailurePolicy: "forbid",
    auditCategory: "assistant_existing_product_edit", undoSupport: "none", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true,
    adapter: { execute: async (value, context) => service.execute({ ...inputSchema.parse(value), organizationId: context.organizationId, userId: context.actorUserId, expectedFingerprint: inputSchema.parse(value).proposalFingerprint }) },
  };
}

export function createExistingProductEditExecutionCommand(service: ExistingProductEditService): ExecutionCommandDefinition {
  const command = createExistingProductEditCommandDefinition(service);
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: 1, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = inputSchema.parse(raw);
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, productId: input.productId, operations: { operations: input.operations }, expectedFingerprint: input.proposalFingerprint });
      if (!validation.valid) throw new Error(validation.code);
      return { arguments: input, preview: preview(validation.proposal) };
    },
    async revalidate({ plan, scope }) {
      const input = inputSchema.parse(plan.sanitizedArguments);
      return service.revalidateProposal({ organizationId: scope.organizationId, productId: input.productId, operations: { operations: input.operations }, expectedFingerprint: input.proposalFingerprint });
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = inputSchema.parse(plan.sanitizedArguments);
      const result = await service.execute({ organizationId: scope.organizationId, productId: input.productId, operations: { operations: input.operations }, expectedFingerprint: input.proposalFingerprint, userId: scope.userId });
      const operationSummary = result.canonicalOperationReference === "products.update_option_configuration.v1" ? "Applied the shared canonical PBV2 option configuration operation after GO." : "Applied the shared canonical Product configuration operation after GO.";
      return { status: "succeeded", summary: `Updated existing product ${result.productName}.`, details: { existingProductEdit: { productId: result.productId, changes: result.changes, canonicalOperationReference: result.canonicalOperationReference ?? null } } as any, steps: [{ commandName: `${existingProductEditCommandName}@v1`, status: "succeeded", summary: operationSummary }] };
    },
  };
}
