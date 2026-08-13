import type { AssistantOperatorObservation, AssistantOperatorTrustedContext } from "./operatorRuntime";

export type CurrentTurnProductResolution = {
  attempted: boolean;
  productId: string | null;
  ambiguous: boolean;
};
export type CurrentTurnProductFact = { productId: string; name: string | null; lifecycle: "active" | "inactive" | null };

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value)) ids.add(value);
}

/** Current-turn Product reads are fresher than retained navigation/task
 * references. Any ambiguous or unsuccessful Product resolution fails closed
 * instead of reviving a different retained Product. */
export function currentTurnProductResolution(observations: readonly AssistantOperatorObservation[] | undefined): CurrentTurnProductResolution {
  const ids = new Set<string>();
  let attempted = false;
  let ambiguous = false;
  for (const observation of observations ?? []) {
    if (observation.toolName === "products.get_summary" || observation.toolName === "products.get_pricing") {
      attempted = true;
      if (observation.status !== "succeeded") { ambiguous = true; continue; }
      const data = observation.result?.data;
      const product = data && typeof data === "object" && !Array.isArray(data) ? (data as { product?: unknown }).product : null;
      if (!product || typeof product !== "object" || Array.isArray(product)) { ambiguous = true; continue; }
      addId(ids, (product as { id?: unknown }).id);
      addId(ids, (product as { recordId?: unknown }).recordId);
      continue;
    }
    if (observation.toolName !== "search.global") continue;
    const data = observation.result?.data;
    const matches = data && typeof data === "object" && !Array.isArray(data) ? (data as { matches?: unknown }).matches : null;
    if (!Array.isArray(matches)) continue;
    const productMatches = matches.filter((match) => match && typeof match === "object" && (match as { entityType?: unknown }).entityType === "product");
    if (!productMatches.length) continue;
    attempted = true;
    if (observation.status !== "succeeded" || productMatches.length !== 1 || matches.length !== 1) { ambiguous = true; continue; }
    addId(ids, (productMatches[0] as { recordId?: unknown }).recordId);
  }
  if (ids.size !== 1) ambiguous = attempted;
  return { attempted, productId: !ambiguous && ids.size === 1 ? [...ids][0]! : null, ambiguous };
}

export function currentTurnProductFact(observations: readonly AssistantOperatorObservation[] | undefined): CurrentTurnProductFact | null {
  const resolution = currentTurnProductResolution(observations);
  if (!resolution.productId) return null;
  for (const observation of [...(observations ?? [])].reverse()) {
    if (observation.status !== "succeeded") continue;
    const data = observation.result?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    if (observation.toolName === "products.get_summary" || observation.toolName === "products.get_pricing") {
      const product = (data as { product?: unknown }).product;
      if (!product || typeof product !== "object" || Array.isArray(product)) continue;
      const record = product as { id?: unknown; recordId?: unknown; name?: unknown; label?: unknown; active?: unknown; status?: unknown };
      if (record.id !== resolution.productId && record.recordId !== resolution.productId) continue;
      const lifecycle = typeof record.active === "boolean" ? (record.active ? "active" : "inactive") : record.status === "active" || record.status === "inactive" ? record.status : null;
      return { productId: resolution.productId, name: typeof record.name === "string" ? record.name : typeof record.label === "string" ? record.label : null, lifecycle };
    }
    if (observation.toolName === "search.global") {
      const matches = (data as { matches?: unknown }).matches;
      if (!Array.isArray(matches)) continue;
      const match = matches.find((item) => item && typeof item === "object" && (item as { entityType?: unknown; recordId?: unknown }).entityType === "product" && (item as { recordId?: unknown }).recordId === resolution.productId) as { label?: unknown; status?: unknown } | undefined;
      if (match) return { productId: resolution.productId, name: typeof match.label === "string" ? match.label : null, lifecycle: match.status === "active" || match.status === "inactive" ? match.status : null };
    }
  }
  return { productId: resolution.productId, name: null, lifecycle: null };
}

export function existingProductIdForMutation(input: {
  context: { entityType?: string | null; entityId?: string | null };
  task?: { entityReferences: Array<{ type: string; id: string }> };
  analysisObservations?: readonly AssistantOperatorObservation[];
}): string | null {
  const current = currentTurnProductResolution(input.analysisObservations);
  if (current.attempted) return current.productId;
  if (input.context.entityType === "product" && typeof input.context.entityId === "string") return input.context.entityId;
  const ids = Array.from(new Set((input.task?.entityReferences ?? []).filter((item) => item.type === "product").map((item) => item.id)));
  return ids.length === 1 ? ids[0]! : null;
}

/** Remove stale Product-specific conversational state once this investigation
 * has attempted a fresher Product resolution. The observation itself remains
 * the only Product fact supplied to the provider continuation. */
export function taskForCurrentProductEvidence(
  task: AssistantOperatorTrustedContext["task"],
  observations: readonly AssistantOperatorObservation[],
): AssistantOperatorTrustedContext["task"] {
  const current = currentTurnProductResolution(observations);
  if (!task || !current.attempted) return task;
  // A schema-valid runtime result always carries Product identity. Test or
  // defensive adapters may supply a successful reduced pricing payload with
  // no identity; keep descriptive task context for that read, while mutation
  // binding still fails closed because current.productId remains null.
  const hasIdentityBearingEvidence = observations.some((observation) => {
    if (observation.status !== "succeeded" || (observation.toolName !== "products.get_summary" && observation.toolName !== "products.get_pricing")) return false;
    const data = observation.result?.data;
    const product = data && typeof data === "object" && !Array.isArray(data) ? (data as { product?: unknown }).product : null;
    return Boolean(product && typeof product === "object" && !Array.isArray(product));
  });
  const hasFailedProductResolution = observations.some((observation) => (observation.toolName === "products.get_summary" || observation.toolName === "products.get_pricing") && observation.status !== "succeeded");
  if (!current.productId && !hasIdentityBearingEvidence && !hasFailedProductResolution) return task;
  const entityReferences = task.entityReferences.filter((item) => item.type !== "product");
  if (current.productId) entityReferences.push({ type: "product", id: current.productId });
  const fact = currentTurnProductFact(observations);
  return {
    ...task,
    entityReferences,
    trustedObservations: (task.trustedObservations ?? []).filter((item) => item.toolName !== "products.get_summary" && item.toolName !== "products.get_pricing" && item.toolName !== "search.global"),
    businessContext: task.businessContext ? { ...task.businessContext, businessStateSummary: fact?.lifecycle ? `Current trusted Product${fact.name ? ` \"${fact.name}\"` : ""} is ${fact.lifecycle}.` : null, existingProduct: null, recentCompletedTurn: null } : task.businessContext,
  };
}

export function isProductResolutionObservation(observation: AssistantOperatorObservation): boolean {
  return currentTurnProductResolution([observation]).attempted;
}
