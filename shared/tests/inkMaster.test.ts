import { describe, expect, test } from "@jest/globals";
import {
  calculateInkJob,
  emptyInkQuantities,
  loadSpecIntoDraft,
  selectPrinterInDraft,
  specFromDraft,
  type InkMasterDraft,
  type InkMasterPrinterInput,
} from "../inkMaster";

const printer: InkMasterPrinterInput = {
  name: "Test printer",
  containerSizeLiters: 1,
  containerPriceCents: 13000,
  restockTargetLiters: 2,
};

function draft(overrides: Partial<InkMasterDraft> = {}): InkMasterDraft {
  return {
    printerId: "printer-a",
    printSides: "single",
    sheetCount: 100,
    usageMlPerSheetSide: emptyInkQuantities(),
    currentInventoryLiters: { cyan: 2, magenta: 2, yellow: 2, black: 2, white: 2 },
    ...overrides,
  };
}

describe("Ink Master calculation", () => {
  test("single and double sided consumption convert from mL to L", () => {
    const job = draft({ usageMlPerSheetSide: { ...emptyInkQuantities(), cyan: 2.5 } });
    expect(calculateInkJob(job, printer).colors[0].usageMl).toBe(250);
    expect(calculateInkJob(job, printer).colors[0].usageLiters).toBe(0.25);
    const double = calculateInkJob({ ...job, printSides: "double" }, printer).colors[0];
    expect(double.usageMl).toBe(500);
    expect(double.usageLiters).toBe(0.5);
  });

  test("zero sheets or zero color usage consume no ink", () => {
    const job = draft({ sheetCount: 0, usageMlPerSheetSide: { ...emptyInkQuantities(), cyan: 8 } });
    expect(calculateInkJob(job, printer).colors[0].usageMl).toBe(0);
    expect(calculateInkJob(draft(), printer).colors.every((item) => item.usageLiters === 0)).toBe(true);
  });

  test("fractional inventory and post-job target determine whole containers", () => {
    const job = draft({
      sheetCount: 1000,
      usageMlPerSheetSide: { ...emptyInkQuantities(), cyan: 2.5 },
      currentInventoryLiters: { ...emptyInkQuantities(), cyan: 1, magenta: 1.75 },
    });
    const result = calculateInkJob(job, printer);
    const cyan = result.colors[0];
    expect(cyan.afterJobLiters).toBe(-1.5);
    expect(cyan.requiredLiters).toBe(3.5);
    expect(cyan.containersToOrder).toBe(4);
    expect(cyan.purchaseLiters).toBe(4);
    expect(cyan.estimatedCostCents).toBe(52000);
    expect(cyan.afterJobLiters + cyan.purchaseLiters).toBeGreaterThanOrEqual(printer.restockTargetLiters);
    expect(result.colors[1].afterJobLiters).toBe(1.75);
  });

  test("already sufficient post-job inventory needs no purchase", () => {
    const color = calculateInkJob(draft({ currentInventoryLiters: { ...emptyInkQuantities(), cyan: 3 } }), printer).colors[0];
    expect(color.requiredLiters).toBe(0);
    expect(color.containersToOrder).toBe(0);
  });

  test("unpriced containers retain quantities without inventing cost", () => {
    const result = calculateInkJob(draft({ currentInventoryLiters: emptyInkQuantities() }), { ...printer, containerPriceCents: null });
    expect(result.colors[0].containersToOrder).toBe(2);
    expect(result.colors[0].estimatedCostCents).toBeNull();
    expect(result.totalEstimatedCostCents).toBeNull();
  });

  test("fractional container boundaries do not over-order from floating point noise", () => {
    const result = calculateInkJob(draft({ currentInventoryLiters: emptyInkQuantities() }), {
      ...printer, containerSizeLiters: 0.1, restockTargetLiters: 0.3,
    });
    expect(result.colors[0].containersToOrder).toBe(3);
  });

  test("any positive shortage still orders a container", () => {
    const result = calculateInkJob(draft({ currentInventoryLiters: emptyInkQuantities() }), {
      ...printer, containerSizeLiters: 1_000_000, restockTargetLiters: 0.000001,
    });
    expect(result.colors[0].containersToOrder).toBe(1);
  });
});

describe("Ink Master draft behavior", () => {
  test("saved specs exclude sheet count and manual inventory", () => {
    const job = draft({ usageMlPerSheetSide: { ...emptyInkQuantities(), white: 1.25 } });
    expect(specFromDraft("Signs", job)).toEqual({
      name: "Signs", printerId: "printer-a", printSides: "single", usageMlPerSheetSide: job.usageMlPerSheetSide,
    });
  });

  test("loading a spec keeps sheet count and inventory", () => {
    const job = draft({ sheetCount: 25 });
    const next = loadSpecIntoDraft(job, {
      name: "Banners", printerId: "printer-b", printSides: "double",
      usageMlPerSheetSide: { ...emptyInkQuantities(), yellow: 3 },
    });
    expect(next.printerId).toBe("printer-b");
    expect(next.printSides).toBe("double");
    expect(next.usageMlPerSheetSide.yellow).toBe(3);
    expect(next.sheetCount).toBe(25);
    expect(next.currentInventoryLiters).toEqual(job.currentInventoryLiters);
  });

  test("switching printer keeps usage and inventory", () => {
    const job = draft({ usageMlPerSheetSide: { ...emptyInkQuantities(), black: 4 } });
    const next = selectPrinterInDraft(job, "printer-c");
    expect(next.printerId).toBe("printer-c");
    expect(next.usageMlPerSheetSide).toEqual(job.usageMlPerSheetSide);
    expect(next.currentInventoryLiters).toEqual(job.currentInventoryLiters);
  });
});
