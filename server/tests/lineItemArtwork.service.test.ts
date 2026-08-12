import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const lineItemArtworkRepository = {};
jest.unstable_mockModule("../storage/lineItemArtwork.repo", () => ({
  lineItemArtworkRepository,
  LineItemArtworkRepository: class {},
}));

let LineItemArtworkService: any;
let LineItemArtworkError: any;

type Artwork = Record<string, any>;

class FakeArtworkStore {
  artworks = new Map<string, Artwork>();
  fileRecords = new Set(["org_1:file_source", "org_1:file_modified", "org_1:file_second", "org_2:file_other"]);
  lineItems = new Map([["org_1:line_1", { id: "line_1", orderId: "order_1" }], ["org_2:line_2", { id: "line_2", orderId: "order_2" }]]);
  sequence = 0;

  async transaction(callback: any) { return callback(null, this); }
  async getLineItemForOrganization(org: string, lineItemId: string) { return this.lineItems.get(`${org}:${lineItemId}`) ?? null; }
  async hasFileRecordForOrganization(org: string, fileRecordId: string) { return this.fileRecords.has(`${org}:${fileRecordId}`); }
  async getByIdForOrganization(org: string, id: string) { const row = this.artworks.get(id); return row?.organizationId === org ? row : null; }
  async listByLineItem(org: string, lineItemId: string, options: { currentOnly?: boolean } = {}) {
    return [...this.artworks.values()]
      .filter((row) => row.organizationId === org && row.lineItemId === lineItemId && (!options.currentOnly || row.status === "current"))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  async create(values: Artwork) {
    const row = { id: `art_${++this.sequence}`, createdAt: new Date(), supersededAt: null, supersededByUserId: null, ...values };
    this.artworks.set(row.id, row);
    return row;
  }
  async markSuperseded(org: string, id: string, actor: string | null) {
    const row = await this.getByIdForOrganization(org, id);
    if (!row || row.status !== "current") return null;
    row.status = "superseded";
    row.supersededAt = new Date();
    row.supersededByUserId = actor;
    return row;
  }
}

beforeAll(async () => {
  ({ LineItemArtworkService, LineItemArtworkError } = await import("../services/artwork/LineItemArtworkService"));
});

describe("LineItemArtworkService", () => {
  let store: FakeArtworkStore;
  let service: any;

  beforeEach(() => {
    store = new FakeArtworkStore();
    service = new LineItemArtworkService(store as any);
  });

  const sourceInput = () => ({ organizationId: "org_1", orderId: "order_1", lineItemId: "line_1", fileRecordId: "file_source", role: "customer_source", origin: "customer_upload", actorUserId: "user_1" });

  test("persists source artwork, reads it back after refresh, and permits the same physical file as production artwork", async () => {
    const source = await service.attachArtwork(sourceInput());
    const refreshedSource = await service.getCurrentArtwork({ organizationId: "org_1", lineItemId: "line_1", role: "customer_source" });
    const production = await service.attachArtwork({ ...sourceInput(), role: "production", origin: "promoted_existing" });
    expect(source.fileRecordId).toBe("file_source");
    expect(refreshedSource).toEqual([source]);
    expect(production.fileRecordId).toBe("file_source");
    expect(store.fileRecords.size).toBe(4);
  });

  test("is idempotent for a retried equivalent source or production operation", async () => {
    const source = await service.attachArtwork(sourceInput());
    const retriedSource = await service.attachArtwork(sourceInput());
    const production = await service.attachArtwork({ ...sourceInput(), role: "production", origin: "promoted_existing" });
    const retriedProduction = await service.attachArtwork({ ...sourceInput(), role: "production", origin: "promoted_existing" });
    expect(retriedSource.id).toBe(source.id);
    expect(retriedProduction.id).toBe(production.id);
    expect(store.artworks.size).toBe(2);
  });

  test("creates a modified relationship with explicit parent lineage and a distinct file", async () => {
    const source = await service.attachArtwork(sourceInput());
    const modified = await service.createModifiedArtworkVersion({ ...sourceInput(), fileRecordId: "file_modified", parentArtworkId: source.id });
    expect(modified.role).toBe("modified_production");
    expect(modified.parentArtworkId).toBe(source.id);
    expect(modified.fileRecordId).not.toBe(source.fileRecordId);
  });

  test("rejects a modified relationship that reuses its parent binary", async () => {
    const source = await service.attachArtwork(sourceInput());
    await expect(service.createModifiedArtworkVersion({ ...sourceInput(), parentArtworkId: source.id })).rejects.toMatchObject({ statusCode: 422 });
  });

  test("superseding preserves historical artwork and gives deterministic current selection", async () => {
    const original = await service.attachArtwork({ ...sourceInput(), role: "production", origin: "promoted_existing", side: "unknown" });
    const replacement = await service.createModifiedArtworkVersion({ ...sourceInput(), fileRecordId: "file_modified", parentArtworkId: original.id, supersedesArtworkId: original.id, side: "unknown" });
    expect((await service.getLineItemArtwork("org_1", "line_1")).map((row: Artwork) => row.id)).toEqual([original.id, replacement.id]);
    expect((await service.getCurrentArtwork({ organizationId: "org_1", lineItemId: "line_1", role: "modified_production" })).map((row: Artwork) => row.id)).toEqual([replacement.id]);
    expect(original.status).toBe("superseded");
  });

  test("retains multiple current artwork relationships with explicit allocations and unknown side", async () => {
    const first = await service.attachArtwork({ ...sourceInput(), role: "production", origin: "promoted_existing", allocationQuantity: 60, allocationGroupId: "group_a" });
    const second = await service.attachArtwork({ ...sourceInput(), fileRecordId: "file_second", role: "production", origin: "staff_upload", allocationQuantity: 40, allocationGroupId: "group_b", side: "unknown" });
    expect((await service.getCurrentArtwork({ organizationId: "org_1", lineItemId: "line_1", role: "production" })).map((row: Artwork) => row.allocationQuantity)).toEqual([60, 40]);
    expect(second.side).toBe("unknown");
    expect(first.status).toBe("current");
  });

  test("blocks cross-tenant files and unrelated order line items", async () => {
    await expect(service.attachArtwork({ ...sourceInput(), fileRecordId: "file_other" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.attachArtwork({ ...sourceInput(), lineItemId: "line_2", orderId: "order_2" })).rejects.toMatchObject({ statusCode: 404 });
  });

  test("never admits proof or combined-run artifacts as order-line artwork", async () => {
    await expect(service.attachArtwork({ ...sourceInput(), role: "proof" as any })).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.attachArtwork({ ...sourceInput(), role: "combined_run" as any })).rejects.toMatchObject({ statusCode: 422 });
  });
});
