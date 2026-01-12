import type { OptionTreeV2, PricingImpact } from "./optionTreeV2";

type LegacyPriceMode =
  | "flat"
  | "flat_per_item"
  | "flat_per_qty"
  | "per_qty"
  | "per_sqft"
  | "percent_of_base"
  | "multiplier"
  | string;

type LegacyOption = {
  id: string;
  label: string;
  type: "checkbox" | "toggle" | "quantity" | "select" | "attachment" | string;
  priceMode?: LegacyPriceMode;
  amount?: number;
  required?: boolean;
  sortOrder?: number;
  groupKey?: string;
  groupLabel?: string;
  group?: string;
  defaultChecked?: boolean;
  defaultSelected?: boolean;
  defaultQty?: number;
  defaultValue?: any;
  choices?: Array<{ value: string; label: string; description?: string; sortOrder?: number }>;
};

const normalizeId = (raw: string): string => {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Keep stable, but remove whitespace
  return s.replace(/\s+/g, "_");
};

const toCentsInt = (dollars: unknown): number => {
  const n = Number(dollars ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

export function mapLegacyPriceModeToV2PricingImpact(input: {
  priceMode?: LegacyPriceMode;
  amount?: number;
  label?: string;
}): PricingImpact | null {
  const priceMode = String(input.priceMode ?? "").trim();
  const label = input.label ? String(input.label) : undefined;

  if (!priceMode) return null;

  if (priceMode === "flat") {
    return { mode: "addFlat", amountCents: toCentsInt(input.amount), label };
  }

  if (priceMode === "flat_per_item" || priceMode === "flat_per_qty" || priceMode === "per_qty") {
    return { mode: "addPerQty", amountCents: toCentsInt(input.amount), label };
  }

  if (priceMode === "per_sqft") {
    return { mode: "addPerSqft", amountCents: toCentsInt(input.amount), label };
  }

  if (priceMode === "percent_of_base") {
    const percent = Number(input.amount ?? 0);
    return { mode: "percentOfBase", percent: Number.isFinite(percent) ? percent : 0, label };
  }

  if (priceMode === "multiplier") {
    const factor = Number(input.amount ?? 1);
    return { mode: "multiplier", factor: Number.isFinite(factor) ? factor : 1, label };
  }

  // Unknown legacy mode: skip instead of producing invalid union discriminators.
  return null;
}

function getLegacyGroup(opt: LegacyOption): { key: string; label: string } {
  const groupKey = String(opt.groupKey || opt.group || "").trim();
  const groupLabel = String(opt.groupLabel || opt.group || opt.groupKey || "").trim();

  if (groupKey) return { key: groupKey, label: groupLabel || groupKey };

  return { key: "options", label: "Options" };
}

export function buildOptionTreeV2FromLegacyOptions(optionsJson: unknown): OptionTreeV2 {
  const options: LegacyOption[] = Array.isArray(optionsJson) ? (optionsJson as any) : [];

  const nodes: OptionTreeV2["nodes"] = {};

  const rootId = "root";
  nodes[rootId] = {
    id: rootId,
    kind: "group",
    label: "Options",
    ui: { sortOrder: 0 },
    edges: { children: [] },
  };

  const groupOrder: string[] = [];
  const groupToNodeId = new Map<string, string>();

  const ensureGroupNode = (group: { key: string; label: string }) => {
    const key = group.key;
    let groupNodeId = groupToNodeId.get(key);
    if (groupNodeId) return groupNodeId;

    groupNodeId = normalizeId(`group_${key}`);
    if (!groupNodeId) groupNodeId = `group_${groupToNodeId.size + 1}`;

    groupToNodeId.set(key, groupNodeId);
    groupOrder.push(key);

    nodes[groupNodeId] = {
      id: groupNodeId,
      kind: "group",
      label: group.label,
      ui: { groupKey: key },
      edges: { children: [] },
    };

    (nodes[rootId].edges!.children as any[]).push({ toNodeId: groupNodeId });
    return groupNodeId;
  };

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt || typeof opt !== "object") continue;

    const nodeId = normalizeId(String(opt.id));
    if (!nodeId) continue;

    const group = getLegacyGroup(opt);
    const groupNodeId = ensureGroupNode(group);

    const kind: any = "question";
    const label = String(opt.label || opt.id || "Option");

    const inputType = (() => {
      if (opt.type === "checkbox" || opt.type === "toggle") return "boolean";
      if (opt.type === "quantity") return "number";
      if (opt.type === "select") return "select";
      if (opt.type === "attachment") return "file";
      return "text";
    })();

    const defaultValue = (() => {
      if (inputType === "boolean") return opt.defaultChecked === true || opt.defaultSelected === true || opt.defaultValue === true;
      if (inputType === "number") return typeof opt.defaultQty === "number" ? opt.defaultQty : opt.defaultValue;
      if (inputType === "select") return typeof opt.defaultValue === "string" ? opt.defaultValue : undefined;
      return opt.defaultValue;
    })();

    const pricingImpact = (() => {
      const impact = mapLegacyPriceModeToV2PricingImpact({ priceMode: opt.priceMode, amount: opt.amount, label });
      if (!impact) return undefined;
      return [impact];
    })();

    nodes[nodeId] = {
      id: nodeId,
      kind,
      label,
      ui: { sortOrder: typeof opt.sortOrder === "number" ? opt.sortOrder : i },
      input: {
        type: inputType as any,
        required: !!opt.required,
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      },
      ...(Array.isArray(opt.choices) ? { choices: opt.choices as any } : {}),
      ...(pricingImpact ? { pricingImpact } : {}),
    } as any;

    (nodes[groupNodeId].edges!.children as any[]).push({ toNodeId: nodeId });
  }

  return {
    schemaVersion: 2,
    rootNodeIds: [rootId],
    nodes,
    meta: { title: "Initialized from legacy optionsJson" },
  };
}
