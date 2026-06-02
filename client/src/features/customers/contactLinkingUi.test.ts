import { describe, expect, test } from "@jest/globals";
import {
  buildLinkExistingContactPayload,
  canSubmitLinkContact,
  getContactMoveConfirmationState,
  normalizeContactPickerResult,
} from "./contactLinkingUi";

const targetCustomer = {
  id: "target-customer",
  companyName: "Target Customer",
};

describe("contact linking move-confirmation UI state", () => {
  test("selecting a contact from another customer shows move warning copy", () => {
    const selectedContact = normalizeContactPickerResult({
      id: "contact-1",
      customerId: "source-customer",
      firstName: "Noah",
      lastName: "Frantz",
      companyName: "Print Dispatch Marketing Services",
    });

    const state = getContactMoveConfirmationState(selectedContact, targetCustomer);

    expect(state.requiresMoveConfirmation).toBe(true);
    expect(state.warningText).toBe(
      "This contact currently belongs to Print Dispatch Marketing Services. Linking it to Target Customer will move it.",
    );
    expect(state.checkboxText).toBe(
      "I understand this will move the contact from Print Dispatch Marketing Services to Target Customer.",
    );
    expect(state.selectedSummary).toBe(
      "Selected Noah Frantz from Print Dispatch Marketing Services. Confirm the move before linking.",
    );
  });

  test("normalizes snake_case contact payloads before checking move state", () => {
    const selectedContact = normalizeContactPickerResult({
      id: "contact-1",
      customer_id: "source-customer",
      firstName: "Noah",
      lastName: "Frantz",
      company_name: "Print Dispatch Marketing Services",
    });

    const state = getContactMoveConfirmationState(selectedContact, targetCustomer);

    expect(selectedContact.customerId).toBe("source-customer");
    expect(selectedContact.companyName).toBe("Print Dispatch Marketing Services");
    expect(state.requiresMoveConfirmation).toBe(true);
  });

  test("Link Contact stays disabled until move acknowledgement is checked", () => {
    const selectedContact = normalizeContactPickerResult({
      id: "contact-1",
      customerId: "source-customer",
      firstName: "Noah",
      lastName: "Frantz",
      companyName: "Print Dispatch Marketing Services",
    });
    const state = getContactMoveConfirmationState(selectedContact, targetCustomer);

    expect(canSubmitLinkContact(true, false, state.requiresMoveConfirmation, false)).toBe(false);
    expect(canSubmitLinkContact(true, false, state.requiresMoveConfirmation, true)).toBe(true);
  });

  test("confirmMove true is sent only after acknowledgement", () => {
    expect(buildLinkExistingContactPayload("contact-1", false, true, false)).toEqual({
      contactId: "contact-1",
      setPrimary: false,
      confirmMove: false,
    });
    expect(buildLinkExistingContactPayload("contact-1", true, true, true)).toEqual({
      contactId: "contact-1",
      setPrimary: true,
      confirmMove: true,
    });
  });

  test("unlinked contact can be linked without move acknowledgement", () => {
    const selectedContact = normalizeContactPickerResult({
      id: "contact-2",
      customerId: null,
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const state = getContactMoveConfirmationState(selectedContact, targetCustomer);

    expect(state.requiresMoveConfirmation).toBe(false);
    expect(canSubmitLinkContact(true, false, state.requiresMoveConfirmation, false)).toBe(true);
    expect(buildLinkExistingContactPayload("contact-2", false, state.requiresMoveConfirmation, false).confirmMove).toBe(false);
  });
});
