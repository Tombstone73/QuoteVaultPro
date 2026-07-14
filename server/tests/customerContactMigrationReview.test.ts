import { describe, expect, test } from "@jest/globals";
import {
  buildCompanyReviewPatch,
  buildContactReviewPatch,
  buildDependentContactPatchAfterCompanyDecision,
  buildFinalizePreviewCounts,
  buildHydratedStagedCompanyCandidate,
  buildRelationshipPatchAfterCompanyDecision,
  buildStagedConsolidationCompanyPatch,
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

  test("permanent company merge cannot be triggered from staged migration review", () => {
    expect(() => buildCompanyReviewPatch({
      status: "ambiguous",
      matchCandidatesJson: [
        { id: "cust_duplicate_a", score: 82, reason: "Ambiguous normalized company name" },
        { id: "cust_duplicate_b", score: 82, reason: "Ambiguous normalized company name" },
      ],
    }, { action: "merge_duplicate", selectedEntityId: "cust_duplicate_a", actorUserId: "platform_dev" } as any))
      .toThrow("Permanent company merge is not available");
  });

  test("staged selection without loaded candidate records fails safely", () => {
    expect(() => buildCompanyReviewPatch({
      status: "ambiguous",
      matchCandidatesJson: [{ id: "299", score: 88, reason: "QuickBooks duplicate candidate" }],
    }, { action: "select_staged", selectedEntityId: "299", actorUserId: "platform_dev" } as any))
      .toThrow("Staged consolidation requires selected staged candidate records");
  });

  test("hydrates staged QuickBooks company candidate details", () => {
    const candidate = buildHydratedStagedCompanyCandidate({
      id: "299",
      sourceSystem: "quickbooks",
      sourceRecordId: "299",
      quickBooksCustomerId: "299",
      selectedCustomerId: "cust_existing",
      rawJson: {
        Id: "299",
        CompanyName: "Adapt Media Inc",
        DisplayName: "Adapt Media",
        FullyQualifiedName: "Adapt Media Parent:Adapt Media",
        Job: true,
        ParentRef: { value: "300", name: "Adapt Media Parent" },
        Active: true,
        BillAddr: {
          Line1: "123 Print Way",
          City: "Toronto",
          CountrySubDivisionCode: "ON",
          PostalCode: "M5V 1A1",
        },
        PrimaryPhone: { FreeFormNumber: "555-0101" },
        PrimaryEmailAddr: { Address: "billing@adapt.example" },
        TermRef: { name: "Net 30" },
        Balance: "123.45",
      },
      normalizedJson: {},
    }, [
      { id: "contact-landon", normalizedJson: { firstName: "Landon", lastName: "Wieler" } },
      { id: "contact-jamie", normalizedJson: { firstName: "Jamie", lastName: "Davine" } },
    ]);

    expect(candidate).toMatchObject({
      id: "299",
      candidateType: "staged_company",
      selectable: true,
      stagedRecordId: "299",
      sourceSystem: "quickbooks",
      sourceRecordId: "299",
      quickBooksCustomerId: "299",
      companyName: "Adapt Media Inc",
      displayName: "Adapt Media",
      fullyQualifiedName: "Adapt Media Parent:Adapt Media",
      parentCustomerId: "300",
      parentCustomerName: "Adapt Media Parent",
      isSubCustomer: true,
      active: true,
      address: "123 Print Way",
      city: "Toronto",
      state: "ON",
      postalCode: "M5V 1A1",
      phone: "555-0101",
      email: "billing@adapt.example",
      paymentTerms: "Net 30",
      balance: 123.45,
      existingPrintersHeroCustomerId: "cust_existing",
    });
    expect(candidate.dependentContacts).toHaveLength(2);
    expect(candidate.externalIdentityMappings).toContainEqual({
      sourceSystem: "quickbooks",
      sourceEntityType: "customer",
      sourceRecordId: "299",
    });
  });

  test("selecting one staged candidate records a dry-run company decision", () => {
    const patch = buildStagedConsolidationCompanyPatch({
      id: "company-review",
      sourceSystem: "infoflo",
      sourceRecordId: "IF-ADAPT",
      normalizedJson: { name: "Adapt Media" },
    }, [{
      id: "299",
      sourceSystem: "quickbooks",
      sourceRecordId: "299",
      rawJson: { Id: "299", CompanyName: "Adapt Media Inc", DisplayName: "Adapt Media" },
      normalizedJson: {},
    }], "platform_dev", "select_staged");

    expect(patch).toMatchObject({
      status: "new_company",
      selectedCustomerId: null,
      errorMessage: null,
    });
    expect(patch.normalizedJson.quickBooksCustomerId).toBe("299");
    expect(patch.reviewDecisionJson).toMatchObject({
      action: "select_staged",
      selectedEntityIds: ["299"],
      decidedByUserId: "platform_dev",
    });
  });

  test("consolidating staged candidates preserves source IDs and reports conflicts", () => {
    const patch = buildStagedConsolidationCompanyPatch({
      id: "company-review",
      sourceSystem: "infoflo",
      sourceRecordId: "IF-ADAPT",
      normalizedJson: { name: "Adapt Media", additionalInfoFloSourceRecordIds: ["IF-ADAPT-2"] },
    }, [
      {
        id: "299",
        sourceSystem: "quickbooks",
        sourceRecordId: "299",
        rawJson: { Id: "299", CompanyName: "Adapt Media Inc", DisplayName: "Adapt Media", PrimaryEmailAddr: { Address: "billing@adapt.example" } },
        normalizedJson: {},
      },
      {
        id: "300",
        sourceSystem: "quickbooks",
        sourceRecordId: "300",
        rawJson: { Id: "300", CompanyName: "Adapt Media", DisplayName: "Adapt Media Parent", PrimaryEmailAddr: { Address: "orders@adapt.example" } },
        normalizedJson: {},
      },
    ], "platform_dev", "consolidate_staged");

    expect(patch.status).toBe("new_company");
    expect(patch.normalizedJson.quickBooksCustomerId).toBe("299");
    expect(patch.normalizedJson.additionalQuickBooksCustomerIds).toEqual(["300"]);
    expect(patch.normalizedJson.additionalInfoFloSourceRecordIds).toEqual(["IF-ADAPT-2"]);
    expect(patch.normalizedJson.stagedConsolidation.quickBooksCustomerIds).toEqual(["299", "300"]);
    expect(patch.normalizedJson.stagedConsolidation.conflicts).toContain("companyName");
    expect(patch.normalizedJson.stagedConsolidation.conflicts).toContain("email");
    expect(patch.reviewDecisionJson).toMatchObject({
      action: "consolidate_staged",
      selectedEntityIds: ["299", "300"],
      quickBooksCustomerIds: ["299", "300"],
    });
  });

  test("links a contact to a searched company independently of person matching", () => {
    const patch = buildContactReviewPatch({
      status: "company_ambiguous",
      selectedContactId: "contact_existing",
    }, { action: "link_company", selectedEntityId: "company_299", actorUserId: "platform_dev" });

    expect(patch).toMatchObject({
      status: "company_matched",
      selectedContactId: "contact_existing",
      selectedCustomerId: "company_299",
      errorMessage: null,
    });
    expect(patch.reviewDecisionJson).toMatchObject({
      action: "link_company",
      selectedEntityId: "company_299",
    });
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
