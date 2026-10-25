import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";
import { canonicalCapabilityRegistry } from "./canonicalCapabilityRegistry";

/** A small, permission-filtered bridge to existing canonical preparation
 * adapters. The adapters prepare server-owned proposals; the execution-plan
 * service still validates the exact proposal, actor, tenant, and GO token. */
export function createApplicationOperationTools(adapters: readonly AssistantOperatorSemanticTool[]): AssistantOperatorSemanticTool[] {
  const operations = new Map(adapters.map((adapter) => [adapter.name, adapter]));
  const describe: AssistantOperatorSemanticTool = {
    name: "application.operations",
    description: "Discover available application change operations, their supported fields and argument schemas. Discovery makes no change and grants no permission. Use the returned operation name with application.prepare_change.",
    inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 80 } } },
    execute: async ({ arguments: args, context }) => {
      if (Object.keys(args).some((key) => key !== "query") || args.query !== undefined && (typeof args.query !== "string" || args.query.length > 80))
        return { status: "rejected", warning: "Supply only an optional operation query of at most 80 characters." };
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const available = Array.from(operations.values()).filter((adapter) => !query || `${adapter.name} ${adapter.description}`.toLowerCase().includes(query));
      const adapterGaps = canonicalCapabilityRegistry.filter((capability) => capability.source === "ui_compatibility"
        && capability.requiredGrant && context.permissions.includes(capability.requiredGrant)
        && (!query || `${capability.sourceId} ${capability.purpose}`.toLowerCase().includes(query)))
        .map((capability) => ({ operation: capability.sourceId, classification: "application_operation_missing_assistant_adapter",
          description: capability.purpose, permissionRequired: capability.requiredGrant }));
      return { status: "succeeded", result: { status: "succeeded", data: { operations: available.map((adapter) => ({
        name: adapter.name, description: adapter.description, inputSchema: adapter.inputSchema ?? { type: "object" }, confirmation: "GO after review",
      })), adapterGaps, notice: "The server checks current permissions, target identity, and canonical validation again when preparing and executing a change. An adapter gap means the staff application has an operation that this assistant cannot prepare yet; an absent entry alone does not prove the application lacks an operation." } } };
    },
  };
  const prepare: AssistantOperatorSemanticTool = {
    name: "application.prepare_change",
    description: "Prepare a concrete application change using an operation returned by application.operations. Pass its business arguments under arguments. This returns a reviewed proposal only; the user must say GO before the server executes it.",
    inputSchema: { type: "object", additionalProperties: false, required: ["operation", "arguments"], properties: {
      operation: { type: "string", minLength: 1 }, arguments: { type: "object" },
    } },
    execute: async ({ arguments: args, context }) => {
      if (Object.keys(args).some((key) => key !== "operation" && key !== "arguments") || typeof args.operation !== "string"
        || !args.arguments || typeof args.arguments !== "object" || Array.isArray(args.arguments))
        return { status: "rejected", warning: "Supply a discovered operation and its business arguments." };
      const adapter = operations.get(args.operation);
      if (!adapter) return { status: "rejected", warning: "That application change operation is unavailable for this signed-in user or session." };
      return adapter.execute({ arguments: args.arguments as Record<string, unknown>, context });
    },
  };
  return [describe, prepare];
}
