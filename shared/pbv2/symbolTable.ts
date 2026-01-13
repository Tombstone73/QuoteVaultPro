import { DEFAULT_ENV_KEYS } from "./refContract";
import type { PBV2Type } from "./refContract";
import { errorFinding, type Finding } from "./findings";

export type PBV2NodeType = "INPUT" | "COMPUTE" | "PRICE" | "EFFECT" | "GROUP";
export type PBV2Status = "ENABLED" | "DISABLED" | "DELETED";

export type InputSymbol = {
  nodeId: string;
  selectionKey: string;
  inputKind: PBV2Type;
  hasDefault: boolean;
  constraints?: unknown;
};

export type ComputeOutputSymbol = {
  outputKey: string;
  type: PBV2Type;
};

export type ComputeSymbol = {
  nodeId: string;
  outputs: Record<string, ComputeOutputSymbol>;
};

export type SymbolTable = {
  nodeTypesById: Record<string, PBV2NodeType>;
  inputBySelectionKey: Record<string, InputSymbol>;
  computeByNodeId: Record<string, ComputeSymbol>;
  envKeys: ReadonlySet<string>;
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as AnyRecord;
}

function normalizeType(value: unknown): PBV2Type | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper === "NUMBER") return "NUMBER";
  if (upper === "BOOLEAN") return "BOOLEAN";
  if (upper === "TEXT" || upper === "STRING") return "TEXT";
  if (upper === "JSON") return "JSON";
  if (upper === "NULL") return "NULL";
  return null;
}

function normalizeNodeType(value: unknown): PBV2NodeType | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper === "INPUT") return "INPUT";
  if (upper === "COMPUTE") return "COMPUTE";
  if (upper === "PRICE") return "PRICE";
  if (upper === "EFFECT") return "EFFECT";
  if (upper === "GROUP") return "GROUP";
  return null;
}

function extractNodes(treeVersion: unknown): Array<{ id: string; node: AnyRecord }> {
  const tv = asRecord(treeVersion);
  if (!tv) return [];

  const nodesValue = tv.nodes;

  if (Array.isArray(nodesValue)) {
    const out: Array<{ id: string; node: AnyRecord }> = [];
    for (const raw of nodesValue) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = typeof rec.id === "string" ? rec.id : typeof rec.nodeId === "string" ? rec.nodeId : "";
      if (!id) continue;
      out.push({ id, node: rec });
    }
    return out;
  }

  const nodesRecord = asRecord(nodesValue);
  if (nodesRecord) {
    const out: Array<{ id: string; node: AnyRecord }> = [];
    for (const [key, raw] of Object.entries(nodesRecord)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = typeof rec.id === "string" ? rec.id : key;
      if (!id) continue;
      out.push({ id, node: rec });
    }
    return out;
  }

  return [];
}

function extractSelectionKey(node: AnyRecord): string | null {
  // Preferred PBV2-style shapes
  const input = asRecord(node.input) ?? asRecord((node as any).data);
  if (input) {
    if (typeof input.selectionKey === "string" && input.selectionKey.trim()) return input.selectionKey;
    if (typeof (input as any).key === "string" && (input as any).key.trim()) return (input as any).key;
  }

  // Fallback: sometimes selectionKey is on node directly
  if (typeof node.selectionKey === "string" && node.selectionKey.trim()) return node.selectionKey;
  return null;
}

function extractInputType(node: AnyRecord): PBV2Type | null {
  const input = asRecord(node.input) ?? asRecord((node as any).data);
  if (input) {
    const t = normalizeType((input as any).valueType ?? (input as any).type ?? (input as any).inputKind);
    if (t) return t;
  }
  const direct = normalizeType((node as any).valueType ?? (node as any).type);
  return direct;
}

function extractHasDefault(node: AnyRecord): boolean {
  const input = asRecord(node.input) ?? asRecord((node as any).data);
  if (input && Object.prototype.hasOwnProperty.call(input, "default")) return true;
  if (input && Object.prototype.hasOwnProperty.call(input, "defaultValue")) return true;
  if (Object.prototype.hasOwnProperty.call(node, "default")) return true;
  if (Object.prototype.hasOwnProperty.call(node, "defaultValue")) return true;
  return false;
}

function extractConstraints(node: AnyRecord): unknown {
  const input = asRecord(node.input) ?? asRecord((node as any).data);
  if (input && Object.prototype.hasOwnProperty.call(input, "constraints")) return (input as any).constraints;
  return undefined;
}

function extractComputeOutputs(node: AnyRecord): Record<string, ComputeOutputSymbol> {
  const compute = asRecord(node.compute) ?? asRecord((node as any).data);
  const outputsRaw = compute ? (compute as any).outputs ?? (compute as any).outputSchema : undefined;

  const outputs: Record<string, ComputeOutputSymbol> = {};

  const outputsRecord = asRecord(outputsRaw);
  if (outputsRecord) {
    for (const [key, raw] of Object.entries(outputsRecord)) {
      const rec = asRecord(raw);
      const type = normalizeType(rec ? (rec as any).type : raw);
      if (!type) continue;
      outputs[key] = { outputKey: key, type };
    }
  }

  // Fallback: single outputType without keys
  const maybeType = normalizeType((compute as any)?.outputType ?? (node as any).outputType);
  if (maybeType && Object.keys(outputs).length === 0) {
    outputs["value"] = { outputKey: "value", type: maybeType };
  }

  return outputs;
}

export function buildSymbolTable(treeVersion: unknown, opts?: { pathBase?: string }): { table: SymbolTable; findings: Finding[] } {
  const pathBase = opts?.pathBase ?? "tree";
  const findings: Finding[] = [];

  const nodeTypesById: Record<string, PBV2NodeType> = {};
  const inputBySelectionKey: Record<string, InputSymbol> = {};
  const computeByNodeId: Record<string, ComputeSymbol> = {};

  const nodes = extractNodes(treeVersion);

  for (const { id: nodeId, node } of nodes) {
    const nodeType =
      normalizeNodeType((node as any).type ?? (node as any).nodeType ?? (node as any).kind) ??
      // bridge common terms in existing OptionTreeV2
      ((node as any).kind === "question" ? "INPUT" : (node as any).kind === "computed" ? "COMPUTE" : (node as any).kind === "group" ? "GROUP" : null);

    if (!nodeType) {
      findings.push(
        errorFinding({
          code: "PBV2_E_TREE_NODE_TYPE_UNKNOWN",
          message: `Node '${nodeId}' has unknown type`,
          path: `${pathBase}.nodes[${nodeId}].type`,
          entityId: nodeId,
          context: { nodeId },
        })
      );
      continue;
    }

    nodeTypesById[nodeId] = nodeType;

    if (nodeType === "INPUT") {
      const selectionKey = extractSelectionKey(node);
      const inputType = extractInputType(node);

      if (!selectionKey) {
        // This slice only builds symbols; missing selectionKey is a validation concern.
        continue;
      }
      if (!inputType) {
        findings.push(
          errorFinding({
            code: "PBV2_E_INPUT_TYPE_UNKNOWN",
            message: `INPUT '${nodeId}' selectionKey '${selectionKey}' has unknown value type`,
            path: `${pathBase}.nodes[${nodeId}].input.valueType`,
            entityId: nodeId,
            context: { nodeId, selectionKey },
          })
        );
        continue;
      }

      inputBySelectionKey[selectionKey] = {
        nodeId,
        selectionKey,
        inputKind: inputType,
        hasDefault: extractHasDefault(node),
        constraints: extractConstraints(node),
      };
    }

    if (nodeType === "COMPUTE") {
      const outputs = extractComputeOutputs(node);
      computeByNodeId[nodeId] = { nodeId, outputs };
    }
  }

  const table: SymbolTable = {
    nodeTypesById,
    inputBySelectionKey,
    computeByNodeId,
    envKeys: new Set<string>(DEFAULT_ENV_KEYS),
  };

  return { table, findings };
}
