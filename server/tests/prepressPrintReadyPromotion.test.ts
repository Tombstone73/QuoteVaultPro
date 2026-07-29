import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { buildFileUploadDisplayFilename } from "@shared/fileUploadNaming";

describe("Prepress print-ready promotion contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/prepressFileService.ts"), "utf8");
  const route = fs.readFileSync(path.join(root, "server/routes/prepressFiles.routes.ts"), "utf8");
  const schema = fs.readFileSync(path.join(root, "shared/schema.ts"), "utf8");
  const migration = fs.readFileSync(path.join(root, "server/db/migrations_v2/0157_line_item_file_promotion_source.sql"), "utf8");

  test("promoted production artwork records source provenance without mutating the source", () => {
    expect(service).toContain("promoteCustomerArtworkToProductionArtwork");
    expect(service).toContain("productionArtworkSourceType: params.source.sourceType ? \"customer_artwork_promotion\" : null");
    expect(service).toContain("sourceFileId: params.source.sourceFileId ?? null");
    expect(service).toContain("sourceOrderAttachmentId: params.source.sourceOrderAttachmentId ?? null");
    expect(service).toContain("sourceArtworkSide: params.source.sourceArtworkSide ?? null");
    expect(service).toContain("role: \"final\" as const");
    expect(service).not.toContain(".update(orderAttachments)");
  });

  test("customer artwork promotion creates a distinct canonical production copy", () => {
    expect(service).toContain("storageApplicationService.finalizeUpload");
    expect(service).toContain("kind: \"existing-file-record\"");
    expect(service).toContain("SOURCE_STORAGE_PLACEMENT_MISSING");
    expect(service).toContain("fileRecordId: result.fileRecord.id");
    expect(service).toContain("queueLineItemFilePreviewRepair");
    expect(service).toContain("enqueueFinalProductionFileCopy");
  });

  test("promotion is idempotent and auditable", () => {
    expect(route).toContain("PRODUCTION_ARTWORK_ALREADY_EXISTS");
    expect(service).toContain("promoted_customer_artwork_to_production_artwork");
    expect(schema).toContain("productionArtworkSourceType");
    expect(schema).toContain("sourceFileId");
    expect(schema).toContain("sourceOrderAttachmentId");
    expect(migration).toContain("line_item_files_active_promoted_source_uidx");
    expect(migration).toContain("COALESCE(source_artwork_side, 'na'::file_side)");
    expect(migration).not.toContain("source_artwork_side::text");
    expect(migration).toContain("COALESCE(source_file_id, '')");
    expect(migration).toContain("COALESCE(source_order_attachment_id, '')");
  });

  test("production filename places job number before production tag", () => {
    expect(
      buildFileUploadDisplayFilename({
        originalFilename: "customer-art.pdf",
        fullJobNumber: "ORD-20000",
        numericJobNumber: "20000",
        fileUploadJobPrefixMode: "full_job_number",
        prepressLabel: "print",
        labelPlacement: "after_job_prefix",
      }),
    ).toBe("ORD-20000_PRINT_customer-art.pdf");
  });

  test("artwork side resolution still fails closed for ambiguous double-sided artwork", () => {
    expect(service).toContain("needs explicit Front and Back artwork");
    expect(service).toContain("Assign the production artwork as Front, Back, or Both");
    expect(service).toContain("resolvePrintReadyArtworkCandidates");
  });
});
