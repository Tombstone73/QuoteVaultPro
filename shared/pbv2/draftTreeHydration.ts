export function normalizePbv2ProductIdentity(productId?: string | null): string | null {
  return typeof productId === "string" && productId.trim().length > 0 ? productId : null;
}

export function shouldBlockPbv2TreeHydration(input: {
  isLocalDirty: boolean;
  hasLocalTree: boolean;
  lastLoadedProductId?: string | null;
  productId?: string | null;
}): boolean {
  return (
    input.isLocalDirty &&
    input.hasLocalTree &&
    normalizePbv2ProductIdentity(input.lastLoadedProductId) === normalizePbv2ProductIdentity(input.productId)
  );
}

type Pbv2TreeVersionLike = {
  id?: string | null;
  treeJson?: unknown;
} | null | undefined;

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function getPbv2Nodes(treeJson: unknown): Record<string, any> {
  const tree = asRecord(treeJson);
  const rawNodes = tree?.nodes;
  if (Array.isArray(rawNodes)) {
    return Object.fromEntries(
      rawNodes
        .filter((node) => node && typeof node === "object" && typeof (node as any).id === "string")
        .map((node) => [String((node as any).id), node])
    );
  }
  return asRecord(rawNodes) ?? {};
}

export function countPbv2BuilderGroups(treeJson: unknown): number {
  return Object.values(getPbv2Nodes(treeJson)).filter((node) => {
    const type = typeof node?.type === "string" ? node.type.toUpperCase() : "";
    const kind = typeof node?.kind === "string" ? node.kind.toLowerCase() : "";
    const status = typeof node?.status === "string" ? node.status.toUpperCase() : "ENABLED";
    return status !== "DELETED" && (type === "GROUP" || kind === "group");
  }).length;
}

export function countPbv2RuntimeInputs(treeJson: unknown): number {
  return Object.values(getPbv2Nodes(treeJson)).filter((node) => {
    const type = typeof node?.type === "string" ? node.type.toUpperCase() : "";
    const kind = typeof node?.kind === "string" ? node.kind.toLowerCase() : "";
    const status = typeof node?.status === "string" ? node.status.toUpperCase() : "ENABLED";
    return status !== "DELETED" && (type === "INPUT" || kind === "question");
  }).length;
}

export function hasUsablePbv2BuilderTree(treeJson: unknown): boolean {
  return countPbv2BuilderGroups(treeJson) > 0 || countPbv2RuntimeInputs(treeJson) > 0;
}

export function choosePbv2BuilderTreeSource(input: {
  draft?: Pbv2TreeVersionLike;
  active?: Pbv2TreeVersionLike;
}): {
  source: Pbv2TreeVersionLike | null;
  sourceKind: "DRAFT" | "ACTIVE" | null;
  repairedFromActive: boolean;
  reason: "draft" | "active_fallback_missing_draft" | "active_fallback_empty_draft" | "empty_draft" | "empty_active" | "none";
} {
  const draft = input.draft ?? null;
  const active = input.active ?? null;
  const draftUsable = hasUsablePbv2BuilderTree(draft?.treeJson);
  const activeUsable = hasUsablePbv2BuilderTree(active?.treeJson);

  if (draft && draftUsable) {
    return { source: draft, sourceKind: "DRAFT", repairedFromActive: false, reason: "draft" };
  }

  if (active && activeUsable) {
    return {
      source: active,
      sourceKind: "ACTIVE",
      repairedFromActive: Boolean(draft),
      reason: draft ? "active_fallback_empty_draft" : "active_fallback_missing_draft",
    };
  }

  if (draft) {
    return { source: draft, sourceKind: "DRAFT", repairedFromActive: false, reason: "empty_draft" };
  }

  if (active) {
    return { source: active, sourceKind: "ACTIVE", repairedFromActive: false, reason: "empty_active" };
  }

  return { source: null, sourceKind: null, repairedFromActive: false, reason: "none" };
}
