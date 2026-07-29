import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

describe("storage placement copy contract", () => {
  const root = process.cwd();
  const storageService = fs.readFileSync(path.join(root, "server/services/storage/StorageApplicationService.ts"), "utf8");
  const adapterContract = fs.readFileSync(path.join(root, "server/services/storage/adapters/StorageProviderAdapter.ts"), "utf8");
  const supabaseAdapter = fs.readFileSync(path.join(root, "server/services/storage/adapters/SupabaseStorageAdapter.ts"), "utf8");
  const localAdapter = fs.readFileSync(path.join(root, "server/services/storage/adapters/LocalFilesystemStorageAdapter.ts"), "utf8");
  const s3Adapter = fs.readFileSync(path.join(root, "server/services/storage/adapters/S3CompatibleStorageAdapter.ts"), "utf8");
  const titanAdapter = fs.readFileSync(path.join(root, "server/services/storage/adapters/TitanManagedStorageAdapter.ts"), "utf8");
  const prepressService = fs.readFileSync(path.join(root, "server/prepressFileService.ts"), "utf8");
  const prepressRoute = fs.readFileSync(path.join(root, "server/routes/prepressFiles.routes.ts"), "utf8");

  test("production artwork copy resolves the source file record and active placement", () => {
    expect(storageService).toContain('kind: "existing-file-record"');
    expect(storageService).toContain("fileRecordRepository.getByIdForOrganization");
    expect(storageService).toContain("storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId");
    expect(storageService).toContain("storageProviderConfigRepository.getByIdForOrganization");
    expect(prepressService).toContain('kind: "existing-file-record"');
  });

  test("same-provider copies use provider-native copy when supported", () => {
    expect(adapterContract).toContain("copyObjectWithinProvider?");
    expect(storageService).toContain("sourceProviderConfig.id === providerConfig.id");
    expect(storageService).toContain("copy_existing_placement");
    expect(supabaseAdapter).toContain("service.copyFile");
    expect(s3Adapter).toContain("CopyObjectCommand");
    expect(localAdapter).toContain("fs.copyFile");
    expect(titanAdapter).toContain("supabase.copyFile");
  });

  test("different providers fall back to byte copy through the source adapter", () => {
    expect(adapterContract).toContain("readObject(input");
    expect(storageService).toContain("read_existing_placement");
    expect(storageService).toContain("sourceAdapter.readObject");
    expect(storageService).toContain("adapter.putObject");
    expect(supabaseAdapter).toContain("downloadFile");
    expect(localAdapter).toContain("fs.readFile");
    expect(s3Adapter).toContain("GetObjectCommand");
  });

  test("source and destination failure codes are stable and actionable", () => {
    expect(storageService).toContain("SOURCE_ARTWORK_NOT_FOUND");
    expect(storageService).toContain("SOURCE_STORAGE_PLACEMENT_MISSING");
    expect(storageService).toContain("SOURCE_STORAGE_READ_FAILED");
    expect(storageService).toContain("PRODUCTION_ARTWORK_WRITE_FAILED");
    expect(storageService).toContain("PRODUCTION_ARTWORK_VERIFY_FAILED");
  });

  test("destination verification happens before linked production records are persisted", () => {
    expect(storageService.indexOf('stage = "verify_object"')).toBeLessThan(storageService.indexOf('stage = "persist_canonical_records"'));
    expect(storageService).toContain("await adapter.verifyObject");
    expect(storageService).toContain("await adapter.deleteObject");
  });

  test("promotion keeps duplicate protection and original-file preservation", () => {
    expect(prepressRoute).toContain("PRODUCTION_ARTWORK_ALREADY_EXISTS");
    expect(prepressService).toContain("productionArtworkSourceType");
    expect(prepressService).toContain("sourceFileId");
    expect(prepressService).toContain("sourceOrderAttachmentId");
    expect(prepressService).not.toContain(".update(orderAttachments)");
  });
});
