import { describe, expect, test } from "@jest/globals";
import {
  buildCompanyReviewPatch,
  buildContactReviewPatch,
  buildDependentContactPatchAfterCompanyDecision,
  buildFinalizePreviewCounts,
  buildRelationshipPatchAfterCompanyDecision,
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

  test("resolving a company clears dependent company-pending contact exceptions", () => {
    const companyPatch = buildCompanyReviewPatch({
      status: "ambiguous",
      matchCandidatesJson: [{ id: "cust_adapt", score: 92, reason: "normalized name" }],
    }, { action: "accept_proposed", actorUserId: "user_1" });
    const dependentContactPatch = buildDependentContactPatchAfterCompanyDecision("company_pending", companyPatch);
    const relationshipPatch = buildRelationshipPatchAfterCompanyDecision(companyPatch);

    expect(dependentContactPatch).toMatchObject({
      status: "company_matched",
      selectedCustomerId: "cust_adapt",
      errorMessage: null,
    });
    expect(relationshipPatch).toMatchObject({
      status: "ready",
      selectedCustomerId: "cust_adapt",
      errorMessage: null,
    });
  });

  test("ignoring a company skips dependent relationships instead of leaving child exceptions", () => {
    const companyPatch = buildCompanyReviewPatch({ status: "ambiguous" }, { action: "ignore", actorUserId: "user_1" });
    const dependentContactPatch = buildDependentContactPatchAfterCompanyDecision("company_pending", companyPatch);
    const relationshipPatch = buildRelationshipPatchAfterCompanyDecision(companyPatch);

    expect(dependentContactPatch).toMatchObject({
      status: "rejected",
      selectedCustomerId: null,
      errorMessage: "Parent company source ignored by reviewer.",
    });
    expect(relationshipPatch).toMatchObject({
      status: "skipped",
      selectedCustomerId: null,
      errorMessage: "Company source ignored by reviewer.",
    });
  });

  test("true contact-level exceptions remain unresolved after company decisions", () => {
    const companyPatch = buildCompanyReviewPatch({ status: "ambiguous" }, { action: "create_new", actorUserId: "user_1" });

    expect(buildDependentContactPatchAfterCompanyDecision("ambiguous_person", companyPatch)).toBeNull();
    expect(countMigrationUnresolvedRows({
      companyRows: [{ status: "new_company" }],
      contactRows: [{ status: "ambiguous_person" }],
      relationshipRows: [{ status: "ready" }],
    })).toBe(1);
  });

  test("company-pending contacts are dependencies, not independent unresolved records", () => {
    expect(countMigrationUnresolvedRows({
      companyRows: [{ status: "ambiguous" }],
      contactRows: [
        { status: "company_pending" },
        { status: "company_pending" },
        { status: "company_pending" },
      ],
      relationshipRows: [
        { status: "pending_company" },
        { status: "pending_company" },
        { status: "pending_company" },
      ],
    })).toBe(1);
  });
});
