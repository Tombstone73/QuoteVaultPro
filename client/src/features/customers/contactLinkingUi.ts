export type ContactPickerSource = {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary?: boolean | null;
  companyName?: string | null;
  company_name?: string | null;
  linkedCustomers?: Array<{ id: string; companyName: string; status?: string; isPrimary?: boolean }> | null;
  customer?: {
    id?: string | null;
    companyName?: string | null;
    company_name?: string | null;
  } | null;
};

export type NormalizedContactPickerResult = {
  id: string;
  customerId: string | null;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  companyName: string;
  linkedCustomers: Array<{ id: string; companyName: string; status?: string; isPrimary?: boolean }>;
};

export type ContactMoveConfirmationState = {
  requiresMoveConfirmation: boolean;
  sourceCustomerName: string;
  targetCustomerName: string;
  warningText: string;
  checkboxText: string;
  selectedSummary: string;
};

export function normalizeContactPickerResult(contact: ContactPickerSource): NormalizedContactPickerResult {
  const customerId = contact.customerId ?? contact.customer_id ?? contact.customer?.id ?? null;
  const companyName = contact.companyName ?? contact.company_name ?? contact.customer?.companyName ?? contact.customer?.company_name ?? "";

  return {
    id: contact.id,
    customerId,
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    title: contact.title ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    mobile: contact.mobile ?? null,
    isPrimary: contact.isPrimary === true,
    companyName,
    linkedCustomers: Array.isArray(contact.linkedCustomers) ? contact.linkedCustomers : [],
  };
}

export function getContactMoveConfirmationState(
  selectedContact: NormalizedContactPickerResult | null,
  targetCustomer: { id: string; companyName: string },
): ContactMoveConfirmationState {
  const sourceCustomerName = selectedContact?.companyName || "another customer";
  const targetCustomerName = targetCustomer.companyName;
  const hasOtherLinkedCustomer = Boolean(selectedContact?.customerId && selectedContact.customerId !== targetCustomer.id);
  const hasSourceCompanyWithoutId = Boolean(
    selectedContact &&
    !selectedContact.customerId &&
    selectedContact.companyName &&
    selectedContact.companyName !== targetCustomer.companyName,
  );
  const hasOtherCustomerContext = hasOtherLinkedCustomer || hasSourceCompanyWithoutId;
  const requiresMoveConfirmation = false;
  const fullName = selectedContact
    ? `${selectedContact.firstName || ""} ${selectedContact.lastName || ""}`.trim() || "Unnamed contact"
    : "";

  return {
    requiresMoveConfirmation,
    sourceCustomerName,
    targetCustomerName,
    warningText: `This contact is currently linked to ${sourceCustomerName}. Linking it to ${targetCustomerName} will add another customer relationship.`,
    checkboxText: `I understand this will link the contact to ${targetCustomerName}.`,
    selectedSummary: selectedContact
      ? hasOtherCustomerContext
        ? `Selected ${fullName}. Currently linked to ${sourceCustomerName}; linking will add ${targetCustomerName}.`
        : `Ready to link ${fullName}.`
      : "",
  };
}

export function canSubmitLinkContact(
  hasSelectedContact: boolean,
  isPending: boolean,
  requiresMoveConfirmation: boolean,
  moveConfirmed: boolean,
) {
  return hasSelectedContact && !isPending && (!requiresMoveConfirmation || moveConfirmed);
}

export function buildLinkExistingContactPayload(
  contactId: string,
  setPrimary: boolean,
  requiresMoveConfirmation: boolean,
  moveConfirmed: boolean,
) {
  return {
    contactId,
    setPrimary,
    confirmMove: false,
  };
}
