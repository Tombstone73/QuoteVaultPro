export type CustomerAddressSource = "shipping" | "billing";

export type CustomerAddressLike = {
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  shippingStreet1?: string | null;
  shippingStreet2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;
  billingStreet1?: string | null;
  billingStreet2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
};

export type ResolvedCustomerShipTo = {
  source: CustomerAddressSource;
  data: {
    company: string | null;
    email: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
};

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function resolveCustomerShipTo(customer: CustomerAddressLike | null | undefined): ResolvedCustomerShipTo | null {
  if (!customer) return null;
  const hasShipping = Boolean(
    clean(customer.shippingStreet1) || clean(customer.shippingCity) || clean(customer.shippingPostalCode),
  );
  const hasBilling = Boolean(
    clean(customer.billingStreet1) || clean(customer.billingCity) || clean(customer.billingPostalCode),
  );
  if (!hasShipping && !hasBilling) return null;

  const source: CustomerAddressSource = hasShipping ? "shipping" : "billing";
  const prefix = source === "shipping" ? "shipping" : "billing";
  const field = (suffix: "Street1" | "Street2" | "City" | "State" | "PostalCode" | "Country") =>
    clean(customer[`${prefix}${suffix}` as keyof CustomerAddressLike] as string | null | undefined);

  return {
    source,
    data: {
      company: clean(customer.companyName),
      email: clean(customer.email),
      phone: clean(customer.phone),
      address1: field("Street1"),
      address2: field("Street2"),
      city: field("City"),
      state: field("State"),
      postalCode: field("PostalCode"),
      country: field("Country") || "USA",
    },
  };
}

export function hasEnteredShipToAddress(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return ["company", "name", "email", "phone", "address1", "address2", "city", "state", "postalCode"]
    .some((key) => clean(data[key] as string | null | undefined) !== null);
}
