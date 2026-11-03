import { describe, expect, test } from "@jest/globals";
import { describeProductionMachineConfiguration, getProductionMachineOptions } from "../productionMachineOptions";
import { materialDimensionConfiguration } from "../materialConfigurationReadiness";

describe("production machine configuration", () => {
  test("explicit tenant labels replace legacy suggestions without mutating the input", () => {
    const configured = [" Canon Colorado M5W ", "Epson S60600", "canon colorado m5w"];
    expect(getProductionMachineOptions("roll", configured)).toEqual(["Canon Colorado M5W", "Epson S60600"]);
    expect(configured[0]).toBe(" Canon Colorado M5W ");
    expect(getProductionMachineOptions("flatbed", ["Digitech ST"])).toEqual(["Digitech ST"]);
  });
  test("an explicitly empty list stays empty", () => {
    expect(getProductionMachineOptions("flatbed", [])).toEqual([]);
  });
  test("legacy defaults are preserved only when no list is supplied", () => {
    expect(getProductionMachineOptions("wide_roll")).toEqual(["S40", "S60", "Canon"]);
    expect(getProductionMachineOptions("flatbed")).toEqual(["Jetson"]);
    expect(getProductionMachineOptions("finishing")).toEqual([]);
  });
  test("diagnostics distinguish saved names, empty configuration, and unverified defaults", () => {
    const rows = describeProductionMachineConfiguration({ roll: ["M5W"], flatbed: [], finishing: ["Kongsberg XL24"] });
    expect(rows[0]).toMatchObject({ source: "configured", machines: ["M5W"] });
    expect(rows[1]).toMatchObject({ source: "configured", machines: [], issues: [expect.stringContaining("Existing job assignments are retained")] });
    expect(rows[2]).toMatchObject({ source: "configured", machines: ["Kongsberg XL24"] });
    expect(describeProductionMachineConfiguration(undefined).every(row => row.source === "legacy_default")).toBe(true);
  });
  test("malformed data is flagged rather than represented as verified equipment", () => {
    expect(describeProductionMachineConfiguration("invalid").every(row => row.source === "invalid")).toBe(true);
    expect(describeProductionMachineConfiguration({ roll: [12, null] })[0].source).toBe("invalid");
    expect(getProductionMachineOptions("roll", [12, null, "", "Verified label"])).toEqual(["Verified label"]);
  });
  test("legacy station aliases and duplicate saved names require review without rewriting them", () => {
    const raw = { wide_roll: ["Canon"], flatbed: ["ST", "st"] };
    const rows = describeProductionMachineConfiguration(raw);
    expect(rows.find(row => row.stationKey === "wide_roll")?.issues).toEqual([expect.stringContaining("canonical 'roll'")]);
    expect(rows.find(row => row.stationKey === "flatbed")?.issues).toEqual([expect.stringContaining("Duplicate")]);
    expect(raw).toEqual({ wide_roll: ["Canon"], flatbed: ["ST", "st"] });
  });
});

describe("media dimension completeness, independent of machine compatibility", () => {
  test("roll and rigid media use their own recorded dimensions", () => {
    expect(materialDimensionConfiguration({ type: "roll", width: "54" }).issues).toEqual([]);
    expect(materialDimensionConfiguration({ type: "sheet", width: "48", height: "96" }).issues).toEqual([]);
    expect(materialDimensionConfiguration({ type: "sheet", materialForm: "roll", width: "54" }).form).toBe("roll");
  });
  test.each([undefined, null, "", "0", "-5", "NaN", "Infinity"])("missing/invalid media width %s is reported", width => {
    expect(materialDimensionConfiguration({ type: "roll", width }).issues).toContain("Positive media width is missing");
  });
  test("rigid height and impossible roll edge waste are visible issues", () => {
    expect(materialDimensionConfiguration({ type: "sheet", width: "48" }).issues).toEqual(["Positive sheet height is missing"]);
    expect(materialDimensionConfiguration({ type: "roll", width: "54", edgeWasteInPerSide: "27" }).issues).toContain("Edge waste leaves no valid printable width");
    expect(materialDimensionConfiguration({ type: "roll", width: "54", edgeWasteInPerSide: "0.25" }).issues).toEqual([]);
  });
  test("ink and consumables do not acquire artificial media dimension requirements", () => {
    expect(materialDimensionConfiguration({ type: "ink", materialForm: "liquid" }).issues).toEqual([]);
    expect(materialDimensionConfiguration({ type: "consumable", materialForm: "each" }).issues).toEqual([]);
  });
});
