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

const mockToast = jest.fn();

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
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
    selectedProductSource: lineItem.candidateProductIds?.[0] ?? lineItem.productCandidates?.[0]?.id ? "ai_inferred" : null,
    interpretedProductId: lineItem.interpretedProductId ?? lineItem.candidateProductIds?.[0] ?? lineItem.productCandidates?.[0]?.id ?? null,
    interpretedProductReason: lineItem.interpretedProductReason ?? lineItem.productCandidates?.[0]?.reason ?? null,
    interpretedProductConfidence: lineItem.interpretedProductConfidence ?? lineItem.productCandidates?.[0]?.confidence ?? null,
    productUnresolved: false,
    quantity: lineItem.quantity ?? null,
    quantitySource: lineItem.quantity ? "ai_inferred" : null,
    width: lineItem.width ?? null,
    height: lineItem.height ?? null,
    dimensionsUnit: lineItem.dimensionsUnit ?? null,
    dimensionsSource: lineItem.width || lineItem.height || lineItem.dimensionsUnit ? "ai_inferred" : null,
    materialText: lineItem.materialText ?? null,
    materialSource: lineItem.materialText ? "ai_inferred" : null,
    printSpecs: lineItem.printSpecs ?? [],
    printSpecsSource: (lineItem.printSpecs ?? []).length > 0 ? "ai_inferred" : null,
    optionTexts: lineItem.optionTexts ?? [],
    optionTextsSource: (lineItem.optionTexts ?? []).length > 0 ? "ai_inferred" : null,
    finishingTexts: lineItem.finishingTexts ?? [],
    finishingTextsSource: (lineItem.finishingTexts ?? []).length > 0 ? "ai_inferred" : null,
    optionSelectionsJson: lineItem.optionSelectionsJson ?? null,
    pbv2TreeVersionId: lineItem.pbv2TreeVersionId ?? null,
    pbv2OptionSuggestions: lineItem.pbv2OptionSuggestions ?? [],
    artworkLinks: lineItem.artworkLinks ?? [],
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
      selectedCustomerSource: parsed.customer.candidateCustomerIds?.[0] ? "interpreted_customer_match" : null,
      selectedCustomerReason: parsed.customer.candidateCustomerIds?.[0] ? "Matched by company name and sender domain." : null,
      selectedCustomerConfidence: parsed.customer.candidateCustomerIds?.[0] ? 92 : null,
      selectedContactId: parsed.customer.candidateContactIds?.[0] ?? null,
      selectedContactSource: parsed.customer.candidateContactIds?.[0] ? "interpreted_contact_match" : null,
      selectedContactReason: parsed.customer.candidateContactIds?.[0] ? "Matched by email." : null,
      selectedContactConfidence: parsed.customer.candidateContactIds?.[0] ? 100 : null,
      unresolvedCustomer: false,
      unresolvedContact: false,
      notes: null,
    },
    reviewedOrderJson: {
      intent: "unknown",
      poNumber: parsed.order.poNumber ?? null,
      dueDate: parsed.order.requestedDueDate ?? null,
      priority: "normal",
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
      unassignedAttachments: overrides.unassignedAttachments ?? [],
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
    unsupportedRequestsJson: (parsed as any).unsupportedRequests ?? overrides.unsupportedRequestsJson ?? [],
    customerIntelligenceJson: overrides.customerIntelligenceJson ?? (parsed as any).customerIntelligence ?? null,
    reviewNotes: null,
    validationErrors: [],
    readinessScore: {
      overall: 92,
      customer: 100,
      contact: 100,
      product: 95,
      options: 90,
      artwork: { score: 60, status: "missing", label: "Missing" },
    },
    interpretationConfidence: {
      overall: 92,
      product: 95,
      options: 90,
    },
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

function pbv2OptionsResponse(overrides: Record<string, any> = {}) {
  return {
    success: true,
    data: {
      productId: "product_1",
      productName: "Vinyl Banner",
      activeTreeVersionId: "tree_1",
      treeJson: {
        schemaVersion: 2,
        rootNodeIds: ["thickness", "sides"],
        nodes: {
          thickness: {
            id: "thickness",
            kind: "question",
            label: "Thickness",
            input: { type: "select", required: true, selectionKey: "thickness" },
            choices: [{ id: "3mm_white", value: "3mm_white", label: "3mm White PVC" }],
          },
          sides: {
            id: "sides",
            kind: "question",
            label: "Sides",
            input: { type: "select", required: true, selectionKey: "sides" },
            choices: [{ id: "single", value: "single", label: "Single Sided / 4/0" }],
          },
        },
      },
      requiredOptions: [
        { nodeId: "thickness", selectionKey: "thickness", label: "Thickness", inputType: "select" },
        { nodeId: "sides", selectionKey: "sides", label: "Sides", inputType: "select" },
      ],
      suggestedSelections: {
        schemaVersion: 2,
        selected: {
          thickness: { value: "3mm_white", note: "Source evidence", origin: "SOURCE_EVIDENCE", evidence: "3mm White PVC" },
        },
      },
      suggestions: [{
        selectionKey: "thickness",
        nodeId: "thickness",
        label: "Thickness",
        value: "3mm_white",
        choiceLabel: "3mm White PVC",
        source: "source_evidence",
        origin: "SOURCE_EVIDENCE",
        evidence: "3mm White PVC",
        conflictsWithDefault: false,
        defaultChoiceLabel: null,
        confidence: 80,
        reason: "Matched source evidence.",
      }],
      ...overrides,
    },
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

function setupParsedInboundReview({
  row = record(),
  parsed = parsedDraft(),
  review = reviewDraft(parsed),
  detailOverrides = {},
}: {
  row?: any;
  parsed?: any;
  review?: any;
  detailOverrides?: Record<string, any>;
} = {}) {
  const attempt = parseAttempt({ parsedDraft: parsed, confidence: 82, warnings: parsed.globalWarnings });
  let savedBody: any = null;
  apiFetchMock.mockImplementation(async (url: any, options?: any) => {
    const path = String(url);
    if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
    if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row, detailOverrides) });
    if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview({ draft: parsed, latestAttempt: attempt }));
    if (path === `/api/inbound-orders/${row.id}/review-draft` && options?.method === "PUT") {
      savedBody = JSON.parse(options.body);
      return jsonResponse({
        success: true,
        data: reviewDraft(parsed, {
          ...savedBody,
          updatedAt: "2026-06-09T12:04:00.000Z",
        }),
      });
    }
    if (path === `/api/inbound-orders/${row.id}/review-draft`) return jsonResponse({ success: true, data: review });
    if (path === "/api/inbound-orders/customer-search?limit=20") return jsonResponse({ success: true, data: [] });
    if (path === "/api/inbound-orders/product-search?limit=20") return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/api/inbound-orders/contact-search?")) return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/api/inbound-orders/product-options/") && options?.method === "POST") return jsonResponse(pbv2OptionsResponse());
    return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
  });
  return {
    getSavedBody: () => savedBody,
  };
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
  mockToast.mockReset();
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

  test("defaults to operational view, sanitizes HTML email, renders attachments, and preserves debug view", async () => {
    const row = record({
      sourceType: "email",
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "PO-123",
        sender: { name: "Shawn Fears", email: "shawn@brainstormprint.com" },
        to: ["orders@printer.test"],
        cc: [{ email: "csr@printer.test" }],
        subject: "PVC Signs PO",
        receivedAt: "2026-06-09T12:30:00.000Z",
        bodyText: "Plain fallback should not be primary when HTML exists.",
        bodyHtml: "<div><p>Hello <strong>CSR</strong></p><script>window.bad=true</script><img src=\"https://tracker.test/pixel.png\" onerror=\"bad()\"><a href=\"javascript:bad()\">bad link</a></div>",
      },
    });
    setupParsedInboundReview({
      row,
      detailOverrides: {
        files: [
          {
            id: "file_po",
            inboundRecordId: row.id,
            fileRecordId: "file_record_po",
            role: "po",
            status: "uploaded",
            sourceFilename: "Purchase Order 151661.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            providerAttachmentId: "att_po",
            reviewNotes: null,
          },
          {
            id: "file_art",
            inboundRecordId: row.id,
            fileRecordId: "file_record_art",
            role: "artwork",
            status: "uploaded",
            sourceFilename: "artwork.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            providerAttachmentId: "att_art",
            reviewNotes: null,
          },
          {
            id: "file_failed",
            inboundRecordId: row.id,
            fileRecordId: null,
            role: "email_attachment",
            status: "quarantined",
            sourceFilename: "Offset House Visual PO.pdf",
            mimeType: "application/pdf",
            sizeBytes: 4096,
            providerAttachmentId: "att_failed",
            reviewNotes: "Attachment download failed: Gmail attachment unavailable",
          },
        ],
      },
    });

    renderPage();
    await waitForText("Operational View");
    await waitForText("Operational Review");
    await waitForText("Original Email");
    await waitForText("Hello CSR");
    await waitForText("PO candidate");
    await waitForText("Artwork candidate");
    await waitForText("Offset House Visual PO.pdf");
    expect(container.textContent).toContain("Metadata only");
    expect(container.textContent).toContain("Status: Quarantined");
    expect(container.textContent).toContain("Attachment download failed: Gmail attachment unavailable");
    expect(container.textContent).toContain("orders@printer.test");
    expect(container.textContent).toContain("csr@printer.test");

    const emailPanel = container.querySelector("[data-testid='inbound-operational-email-panel']") as HTMLElement;
    expect(emailPanel).toBeTruthy();
    expect(emailPanel.innerHTML).not.toContain("<script");
    expect(emailPanel.innerHTML).not.toContain("onerror");
    expect(emailPanel.innerHTML).not.toContain("https://tracker.test");
    expect(emailPanel.querySelectorAll("a[href*='/api/inbound-orders/inbound_1/files/']").length).toBeGreaterThan(0);

    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Debug View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(debugButton);
    });
    await waitForText("Source Evidence");
    await waitForText("Draft Builder");
    expect(window.localStorage.getItem("titanos.inboundOrders.reviewMode")).toBe("debug");
  });

  test("falls back to plain text when original email HTML is missing", async () => {
    const row = record({
      sourceType: "email",
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "Text only request",
        bodyText: "Please quote 3 aluminum signs, 24x36.",
      },
    });
    setupParsedInboundReview({ row });

    renderPage();
    await waitForText("Original Email");
    await waitForText("Please quote 3 aluminum signs, 24x36.");
    expect(container.textContent).toContain("Text");
  });

  test("supports operational line item add, duplicate, remove, and product picker rendering", async () => {
    setupParsedInboundReview();

    renderPage();
    await waitForText("Operational Review");
    await waitForText("Add line item");
    expect(labeledControl("Product", "select")).toHaveProperty("value", "product_1");

    const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add line item")) as HTMLButtonElement;
    act(() => {
      Simulate.click(addButton);
    });
    await waitForText("Manual line item 2");

    const duplicateButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Duplicate")) as HTMLButtonElement;
    act(() => {
      Simulate.click(duplicateButton);
    });
    await waitForCondition(() => (
      Array.from(container.querySelectorAll("button")).filter((button) => button.textContent?.includes("Remove")).length >= 3
    ), "duplicated operational line item");

    const removeButtons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent?.includes("Remove"));
    act(() => {
      Simulate.click(removeButtons[removeButtons.length - 1]);
    });
    await waitForCondition(() => (
      Array.from(container.querySelectorAll("button")).filter((button) => button.textContent?.includes("Remove")).length === 2
    ), "duplicated line removed");
  });

  test("shows missing conversion reasons and disables conversion when minimum fields are absent", async () => {
    const parsed = parsedDraft({ lineItems: [], missingDecisions: [] });
    const review = reviewDraft(parsed, {
      reviewedCustomerJson: {
        ...reviewDraft(parsed).reviewedCustomerJson,
        selectedCustomerId: null,
        unresolvedCustomer: false,
      },
      reviewedLineItemsJson: [],
      validationErrors: ["Select a customer candidate or mark the customer unresolved."],
    });
    setupParsedInboundReview({ parsed, review });

    renderPage();
    await waitForText("Missing before conversion");
    await waitForText("Select a customer or mark customer unresolved.");
    await waitForText("Add at least one line item.");

    const orderButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Convert to Draft Order")) as HTMLButtonElement;
    const quoteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Convert to Draft Quote")) as HTMLButtonElement;
    expect(orderButton.disabled).toBe(true);
    expect(quoteButton.disabled).toBe(true);
  });

  test("staff edits survive operational/debug view toggles and save with draft payload", async () => {
    const { getSavedBody } = setupParsedInboundReview();

    renderPage();
    await waitForText("Operational Review");
    await waitForText("PO number");
    act(() => {
      Simulate.change(labeledControl("PO number", "input"), { target: { value: "PO-999" } } as any);
    });
    act(() => {
      Simulate.change(labeledControl("Quote / order intent", "select"), { target: { value: "order" } } as any);
    });

    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Debug View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(debugButton);
    });
    await waitForText("Draft Builder");
    const operationalButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Operational View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(operationalButton);
    });
    await waitForText("Operational Review");
    expect(labeledControl("PO number", "input")).toHaveProperty("value", "PO-999");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "operational review draft saved");
    expect(getSavedBody().reviewedOrderJson.poNumber).toBe("PO-999");
    expect(getSavedBody().reviewedOrderJson.intent).toBe("order");
  });

  test("shows disabled state and does not load the queue when inbound email intake is off", async () => {
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path === "/api/inbound-orders/email-settings") {
        return jsonResponse({
          success: true,
          data: {
            inboundEmailIntakeEnabled: false,
            inboundEmailPullPaused: false,
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Inbound intake is disabled");

    expect(container.textContent).toContain("Inbound email intake is disabled for this organization.");
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/inbound-orders\?/), expect.anything());
  });

  test("shows paused email pull state while keeping existing records usable", async () => {
    const row = record();
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path === "/api/inbound-orders/email-settings") {
        return jsonResponse({
          success: true,
          data: {
            inboundEmailIntakeEnabled: true,
            inboundEmailPullPaused: true,
          },
        });
      }
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Email Pull Paused");
    await waitForText("PO-123");

    const pausedButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Email Pull Paused")
    ));
    expect(pausedButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Existing inbound records remain available for review, parsing, and conversion.");
  });

  test("runs manual email pull and displays result summary", async () => {
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path === "/api/inbound-orders/email-settings") {
        return jsonResponse({
          success: true,
          data: {
            inboundEmailIntakeEnabled: true,
            inboundEmailPullPaused: false,
          },
        });
      }
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([]));
      if (path === "/api/inbound-orders/email/pull-latest" && options?.method === "POST") {
        return jsonResponse({
          success: true,
          data: {
            summary: { created: 1, skippedDuplicates: 2, ignored: 3, failed: 4 },
            createdRecordIds: ["inbound_new"],
            mailboxResults: [{
              mailboxId: "mailbox_1",
              mailboxName: "Orders Inbox",
              provider: "gmail",
              created: 1,
              skippedDuplicates: 2,
              ignored: 3,
              failed: 4,
              error: null,
            }],
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("No inbound records");
    const pullButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Pull Latest Emails")
    ));
    expect(pullButton?.disabled).toBe(false);

    await act(async () => {
      Simulate.click(pullButton!);
    });

    await waitForCondition(() => mockToast.mock.calls.some(([payload]) => (payload as { title?: string } | undefined)?.title === "Email pull complete"), "email pull toast");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Email pull complete",
      description: "1 created, 2 duplicate(s) skipped, 3 ignored, 4 failed.",
    }));
    expect(container.textContent).not.toContain("Latest email pull complete");
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
    await waitForText("Draft builder will appear after parsing.");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Draft Order")
    ));
    expect(createDraftButton).toBeTruthy();
    expect(createDraftButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Draft builder will appear after parsing.");
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

    const queueCard = Array.from(queuePanel.querySelectorAll("[role='button']")).find((row) => (
      row.textContent?.includes(longReference)
    )) as HTMLElement;
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
      button.textContent?.includes("Create Draft Order")
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
      if (path === "/api/inbound-orders/inbound_1/review-draft/refresh-from-latest-parse" && options?.method === "POST") {
        return jsonResponse({ success: true, data: reviewDraft(nextDraft, { id: "review_snapshot_2", snapshotId: "review_snapshot_2", sourceParseAttemptId: "attempt_2" }) });
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
    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Debug View")
    )) as HTMLButtonElement;
    act(() => {
      Simulate.click(debugButton);
    });
    await waitForText("Source Evidence");
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
      role: "po",
      mimeType: "application/pdf",
      sizeBytes: 12000,
      checksum: null,
      status: "available",
      providerAttachmentId: "att_1",
      providerMessageId: "gmail_msg_1",
      contentDisposition: "attachment",
      metadataJson: {
        provider: "gmail",
        poCandidate: true,
        artworkCandidate: true,
      },
      reviewNotes: "PO candidate. Text will be extracted during AI parse when possible.",
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
      customerIntelligence: {
        customer: { id: "customer_1", companyName: "Ada Signs", email: "billing@adasigns.test" },
        scopeMonths: 24,
        maxRecords: 50,
        recordCount: 3,
        generatedAt: "2026-06-09T12:00:00.000Z",
        recentProducts: [{ productId: "product_pvc", label: "PVC Signs", lastSeenAt: "2026-05-01T12:00:00.000Z" }],
        frequentProducts: [{ productId: "product_pvc", label: "PVC Signs", count: 3, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
        frequentMaterials: [{ label: "3mm White PVC", count: 3, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
        frequentDimensions: [{ label: "24x36", width: 24, height: 36, unit: "in", count: 3, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
        frequentFinishing: [{ label: "Contour Cutting: No", count: 2, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
        commonTerminology: [{ term: "pvc", count: 3 }],
        recentOrderReferences: [{ sourceType: "order", sourceId: "order_1", reference: "1001", createdAt: "2026-05-01T12:00:00.000Z", productSummary: "PVC Signs" }],
      },
    });
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });
    let refreshFromLatestParseCalled = false;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row, { files: [attachmentFile] }) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft) });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft/refresh-from-latest-parse" && options?.method === "POST") {
        refreshFromLatestParseCalled = true;
        return jsonResponse({
          success: true,
          data: reviewDraft(draft, {
            id: "review_snapshot_after_parse",
            snapshotId: "review_snapshot_after_parse",
            initializedFromParse: true,
          }),
        });
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

    await waitForText("Phase 4: Create draft order from reviewed inbound record.");
    await waitForCondition(() => refreshFromLatestParseCalled, "review draft refreshed after parse");
    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Debug View")
    )) as HTMLButtonElement;
    act(() => {
      Simulate.click(debugButton);
    });
    await waitForText("Source Evidence");
    expect(container.textContent).toContain("Review Readiness");
    expect(container.textContent).toContain("92% overall confidence");
    expect(container.textContent).toContain("Product Confidence 95%");
    expect(container.textContent).toContain("Option Confidence 90%");
    expect(container.textContent).toContain("Customer 100%");
    expect(container.textContent).toContain("Contact 100%");
    expect(container.textContent).toContain("Customer Intelligence");
    expect(container.textContent).toContain("Ada Signs history, last 24 months");
    expect(container.textContent).toContain("3 records");
    expect(container.textContent).toContain("Recent Products");
    expect(container.textContent).toContain("Frequent Products");
    expect(container.textContent).toContain("Frequent Materials");
    expect(container.textContent).toContain("Recent Orders");
    expect(container.textContent).toContain("1001");
    expect(container.textContent).toContain("Brainstorm Print PO.pdf");
    expect(container.textContent).toContain("PO candidate");
    expect(container.textContent).toContain("11.7 KB");
    expect(container.textContent).toContain("Source: Gmail attachment");
    expect(container.textContent).toContain("Status: Available");
    expect(container.textContent).toContain("Provider ID captured");
    const openAttachmentLink = container.querySelector("a[href='/api/inbound-orders/inbound_1/files/file_1/download']");
    expect(openAttachmentLink).toBeTruthy();
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
    expect(container.textContent).toContain("AI inferred customer");
    expect(container.textContent).toContain("Matched by company name and sender domain.");
    expect(container.textContent).toContain("Confidence 92%.");
    expect(container.textContent).toContain("AI inferred contact");
    expect(container.textContent).toContain("Matched by email.");
    expect(container.textContent).toContain("Confidence 100%.");
    expect(container.textContent).toContain("PVC Signs");
    expect(container.textContent).toContain("Primary Interpreted Product");
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
    expect(container.textContent).toContain("Create Draft Order");
    expect(labeledControl("Due date", "input")).toHaveProperty("value", "2026-06-11");
    expect(labeledControl("Quantity", "input")).toHaveProperty("value", "3");
    expect(labeledControl("Material", "input")).toHaveProperty("value", "3mm White PVC");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Draft Order")
    ));
    expect(createDraftButton?.disabled).toBe(true);
  });

  test("automatically applies the latest parse to stale editable review controls", async () => {
    const row = record();
    const staleDraft = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "old aluminum signs",
        productName: "ACM Signs",
        candidateProductIds: ["product_acm"],
        productCandidates: [{ id: "product_acm", label: "ACM", confidence: 78, reason: "Old parse", metadata: {} }],
        materialText: "6mm ACM",
        optionSelectionsJson: {
          schemaVersion: 2,
          selected: {
            thickness: { value: "6mm", note: "Staff selected", origin: "USER_SELECTED", evidence: null },
            sides: { value: "double", note: "Staff selected", origin: "USER_SELECTED", evidence: null },
          },
        },
      }],
    });
    const latestDraft = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "Please quote 3 signs, 24x36, printed single sided, 3mm white PVC.",
        productName: "PVC",
        candidateProductIds: ["product_pvc"],
        productCandidates: [{ id: "product_pvc", label: "PVC", confidence: 96, reason: "Matched 3mm white PVC", metadata: {} }],
        quantity: 3,
        materialText: "3mm white PVC",
        optionSelectionsJson: {
          schemaVersion: 2,
          selected: {
            thickness: { value: "3mm_white", note: "Default", origin: "DEFAULT", evidence: null },
            sides: { value: "single", note: "Deterministic print spec rule", origin: "SOURCE_EVIDENCE", evidence: "single sided" },
          },
        },
        pbv2TreeVersionId: "tree_pvc",
        pbv2OptionSuggestions: [
          {
            selectionKey: "sides",
            nodeId: "sides",
            label: "Sides",
            value: "single",
            choiceLabel: "Single Sided 4/0",
            source: "deterministic_print_spec_rule",
            origin: "SOURCE_EVIDENCE",
            evidence: "single sided",
            conflictsWithDefault: false,
            defaultChoiceLabel: null,
            confidence: 100,
            reason: "Mapped 4/0/single sided source text.",
          },
        ],
      }],
      missingDecisions: [],
      globalWarnings: [],
    });
    const latestAttempt = parseAttempt({ id: "attempt_2", parsedDraft: latestDraft, confidence: 96, warnings: [] });
    let refreshFromLatestParseCalled = false;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft: staleDraft, latestAttempt: parseAttempt({ parsedDraft: staleDraft }) }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(staleDraft) });
      }
      if (path === "/api/inbound-orders/inbound_1/parse" && options?.method === "POST") {
        return jsonResponse({
          success: true,
          data: {
            draft: latestDraft,
            latestAttempt,
            record: { ...row, status: "needs_review", parsedAt: "2026-06-09T12:05:00.000Z" },
          },
        });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft/refresh-from-latest-parse" && options?.method === "POST") {
        refreshFromLatestParseCalled = true;
        return jsonResponse({
          success: true,
          data: reviewDraft(latestDraft, {
            id: "review_snapshot_latest",
            snapshotId: "review_snapshot_latest",
            sourceParseAttemptId: "attempt_2",
            sourceParseAttemptCreatedAt: "2026-06-09T12:01:00.000Z",
            initializedFromParse: true,
          }),
        });
      }
      if (path === "/api/inbound-orders/product-options/product_pvc" && options?.method === "POST") {
        return jsonResponse(pbv2OptionsResponse({
          productId: "product_pvc",
          productName: "PVC",
          activeTreeVersionId: "tree_pvc",
          suggestedSelections: (latestDraft.lineItems[0] as any).optionSelectionsJson,
          suggestions: (latestDraft.lineItems[0] as any).pbv2OptionSuggestions,
        }));
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("ACM Signs");

    const parseButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Parse with AI")
    ));
    await act(async () => {
      Simulate.click(parseButton!);
    });

    await waitForCondition(() => refreshFromLatestParseCalled, "latest parse auto-applied to review draft");
    await waitForCondition(
      () => (labeledControl("Material", "input") as HTMLInputElement).value === "3mm white PVC",
      "latest parsed material in editable control",
    );
    expect(labeledControl("Product", "select")).toHaveProperty("value", "product_pvc");
    expect(labeledControl("Material", "input")).toHaveProperty("value", "3mm white PVC");
    expect(container.textContent).toContain("Single Sided / 4/0");
    expect(container.textContent).not.toContain("6mm ACM");
  });

  test("warns before applying a latest parse over unsaved staff edits", async () => {
    const row = record();
    const currentDraft = parsedDraft();
    const latestDraft = parsedDraft({
      order: { ...parsedDraft().order, poNumber: "PO-LATEST" },
    });
    const latestAttempt = parseAttempt({ id: "attempt_2", parsedDraft: latestDraft, confidence: 91, warnings: [] });
    let parseCalled = false;
    let refreshFromLatestParseCalled = false;
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft: currentDraft, latestAttempt: parseAttempt({ parsedDraft: currentDraft }) }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(currentDraft, { hasNewerParse: parseCalled }) });
      }
      if (path === "/api/inbound-orders/inbound_1/parse" && options?.method === "POST") {
        parseCalled = true;
        return jsonResponse({
          success: true,
          data: {
            draft: latestDraft,
            latestAttempt,
            record: { ...row, status: "needs_review", parsedAt: "2026-06-09T12:06:00.000Z" },
          },
        });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft/refresh-from-latest-parse" && options?.method === "POST") {
        refreshFromLatestParseCalled = true;
        return jsonResponse({ success: true, data: reviewDraft(latestDraft) });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Phase 4: Create draft order from reviewed inbound record.");
      const notesButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Add Notes")
      ));
      act(() => {
        Simulate.click(notesButton!);
      });
      await waitForText("Review notes");
      act(() => {
        Simulate.change(labeledControl("Review notes", "textarea"), { target: { value: "Staff edited this draft." } } as any);
      });
      await waitForText("Unsaved changes");

      const parseButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Parse with AI")
      ));
      await act(async () => {
        Simulate.click(parseButton!);
      });

      await waitForCondition(() => parseCalled, "parse called after keeping current draft");
      await waitForText("Current draft is older than the latest parse.");
      expect(confirmSpy).toHaveBeenCalledWith("Applying the latest parse will overwrite your draft changes.");
      expect(refreshFromLatestParseCalled).toBe(false);
      expect(labeledControl("Review notes", "textarea")).toHaveProperty("value", "Staff edited this draft.");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("renders unsupported request findings in the editable review workspace", async () => {
    const row = record();
    const draft = parsedDraft({ missingDecisions: [], globalWarnings: [] });
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 92, warnings: [] });

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: attempt }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({
          success: true,
          data: reviewDraft(draft, {
            unsupportedRequestsJson: [{
              type: "UNSUPPORTED_REQUEST",
              requestedText: "grommets in the corners",
              category: "grommets",
              matchedProduct: "PVC",
              reason: "No compatible PBV2 option found.",
              severity: "review_required",
              suggestedAction: "Add manually or select a different product.",
            }],
          }),
        });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Unsupported Requests");
    expect(container.textContent).toContain("grommets in the corners");
    expect(container.textContent).toContain("Review Required");
    expect(container.textContent).toContain("No compatible PBV2 option found.");
    expect(container.textContent).toContain("Add manually or select a different product.");
    expect(container.textContent).toContain("Create Draft Order");
  });

  test("searches and saves selected customer and contact in review draft", async () => {
    const row = record();
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });
    let savedBody: any = null;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: attempt }));
      }
      if (path.startsWith("/api/inbound-orders/customer-search")) {
        return jsonResponse({
          success: true,
          data: [{
            id: "customer_search",
            companyName: "Acme Print Co",
            email: "orders@acme.test",
            phone: "555-0100",
            status: "active",
          }],
        });
      }
      if (path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({
          success: true,
          data: [{
            id: "contact_search",
            customerId: path.includes("customer_search") ? "customer_search" : "customer_1",
            name: "Alex Contact",
            firstName: "Alex",
            lastName: "Contact",
            email: "alex@acme.test",
            phone: "555-0101",
            mobile: null,
            isPrimary: true,
          }],
        });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return jsonResponse({
          success: true,
          data: reviewDraft(draft, {
            ...savedBody,
            updatedAt: "2026-06-09T12:04:00.000Z",
          }),
        });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft) });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Save Review Draft");

    act(() => {
      Simulate.change(labeledControl("Customer search", "input"), { target: { value: "Acme" } } as any);
    });
    await waitForText("Acme Print Co");
    act(() => {
      Simulate.change(labeledControl("Selected customer", "select"), { target: { value: "customer_search" } } as any);
    });
    await waitForCondition(
      () => (labeledControl("Selected customer", "select") as HTMLSelectElement).value === "customer_search",
      "selected customer settled",
    );
    act(() => {
      Simulate.change(labeledControl("Contact search", "input"), { target: { value: "Alex" } } as any);
    });
    act(() => {
      Simulate.change(labeledControl("Selected contact", "select"), { target: { value: "contact_1" } } as any);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Save Review Draft")
    ));
    await act(async () => {
      Simulate.click(saveButton!);
    });
    await waitForCondition(() => Boolean(savedBody), "review draft PUT with selected customer/contact");

    expect(savedBody.reviewedCustomerJson.selectedCustomerId).toBe("customer_search");
    expect(savedBody.reviewedCustomerJson.selectedCustomerSource).toBe("staff_selected");
    expect(savedBody.reviewedCustomerJson.selectedContactId).toBe("contact_1");
    expect(savedBody.reviewedCustomerJson.selectedContactSource).toBe("staff_selected");
    expect(savedBody.reviewedCustomerJson.unresolvedCustomer).toBe(false);
    expect(savedBody.reviewedCustomerJson.unresolvedContact).toBe(false);
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/orders"), expect.anything());
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/customers"), expect.objectContaining({ method: "POST" }));
  });

  test("adds an unresolved manual line item and saves it without downstream records", async () => {
    const row = record();
    const draft = parsedDraft({ lineItems: [], missingDecisions: [], globalWarnings: [] });
    let savedBody: any = null;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return jsonResponse({ success: true, data: reviewDraft(draft, { ...savedBody }) });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft, { reviewedLineItemsJson: [] }) });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Add line item");
    const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add line item"));
    act(() => {
      Simulate.click(addButton!);
    });
    await waitForText("Manual line item 1");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Review Draft"));
    await act(async () => {
      Simulate.click(saveButton!);
    });
    await waitForCondition(() => Boolean(savedBody), "review draft PUT with unresolved manual line item");

    expect(savedBody.reviewedLineItemsJson).toHaveLength(1);
    expect(savedBody.reviewedLineItemsJson[0]).toMatchObject({
      selectedProductId: null,
      selectedProductSource: null,
      productUnresolved: true,
    });
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/orders"), expect.anything());
  });

  test("links inbound artwork attachments to one or multiple draft line items", async () => {
    const row = record();
    const draft = parsedDraft({
      lineItems: [
        {
          ...parsedDraft().lineItems[0],
          sourceText: "Front PVC sign 24x36",
          productName: "PVC Sign",
          materialText: "3mm White PVC",
          artworkRefs: ["front-panel.pdf"],
        },
        {
          ...parsedDraft().lineItems[0],
          sourceText: "Rear PVC sign 24x36",
          productName: "PVC Sign",
          materialText: "3mm White PVC",
          artworkRefs: [],
        },
      ],
      missingDecisions: [],
      globalWarnings: [],
    });
    const frontLink = {
      fileId: "file_front",
      fileRecordId: "file_rec_front",
      filename: "front-panel.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
      role: "artwork",
      source: "unresolved",
      confidence: 64,
      reason: "Ambiguous artwork candidate.",
    };
    const backLink = {
      fileId: "file_back",
      fileRecordId: "file_rec_back",
      filename: "back-panel.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2200,
      role: "artwork",
      source: "unresolved",
      confidence: 40,
      reason: "No reliable line-item match was detected.",
    };
    const files = [
      {
        id: "file_front",
        organizationId: "org_1",
        inboundRecordId: "inbound_1",
        inboundLineItemId: null,
        fileRecordId: "file_rec_front",
        sourceFilename: "front-panel.pdf",
        role: "artwork",
        mimeType: "application/pdf",
        sizeBytes: 1200,
        checksum: null,
        status: "available",
        providerAttachmentId: null,
        providerMessageId: null,
        contentDisposition: "attachment",
        metadataJson: {},
        reviewNotes: null,
        createdQuoteAttachmentId: null,
        createdOrderAttachmentId: null,
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-09T12:00:00.000Z",
      },
      {
        id: "file_back",
        organizationId: "org_1",
        inboundRecordId: "inbound_1",
        inboundLineItemId: null,
        fileRecordId: "file_rec_back",
        sourceFilename: "back-panel.pdf",
        role: "artwork",
        mimeType: "application/pdf",
        sizeBytes: 2200,
        checksum: null,
        status: "available",
        providerAttachmentId: null,
        providerMessageId: null,
        contentDisposition: "attachment",
        metadataJson: {},
        reviewNotes: null,
        createdQuoteAttachmentId: null,
        createdOrderAttachmentId: null,
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-09T12:00:00.000Z",
      },
    ];
    let savedBody: any = null;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row, { files }) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      }
      if (path.startsWith("/api/inbound-orders/product-options")) return jsonResponse(pbv2OptionsResponse());
      if (path === "/api/inbound-orders/inbound_1/review-draft" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return jsonResponse({ success: true, data: reviewDraft(draft, { ...savedBody }) });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft, { unassignedAttachments: [frontLink, backLink] }) });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search") || path.startsWith("/api/inbound-orders/product-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Unassigned Attachments");
    await waitForText("front-panel.pdf");

    const assignFront = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Assign front-panel.pdf to line item"
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(assignFront, { target: { value: "0" } } as any);
    });

    const attachFrontToSecondLine = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Attach artwork to line item 2"
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(attachFrontToSecondLine, { target: { value: "record:file_rec_front" } } as any);
    });

    const attachBackToFirstLine = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Attach artwork to line item 1"
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(attachBackToFirstLine, { target: { value: "record:file_rec_back" } } as any);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Review Draft"));
    await act(async () => {
      Simulate.click(saveButton!);
    });
    await waitForCondition(() => Boolean(savedBody), "review draft PUT with artwork links");

    expect(savedBody.reviewedLineItemsJson[0].artworkLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "file_front", source: "staff_selected" }),
      expect.objectContaining({ fileId: "file_back", source: "staff_selected" }),
    ]));
    expect(savedBody.reviewedLineItemsJson[1].artworkLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "file_front", source: "staff_selected" }),
    ]));
    expect(savedBody.reviewedArtworkJson.unassignedAttachments).toEqual([]);
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/orders"), expect.anything());
  });

  test("searches active products, saves staff product/material edits, and supports duplicate/remove", async () => {
    const row = record();
    const draft = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "Need rigid panels",
        productName: null,
        candidateProductIds: [],
        productCandidates: [],
        materialText: null,
      }],
      missingDecisions: [],
      globalWarnings: [],
    });
    const initialLineItem = {
      ...reviewDraft(draft).reviewedLineItemsJson[0],
      productName: null,
      selectedProductId: null,
      selectedProductSource: null,
      interpretedProductId: null,
      interpretedProductReason: null,
      interpretedProductConfidence: null,
      productUnresolved: true,
      materialText: null,
      materialSource: null,
      optionSelectionsJson: null,
      pbv2TreeVersionId: null,
      pbv2OptionSuggestions: [],
    };
    let savedBody: any = null;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      }
      if (path.startsWith("/api/inbound-orders/product-search")) {
        return jsonResponse({
          success: true,
          data: [{
            id: "product_acm",
            name: "ACM Panel",
            description: "Aluminum composite panel",
            category: "Signs",
            pricingMode: "area",
            pbv2ActiveTreeVersionId: null,
            isActive: true,
          }],
        });
      }
      if (path === "/api/inbound-orders/product-options/product_acm" && options?.method === "POST") {
        return jsonResponse({
          success: true,
          data: {
            productId: "product_acm",
            productName: "ACM Panel",
            activeTreeVersionId: null,
            treeJson: null,
            requiredOptions: [],
            suggestedSelections: { schemaVersion: 2, selected: {} },
            suggestions: [],
          },
        });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return jsonResponse({ success: true, data: reviewDraft(draft, { ...savedBody }) });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft, { reviewedLineItemsJson: [initialLineItem] }) });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Search active catalog products");

    act(() => {
      Simulate.change(labeledControl("Search active catalog products", "input"), { target: { value: "acm" } } as any);
    });
    await waitForText("ACM Panel");
    const productSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      Array.from(select.options).some((option) => option.value === "product_acm")
    ));
    act(() => {
      Simulate.change(productSelect!, { target: { value: "product_acm" } } as any);
    });
    await waitForCondition(() => (productSelect as HTMLSelectElement).value === "product_acm", "staff selected product in operational line item");

    act(() => {
      Simulate.change(labeledControl("Material", "input"), { target: { value: "3mm ACM" } } as any);
    });
    const duplicateButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Duplicate"));
    act(() => {
      Simulate.click(duplicateButton!);
    });
    const removeButtons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent?.includes("Remove"));
    act(() => {
      Simulate.click(removeButtons[0]);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Review Draft"));
    await act(async () => {
      Simulate.click(saveButton!);
    });
    await waitForCondition(() => Boolean(savedBody), "review draft PUT with manual product/material edits");

    expect(savedBody.reviewedLineItemsJson).toHaveLength(1);
    expect(savedBody.reviewedLineItemsJson[0]).toMatchObject({
      selectedProductId: "product_acm",
      selectedProductSource: "staff_selected",
      productName: "ACM Panel",
      materialText: "3mm ACM",
      materialSource: "staff_selected",
    });
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/orders"), expect.anything());
  });

  test("loads product options, shows missing required options, and saves suggested PBV2 selections", async () => {
    const row = record();
    const draft = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "3 PVC Signs 24x36 3mm White PVC",
        productName: "PVC Signs",
        candidateProductIds: ["product_1"],
        productCandidates: [{
          id: "product_1",
          label: "PVC Signs",
          confidence: 94,
          reason: "Matched material",
          metadata: {},
        }],
        materialText: "3mm White PVC",
      }],
      missingDecisions: [],
      globalWarnings: [],
    });
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 92, warnings: [] });
    let savedBody: any = null;

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: attempt }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft" && options?.method === "PUT") {
        savedBody = JSON.parse(options.body);
        return jsonResponse({ success: true, data: reviewDraft(draft, { ...savedBody }) });
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: reviewDraft(draft) });
      }
      if (path === "/api/inbound-orders/product-options/product_1" && options?.method === "POST") {
        return jsonResponse(pbv2OptionsResponse());
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Product options");
    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Debug View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(debugButton);
    });
    await waitForText("Draft Builder");
    await waitForText("Product options");
    await waitForText("Source evidence");
    await waitForText("Evidence: \"3mm White PVC\"");
    await waitForText("Missing required options: Sides");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Save Review Draft")
    ));
    await act(async () => {
      Simulate.click(saveButton!);
    });
    await waitForCondition(() => Boolean(savedBody), "review draft save with PBV2 selections");

    expect(savedBody.reviewedLineItemsJson[0].optionSelectionsJson).toMatchObject({
      schemaVersion: 2,
      selected: {
        thickness: { value: "3mm_white", origin: "SOURCE_EVIDENCE", evidence: "3mm White PVC" },
      },
    });
    expect(savedBody.reviewedLineItemsJson[0].pbv2TreeVersionId).toBe("tree_1");
    expect(savedBody.reviewedLineItemsJson[0].pbv2OptionSuggestions[0].choiceLabel).toBe("3mm White PVC");
  });

  test("rejects an inbound record out of the active queue and shows it under rejected", async () => {
    const activeRow = record();
    const rejectedRow = record({
      status: "terminal",
      reviewOutcome: "rejected",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
      rejectionReason: "Spam",
      rejectedAt: "2026-06-09T12:05:00.000Z",
    });
    let rejected = false;
    let rejectBody: any = null;
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("Spam");

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) {
        if (path.includes("statusGroup=rejected")) return jsonResponse(listResponse(rejected ? [rejectedRow] : []));
        return jsonResponse(listResponse(rejected ? [] : [activeRow]));
      }
      if (path === "/api/inbound-orders/inbound_1") {
        return jsonResponse({ success: true, data: detail(rejected ? rejectedRow : activeRow) });
      }
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      if (path === "/api/inbound-orders/inbound_1/reject" && options?.method === "POST") {
        rejectBody = JSON.parse(options.body);
        rejected = true;
        return jsonResponse({ success: true, data: detail(rejectedRow) });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForCondition(
        () => Boolean(container.querySelector("button[aria-label='Reject inbound record']")),
        "reject action button",
      );
      const rejectButton = container.querySelector("button[aria-label='Reject inbound record']");
      await act(async () => {
        Simulate.click(rejectButton as HTMLButtonElement);
      });
      await waitForText("No inbound records");

      expect(rejectBody).toEqual({ reason: "Spam" });
      expect(promptSpy).toHaveBeenCalled();

      const rejectedFilter = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Rejected")
      ));
      act(() => {
        Simulate.click(rejectedFilter!);
      });
      await waitForText("PO-123");
      expect(container.textContent).toContain("Rejected");
      expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/orders"), expect.anything());
    } finally {
      promptSpy.mockRestore();
    }
  });

  test("converts a ready review draft to a draft order and removes it from the default queue", async () => {
    const activeRow = record({
      status: "ready",
      reviewOutcome: "ready_to_convert",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
    });
    const convertedRow = record({
      ...activeRow,
      status: "submitted",
      reviewOutcome: "order_created",
      createdOrderId: "order_1",
      matchedOrderId: "order_1",
      submittedAt: "2026-06-09T12:30:00.000Z",
      submittedByUserId: "user_1",
    });
    const draft = parsedDraft({ missingDecisions: [], globalWarnings: [] });
    const readyDraft = reviewDraft(draft, { status: "ready_to_convert", validationErrors: [] });
    let converted = false;
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) {
        if (path.includes("statusGroup=converted")) return jsonResponse(listResponse(converted ? [convertedRow] : []));
        return jsonResponse(listResponse(converted ? [] : [activeRow]));
      }
      if (path === "/api/inbound-orders/inbound_1") {
        return jsonResponse({ success: true, data: detail(converted ? convertedRow : activeRow) });
      }
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: readyDraft });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      if (path === "/api/inbound-orders/inbound_1/convert-to-order" && options?.method === "POST") {
        converted = true;
        return jsonResponse({
          success: true,
          data: {
            orderId: "order_1",
            inboundOrderId: "inbound_1",
            convertedAt: "2026-06-09T12:30:00.000Z",
            alreadyConverted: false,
            order: {
              id: "order_1",
              orderNumber: "1001",
              status: "new",
              lineItems: [],
            },
            inbound: detail(convertedRow),
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Phase 4: Create draft order from reviewed inbound record.");

      const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Create Draft Order")
      ));
      expect(createDraftButton).toBeTruthy();
      expect(createDraftButton?.disabled).toBe(false);

      await act(async () => {
        Simulate.click(createDraftButton!);
      });
      await waitForText("Open created order");

      expect(confirmSpy).toHaveBeenCalled();
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/inbound-orders/inbound_1/convert-to-order",
        expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
      );
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft order created" }));
      expect(container.querySelector("a[href='/orders/order_1']")).toBeTruthy();
      await waitForText("No inbound records");

      const convertedFilter = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Converted")
      ));
      act(() => {
        Simulate.click(convertedFilter!);
      });
      await waitForText("PO-123");
      expect(container.textContent).toContain("Converted");
      await waitForText("View Draft Order");
      expect(container.querySelector("a[href='/orders/order_1']")).toBeTruthy();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("shows conversion validation errors and re-enables draft order retry", async () => {
    const row = record({
      status: "ready",
      reviewOutcome: "ready_to_convert",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
    });
    const draft = parsedDraft({ missingDecisions: [], globalWarnings: [] });
    const readyDraft = reviewDraft(draft, { status: "ready_to_convert", validationErrors: [] });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") {
        return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      }
      if (path === "/api/inbound-orders/inbound_1/review-draft") {
        return jsonResponse({ success: true, data: readyDraft });
      }
      if (path.startsWith("/api/inbound-orders/customer-search") || path.startsWith("/api/inbound-orders/contact-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      if (path === "/api/inbound-orders/inbound_1/convert-to-order" && options?.method === "POST") {
        return jsonResponse({
          success: false,
          message: "Inbound review draft is not ready for order conversion.",
          errors: ["Select an existing customer before creating a draft order."],
        }, false, 400);
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Phase 4: Create draft order from reviewed inbound record.");

      const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Create Draft Order")
      ));
      await act(async () => {
        Simulate.click(createDraftButton!);
      });

      await waitForText("Draft order creation failed");
      expect(container.textContent).toContain("Select an existing customer before creating a draft order.");
      const retryButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Create Draft Order")
      ));
      expect(retryButton?.disabled).toBe(false);
      expect(confirmSpy).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("edits and saves review draft fields without enabling order creation", async () => {
    const row = record();
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft, confidence: 82, warnings: draft.globalWarnings });
    let savedBody: any = null;
    let markReadyCalled = false;
    let refreshFromLatestParseCalled = false;

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
      if (path === "/api/inbound-orders/inbound_1/review-draft/refresh-from-latest-parse" && options?.method === "POST") {
        refreshFromLatestParseCalled = true;
        return jsonResponse({
          success: true,
          data: reviewDraft(draft, {
            snapshotId: "snapshot_refreshed",
            id: "snapshot_refreshed",
            hasNewerParse: false,
            initializedFromParse: true,
          }),
        });
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
    await waitForText("Current draft is older than the latest parse.");
    expect(container.textContent).toContain("Latest Parse Suggestions may differ from Current Draft Selections below.");
    const refreshButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Refresh from Latest Parse")
    ));
    expect(refreshButton).toBeTruthy();
    expect(container.textContent).toContain("Save Review Draft");
    expect(container.textContent).toContain("Mark Ready to Convert");

    await act(async () => {
      Simulate.click(refreshButton!);
    });
    await waitForCondition(() => refreshFromLatestParseCalled, "refresh from latest parse called");

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
    const notesButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Add Notes")
    ));
    act(() => {
      Simulate.click(notesButton!);
    });
    await waitForText("Review notes");
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
      button.textContent?.includes("Create Draft Order")
    ));
    expect(orderCreationButton?.disabled).toBe(true);
  });
});
