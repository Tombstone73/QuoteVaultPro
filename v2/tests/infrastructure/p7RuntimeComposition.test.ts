import { describe, expect, test } from "@jest/globals";
import type { Pool } from "pg";
import { composeAuthenticatedQuoteRuntime } from "../../infrastructure/sales/authenticatedQuoteRuntime";
import { composeAuthenticatedProductionRuntime } from "../../infrastructure/production/authenticatedProductionRuntime";
import { ProductRecipeApplicationService } from "../../src/modules/products/productRecipes";
import { ProductPublicationApplicationService } from "../../src/modules/products/productPublication";
import { ProductionMaterialConsumptionApplicationService } from "../../src/modules/production/materialConsumption";
import { InventoryLedgerApplicationService } from "../../src/modules/inventory/inventoryLedger";

const runtimeInput = {
  pool: {} as Pool,
  trustedHostIdentity: { authenticatedIdentity: async () => null },
  trustedHostMiddleware: (
    _request: unknown,
    _response: unknown,
    next: () => void,
  ) => next(),
};

describe("P7 authenticated runtime composition", () => {
  test("constructs recipe services in the Product runtime instead of relying on rehearsal wiring", () => {
    const runtime = composeAuthenticatedQuoteRuntime(runtimeInput);

    expect(runtime.productDependencies.recipes).toBeInstanceOf(
      ProductRecipeApplicationService,
    );
    expect(runtime.productDependencies.publication).toBeInstanceOf(
      ProductPublicationApplicationService,
    );
    expect(runtime.productDependencies.draftRecipe).toBeDefined();
    expect(runtime.productDependencies.materials).toBeDefined();
  });

  test("constructs consumption and inventory services in the Production runtime", () => {
    const runtime = composeAuthenticatedProductionRuntime(runtimeInput);

    expect(runtime.dependencies.consumption).toBeInstanceOf(
      ProductionMaterialConsumptionApplicationService,
    );
    expect(runtime.dependencies.inventory).toBeInstanceOf(
      InventoryLedgerApplicationService,
    );
  });
});
