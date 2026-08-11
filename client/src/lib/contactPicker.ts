export type ContactPickerCustomer = {
  id: string;
  companyName: string | null;
  status?: string | null;
  isPrimary?: boolean | null;
};

export type ContactPickerContact = {
  id: string;
  customerId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary?: boolean | null;
  companyName?: string | null;
  customer?: ContactPickerCustomer | null;
  linkedCustomers?: ContactPickerCustomer[] | null;
};

export function getContactDisplayName(contact: ContactPickerContact | null | undefined): string {
  if (!contact) return "";
  const name = [contact.firstName, contact.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return name || contact.email?.trim() || "Unnamed contact";
}

export function getActiveContactCustomers(contact: ContactPickerContact | null | undefined): ContactPickerCustomer[] {
  if (!contact) return [];
  const byId = new Map<string, ContactPickerCustomer>();
  const addCustomer = (customer: ContactPickerCustomer | null | undefined) => {
    if (!customer?.id) return;
    const status = customer.status ?? "active";
    if (status !== "active") return;
    byId.set(customer.id, customer);
  };

  addCustomer(contact.customer);
  for (const customer of contact.linkedCustomers ?? []) addCustomer(customer);
  if (contact.customerId && contact.companyName && contact.companyName !== "Unlinked") {
    addCustomer({ id: contact.customerId, companyName: contact.companyName, status: "active" });
  }

  return Array.from(byId.values());
}

export function getContactCompanyLabel(contact: ContactPickerContact | null | undefined): string {
  const customers = getActiveContactCustomers(contact);
  const label = customers.map((customer) => customer.companyName?.trim()).filter(Boolean).join(", ");
  return label || "No customer account";
}

export function getContactSecondaryLine(contact: ContactPickerContact): string {
  const parts = [getContactCompanyLabel(contact), contact.email?.trim() || contact.phone?.trim() || contact.mobile?.trim()]
    .filter(Boolean);
  return parts.join(" - ");
}

export function getCanonicalContactCustomerId(contact: ContactPickerContact | null | undefined): string | null {
  const activeCustomers = getActiveContactCustomers(contact);
  if (activeCustomers.length === 0) return null;

  if (contact?.customerId && activeCustomers.some((customer) => customer.id === contact.customerId)) {
    return contact.customerId;
  }

  return activeCustomers.find((customer) => customer.isPrimary)?.id ?? activeCustomers[0].id;
}

export function resolveOrderCustomerIdFromContact(
  currentCustomerId: string | null | undefined,
  contact: ContactPickerContact | null | undefined,
): string {
  return getCanonicalContactCustomerId(contact) ?? currentCustomerId ?? "";
}

export function contactMatchesCustomer(contact: ContactPickerContact | null | undefined, customerId: string | null | undefined): boolean {
  if (!contact || !customerId) return true;
  const activeCustomers = getActiveContactCustomers(contact);
  if (activeCustomers.length === 0) return true;
  return activeCustomers.some((customer) => customer.id === customerId);
}

export function getContactCustomerConflict(contact: ContactPickerContact | null | undefined, customerId: string | null | undefined): string | null {
  if (!contact || !customerId || contactMatchesCustomer(contact, customerId)) return null;
  return "CONTACT_CUSTOMER_CONFLICT";
}

export function sortContactsForCustomer<TContact extends ContactPickerContact>(contacts: TContact[], customerId: string | null | undefined): TContact[] {
  return [...contacts].sort((a, b) => {
    const aCompatible = contactMatchesCustomer(a, customerId);
    const bCompatible = contactMatchesCustomer(b, customerId);
    if (aCompatible !== bCompatible) return aCompatible ? -1 : 1;
    const aName = getContactDisplayName(a).toLowerCase();
    const bName = getContactDisplayName(b).toLowerCase();
    return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  });
}
