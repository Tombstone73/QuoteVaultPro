import { z } from "zod";
import { evaluate } from "mathjs";

import {
  LineItemOptionSelectionsV2,
  OptionTreeV2,
  lineItemOptionSelectionsV2Schema,
  optionTreeV2Schema,
} from "../../shared/optionTreeV2";
import { resolveRuntimeVisibility, validateOptionTreeV2 } from "../../shared/optionTreeV2Runtime";
import { buildFormulaEvaluationScope, buildFormulaScope } from "../../shared/pbv2/formulaScope";
import { buildNumericSelectionFormulaVariables } from "../../shared/pbv2/numericSelectionFormulaVariables";

type SelectedOptionsSnapshotEntry = {
  optionId: string;
  optionName: string;
  value: string | number | boolean;
  setupCost: number;
  calculatedCost: number;
};

export type OptionPriceContribution = {
  optionId: string;
  selectionKey?: string;
  optionLabel: string;
  choiceValue?: string;
  choiceLabel?: string;
  amountCents: number;
};

export type OptionTreeV2EvaluateInput = {
  tree: unknown;
  selections: unknown;
  width: number;
  height: number;
  quantity: number;
  basePrice: number;
  formulaVariables?: Record<string, number>;
};

export type OptionTreeV2EvaluateResult = {
  optionsPrice: number;
  selectedOptions: SelectedOptionsSnapshotEntry[];
  optionPriceContributions: OptionPriceContribution[];
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

const getNumericRecord = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const numeric = Number(raw);
    if (key && Number.isFinite(numeric)) out[key] = numeric;
  }
  return out;
};

const extractUndefinedSymbol = (message: string): string | null => {
  const match = message.match(/undefined\s+(?:symbol|variable)\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  return match?.[1] ?? null;
};

const buildFormulaImpactError = (input: {
  error: unknown;
  sourceLabel: string;
  formula: string;
  path?: string;
  nodeId?: string;
  optionLabel?: string;
  choiceValue?: string;
  choiceLabel?: string;
  formulaScope: Record<string, unknown>;
}) => {
  const rawMessage = typeof (input.error as any)?.message === "string" ? (input.error as any).message : "Invalid formula";
  const missingSymbol = extractUndefinedSymbol(rawMessage);
  const friendly = missingSymbol
    ? `${input.sourceLabel} formula references missing symbol "${missingSymbol}". Configure that formula variable or change the pricing impact to a fixed flat fee.`
    : `${input.sourceLabel} formula is invalid: ${rawMessage}`;
  const err = new Error(`Formula error: ${friendly}`) as Error & {
    code: "PBV2_FORMULA_ERROR";
    details: Array<Record<string, unknown>>;
    debug: Record<string, unknown>;
  };
  err.code = "PBV2_FORMULA_ERROR";
  err.details = [{
    code: missingSymbol ? "PBV2_FORMULA_MISSING_VARIABLE" : "PBV2_FORMULA_INVALID",
    message: friendly,
    path: input.path,
    missingSymbol,
    nodeId: input.nodeId,
    optionLabel: input.optionLabel,
    choiceValue: input.choiceValue,
    choiceLabel: input.choiceLabel,
  }];
  err.debug = {
    formulaRaw: input.formula,
    variables: input.formulaScope,
    missingSymbol,
    sourceLabel: input.sourceLabel,
    path: input.path,
  };
  return err;
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

  // PBV2_DEBUG: Log evaluator entry point
  if (process.env.PBV2_DEBUG === "1") {
    console.log("[PBV2_EVAL_ENTRY] " + JSON.stringify({ 
      schemaVersion: tree.schemaVersion,
      nodeCount: Object.keys(tree.nodes || {}).length,
      selectionKeys: Object.keys(selections.selected || {})
    }));
  }

  // DEV: Log evaluation start with detailed context
  if (process.env.NODE_ENV === "development") {
    console.log(`[PBV2_EVAL_START] Schema version: ${tree.schemaVersion}`);
    console.log(`[PBV2_EVAL_START] Total nodes: ${Object.keys(tree.nodes).length}`);
    console.log(`[PBV2_EVAL_START] Selections count: ${Object.keys(selections.selected || {}).length}`);
    console.log(`[PBV2_EVAL_START] Selections:`, JSON.stringify(selections.selected, null, 2));
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
  const runtimeVisibility = resolveRuntimeVisibility(tree, selections);
  const visibleNodeIds = runtimeVisibility.visibleNodeIds;
  const selected = Object.fromEntries(
    Object.entries(runtimeVisibility.effectiveSelections).map(([selectionKey, value]) => [selectionKey, { value }])
  ) as Record<string, { value?: any }>;
  const treeFormulaVariables = {
    ...getNumericRecord((tree.meta as any)?.pricingFormulaVariables),
    ...getNumericRecord((tree.meta as any)?.formulaVariables),
    ...getNumericRecord(input.formulaVariables),
  };
  const formulaScope = buildFormulaEvaluationScope({
    scope: buildFormulaScope({
      formula: "",
      orderedWidthIn: widthIn,
      orderedHeightIn: heightIn,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: widthIn,
      finishedHeightIn: heightIn,
      quantity,
      baseRatePerSqft: basePrice,
      sqftPerItem,
      totalSqft: sqftPerItem * quantity,
      linearFeet: linearFootPerItem,
    }),
    formulaVariables: {
      ...treeFormulaVariables,
      ...buildNumericSelectionFormulaVariables({
        treeJson: tree,
        selections: runtimeVisibility.effectiveSelections,
      }),
    },
  });

  const evaluateFormulaImpactDollars = (
    formula: unknown,
    sourceLabel: string,
    context: {
      path?: string;
      nodeId?: string;
      optionLabel?: string;
      choiceValue?: string;
      choiceLabel?: string;
    } = {},
  ): number => {
    const formulaText = typeof formula === "string" ? formula.trim() : "";
    if (!formulaText) return 0;
    try {
      const result = Number(evaluate(formulaText, formulaScope as Record<string, any>));
      if (!Number.isFinite(result)) {
        throw new Error(`${sourceLabel} formula produced an invalid number`);
      }
      return result;
    } catch (error) {
      throw buildFormulaImpactError({
        error,
        sourceLabel,
        formula: formulaText,
        formulaScope: formulaScope as Record<string, unknown>,
        ...context,
      });
    }
  };

  // DEV: Log visible nodes for debugging
  if (process.env.NODE_ENV === "development") {
    console.log(`[PBV2_EVAL_START] Visible nodes count: ${visibleNodeIds.length}`);
    console.log(`[PBV2_EVAL_START] Visible node IDs:`, visibleNodeIds);
  }

  /**
   * Resolve selection value for a node, supporting multiple key formats.
   * Priority: selectionKey > key > opt_${id} > id (for backward compatibility)
   * Returns { valueRaw, matchedKey, candidateKeys } where matchedKey is the key that matched in selections.
   */
  function getSelectionValue(node: any, selected: Record<string, any>): { valueRaw: any; matchedKey: string | null; candidateKeys: string[] } {
    // Build candidate keys in priority order
    const candidateKeys: string[] = [];
    if (node.input?.selectionKey) candidateKeys.push(node.input.selectionKey);
    if (node.key) candidateKeys.push(node.key);
    // CRITICAL: Frontend may send "opt_opt_..." but node.id is "opt_..."
    if (node.id) candidateKeys.push(`opt_${node.id}`);
    if (node.id) candidateKeys.push(node.id);

    for (const key of candidateKeys) {
      if (selected[key] !== undefined) {
        // Support multiple selection shapes:
        // 1. { value: ... } (standard)
        // 2. primitive value (legacy)
        const entry = selected[key];
        const valueRaw = (entry && typeof entry === "object" && "value" in entry) 
          ? entry.value 
          : entry;
        
        return { valueRaw, matchedKey: key, candidateKeys };
      }
    }

    return { valueRaw: undefined, matchedKey: null, candidateKeys };
  }

  let optionsCents = 0; // Running total in cents
  const selectedOptions: SelectedOptionsSnapshotEntry[] = [];
  const optionPriceContributions: OptionPriceContribution[] = [];

  for (let i = 0; i < visibleNodeIds.length; i++) {
    const nodeId = visibleNodeIds[i];
    const node = tree.nodes[nodeId];
    if (!node) continue;

    const { valueRaw, matchedKey, candidateKeys } = getSelectionValue(node, selected);

    // PBV2_DEBUG: Log every node we're iterating (confirms loop runs)
    if (process.env.PBV2_DEBUG === "1") {
      const isQuestionOrSelect = (node.kind === "question" || (node as any).type === "INPUT") && node.input?.type === "select";
      console.log("[PBV2_NODE_ITER] " + JSON.stringify({
        nodeId,
        nodeKey: (node as any).key,
        nodeKind: node.kind,
        nodeLabel: node.label,
        inputType: node.input?.type,
        inputSelectionKey: node.input?.selectionKey,
        candidateKeys: isQuestionOrSelect ? candidateKeys : undefined,
        selectionKeysPresent: isQuestionOrSelect ? Object.keys(selected).slice(0, 10) : undefined,
        matchedKey: matchedKey,
        valueRaw: valueRaw,
        hasChoices: Array.isArray(node.choices),
        choicesCount: node.choices?.length || 0
      }));
    }

    const isSelected = (() => {
      if (valueRaw === null || valueRaw === undefined) return false;
      // Support both new schema (kind="question") and legacy (type="INPUT")
      const isQuestionNode = node.kind === "question" || (node as any).type === "INPUT";
      if (!isQuestionNode) return false;
      const inputType = node.input?.type;
      if (inputType === "boolean") return valueRaw === true;
      if (inputType === "select") return typeof valueRaw === "string" && valueRaw.trim().length > 0;
      return true;
    })();

    // PBV2_DEBUG: Log isSelected result with matched key
    if (process.env.PBV2_DEBUG === "1") {
      const isQuestionNode = node.kind === "question" || (node as any).type === "INPUT";
      console.log("[PBV2_NODE_SELECT] " + JSON.stringify({
        nodeId,
        isQuestionNode,
        isSelected,
        matchedKey,
        inputType: node.input?.type,
        valueRaw,
        valueType: typeof valueRaw,
        reason: !isSelected ? (valueRaw === null || valueRaw === undefined ? "noValue" : !isQuestionNode ? "notQuestion" : "otherCheck") : "selected"
      }));
    }

    // DEV: Log per-node processing for INPUT/question nodes
    if (process.env.NODE_ENV === "development") {
      const isInputNode = node.kind === "question" || (node as any).type === "INPUT";
      if (isInputNode) {
        console.log(`[PBV2_NODE_PROCESS] Node: ${nodeId} (${node.label})`);
        console.log(`[PBV2_NODE_PROCESS]   - kind: ${node.kind}, type: ${(node as any).type}`);
        console.log(`[PBV2_NODE_PROCESS]   - input.selectionKey: ${node.input?.selectionKey}`);
        console.log(`[PBV2_NODE_PROCESS]   - node.key: ${(node as any).key}`);
        console.log(`[PBV2_NODE_PROCESS]   - isSelected: ${isSelected}`);
        console.log(`[PBV2_NODE_PROCESS]   - valueRaw: ${JSON.stringify(valueRaw)}`);
      }
    }

    let nodeCost = 0;
    let choiceCentsApplied = 0;
    let selectedChoice: { value: string; label: string } | null = null;

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
        case "addPerSqft":
          nodeCost += ((impact.amountCents ?? 0) / 100) * sqftPerItem * quantity;
          break;
        case "addFormula":
          nodeCost += evaluateFormulaImpactDollars(impact.formula, `Option "${node.label || nodeId}"`, {
            path: `nodes.${nodeId}.pricingImpact.${j}.formula`,
            nodeId,
            optionLabel: node.label || nodeId,
          });
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
      
      // PBV2_DEBUG: Log entry into choice processing
      if (process.env.PBV2_DEBUG === "1") {
        console.log("[PBV2_CHOICE_ENTRY] " + JSON.stringify({
          nodeId,
          selectedValue,
          choicesCount: node.choices.length,
          choiceValues: node.choices.map(c => c.value)
        }));
      }
      
      const choice = node.choices.find((c) => c.value === selectedValue);
      selectedChoice = choice ? { value: choice.value, label: choice.label } : null;
      
      // PBV2_DEBUG: Log choice match result
      if (process.env.PBV2_DEBUG === "1") {
        console.log("[PBV2_CHOICE_MATCH] " + JSON.stringify({
          nodeId,
          selectedValue,
          choiceFound: !!choice,
          choiceLabel: choice?.label,
          hasPricingImpact: choice ? Array.isArray(choice.pricingImpact) : false,
          impactCount: choice?.pricingImpact?.length || 0
        }));
      }
      
      // DEV: Log choice selection and pricing impact status
      if (process.env.NODE_ENV === "development") {
        console.log(`[PBV2_CHOICE_DEBUG] Node: ${nodeId} (${node.label}), Selected value: "${selectedValue}", Choice found: ${!!choice}`);
        if (choice) {
          console.log(`[PBV2_CHOICE_DEBUG] Choice "${choice.label}", hasPricingImpact: ${Array.isArray(choice.pricingImpact)}, impacts count: ${choice.pricingImpact?.length ?? 0}`);
          if (choice.pricingImpact) {
            console.log(`[PBV2_CHOICE_DEBUG] Pricing impacts:`, JSON.stringify(choice.pricingImpact, null, 2));
          } else {
            console.log(`[PBV2_CHOICE_DEBUG] No pricingImpact on choice "${choice.label}" (value: ${choice.value})`);
          }
        } else {
          console.log(`[PBV2_CHOICE_DEBUG] Available choice values:`, node.choices.map(c => c.value));
        }
      }
      
      if (choice && Array.isArray(choice.pricingImpact) && choice.pricingImpact.length > 0) {
        // Dev logging to verify choice-level pricing is working
        if (process.env.NODE_ENV === "development") {
          console.log(`[PBV2_CHOICE_PRICING] Processing choice pricing for node: ${node.label}, Choice: ${choice.label}, Impacts: ${choice.pricingImpact.length}`);
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
                choiceCentsApplied += cents;
                if (process.env.NODE_ENV === "development") {
                  console.log(`[PBV2_CHOICE_PRICING]   - addCents: ${cents}¢ applied (running total: ${optionsCents}¢)`);
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
                choiceCentsApplied += percentCents;
                
                if (process.env.NODE_ENV === "development") {
                  console.log(`[PBV2_CHOICE_PRICING]   - addPercent: ${percent}% of ${basisCents}¢ = ${percentCents}¢ applied (running total: ${optionsCents}¢)`);
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
                choiceCentsApplied += unitCents;
                
                if (process.env.NODE_ENV === "development") {
                  console.log(`[PBV2_CHOICE_PRICING]   - addPerUnit: ${centsPerUnit}¢/${unit} × ${unitAmount.toFixed(2)} = ${unitCents}¢ applied (running total: ${optionsCents}¢)`);
                }
              }
              break;
            }

            case "addFormula": {
              const formulaDollars = evaluateFormulaImpactDollars(
                impact.formula,
                `Option "${node.label || nodeId}" choice "${choice.label || selectedValue}"`,
                {
                  path: `nodes.${nodeId}.choices.${node.choices.indexOf(choice)}.pricingImpact.${k}.formula`,
                  nodeId,
                  optionLabel: node.label || nodeId,
                  choiceValue: selectedValue,
                  choiceLabel: choice.label || selectedValue,
                },
              );
              const formulaCents = Math.round(formulaDollars * 100);
              optionsCents += formulaCents;
              choiceCentsApplied += formulaCents;
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

            case "addPerSqft": {
              const cents = Number(impact.amountCents ?? 0);
              if (Number.isFinite(cents)) {
                nodeCost += (cents / 100) * sqftPerItem * quantity; // Convert to dollars for legacy flow
              }
              break;
            }
          }
        }
        
        // DEV: Log total cents applied from this choice
        if (process.env.NODE_ENV === "development" && choiceCentsApplied !== 0) {
          console.log(`[PBV2_CHOICE_PRICING]   - Total choice impact: ${choiceCentsApplied}¢`);
        }

        // PBV2_DEBUG: Log per-node choice pricing application
        if (process.env.PBV2_DEBUG === "1") {
          console.log("[PBV2_EVAL_NODE] " + JSON.stringify({
            nodeId,
            nodeKey: (node as any).key,
            selectionKey: node.input?.selectionKey,
            selectedValue,
            choiceFound: true,
            choiceValue: choice.value,
            impactCount: choice.pricingImpact?.length || 0,
            deltaCentsApplied: choiceCentsApplied,
            runningOptionsCents: optionsCents
          }));
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
    const nodeCostCents = Math.round(nodeCost * 100);
    const contributionCents = choiceCentsApplied + nodeCostCents;
    if (isSelected) {
      optionPriceContributions.push({
        optionId: nodeId,
        selectionKey: matchedKey ?? node.input?.selectionKey ?? node.key,
        optionLabel: node.label || nodeId,
        ...(selectedChoice ? { choiceValue: selectedChoice.value, choiceLabel: selectedChoice.label } : {}),
        amountCents: contributionCents,
      });
    }
    optionsCents += nodeCostCents;
  }

  // DEV: Log final pricing summary
  if (process.env.NODE_ENV === "development") {
    console.log(`[PBV2_EVAL_OPTIONS_SUM] Final optionsCents: ${optionsCents}`);
    console.log(`[PBV2_EVAL_OPTIONS_SUM] selectedOptions length: ${selectedOptions.length}`);
    console.log(`[PBV2_EVAL_OPTIONS_SUM] selectedOptions:`, JSON.stringify(selectedOptions, null, 2));
  }

  // PBV2_DEBUG: Log evaluation summary
  if (process.env.PBV2_DEBUG === "1") {
    console.log("[PBV2_EVAL_SUMMARY] " + JSON.stringify({ 
      finalOptionsCents: optionsCents, 
      selectedOptionsLen: selectedOptions.length 
    }));
  }

  if (!Number.isFinite(optionsCents)) {
    throw new Error("OptionTreeV2 evaluation produced invalid optionsCents");
  }

  const optionsPrice = optionsCents / 100; // Convert back to dollars for result

  return { optionsPrice, selectedOptions, optionPriceContributions, visibleNodeIds };
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

  const runtimeVisibility = resolveRuntimeVisibility(tree, selections);
  const visibleNodeIds = runtimeVisibility.visibleNodeIds;
  const selected = Object.fromEntries(
    Object.entries(runtimeVisibility.effectiveSelections).map(([selectionKey, value]) => [selectionKey, { value }])
  ) as Record<string, { value?: any }>;

  // 2) Node weightImpact rules and choice-level weightOz
  for (let i = 0; i < visibleNodeIds.length; i++) {
    const nodeId = visibleNodeIds[i];
    const node = tree.nodes[nodeId];
    if (!node) continue;

    const selectionEntry = selected[nodeId];
    const valueRaw = selectionEntry ? selectionEntry.value : undefined;

    const isSelected = (() => {
      if (valueRaw === null || valueRaw === undefined) return false;
      // Support both new schema (kind="question") and legacy (type="INPUT")
      const isQuestionNode = node.kind === "question" || (node as any).type === "INPUT";
      if (!isQuestionNode) return false;
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
