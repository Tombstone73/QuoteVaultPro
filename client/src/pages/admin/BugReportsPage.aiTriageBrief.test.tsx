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
let hasActiveTriageBrief: typeof import("./BugReportsPage").hasActiveTriageBrief;

beforeAll(async () => {
  const module = await import("./BugReportsPage");
  AiTriageBriefDetail = module.AiTriageBriefDetail;
  AiTriageBriefHistoryPanel = module.AiTriageBriefHistoryPanel;
  hasActiveTriageBrief = module.hasActiveTriageBrief;
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

describe("AI Triage Brief UI", () => {
  test("detects active briefs for polling", () => {
    expect(hasActiveTriageBrief({ briefs: [baseBrief({ status: "processing" })], canGenerate: true, featureEnabled: true })).toBe(true);
    expect(hasActiveTriageBrief({ briefs: [baseBrief({ status: "completed" })], canGenerate: true, featureEnabled: true })).toBe(false);
  });

  test("renders no brief state", () => {
    const html = renderToStaticMarkup(
      <AiTriageBriefHistoryPanel
        data={{ briefs: [], canGenerate: true, featureEnabled: true }}
        isLoading={false}
        onSelect={() => undefined}
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
      />,
    );

    expect(html).toContain("AI Triage Brief is disabled in AI Settings");
  });

  test("renders pending, failed, and completed detail states", () => {
    const pending = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ status: "pending" })} />);
    const failed = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ status: "failed", errorMessage: "Provider failed." })} />);
    const completed = renderToStaticMarkup(<AiTriageBriefDetail brief={baseBrief({ result: completedResult, summary: completedResult.executiveSummary })} />);

    expect(pending).toContain("Brief is pending");
    expect(failed).toContain("AI triage brief failed");
    expect(failed).toContain("Provider failed");
    expect(completed).toContain("Executive Summary");
    expect(completed).toContain("Active reports only");
    expect(completed).toContain("Top Operational Risks");
    expect(completed).toContain("Suggested Priority Order");
    expect(completed).toContain("Recommended Next Sprint");
    expect(completed).toContain("75%");
  });
});
