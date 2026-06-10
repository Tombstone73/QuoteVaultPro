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

function detail(row = record(), overrides: Record<string, any> = {}) {
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
    ...overrides,
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
        reason: "description matched \"banner\"; category matched \"signage\"",
        metadata: {
          matchReasons: [
            "description matched \"banner\"",
            "category matched \"signage\"",
          ],
          matchBreakdown: {
            nameScore: 70,
            descriptionScore: 92,
            categoryScore: 76,
            materialScore: 64,
            metadataScore: 0,
            combinedConfidence: 78,
          },
        },
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
    evidence: {
      items: [],
      conflicts: [],
    },
    ...overrides,
  };
}

function reviewDraft(parsed = parsedDraft(), overrides: Record<string, any> = {}) {
  const reviewedLineItemsJson = parsed.lineItems.map((lineItem: any, index: number) => ({
    sourceLineItemIndex: index,
    sourceText: lineItem.sourceText ?? null,
    productName: lineItem.productName ?? null,
    selectedProductId: lineItem.candidateProductIds?.[0] ?? lineItem.productCandidates?.[0]?.id ?? null,
    productUnresolved: false,
    quantity: lineItem.quantity ?? null,
    width: lineItem.width ?? null,
    height: lineItem.height ?? null,
    dimensionsUnit: lineItem.dimensionsUnit ?? null,
    materialText: lineItem.materialText ?? null,
    printSpecs: lineItem.printSpecs ?? [],
    optionTexts: lineItem.optionTexts ?? [],
    finishingTexts: lineItem.finishingTexts ?? [],
    notes: null,
  }));

  return {
    id: "review_snapshot_1",
    snapshotId: "review_snapshot_1",
    inboundOrderRecordId: "inbound_1",
    organizationId: "org_1",
    sourceParseAttemptId: "attempt_1",
    sourceParseAttemptCreatedAt: "2026-06-09T12:01:00.000Z",
    status: "draft",
    reviewedCustomerJson: {
      sourceName: parsed.customer.sourceName ?? null,
      sourceEmail: parsed.customer.sourceEmail ?? null,
      companyName: parsed.customer.companyName ?? null,
      selectedCustomerId: parsed.customer.candidateCustomerIds?.[0] ?? null,
      selectedContactId: parsed.customer.candidateContactIds?.[0] ?? null,
      unresolvedCustomer: false,
      notes: null,
    },
    reviewedOrderJson: {
      poNumber: parsed.order.poNumber ?? null,
      dueDate: parsed.order.requestedDueDate ?? null,
      shipMethod: parsed.order.requestedShipMethod ?? null,
      fulfillmentType: parsed.order.requestedPickup ? "pickup" : "unknown",
      internalNotes: null,
      customerNotes: parsed.order.notes ?? null,
    },
    reviewedLineItemsJson,
    reviewedArtworkJson: {
      status: parsed.artwork.length > 0 ? "supplied" : "missing",
      refs: parsed.artwork.map((artwork: any) => ({
        filename: artwork.filename ?? null,
        sourceReference: artwork.sourceReference ?? null,
        likelyLineItemIndex: artwork.likelyLineItemIndex ?? null,
        purpose: artwork.purpose ?? null,
      })),
      notes: null,
    },
    missingDecisionsJson: parsed.missingDecisions.map((decision: any) => ({
      field: decision.field,
      label: decision.label,
      reason: decision.reason,
      severity: decision.severity,
      status: "still_blocking",
      resolutionNote: null,
    })),
    warningsJson: parsed.globalWarnings.map((warning: any) => ({
      code: warning.code,
      message: warning.message,
      severity: warning.severity,
      fieldPath: warning.fieldPath ?? null,
      acknowledged: false,
    })),
    reviewNotes: null,
    validationErrors: [],
    hasNewerParse: false,
    createdAt: "2026-06-09T12:02:00.000Z",
    updatedAt: "2026-06-09T12:02:00.000Z",
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

async function waitForCondition(predicate: () => boolean, label: string) {
  for (let index = 0; index < 20; index += 1) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(`Timed out waiting for: ${label}`);
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

function labeledControl(labelText: string, selector: string) {
  const label = Array.from(container.querySelectorAll("label")).find((element) => (
    element.textContent?.includes(labelText)
  ));
  const control = label?.querySelector(selector);
  if (!control) throw new Error(`Missing ${selector} for label: ${labelText}`);
  return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1366,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  apiFetchMock.mockReset();
  window.localStorage.clear();
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
    window.localStorage.setItem("titanos.inboundOrders.evidenceWidth", "900");
    window.localStorage.setItem("titanos.inboundOrders.draftWidth", "900");
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
    const workspace = container.querySelector("[data-testid='inbound-review-workspace']") as HTMLElement;
    const queuePanel = container.querySelector("[data-testid='inbound-queue-panel']") as HTMLElement;
    expect(workspace).toBeTruthy();
    expect(queuePanel).toBeTruthy();
    await waitForCondition(() => {
      const evidence = Number.parseInt(workspace.style.getPropertyValue("--workspace-evidence-width"), 10);
      const draftWidthValue = Number.parseInt(workspace.style.getPropertyValue("--workspace-draft-width"), 10);
      return evidence >= 340 && draftWidthValue >= 380 && evidence + draftWidthValue <= 1006;
    }, "initial layout widths clamped");
    const initialEvidenceWidth = workspace.style.getPropertyValue("--workspace-evidence-width");
    const initialDraftWidth = workspace.style.getPropertyValue("--workspace-draft-width");
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("360px");
    expect(queuePanel.style.width).toBe("360px");
    expect(queuePanel.style.minWidth).toBe("360px");
    expect(queuePanel.style.maxWidth).toBe("360px");
    expect(queuePanel.style.flex).toBe("0 0 360px");

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
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("360px");
    expect(queuePanel.style.width).toBe("360px");
    expect(queuePanel.style.flex).toBe("0 0 360px");
    expect(workspace.style.getPropertyValue("--workspace-evidence-width")).toBe(initialEvidenceWidth);
    expect(workspace.style.getPropertyValue("--workspace-draft-width")).toBe(initialDraftWidth);
    expect(window.localStorage.getItem("titanos.inboundOrders.evidenceWidth")).toBe(String(Number.parseInt(initialEvidenceWidth, 10)));
    expect(window.localStorage.getItem("titanos.inboundOrders.draftWidth")).toBe(String(Number.parseInt(initialDraftWidth, 10)));
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
      button.textContent?.includes("Order creation starts in Phase 4.")
    ));
    expect(createDraftButton).toBeTruthy();
    expect(createDraftButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Phase 3: editable review starts after a successful parse.");
  });

  test("keeps long inbound queue card content inside the 360px panel", async () => {
    const longReference = "PO-THIS-IS-A-VERY-LONG-REFERENCE-WITH-MANY-SEGMENTS-1234567890";
    const longSender = "A Very Long Sender Name For Queue Width Regression";
    const longEmail = "very.long.sender.email.address.for.queue.width.regression@example-very-long-domain.test";
    const longWarning = "Manual TEMP_INBOUND record needs staff review with a long explanation that should wrap inside the queue card instead of clipping past the right edge.";
    const row = record({
      externalReference: longReference,
      reviewRequiredReason: longWarning,
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: longReference,
        sender: { name: longSender, email: longEmail },
        subject: "Long queue card regression",
        bodyText: "Please make queue cards readable.",
        notes: "Counter intake",
      },
    });

    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Parse with AI");

    const queuePanel = container.querySelector("[data-testid='inbound-queue-panel']") as HTMLElement;
    expect(queuePanel).toBeTruthy();
    expect(queuePanel.style.width).toBe("360px");
    expect(queuePanel.style.flex).toBe("0 0 360px");

    expect(queuePanel.querySelector("[data-radix-scroll-area-viewport]")).toBeNull();
    const queueScrollArea = Array.from(queuePanel.querySelectorAll("div")).find((element) => (
      element.className.includes("overflow-y-auto") && element.className.includes("overflow-x-hidden")
    ));
    expect(queueScrollArea).toBeTruthy();
    expect(queueScrollArea?.className).toContain("min-w-0");
    expect(queueScrollArea?.className).toContain("max-w-full");

    const searchInput = queuePanel.querySelector("input[placeholder='Search reference, sender, notes, subject, body']") as HTMLInputElement;
    expect(searchInput.className).toContain("max-w-full");

    const queueCard = Array.from(queuePanel.querySelectorAll("button")).find((button) => (
      button.textContent?.includes(longReference)
    )) as HTMLButtonElement;
    expect(queueCard).toBeTruthy();
    expect(queueCard.className).toContain("w-full");
    expect(queueCard.className).toContain("max-w-full");
    expect(queueCard.className).toContain("box-border");
    expect(queueCard.className).toContain("overflow-x-hidden");

    const title = Array.from(queueCard.querySelectorAll("div")).find((element) => (
      element.textContent === longReference
    )) as HTMLDivElement;
    expect(title).toBeTruthy();
    expect(title.className).toContain("truncate");

    const sender = Array.from(queueCard.querySelectorAll("div")).find((element) => (
      element.textContent === `${longSender} / ${longEmail}`
    )) as HTMLDivElement;
    expect(sender).toBeTruthy();
    expect(sender.className).toContain("truncate");

    const metadataGrid = Array.from(queueCard.querySelectorAll("div")).find((element) => (
      element.className.includes("grid-cols-2") && element.textContent?.includes("Reference")
    )) as HTMLDivElement;
    expect(metadataGrid).toBeTruthy();
    expect(metadataGrid.className).toContain("max-w-full");
    expect(metadataGrid.className).not.toContain("grid-cols-3");

    const warningText = Array.from(queueCard.querySelectorAll("span")).find((element) => (
      element.textContent === longWarning
    )) as HTMLSpanElement;
    expect(warningText).toBeTruthy();
    expect(warningText.className).toContain("flex-1");
    expect(warningText.className).toContain("whitespace-normal");
    expect(warningText.className).toContain("break-words");
    expect(queueCard.textContent).toContain("Needs Review");
  });

  test("uses a full-width flex workspace and supports queue collapse plus resizing", async () => {
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

    const workspace = container.querySelector("[data-testid='inbound-review-workspace']") as HTMLElement;
    const queuePanel = container.querySelector("[data-testid='inbound-queue-panel']") as HTMLElement;
    expect(workspace).toBeTruthy();
    expect(workspace.className).toContain("w-full");
    expect(workspace.className).toContain("max-w-none");
    expect(workspace.className).toContain("flex");
    expect(workspace.className).toContain("overflow-hidden");
    expect(workspace.style.gridTemplateColumns).toBe("");
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("360px");
    expect(queuePanel.style.width).toBe("360px");
    expect(queuePanel.style.flex).toBe("0 0 360px");
    expect(queuePanel.className).toContain("min-[1180px]:w-[var(--workspace-queue-width)]");

    const draftPanel = container.querySelector("[data-testid='inbound-draft-panel']") as HTMLElement;
    expect(draftPanel).toBeTruthy();
    expect(draftPanel.className).toContain("overflow-hidden");
    expect(container.textContent).toContain("Draft Builder");

    const collapseButton = container.querySelector("[aria-label='Collapse inbound queue']") as HTMLButtonElement;
    expect(collapseButton).toBeTruthy();
    act(() => {
      Simulate.click(collapseButton);
    });
    await waitForCondition(() => window.localStorage.getItem("titanos.inboundOrders.queueCollapsed") === "true", "queue collapsed persistence");
    expect(container.querySelector("[aria-label='Collapsed inbound queue']")).toBeTruthy();
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("56px");
    expect(queuePanel.style.width).toBe("56px");
    expect(queuePanel.style.flex).toBe("0 0 56px");

    const expandButton = container.querySelector("[aria-label='Expand inbound queue']") as HTMLButtonElement;
    act(() => {
      Simulate.click(expandButton);
    });
    await waitForCondition(() => window.localStorage.getItem("titanos.inboundOrders.queueCollapsed") === "false", "queue expanded persistence");

    const evidencePanel = container.querySelector("[data-testid='inbound-evidence-panel']") as HTMLElement;
    const evidenceHandle = container.querySelector("[aria-label='Resize evidence panel']") as HTMLButtonElement;
    const startingEvidenceWidth = Number.parseInt(workspace.style.getPropertyValue("--workspace-evidence-width"), 10);
    expect(startingEvidenceWidth).toBeGreaterThanOrEqual(420);
    expect(evidencePanel.className).toContain("min-w-0");
    expect(evidencePanel.className).toContain("flex-col");
    act(() => {
      Simulate.mouseDown(evidenceHandle, { clientX: 500 } as any);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 560, bubbles: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await waitForCondition(() => (
      workspace.style.getPropertyValue("--workspace-evidence-width") === `${startingEvidenceWidth + 60}px`
    ), "evidence width resize");
    expect(window.localStorage.getItem("titanos.inboundOrders.evidenceWidth")).toBe(String(startingEvidenceWidth + 60));

    const restoreButton = container.querySelector("[aria-label='Restore inbound workspace layout']") as HTMLButtonElement;
    act(() => {
      Simulate.click(restoreButton);
    });
    await waitForCondition(() => (
      window.localStorage.getItem("titanos.inboundOrders.evidenceWidth") === "440"
        && window.localStorage.getItem("titanos.inboundOrders.draftWidth") === "520"
        && workspace.style.getPropertyValue("--workspace-queue-width") === "360px"
    ), "layout restore persistence");
  });

  test("clamps oversized saved widths and keeps draft actions visible", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });
    window.localStorage.setItem("titanos.inboundOrders.evidenceWidth", "900");
    window.localStorage.setItem("titanos.inboundOrders.draftWidth", "900");

    const row = record();
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: attempt }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft) });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Save Review Draft");

    const workspace = container.querySelector("[data-testid='inbound-review-workspace']") as HTMLElement;
    const evidencePanel = container.querySelector("[data-testid='inbound-evidence-panel']") as HTMLElement;
    const draftPanel = container.querySelector("[data-testid='inbound-draft-panel']") as HTMLElement;
    await waitForCondition(() => {
      const evidence = Number.parseInt(workspace.style.getPropertyValue("--workspace-evidence-width"), 10);
      const draftWidthValue = Number.parseInt(workspace.style.getPropertyValue("--workspace-draft-width"), 10);
      return evidence >= 340 && draftWidthValue >= 380 && evidence + draftWidthValue <= 1000;
    }, "oversized saved widths reconciled");

    expect(workspace.className).toContain("flex");
    expect(evidencePanel.className).toContain("overflow-hidden");
    expect(draftPanel.className).toContain("min-w-0");
    const actionFooter = Array.from(container.querySelectorAll("section")).find((section) => (
      section.className.includes("sticky") && section.textContent?.includes("Save Review Draft")
    ));
    expect(actionFooter).toBeTruthy();
    expect(container.textContent).toContain("Mark Ready to Convert");
    const phaseFourButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Order creation starts in Phase 4.")
    ));
    expect(phaseFourButton).toBeTruthy();
    expect(phaseFourButton?.disabled).toBe(true);
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
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(previousDraft) });
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
    const attachmentFile = {
      id: "file_1",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: "file_record_1",
      sourceFilename: "Brainstorm Print PO.pdf",
      role: "customer_upload",
      mimeType: "application/pdf",
      sizeBytes: 12000,
      checksum: null,
      status: "uploaded",
      reviewNotes: null,
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z",
    };
    const draft = parsedDraft({
      order: {
        ...parsedDraft().order,
        poNumber: "151661",
        requestedDueDate: "2026-06-11",
      },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "3 PVC Signs 24x36 3mm White PVC",
        productName: "PVC Signs",
        candidateProductIds: ["product_pvc", "product_acm"],
        productCandidates: [
          {
            id: "product_pvc",
            label: "PVC",
            confidence: 94,
            reason: "material matched \"3mm white pvc\"; category matched \"rigid signs\"",
            metadata: {
              matchReasons: [
                "material matched \"3mm white pvc\"",
                "description matched \"pvc signs\"",
              ],
              matchBreakdown: {
                nameScore: 72,
                keywordScore: 72,
                descriptionScore: 92,
                categoryScore: 76,
                materialScore: 100,
                metadataScore: 0,
                accessoryPenalty: 0,
                combinedConfidence: 94,
              },
            },
          },
          {
            id: "product_acm",
            label: "ACM / Dibond / Max Metal",
            confidence: 68,
            reason: "description matched \"pvc signs\"",
            metadata: {
              matchReasons: [
                "description matched \"pvc signs\"",
              ],
              matchBreakdown: {
                nameScore: 0,
                keywordScore: 0,
                descriptionScore: 92,
                categoryScore: 76,
                materialScore: 0,
                metadataScore: 0,
                accessoryPenalty: 0,
                combinedConfidence: 68,
              },
            },
          },
        ],
        quantity: 3,
        width: 24,
        height: 36,
        materialText: "3mm White PVC",
        optionTexts: [],
        artworkRefs: [],
      }],
      artwork: [],
      globalWarnings: [],
      missingDecisions: [{
        field: "lineItems.0.artwork",
        label: "Is artwork supplied for this item?",
        reason: "No artwork file or artwork reference was detected in the source evidence.",
        severity: "warning",
      }],
      evidence: {
        items: [{
          type: "PDF_ATTACHMENT",
          label: "Brainstorm Print PO.pdf",
          sourceId: "file_1",
          fileName: "Brainstorm Print PO.pdf",
          mimeType: "application/pdf",
          rawText: "Purchase Order 151661\nArrival Due Date MUST EOD 6/11\n3 PVC Signs\n24x36\n3mm White PVC",
          pageCount: 1,
          documentType: "purchase_order",
          documentConfidence: 98,
          extractionStatus: "successful",
          poSummary: {
            poNumber: "151661",
            dueDate: "2026-06-11",
            quantity: 3,
            productDescription: "PVC Signs",
            material: "3mm White PVC",
            dimensions: "24x36",
            printSpecs: [],
            dateCandidates: [{
              parsedDate: "2026-06-11",
              sourceText: "Arrival Due Date; MUST EOD 6/11",
              classification: "DUE_DATE",
              confidence: 98,
            }],
            fieldSources: {
              poNumber: {
                value: "151661",
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "Purchase Order 151661",
                confidence: 98,
              },
              dueDate: {
                value: "2026-06-11",
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "Arrival Due Date; MUST EOD 6/11",
                confidence: 98,
              },
              quantity: {
                value: 3,
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "3 PVC Signs",
                confidence: 100,
              },
              material: {
                value: "3mm White PVC",
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "3mm White PVC",
                confidence: 92,
              },
              dimensions: {
                value: "24x36",
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "24x36",
                confidence: 95,
              },
              productDescription: {
                value: "PVC Signs",
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "3 PVC Signs",
                confidence: 90,
              },
            },
          },
          warnings: [],
        }],
        conflicts: [{
          code: "evidence_quantity_conflict",
          message: "Quantity mismatch between email (50) and purchase order (3).",
          severity: "warning",
          fieldPath: "lineItems.0.quantity",
        }],
      },
    });
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row, { files: [attachmentFile] }) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft) });
      }
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

    await waitForText("Phase 3: editable review only.");
    expect(container.textContent).toContain("Brainstorm Print PO.pdf");
    expect(container.textContent).toContain("Purchase Order");
    expect(container.textContent).toContain("98%");
    expect(container.textContent).toContain("Pages: 1");
    expect(container.textContent).toContain("Extraction: Successful");
    expect(container.textContent).toContain("PO Extraction Summary");
    expect(container.textContent).toContain("Field Sources");
    expect(container.textContent).not.toContain("No field source details available.");
    expect(container.textContent).toContain("Value: 2026-06-11");
    expect(container.textContent).toContain("Source: PDF Attachment");
    expect(container.textContent).toContain("Document: Purchase Order 151661");
    expect(container.textContent).toContain("Source Text: Arrival Due Date; MUST EOD 6/11");
    expect(container.textContent).toContain("Confidence: 98%");
    expect(container.textContent).toContain("151661");
    expect(container.textContent).toContain("3mm White PVC");
    expect(container.textContent).toContain("24x36");
    expect(container.textContent).toContain("Quantity mismatch between email (50) and purchase order (3).");
    expect(container.textContent).toContain("Ada Signs");
    expect(container.textContent).toContain("PVC Signs");
    expect(container.textContent).toContain("Product Match Reasoning");
    expect(container.textContent).toContain("material matched \"3mm white pvc\"");
    expect(container.textContent).toContain("Final Score 94");
    expect(container.textContent).toContain("Material Score 100");
    expect(container.textContent).toContain("Category Score 76");
    expect(container.textContent).toContain("Description Score 92");
    expect(container.textContent).toContain("Keyword Score 72");
    expect((container.textContent ?? "").indexOf("PVC")).toBeLessThan((container.textContent ?? "").indexOf("ACM / Dibond / Max Metal"));
    expect(container.textContent).toContain("2026-06-11");
    expect(container.textContent).toContain("Is artwork supplied for this item?");
    expect(container.textContent).not.toContain("Installation needed");
    expect(container.textContent).not.toContain("Confirm final banner size before conversion.");
    expect(container.textContent).toContain("82% confidence");
    expect(container.textContent).toContain("Order creation starts in Phase 4.");
    expect(labeledControl("Due date", "input")).toHaveProperty("value", "2026-06-11");
    expect(labeledControl("Quantity", "input")).toHaveProperty("value", "3");
    expect(labeledControl("Material", "input")).toHaveProperty("value", "3mm White PVC");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Order creation starts in Phase 4.")
    ));
    expect(createDraftButton?.disabled).toBe(true);
  });

  test("edits and saves review draft fields without enabling order creation", async () => {
    const row = record();
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });
    let savedBody: any = null;
    let markReadyCalled = false;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: attempt }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return jsonResponse({
          success: true,
          data: reviewDraft(draft, {
            ...savedBody,
            updatedAt: "2026-06-09T12:03:00.000Z",
            hasNewerParse: false,
          }),
        });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft, { hasNewerParse: true }) });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft/mark-ready" && options?.method === "POST") {
        markReadyCalled = true;
        return jsonResponse({
          message: "Review draft is not ready to convert.",
          errors: ["Artwork missing must be acknowledged before ready."],
        }, false, 400);
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Newer parse available.");
    expect(container.textContent).toContain("Existing staff edits are preserved.");
    expect(container.textContent).toContain("Save Review Draft");
    expect(container.textContent).toContain("Mark Ready to Convert");

    const artworkStatus = labeledControl("Artwork status", "select") as HTMLSelectElement;
    act(() => {
      Simulate.change(artworkStatus, { target: { value: "to_follow" } } as any);
    });
    const decisionStatus = Array.from(container.querySelectorAll("select")).find((select) => (
      (select as HTMLSelectElement).value === "still_blocking"
    )) as HTMLSelectElement;
    expect(decisionStatus).toBeTruthy();
    act(() => {
      Simulate.change(decisionStatus, { target: { value: "acknowledged" } } as any);
    });
    act(() => {
      Simulate.change(labeledControl("Review notes", "textarea"), { target: { value: "Reviewed by staff." } } as any);
    });

    await waitForText("Unsaved changes");
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Save Review Draft")
    ));
    expect(saveButton?.disabled).toBe(false);
    await act(async () => {
      Simulate.click(saveButton!);
    });
    await waitForCondition(() => Boolean(savedBody), "review draft PUT body");

    expect(savedBody.reviewedArtworkJson.status).toBe("to_follow");
    expect(savedBody.missingDecisionsJson[0].status).toBe("acknowledged");
    expect(savedBody.reviewNotes).toBe("Reviewed by staff.");

    const markReadyButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Mark Ready to Convert")
    ));
    await act(async () => {
      Simulate.click(markReadyButton!);
    });
    await waitForText("Artwork missing must be acknowledged before ready.");
    expect(markReadyCalled).toBe(true);

    const orderCreationButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Order creation starts in Phase 4.")
    ));
    expect(orderCreationButton?.disabled).toBe(true);
  });
});
