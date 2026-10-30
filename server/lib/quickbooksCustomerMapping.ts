import type { Customer } from "../../shared/schema";
import { normalizeOptionalWebsite } from "../../shared/vendorWebsite";
import { customerAddressFields, mapQBCustomerAddresses } from './quickbooksCustomerAddress';

export function mapQBCustomerToLocal(qbCustomer: any): Partial<Customer> {
  return {
    companyName: qbCustomer.DisplayName || qbCustomer.CompanyName || 'Unknown',
    email: qbCustomer.PrimaryEmailAddr?.Address || null,
    phone: qbCustomer.PrimaryPhone?.FreeFormNumber || null,
    website: qbCustomer.WebAddr?.URI || null,
    ...mapQBCustomerAddresses(qbCustomer),
    currentBalance: qbCustomer.Balance?.toString() || '0',
    externalAccountingId: qbCustomer.Id,
    syncStatus: 'synced',
    syncedAt: new Date(),
    notes: qbCustomer.Notes || null,
  };
}

export function mapQBCustomerPullUpdate(qbCustomer: any, existing: Customer): Partial<Customer> {
  const patch = mapQBCustomerToLocal(qbCustomer);
  // Retain the existing QB-owned policy for non-address fields.
  for (const field of ['email', 'phone', 'website', 'notes'] as const) {
    if (existing.qbFieldOverrides?.[field]) delete patch[field];
  }
  for (const field of customerAddressFields) delete patch[field];
  return { ...patch, ...mapQBCustomerAddresses(qbCustomer, existing) };
}

function parseLocalAddress(address: string): any {
  const parts = address.split(",").map((part) => part.trim());
  return {
    Line1: parts[0] || "",
    City: parts.length > 2 ? parts[parts.length - 3] : "",
    CountrySubDivisionCode: parts.length > 1 ? parts[parts.length - 2] : "",
    PostalCode: parts.length > 0 ? parts[parts.length - 1] : "",
  };
}

export function mapLocalCustomerToQB(customer: Customer): any {
  const customerType = String((customer as any).customerType || "business").trim().toLowerCase();
  const isIndividual = customerType === "individual";
  const displayName = String((customer as any).displayName || customer.companyName || "").trim();
  const qbCustomer: any = {
    DisplayName: displayName || customer.companyName,
  };

  if (isIndividual) {
    const givenName = String((customer as any).individualFirstName || "").trim();
    const familyName = String((customer as any).individualLastName || "").trim();
    if (givenName) qbCustomer.GivenName = givenName;
    if (familyName) qbCustomer.FamilyName = familyName;
  } else if (customer.companyName) {
    qbCustomer.CompanyName = customer.companyName;
  }

  if (customer.email) {
    qbCustomer.PrimaryEmailAddr = { Address: customer.email };
  }

  if (customer.phone) {
    qbCustomer.PrimaryPhone = { FreeFormNumber: customer.phone };
  }

  const website = normalizeOptionalWebsite(customer.website);
  if (website) {
    qbCustomer.WebAddr = { URI: website };
  } else if (customer.website?.trim()) {
    // Never log the supplied URL: it may contain credentials or personal data.
    console.warn('[QuickBooks] Optional customer website omitted', {
      code: 'QB_CUSTOMER_WEBSITE_OMITTED',
      organizationId: customer.organizationId,
      customerId: customer.id,
      reason: 'invalid_or_unsafe_website',
    });
  }

  if (customer.billingAddress) {
    qbCustomer.BillAddr = parseLocalAddress(customer.billingAddress);
  } else if ((customer as any).billingStreet1 || (customer as any).billingCity || (customer as any).billingPostalCode) {
    qbCustomer.BillAddr = {
      Line1: (customer as any).billingStreet1 || undefined,
      Line2: (customer as any).billingStreet2 || undefined,
      City: (customer as any).billingCity || undefined,
      CountrySubDivisionCode: (customer as any).billingState || undefined,
      PostalCode: (customer as any).billingPostalCode || undefined,
      Country: (customer as any).billingCountry || undefined,
    };
  }

  if (customer.shippingAddress) {
    qbCustomer.ShipAddr = parseLocalAddress(customer.shippingAddress);
  }

  if (customer.notes) {
    qbCustomer.Notes = customer.notes;
  }

  return qbCustomer;
}
