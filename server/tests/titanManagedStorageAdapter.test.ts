import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";

const getSignedUploadUrl = jest.fn(async () => ({
  url: "https://storage.example.test/upload",
  path: "uploads/test-object",
  token: "test-token",
}));

jest.unstable_mockModule("../supabaseStorage", () => ({
  isSupabaseConfigured: jest.fn(() => true),
  SupabaseStorageService: class {
    getSignedUploadUrl = getSignedUploadUrl;
  },
}));

let TitanManagedStorageAdapter: typeof import("../services/storage/adapters/TitanManagedStorageAdapter").TitanManagedStorageAdapter;
const originalNodeEnv = process.env.NODE_ENV;
const MB = 1024 * 1024;

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  ({ TitanManagedStorageAdapter } = await import("../services/storage/adapters/TitanManagedStorageAdapter"));
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

function providerConfig(configJson: Record<string, unknown> = {}) {
  return {
    id: "storage-config-1",
    organizationId: "org-1",
    providerType: "titan_managed",
    role: "canonical",
    status: "validated",
    displayName: "Titan managed",
    configJson: { routingMode: "auto", ...configJson },
  } as any;
}

describe("TitanManagedStorageAdapter production routing", () => {
  test.each([5, 50, 75, 150, 500])("initiates a durable upload for %d MB", async (megabytes) => {
    const result = await new TitanManagedStorageAdapter().initiateUpload({
      organizationId: "org-1",
      fileName: `artwork-${megabytes}.jpg`,
      fileSizeBytes: megabytes * MB,
      providerConfig: providerConfig(),
    });

    expect(result.storageTarget).toBe("supabase");
    expect(result.method).toBe("PUT");
  });

  test("rejects a configured durable size limit before chunk staging", async () => {
    await expect(new TitanManagedStorageAdapter().initiateUpload({
      organizationId: "org-1",
      fileName: "oversized.tiff",
      fileSizeBytes: 150 * MB,
      providerConfig: providerConfig({ maxDurableUploadBytesOverride: 100 * MB }),
    })).rejects.toMatchObject({
      code: "DURABLE_UPLOAD_LIMIT_EXCEEDED",
      statusCode: 413,
      maxUploadBytes: 100 * MB,
    });
  });
});
