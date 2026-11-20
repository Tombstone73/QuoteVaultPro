import { beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { auditLogs, organizations, products } from "@shared/schema";

const org = "fixture-org";
const actor = "fixture-user";
const savedLines = [{ id: "saved-first", description: "First" }, { id: "saved-second", description: "Second" }];
const routingResult = [{ lineItemId: "saved-first", status: "routed", destination: "Proofing" }];
const trace: string[] = [];
let fixtureReceipt: { requestHash: string; orderId: string; followUpVerified: boolean } | undefined;
let savedOrder: Awaited<ReturnType<typeof createOrder>> | undefined;
let failure = "";
let defaultMode = "save_only";
let returnedLines = savedLines;
let pauseProof: (() => Promise<void>) | undefined;
const createOrder = jest.fn(async () => {
  trace.push("commercial");
  if (failure === "commercial") throw new Error("fixture commercial rejection");
  return { id: "order-a", orderNumber: "101", total: "30.00", lineItems: returnedLines };
});
const createAuditLog = jest.fn(async () => {
  trace.push("route-audit");
  if (failure === "route-audit") throw new Error("fixture route-audit rejection");
});
const routeEligibleOrderLineItems = jest.fn(async () => {
  trace.push("route");
  if (failure === "route") throw new Error("fixture routing rejection");
  return routingResult;
});
const autoSyncCanonicalProofForLineItem = jest.fn(async (_tx: unknown, input: { reason: string; lineItemId: string }) => {
  const step = `${input.reason}:${input.lineItemId}`;
  trace.push(step);
  if (step === "order_saved:saved-first") await pauseProof?.();
  if (failure === step) throw new Error("fixture proof rejection");
});
const finalizeUpload = jest.fn(async (input: {
  organizationId: string;
  resource: { resourceId: string; lineItemId: string };
  source: { uploadId: string; expectedParentId: string };
}) => {
  const id = input.source.uploadId;
  trace.push(`promote:${input.resource.lineItemId}:${id}`);
  if (failure === id) throw new Error("fixture upload rejection");
  return { linkedRecord: { id, fileRecordId: id, fileName: `${id}.pdf`, mimeType: "application/pdf" } };
});
const resolveOriginal = jest.fn(async (id: string) => {
  trace.push(`resolve:${id}`);
  return { status: "available", objectKey: `fixture/${id}`, providerType: "local_filesystem" };
});
const createLineItemFileRecord = jest.fn(async ({ lineItemId, sourceOrderAttachmentId }: {
  lineItemId: string; sourceOrderAttachmentId: string;
}) => {
  trace.push(`original:${lineItemId}:${sourceOrderAttachmentId}`);
});
const tx = {};
// The real receipt transaction and inter-process serialization run in disposable PostgreSQL.
jest.unstable_mockModule("../services/orders/staffOrderCreateRequests", () => {
  const read = async (input: { requestHash: string }) => {
    if (fixtureReceipt && fixtureReceipt.requestHash !== input.requestHash) {
      throw Object.assign(new Error("fixture conflict"), { statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" });
    }
    return fixtureReceipt ?? null;
  };
  return {
    prepareStaffOrderCreateRequest: (_org: string, _actor: string, _key: string, requestHash: string) => ({ requestHash }),
    readStaffOrderCreateReceipt: read,
    runStaffOrderCreateRequest: async (input: { requestHash: string }, create: () => Promise<Awaited<ReturnType<typeof createOrder>>>) => {
      const receipt = await read(input);
      if (receipt) return { receipt, replayed: true };
      const order = await create();
      savedOrder = structuredClone(order);
      fixtureReceipt = { ...input, orderId: order.id, followUpVerified: false };
      return { order, replayed: false };
    },
    recoverStaffOrderCreateResult: async () => structuredClone(savedOrder),
    markStaffOrderCreateFollowUpVerified: async () => {
      if (!fixtureReceipt) throw new Error("Missing fixture receipt");
      fixtureReceipt.followUpVerified = true;
    },
  };
});
const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === organizations) return [{ id: org, settings: { preferences: { orders: { saveRoutingMode: defaultMode } } } }];
          if (table === products) return [{ id: "product", requiresProofApproval: true, isTaxable: false }];
          throw new Error("Unexpected read from the direct Order fixture");
        },
      }),
    }),
  }),
  insert: (table: unknown) => ({
    values: async ({ actionType }: { actionType: string }) => {
      if (table !== auditLogs) throw new Error("Unexpected write in the direct Order fixture");
      const step = actionType === "CREATE" ? "canonical-audit" : "override-audit";
      trace.push(step);
      if (failure === step) throw new Error(`fixture ${step} rejection`);
    },
  }),
  transaction: async (run: (executor: typeof tx) => Promise<unknown>) => run(tx),
};
jest.unstable_mockModule("../db", () => ({
  db, pool: {}, probeDatabaseSchema: async () => {}, hasPageCountStatusColumn: () => true, hasQuoteAttachmentPagesTable: () => true,
}));
jest.unstable_mockModule("sharp", () => ({ default: () => { throw new Error("No image processing in the HTTP fixture"); } }));
jest.unstable_mockModule("../services/proofingService", () => ({
  autoSyncCanonicalProofForLineItem, reconcileLineItemProofGateRelease: jest.fn(), retireProofAuthorityForUpstream: jest.fn(),
}));
jest.unstable_mockModule("../services/orderSaveRoutingService", () => ({ routeEligibleOrderLineItems }));
jest.unstable_mockModule("../services/storage/StorageApplicationService", () => ({ storageApplicationService: { finalizeUpload } }));
jest.unstable_mockModule("../services/storage/CanonicalFileReadResolver", () => ({ canonicalFileReadResolver: { resolveOriginal } }));
jest.unstable_mockModule("../services/lineItemFileRecordService", () => ({ createLineItemFileRecord }));
jest.unstable_mockModule("../services/thumbnailGenerator", () => ({
  generateImageDerivatives: jest.fn(), isSupportedImageType: () => false, isThumbnailGenerationEnabled: () => false,
}));
jest.unstable_mockModule("../workers/thumbnailWorker", () => ({ triggerThumbnailGenerationForAttachment: jest.fn() }));
jest.unstable_mockModule("../services/pdfProcessing", () => ({ processPdfAttachmentDerivedData: jest.fn(async () => {}) }));

let app: express.Express;
beforeAll(async () => {
  const { storage } = await import("../storage");
  Object.assign(storage, { createOrder, createAuditLog });
  const { registerOrderRoutes } = await import("../routes/orders.routes");
  app = express();
  app.use(express.json());
  const auth: express.RequestHandler = (req, res, next) => {
    if (req.header("x-fixture-auth") === "deny") { res.sendStatus(401); return; }
    if (req.header("x-fixture-auth") !== "no-actor") req.user = { id: actor, firstName: "Fixture", lastName: "User" } as Express.User;
    next();
  };
  const tenant: express.RequestHandler = (req, _res, next) => {
    if (req.header("x-fixture-tenant") !== "missing") req.organizationId = org;
    next();
  };
  await registerOrderRoutes(app, { isAuthenticated: auth, tenantContext: tenant, isAdmin: auth, isAdminOrOwner: auth });
});
beforeEach(() => {
  fixtureReceipt = undefined;
  savedOrder = undefined;
  jest.clearAllMocks();
  trace.length = 0;
  returnedLines = savedLines;
  defaultMode = "save_only";
  failure = "";
  pauseProof = undefined;
});

function input(routeAfterSave?: string) {
  return {
    routeAfterSave,
    lineItems: [
      { productId: "product", description: "First", quantity: 1, totalPrice: 10, requiresProofApproval: false },
      { productId: "product", description: "Second", quantity: 1, totalPrice: 20 },
    ],
  };
}
const post = () => request(app).post("/api/orders");
const audits = ["commercial", "canonical-audit", "route-audit", "override-audit"];
const initialProof = ["order_saved:saved-first", "order_saved:saved-second"];
const staged = (routeAfterSave = "route_eligible") => {
  const body = input(routeAfterSave);
  return { ...body, lineItems: body.lineItems.map((line, index) => ({
    ...line, pendingOrderAttachmentUploadIds: index === 0 ? ["upload-a", "upload-b"] : ["upload-c"],
  })) };
};
const businessTrace = () => trace.filter(step => !step.startsWith("resolve:"));

test("authentication, actor, and tenant failures skip creation", async () => {
  await post().set("x-fixture-auth", "deny").send(input()).expect(401);
  const actorError = await post().set("x-fixture-auth", "no-actor").send(input()).expect(401);
  expect(actorError.body.code).toBe("UNAUTHENTICATED");
  await post().set("x-fixture-tenant", "missing").send(input()).expect(500, { message: "Missing organization context" });
  expect(trace).toEqual([]);
});

test("empty lines, Quote lineage and invalid staged allocations keep their existing errors", async () => {
  for (const [body, code] of [
    [{ lineItems: [] }, "ORDER_LINE_ITEMS_REQUIRED"],
    [{ ...input(), quoteId: "quote-fixture" }, "DIRECT_ORDER_QUOTE_LINKAGE_NOT_ALLOWED"],
    [{ lineItems: [{ ...input().lineItems[0], pendingOrderAttachmentUploadIds: ["bad"],
      pendingOrderArtworkAllocations: [{ uploadId: "bad", productionQuantity: 7, allocationSource: "manual" }] }] },
    "ARTWORK_ALLOCATION_UNRESOLVED"],
  ] as const) {
    const result = await post().send(body).expect(400);
    expect(result.body).toMatchObject({ success: false, code });
  }
  expect(trace).toEqual([]);
});

test("a rejected commercial create never enters the audits or follow-up", async () => {
  failure = "commercial";
  await post().send(input()).expect(500, {
    success: false, code: "ORDER_CREATE_FAILED", message: "Failed to create order", error: "fixture commercial rejection",
  });
  expect(trace).toEqual(["commercial"]);
});

test.each<[string, string | undefined, boolean]>([
  ["route_eligible", "save_only", false],
  ["save_only", "route_eligible", true],
  ["route_eligible", undefined, true],
  ["route_eligible", "invalid", true],
  ["ask_each_time", undefined, false],
])("organization %s and request %s route only when eligible", async (configured, requested, routed) => {
  defaultMode = configured;
  const { body } = await post().set("x-organization-id", "ignored-header-org").send(input(requested)).expect(200);
  expect(createOrder).toHaveBeenCalledWith(org, expect.objectContaining({ createdByUserId: actor }));
  const saved = { id: "order-a", orderNumber: "101", total: "30.00", lineItems: savedLines };
  const expected = routed ? { ...saved, routingResult } : saved;
  expect(body).toEqual({
    ...expected, success: true, message: "Order created successfully",
    data: routed ? { order: expected, routingResult } : { order: expected },
  });
  expect(trace).toEqual([...audits, ...initialProof, ...(routed ? ["route"] : [])]);
});

test("promotes multiple uploads by saved-line index after initial proof and before routing", async () => {
  await post().send(staged()).expect(200);
  expect(businessTrace()).toEqual([
    ...audits, ...initialProof,
    "promote:saved-first:upload-a", "original:saved-first:upload-a", "artwork_saved:saved-first",
    "promote:saved-first:upload-b", "original:saved-first:upload-b", "artwork_saved:saved-first",
    "promote:saved-second:upload-c", "original:saved-second:upload-c", "artwork_saved:saved-second", "route",
  ]);
  expect(finalizeUpload).toHaveBeenLastCalledWith(expect.objectContaining({
    organizationId: org,
    resource: expect.objectContaining({ resourceId: "order-a", lineItemId: "saved-second" }),
    source: expect.objectContaining({ uploadId: "upload-c", expectedParentId: "order-a" }),
  }));
  // The awaited PDF kickoff resolves the original before the original-file link, without waiting for derivative generation.
  const start = trace.indexOf("promote:saved-first:upload-a");
  expect(trace.slice(start, trace.indexOf("original:saved-first:upload-a"))).toEqual([
    "promote:saved-first:upload-a", "resolve:upload-a", "resolve:upload-a",
  ]);
});

test("reports missing returned lines and upload failures while later uploads continue", async () => {
  returnedLines = savedLines.slice(0, 1);
  failure = "upload-a";
  const { body } = await post().send(staged()).expect(200);
  const warnings = [
    { lineItemIndex: 0, uploadId: "upload-a", message: "fixture upload rejection" },
    { lineItemIndex: 1, uploadId: "upload-c", message: "Created order line item was not returned for TEMP artwork promotion." },
  ];
  expect(body.message).toBe("Order created successfully with artwork promotion warnings");
  expect(body.warnings).toEqual(warnings);
  expect(body.attachmentPromotionWarnings).toEqual(warnings);
  expect(body.data.attachmentPromotionWarnings).toEqual(warnings);
  expect(body.data.order.attachmentPromotionWarnings).toEqual(warnings);
  expect(businessTrace()).toEqual([...audits, initialProof[0], "promote:saved-first:upload-a",
    "promote:saved-first:upload-b", "original:saved-first:upload-b", "artwork_saved:saved-first", "route"]);
});

test.each(["order_saved:saved-first", "artwork_saved:saved-first"])("proof rejection at %s is logged and follow-up continues", async (step) => {
  failure = step;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { body } = await post().send(staged()).expect(200);
    expect(body.warnings).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("non-fatal"), expect.any(Error));
    expect(trace).toContain("artwork_saved:saved-second");
    expect(trace.at(-1)).toBe("route");
  } finally {
    log.mockRestore();
  }
});

test("routing rejection remains a structured successful-create response", async () => {
  failure = "route";
  const { body } = await post().send(input("route_eligible")).expect(200);
  const result = [{ lineItemId: null, status: "failed", reason: "fixture routing rejection" }];
  expect(body.routingResult).toEqual(result);
  expect(body.data.routingResult).toEqual(result);
  expect(body.data.order.routingResult).toEqual(result);
  expect(trace).toEqual([...audits, ...initialProof, "route"]);
});

// Characterization of the existing fault boundary, pending a separate recovery repair.
test.each(audits.slice(1))("a rejection at %s surfaces the current error and halts the follow-up", async (step) => {
  failure = step;
  await post().send(staged()).expect(500, {
    success: false, code: "ORDER_CREATE_FAILED", message: "Failed to create order", error: `fixture ${step} rejection`,
  });
  expect(trace).toEqual(audits.slice(0, audits.indexOf(step) + 1));
});

test("a same-key request can recover the committed Order while post-save work is still unverified", async () => {
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  pauseProof = async () => { reached(); await paused; };
  const keyed = (body = staged()) => post().set("Idempotency-Key", "same-request").send(body);
  const first = keyed().then(response => response);
  await entered;
  let concurrent;
  try {
    concurrent = await keyed().expect(200);
    const conflict = await post().set("Idempotency-Key", "same-request").send({ lineItems: [] }).expect(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
  } finally {
    release();
  }
  const one = await first;
  const replay = await keyed().expect(200);
  expect(one.status).toBe(200);
  expect(concurrent?.body.data).toMatchObject({ order: { id: one.body.id }, recovered: true, followUpWarning: expect.any(String) });
  expect(replay.body.data).toMatchObject({ order: { id: one.body.id }, recovered: true });
  expect(replay.body.data.followUpWarning).toBeUndefined();
  expect(createOrder).toHaveBeenCalledTimes(1);
  expect(finalizeUpload).toHaveBeenCalledTimes(3);
  expect(routeEligibleOrderLineItems).toHaveBeenCalledTimes(1);
});
