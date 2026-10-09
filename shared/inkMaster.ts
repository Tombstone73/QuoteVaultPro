import { z } from "zod";

export const INK_COLORS = ["cyan", "magenta", "yellow", "black", "white"] as const;
export type InkColor = typeof INK_COLORS[number];
export type InkQuantities = Record<InkColor, number>;
export type PrintSides = "single" | "double";

const finiteNonnegative = z.number().finite().min(0).max(1_000_000);
export const inkQuantitiesSchema = z.object({
  cyan: finiteNonnegative,
  magenta: finiteNonnegative,
  yellow: finiteNonnegative,
  black: finiteNonnegative,
  white: finiteNonnegative,
}).strict();

export const inkMasterPrinterInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  containerSizeLiters: z.number().finite().min(0.000001).max(1_000_000),
  containerPriceCents: z.number().int().min(0).max(100_000_000).nullable(),
  restockTargetLiters: finiteNonnegative,
}).strict();

export const inkMasterSpecInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  printerId: z.string().min(1),
  printSides: z.enum(["single", "double"]),
  usageMlPerSheetSide: inkQuantitiesSchema,
}).strict();

export type InkMasterPrinterInput = z.infer<typeof inkMasterPrinterInputSchema>;
export type InkMasterSpecInput = z.infer<typeof inkMasterSpecInputSchema>;

export type InkMasterPrinter = InkMasterPrinterInput & {
  id: string;
  organizationId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InkMasterSavedSpec = InkMasterSpecInput & {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type InkMasterDraft = {
  printerId: string;
  printSides: PrintSides;
  sheetCount: number;
  usageMlPerSheetSide: InkQuantities;
  currentInventoryLiters: InkQuantities;
};

export type InkColorResult = {
  color: InkColor;
  usageMl: number;
  usageLiters: number;
  currentInventoryLiters: number;
  afterJobLiters: number;
  requiredLiters: number;
  containersToOrder: number;
  purchaseLiters: number;
  estimatedCostCents: number | null;
};

export function emptyInkQuantities(): InkQuantities {
  return { cyan: 0, magenta: 0, yellow: 0, black: 0, white: 0 };
}

export function calculateInkJob(draft: InkMasterDraft, printer: InkMasterPrinterInput) {
  if (!Number.isSafeInteger(draft.sheetCount) || draft.sheetCount < 0) throw new Error("Sheet count must be a nonnegative integer");
  inkQuantitiesSchema.parse(draft.usageMlPerSheetSide);
  inkQuantitiesSchema.parse(draft.currentInventoryLiters);
  inkMasterPrinterInputSchema.parse(printer);
  const sides = draft.printSides === "double" ? 2 : draft.printSides === "single" ? 1 : 0;
  if (!sides) throw new Error("Print sides must be single or double");

  const colors: InkColorResult[] = INK_COLORS.map((color) => {
    const usageMl = draft.sheetCount * sides * draft.usageMlPerSheetSide[color];
    if (!Number.isFinite(usageMl)) throw new Error("Ink usage is too large");
    const usageLiters = usageMl / 1000;
    const currentInventoryLiters = draft.currentInventoryLiters[color];
    const afterJobLiters = currentInventoryLiters - usageLiters;
    const requiredLiters = Math.max(0, printer.restockTargetLiters - afterJobLiters);
    const quotient = requiredLiters / printer.containerSizeLiters;
    const nearestWhole = Math.round(quotient);
    // Ignore only machine precision around a whole-container boundary.
    const atBoundary = Math.abs(quotient - nearestWhole) <= Number.EPSILON * Math.max(1, quotient) * 8;
    const containersToOrder = requiredLiters === 0 ? 0 : Math.max(1, Math.ceil(atBoundary ? nearestWhole : quotient));
    const purchaseLiters = containersToOrder * printer.containerSizeLiters;
    const estimatedCostCents = printer.containerPriceCents === null
      ? null
      : containersToOrder * printer.containerPriceCents;
    if (!Number.isSafeInteger(containersToOrder) || (estimatedCostCents !== null && !Number.isSafeInteger(estimatedCostCents))) {
      throw new Error("Ink purchase quantity is too large");
    }
    return { color, usageMl, usageLiters, currentInventoryLiters, afterJobLiters, requiredLiters, containersToOrder, purchaseLiters, estimatedCostCents };
  });

  return {
    colors,
    totalContainersToOrder: colors.reduce((sum, color) => sum + color.containersToOrder, 0),
    totalEstimatedCostCents: printer.containerPriceCents === null
      ? null
      : colors.reduce((sum, color) => sum + (color.estimatedCostCents ?? 0), 0),
  };
}

export function specFromDraft(name: string, draft: InkMasterDraft): InkMasterSpecInput {
  return inkMasterSpecInputSchema.parse({
    name,
    printerId: draft.printerId,
    printSides: draft.printSides,
    usageMlPerSheetSide: { ...draft.usageMlPerSheetSide },
  });
}

export function loadSpecIntoDraft(draft: InkMasterDraft, spec: InkMasterSpecInput): InkMasterDraft {
  return {
    ...draft,
    printerId: spec.printerId,
    printSides: spec.printSides,
    usageMlPerSheetSide: { ...spec.usageMlPerSheetSide },
  };
}

export function selectPrinterInDraft(draft: InkMasterDraft, printerId: string): InkMasterDraft {
  return { ...draft, printerId };
}
