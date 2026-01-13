export type FindingSeverity = "ERROR" | "WARNING" | "INFO";

export type Finding = {
  code: string;
  severity: FindingSeverity;
  message: string;
  /**
   * JSON pointer-like path. Callers should pass tree/edge/node paths (e.g. tree.nodes[n1].compute.expression).
   */
  path: string;
  entityId?: string;
  context?: Record<string, unknown>;
};

export function makeFinding(params: Finding): Finding {
  return params;
}

export function errorFinding(params: Omit<Finding, "severity">): Finding {
  return { ...params, severity: "ERROR" };
}

export function warningFinding(params: Omit<Finding, "severity">): Finding {
  return { ...params, severity: "WARNING" };
}

export function infoFinding(params: Omit<Finding, "severity">): Finding {
  return { ...params, severity: "INFO" };
}

export function pathJoin(base: string, segment: string): string {
  if (!base) return segment;
  if (!segment) return base;
  if (segment.startsWith("[")) return `${base}${segment}`;
  if (segment.startsWith(".")) return `${base}${segment}`;
  return `${base}.${segment}`;
}
