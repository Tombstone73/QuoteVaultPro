import { describe, expect, test } from "@jest/globals";
import { CustomerContactMigrationService } from "../services/customerContactMigration/service";

const service = new CustomerContactMigrationService({} as any);

function batch(overrides: Partial<{
  companyRows: Array<Record<string, any>>;
  contactRows: Array<Record<string, any>>;
  relationshipRows: Array<Record<string, any>>;
}> = {}) {
  return {
    batch: { id: "batch_1" },
    companyRows: overrides.companyRows ?? [],
    contactRows: overrides.contactRows ?? [],
    relationshipRows: overrides.relationshipRows ?? [],
  } as any;
}

function nonEmptyLines(csv: string) {
  return csv.split(/\r\n/).filter((line) => line.length > 0);
}

describe("customer/contact migration CSV reports", () => {
  test("zero-row exports include the correct header and non-zero file size", () => {
    const completed = service.buildReportCsv("completed-mappings", "batch_1", batch());
    const failed = service.buildReportCsv("failed-records", "batch_1", batch());

    expect(completed).not.toBeNull();
    expect(failed).not.toBeNull();
    expect(completed!.body).toBe("type,rowNumber,sourceRecordId,entityId,linkId,customerId,contactId\r\n");
    expect(failed!.body).toBe("type,rowNumber,sourceRecordId,error\r\n");
    expect(Buffer.byteLength(completed!.body, "utf8")).toBeGreaterThan(0);
    expect(Buffer.byteLength(failed!.body, "utf8")).toBeGreaterThan(0);
  });

  test("one-row completed mapping export writes one data row with stable headers", () => {
    const report = service.buildReportCsv("completed-mappings", "batch_1", batch({
      companyRows: [{
        status: "imported",
        rowNumber: 7,
        sourceRecordId: "QB-7",
        selectedCustomerId: "cust_7",
      }],
    }));

    expect(report).not.toBeNull();
    expect(nonEmptyLines(report!.body)).toEqual([
      "type,rowNumber,sourceRecordId,entityId,linkId,customerId,contactId",
      "company,7,QB-7,cust_7,,,",
    ]);
  });

  test("many-row failed records export writes all matching row types", () => {
    const report = service.buildReportCsv("failed-records", "batch_1", batch({
      companyRows: [{ status: "failed", rowNumber: 1, sourceRecordId: "company_1", errorMessage: "Company failed" }],
      contactRows: [{ status: "failed", rowNumber: 2, sourceRecordId: "contact_2", errorMessage: "Contact failed" }],
      relationshipRows: [{ status: "failed", sourceRecordId: "relationship_3", errorMessage: "Relationship failed" }],
    }));

    expect(report).not.toBeNull();
    expect(nonEmptyLines(report!.body)).toEqual([
      "type,rowNumber,sourceRecordId,error",
      "company,1,company_1,Company failed",
      "contact,2,contact_2,Contact failed",
      "relationship,,relationship_3,Relationship failed",
    ]);
  });

  test("download metadata uses CSV content type and attachment disposition", () => {
    const report = service.buildReportCsv("completed-mappings", "batch_1", batch());

    expect(report).not.toBeNull();
    expect(report!.contentType).toBe("text/csv; charset=utf-8");
    expect(report!.contentDisposition).toBe('attachment; filename="completed-mappings-batch_1.csv"');
  });

  test("all report kinds produce non-empty empty-result CSVs", () => {
    for (const kind of ["completed-mappings", "exceptions", "rejected-records", "conflicts", "failed-records"]) {
      const report = service.buildReportCsv(kind, "batch_1", batch());
      expect(report).not.toBeNull();
      expect(report!.body).toContain("\r\n");
      expect(Buffer.byteLength(report!.body, "utf8")).toBeGreaterThan(0);
    }
  });
});
