/** Presentation-only billing identity. Never converts a Contact into a Customer. */
export function resolveInvoiceBillingParty(input: { customer?: any | null; contact?: any | null }) {
  if (input.contact) {
    const contact = input.contact;
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.email || "Contact";
    return {
      kind: "contact" as const,
      id: contact.id as string,
      name,
      email: contact.email ?? null,
      phone: contact.phone ?? contact.mobile ?? null,
      street1: contact.street1 ?? null,
      street2: contact.street2 ?? null,
      city: contact.city ?? null,
      state: contact.state ?? null,
      postalCode: contact.postalCode ?? null,
      country: contact.country ?? null,
      paymentTerms: "due_on_receipt",
    };
  }
  if (input.customer) {
    const customer = input.customer;
    return {
      kind: "customer" as const,
      id: customer.id as string,
      name: customer.companyName || customer.email || "Customer",
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      street1: customer.billingStreet1 ?? null,
      street2: customer.billingStreet2 ?? null,
      city: customer.billingCity ?? null,
      state: customer.billingState ?? null,
      postalCode: customer.billingPostalCode ?? null,
      country: customer.billingCountry ?? null,
      paymentTerms: customer.paymentTerms ?? "due_on_receipt",
    };
  }
  return null;
}

export function toInvoicePdfBillingParty(party: ReturnType<typeof resolveInvoiceBillingParty>) {
  if (!party) return null;
  return {
    name: party.name,
    email: party.email,
    phone: party.phone,
    billingStreet1: party.street1,
    billingStreet2: party.street2,
    billingCity: party.city,
    billingState: party.state,
    billingPostalCode: party.postalCode,
    billingCountry: party.country,
  };
}
