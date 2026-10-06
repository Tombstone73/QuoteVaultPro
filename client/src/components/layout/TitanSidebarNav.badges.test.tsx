import * as React from "react";
import { readFileSync } from "node:fs";
import { TextDecoder, TextEncoder } from "node:util";
import { TitanSidebarNav } from "./TitanSidebarNav";

Object.assign(globalThis, { TextEncoder, TextDecoder });
const { renderToStaticMarkup } = require("react-dom/server");

let activeOrgId: string | null = "org-a";
let summaryByOrg: Record<string, any> = {};
let summaryError = false;
const mockApiFetch = jest.fn();
const mockUseQuery = jest.fn((options: any) => {
  if (options.queryKey[0] === "/api/operational-summary") {
    return {
      data: options.enabled ? summaryByOrg[options.queryKey[1]] : undefined,
      isError: summaryError,
    };
  }
  return { data: undefined, isError: false };
});

jest.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => mockUseQuery(options) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: (...args: any[]) => mockApiFetch(...args) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff-1" } }) }));
jest.mock("@/hooks/useActiveOrganizationRole", () => ({
  useActiveOrganizationRole: () => ({ activeOrgId, role: "owner", isApprover: true }),
}));
jest.mock("@/hooks/useOrgPreferences", () => ({ useOrgPreferences: () => ({ preferences: {} }) }));
jest.mock("@/hooks/useInboundEmailIntakeSettings", () => ({ useInboundEmailIntakeSettings: () => ({ data: undefined }) }));
jest.mock("@/contexts/NavigationGuardContext", () => ({ useNavigationGuard: () => ({ guardedNavigate: jest.fn() }) }));
jest.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
jest.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: "/orders", search: "", hash: "", state: null, key: "test" }) }));

const summary = {
  orders: 34, inboundOrders: 3, overview: 22, design: 2, proofing: 5,
  prepress: 1, flatbed: 8, roll: 6, fulfillment: 4,
  invoices: { readyToFinalizeNeverSent: 11, pendingSend: 12, unpaid: 13 },
};

function renderSidebar() {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<TitanSidebarNav />);
  return root;
}

function navBadge(root: HTMLElement, label: string): string | null {
  const button = Array.from(root.querySelectorAll('nav[aria-label="Application navigation"] button'))
    .find((candidate) => candidate.querySelector("span")?.textContent === label);
  return button?.querySelector("div")?.textContent ?? null;
}

beforeEach(() => {
  localStorage.clear();
  activeOrgId = "org-a";
  summaryByOrg = { "org-a": summary };
  summaryError = false;
  mockApiFetch.mockReset();
  mockUseQuery.mockClear();
});

test("valid organization executes the canonical count query and renders all resolved badges", async () => {
  const root = renderSidebar();
  const query = mockUseQuery.mock.calls.map(([options]) => options)
    .find((options) => options.queryKey[0] === "/api/operational-summary");
  expect(query).toMatchObject({ queryKey: ["/api/operational-summary", "org-a"], enabled: true });
  mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: summary }) });
  await expect(query.queryFn()).resolves.toEqual(summary);
  expect(mockApiFetch).toHaveBeenCalledWith("/api/operational-summary");
  for (const [label, value] of Object.entries({
    Orders: 34, "Inbound Orders": 3, Overview: 22, Design: 2, Proofing: 5,
    Prepress: 1, Flatbed: 8, Roll: 6, Fulfillment: 4, Invoices: 11,
  })) {
    expect(navBadge(root, label)).toBe(String(value));
  }
});

test("authoritative zero displays while loading and failed requests do not claim zero", async () => {
  summaryByOrg = { "org-a": { ...summary, orders: 0, roll: 0 } };
  expect(navBadge(renderSidebar(), "Orders")).toBe("0");
  expect(navBadge(renderSidebar(), "Roll")).toBe("0");

  summaryByOrg = {};
  expect(navBadge(renderSidebar(), "Orders")).toBeNull();
  summaryError = true;
  expect(navBadge(renderSidebar(), "Orders")).toBeNull();
  const query = mockUseQuery.mock.calls.map(([options]) => options)
    .find((options) => options.queryKey[0] === "/api/operational-summary");
  mockApiFetch.mockResolvedValue({ ok: false, status: 500 });
  await expect(query.queryFn()).rejects.toThrow("Operational counts request failed: 500");
});

test("tenant switching changes the query key and the rendered count", () => {
  activeOrgId = null;
  renderSidebar();
  expect(mockUseQuery.mock.calls.find(([options]) => options.queryKey[0] === "/api/operational-summary")?.[0].enabled).toBe(false);

  activeOrgId = "org-b";
  summaryByOrg["org-b"] = { ...summary, orders: 7 };
  const root = renderSidebar();
  expect(navBadge(root, "Orders")).toBe("7");
  expect(mockUseQuery.mock.calls.at(-1)?.[0].queryKey).toEqual(["/api/operational-summary", "org-b"]);
});

test("the existing proofing queue excludes production bypass before strict proof truth hydration", () => {
  const producer = readFileSync("server/routes/orders.routes.ts", "utf8");
  const proofing = readFileSync("server/services/proofingService.ts", "utf8");
  const summaryService = readFileSync("server/services/operationalSummary.ts", "utf8");
  expect(producer).toContain('workflowState: "no_production_required" as any');
  expect(proofing).toContain('ne(orderLineItems.workflowState, "no_production_required" as any)');
  expect(proofing.indexOf('ne(orderLineItems.workflowState, "no_production_required" as any)'))
    .toBeLessThan(proofing.indexOf("const truthMap = await resolveProofingTruthMap(tx, {"));
  expect(summaryService).toContain("listProofingQueue(db, {");
  expect(summaryService).toContain("countAwaitingProofQueueRows(proofingQueue.rows)");
});
