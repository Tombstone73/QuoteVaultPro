import { auditLogs, insertCustomerContactSchema } from "@shared/schema";
import { db } from "../../../server/db.js";
import { CustomersRepository } from "../../../server/storage/customers.repo.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { staffActorId } from "../../src/authorization/principals.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { ContactCreateInput } from "../../src/interfaces/http/contactRoutes.js";
import type { ContactWorkspaceRead } from "../compatibility/postgresContactWorkspaceRead.js";
import { PostgresContactWorkspaceReader } from "../compatibility/postgresContactWorkspaceRead.js";

/**
 * V2 Contact creation uses the same canonical Customer repository boundary as
 * the established Contact operation.  That boundary owns the contact row,
 * Customer relationship link, and tenant-scoped Customer existence check.
 */
export class CanonicalContactCreationService {
  constructor(private readonly reads: PostgresContactWorkspaceReader) {}

  async create(context: OperationContext, input: ContactCreateInput): Promise<ContactWorkspaceRead> {
    const actorUserId = staffActorId(context.principal);
    if (!actorUserId) throw new V2ApplicationError("FORBIDDEN", "Contact creation is unavailable.");
    const record = insertCustomerContactSchema.parse({
      organizationId: context.organizationId,
      customerId: input.customerId,
      firstName: input.firstName,
      lastName: input.lastName,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.title ? { title: input.title } : {}),
      // Primary status belongs to the Customer/Contact relationship and is
      // intentionally not fabricated by this minimal create operation.
      isPrimary: false,
    });
    const { organizationId: _organizationId, customerId: _customerId, ...fields } = record;
    let created: { id: string };
    try {
      created = await db.transaction(async (transaction) => {
        const repository = new CustomersRepository(transaction as never);
        const contact = await repository.createCustomerContactForOrganization(
          context.organizationId,
          input.customerId,
          fields,
        );
        await transaction.insert(auditLogs).values({
          organizationId: context.organizationId,
          userId: actorUserId,
          actionType: "customer_contact_created",
          entityType: "customer_contact",
          entityId: contact.id,
          entityName: `${contact.firstName} ${contact.lastName}`.trim(),
          description: "Created contact through canonical Contact operation.",
          newValues: { customerId: input.customerId, primary: false, auditReference: "v2.contact.create" },
        } as never);
        return contact;
      });
    } catch (error) {
      // The canonical operation verifies Customer + organization inside its
      // transaction.  Preserve its safe not-found boundary without revealing
      // whether a foreign Customer exists.
      if (error instanceof Error && error.message === "Customer not found")
        throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
      throw error;
    }
    const contact = await this.reads.read(
      brandedId<"OrganizationId">(context.organizationId),
      brandedId<"ContactId">(created.id),
    );
    if (!contact) throw new V2ApplicationError("INTERNAL_ERROR", "Created Contact could not be read.");
    return contact;
  }
}
