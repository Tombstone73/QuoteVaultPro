import type { Customer } from "../../shared/schema";

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

  if (customer.website) {
    qbCustomer.WebAddr = { URI: customer.website };
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
