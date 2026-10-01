import type { ContactId, CustomerId, OrganizationId } from "../shared/commercialValues.js";

/** Name-only CRM projection; no inferred account, email, phone or private CRM metadata. */
export type SalesContactChoice = Readonly<{ id: ContactId; label: string }>;

export type SalesContactSelectionQuery = Readonly<{
  customerId?: CustomerId;
  /** Literal case-insensitive name substring, trimmed; at most 120 characters. */
  search?: string;
  /** Whole-number limit clamped to 1..50; defaults to 25. */
  limit?: number;
  /** Hydrated independently of the search/page, under the same active scope. */
  selectedContactId?: ContactId;
}>;

export type SalesContactSelectionResult = Readonly<{
  items: readonly SalesContactChoice[];
  selectedContact: SalesContactChoice | null;
}>;

/** Read only, after the workspace boundary verifies creator and current Sales
 * authority. organizationId is verified boundary scope, not caller authorization.
 * Absence of customerId means contact-only; it never promotes CRM identity.
 * Canonical Sales must revalidate the reference when saving/promoting. */
export interface SalesContactSelectionReadPort {
  lookupActiveContacts(organizationId: OrganizationId, input: SalesContactSelectionQuery): Promise<SalesContactSelectionResult>;
}
