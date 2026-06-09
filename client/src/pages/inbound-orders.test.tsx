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

function draftPreview(overrides: Record<string, any> = {}) {
  return {
    success: true,
    data: {
      draft: null,
      latestAttempt: null,
      ...overrides,
    },
  };
}

function parsedDraft(overrides: Record<string, any> = {}) {
  return {
    customer: {
      sourceName: "Ada Lovelace",
      sourceEmail: "ada@example.com",
      sourcePhone: null,
      companyName: "Ada Signs",
      candidateCustomerIds: ["customer_1"],
      candidateContactIds: ["contact_1"],
      customerCandidates: [{
        id: "customer_1",
        label: "Ada Signs",
        confidence: 88,
        reason: "Email domain and company name matched",
        metadata: {},
      }],
      contactCandidates: [{
        id: "contact_1",
        label: "Ada Lovelace",
        confidence: 91,
        reason: "Sender email matched",
        metadata: {},
      }],
      confidence: 86,
      warnings: [],
    },
    order: {
      requestedDueDate: "2026-06-20",
      requestedShipMethod: "Pickup",
      requestedPickup: true,
      poNumber: "PO-123",
      notes: "Please make two banners.",
      confidence: 84,
      warnings: [],
    },
    lineItems: [{
      sourceText: "two banners",
      productName: "Banner",
      candidateProductIds: ["product_1"],
      productCandidates: [{
        id: "product_1",
        label: "Vinyl Banner",
        confidence: 78,
        reason: "Product name matched",
        metadata: {},
      }],
      quantity: 2,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      materialText: "vinyl",
      optionTexts: ["grommets"],
      finishingTexts: [],
      artworkRefs: ["logo.pdf"],
      confidence: 82,
      warnings: [],
    }],
    artwork: [{
      filename: "logo.pdf",
      sourceReference: "logo attached",
      likelyLineItemIndex: 0,
      purpose: "artwork",
      confidence: 72,
      warnings: [],
    }],
    globalWarnings: [{
      code: "confirm_size",
      message: "Confirm final banner size before conversion.",
      severity: "warning",
      fieldPath: "lineItems.0",
    }],
    missingDecisions: [{
      field: "installation",
      label: "Installation needed",
      reason: "Request did not mention installation.",
      severity: "warning",
    }],
    ...overrides,
  };
}

function parseAttempt(overrides: Record<string, any> = {}) {
  return {
    id: "attempt_1",
    organizationId: "org_1",
    inboundOrderRecordId: "inbound_1",
    status: "success",
    provider: "test",
    model: "test-model",
    rawPromptHash: "hash",
    rawResponse: {},
    repairedResponse: null,
    parsedDraft: null,
    confidence: 82,
    warnings: [],
    errors: [],
    createdAt: "2026-06-09T12:01:00.000Z",
    ...overrides,
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
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview());
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

  test("renders parse action and disabled draft order control for a selected record", async () => {
    const row = record();
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Parse with AI");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Draft Order")
    ));
    expect(createDraftButton).toBeTruthy();
    expect(createDraftButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Phase 2: parsing only. Order creation is disabled.");
  });

  test("shows parse loading and error states", async () => {
    const row = record();
    let rejectParse: ((error: Error) => void) | null = null;
    let parseRequestCount = 0;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      if (path === "/api/inbound-orders/inbound_1/parse" && options?.method === "POST") {
        parseRequestCount += 1;
        return await new Promise((_, reject) => {
          rejectParse = reject;
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Parse with AI");

    const parseButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Parse with AI")
    ));
    expect(parseButton).toBeTruthy();

    act(() => {
      Simulate.click(parseButton!);
    });
    await waitForText("Parsing...");
    await waitForText("Parsing source evidence...");
    expect(parseButton?.disabled).toBe(true);

    act(() => {
      Simulate.click(parseButton!);
    });
    await flush();
    expect(parseRequestCount).toBe(1);

    await act(async () => {
      rejectParse?.(new Error("AI provider is not configured."));
    });
    await waitForText("AI provider is not configured.");

    expect(container.textContent).toContain("Parse unavailable");
    const retryButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Parse with AI")
    ));
    expect(retryButton?.disabled).toBe(false);
  });

  test("keeps the previous parsed preview visible while a re-parse is running", async () => {
    const row = record();
    const previousDraft = parsedDraft({
      customer: {
        ...parsedDraft().customer,
        companyName: "Previous Signs",
        customerCandidates: [{
          id: "customer_previous",
          label: "Previous Signs",
          confidence: 74,
          reason: "Previous parse candidate",
          metadata: {},
        }],
      },
      globalWarnings: [],
      missingDecisions: [],
    });
    const nextDraft = parsedDraft({
      customer: {
        ...parsedDraft().customer,
        companyName: "Updated Signs",
        customerCandidates: [{
          id: "customer_next",
          label: "Updated Signs",
          confidence: 93,
          reason: "New parse candidate",
          metadata: {},
        }],
      },
    });
    const previousAttempt = parseAttempt({ parsedDraft: previousDraft, confidence: 74, warnings: [] });
    const nextAttempt = parseAttempt({ id: "attempt_2", parsedDraft: nextDraft, confidence: 93, warnings: nextDraft.globalWarnings });
    let resolveParse: ((response: any) => void) | null = null;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft: previousDraft, latestAttempt: previousAttempt }));
      }
      if (path === "/api/inbound-orders/inbound_1/parse" && options?.method === "POST") {
        return await new Promise((resolve) => {
          resolveParse = resolve;
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Previous Signs");

    const parseButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Parse with AI")
    ));
    act(() => {
      Simulate.click(parseButton!);
    });

    await waitForText("Parsing source evidence...");
    expect(container.textContent).toContain("Previous Signs");
    expect(container.textContent).not.toContain("Updated Signs");

    await act(async () => {
      resolveParse?.(jsonResponse({
        success: true,
        data: {
          draft: nextDraft,
          latestAttempt: nextAttempt,
          record: { ...row, status: "needs_review", parsedAt: "2026-06-09T12:03:00.000Z" },
        },
      }));
    });

    await waitForText("Updated Signs");
    expect(container.textContent).toContain("93% confidence");
  });

  test("refreshes draft preview after parse and renders reviewable parsed data", async () => {
    const row = record();
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      if (path === "/api/inbound-orders/inbound_1/parse" && options?.method === "POST") {
        return jsonResponse({
          success: true,
          data: {
            draft,
            latestAttempt: attempt,
            record: { ...row, status: "needs_review", parsedAt: "2026-06-09T12:01:00.000Z" },
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Parse with AI");

    const parseButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Parse with AI")
    ));
    await act(async () => {
      Simulate.click(parseButton!);
    });

    await waitForText("Customer Match Candidates");
    expect(container.textContent).toContain("Ada Signs");
    expect(container.textContent).toContain("Vinyl Banner");
    expect(container.textContent).toContain("Confirm final banner size before conversion.");
    expect(container.textContent).toContain("82% confidence");
    expect(container.textContent).toContain("Phase 2: parsing only. Order creation is disabled.");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Draft Order")
    ));
    expect(createDraftButton?.disabled).toBe(true);
  });
});
