import type { V2UnitOfWork } from "../infrastructure/inMemoryV2Database";
import { V2PocError } from "../shared/errors";
import type { ProductPricingConfiguration } from "../shared/model";

/** Schema-compatibility read seam: product plus active PBV2 tree is scoped before pricing. */
export async function getProductPricingConfiguration(unitOfWork: V2UnitOfWork, organizationId: string, productId: string): Promise<ProductPricingConfiguration> {
  const product = unitOfWork.state.products.find((entry) => entry.id === productId && entry.organizationId === organizationId);
  if (!product) throw new V2PocError("NOT_FOUND", "Product pricing configuration not found.");
  return structuredClone(product);
}
