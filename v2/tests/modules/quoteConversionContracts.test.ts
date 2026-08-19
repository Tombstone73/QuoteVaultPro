import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { capabilityIds } from "../../src/authorization/capabilities";

describe("M1.10 Quote to Order conversion contract", () => {
  test("uses the explicit conversion capability rather than order-create authority", () => {
    expect(capabilityIds).toContain("quote.convert");
  });

  test("conversion starts from an accepted checkpoint and never recalculates pricing", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    expect(source).toMatch(/source\.kind !== "quote_accepted"/);
    expect(source).toMatch(/cloneLines\(source\.commercial\.lines\)/);
    expect(source).toMatch(/createFromCommercialSnapshot/);
    expect(source).not.toMatch(/\.pricing\.calculate\(/);
    expect(source).not.toMatch(/resolveActivePricingInput/);
  });

  test("the canonical Order core is shared and does not reserve an operation request", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "orderApplication.ts"), "utf8");
    const core = source.slice(source.indexOf("async createFromCommercialSnapshot"), source.indexOf("async read(", source.indexOf("async createFromCommercialSnapshot")));
    expect(core).toMatch(/materialRequirements\.freeze/);
    expect(core.indexOf("materialRequirements.freeze")).toBeLessThan(core.indexOf("createDraftInvoice"));
    expect(core).toMatch(/createDraftInvoice/);
    expect(core).toMatch(/instantiateRoutes/);
    expect(core).toMatch(/resolveCurrentRoutingProduct/);
    expect(core).not.toMatch(/\.reserve\(/);
    expect(core).not.toMatch(/\.pricing\.calculate\(/);
  });

  test("conversion has one same-client orchestration boundary and no V1 or HTTP dependency", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteConversionTransaction.ts"), "utf8");
    expect(source).not.toMatch(/express|server\/|v2-poc|PricingService/);
    expect(transaction).toMatch(/BEGIN/);
    expect(transaction).toMatch(/PostgresQuoteTransaction/);
    expect(transaction).toMatch(/PostgresOrderTransaction/);
  });

  test("freezes expected material requirements inside the same PostgreSQL conversion boundary", async () => {
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderTransaction.ts"), "utf8");
    const requirements = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderMaterialRequirements.ts"), "utf8");
    expect(transaction).toMatch(/afterMaterialRequirements/);
    expect(requirements).toMatch(/v2_order_line_material_requirements/);
    expect(requirements).toMatch(/ON CONFLICT\(organization_id,order_line_id,source_definition_id\) DO NOTHING/);
    expect(requirements).toMatch(/resolvedConfiguration\.pricingConfigurationId/);
    expect(requirements).toMatch(/inventoryConsumption/);
  });
});
