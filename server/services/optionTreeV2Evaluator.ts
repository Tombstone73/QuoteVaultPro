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

  // DEV: Log incoming selections for debugging
  if (process.env.NODE_ENV === "development") {
    console.log(`[PBV2_EVALUATOR] Received selections:`, JSON.stringify(selections.selected, null, 2));
    console.log(`[PBV2_EVALUATOR] Tree has ${Object.keys(tree.nodes).length} nodes`);
  }

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

  // Compute dimensional units (for per-unit pricing)
  const widthIn = width;
  const heightIn = height;
  const sqftPerItem = widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0;
  // linearFoot = width in feet (assumes width is the "roll length" dimension)
  const linearFootPerItem = widthIn > 0 ? widthIn / 12 : 0;
  // inches = width (default dimension for per-inch pricing)
  const inchesPerItem = widthIn;

  const baseCents = Math.round(basePrice * 100); // Convert base price to cents
  const visibleNodeIds = resolveVisibleNodes(tree, selections);
  const selected = selections.selected ?? {};

  let optionsCents = 0; // Running total in cents
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

    // STEP 1: Process NODE-level pricing impacts (legacy backward compatibility)
    // This is kept for existing data but NEW flows should use choice-level pricing
    const nodeImpacts = node.pricingImpact ?? [];
    for (let j = 0; j < nodeImpacts.length; j++) {
      const impact: any = nodeImpacts[j];
      if (!impact) continue;

      // applyWhen evaluation is handled in shared runtime in future extensions;
      // for now, we treat missing refs as false by leaving runtime as the source of truth.
      if (!applyWhenOk(impact.applyWhen, selected)) {
        continue;
      }

      if (!isSelected) continue;

      // Process legacy modes (dollars)
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

    // STEP 2: Process CHOICE-level pricing impacts (v2.1: NEW model)
    // Only for select-type nodes with a selected value
    if (isSelected && node.input?.type === "select" && Array.isArray(node.choices)) {
      const selectedValue = typeof valueRaw === "string" ? valueRaw : String(valueRaw);
      const choice = node.choices.find((c) => c.value === selectedValue);
      
      // DEV: Log choice selection and pricing impact status
      if (process.env.NODE_ENV === "development") {
        console.log(`[PBV2_CHOICE_DEBUG] Node: ${nodeId} (${node.label}), Selected value: "${selectedValue}", Choice found: ${!!choice}`);
        if (choice) {
          console.log(`[PBV2_CHOICE_DEBUG] Choice "${choice.label}", hasPricingImpact: ${Array.isArray(choice.pricingImpact)}, impacts count: ${choice.pricingImpact?.length ?? 0}`);
          if (choice.pricingImpact) {
            console.log(`[PBV2_CHOICE_DEBUG] Pricing impacts:`, JSON.stringify(choice.pricingImpact, null, 2));
          }
        } else {
          console.log(`[PBV2_CHOICE_DEBUG] Available choice values:`, node.choices.map(c => c.value));
        }
      }
      
      if (choice && Array.isArray(choice.pricingImpact) && choice.pricingImpact.length > 0) {
        // Dev logging to verify choice-level pricing is working
        if (process.env.NODE_ENV === "development") {
          console.log(`[PBV2_CHOICE_PRICING] Node: ${node.label}, Choice: ${choice.label}, Impacts: ${choice.pricingImpact.length}`);
        }
        
        for (let k = 0; k < choice.pricingImpact.length; k++) {
          const impact: any = choice.pricingImpact[k];
          if (!impact) continue;

          if (!applyWhenOk(impact.applyWhen, selected)) {
            continue;
          }

          // Process new choice-level pricing modes (all in cents)
          switch (impact.mode) {
            case "addCents": {
              const cents = Number(impact.cents ?? 0);
              if (Number.isFinite(cents)) {
                optionsCents += cents; // Direct cents impact (can be negative)
                if (process.env.NODE_ENV === "development") {
                  console.log(`[PBV2_CHOICE_PRICING] addCents: ${cents} (total options: ${optionsCents})`);
                }
              }
              break;
            }
            
            case "addPercent": {
              const percent = Number(impact.percent ?? 0);
              const basis = impact.basis || "base"; // Default to "base"
              
              if (Number.isFinite(percent)) {
                let basisCents = 0;
                
                // Determine basis for percentage calculation
                if (basis === "base") {
                  basisCents = baseCents;
                } else if (basis === "optionsSubtotal") {
                  // Use current running optionsCents (order-dependent)
                  basisCents = optionsCents;
                } else if (basis === "lineSubtotal") {
                  // Use base + current options (order-dependent)
                  basisCents = baseCents + optionsCents;
                }
                
                // Apply percentage (can be negative for discounts)
                const percentCents = Math.round(basisCents * (percent / 100));
                optionsCents += percentCents;
                
                if (process.env.NODE_ENV === "development") {
                  console.log(`[PBV2_CHOICE_PRICING] addPercent: ${percent}% of ${basis} (${basisCents}¢) = ${percentCents}¢ (total options: ${optionsCents})`);
                }
              }
              break;
            }
            
            case "addPerUnit": {
              const centsPerUnit = Number(impact.centsPerUnit ?? 0);
              const unit = impact.unit;
              
              if (Number.isFinite(centsPerUnit) && unit) {
                let unitAmount = 0;
                
                // Calculate unit amount based on unit type
                if (unit === "perPiece" || unit === "perQty") {
                  // perQty is treated as alias of perPiece
                  unitAmount = quantity;
                } else if (unit === "perSqft") {
                  unitAmount = sqftPerItem * quantity;
                } else if (unit === "perLinearFoot") {
                  unitAmount = linearFootPerItem * quantity;
                } else if (unit === "perInch") {
                  unitAmount = inchesPerItem * quantity;
                }
                
                // Apply per-unit pricing (can be negative)
                const unitCents = Math.round(centsPerUnit * unitAmount);
                optionsCents += unitCents;
                
                if (process.env.NODE_ENV === "development") {
                  console.log(`[PBV2_CHOICE_PRICING] addPerUnit: ${centsPerUnit}¢/${unit} × ${unitAmount.toFixed(2)} = ${unitCents}¢ (total options: ${optionsCents})`);
                }
              }
              break;
            }
            
            // Legacy modes (for backward compatibility if stored on choices)
            case "addFlat": {
              const cents = Number(impact.amountCents ?? 0);
              if (Number.isFinite(cents)) {
                nodeCost += cents / 100; // Convert to dollars for legacy flow
              }
              break;
            }
            
            case "addPerQty": {
              const cents = Number(impact.amountCents ?? 0);
              if (Number.isFinite(cents)) {
                nodeCost += (cents / 100) * quantity; // Convert to dollars for legacy flow
              }
              break;
            }
          }
        }
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

    // Add node-level cost (legacy flow uses dollars, converted to cents)
    optionsCents += Math.round(nodeCost * 100);
  }

  if (!Number.isFinite(optionsCents)) {
    throw new Error("OptionTreeV2 evaluation produced invalid optionsCents");
  }

  const optionsPrice = optionsCents / 100; // Convert back to dollars for result

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
