import { describe, expect, jest, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InvestigationRepository } from "../services/investigation/investigationService";

// The service accepts an injected repository. Mock only its lazy default
// database module so these contract tests never need a database URL.
jest.unstable_mockModule("../db", () => ({ db: {} }));
const { InvestigationAccessError, InvestigationService, investigationResourceDescriptors } = await import("../services/investigation/investigationService");
const { createAssistantInvestigationToolAdapters } = await import("../services/assistant/investigationTools");
const { AssistantOrchestrationService } = await import("../services/assistant/orchestration");
const { investigationGetInputSchema, investigationSnapshotSchema } = await import("@shared/investigationContracts");

const order = { type: "order" as const, id: "order_20544", label: "20544", href: "/orders/order_20544" };
const customer = { type: "customer" as const, id: "customer_1", label: "Acme", href: "/customers/customer_1" };
const line = { type: "order_line" as const, id: "line_1", label: "Banner", href: "/orders/order_20544" };
const job = { type: "production_job" as const, id: "job_1", label: "Production job job_1", href: "/production?jobId=job_1" };

function snapshot(resource: typeof order | typeof customer | typeof line | typeof job) {
  if (resource.type === "order") return { type: "order" as const, resource, current: { status: "open", updatedAt: "2026-09-29T12:00:00.000Z" }, orderNumber: "20544", customer, state: "open", fulfillmentStatus: "pending" };
  if (resource.type === "customer") return { type: "customer" as const, resource, current: { status: "active", updatedAt: "2026-09-29T12:00:00.000Z" }, companyName: "Acme", active: true };
  if (resource.type === "order_line") return { type: "order_line" as const, resource, current: { status: "queued", updatedAt: "2026-09-29T12:00:00.000Z" }, description: "Banner", quantity: 2, order, workflowState: "queued" };
  return { type: "production_job" as const, resource, current: { status: "queued", updatedAt: "2026-09-29T12:00:00.000Z" }, order, line, station: "flatbed", step: "print", status: "queued" };
}

function repository(): InvestigationRepository {
  return {
    search: async (organizationId, query) => organizationId === "org_1" && query === "20544" ? [
      { resource: order, summary: "Acme · open", match: "exact" as const },
      { resource: { ...order, id: "order_20545", label: "20545", href: "/orders/order_20545" }, summary: "Acme · open", match: "partial" as const },
    ] : [],
    get: async (organizationId, resource) => organizationId === "org_1" && resource.id !== "missing" ? snapshot(resource.type === "customer" ? customer : resource.type === "order_line" ? line : resource.type === "production_job" ? job : order) : null,
    related: async (_organizationId, resource) => {
      if (resource.type === "order") return [{ from: order, to: customer, relationship: "belongs_to_customer" as const }, { from: order, to: line, relationship: "contains_line" as const }, { from: order, to: job, relationship: "has_production_job" as const }];
      if (resource.type === "customer") return [{ from: customer, to: order, relationship: "belongs_to_customer" as const }];
      if (resource.type === "order_line") return [{ from: line, to: order, relationship: "contains_line" as const }, { from: line, to: job, relationship: "has_production_job" as const }];
      return [{ from: job, to: order, relationship: "has_production_job" as const }, { from: job, to: line, relationship: "contains_line" as const }];
    },
    history: async (_organizationId, resource) => [{ eventId: "audit_1", occurredAt: "2026-09-28T12:00:00.000Z", kind: "recorded_event" as const, summary: "Status updated", resource: resource.type === "order" ? order : job, provenance: { source: "order_audit_log" as const, recorded: true } }],
  };
}

const authorized = { organizationId: "org_1", permissions: ["assistant.internal_staff"] };

describe("resource-oriented investigation service", () => {
  test("defines the approved investigation graph without a generic resource type", () => {
    expect(Object.keys(investigationResourceDescriptors)).toEqual(["order", "customer", "order_line", "production_job", "shipment", "invoice", "contact", "quote", "artwork"]);
    expect(investigationResourceDescriptors.order.relations).toEqual(expect.arrayContaining(["belongs_to_customer", "contains_line", "has_production_job", "fulfills_order", "invoices_order", "originated_from_quote", "has_artwork"]));
    expect(investigationResourceDescriptors.customer.relations).toContain("has_contact");
    expect(investigationResourceDescriptors.artwork.relations).toContain("supersedes_artwork");
  });

  test("accepts new safe resource references while rejecting artwork storage details", () => {
    expect(investigationGetInputSchema.parse({ resource: { type: "artwork", id: "art_1" } })).toEqual({ resource: { type: "artwork", id: "art_1" } });
    const safeArtwork = {
      type: "artwork", resource: { type: "artwork", id: "art_1", label: "logo.pdf", href: "/orders/order_1" }, current: { status: "current" },
      order: { type: "order", id: "order_1", label: "1001", href: "/orders/order_1" }, line: { type: "order_line", id: "line_1", label: "Banner", href: "/orders/order_1" },
      fileRecordId: "file_1", filename: "logo.pdf", mimeType: "application/pdf", storageState: "stored_hot", originalAvailable: true, previewAvailable: false, role: "production", artworkStatus: "current", side: "front", supersedesArtwork: null,
    };
    expect(investigationSnapshotSchema.parse(safeArtwork)).toMatchObject({ type: "artwork", fileRecordId: "file_1" });
    expect(() => investigationSnapshotSchema.parse({ ...safeArtwork, storageKey: "private/bucket/logo.pdf" })).toThrow();
  });

  test("returns ambiguous matches instead of selecting an order from a query", async () => {
    const result = await new InvestigationService(repository()).search(authorized, { query: "20544", limit: 8 });
    expect(result).toMatchObject({ status: "succeeded", data: { resolution: "ambiguous", matches: expect.arrayContaining([expect.objectContaining({ resource: order })]) } });
  });

  test("keeps tenant scope and permission denial ahead of resource lookup", async () => {
    const service = new InvestigationService(repository());
    await expect(service.get({ organizationId: "org_2", permissions: ["assistant.internal_staff"] }, { type: "order", id: "order_20544" })).resolves.toMatchObject({ status: "not_found" });
    await expect(service.get(authorized, { type: "order", id: "missing" })).resolves.toMatchObject({ status: "not_found" });
    await expect(service.get({ organizationId: "org_1", permissions: [] }, { type: "order", id: "order_20544" })).rejects.toBeInstanceOf(InvestigationAccessError);
  });

  test("bounds composed traversal by depth and suppresses cyclic return edges", async () => {
    const service = new InvestigationService(repository());
    const depthOne = await service.related(authorized, { resource: { type: "order", id: "order_20544" }, depth: 1, limit: 12 });
    expect(depthOne).toMatchObject({ status: "succeeded", data: { edges: expect.arrayContaining([expect.objectContaining({ to: customer, depth: 1 }), expect.objectContaining({ to: line, depth: 1 }), expect.objectContaining({ to: job, depth: 1 })]), truncated: false } });
    const depthTwo = await service.related(authorized, { resource: { type: "order", id: "order_20544" }, depth: 2, limit: 2 });
    expect(depthTwo).toMatchObject({ data: { truncated: true } });
    expect(new Set((depthTwo as any).data.edges.map((edge: any) => `${edge.to.type}:${edge.to.id}`)).size).toBe((depthTwo as any).data.edges.length);
  });

  test("marks recorded history and a current snapshot with separate provenance", async () => {
    const result = await new InvestigationService(repository()).history(authorized, { resource: { type: "order", id: "order_20544" }, limit: 12 });
    expect(result).toMatchObject({ status: "succeeded", data: { events: expect.arrayContaining([
      expect.objectContaining({ kind: "recorded_event", provenance: { source: "order_audit_log", recorded: true } }),
      expect.objectContaining({ kind: "current_snapshot", provenance: { source: "current_record", recorded: false } }),
    ]) } });
  });

  test("exposes only typed read adapters and retains registry authorization", async () => {
    const adapters = createAssistantInvestigationToolAdapters(new InvestigationService(repository()));
    expect(Object.keys(adapters).sort()).toEqual(["investigation.get", "investigation.history", "investigation.related", "investigation.search"]);
    const execution = await new AssistantOrchestrationService(adapters).executePlan({ intent: "lookup", selectedSkill: "order", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise", toolCalls: [{ toolName: "investigation.get", arguments: { resource: { type: "order", id: "order_20544" } } }] }, {
      scope: { organizationId: "org_1", userId: "user_1" }, actor: { userId: "user_1", email: null }, permissions: [], context: { contextVersion: "v1", route: "/orders/order_20544", pageTitle: "Order", entityType: "order", entityId: "order_20544", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-09-29T12:00:00.000Z", unsavedChanges: false }, correlationId: "correlation_1",
    });
    expect(execution.executions).toEqual([expect.objectContaining({ status: "permission_denied" })]);
  });

  test("records bounded investigation telemetry without resource identifiers", async () => {
    const audit = jest.fn();
    await new AssistantOrchestrationService(createAssistantInvestigationToolAdapters(new InvestigationService(repository())), audit).executePlan({ intent: "lookup", selectedSkill: "order", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise", toolCalls: [{ toolName: "investigation.related", arguments: { resource: { type: "order", id: "order_20544" }, depth: 1, limit: 12 } }] }, {
      scope: { organizationId: "org_1", userId: "user_1" }, actor: { userId: "user_1", email: null }, permissions: ["assistant.internal_staff"], context: { contextVersion: "v1", route: "/orders/order_20544", pageTitle: "Order", entityType: "order", entityId: "order_20544", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-09-29T12:00:00.000Z", unsavedChanges: false }, correlationId: "correlation_1",
    });
    const event = audit.mock.calls[0]?.[0];
    expect(event).toEqual(expect.objectContaining({ logicalCapability: "investigation.related", operationalMetadata: { resourceTypes: expect.arrayContaining(["order", "customer"]), resultCount: 3, depth: 1, truncated: false } }));
    expect(event).not.toHaveProperty("compatibilityToolName");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("order_20544");
  });

  test("keeps portal customers outside the internal assistant tenant boundary", async () => {
    const [assistantRoutes, tenantBoundary] = await Promise.all([
      readFile(path.resolve(process.cwd(), "server/routes/assistant.routes.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "server/tenantContext.ts"), "utf8"),
    ]);
    expect(assistantRoutes).toContain("const guarded: RequestHandler[] = [isAuthenticated, tenantContext]");
    expect(tenantBoundary).toContain("if (isPortalCustomerIdentity(user))");
    expect(tenantBoundary).toContain("PORTAL_CUSTOMER_INTERNAL_ACCESS_DENIED");
  });
});
