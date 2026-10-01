import type { PoolClient } from "pg";
import type { CustomersReadPort } from "../../src/modules/customers/contracts.js";
import type { ProductPricingCompatibilityPort } from "../../src/modules/products/contracts.js";
import { PostgresCustomersCompatibilityReader } from "./postgresCustomersRead.js";
import { PostgresProductsCompatibilityReader } from "./postgresProductsRead.js";

/** Bounded read-only compatibility seam for an already-authorized Sales draft. */
export function createSalesWorkspaceReadPorts(client: PoolClient): Readonly<{
  customers: Pick<CustomersReadPort, "validateContactReference" | "getContact">;
  products: Pick<ProductPricingCompatibilityPort, "resolveActivePricingInput">;
}> {
  return { customers: new PostgresCustomersCompatibilityReader(client), products: new PostgresProductsCompatibilityReader(client) };
}
