import type { ContactId, CustomerId, OrganizationId } from "../shared/commercialValues.js";

export type CustomerContactReference =
  | Readonly<{ organizationId: OrganizationId; customerId: CustomerId; contactId?: ContactId }>
  | Readonly<{ organizationId: OrganizationId; customerId?: CustomerId; contactId: ContactId }>;

/** Only recipient-visible facts are captured at document checkpoints, never a mutable CRM clone. */
export type CustomerPresentationIdentity = Readonly<{
  customerDisplayName?: string;
  contactDisplayName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  billingAddress?: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }>;
  shippingAddress?: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }>;
}>;

export interface CustomersReadPort {
  getCustomer(organizationId: OrganizationId, customerId: CustomerId): Promise<Readonly<{ id: CustomerId; displayName: string }> | null>;
  getContact(organizationId: OrganizationId, contactId: ContactId): Promise<Readonly<{ id: ContactId; customerId?: CustomerId; displayName: string }> | null>;
  validateContactReference(reference: CustomerContactReference): Promise<boolean>;
  getPresentationIdentity(reference: CustomerContactReference): Promise<CustomerPresentationIdentity>;
}
