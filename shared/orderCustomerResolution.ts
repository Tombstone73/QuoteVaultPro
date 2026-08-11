export type OrderContactCustomerCandidate = {
  id: string;
  isPrimary?: boolean | null;
};

export function resolveOrderCustomerIdForContact(input: {
  currentCustomerId?: string | null;
  legacyCustomerId?: string | null;
  linkedCustomers?: OrderContactCustomerCandidate[] | null;
}): string | null {
  const currentCustomerId = input.currentCustomerId?.trim() || null;
  const linkedCustomers = (input.linkedCustomers ?? []).filter((customer) => Boolean(customer.id));

  if (linkedCustomers.length === 0) return currentCustomerId;
  if (currentCustomerId && linkedCustomers.some((customer) => customer.id === currentCustomerId)) {
    return currentCustomerId;
  }

  const legacyCustomerId = input.legacyCustomerId?.trim() || null;
  if (legacyCustomerId && linkedCustomers.some((customer) => customer.id === legacyCustomerId)) {
    return legacyCustomerId;
  }

  return linkedCustomers.find((customer) => customer.isPrimary)?.id ?? linkedCustomers[0].id;
}
