import { z } from 'zod';
import type { ShippingParty } from './shippingDocuments';

export const saveShipmentCustomerAddressSchema = z.object({
  customerId: z.string().min(1),
  expectedCustomerUpdatedAt: z.string().datetime(),
  expectedShipmentUpdatedAt: z.string().datetime(),
}).strict();
export type SaveShipmentCustomerAddressInput = z.infer<typeof saveShipmentCustomerAddressSchema>;
export type CustomerShippingAddress = {
  shippingStreet1: string; shippingStreet2: string; shippingCity: string;
  shippingState: string; shippingPostalCode: string; shippingCountry: string;
};
export type ShipmentCustomerAddressTarget = {
  customerId: string; companyName: string; updatedAt: string;
  address: CustomerShippingAddress;
  legacyAddress?: string | null;
};

/** The existing Customer default shipping fields, never billing or contact identity. */
export function customerShippingAddressFromParty(party: ShippingParty): CustomerShippingAddress {
  return {
    shippingStreet1: party.address1?.trim() ?? '', shippingStreet2: party.address2?.trim() ?? '',
    shippingCity: party.city?.trim() ?? '', shippingState: party.state?.trim() ?? '',
    shippingPostalCode: party.postalCode?.trim() ?? '', shippingCountry: party.country?.trim() ?? '',
  };
}
