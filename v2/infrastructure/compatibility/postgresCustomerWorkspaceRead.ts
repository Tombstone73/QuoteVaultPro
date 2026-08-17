import type { Pool } from "pg";
import type { CustomerPresentationIdentity } from "../../src/modules/customers/contracts.js";
import { brandedId, type CustomerId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresCustomersCompatibilityReader } from "./postgresCustomersRead.js";

export type CustomerWorkspaceRead = Readonly<{
  customerId: CustomerId;
  displayName: string;
  presentation: CustomerPresentationIdentity;
}>;

/** Read-only Customer workspace projection; CRM remains the source of these facts. */
export class PostgresCustomerWorkspaceReader {
  constructor(private readonly pool: Pool) {}

  async read(organizationId: OrganizationId, customerId: CustomerId): Promise<CustomerWorkspaceRead | null> {
    const reader = new PostgresCustomersCompatibilityReader(this.pool);
    const customer = await reader.getCustomer(organizationId, customerId);
    if (!customer) return null;
    return {
      customerId: brandedId<"CustomerId">(customer.id),
      displayName: customer.displayName,
      presentation: await reader.getPresentationIdentity({ organizationId, customerId }),
    };
  }
}
