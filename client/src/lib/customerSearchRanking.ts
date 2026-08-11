export type CustomerSearchCandidate = {
  id: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  contacts?: Array<{
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
  }>;
};

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
}

export function customerMatchesSearch(customer: CustomerSearchCandidate, query: string): boolean {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  const companyName = normalizeSearchValue(customer.companyName);
  const customerFields = [companyName, normalizeSearchValue(customer.email), normalizeSearchValue(customer.phone)];
  if (customerFields.some((value) => value.includes(normalizedQuery))) return true;

  return customer.contacts?.some((contact) => {
    const contactName = normalizeSearchValue(`${contact.firstName ?? ""} ${contact.lastName ?? ""}`);
    return [contactName, normalizeSearchValue(contact.email), normalizeSearchValue(contact.phone), normalizeSearchValue(contact.mobile)]
      .some((value) => value.includes(normalizedQuery));
  }) ?? false;
}

export function getCustomerSearchRank(customer: CustomerSearchCandidate, query: string): number {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return 0;

  const companyName = normalizeSearchValue(customer.companyName);
  if (companyName === normalizedQuery) return 0;
  if (companyName.startsWith(normalizedQuery)) return 1;
  if (companyName.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(normalizedQuery))) return 2;
  if (companyName.includes(normalizedQuery)) return 3;
  if (normalizeSearchValue(customer.email).includes(normalizedQuery)) return 4;

  const contact = getBestMatchingCustomerContact(customer, query);
  if (!contact) return 9;
  return getContactSearchRank(contact, normalizedQuery) + 5;
}

function getContactSearchRank(contact: NonNullable<CustomerSearchCandidate["contacts"]>[number], normalizedQuery: string): number {
  const contactName = normalizeSearchValue(`${contact.firstName ?? ""} ${contact.lastName ?? ""}`);
  if (contactName === normalizedQuery) return 0;
  if (contactName.startsWith(normalizedQuery)) return 1;
  if (contactName.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(normalizedQuery))) return 2;
  if (contactName.includes(normalizedQuery)) return 3;
  if ([contact.email, contact.phone, contact.mobile].map(normalizeSearchValue).some((value) => value.includes(normalizedQuery))) return 4;
  return 5;
}

export function getBestMatchingCustomerContact<TCustomer extends CustomerSearchCandidate>(
  customer: TCustomer,
  query: string,
): NonNullable<TCustomer["contacts"]>[number] | null {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery || !customer.contacts?.length) return null;

  return [...customer.contacts]
    .filter((contact) => getContactSearchRank(contact, normalizedQuery) < 5)
    .sort((a, b) => {
      const rankDifference = getContactSearchRank(a, normalizedQuery) - getContactSearchRank(b, normalizedQuery);
      if (rankDifference !== 0) return rankDifference;
      return normalizeSearchValue(`${a.firstName ?? ""} ${a.lastName ?? ""}`).localeCompare(
        normalizeSearchValue(`${b.firstName ?? ""} ${b.lastName ?? ""}`),
      );
    })[0] ?? null;
}

export function sortCustomersForSearch<TCustomer extends CustomerSearchCandidate>(customers: TCustomer[], query: string): TCustomer[] {
  return [...customers]
    .filter((customer) => customerMatchesSearch(customer, query))
    .sort((a, b) => {
      const rankDifference = getCustomerSearchRank(a, query) - getCustomerSearchRank(b, query);
      if (rankDifference !== 0) return rankDifference;

      const companyNameDifference = normalizeSearchValue(a.companyName).localeCompare(normalizeSearchValue(b.companyName));
      if (companyNameDifference !== 0) return companyNameDifference;
      return a.id.localeCompare(b.id);
    });
}
