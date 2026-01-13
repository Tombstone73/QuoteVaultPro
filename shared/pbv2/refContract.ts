export type PBV2Type = "NUMBER" | "BOOLEAN" | "TEXT" | "JSON" | "NULL";

export type RefContext = "INPUT" | "COMPUTE" | "PRICE" | "CONDITION" | "EFFECT";

export type RefKind =
  | "selectionRef"
  | "effectiveRef"
  | "nodeOutputRef"
  | "envRef"
  | "pricebookRef"
  | "constant";

export type ConstantValue = number | boolean | string | null;

export type Ref =
  | { kind: "selectionRef"; selectionKey: string }
  | { kind: "effectiveRef"; selectionKey: string }
  | { kind: "nodeOutputRef"; nodeId: string; outputKey: string }
  | { kind: "envRef"; envKey: string }
  | { kind: "pricebookRef"; key: string }
  | { kind: "constant"; value: ConstantValue };

export const DEFAULT_ENV_KEYS = ["widthIn", "heightIn", "quantity", "sqft", "perimeterIn"] as const;
export type EnvKey = (typeof DEFAULT_ENV_KEYS)[number];

export const REF_KIND_LEGALITY: Readonly<Record<RefContext, ReadonlySet<RefKind>>> = {
  INPUT: new Set<RefKind>(["constant"]),
  COMPUTE: new Set<RefKind>(["constant", "selectionRef", "effectiveRef", "nodeOutputRef", "envRef"]),
  CONDITION: new Set<RefKind>(["constant", "selectionRef", "effectiveRef", "nodeOutputRef", "envRef"]),
  PRICE: new Set<RefKind>(["constant", "selectionRef", "effectiveRef", "nodeOutputRef", "envRef", "pricebookRef"]),
  EFFECT: new Set<RefKind>(["constant", "selectionRef", "effectiveRef", "nodeOutputRef", "envRef"]),
} as const;

export function isRefKindAllowedInContext(kind: RefKind, ctx: RefContext): boolean {
  return REF_KIND_LEGALITY[ctx].has(kind);
}

export function constantValueToType(value: ConstantValue): PBV2Type {
  if (value === null) return "NULL";
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "string") return "TEXT";
  return "JSON";
}
