import type { PoolClient } from "pg";
import type { PricingPort } from "../../src/modules/pricing/contracts.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { CustomerCommercialPricingAdapter, type CustomerScopedPricingPort } from "../../src/modules/products/customerCommercial.js";
import { PostgresCustomerCommercialStore } from "./postgresCustomerCommercialStore.js";

/** Owner-controlled read facade; callers cannot obtain agreement/entitlement
 * authoring methods or a foreign repository from this operation. */
export const createCustomerCommercialPricingPort = (client: PoolClient, pricing: PricingPort = new V2PricingParityAdapter()): CustomerScopedPricingPort =>
  new CustomerCommercialPricingAdapter(pricing, new PostgresCustomerCommercialStore(client));
