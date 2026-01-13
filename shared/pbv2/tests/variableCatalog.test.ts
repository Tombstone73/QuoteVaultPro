import { describe, test, expect } from "@jest/globals";
import { buildSymbolTable } from "../symbolTable";
import { buildVariableCatalog, getBaseEnvVariableCatalog } from "../variableCatalog";
import { createPbv2BannerGrommetsPricingTreeJson } from "../starterTree";

describe("pbv2/variableCatalog", () => {
  test("includes canonical base env vars", () => {
    const base = getBaseEnvVariableCatalog();
    const keys = base.map((v) => v.key);
    expect(keys).toContain("env.widthIn");
    expect(keys).toContain("env.heightIn");
    expect(keys).toContain("env.quantity");
    expect(keys).toContain("env.sqft");
    expect(keys).toContain("env.perimeterIn");
  });

  test("includes selection vars and computed outputs", () => {
    const tree = createPbv2BannerGrommetsPricingTreeJson();
    const { table } = buildSymbolTable(tree);
    const catalog = buildVariableCatalog(tree, table);

    const keys = new Set(catalog.map((v) => v.key));

    // Selections
    expect(keys.has("sel.grommetsEnabled")).toBe(true);
    expect(keys.has("eff.grommetsEnabled")).toBe(true);
    expect(keys.has("sel.grommetSpacingIn")).toBe(true);
    expect(keys.has("eff.grommetSpacingIn")).toBe(true);

    // Computed outputs (by node key when present)
    expect(
      Array.from(keys).some((k) => k.startsWith("computed.") && k.includes("finishing.grommets.overageCount"))
    ).toBe(true);
  });
});
