import { beforeAll, describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../supabaseStorage", () => ({
  isSupabaseConfigured: jest.fn(() => true),
}));

let storageTarget: typeof import("../services/storageTarget");

beforeAll(async () => {
  storageTarget = await import("../services/storageTarget");
});

const MB = 1024 * 1024;
const production = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const development = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

function targetFor(fileName: string, fileSizeBytes: number, environment: NodeJS.ProcessEnv = production) {
  return storageTarget.decideStorageTarget({
    fileName,
    fileSizeBytes,
    providerConfigJson: { routingMode: "auto" },
    environment,
  });
}

describe("Titan-managed storage routing", () => {
  test.each([5, 50, 75, 150, 500])(
    "production automatic routing keeps a %d MB artwork file durable",
    (megabytes) => {
      expect(targetFor(`artwork-${megabytes}.pdf`, megabytes * MB)).toBe("supabase");
    },
  );

  test("production routing is format-independent", () => {
    const sizeBytes = 150 * MB;
    expect(targetFor("artwork.jpg", sizeBytes)).toBe("supabase");
    expect(targetFor("artwork.pdf", sizeBytes)).toBe("supabase");
    expect(targetFor("artwork.tiff", sizeBytes)).toBe("supabase");
    expect(targetFor("artwork.psd", sizeBytes)).toBe("supabase");
  });

  test("development automatic routing may retain the legacy local fallback", () => {
    expect(targetFor("development-large.psd", 75 * MB, development)).toBe("local_dev");
  });

  test("an explicit production local target remains rejected", () => {
    const target = storageTarget.decideStorageTarget({
      fileSizeBytes: 5 * MB,
      requestedTarget: "local_dev",
      providerConfigJson: { routingMode: "auto" },
      environment: production,
    });
    expect(target).toBe("local_dev");
    expect(() => storageTarget.assertDurableCanonicalStorageTarget(target, production)).toThrow(
      "A durable object-storage target is required for production uploads",
    );
  });

  test("an explicit durable-provider maximum fails clearly before upload staging", () => {
    const providerConfigJson = { maxDurableUploadBytesOverride: 100 * MB };
    expect(() => storageTarget.assertDurableUploadWithinLimit({
      fileSizeBytes: 150 * MB,
      providerConfigJson,
    })).toThrow("configured durable artwork storage limit");

    try {
      storageTarget.assertDurableUploadWithinLimit({ fileSizeBytes: 150 * MB, providerConfigJson });
    } catch (error: any) {
      expect(error.code).toBe("DURABLE_UPLOAD_LIMIT_EXCEEDED");
      expect(error.statusCode).toBe(413);
      expect(error.maxUploadBytes).toBe(100 * MB);
    }
  });
});
