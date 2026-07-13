import { describe, expect, test } from "@jest/globals";
import {
  buildCompanyReviewPatch,
  buildContactReviewPatch,
  buildFinalizePreviewCounts,
  countMigrationUnresolvedRows,
} from "../services/customerContactMigration/service";

describe("customer/contact migration review decisions", () => {
  test("accepts the top proposed company match and removes company from unresolved statuses", () => {
    const patch = buildCompanyReviewPatch({
      status: "ambiguous",
      matchCandidatesJson: [
        { id: "cust_low", score: 50, reason: "weak" },
        { id: "cust_best", score: 95, reason: "exact name" },
      ],
    }, { action: "accept_proposed", actorUserId: "user_1" });

    expect(patch.status).toBe("matched_existing");
    expect(patch.selectedCustomerId).toBe("cust_best");
    expect(patch.reviewDecisionJson).toMatchObject({ action: "accept_proposed", decidedByUserId: "user_1" });
  });

  test("chooses a different existing contact when reviewer supplies an entity id", () => {
    const patch = buildContactReviewPatch({
      status: "ambiguous_person",
      matchCandidatesJson: [{ id: "contact_candidate", score: 80, reason: "name" }],
    }, { action: "choose_existing", selectedEntityId: "contact_manual", actorUserId: "user_1" });

    expect(patch.status).toBe("matched_existing_person");
    expect(patch.selectedContactId).toBe("contact_manual");
    expect(patch.reviewDecisionJson).toMatchObject({ action: "choose_existing", selectedEntityId: "contact_manual" });
  });

  test("create new and ignore decisions persist review state", () => {
    const companyPatch = buildCompanyReviewPatch({ status: "ambiguous" }, { action: "create_new", actorUserId: "user_1" });
    const contactPatch = buildContactReviewPatch({ status: "company_missing" }, { action: "ignore", actorUserId: "user_1" });

    expect(companyPatch).toMatchObject({ status: "new_company", selectedCustomerId: null });
    expect(companyPatch.reviewDecisionJson).toMatchObject({ action: "create_new" });
    expect(contactPatch).toMatchObject({ status: "rejected", selectedContactId: null, errorMessage: "Ignored by reviewer." });
    expect(contactPatch.reviewDecisionJson).toMatchObject({ action: "ignore" });
  });

  test("finalize preview counts remaining unresolved separately from planned writes", () => {
    const batch = {
      companyRows: [
        { status: "new_company", selectedCustomerId: null },
        { status: "matched_existing", selectedCustomerId: "cust_1" },
        { status: "ambiguous", selectedCustomerId: null },
      ],
      contactRows: [
        { status: "company_matched", selectedContactId: null },
        { status: "matched_existing_person", selectedContactId: "contact_1" },
        { status: "ambiguous_person", selectedContactId: null },
      ],
      relationshipRows: [
        { status: "ready", selectedLinkId: null },
        { status: "ready", selectedLinkId: "link_1" },
        { status: "ambiguous", selectedLinkId: null },
      ],
    };

    expect(countMigrationUnresolvedRows(batch)).toBe(3);
    expect(buildFinalizePreviewCounts(batch)).toEqual({
      companiesToCreate: 1,
      companiesToUpdate: 1,
      contactsToCreate: 1,
      contactsToUpdate: 1,
      relationshipsToCreate: 1,
      relationshipsToUpdate: 1,
      remainingUnresolved: 3,
    });
  });
});
