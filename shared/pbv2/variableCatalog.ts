import type { ExpressionSpec } from "./expressionSpec";
import type { PBV2Type, RefContext } from "./refContract";
import type { SymbolTable } from "./symbolTable";

export type VariableUnit = "inches" | "sqft" | "qty" | "cents" | "none";

export type VariableTypeInfo = {
  type: PBV2Type;
  nullable: boolean;
  /** Optional UI hint (e.g., treat NUMBER as currency cents). */
  displayAs?: "MONEY";
};

export type VariableCatalogCategory = "ENV" | "SELECTION" | "COMPUTED";

export type VariableCatalogItem = {
  category: VariableCatalogCategory;
  /** Canonical key shown in picker (not used by runtime evaluation). */
  key: string;
  label: string;
  type: VariableTypeInfo;
  unit: VariableUnit;
  allowedContexts: RefContext[];
  /** ExpressionSpec snippet to insert into JSON editor. */
  insert: ExpressionSpec;
  example?: string;
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as AnyRecord;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getBaseEnvVariableCatalog(): VariableCatalogItem[] {
  // Canonical env keys are defined by the refContract allowlist.
  // Keep this list stable and explicit to avoid UI drift.
  return [
    {
      category: "ENV",
      key: "env.widthIn",
      label: "Width (in)",
      type: { type: "NUMBER", nullable: false },
      unit: "inches",
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "envRef", envKey: "widthIn" } },
      example: "24",
    },
    {
      category: "ENV",
      key: "env.heightIn",
      label: "Height (in)",
      type: { type: "NUMBER", nullable: false },
      unit: "inches",
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "envRef", envKey: "heightIn" } },
      example: "48",
    },
    {
      category: "ENV",
      key: "env.quantity",
      label: "Quantity",
      type: { type: "NUMBER", nullable: false },
      unit: "qty",
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "envRef", envKey: "quantity" } },
      example: "1",
    },
    {
      category: "ENV",
      key: "env.sqft",
      label: "Area (sqft)",
      type: { type: "NUMBER", nullable: false },
      unit: "sqft",
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "envRef", envKey: "sqft" } },
      example: "8.0",
    },
    {
      category: "ENV",
      key: "env.perimeterIn",
      label: "Perimeter (in)",
      type: { type: "NUMBER", nullable: false },
      unit: "inches",
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "envRef", envKey: "perimeterIn" } },
      example: "144",
    },
  ];
}

function inferSelectionUnit(constraints: unknown, inputType: PBV2Type): VariableUnit {
  if (inputType !== "NUMBER") return "none";
  const c = asRecord(constraints);
  const numberC = asRecord(c?.number ?? c);
  const unit = numberC && isNonEmptyString((numberC as any).unit) ? String((numberC as any).unit) : "";
  if (unit.toLowerCase() === "in" || unit.toLowerCase() === "inch" || unit.toLowerCase() === "inches") return "inches";
  if (unit.toLowerCase() === "sqft") return "sqft";
  if (unit.toLowerCase() === "qty" || unit.toLowerCase() === "quantity") return "qty";
  if (unit.toLowerCase() === "cents") return "cents";
  return "none";
}

function nodeKeyById(treeJson: unknown): Record<string, string> {
  const tv = asRecord(treeJson);
  const nodes = tv ? (tv as any).nodes : undefined;
  const out: Record<string, string> = {};
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const rec = asRecord(n);
      const id = rec && isNonEmptyString((rec as any).id) ? String((rec as any).id) : "";
      const key = rec && isNonEmptyString((rec as any).key) ? String((rec as any).key) : "";
      if (id && key) out[id] = key;
    }
  } else {
    const m = asRecord(nodes);
    if (m) {
      for (const [id, raw] of Object.entries(m)) {
        const rec = asRecord(raw);
        const key = rec && isNonEmptyString((rec as any).key) ? String((rec as any).key) : "";
        if (key) out[id] = key;
      }
    }
  }
  return out;
}

export function buildVariableCatalog(treeJson: unknown, symbolTable: SymbolTable): VariableCatalogItem[] {
  const items: VariableCatalogItem[] = [];
  items.push(...getBaseEnvVariableCatalog());

  const nodeKey = nodeKeyById(treeJson);

  // Selection variables: include both explicit selectionRef and effectiveRef.
  for (const [selectionKey, sym] of Object.entries(symbolTable.inputBySelectionKey)) {
    const unit = inferSelectionUnit(sym.constraints, sym.inputKind);

    items.push({
      category: "SELECTION",
      key: `sel.${selectionKey}`,
      label: `Selection (explicit): ${selectionKey}`,
      type: { type: sym.inputKind, nullable: true },
      unit,
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "selectionRef", selectionKey } },
    });

    items.push({
      category: "SELECTION",
      key: `eff.${selectionKey}`,
      label: `Selection (effective): ${selectionKey}`,
      type: { type: sym.inputKind, nullable: !sym.hasDefault },
      unit,
      allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
      insert: { op: "ref", ref: { kind: "effectiveRef", selectionKey } },
    });
  }

  // Compute outputs.
  for (const [nodeId, compute] of Object.entries(symbolTable.computeByNodeId)) {
    for (const [outputKey, outSym] of Object.entries(compute.outputs)) {
      const prettyKey = nodeKey[nodeId] ? `${nodeKey[nodeId]}.${outputKey}` : `${nodeId}.${outputKey}`;
      items.push({
        category: "COMPUTED",
        key: `computed.${prettyKey}`,
        label: nodeKey[nodeId]
          ? `Computed: ${nodeKey[nodeId]} → ${outputKey}`
          : `Computed: ${nodeId} → ${outputKey}`,
        type: { type: outSym.type, nullable: outSym.type === "NULL" },
        unit: "none",
        allowedContexts: ["COMPUTE", "PRICE", "CONDITION", "EFFECT"],
        insert: { op: "ref", ref: { kind: "nodeOutputRef", nodeId, outputKey } },
      });
    }
  }

  // Stable sort for UX.
  items.sort((a, b) =>
    a.category.localeCompare(b.category) || a.key.localeCompare(b.key) || a.label.localeCompare(b.label)
  );

  return items;
}
