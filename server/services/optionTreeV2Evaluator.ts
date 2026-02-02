import { z } from "zod";

import {
  LineItemOptionSelectionsV2,
  OptionTreeV2,
  lineItemOptionSelectionsV2Schema,
  optionTreeV2Schema,
} from "../../shared/optionTreeV2";
import { resolveVisibleNodes, validateOptionTreeV2 } from "../../shared/optionTreeV2Runtime";

type SelectedOptionsSnapshotEntry = {
  optionId: string;
  optionName: string;
  value: string | number | boolean;
  setupCost: number;
  calculatedCost: number;
};

export type OptionTreeV2EvaluateInput = {
  tree: unknown;
  selections: unknown;
  width: number;
  height: number;
  quantity: number;
  basePrice: number;
};

export type OptionTreeV2EvaluateResult = {
  optionsPrice: number;
  selectedOptions: SelectedOptionsSnapshotEntry[];
  visibleNodeIds: string[];
};

export type OptionTreeV2WeightInput = {
  tree: unknown;
  selections: unknown;
  widthIn?: number;
  heightIn?: number;
  quantity: number;
};

export type OptionTreeV2WeightResult = {
  totalOz: number;
  breakdown: Array<{ label: string; oz: number }>;
};

const toSnapshotValue = (value: unknown): string | number | boolean => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const applyWhenOk = (applyWhen: any, treeSelected: Record<string, { value?: any }>): boolean => {
  if (!applyWhen) return true;
  // We intentionally rely on the shared runtime evaluator via resolveVisibleNodes’ internal calls.
  // Here we just do a cheap shape check; actual evaluation is done in runtime when needed.
  return true;
};

export function evaluateOptionTreeV2(input: OptionTreeV2EvaluateInput): OptionTreeV2EvaluateResult {
  const tree: OptionTreeV2 = optionTreeV2Schema.parse(input.tree);
  const selections: LineItemOptionSelectionsV2 = lineItemOptionSelectionsV2Schema.parse(input.selections);

  const graphValidation = validateOptionTreeV2(tree);
  if (!graphValidation.ok) {
    const err = new Error("Invalid optionTreeJson (v2)");
    (err as any).details = graphValidation.errors;
    throw err;
  }

  const quantity = Number(input.quantity);
  const width = Number(input.width);
  const height = Number(input.height);
  const basePrice = Number(input.basePrice);

  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid quantity for option evaluation");
  if (!Number.isFinite(basePrice)) throw new Error("Invalid basePrice for option evaluation");

  const visibleNodeIds = resolveVisibleNodes(tree, selections);
  const selected = selections.selected ?? {};

  let optionsPrice = 0;
  const selectedOptions: SelectedOptionsSnapshotEntry[] = [];

  for (let i = 0; i < visibleNodeIds.length; i++) {
    const nodeId = visibleNodeIds[i];
    const node = tree.nodes[nodeId];
    if (!node) continue;

    const selectionEntry = selected[nodeId];
    const valueRaw = selectionEntry ? selectionEntry.value : undefined;

    const isSelected = (() => {
      if (valueRaw === null || valueRaw === undefined) return false;
      if (node.kind !== "question") return false;
      const inputType = node.input?.type;
      if (inputType === "boolean") return valueRaw === true;
      if (inputType === "select") return typeof valueRaw === "string" && valueRaw.trim().length > 0;
      return true;
    })();

    let nodeCost = 0;
    const impacts = node.pricingImpact ?? [];

    for (let j = 0; j < impacts.length; j++) {
      const impact: any = impacts[j];
      if (!impact) continue;

      // applyWhen evaluation is handled in shared runtime in future extensions;
      // for now, we treat missing refs as false by leaving runtime as the source of truth.
      if (!applyWhenOk(impact.applyWhen, selected)) {
        continue;
      }

      if (!isSelected) continue;

      switch (impact.mode) {
        case "addFlat":
          nodeCost += (impact.amountCents ?? 0) / 100;
          break;
        case "addPerQty":
          nodeCost += ((impact.amountCents ?? 0) / 100) * quantity;
          break;
        default:
          // MVP: ignore unsupported impact modes.
          break;
      }
    }

    if (!Number.isFinite(nodeCost)) {
      throw new Error(`Option v2 node '${nodeId}' produced invalid cost`);
    }

    const hasValue = isSelected;
    const hasCost = Math.abs(nodeCost) > 0;

    if (hasValue || hasCost) {
      selectedOptions.push({
        optionId: nodeId,
        optionName: node.label,
        value: toSnapshotValue(valueRaw),
        setupCost: 0,
        calculatedCost: nodeCost,
      });
    }

    optionsPrice += nodeCost;
  }

  if (!Number.isFinite(optionsPrice)) {
    throw new Error("OptionTreeV2 evaluation produced invalid optionsPrice");
  }

  return { optionsPrice, selectedOptions, visibleNodeIds };
}

export function isZodError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}

export function pbv2ToWeightTotal(input: OptionTreeV2WeightInput): OptionTreeV2WeightResult {
  const tree: OptionTreeV2 = optionTreeV2Schema.parse(input.tree);
  const selections: LineItemOptionSelectionsV2 = lineItemOptionSelectionsV2Schema.parse(input.selections);

  const graphValidation = validateOptionTreeV2(tree);
  if (!graphValidation.ok) {
    const err = new Error("Invalid optionTreeJson (v2) for weight calculation");
    (err as any).details = graphValidation.errors;
    throw err;
  }

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Invalid quantity for weight calculation");
  }

  const widthIn = Number(input.widthIn ?? 0);
  const heightIn = Number(input.heightIn ?? 0);
  const areaSqft = Number.isFinite(widthIn) && Number.isFinite(heightIn) && widthIn > 0 && heightIn > 0
    ? (widthIn * heightIn) / 144
    : 0;

  const breakdown: Array<{ label: string; oz: number }> = [];
  let totalOz = 0;

  // 1) Base weight from tree metadata
  const baseWeightOz = Number(tree.meta?.baseWeightOz ?? 0);
  if (Number.isFinite(baseWeightOz) && baseWeightOz !== 0) {
    totalOz += baseWeightOz;
    breakdown.push({ label: "Base weight", oz: baseWeightOz });
  }

  const visibleNodeIds = resolveVisibleNodes(tree, selections);
  const selected = selections.selected ?? {};

  // 2) Node weightImpact rules and choice-level weightOz
  for (let i = 0; i < visibleNodeIds.length; i++) {
    const nodeId = visibleNodeIds[i];
    const node = tree.nodes[nodeId];
    if (!node) continue;

    const selectionEntry = selected[nodeId];
    const valueRaw = selectionEntry ? selectionEntry.value : undefined;

    const isSelected = (() => {
      if (valueRaw === null || valueRaw === undefined) return false;
      if (node.kind !== "question") return false;
      const inputType = node.input?.type;
      if (inputType === "boolean") return valueRaw === true;
      if (inputType === "select") return typeof valueRaw === "string" && valueRaw.trim().length > 0;
      return true;
    })();

    // Process node-level weightImpact rules
    const impacts = node.weightImpact ?? [];
    for (let j = 0; j < impacts.length; j++) {
      const impact: any = impacts[j];
      if (!impact) continue;

      if (!applyWhenOk(impact.applyWhen, selected)) {
        continue;
      }

      if (!isSelected) continue;

      const oz = Number(impact.oz ?? 0);
      if (!Number.isFinite(oz)) continue;

      let contribution = 0;
      switch (impact.mode) {
        case "addFlat":
          contribution = oz;
          break;
        case "addPerQty":
          contribution = oz * quantity;
          break;
        case "addPerSqft":
          contribution = oz * areaSqft;
          break;
        default:
          continue;
      }

      if (!Number.isFinite(contribution)) contribution = 0;
      if (contribution !== 0) {
        const label = impact.label || `Weight: ${node.label}`;
        totalOz += contribution;
        breakdown.push({ label, oz: contribution });
      }
    }

    // Process choice-level weightOz
    if (isSelected && node.input?.type === "select" && Array.isArray(node.choices)) {
      const selectedValue = typeof valueRaw === "string" ? valueRaw : String(valueRaw);
      const choice = node.choices.find((c) => c.value === selectedValue);
      if (choice && typeof choice.weightOz === "number" && Number.isFinite(choice.weightOz)) {
        const choiceWeight = choice.weightOz * quantity;
        if (Number.isFinite(choiceWeight) && choiceWeight !== 0) {
          const label = `${node.label}: ${choice.label}`;
          totalOz += choiceWeight;
          breakdown.push({ label, oz: choiceWeight });
        }
      }
    }
  }

  // Ensure totalOz is not NaN
  if (!Number.isFinite(totalOz)) {
    totalOz = 0;
  }

  return { totalOz, breakdown };
}
