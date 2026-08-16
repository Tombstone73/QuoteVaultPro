import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { InvoiceId } from "../shared/commercialValues.js";
import { brandedId } from "../shared/commercialValues.js";
import type { BillingReadPort, DraftInvoiceReadModel } from "./contracts.js";

export interface BillingReadRunner { read<T>(action: (port: BillingReadPort) => Promise<T>): Promise<T>; }

export class BillingApplicationService {
  constructor(private readonly runner: BillingReadRunner, private readonly authority = new AuthorityPolicy()) {}
  async readInvoice(context: OperationContext, invoiceId: InvoiceId): Promise<ApplicationResult<DraftInvoiceReadModel>> {
    try {
      requireOperationPrincipalScope(context);
      const invoice = await this.runner.read((port) => port.readInvoice(brandedId<"OrganizationId">(context.organizationId), invoiceId));
      if (!invoice) throw new V2ApplicationError("NOT_FOUND", "Invoice was not found.");
      const decision = this.authority.decide(context.principal, { capability: "invoice.view", resource: { organizationId: context.organizationId, customerId: invoice.customerId } });
      if (!decision.allowed) throw new V2ApplicationError("FORBIDDEN", "The principal cannot view this Invoice.");
      return success(invoice);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Invoice could not be read."));
    }
  }
}
