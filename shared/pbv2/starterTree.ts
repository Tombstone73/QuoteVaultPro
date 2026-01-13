import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "./validator";

/**
 * Smallest PBV2 tree JSON that passes validateTreeForPublish with DEFAULT_VALIDATE_OPTS.
 * Derived from shared/pbv2/tests/validator/validatePublish.test.ts.
 */
export function createPbv2StarterTreeJson(): Record<string, unknown> {
  const tree: Record<string, unknown> = {
    status: "DRAFT",
    rootNodeIds: ["root"],
    nodes: [
      {
        id: "root",
        type: "INPUT",
        status: "ENABLED",
        key: "root",
        input: { selectionKey: "root", valueType: "BOOLEAN" },
      },
    ],
    edges: [],
  };

  // Guardrail: ensure this template stays publish-valid as validator evolves.
  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  if (res.errors.length > 0 || res.warnings.length > 0) {
    const summary = {
      errors: res.errors.map((f) => ({ code: f.code, path: f.path })),
      warnings: res.warnings.map((f) => ({ code: f.code, path: f.path })),
    };
    throw new Error(`PBV2 starter tree is no longer publish-valid: ${JSON.stringify(summary)}`);
  }

  return tree;
}

export function stringifyPbv2TreeJson(tree: unknown): string {
  try {
    return JSON.stringify(tree ?? {}, null, 2);
  } catch {
    return "{}";
  }
}
