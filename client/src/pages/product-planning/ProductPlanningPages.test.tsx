import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

let currentPath = "/product-planning/work-items/item_1";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }: any) => <a href={typeof to === "string" ? to : String(to)} {...props}>{children}</a>,
  Navigate: ({ to }: any) => <div>Navigate to {to}</div>,
  useLocation: () => ({ pathname: currentPath }),
  useNavigate: () => () => undefined,
  useParams: () => ({ id: "item_1" }),
  useSearchParams: () => [new URLSearchParams(), () => undefined],
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" }, isLoading: false }),
}));

const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const mockApiRequest = jest.fn((_method?: string, _url?: string, _data?: unknown): Promise<any> => Promise.resolve({ json: async () => ({ data: { suggestion: { id: "suggestion_1", status: "accepted" }, workItem: null } }) }));
jest.mock("@/lib/queryClient", () => ({
  apiRequest: (method: string, url: string, data?: unknown) => mockApiRequest(method, url, data),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span>Select</span>,
}));

let ProductPlanningWorkItemDetailPage: typeof import("./ProductPlanningPages").ProductPlanningWorkItemDetailPage;
let ProductPlanningRoadmapPage: typeof import("./ProductPlanningPages").ProductPlanningRoadmapPage;
let BacklogExpandedRow: typeof import("./ProductPlanningPages").BacklogExpandedRow;
let DetailDependencies: typeof import("./ProductPlanningPages").DetailDependencies;

beforeAll(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const module = await import("./ProductPlanningPages");
  ProductPlanningWorkItemDetailPage = module.ProductPlanningWorkItemDetailPage;
  ProductPlanningRoadmapPage = module.ProductPlanningRoadmapPage;
  BacklogExpandedRow = module.BacklogExpandedRow;
  DetailDependencies = module.DetailDependencies;
});

beforeEach(() => {
  toastMock.mockClear();
  mockApiRequest.mockClear();
});

afterEach(() => {
  delete (global as any).fetch;
});

function responseJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderWithProviders(children: React.ReactNode, initialPath = "/product-planning/work-items/item_1") {
  currentPath = initialPath;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

async function flushQueries() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

const detailItem = {
  id: "item_1",
  reference: "PP-0001",
  title: "Improve planning details",
  description: "Full description for planning review.",
  workItemType: "feature",
  planningStatus: "dev_validation",
  priority: "high",
  businessValue: "high",
  complexity: "medium",
  phase: "go_live",
  module: "Planning",
  submodule: "Detail",
  tags: [],
  sourceType: "bug_report",
  sourceBugReportId: "bug_1",
  sourceReference: "BUG-100",
  importedBatchId: "batch_1",
  parentId: "epic_1",
  parent: {
    id: "epic_1",
    reference: "PP-0000",
    title: "Planning epic",
    workItemType: "epic",
    planningStatus: "backlog",
    priority: "medium",
  },
  children: [{
    id: "child_1",
    reference: "PP-0002",
    title: "Child task",
    workItemType: "task",
    planningStatus: "ready",
    priority: "medium",
  }],
  releaseId: "release_1",
  releaseTarget: "Go Live",
  release: { id: "release_1", name: "Go Live Release", status: "planned", targetDate: null },
  sourceBugReport: { id: "bug_1", referenceNumber: "BUG-100", title: "Original bug", status: "open", severity: "high" },
  importBatch: { id: "batch_1", filename: "backlog.csv", importedCount: 4, skippedCount: 1 },
  requestedBy: "Operations",
  ownerUserId: "owner_1",
  dueDate: "2026-07-01",
  priorityScore: 88,
  priorityScoreExplanation: {},
  notes: "Important planning notes.",
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-06-02T12:00:00.000Z",
  archivedAt: null,
  dependencies: [{
    id: "dep_1",
    workItemId: "item_1",
    dependsOnWorkItemId: "dep_item_1",
    dependencyType: "requires",
    dependsOnWorkItem: {
      id: "dep_item_1",
      reference: "PP-0003",
      title: "Required item",
      workItemType: "task",
      planningStatus: "backlog",
      priority: "medium",
    },
    createdAt: "2026-06-02T12:00:00.000Z",
  }],
  blockedBy: [{
    id: "dep_2",
    workItemId: "blocked_1",
    dependsOnWorkItemId: "item_1",
    dependencyType: "blocks",
    workItem: {
      id: "blocked_1",
      reference: "PP-0004",
      title: "Blocked item",
      workItemType: "feature",
      planningStatus: "planned",
      priority: "high",
    },
    createdAt: "2026-06-02T12:00:00.000Z",
  }],
  events: [
    { id: "event_2", eventType: "updated", message: "Status changed", metadata: null, createdAt: "2026-06-02T12:00:00.000Z", createdByUserId: "owner_1" },
    { id: "event_1", eventType: "created", message: "Created", metadata: null, createdAt: "2026-06-01T12:00:00.000Z", createdByUserId: "owner_1" },
  ],
};

const aiSuggestions = [{
  id: "suggestion_1",
  workItemId: "item_1",
  suggestionType: "priority",
  currentValue: "medium",
  suggestedValue: "high",
  confidence: 82,
  reasoning: "Customer-facing blocker.",
  status: "pending",
  createdAt: "2026-06-02T12:00:00.000Z",
  reviewedAt: null,
  reviewedByUserId: null,
}, {
  id: "suggestion_2",
  workItemId: "item_1",
  suggestionType: "duplicate_candidate",
  currentValue: JSON.stringify({ id: "item_1", reference: "PP-0001", title: "Improve planning details" }),
  suggestedValue: JSON.stringify({ id: "item_9", reference: "PP-0009", title: "Planning details duplicate", similarity: 91 }),
  confidence: "91.00",
  reasoning: "Same workflow and implementation goal.",
  status: "pending",
  createdAt: "2026-06-02T12:00:00.000Z",
  reviewedAt: null,
  reviewedByUserId: null,
}, {
  id: "suggestion_3",
  workItemId: "item_1",
  suggestionType: "implementation_notes",
  currentValue: null,
  suggestedValue: JSON.stringify({ notes: "Suggested approach:\n- Keep changes additive.\n\nValidation checklist:\n- Run focused tests." }),
  confidence: "72.00",
  reasoning: "Generated implementation notes from item context.",
  status: "pending",
  createdAt: "2026-06-02T12:00:00.000Z",
  reviewedAt: null,
  reviewedByUserId: null,
}];

describe("Product Planning UX detail surfaces", () => {
  test("detail page renders readable planning sections, hierarchy, dependencies, and timeline", async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url === "/api/product-planning/work-items/item_1") return responseJson({ success: true, data: detailItem });
      if (url === "/api/product-planning/releases") return responseJson({ success: true, data: [detailItem.release] });
      if (url === "/api/product-planning/work-items?limit=250") return responseJson({ success: true, data: [detailItem] });
      if (url === "/api/product-planning/work-items/item_1/ai-suggestions") return responseJson({ success: true, data: aiSuggestions });
      return responseJson({ success: false, message: "Not found" }, 404);
    }) as any;

    const { container, root } = renderWithProviders(
      <ProductPlanningWorkItemDetailPage />,
    );
    await flushQueries();

    expect(container.textContent).toContain("PP-0001");
    expect(container.textContent).toContain("Improve planning details");
    expect(container.textContent).toContain("Full description for planning review.");
    expect(container.textContent).toContain("Important planning notes.");
    expect(container.textContent).toContain("Planning Details");
    expect(container.textContent).toContain("Original bug");
    expect(container.textContent).toContain("Required item");
    expect(container.textContent).toContain("Blocked item");
    expect(container.textContent).toContain("Parent Epic");
    expect(container.textContent).toContain("Child task");
    expect(container.textContent).toContain("Activity Timeline");
    expect(container.textContent).toContain("Status changed");
    expect(container.textContent).toContain("AI Suggestions");
    expect(container.textContent).toContain("Customer-facing blocker.");
    expect(container.textContent).toContain("Planning details duplicate");
    expect(container.textContent).toContain("Suggested approach");
    const acceptButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Accept") as HTMLButtonElement;
    act(() => {
      Simulate.click(acceptButton);
    });
    await flushQueries();
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/product-planning/ai-suggestions/suggestion_1/accept", {});
    cleanup(root, container);
  });

  test("backlog expansion renders read-only details and dependency summaries", async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url === "/api/product-planning/work-items/item_1/dependencies") {
        return responseJson({ success: true, data: detailItem.dependencies });
      }
      return responseJson({ success: false, message: "Not found" }, 404);
    }) as any;

    const { container, root } = renderWithProviders(
      <BacklogExpandedRow item={detailItem as any} release={detailItem.release as any} />,
    );
    await flushQueries();

    expect(container.textContent).toContain("Full description for planning review.");
    expect(container.textContent).toContain("Important planning notes.");
    expect(container.textContent).toContain("PP-0003");
    expect(container.textContent).toContain("Go Live Release");
    expect(container.textContent).toContain("bug report");
    cleanup(root, container);
  });

  test("dependency section renders useful empty states", () => {
    const { container, root } = renderWithProviders(
      <DetailDependencies dependsOn={[]} blockedBy={[]} related={[]} />,
    );

    expect(container.textContent).toContain("Depends On");
    expect(container.textContent).toContain("Blocked By");
    expect(container.textContent).toContain("Related Items");
    expect((container.textContent?.match(/No items linked./g) ?? []).length).toBe(3);
    cleanup(root, container);
  });

  test("roadmap assistant renders recommendations after suggestion request", async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (String(url).startsWith("/api/product-planning/work-items?")) return responseJson({ success: true, data: [detailItem] });
      if (url === "/api/product-planning/releases") return responseJson({ success: true, data: [detailItem.release] });
      return responseJson({ success: false, message: "Not found" }, 404);
    }) as any;
    mockApiRequest.mockImplementationOnce(() => Promise.resolve({
      json: async () => ({
        data: [{
          id: "roadmap_suggestion_1",
          workItemId: "item_1",
          suggestionType: "phase",
          currentValue: null,
          suggestedValue: "v1_1",
          confidence: "78.00",
          reasoning: "Customer-facing item should be reviewed for Version 1.1.",
          status: "pending",
          createdAt: "2026-06-02T12:00:00.000Z",
          reviewedAt: null,
          reviewedByUserId: null,
        }],
      }),
    }));

    const { container, root } = renderWithProviders(<ProductPlanningRoadmapPage />, "/product-planning/roadmap");
    await flushQueries();
    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("Suggest Grouping")) as HTMLButtonElement;
    act(() => {
      Simulate.click(button);
    });
    await flushQueries();

    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/product-planning/roadmap/suggest-grouping", {});
    expect(container.textContent).toContain("Roadmap Suggestions");
    expect(container.textContent).toContain("Customer-facing item should be reviewed for Version 1.1.");
    cleanup(root, container);
  });
});
