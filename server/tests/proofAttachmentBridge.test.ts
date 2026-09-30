import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { auditLogs, lineItemProofVersions, orderAttachments, orderAuditLog, orderLineItems, prepressSessions, productionEvents } from "@shared/schema";
import { scriptedWorkflowTx } from "./helpers/scriptedWorkflowTx";

// Real proof bridge, auto-sync, version creation and upstream orchestration;
// database results and external boundaries are simulated, with no live I/O.
const transaction = jest.fn<any>();
const finalizeUpload = jest.fn<any>();
const transition = jest.fn<any>();
jest.unstable_mockModule("../db", () => ({ db: { transaction }, pool: {}, hasPageCountStatusColumn: () => true, hasQuoteAttachmentPagesTable: () => true }));
jest.unstable_mockModule("../prepressFileService", () => ({ getFileUploadNamingPolicy: async () => ({ fileUploadJobPrefixMode: "none" }) }));
jest.unstable_mockModule("../services/artwork/LineItemArtworkReadResolver", () => ({
  lineItemArtworkReadResolver: { resolveForLineItem: async () => ({ unavailable: false, artwork: [{ fileRecordId: "file-record" }] }) },
}));
jest.unstable_mockModule("../services/storage/StorageApplicationService", () => ({ storageApplicationService: { finalizeUpload } }));
jest.unstable_mockModule("../storage/fileDerivative.repo", () => ({ fileDerivativeRepository: { getPreferredByFileRecordIdAndType: async () => null } }));
jest.unstable_mockModule("../services/lineItemWorkflowService", () => ({ transitionLineItemWorkflowState: transition }));
jest.unstable_mockModule("../services/fulfillment/repository", () => ({
  FulfillmentDashboardRepo: class { async listLineEligibility() { return [{ projection: { fulfilledQuantity: 0, administrativelyReconciledQuantity: 0 } }]; } },
}));

const { autoSyncCanonicalProofForLineItem, createLineItemProofVersionFromExistingAttachment, createLineItemProofVersion } = await import("../services/proofingService");
const { returnUpstream } = await import("../services/returnUpstreamService");
const input = { organizationId: "tenant", actorUserId: "actor", lineItemId: "line", destination: "proofing" as const,
  reason: "needs a proof", expectedWorkflowState: "in_prepress" as const, expectedOwnerJobId: "prepress", expectedUpdatedAt: "2026-09-30T12:00:00.000Z" };
const line = { id: "line", lineItemId: "line", orderId: "order", organizationId: "tenant", workflowState: "awaiting_proof_approval",
  status: "new", requiresProofApproval: true, requiresPrepress: true, approvedProofVersionId: null, updatedAt: new Date(input.expectedUpdatedAt) };
const artwork = { sourceId: "artwork", orderId: "order", orderLineItemId: "line", role: "artwork", fileRecordId: "file-record",
  fileName: "customer-art.pdf", originalFilename: "customer-art.pdf", fileUrl: "tenant/order/customer-art.pdf", relativePath: "tenant/order/customer-art.pdf",
  mimeType: "application/pdf", storageProvider: "supabase", sizeBytes: 120, checksum: "abc", thumbKey: "existing-thumb.png", previewKey: "existing-preview.png",
  updatedAt: new Date(input.expectedUpdatedAt) };
const snapshot = { ...line, orderNumber: "20507", lineItemLabel: "Signs", quantity: 1, selectedOptions: [], materialUsages: [] };
const attachmentWrites = (f: ReturnType<typeof scriptedWorkflowTx>) => f.writes.filter(w => w.table === orderAttachments);
const proofRow = (id: string) => ({ id, orderId: "order", orderLineItemId: "line", role: "proof" });
const versionReads = (proofId: string) => [[{ id: "line" }], [line], [proofRow(proofId)], [], [], [{ nextVersionNumber: 1 }]];
function syncReads(existingBridge = false) {
  return [
    [{ id: "line" }], [line], [artwork], [], [], // lock, line, eligible artwork/asset/file sources
    [line], [], [], [], // canonical proof truth: no prior versions/decisions/overrides
    [snapshot], [artwork], [], [], // persisted proof input snapshot
    existingBridge ? [{ id: "proof-attachment" }] : [], // bridge reuse lookup
    [], // no actionable proofs to invalidate
    ...versionReads(existingBridge ? "proof-attachment" : "created"),
  ];
}
function upstreamFixture() {
  return scriptedWorkflowTx([
    [{ role: "admin" }], [{ id: "line" }],
    [{ line: { ...line, workflowState: "in_prepress" }, order: { id: "order", state: "open", status: "in_progress" } }],
    [{ id: "prepress", stationKey: "prepress", stepKey: "prepress", status: "in_progress" }], [],
    [line], [], [], // retire current authority with no previous Proof
    ...syncReads(),
  ]);
}
beforeEach(() => {
  jest.clearAllMocks();
  finalizeUpload.mockImplementation(() => { throw new Error("Unexpected file upload"); });
  transition.mockImplementation(async (tx: any, args: any) => {
    await tx.update(orderLineItems).set({ workflowState: args.toState });
    await tx.insert(productionEvents).values({ productionJobId: "prepress", payload: { eventType: "workflow_transition" } });
    return { toState: args.toState, activeOwnerJobId: "prepress", activeOwnerStationKey: "prepress", activeOwnerStepKey: "prepress" };
  });
});

describe("canonical proof attachment bridge", () => {
  test.each(["artwork", "reference", "attachment"])("preserves %s and creates a proof-role reference to the same file", async role => {
    const source = { ...artwork, role };
    const before = structuredClone(source);
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [source], [], ...versionReads("created")]);
    const version = await createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" });
    expect(version).toMatchObject({ proofFileId: "created", status: "draft", versionNumber: 1 });
    expect(source).toEqual(before);
    expect(attachmentWrites(f)).toHaveLength(1);
    expect(attachmentWrites(f)[0]).toMatchObject({ kind: "insert", value: { role: "proof", fileRecordId: artwork.fileRecordId,
      fileUrl: artwork.fileUrl, checksum: artwork.checksum, originalFilename: artwork.originalFilename, thumbKey: artwork.thumbKey, previewKey: artwork.previewKey } });
    expect(f.reads[0].locked).toBe(true);
    expect(f.predicate(f.reads[3].where).params).toEqual(expect.arrayContaining(["tenant", "order", "line", "proof", "file-record"]));
    expect(finalizeUpload).not.toHaveBeenCalled();
    expect(f.remaining()).toBe(0);
  });

  test("reuses an existing proof-role source without creating a bridge", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...artwork, role: "proof" }], ...versionReads("artwork")]);
    const version = await createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" });
    expect(version.proofFileId).toBe("artwork"); expect(attachmentWrites(f)).toHaveLength(0);
  });

  test("reuses the same canonical file even when legacy URL/name differs", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...artwork, fileUrl: "new-url", fileName: "renamed.pdf" }], [{ id: "proof-attachment" }], ...versionReads("proof-attachment")]);
    const version = await createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" });
    expect(version.proofFileId).toBe("proof-attachment"); expect(attachmentWrites(f)).toHaveLength(0);
    const query = f.predicate(f.reads[3].where);
    expect(query.params).toContain("file-record"); expect(query.params).not.toContain("new-url");
  });

  test("uses existing legacy file URL identity when no canonical file record exists", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...artwork, fileRecordId: null, checksum: null, relativePath: null }], [{ id: "proof-attachment" }], ...versionReads("proof-attachment")]);
    await createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" });
    expect(f.predicate(f.reads[3].where).params).toContain(artwork.fileUrl); expect(attachmentWrites(f)).toHaveLength(0);
  });

  test.each(["checksum", "relativePath"] as const)("reuses legacy %s identity without an empty URL match", async identity => {
    const source = { ...artwork, fileRecordId: null, fileUrl: null, checksum: identity === "checksum" ? "abc" : null };
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [source], [{ id: "proof-attachment" }], ...versionReads("proof-attachment")]);
    await createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" });
    expect(f.predicate(f.reads[3].where).params).toContain(source[identity]); expect(attachmentWrites(f)).toHaveLength(0);
  });

  test("missing file identity cannot reuse an unrelated empty-URL attachment", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...artwork, fileRecordId: null, checksum: null, relativePath: null, fileUrl: null }]]);
    await expect(createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" })).rejects.toThrow("no canonical file or storage identity");
    expect(f.writes).toHaveLength(0);
  });

  test.each([{ orderId: "other-order" }, { orderLineItemId: "other-line" }, { role: "invoice" }])("rejects an incompatible source %j", async override => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...artwork, ...override }]]);
    await expect(createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "artwork", createdByUserId: "actor" })).rejects.toMatchObject({ statusCode: 409 });
    expect(f.writes).toHaveLength(0);
  });

  test("another tenant's source is unavailable", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], []]);
    await expect(createLineItemProofVersionFromExistingAttachment(f.tx, { ...input, attachmentId: "foreign", createdByUserId: "actor" })).rejects.toMatchObject({ statusCode: 404 });
    expect(f.predicate(f.reads[2].where).params).toContain("tenant"); expect(f.writes).toHaveLength(0);
  });

  test("the version creator still rejects artwork-role IDs directly", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...proofRow("artwork"), role: "artwork" }]]);
    await expect(createLineItemProofVersion(f.tx, { ...input, proofFileId: "artwork", createdByUserId: "actor" })).rejects.toThrow("must have role=proof");
    expect(f.writes).toHaveLength(0);
  });
});

describe("proof auto-sync and live Return to Proofing regression", () => {
  test.each(["upstream_return", "design_completed", "artwork_saved"] as const)("%s bridges artwork into the first draft without changing source bytes", async reason => {
    const f = scriptedWorkflowTx(syncReads());
    const result = await autoSyncCanonicalProofForLineItem(f.tx, { ...input, reason });
    expect(result).toMatchObject({ status: "draft_created", proofFileId: "created" });
    expect(attachmentWrites(f)).toHaveLength(1);
    expect(attachmentWrites(f)[0].value).toMatchObject({ role: "proof", fileRecordId: "file-record" });
    expect(artwork.role).toBe("artwork"); expect(finalizeUpload).not.toHaveBeenCalled(); expect(f.remaining()).toBe(0);
  });

  test("auto-sync reuses the matching proof attachment", async () => {
    const f = scriptedWorkflowTx(syncReads(true));
    const result = await autoSyncCanonicalProofForLineItem(f.tx, { ...input, reason: "artwork_saved" });
    expect(result).toMatchObject({ status: "draft_created", proofFileId: "proof-attachment" });
    expect(attachmentWrites(f)).toHaveLength(0); expect(finalizeUpload).not.toHaveBeenCalled();
  });

  test.each(["asset", "line_item_file"])("the existing %s bridge behavior is preserved", async sourceType => {
    const reads = syncReads();
    for (const offset of [2, 10]) {
      reads[offset] = [];
      reads[offset + (sourceType === "asset" ? 1 : 2)] = [{ ...artwork, sourceId: sourceType }];
    }
    const f = scriptedWorkflowTx(reads);
    await expect(autoSyncCanonicalProofForLineItem(f.tx, { ...input, reason: "artwork_saved" })).resolves.toMatchObject({ status: "draft_created", proofFileId: "created" });
    expect(attachmentWrites(f)[0].value).toMatchObject({ role: "proof", fileRecordId: "file-record" });
    expect(finalizeUpload).not.toHaveBeenCalled();
  });

  test("repeated synchronization with the same bridge and current draft creates nothing", async () => {
    const version = { id: "draft", lineItemId: "line", proofFileId: "proof-attachment", versionNumber: 1, status: "draft", createdAt: line.updatedAt, updatedAt: line.updatedAt };
    const f = scriptedWorkflowTx([
      [{ id: "line" }], [line], [artwork], [], [],
      [line], [version], [{ proofVersionId: "draft", lineItemId: "line" }], [], [],
      [snapshot], [artwork], [], [],
      [{ ...artwork, id: "proof-attachment", role: "proof" }],
      [{ id: "proof-attachment" }],
    ]);
    await expect(autoSyncCanonicalProofForLineItem(f.tx, { ...input, reason: "artwork_saved" })).resolves.toEqual({ status: "already_current" });
    expect(f.writes).toHaveLength(0); expect(finalizeUpload).not.toHaveBeenCalled(); expect(f.remaining()).toBe(0);
  });

  test("Return Upstream creates the first draft from existing artwork and records the successful return", async () => {
    const f = upstreamFixture(); transaction.mockImplementation(f.transaction);
    const before = structuredClone(artwork);
    const result = await returnUpstream(input);
    expect(result).toMatchObject({ transition: { toState: "awaiting_proof_approval" }, proofSync: { status: "draft_created", proofFileId: "created" } });
    expect(artwork).toEqual(before);
    expect(attachmentWrites(f)).toHaveLength(1);
    expect(f.writes.find(w => w.table === lineItemProofVersions)?.value).toMatchObject({ status: "draft", versionNumber: 1, proofFileId: "created" });
    expect(f.writes.find(w => w.table === orderAuditLog)?.value).toMatchObject({ actionType: "proof_draft_created", userId: "actor" });
    expect(f.writes.find(w => w.table === auditLogs)?.value).toMatchObject({ newValues: { destination: "proofing", reason: "needs a proof" } });
    expect(f.writes.find(w => w.table === prepressSessions)?.value.status).toBe("complete");
    expect(finalizeUpload).not.toHaveBeenCalled(); expect(f.remaining()).toBe(0);
  });

  test.each(["proof_creation", "return_audit"])("%s failure aborts every staged write in the transaction harness", async failurePoint => {
    const f = upstreamFixture(); transaction.mockImplementation(f.transaction);
    const insert = f.tx.insert;
    let attempted: typeof f.writes = [];
    f.tx.insert = (table: any) => {
      const query = insert(table);
      if (table !== (failurePoint === "proof_creation" ? lineItemProofVersions : auditLogs)) return query;
      return { values: (value: any) => { query.values(value); attempted = [...f.writes]; throw new Error("Injected proof transaction failure"); } };
    };
    await expect(returnUpstream(input)).rejects.toThrow("Injected proof transaction failure");
    expect(attempted).toContainEqual(expect.objectContaining({ table: orderLineItems, value: expect.objectContaining({ approvedProofVersionId: null }) }));
    expect(attempted).toContainEqual(expect.objectContaining({ table: orderLineItems, value: { workflowState: "awaiting_proof_approval" } }));
    expect(attempted.some(w => w.table === productionEvents)).toBe(true);
    expect(attempted.some(w => w.table === prepressSessions)).toBe(failurePoint === "return_audit");
    expect(f.writes).toHaveLength(0); expect(artwork.role).toBe("artwork"); expect(finalizeUpload).not.toHaveBeenCalled();
  });
});
