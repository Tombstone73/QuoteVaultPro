import { calculateSheetYield } from "../../../../shared/pbv2/formulaHelpers.js";
import type { NestingEstimateEvidence } from "./contracts.js";

/**
 * Narrow M1.2 calculation seam only. It adapts the reviewed, persistence-free
 * V1 sheet-yield helper into immutable evidence; it neither creates a nest plan
 * nor knows about Production, Inventory, or Routing.
 */
export const estimatePricingSheetUsage = (input: Readonly<{
  pieceWidthIn: number;
  pieceHeightIn: number;
  quantity: number;
  sheetWidthIn: number;
  sheetLengthIn: number;
  usableDropMinimumIn: number;
  billableLengthIncrementIn: number;
  minimumBillableSqft: number;
  allowRotation?: boolean;
  /** The Product/PBV2 boundary that supplied the resolved policy. */
  allowRotationSource?: string;
}>): NestingEstimateEvidence => {
  const result = calculateSheetYield(
    input.pieceWidthIn,
    input.pieceHeightIn,
    input.quantity,
    input.sheetWidthIn,
    input.sheetLengthIn,
    input.usableDropMinimumIn,
    input.billableLengthIncrementIn,
    input.minimumBillableSqft,
    input.allowRotation ?? false,
    input.allowRotationSource ?? "pricing-request",
  );
  return {
    estimateId: `sheet-yield:${input.pieceWidthIn}x${input.pieceHeightIn}:${input.quantity}:${input.sheetWidthIn}x${input.sheetLengthIn}:${input.allowRotation ? "rotated" : "normal"}`,
    calculatorVersion: "v1-calculateSheetYield-adapter-1",
    facts: JSON.parse(JSON.stringify(result)) as NestingEstimateEvidence["facts"],
  };
};
