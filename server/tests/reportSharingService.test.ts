import { describe, expect, jest, test } from "@jest/globals";
import { reportDefinitionSchema } from "@shared/aiReportingContracts";
import { sanitizeCustomerSafeSnapshot, type AssistantReportRecord, type AssistantReportShareRecord } from "../storage/assistantReports.repo";
import { ReportSharingService, hashReportShareToken, type ReportShareRepository } from "../services/assistant/reportSharingService";

const now = new Date("2026-07-21T12:00:00.000Z");

const definition = reportDefinitionSchema.parse({
  version: "v1", title: "Customer product report", audience: "customer_safe", timezone: "America/New_York",
  dataSnapshotAt: now.toISOString(), filters: {}, sources: [{ label: "Invoices", count: 3, freshness: now.toISOString() }],
  sections: [
    { kind: "kpi_grid", title: "Summary", items: [{ label: "Revenue", value: "$120", sensitive: false }, { label: "Margin", value: "$30", sensitive: true }] },
    { kind: "table", title: "Products", columns: [{ key: "product", label: "Product", sensitive: false }, { key: "margin", label: "Margin", sensitive: true }], rows: [{ product: "Yard signs", margin: "$30" }] },
  ],
});

function report(overrides: Partial<AssistantReportRecord> = {}): AssistantReportRecord {
  return {
    id: "report_1", organizationId: "org_1", ownerUserId: "user_1", conversationId: null, sourceTurnId: null,
    title: definition.title, description: null, status: "ready", reportType: "analytical", audience: "customer_safe",
    definition, queryPlan: { internalQuery: "never public" }, dataSnapshot: { product: "Yard signs", margin: 3000, orderId: "order_1" }, snapshotMetadata: {},
    dataSnapshotAt: now, archivedAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function repository(initialReport = report()): ReportShareRepository & { created: AssistantReportShareRecord[]; views: unknown[] } {
  const created: AssistantReportShareRecord[] = [];
  const views: unknown[] = [];
  return {
    created, views,
    get: jest.fn(async (organizationId, reportId) => initialReport.organizationId === organizationId && initialReport.id === reportId ? initialReport : null),
    createShare: jest.fn(async (input) => {
      const share: AssistantReportShareRecord = { id: `share_${created.length + 1}`, organizationId: input.organizationId, reportId: input.reportId, tokenHash: input.tokenHash, audience: input.audience, expiresAt: input.expiresAt, revokedAt: null, downloadAllowed: input.downloadAllowed, createdByUserId: input.createdByUserId, createdAt: now };
      created.push(share); return share;
    }),
    revokeShare: jest.fn(async (_organizationId, _reportId, shareId) => {
      const share = created.find((candidate) => candidate.id === shareId);
      if (!share || share.revokedAt) return false;
      share.revokedAt = now; return true;
    }),
    resolveActiveShare: jest.fn(async (tokenHash, requestedNow) => {
      const share = created.find((candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt && candidate.expiresAt > (requestedNow ?? now));
      return share ? { share, report: initialReport } : null;
    }),
    recordShareView: jest.fn(async (input) => {
      views.push(input);
      return { id: "view_1", ...input, viewerHash: input.viewerHash ?? null, viewedAt: input.viewedAt ?? now };
    }),
  };
}

describe("ReportSharingService", () => {
  test("stores a SHA-256 digest rather than the opaque token and serves only a customer-safe render model", async () => {
    const repo = repository();
    const rawToken = "a".repeat(43);
    const service = new ReportSharingService({ repository: repo, now: () => now, generateToken: () => rawToken });
    const issued = await service.issue({ organizationId: "org_1", reportId: "report_1", actorUserId: "user_1" });
    expect(issued).toMatchObject({ kind: "issued", token: rawToken });
    expect(repo.created[0]!.tokenHash).toBe(hashReportShareToken(rawToken));
    expect(repo.created[0]!.tokenHash).not.toBe(rawToken);

    const resolved = await service.resolvePublic(rawToken, "anonymous-browser-session");
    expect(resolved).toMatchObject({ kind: "available", report: { definition: { audience: "customer_safe", sources: [] } } });
    if (resolved.kind !== "available") throw new Error("expected available report");
    expect(JSON.stringify(resolved.report)).not.toContain("Margin");
    expect(JSON.stringify(resolved.report)).not.toContain("report_1");
    expect(repo.views).toEqual([expect.objectContaining({ reportId: "report_1", shareId: "share_1", viewerHash: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });

  test("refuses to publish an internal report and treats expired/revoked links as unavailable", async () => {
    const privateDefinition = reportDefinitionSchema.parse({ ...definition, audience: "private" });
    const privateRepo = repository(report({ audience: "private", definition: privateDefinition }));
    const privateService = new ReportSharingService({ repository: privateRepo, now: () => now, generateToken: () => "b".repeat(43) });
    await expect(privateService.issue({ organizationId: "org_1", reportId: "report_1", actorUserId: "user_1" })).resolves.toEqual({ kind: "not_customer_safe" });

    const repo = repository();
    const service = new ReportSharingService({ repository: repo, now: () => now, generateToken: () => "c".repeat(43) });
    const issued = await service.issue({ organizationId: "org_1", reportId: "report_1", actorUserId: "user_1", expiresAt: new Date(now.getTime() + 1_000) });
    if (issued.kind !== "issued") throw new Error("expected share");
    await expect(service.revoke({ organizationId: "org_1", reportId: "report_1", shareId: issued.shareId, actorUserId: "user_1" })).resolves.toBe("revoked");
    await expect(service.resolvePublic(issued.token)).resolves.toEqual({ kind: "unavailable" });
  });

  test("removes sensitive fields and internal identifiers from customer-safe persisted snapshots", () => {
    expect(sanitizeCustomerSafeSnapshot({ orderId: "order_1", margin: 42, product: "Yard signs", nested: { internalNote: "secret", quantity: 4 } }))
      .toEqual({ product: "Yard signs", nested: { quantity: 4 } });
  });
});
