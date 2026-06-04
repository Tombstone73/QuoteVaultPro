import type { QuoteLineItemDraft } from "./types";

type CustomerContactLike = {
  id?: string | null;
  email?: string | null;
};

type CustomerLike = {
  id?: string | null;
  contacts?: CustomerContactLike[];
};

type QuoteActionBaseInput = {
  quoteId?: string | null;
  isSaving: boolean;
  lineItems: QuoteLineItemDraft[];
};

export type QuotePreviewEligibilityInput = QuoteActionBaseInput;

export type QuoteSendEligibilityInput = QuoteActionBaseInput & {
  selectedCustomer?: CustomerLike | null;
  selectedContactId?: string | null;
  workflowState?: string | null;
  requireApproval?: boolean;
  emailConfigured?: boolean;
};

export type QuoteActionEligibility = {
  enabled: boolean;
  reason: string | null;
};

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

export function isPdfEligibleLineItem(item: QuoteLineItemDraft): boolean {
  if (item.status === "canceled" || item.status === "draft") return false;
  return (
    hasText(item.productId) &&
    isPositiveNumber(item.width) &&
    isPositiveNumber(item.height) &&
    isPositiveNumber(item.quantity) &&
    Number.isFinite(Number(item.linePrice))
  );
}

export function getQuotePreviewEligibility(input: QuotePreviewEligibilityInput): QuoteActionEligibility {
  if (!hasText(input.quoteId)) {
    return { enabled: false, reason: "Save the quote before previewing the PDF." };
  }
  if (input.isSaving) {
    return { enabled: false, reason: "Wait for the quote to finish saving." };
  }

  const activeLineItems = input.lineItems.filter((item) => item.status !== "canceled");
  if (activeLineItems.length === 0) {
    return { enabled: false, reason: "Add at least one line item before previewing." };
  }

  if (!activeLineItems.some(isPdfEligibleLineItem)) {
    return { enabled: false, reason: "Complete and save at least one valid line item before previewing." };
  }

  return { enabled: true, reason: null };
}

function selectedContactHasEmail(input: QuoteSendEligibilityInput): boolean {
  const selectedContact = input.selectedCustomer?.contacts?.find((contact) => contact.id === input.selectedContactId);
  return hasText(selectedContact?.email);
}

export function getQuoteSendEligibility(input: QuoteSendEligibilityInput): QuoteActionEligibility {
  const previewEligibility = getQuotePreviewEligibility(input);
  if (!previewEligibility.enabled) return previewEligibility;

  if (!input.selectedCustomer?.id) {
    return { enabled: false, reason: "Select a customer before sending the quote." };
  }
  if (!input.selectedContactId || !selectedContactHasEmail(input)) {
    return { enabled: false, reason: "Select a customer contact with an email address before sending." };
  }
  if (input.requireApproval && input.workflowState === "draft") {
    return { enabled: false, reason: "Request or complete approval before sending this quote." };
  }
  if (input.workflowState === "converted" || input.workflowState === "rejected" || input.workflowState === "expired") {
    return { enabled: false, reason: "This quote status is not eligible for sending." };
  }
  if (input.emailConfigured === false) {
    return { enabled: false, reason: "Quote email sending is not configured." };
  }

  return { enabled: true, reason: null };
}
