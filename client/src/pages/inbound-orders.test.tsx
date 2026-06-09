import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import InboundOrdersPage from "./inbound-orders";
import { apiFetch } from "@/lib/queryClient";

jest.mock("@/lib/queryClient", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...props }: any) => <div role="alert" {...props}>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
  AlertTitle: ({ children }: any) => <strong>{children}</strong>,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild) return children;
    return <button {...props}>{children}</button>;
  },
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => <div className={className}>Loading</div>,
}));

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

const apiFetchMock = jest.mocked(apiFetch);

let container: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  } as any;
}

function record(overrides: Record<string, any> = {}) {
  return {
    id: "inbound_1",
    organizationId: "org_1",
    sourceId: null,
    sourceType: "manual",
    sourceLabel: "TEMP_INBOUND manual intake",
    sourceTrustLevel: "manual_internal",
    sourceRecordId: null,
    sourceMessageId: null,
    status: "needs_review",
    reviewOutcome: null,
    requiresHumanDecision: true,
    reviewRequiredReason: "Manual TEMP_INBOUND record needs staff review.",
    externalReference: "PO-123",
    idempotencyKey: null,
    payloadHash: null,
    rawPayloadJson: {
      intakeMode: "TEMP_INBOUND",
      reference: "PO-123",
      sender: { name: "Ada Lovelace", email: "ada@example.com" },
      subject: "Need banners",
      bodyText: "Please make two banners.",
      notes: "Counter intake",
    },
    normalizedPayloadJson: {},
    extractedCustomerJson: {},
    extractedOrderJson: {},
    extractedShippingJson: {},
    confidenceScore: null,
    duplicateScore: null,
    matchedCustomerId: null,
    matchedContactId: null,
    matchedQuoteId: null,
    matchedOrderId: null,
    createdQuoteId: null,
    createdOrderId: null,
    assignedToUserId: null,
    submittedByUserId: null,
    rejectedByUserId: null,
    rejectionReason: null,
    receivedAt: "2026-06-09T12:00:00.000Z",
    parsedAt: null,
    reviewStartedAt: null,
    approvedAt: null,
    submittedAt: null,
    rejectedAt: null,
    archivedAt: null,
    createdAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:00:00.000Z",
    ...overrides,
  };
}

function detail(row = record()) {
  return {
    record: row,
    source: null,
    lineItems: [],
    files: [],
    warnings: [],
    decisionFlags: [],
    events: [{
      id: "event_1",
      eventType: "record.received",
      actorType: "user",
      fromStatus: null,
      toStatus: "needs_review",
      message: "Manual TEMP_INBOUND record created for review",
      metadataJson: {},
      createdAt: "2026-06-09T12:00:00.000Z",
    }],
    reviewSnapshots: [],
    latestReviewSnapshot: null,
    linkedQuote: null,
    quoteActivity: {
      syncStatus: "quote_missing",
      lastQuoteUpdatedAt: null,
      currentQuoteStatus: null,
      originalQuoteStatus: null,
      divergedFromReviewSnapshot: false,
      divergenceReasons: [],
      lastSyncEventAt: null,
    },
    matchedCustomer: null,
    matchedContact: null,
  };
}

function listResponse(rows: any[]) {
  return {
    success: true,
    data: rows,
    summary: {
      needsReview: rows.filter((row) => row.status === "needs_review").length,
      waitingOnCustomer: 0,
      readyReviewed: 0,
      convertedSubmitted: 0,
      rejectedTerminal: 0,
      withWarnings: 0,
    },
    pagination: { limit: 50, offset: 0 },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForText(text: string) {
  for (let index = 0; index < 20; index += 1) {
    await flush();
    if (container.textContent?.includes(text)) return;
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <InboundOrdersPage />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  apiFetchMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("InboundOrdersPage", () => {
  test("renders a clean empty state", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(listResponse([])));

    renderPage();
    await waitForText("No inbound records");

    expect(container.textContent).toContain("No inbound records");
    expect(container.textContent).toContain("Draft builder will appear after parsing.");
  });

  test("creates manual intake, refreshes the queue, selects it, and renders source evidence", async () => {
    const created = record();
    let listCalls = 0;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? listResponse([]) : listResponse([created]));
      }
      if (path === "/api/inbound-orders/manual" && options?.method === "POST") {
        return jsonResponse({ success: true, data: { record: created, event: detail(created).events[0] } }, true, 201);
      }
      if (path === "/api/inbound-orders/inbound_1") {
        return jsonResponse({ success: true, data: detail(created) });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await flush();

    const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add"));
    expect(addButton).toBeTruthy();
    act(() => {
      Simulate.click(addButton!);
    });

    const dialog = container.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("Manual Intake");

    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const inputs = Array.from(form!.querySelectorAll("input"));
    const textareas = Array.from(form!.querySelectorAll("textarea"));

    act(() => {
      Simulate.change(inputs[0], { target: { value: "PO-123" } } as any);
      Simulate.change(inputs[1], { target: { value: "ada@example.com" } } as any);
      Simulate.change(inputs[2], { target: { value: "Ada Lovelace" } } as any);
      Simulate.change(inputs[3], { target: { value: "Need banners" } } as any);
      Simulate.change(textareas[0], { target: { value: "Please make two banners." } } as any);
      Simulate.change(textareas[1], { target: { value: "Counter intake" } } as any);
    });

    await act(async () => {
      Simulate.submit(form!);
    });
    await waitForText("Please make two banners.");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/inbound-orders/manual",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reference: "PO-123",
          senderName: "Ada Lovelace",
          senderEmail: "ada@example.com",
          subject: "Need banners",
          bodyText: "Please make two banners.",
          notes: "Counter intake",
        }),
      }),
    );
    expect(container.textContent).toContain("PO-123");
    expect(container.textContent).toContain("Ada Lovelace / ada@example.com");
    expect(container.textContent).toContain("Please make two banners.");
    expect(container.textContent).toContain("Draft builder will appear after parsing.");
  });
});
