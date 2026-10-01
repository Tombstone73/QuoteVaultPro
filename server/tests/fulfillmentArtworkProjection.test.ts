import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { fileDerivatives, fileRecords, type FileDerivative } from "@shared/schema";
import type { ResolvedLineItemArtwork } from "../services/artwork/LineItemArtworkReadResolver";

const defaultSelect = jest.fn<(...args: any[]) => any>();
jest.unstable_mockModule("../db", () => ({ db: { select: defaultSelect } }));

let buildFulfillmentArtworkProjection: typeof import("../services/artwork/FulfillmentArtworkProjection").buildFulfillmentArtworkProjection;
beforeAll(async () => {
  ({ buildFulfillmentArtworkProjection } = await import("../services/artwork/FulfillmentArtworkProjection"));
});
beforeEach(() => jest.clearAllMocks());

function canonical(fileRecordId: string, overrides: Partial<ResolvedLineItemArtwork> = {}): ResolvedLineItemArtwork {
  return {
    id: `rel_${fileRecordId}`,
    relationshipId: `rel_${fileRecordId}`,
    lineItemId: "line_1",
    orderId: "order_1",
    fileRecordId,
    role: "customer_source",
    status: "current",
    side: "front",
    origin: "staff_upload",
    parentArtworkId: null,
    supersedesArtworkId: null,
    createdAt: new Date("2026-01-01"),
    allocationQuantity: null,
    allocationGroupId: null,
    source: "canonical",
    file: { originalFilename: "logo.ai", mimeType: "application/postscript", sizeBytes: 4096, contentPath: `/api/artwork/file-records/${fileRecordId}/content` },
    ...overrides,
  };
}

function derivative(fileRecordId: string, overrides: Partial<FileDerivative> = {}): FileDerivative {
  return {
    id: "derivative_1", fileRecordId, derivativeType: "preview", state: "ready",
    sourcePlacementId: "placement_1", bucket: "private-bucket", objectKey: "secret/object.png",
    mimeType: "image/png", sizeBytes: 123, errorText: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function executorFor(rows: FileDerivative[]) {
  const chain = {
    from: jest.fn<(...args: any[]) => any>(),
    innerJoin: jest.fn<(...args: any[]) => any>(),
    where: jest.fn<(...args: any[]) => any>(),
    orderBy: jest.fn<(...args: any[]) => Promise<FileDerivative[]>>().mockResolvedValue(rows),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  const executor = {
    select: jest.fn<(...args: any[]) => any>().mockReturnValue(chain),
    insert: jest.fn(() => { throw new Error("Unexpected write"); }),
    update: jest.fn(() => { throw new Error("Unexpected write"); }),
    delete: jest.fn(() => { throw new Error("Unexpected write"); }),
  };
  return { executor, chain };
}

describe("fulfillment artwork metadata projection", () => {
  test("empty canonical artwork returns [] without querying or workflow fallback", async () => {
    const { executor } = executorFor([]);
    expect(await buildFulfillmentArtworkProjection("org_1", [], executor)).toEqual([]);
    expect(await buildFulfillmentArtworkProjection("org_1", [])).toEqual([]);
    expect(executor.select).not.toHaveBeenCalled();
    expect(defaultSelect).not.toHaveBeenCalled();
  });

  test("batches unique authorized IDs and scopes derivatives through tenant-owned file records", async () => {
    const { executor, chain } = executorFor([]);
    const items = [canonical("file_1"), canonical("file_2"), canonical("file_1", { relationshipId: "rel_duplicate" })];
    await buildFulfillmentArtworkProjection("org_7", items, executor);
    expect(executor.select).toHaveBeenCalledTimes(1);
    expect(chain.from).toHaveBeenCalledWith(fileDerivatives);
    expect(chain.innerJoin.mock.calls[0][0]).toBe(fileRecords);
    const dialect = new PgDialect();
    const join = dialect.sqlToQuery(chain.innerJoin.mock.calls[0][1]);
    expect(join.sql).toContain('"file_records"."id" = "file_derivatives"."file_record_id"');
    expect(join.sql).toContain('"file_records"."organization_id" =');
    expect(join.params).toEqual(["org_7"]);
    const where = dialect.sqlToQuery(chain.where.mock.calls[0][0]);
    expect(where.sql).toContain('"file_derivatives"."file_record_id" in');
    expect(where.sql).toContain('"file_derivatives"."derivative_type" in');
    expect(where.params).toEqual(["file_1", "file_2", "preview", "thumbnail"]);
    expect(chain.orderBy.mock.calls[0].map((sql) => dialect.sqlToQuery(sql).sql)).toEqual([
      '"file_derivatives"."updated_at" desc', '"file_derivatives"."created_at" desc',
    ]);
    expect(executor.insert).not.toHaveBeenCalled();
    expect(executor.update).not.toHaveBeenCalled();
    expect(executor.delete).not.toHaveBeenCalled();
    expect(defaultSelect).not.toHaveBeenCalled();
  });

  test("preserves identity, metadata and input ranking with authenticated URLs and null legacy keys", async () => {
    const { executor } = executorFor([derivative("file/1", { derivativeType: "thumbnail" })]);
    const items = [canonical("file/1"), canonical("file_2", { role: "modified_production", side: "back", lineItemId: "line_2" })];
    const result = await buildFulfillmentArtworkProjection("org_1", items, executor);
    expect(result.map((item) => item.role)).toEqual(["customer_source", "modified_production"]);
    expect(result[0]).toEqual({
      id: "rel_file/1", relationshipId: "rel_file/1", fileRecordId: "file/1", fileName: "logo.ai",
      mimeType: "application/postscript", sizeBytes: 4096, side: "front", role: "customer_source", source: "canonical",
      fileUrl: "/api/artwork/file-records/file%2F1/content", originalUrl: "/api/artwork/file-records/file%2F1/content",
      downloadUrl: "/api/artwork/file-records/file%2F1/content?download=1",
      previewUrl: "/api/artwork/file-records/file%2F1/content?variant=preview",
      thumbUrl: "/api/artwork/file-records/file%2F1/content?variant=thumbnail",
      thumbnailUrl: "/api/artwork/file-records/file%2F1/content?variant=thumbnail",
      thumbKey: null, previewKey: null, objectPath: null,
      previewStatus: null, previewError: null, thumbnailStatus: "ready",
    });
    expect(JSON.stringify(result)).not.toContain("private-bucket");
    expect(JSON.stringify(result)).not.toContain("secret/object.png");
    expect(items[0].file.contentPath).toBe("/api/artwork/file-records/file/1/content");
  });

  test("prefers usable ready over newer pending/failed, pending over failed, and newest equal state", async () => {
    // Executor rows model the repository's descending updatedAt/createdAt order.
    const { executor } = executorFor([
      derivative("ready", { state: "failed", errorText: "preview_generation_failed" }),
      derivative("ready", { state: "pending", objectKey: null }),
      derivative("ready"),
      derivative("pending", { state: "failed" }),
      derivative("pending", { state: "pending", objectKey: null }),
      derivative("failed", { state: "failed", errorText: "preview_unsupported_eps" }),
      derivative("failed", { state: "failed", errorText: "preview_generation_failed" }),
    ]);
    const result = await buildFulfillmentArtworkProjection("org_1", [canonical("ready"), canonical("pending"), canonical("failed")], executor);
    expect(result.map((item) => [item.previewStatus, item.previewError])).toEqual([
      ["ready", null], ["pending", null], ["failed", "preview_unsupported_eps"],
    ]);
  });

  test("missing, replaced and keyless ready derivatives do not claim readiness from URLs", async () => {
    const { executor } = executorFor([
      derivative("replaced", { state: "replaced" }),
      derivative("keyless", { objectKey: null }),
      derivative("blank", { objectKey: "" }),
      derivative("retry", { objectKey: null }),
      derivative("retry", { state: "pending", objectKey: null }),
      derivative("thumbnail_only", { derivativeType: "thumbnail" }),
    ]);
    const result = await buildFulfillmentArtworkProjection("org_1", ["missing", "replaced", "keyless", "blank", "retry", "thumbnail_only"].map((id) => canonical(id)), executor);
    expect(result.map((item) => item.previewStatus)).toEqual([null, null, null, null, "pending", null]);
    expect(result.map((item) => item.thumbnailStatus)).toEqual([null, null, null, null, null, "ready"]);
    expect(result.every((item) => !!item.previewUrl && !!item.thumbnailUrl)).toBe(true);
  });

  test.each([null, "Failed reading s3://private/token?secret=123", "preview_failed\nsecret", "preview_failed\n", `preview_${"a".repeat(65)}`])(
    "reduces unsafe failure text %p to a generic code without leaking details", async (errorText) => {
      const { executor } = executorFor([derivative("file_1", { state: "failed", errorText })]);
      const [result] = await buildFulfillmentArtworkProjection("org_1", [canonical("file_1")], executor);
      expect(result.previewStatus).toBe("failed");
      expect(result.previewError).toBe("preview_generation_failed");
    },
  );

  test.each(["pending", "failed"] as const)("keeps thumbnail %s independent from a ready preview", async (state) => {
    const { executor } = executorFor([
      derivative("file_1"),
      derivative("file_1", { derivativeType: "thumbnail", state, objectKey: null, errorText: "private thumbnail failure" }),
    ]);
    const [result] = await buildFulfillmentArtworkProjection("org_1", [canonical("file_1")], executor);
    expect(result).toMatchObject({ previewStatus: "ready", previewError: null, thumbnailStatus: state });
    expect(JSON.stringify(result)).not.toContain("private thumbnail failure");
  });

  test("uses the mocked default db executor when none is supplied", async () => {
    const { executor } = executorFor([derivative("file_1", { state: "pending", objectKey: null })]);
    defaultSelect.mockImplementation(executor.select);
    const [result] = await buildFulfillmentArtworkProjection("org_1", [canonical("file_1")]);
    expect(defaultSelect).toHaveBeenCalledTimes(1);
    expect(result.previewStatus).toBe("pending");
  });

  test("uses canonical original size and null filename fallback without derivative substitution", async () => {
    const { executor } = executorFor([derivative("file_1")]);
    const [result] = await buildFulfillmentArtworkProjection("org_1", [canonical("file_1", {
      file: { originalFilename: null, mimeType: null, sizeBytes: null, contentPath: "/not-a-storage-url" },
    })], executor);
    expect(result).toMatchObject({ fileName: "rel_file_1", mimeType: null, sizeBytes: null, previewStatus: "ready" });
  });
});
