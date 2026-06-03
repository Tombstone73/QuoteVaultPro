import React from "react";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import type { AiTriageBriefDto, AiTriageBriefListResponse } from "@shared/aiTriageBriefContracts";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => <h2 className={className}>{children}</h2>,
}));

let AiTriageBriefDetail: typeof import("./BugReportsPage").AiTriageBriefDetail;
let AiTriageBriefHistoryPanel: typeof import("./BugReportsPage").AiTriageBriefHistoryPanel;
let BugReportFiltersBar: typeof import("./BugReportsPage").BugReportFiltersBar;
let SortableTableHead: typeof import("./BugReportsPage").SortableTableHead;
let canGenerateAiTriageBrief: typeof import("./BugReportsPage").canGenerateAiTriageBrief;
let canExportAiTriageBriefPdf: typeof import("./BugReportsPage").canExportAiTriageBriefPdf;
let downloadAiTriageBriefPdf: typeof import("./BugReportsPage").downloadAiTriageBriefPdf;
let getNextBugReportSortState: typeof import("./BugReportsPage").getNextBugReportSortState;
let getTriageBriefHistorySummary: typeof import("./BugReportsPage").getTriageBriefHistorySummary;
let hasActiveTriageBrief: typeof import("./BugReportsPage").hasActiveTriageBrief;
let sortBugReportsForDisplay: typeof import("./BugReportsPage").sortBugReportsForDisplay;

beforeAll(async () => {
  const module = await import("./BugReportsPage");
  AiTriageBriefDetail = module.AiTriageBriefDetail;
  AiTriageBriefHistoryPanel = module.AiTriageBriefHistoryPanel;
  BugReportFiltersBar = module.BugReportFiltersBar;
  SortableTableHead = module.SortableTableHead;
  canGenerateAiTriageBrief = module.canGenerateAiTriageBrief;
  canExportAiTriageBriefPdf = module.canExportAiTriageBriefPdf;
  downloadAiTriageBriefPdf = module.downloadAiTriageBriefPdf;
  getNextBugReportSortState = module.getNextBugReportSortState;
  getTriageBriefHistorySummary = module.getTriageBriefHistorySummary;
  hasActiveTriageBrief = module.hasActiveTriageBrief;
  sortBugReportsForDisplay = module.sortBugReportsForDisplay;
});

function baseBrief(overrides: Partial<AiTriageBriefDto> = {}): AiTriageBriefDto {
  return {
    id: "brief_1",
    orgId: "org_1",
    status: "completed",
    requestedByEmail: "admin@example.test",
    filtersSnapshot: {},
    reportSnapshot: [],
    provider: "openai",
    model: "gpt-4o-mini",
    mode: "printershero_managed",
    promptVersion: "triage-brief-v1",
    result: null,
    summary: null,
    topRisks: null,
    topFeatures: null,
    recommendedPriorities: null,
    duplicateSignals: null,
    workflowRisks: null,
    revenueRisks: null,
    unknowns: null,
    confidence: null,
    providerMetadata: null,
    usageMetadata: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const completedResult: NonNullable<AiTriageBriefDto["result"]> = {
  executiveSummary: "Reports cluster around quote save reliability.",
  topOperationalRisks: [{ title: "Quote save failures", impact: "Operators cannot save work.", confidence: 0.8, rationale: "Multiple reports mention save failures." }],
  topWorkflowRisks: [{ title: "Quote workflow blocked", impact: "Quote work stalls.", confidence: 0.7, rationale: "Saving is required before handoff." }],
  topRevenueRisks: [{ title: "Quote conversion delay", impact: "Revenue may be delayed.", confidence: 0.6, rationale: "Quotes cannot progress." }],
  topBugClusters: [{ issue: "Quote save fails", reportCount: 2, affectedModules: ["Quotes"], impact: "Blocks quote editing." }],
  topFeatureRequests: [{ feature: "Bulk proof reminders", requestCount: 1, value: "Less manual follow-up.", complexity: "unknown" }],
  duplicateSignals: [{ theme: "Quote save", reportIds: ["bug_1", "bug_2"], rationale: "Same module and symptom.", confidence: 0.8 }],
  suggestedPriorityOrder: [{ item: "Investigate quote save", rationale: "High workflow impact.", urgency: "high" }],
  recommendedNextSprint: [{ item: "Reproduce quote save", rationale: "Needed before fix.", urgency: "high" }],
  unknowns: ["No logs supplied."],
  confidence: 0.75,
};

function report(overrides: Partial<import("./BugReportsPage").BugReportListItem>): import("./BugReportsPage").BugReportListItem {
  return {
    id: overrides.id ?? "report_1",
    referenceNumber: overrides.referenceNumber ?? "B-0001",
    type: overrides.type ?? "bug",
    title: overrides.title ?? "Default report",
    severity: overrides.severity ?? "medium",
    status: overrides.status ?? "open",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    createdByEmail: overrides.createdByEmail ?? "admin@example.test",
    url: overrides.url ?? "https://example.test",
  };
}

describe("AI Triage Brief UI", () => {
  test("renders compact filter bar with Filters inline and search using remaining width", () => {
    const html = renderToStaticMarkup(
      <BugReportFiltersBar
        statusFilter="all"
        severityFilter="all"
        typeFilter="all"
        searchFilter=""
        onStatusChange={() => undefined}
        onSeverityChange={() => undefined}
        onTypeChange={() => undefined}
        onSearchChange={() => undefined}
      />,
    );

    expect(html).toContain("Filters");
    expect(html).toContain("Status");
    expect(html).toContain("Severity");
    expect(html).toContain("Type");
    expect(html).toContain("Search");
    expect(html).toContain("flex flex-wrap items-center gap-3");
    expect(html).toContain("flex-1");
    expect(html).not.toContain("<h3");
  });

  test("detects active briefs for polling", () => {
    expect(hasActiveTriageBrief({ briefs: [baseBrief({ status: "processing" })], canGenerate: true, featureEnabled: true })).toBe(true);
    expect(hasActiveTriageBrief({ briefs: [baseBrief({ status: "completed" })], canGenerate: true, featureEnabled: true })).toBe(false);
  });

  test("enables Generate AI Triage Brief only when capability is enabled", () => {
    const enabled: AiTriageBriefListResponse = { briefs: [], canGenerate: true, featureEnabled: true };
    const disabled: AiTriageBriefListResponse = { briefs: [], canGenerate: false, featureEnabled: false };

    expect(canGenerateAiTriageBrief(enabled, false)).toBe(true);
    expect(canGenerateAiTriageBrief(enabled, true)).toBe(false);
    expect(canGenerateAiTriageBrief(disabled, false)).toBe(false);
    expect(canGenerateAiTriageBrief(undefined, false)).toBe(false);
  });

  test("allows PDF export only for completed briefs and owner/admin users", () => {
    expect(canExportAiTriageBriefPdf(baseBrief({ status: "completed" }), true)).toBe(true);
    expect(canExportAiTriageBriefPdf(baseBrief({ status: "processing" }), true)).toBe(false);
    expect(canExportAiTriageBriefPdf(baseBrief({ status: "failed" }), true)).toBe(false);
    expect(canExportAiTriageBriefPdf(baseBrief({ status: "completed" }), false)).toBe(false);
  });

  test("renders no brief state", () => {
    const html = renderToStaticMarkup(
      <AiTriageBriefHistoryPanel
        data={{ briefs: [], canGenerate: true, featureEnabled: true }}
        isLoading={false}
        onSelect={() => undefined}
        isExpanded
      />,
    );

    expect(html).toContain("AI Triage Brief History");
    expect(html).toContain("No AI triage brief has been generated yet");
    expect(html).toContain("AI Advisory");
    expect(html).toContain("active feedback only");
    expect(html).toContain("Resolved and closed reports are excluded");
  });

  test("renders disabled state clearly", () => {
    const html = renderToStaticMarkup(
      <AiTriageBriefHistoryPanel
        data={{ briefs: [], canGenerate: false, featureEnabled: false }}
        isLoading={false}
        onSelect={() => undefined}
        isExpanded
      />,
    );

    expect(html).toContain("AI Triage Brief is disabled in AI Settings");
  });

  test("history is collapsed by default and shows summary when collapsed", () => {
    const data: AiTriageBriefListResponse = {
      briefs: [
        baseBrief({ id: "brief_1", createdAt: "2026-06-01T16:00:00Z" }),
        baseBrief({ id: "brief_2", createdAt: "2026-06-03T16:00:00Z" }),
      ],
      canGenerate: true,
      featureEnabled: true,
    };
    const html = renderToStaticMarkup(
      <AiTriageBriefHistoryPanel
        data={data}
        isLoading={false}
        onSelect={() => undefined}
      />,
    );

    expect(getTriageBriefHistorySummary(data)).toEqual({ count: 2, latestLabel: "Jun 3, 2026" });
    expect(html).toContain("AI Triage Brief History (2)");
    expect(html).toContain("Latest: Jun 3, 2026");
    expect(html).toContain("Expand");
    expect(html).toContain("Active reports only");
    expect(html).not.toContain("Normal triage briefs analyze active feedback only");
    expect(html).not.toContain("admin@example.test");
  });

  test("history expands and collapses using the expanded prop", () => {
    const data: AiTriageBriefListResponse = {
      briefs: [baseBrief({ id: "brief_1", summary: "Quote save reliability", createdAt: "2026-06-03T00:00:00Z" })],
      canGenerate: true,
      featureEnabled: true,
    };
    const collapsed = renderToStaticMarkup(
      <AiTriageBriefHistoryPanel data={data} isLoading={false} onSelect={() => undefined} isExpanded={false} />,
    );
    const expanded = renderToStaticMarkup(
      <AiTriageBriefHistoryPanel data={data} isLoading={false} onSelect={() => undefined} isExpanded />,
    );

    expect(collapsed).toContain("Expand");
    expect(collapsed).not.toContain("Quote save reliability");
    expect(expanded).toContain("Collapse");
    expect(expanded).toContain("Quote save reliability");
    expect(expanded).toContain("admin@example.test");
  });

  test("cycles table sort state and renders sort indicators", () => {
    const asc = getNextBugReportSortState({ key: null, direction: null }, "referenceNumber");
    const desc = getNextBugReportSortState(asc, "referenceNumber");
    const reset = getNextBugReportSortState(desc, "referenceNumber");
    const ascHtml = renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <SortableTableHead label="Reference" sortKey="referenceNumber" sortState={asc} onSort={() => undefined} />
          </tr>
        </thead>
      </table>,
    );
    const descHtml = renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <SortableTableHead label="Reference" sortKey="referenceNumber" sortState={desc} onSort={() => undefined} />
          </tr>
        </thead>
      </table>,
    );

    expect(asc).toEqual({ key: "referenceNumber", direction: "asc" });
    expect(desc).toEqual({ key: "referenceNumber", direction: "desc" });
    expect(reset).toEqual({ key: null, direction: null });
    expect(ascHtml).toContain("▲");
    expect(descHtml).toContain("▼");
  });

  test("reference sort uses prefix and numeric portions", () => {
    const sorted = sortBugReportsForDisplay([
      report({ id: "b100", referenceNumber: "B-0100" }),
      report({ id: "f2", referenceNumber: "F-0002", type: "feature" }),
      report({ id: "b2", referenceNumber: "B-0002" }),
      report({ id: "b10", referenceNumber: "B-0010" }),
    ], { key: "referenceNumber", direction: "asc" });

    expect(sorted.map((item) => item.referenceNumber)).toEqual(["B-0002", "B-0010", "B-0100", "F-0002"]);
  });

  test("created sort preserves newest-first default and supports explicit created sort", () => {
    const items = [
      report({ id: "old", referenceNumber: "B-0001", createdAt: "2026-01-01T00:00:00Z" }),
      report({ id: "new", referenceNumber: "B-0002", createdAt: "2026-06-01T00:00:00Z" }),
    ];

    expect(sortBugReportsForDisplay(items, { key: null, direction: null }).map((item) => item.id)).toEqual(["new", "old"]);
    expect(sortBugReportsForDisplay(items, { key: "createdAt", direction: "asc" }).map((item) => item.id)).toEqual(["old", "new"]);
  });

  test("severity and status sorts use workflow order", () => {
    const severitySorted = sortBugReportsForDisplay([
      report({ id: "critical", severity: "critical" }),
      report({ id: "low", severity: "low" }),
      report({ id: "high", severity: "high" }),
    ], { key: "severity", direction: "asc" });
    const statusSorted = sortBugReportsForDisplay([
      report({ id: "closed", status: "closed" }),
      report({ id: "review", status: "in_review" }),
      report({ id: "open", status: "open" }),
    ], { key: "status", direction: "asc" });

    expect(severitySorted.map((item) => item.id)).toEqual(["low", "high", "critical"]);
    expect(statusSorted.map((item) => item.id)).toEqual(["open", "review", "closed"]);
  });

  test("search results can still be sorted client-side", () => {
    const searchResults = [
      report({ id: "b10", referenceNumber: "B-0010", title: "Quote save" }),
      report({ id: "b2", referenceNumber: "B-0002", title: "Quote save" }),
    ];

    expect(sortBugReportsForDisplay(searchResults, { key: "referenceNumber", direction: "asc" }).map((item) => item.id)).toEqual(["b2", "b10"]);
  });


  test("renders pending, failed, and completed detail states", () => {
    const pending = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ status: "pending" })} />);
    const failed = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ status: "failed", errorMessage: "Provider failed." })} />);
    const completed = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ result: completedResult, summary: completedResult.executiveSummary })} canExportPdf />);

    expect(pending).toContain("Brief is pending");
    expect(failed).toContain("AI triage brief failed");
    expect(failed).toContain("Provider failed");
    expect(completed).toContain("Executive Summary");
    expect(completed).toContain("Export PDF");
    expect(completed).toContain("Active reports only");
    expect(completed).toContain("Top Operational Risks");
    expect(completed).toContain("Suggested Priority Order");
    expect(completed).toContain("Recommended Next Sprint");
    expect(completed).toContain("75%");
  });

  test("does not render PDF export for pending or non-admin detail state", () => {
    const pending = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ status: "pending" })} canExportPdf />);
    const completedWithoutPermission = renderToStaticMarkup(
      <AiTriageBriefDetail brief={baseBrief({ result: completedResult, summary: completedResult.executiveSummary })} canExportPdf={false} />,
    );

    expect(pending).not.toContain("Export PDF");
    expect(completedWithoutPermission).not.toContain("Export PDF");
  });

  test("PDF export uses authenticated fetch and downloads returned blob", async () => {
    const click = jest.fn();
    const originalFetch = global.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = jest.fn(() => "blob:triage-brief");
    const revokeObjectURL = jest.fn();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-disposition"
          ? 'attachment; filename="printers-hero-ai-triage-brief-2026-06-03.pdf"'
          : null,
      },
      blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
    }));
    const appendChildSpy = jest.spyOn(document.body, "appendChild");
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = jest.spyOn(document, "createElement");

    global.fetch = fetchMock as any;
    URL.createObjectURL = createObjectURL as any;
    URL.revokeObjectURL = revokeObjectURL as any;
    createElementSpy.mockImplementationOnce((tagName: string) => {
      const anchor = originalCreateElement(tagName);
      anchor.click = click;
      return anchor;
    });

    try {
      await downloadAiTriageBriefPdf("brief_1");

      expect(fetchMock).toHaveBeenCalledWith("/api/bug-reports/ai-triage-briefs/brief_1/pdf", expect.objectContaining({
        method: "GET",
        credentials: "include",
      }));
      expect(appendChildSpy).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:triage-brief");
    } finally {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      appendChildSpy.mockRestore();
      createElementSpy.mockRestore();
    }
  });
});
