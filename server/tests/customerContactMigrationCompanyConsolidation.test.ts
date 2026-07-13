import { describe, expect, test } from "@jest/globals";
import { buildConsolidatedCompanySourceDrafts } from "../services/customerContactMigration/service";
import { matchCompany, normalizeCompanyName } from "../services/customerContactMigration/matching";

describe("customer/contact migration company source consolidation", () => {
  test("classifies a valid InfoFlo-only prospect as createable without QuickBooks", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [],
      [{ "Entry Id": "IF-PROSPECT", Name: "Prospect Print Buyer", Email: "buyer@example.com" }],
    );

    expect(result.summary.infoFloOnlyCompanies).toBe(1);
    expect(result.summary.quickBooksOnlyCompanies).toBe(0);
    expect(result.summary.rejectedCompanies).toBe(0);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      sourceSystem: "infoflo",
      sourceRecordId: "IF-PROSPECT",
      quickBooksCustomerId: null,
    });
    expect(result.drafts[0].forcedMatch).toBeUndefined();
    expect(result.drafts[0].normalized.permanentPatch).not.toHaveProperty("externalAccountingId");
  });

  test("keeps contacts for an InfoFlo-only company eligible for one relationship target", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [],
      [{ "Entry Id": "IF-PROSPECT", Name: "Prospect Print Buyer" }],
    );
    const companyByNormalizedName = new Map<string, number>();
    for (const draft of result.drafts) {
      const key = normalizeCompanyName(draft.normalized.name);
      companyByNormalizedName.set(key, (companyByNormalizedName.get(key) ?? 0) + 1);
    }

    expect(companyByNormalizedName.get(normalizeCompanyName("Prospect Print Buyer"))).toBe(1);
  });

  test("lets an InfoFlo-only company later link to QuickBooks by normalized name", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [{ Id: "QB-LATER", DisplayName: "Prospect Print Buyer LLC", CompanyName: "Prospect Print Buyer LLC" }],
      [{ "Entry Id": "IF-PROSPECT", Name: "Prospect Print Buyer Inc" }],
    );

    expect(result.summary.quickBooksInfoFloCompanyMatches).toBe(1);
    expect(result.summary.infoFloOnlyCompanies).toBe(0);
    expect(result.drafts[0].quickBooksCustomerId).toBe("QB-LATER");
  });

  test("consolidates QuickBooks and InfoFlo companies by exact company name match", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [{ Id: "QB-1", DisplayName: "Brainstorm Print", CompanyName: "Brainstorm Print" }],
      [{ "Entry Id": "IF-1", Name: "Brainstorm Print" }],
    );

    expect(result.summary.quickBooksInfoFloCompanyMatches).toBe(1);
    expect(result.summary.unmatchedQuickBooksCompanies).toBe(0);
    expect(result.summary.unmatchedInfoFloCompanies).toBe(0);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      sourceSystem: "infoflo",
      sourceRecordId: "IF-1",
      quickBooksCustomerId: "QB-1",
    });
  });

  test("consolidates company names with normalized LLC and Inc suffix differences", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [{ Id: "QB-2", DisplayName: "Elite Printing LLC", CompanyName: "Elite Printing LLC" }],
      [{ "Entry Id": "IF-2", Name: "Elite Printing Inc" }],
    );

    expect(result.summary.quickBooksInfoFloCompanyMatches).toBe(1);
    expect(result.drafts).toHaveLength(1);
    expect(normalizeCompanyName(result.drafts[0].normalized.name)).toBe("elite printing");
  });

  test("consolidates by InfoFlo QuickBooks Customer Name even when InfoFlo company name differs", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [{ Id: "QB-3", DisplayName: "Elite Printing", CompanyName: "Elite Printing" }],
      [{ "Entry Id": "IF-3", Name: "Elite Print Shop", "QuickBooks Customer Name": "Elite Printing" }],
    );

    expect(result.summary.quickBooksInfoFloCompanyMatches).toBe(1);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].normalized.quickBooksCustomerId).toBe("QB-3");
    expect(result.drafts[0].normalized.quickBooksCustomerName).toBe("Elite Printing");
  });

  test("keeps duplicate staged company names ambiguous instead of consolidating arbitrarily", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [
        { Id: "QB-4A", DisplayName: "Apex Signs LLC", CompanyName: "Apex Signs LLC" },
        { Id: "QB-4B", DisplayName: "Apex Signs Inc", CompanyName: "Apex Signs Inc" },
      ],
      [{ "Entry Id": "IF-4", Name: "Apex Signs Co" }],
    );

    expect(result.summary.quickBooksInfoFloCompanyMatches).toBe(0);
    expect(result.summary.ambiguousCompanyMatches).toBe(1);
    expect(result.summary.unmatchedQuickBooksCompanies).toBe(2);
    expect(result.summary.unmatchedInfoFloCompanies).toBe(0);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts[0].forcedMatch?.status).toBe("ambiguous");
  });

  test("rejects blank and system InfoFlo company records instead of treating them as prospects", () => {
    const blank = buildConsolidatedCompanySourceDrafts([], [{ "Entry Id": "IF-BLANK", Name: "" }]);
    const system = buildConsolidatedCompanySourceDrafts([], [{ "Entry Id": "IF-SYSTEM", Name: "Test Company" }]);

    expect(blank.summary.rejectedCompanies).toBe(1);
    expect(blank.drafts[0].forcedMatch?.status).toBe("rejected");
    expect(blank.drafts[0].warnings).toContain("InfoFlo company name is blank or malformed.");
    expect(system.summary.rejectedCompanies).toBe(1);
    expect(system.drafts[0].forcedMatch?.status).toBe("rejected");
    expect(system.drafts[0].warnings).toContain("InfoFlo company appears to be a system/test record.");
  });

  test("rerun matches InfoFlo Entry ID without creating a duplicate company", () => {
    const result = matchCompany(
      { name: "Prospect Print Buyer", sourceRecordId: "IF-PROSPECT" },
      [{ id: "cust_existing", companyName: "Prospect Print Buyer" }],
      [{
        entityType: "customer",
        entityId: "cust_existing",
        sourceSystem: "infoflo",
        sourceEntityType: "company",
        sourceRecordId: "IF-PROSPECT",
      }],
    );

    expect(result.status).toBe("matched");
    expect(result.selectedId).toBe("cust_existing");
  });

  test("relationship matching sees one company after QuickBooks and InfoFlo consolidation", () => {
    const result = buildConsolidatedCompanySourceDrafts(
      [{ Id: "QB-5", DisplayName: "Brainstorm Print LLC", CompanyName: "Brainstorm Print LLC" }],
      [{ "Entry Id": "IF-5", Name: "Brainstorm Print Inc" }],
    );
    const companyByNormalizedName = new Map<string, number>();
    for (const draft of result.drafts) {
      const key = normalizeCompanyName(draft.normalized.name);
      companyByNormalizedName.set(key, (companyByNormalizedName.get(key) ?? 0) + 1);
    }

    expect(companyByNormalizedName.get(normalizeCompanyName("Brainstorm Print"))).toBe(1);
  });
});
