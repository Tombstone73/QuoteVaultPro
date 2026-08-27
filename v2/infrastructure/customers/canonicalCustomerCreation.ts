import { auditLogs, insertCustomerSchema } from "@shared/schema";
import { db } from "../../../server/db.js";
import { CustomersRepository } from "../../../server/storage/customers.repo.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { staffActorId } from "../../src/authorization/principals.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { CustomerCreateInput } from "../../src/interfaces/http/customerRoutes.js";
import type { CustomerWorkspaceRead } from "../compatibility/postgresCustomerWorkspaceRead.js";
import { PostgresCustomerWorkspaceReader } from "../compatibility/postgresCustomerWorkspaceRead.js";

/**
 * V2's Customer command is deliberately backed by the existing Customer
 * schema/repository and the same Drizzle transaction that records its audit
 * fact.  It does not introduce a V2-only Customer representation.
 */
export class CanonicalCustomerCreationService {
  constructor(private readonly reads: PostgresCustomerWorkspaceReader) {}

  async create(context: OperationContext, input: CustomerCreateInput): Promise<CustomerWorkspaceRead> {
    const actorUserId = staffActorId(context.principal);
    if (!actorUserId) throw new V2ApplicationError("FORBIDDEN", "Customer creation is unavailable.");
    const inputRecord = insertCustomerSchema.parse({
      companyName: input.companyName,
      displayName: input.displayName ?? input.companyName,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    });
    const created = await db.transaction(async (transaction) => {
      const repository = new CustomersRepository(transaction as never);
      const customer = await repository.createCustomer(context.organizationId, inputRecord);
      await transaction.insert(auditLogs).values({
        organizationId: context.organizationId,
        userId: actorUserId,
        actionType: "customer_created",
        entityType: "customer",
        entityId: customer.id,
        entityName: customer.companyName,
        description: "Created customer through canonical Customer operation.",
        newValues: { auditReference: "v2.customer.create", primaryContactId: null },
      } as never);
      return customer;
    });
    const customer = await this.reads.read(brandedId<"OrganizationId">(context.organizationId), brandedId<"CustomerId">(created.id));
    if (!customer) throw new V2ApplicationError("INTERNAL_ERROR", "Created Customer could not be read.");
    return customer;
  }
}
