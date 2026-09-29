import {
  investigationGetInputSchema,
  investigationGetResultSchema,
  investigationHistoryInputSchema,
  investigationHistoryResultSchema,
  investigationRelatedInputSchema,
  investigationRelatedResultSchema,
  investigationSearchInputSchema,
  investigationSearchResultSchema,
  type InvestigationResourceReference,
  type AssistantSourceLink,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import { InvestigationAccessError, InvestigationService } from "../investigation/investigationService";
import type { AssistantToolAdapters } from "./toolRegistry";

const entityTypes = new Set(["customer", "order", "invoice", "production_job"]);
const source = (resource: InvestigationResourceReference, capturedAt: string): AssistantSourceLink => ({
  label: resource.label,
  href: resource.href,
  ...(entityTypes.has(resource.type) ? { entityType: resource.type as AssistantSourceLink["entityType"] } : {}),
  entityId: resource.id,
  capturedAt,
});

function envelope(status: "succeeded" | "partial" | "not_found", data: unknown, resources: readonly InvestigationResourceReference[]): AssistantToolResultEnvelope {
  if (status === "not_found") return { status, data: null };
  const capturedAt = new Date().toISOString();
  return { status, data, provenance: { sourceLinks: resources.slice(0, 10).map((resource) => source(resource, capturedAt)), freshness: { capturedAt } } };
}

/** Operator-facing bridge for the reusable resource service. The adapter owns
 * presentation/provenance only; identity, tenant scope, and grants stay in
 * the registry's trusted context. */
export function createAssistantInvestigationToolAdapters(service = new InvestigationService()): AssistantToolAdapters {
  const scope = (context: { scope: { organizationId: string }; permissions: readonly string[] }) => ({ organizationId: context.scope.organizationId, permissions: context.permissions });
  return {
    "investigation.search": { async execute(rawInput, context) {
      const input = investigationSearchInputSchema.parse(rawInput); const result = await service.search(scope(context), input);
      if (result.status === "not_found") return envelope(result.status, null, []);
      const data = investigationSearchResultSchema.parse(result.data);
      return envelope(result.status, data, data.matches.map((match) => match.resource));
    } },
    "investigation.get": { async execute(rawInput, context) {
      const input = investigationGetInputSchema.parse(rawInput); const result = await service.get(scope(context), input.resource);
      if (result.status === "not_found") return envelope(result.status, null, []);
      const data = investigationGetResultSchema.parse(result.data);
      return envelope(result.status, data, [data.snapshot.resource]);
    } },
    "investigation.related": { async execute(rawInput, context) {
      const input = investigationRelatedInputSchema.parse(rawInput); const result = await service.related(scope(context), input);
      if (result.status === "not_found") return envelope(result.status, null, []);
      const data = investigationRelatedResultSchema.parse(result.data);
      return envelope(result.status, data, [data.root, ...data.edges.flatMap((edge) => [edge.from, edge.to])]);
    } },
    "investigation.history": { async execute(rawInput, context) {
      const input = investigationHistoryInputSchema.parse(rawInput); const result = await service.history(scope(context), input);
      if (result.status === "not_found") return envelope(result.status, null, []);
      const data = investigationHistoryResultSchema.parse(result.data);
      return envelope(result.status, data, [data.resource, ...data.events.map((event) => event.resource)]);
    } },
  };
}

export { InvestigationAccessError };
