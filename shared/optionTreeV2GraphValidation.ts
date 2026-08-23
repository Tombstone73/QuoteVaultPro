/**
 * Dependency-free structural guard shared by the server runtime and the V2
 * browser bundle.  The richer OptionTree schema remains Zod-owned in
 * optionTreeV2.ts; importing it at runtime would unnecessarily pull Zod into
 * browser-only configuration resolution.
 */
export function validateOptionTreeV2Graph(tree: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!tree || typeof tree !== "object") return { ok: false, errors: ["Tree must be an object"] };

  const value = tree as Record<string, unknown>;
  if (value.schemaVersion !== 2) errors.push("schemaVersion must be 2");
  if (!Array.isArray(value.rootNodeIds) || value.rootNodeIds.length === 0)
    errors.push("rootNodeIds must be a non-empty array");
  if (!value.nodes || typeof value.nodes !== "object")
    errors.push("nodes must be an object map");

  const nodes = value.nodes && typeof value.nodes === "object"
    ? value.nodes as Record<string, unknown>
    : {};
  if (Array.isArray(value.rootNodeIds)) for (const rootId of value.rootNodeIds) {
    if (typeof rootId !== "string" || !rootId.trim()) {
      errors.push("rootNodeIds must contain non-empty strings");
    } else if (!nodes[rootId]) {
      errors.push(`rootNodeId '${rootId}' does not exist in nodes`);
    }
  }

  for (const [key, rawNode] of Object.entries(nodes)) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const node = rawNode as Record<string, unknown>;
    if (node.id !== key) errors.push(`Node id mismatch: nodes['${key}'].id must equal '${key}'`);
    const edges = node.edges && typeof node.edges === "object"
      ? node.edges as Record<string, unknown>
      : {};
    if (!Array.isArray(edges.children)) continue;
    for (const edge of edges.children) {
      if (!edge || typeof edge !== "object") continue;
      const target = (edge as Record<string, unknown>).toNodeId;
      if (typeof target === "string" && target.trim() && !nodes[target])
        errors.push(`Edge reference missing: '${key}' -> '${target}'`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
