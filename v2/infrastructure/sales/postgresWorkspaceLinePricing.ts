import type { PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { CustomersReadPort } from "../../src/modules/customers/contracts.js";
import { assertPricingResultEvidence, type PricingCalculationRequest, type PricingPort, type PricingResult } from "../../src/modules/pricing/contracts.js";
import { explainPricingResult } from "../../src/modules/pricing/operatorPricingExplanation.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import type { ProductPricingCompatibilityPort } from "../../src/modules/products/contracts.js";
import type { CustomerScopedPricingPort } from "../../src/modules/products/customerCommercial.js";
import { calculatedDecision } from "../../src/modules/sales/quoteApplication.js";
import { authorizeSalesWorkspace, validateSalesWorkspaceHeader, validateSalesWorkspaceLineInput } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspaceHeader, SalesWorkspaceLineInput, SalesWorkspaceLinePreview, SalesWorkspaceTarget, WorkspaceLine } from "../../src/modules/sales/workspaceContracts.js";
import { workspaceLinePreviewFingerprint, type SalesWorkspaceLinePricing } from "../../src/modules/sales/workspaceLines.js";
import { brandedId, freezeCheckpoint } from "../../src/modules/shared/commercialValues.js";
import { createSalesWorkspaceReadPorts } from "../compatibility/workspaceCommercialReads.js";
import { createCustomerCommercialPricingPort } from "../products/customerCommercialPricingPort.js";

/** Internal owner composition after workspace authorization, never a Quote navigation operation.
 * All readers share the caller's client; no canonical persistence or transaction control occurs. */
export class PostgresWorkspaceLinePricing implements SalesWorkspaceLinePricing {
  private readonly products: Pick<ProductPricingCompatibilityPort, "resolveActivePricingInput">;
  private readonly customers: Pick<CustomersReadPort, "validateContactReference" | "getContact">;
  private readonly pricing: PricingPort;
  private readonly customerPricing: CustomerScopedPricingPort;

  constructor(client: PoolClient, private readonly options: Readonly<{
    products?: Pick<ProductPricingCompatibilityPort, "resolveActivePricingInput">;
    customers?: Pick<CustomersReadPort, "validateContactReference" | "getContact">;
    pricing?: PricingPort;
    customerPricing?: CustomerScopedPricingPort;
    now?: () => Date;
  }> = {}) {
    const readers = createSalesWorkspaceReadPorts(client);
    this.products = options.products ?? readers.products;
    this.customers = options.customers ?? readers.customers;
    this.pricing = options.pricing ?? new V2PricingParityAdapter();
    this.customerPricing = options.customerPricing ?? createCustomerCommercialPricingPort(client, this.pricing);
  }

  async preview(context: OperationContext, headerInput: SalesWorkspaceHeader,
    lineInput: SalesWorkspaceLineInput, editTarget?: "order"): Promise<NonNullable<WorkspaceLine["previews"]>> {
    const principal = authorizeSalesWorkspace(context);
    const policy = new AuthorityPolicy();
    const resource = { organizationId: context.organizationId };
    if (editTarget === "order") {
      if (!policy.decide(principal, { capability: "order.view", resource }).allowed
        || !policy.decide(principal, { capability: "order.edit", resource }).allowed) {
        throw new V2ApplicationError("FORBIDDEN", "Order edit preview requires view and edit authority.");
      }
    } else if (!( ["quote", "order"] as const).some(target => policy.decide(principal, { capability: `${target}.create`, resource }).allowed)) {
      throw new V2ApplicationError("FORBIDDEN", "New Sales preview requires creation authority.");
    }
    const header = validateSalesWorkspaceHeader(headerInput, context.organizationId);
    const input = validateSalesWorkspaceLineInput(lineInput);
    if (input.selling && input.selling.kind !== "calculated") {
      const overrideAllowed = editTarget === "order"
        ? policy.decide(principal, { capability: "order.overridePrice", resource }).allowed
        : (["quote", "order"] as const).some((target) => policy.decide(principal, { capability: `${target}.create`, resource }).allowed
          && policy.decide(principal, { capability: `${target}.overridePrice`, resource }).allowed);
      if (!overrideAllowed) {
        throw new V2ApplicationError("FORBIDDEN", "A permitted promotion target requires selling-price override authority.");
      }
    }
    const organizationId = brandedId<"OrganizationId">(context.organizationId);
    if (header.customerContact && !await this.customers.validateContactReference(header.customerContact)) {
      throw new V2ApplicationError("NOT_FOUND", "Customer or contact is unavailable in this organization.");
    }
    const resolved = await this.products.resolveActivePricingInput({ organizationId, productId: brandedId<"ProductId">(input.productId),
      quantity: input.quantity, ...(input.selections ? { selections: input.selections as never } : {}),
      ...(input.dimensions ? { dimensions: input.dimensions } : {}) });
    if (!resolved.ok) throw resolved.error;
    const calculatedAt = (this.options.now?.() ?? new Date()).toISOString();
    const request: PricingCalculationRequest = { organizationId, sellableProduct: resolved.value.sellableProduct,
      resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules,
      pricingContext: { channel: "staff", effectiveAt: calculatedAt },
      ...(resolved.value.nestingEstimate ? { nestingEstimate: resolved.value.nestingEstimate } : {}) };
    const evidence = (target: SalesWorkspaceTarget, pricing: PricingResult): SalesWorkspaceLinePreview => ({
      target, ...(header.customerContact ? { customerContact: header.customerContact } : {}),
      inputFingerprint: workspaceLinePreviewFingerprint(input, header.customerContact),
      resolvedConfiguration: resolved.value.resolvedConfiguration,
      pricingResult: assertPricingResultEvidence(pricing),
      sellingPriceDecision: calculatedDecision(pricing, input.selling, { principalKind: "staff", subjectId: principal.userId }),
      explanation: explainPricingResult(pricing), calculatedAt,
    });
    // Quote deliberately retains base pricing. Order uses its existing customer policy.
    const quote = editTarget === "order" ? undefined : evidence("quote", await this.pricing.calculate(request));
    let order: SalesWorkspaceLinePreview | undefined;
    if (header.customerContact) {
      const reference = header.customerContact;
      const customerId = reference.customerId ?? (reference.contactId
        ? (await this.customers.getContact(organizationId, reference.contactId))?.customerId : undefined);
      order = evidence("order", customerId ? await this.customerPricing.calculateForCustomer(customerId, request) : await this.pricing.calculate(request));
    }
    const previews = { ...(quote ? { quote } : {}), ...(order ? { order } : {}) };
    if (Buffer.byteLength(JSON.stringify(previews), "utf8") > 262144) throw new V2ApplicationError("VALIDATION_ERROR", "Workspace pricing evidence is too large.");
    return freezeCheckpoint(previews);
  }
}
