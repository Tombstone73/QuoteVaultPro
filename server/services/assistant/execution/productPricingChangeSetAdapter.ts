import { productPricingCanonicalService, productPricingChangeSetStore } from "../productPricingChangeSetDb";
import { ProductPricingChangeSetService } from "../productPricingChangeSetService";
import type { ProductPricingChangeSetCommandService } from "./productPricingChangeSetCommand";

const service = new ProductPricingChangeSetService(productPricingCanonicalService, productPricingChangeSetStore);

export const productPricingChangeSetCommandService: ProductPricingChangeSetCommandService = {
  execute: (input) => service.execute({ organizationId: input.organizationId, actorUserId: input.actorUserId, changeSetId: input.changeSetId, fingerprint: input.fingerprint, planId: input.planId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId }),
  rollback: (input) => service.rollback(input),
};

export { service as productPricingChangeSetService };
