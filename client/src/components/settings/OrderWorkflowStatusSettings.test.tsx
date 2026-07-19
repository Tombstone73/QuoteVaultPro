import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const statusPills = [
  "New", "Needs Review", "Waiting on Artwork", "Design Needed", "Proof Sent",
  "Waiting on Approval", "Approved", "Prepress", "In Production", "Fulfillment",
  "Ready for Pickup", "Ready to Ship", "Shipped", "Picked Up", "Invoiced", "Paid",
  "Complete", "Closed", "On Hold", "Problem", "Canceled",
].map((name, index) => ({
  id: `pill-${index}`,
  organizationId: "org-1",
  stateScope: index >= 16 && index <= 17 ? "closed" : index === 20 ? "canceled" : "open",
  key: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  name,
  color: "#2563EB",
  category: "order",
  lifecycleMapping: "order",
  customerVisible: false,
  notificationTriggerEligible: true,
  isDefault: index === 0,
  isActive: true,
  sortOrder: (index + 1) * 10,
  createdAt: "2026-07-18",
  updatedAt: "2026-07-18",
}));

const mappings = [
  {
    id: "mapping-production", organizationId: "org-1", triggerKey: "sent_to_production",
    targetStatusKey: "in_production", source: "system", isActive: true,
    overwriteExceptionStatus: false, createdAt: "2026-07-18", updatedAt: "2026-07-18",
  },
  {
    id: "mapping-canceled", organizationId: "org-1", triggerKey: "order_canceled",
    targetStatusKey: "canceled", source: "system", isActive: false,
    overwriteExceptionStatus: true, createdAt: "2026-07-18", updatedAt: "2026-07-18",
  },
];

jest.mock("@/hooks/useOrderStatusPills", () => ({
  useOrderStatusPills: () => ({ data: statusPills, isLoading: false, isError: false }),
  useUpdateStatusPill: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/useWorkflowStatusPillMappings", () => ({
  useWorkflowStatusPillMappings: () => ({ data: mappings, isLoading: false, isError: false }),
  useUpdateWorkflowStatusPillMapping: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("@/components/ui/badge", () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
jest.mock("@/components/ui/switch", () => ({ Switch: ({ checked, ...props }: any) => <input type="checkbox" checked={checked} readOnly {...props} /> }));
jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <span data-value={value}>{children}</span>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
}));
jest.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
}));

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { OrderStatusPillSettings, WorkflowStatusAutomationSettings } = require("./OrderWorkflowStatusSettings") as typeof import("./OrderWorkflowStatusSettings");

describe("Production & Operations status settings", () => {
  test("renders the full active order status-pill catalog with stable keys", () => {
    const html = renderToStaticMarkup(<OrderStatusPillSettings />);
    for (const pill of statusPills) {
      expect(html).toContain(`value="${pill.name}"`);
      expect(html).toContain(pill.key);
    }
    expect(html).toContain("Key is permanent");
    expect(html).toContain("same statuses used by the Orders list");
  });

  test("renders default mappings, active targets, source, and disabled state", () => {
    const html = renderToStaticMarkup(<WorkflowStatusAutomationSettings />);
    expect(html).toContain("Sent To Production");
    expect(html).toContain("Order Canceled");
    expect(html).toContain("in_production");
    expect(html).toContain("System workflow");
    expect(html).toContain("Resolve exceptions order_canceled");
  });

  test("legacy workflow and production triggers are clearly separated from order pills", () => {
    const settingsSource = fs.readFileSync(path.join(process.cwd(), "client/src/pages/settings/SettingsLayout.tsx"), "utf8");
    expect(settingsSource).toContain('title="Order Status Pills"');
    expect(settingsSource).toContain('title="Workflow Status Automation"');
    expect(settingsSource).toContain('title="Canonical Order Lifecycle (Advanced)"');
    expect(settingsSource).toContain('title="Production Intake Triggers & Routing"');
    expect(settingsSource).not.toContain('title="Customer Order Statuses"');
  });
});
