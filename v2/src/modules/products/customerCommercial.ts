import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, money, type CurrencyCode, type CustomerId, type OrganizationId, type ProductId } from "../shared/commercialValues.js";
import { assertPricingResultEvidence, type PricingCalculationRequest, type PricingPort, type PricingResult } from "../pricing/contracts.js";

/**
 * Customer commercial policy is deliberately separate from ProductVersion.
 * ProductVersions remain immutable product definitions; these agreements only
 * select what a scoped customer may buy and how an otherwise-calculated price
 * is commercially adjusted.  The resulting PricingResult is frozen by Sales.
 */
export type CustomerProductEntitlement = Readonly<{
  organizationId: OrganizationId;
  customerId: CustomerId;
  productId: ProductId;
  enabled: boolean;
  updatedAt: string;
}>;

export type CustomerPricingAgreement = Readonly<{
  id: string;
  organizationId: OrganizationId;
  customerId: CustomerId;
  productId: ProductId;
  /** A version-specific agreement wins over a product-wide agreement. */
  productVersionId?: string;
  currency: CurrencyCode;
  mode: "fixed_unit" | "percent_adjustment";
  /** Whole cents for fixed_unit; signed basis points for percent_adjustment. */
  value: number;
  active: boolean;
  /** Agreements take effect immediately; this records that immutable start. */
  effectiveFrom: string;
  createdAt: string;
}>;

/** New agreements are immediate-only; their effective time is server-owned. */
export type ReplaceCustomerPricingAgreement = Omit<CustomerPricingAgreement, "id" | "createdAt" | "active" | "effectiveFrom">;

export type CustomerCommercialStore = Readonly<{
  isEntitled(organizationId: OrganizationId, customerId: CustomerId, productId: ProductId): Promise<boolean>;
  resolveAgreement(input: Readonly<{ organizationId: OrganizationId; customerId: CustomerId; productId: ProductId; productVersionId: string; effectiveAt: string }>): Promise<CustomerPricingAgreement | null>;
  setEntitlement(input: CustomerProductEntitlement, actor: CustomerCommercialActor): Promise<CustomerProductEntitlement>;
  replaceAgreement(input: ReplaceCustomerPricingAgreement, actor: CustomerCommercialActor): Promise<CustomerPricingAgreement>;
  listEntitlements(organizationId: OrganizationId, customerId: CustomerId): Promise<readonly CustomerProductEntitlement[]>;
}>;

export type CustomerCommercialActor = Readonly<{
  principalKind: "staff" | "delegated_ai" | "portal" | "service";
  principalSubject: string;
  staffActorUserId?: string;
  operationId: string;
}>;

const authority = (policy: AuthorityPolicy, context: OperationContext, capability: "product.edit" | "pricing.configure", customerId: CustomerId) => {
  requireOperationPrincipalScope(context);
  if (!policy.decide(context.principal, { capability, resource: { organizationId: context.organizationId, customerId } }).allowed)
    throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to change this customer commercial policy.");
};

const actor = (context: OperationContext): CustomerCommercialActor => ({
  principalKind: context.principal.kind,
  principalSubject: context.principal.kind === "staff" ? context.principal.userId : context.principal.kind === "portal" ? context.principal.subjectId : context.principal.kind === "delegated_ai" ? `${context.principal.staff.userId}:${context.principal.delegation.commandId}` : context.principal.clientId,
  ...(context.principal.kind === "staff" ? { staffActorUserId: context.principal.userId } : context.principal.kind === "delegated_ai" ? { staffActorUserId: context.principal.staff.userId } : {}),
  operationId: context.operationId,
});

const validAgreement = (input: ReplaceCustomerPricingAgreement): void => {
  if (!input.productId || !input.customerId || !input.organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "Customer, Product, and organization are required.");
  if (input.mode === "fixed_unit" && (!Number.isSafeInteger(input.value) || input.value < 0)) throw new V2ApplicationError("VALIDATION_ERROR", "A fixed customer unit price must be a non-negative whole-cent amount.");
  if (input.mode === "percent_adjustment" && (!Number.isSafeInteger(input.value) || input.value < -10_000)) throw new V2ApplicationError("VALIDATION_ERROR", "A customer percentage adjustment must be whole basis points and cannot reduce a price below zero.");
  // The replacement ledger has one active row per scope. Its effective time
  // is database-owned, so callers cannot backdate or schedule a price.
};

export class CustomerCommercialApplicationService {
  constructor(private readonly store: CustomerCommercialStore, private readonly policy: AuthorityPolicy) {}

  async setEntitlement(context: OperationContext, input: Readonly<{ customerId: CustomerId; productId: ProductId; enabled: boolean }>): Promise<CustomerProductEntitlement> {
    authority(this.policy, context, "product.edit", input.customerId);
    return this.store.setEntitlement({ organizationId: context.organizationId as OrganizationId, customerId: input.customerId, productId: input.productId, enabled: input.enabled, updatedAt: new Date().toISOString() }, actor(context));
  }

  async setPricingAgreement(context: OperationContext, input: Omit<ReplaceCustomerPricingAgreement, "organizationId">): Promise<CustomerPricingAgreement> {
    authority(this.policy, context, "pricing.configure", input.customerId);
    const candidate = { ...input, organizationId: context.organizationId as OrganizationId };
    validAgreement(candidate);
    return this.store.replaceAgreement(candidate, actor(context));
  }

  async catalogForCustomer(context: OperationContext, customerId: CustomerId): Promise<readonly CustomerProductEntitlement[]> {
    requireOperationPrincipalScope(context);
    if (!this.policy.decide(context.principal, { capability: "product.view", resource: { organizationId: context.organizationId, customerId } }).allowed)
      throw new V2ApplicationError("FORBIDDEN", "The principal cannot view this customer catalog.");
    return this.store.listEntitlements(context.organizationId as OrganizationId, customerId);
  }
}

export type CustomerScopedPricingPort = Readonly<{
  calculateForCustomer(customerId: CustomerId, request: PricingCalculationRequest): Promise<PricingResult>;
}>;

/**
 * Adapter used by portal and staff Order entry once the customer is known.
 * It has no client-side calculation path and never changes an existing Sales
 * line: agreement evidence is included in the frozen server PricingResult.
 */
export class CustomerCommercialPricingAdapter implements CustomerScopedPricingPort {
  constructor(private readonly base: PricingPort, private readonly store: CustomerCommercialStore) {}

  async calculateForCustomer(customerId: CustomerId, request: PricingCalculationRequest): Promise<PricingResult> {
    // Entitlements constrain the customer-facing catalog.  Staff, inbound,
    // and delegated AI are allowed to create a legitimate Order for a known
    // customer even when that Product is not portal-visible.
    if (request.pricingContext.channel === "portal" && !await this.store.isEntitled(request.organizationId, customerId, request.sellableProduct.productId))
      throw new V2ApplicationError("FORBIDDEN", "This Product is not available to the selected customer.");
    const base = await this.base.calculate(request);
    const agreement = await this.store.resolveAgreement({
      organizationId: request.organizationId,
      customerId,
      productId: request.sellableProduct.productId,
      productVersionId: request.resolvedConfiguration.pricingConfigurationId,
      effectiveAt: request.pricingContext.effectiveAt,
    });
    if (!agreement) return base;
    if (agreement.currency !== base.currency) throw new V2ApplicationError("CONFLICT", "The active customer pricing agreement currency does not match the Product price.");
    const amount = agreement.mode === "fixed_unit"
      ? agreement.value * request.resolvedConfiguration.quantity
      : Math.round(base.calculatedLineAmount.cents * (10_000 + agreement.value) / 10_000);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new V2ApplicationError("CONFLICT", "The customer pricing agreement produces an invalid price.");
    const adjustment = amount - base.calculatedLineAmount.cents;
    const evidence = {
      agreementId: agreement.id, mode: agreement.mode, value: agreement.value,
      ...(agreement.productVersionId ? { productVersionId: agreement.productVersionId } : {}),
    };
    const next = {
      ...base,
      id: `customer:${createHash("sha256").update(canonicalJson({ base: base.id, customerId, evidence })).digest("hex")}` as PricingResult["id"],
      calculatedUnitAmount: money(base.currency, Math.round(amount / request.resolvedConfiguration.quantity)),
      calculatedLineAmount: money(base.currency, amount),
      unitAmountEvidence: { exactUnitCents: String(amount / request.resolvedConfiguration.quantity) as never, allocation: "rounded_line_total_divided_by_quantity" as const },
      components: [...base.components, { kind: "customer_agreement" as const, label: "Customer pricing agreement", amount: money(base.currency, adjustment) }],
      customerPricing: evidence,
    };
    const evidenceFingerprint = `sha256:${createHash("sha256").update(canonicalJson({ baseEvidenceFingerprint: base.evidenceFingerprint, customerId, customerPricing: evidence, calculatedLineCents: amount })).digest("hex")}`;
    return assertPricingResultEvidence({ ...next, evidenceFingerprint });
  }
}
