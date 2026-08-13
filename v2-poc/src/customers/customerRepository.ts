import type { V2UnitOfWork } from "../infrastructure/inMemoryV2Database";
import { V2PocError } from "../shared/errors";
import type { Customer } from "../shared/model";

export async function getCustomer(unitOfWork: V2UnitOfWork, organizationId: string, customerId: string): Promise<Customer> {
  const customer = unitOfWork.state.customers.find((entry) => entry.id === customerId && entry.organizationId === organizationId);
  if (!customer) throw new V2PocError("NOT_FOUND", "Customer not found.");
  return structuredClone(customer);
}
