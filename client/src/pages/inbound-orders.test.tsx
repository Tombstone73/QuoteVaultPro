import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockPdfRender = jest.fn(() => ({ promise: Promise.resolve() }));
const createMockPdfDocument = () => ({
    numPages: 2,
    destroy: jest.fn(() => Promise.resolve()),
    getPage: jest.fn((pageNumber: number) => Promise.resolve({
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({
        width: 500 * scale,
        height: 700 * scale,
      }),
      render: mockPdfRender,
      pageNumber,
    })),
});
const mockPdfGetDocument = jest.fn(() => ({
  promise: Promise.resolve(createMockPdfDocument()),
}));

jest.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => "pdf-worker-url", { virtual: true });
jest.mock("pdfjs-dist/cmaps/78-EUC-H.bcmap?url", () => "/pdf-cmaps/78-EUC-H.bcmap", { virtual: true });
jest.mock("pdfjs-dist/standard_fonts/FoxitFixed.pfb?url", () => "/pdf-standard-fonts/FoxitFixed.pfb", { virtual: true });
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: mockPdfGetDocument,
}));

import InboundOrdersPage, { operatorSafeParseErrorMessage } from "./inbound-orders";
import { apiFetch } from "@/lib/queryClient";

jest.mock("@/lib/queryClient", () => ({
  apiFetch: jest.fn(),
}));

describe("operatorSafeParseErrorMessage", () => {
  test("hides raw review-draft schema details from the operator", () => {
    expect(operatorSafeParseErrorMessage(new Error("Parse completed, but review draft persistence failed: recentProducts[1].label: String must contain at most 255 characters")))
      .toBe("Parse could not save the review draft. Please retry.");
  });
});

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

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children, ...props }: any) => <div role="dialog" {...props}>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.((event.target as HTMLInputElement).checked)}
      {...props}
    />
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
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

function blobResponse(mimeType = "application/pdf", body = "file-bytes", ok = true, status = ok ? 200 : 500) {
  const blob = new Blob([body], { type: mimeType });
  return {
    ok,
    status,
    headers: new Headers({ "content-type": mimeType }),
    blob: async () => blob,
    text: async () => ok ? body : "Unauthorized",
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
    senderTrustStatus: "unknown",
    matchedTrustRuleId: null,
    trustRuleType: null,
    trustReason: "No sender email was captured for this inbound message.",
    canAutoDownloadAttachments: false,
    attachmentDownloadPolicy: "no_attachments",
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
    pricingReviewJson: lineItem.pricingReviewJson ?? null,
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
            label: "Print Sides",
            input: { type: "select", required: true, selectionKey: "sides" },
            choices: [{ id: "single", value: "single", label: "Single Sided / 4/0" }],
          },
        },
      },
      requiredOptions: [
        { nodeId: "thickness", selectionKey: "thickness", label: "Thickness", inputType: "select" },
        { nodeId: "sides", selectionKey: "sides", label: "Print Sides", inputType: "select" },
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
  return queryClient;
}

function labeledControl(labelText: string, selector: string) {
  const label = Array.from(container.querySelectorAll("label")).find((element) => (
    element.textContent?.includes(labelText)
  ));
  const control = label?.querySelector(selector);
  if (!control) throw new Error(`Missing ${selector} for label: ${labelText}`);
  return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

function openSelectedQueueActions() {
  const actionsButton = Array.from(container.querySelectorAll("button")).find((button) => (
    button.getAttribute("aria-label")?.startsWith("Queue actions for ")
  )) as HTMLButtonElement;
  if (!actionsButton) throw new Error("Missing selected queue Actions button");
  act(() => {
    Simulate.click(actionsButton);
  });
}

function setupParsedInboundReview({
  row = record(),
  parsed = parsedDraft(),
  review = reviewDraft(parsed),
  detailOverrides = {},
  productSearchResults = [],
  downloadFailures = {},
}: {
  row?: any;
  parsed?: any;
  review?: any;
  detailOverrides?: Record<string, any>;
  productSearchResults?: any[];
  downloadFailures?: Record<string, { status?: number; message?: string }>;
} = {}) {
  const attempt = parseAttempt({ parsedDraft: parsed, confidence: 82, warnings: parsed.globalWarnings });
  let savedBody: any = null;
  let classificationBody: any = null;
  let bulkClassificationBody: any = null;
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
    if (path === `/api/inbound-orders/${row.id}/files/classification/bulk`) {
      bulkClassificationBody = JSON.parse(options?.body ?? "{}");
      const files = (detailOverrides.files ?? [])
        .filter((file: any) => bulkClassificationBody.fileIds.includes(file.id))
        .filter((file: any) => !(bulkClassificationBody.classification === "ARTWORK" && (file.status === "quarantined" || file.metadataJson?.attachmentState === "scan_pending" || file.metadataJson?.attachmentState === "blocked_file_type")))
        .map((file: any) => ({
          ...file,
          role: bulkClassificationBody.classification === "PO"
            ? "po"
            : bulkClassificationBody.classification === "ARTWORK"
              ? "artwork"
              : bulkClassificationBody.classification === "REFERENCE"
                ? "reference"
                : bulkClassificationBody.classification === "IGNORE_INLINE"
                  ? "ignore_inline"
                  : file.role,
        }));
      return jsonResponse({
        success: true,
        data: {
          files,
          errors: bulkClassificationBody.classification === "ARTWORK"
            ? (detailOverrides.files ?? []).filter((file: any) => bulkClassificationBody.fileIds.includes(file.id) && (file.status === "quarantined" || file.metadataJson?.attachmentState === "scan_pending" || file.metadataJson?.attachmentState === "blocked_file_type")).map((file: any) => ({ fileId: file.id, message: "Unsafe or quarantined attachments cannot be classified as usable artwork." }))
            : [],
          warnings: [],
        },
      });
    }
    if (path.includes(`/api/inbound-orders/${row.id}/files/`) && path.endsWith("/classification")) {
      classificationBody = JSON.parse(options?.body ?? "{}");
      const fileId = path.split("/files/")[1]?.split("/classification")[0];
      const existingFile = (detailOverrides.files ?? []).find((file: any) => file.id === fileId) ?? { id: fileId };
      return jsonResponse({
        success: true,
        data: {
          file: {
            ...existingFile,
            role: classificationBody.classification === "PO"
              ? "po"
              : classificationBody.classification === "ARTWORK"
                ? "artwork"
                : classificationBody.classification === "REFERENCE"
                  ? "reference"
                  : "other",
            metadataJson: {
              ...(existingFile.metadataJson ?? {}),
              attachmentClassification: {
                classification: classificationBody.classification,
                confidence: 100,
                source: "manual_override",
                reasons: [`Staff manually classified as ${classificationBody.classification}.`],
              },
            },
          },
          rule: classificationBody.rememberForCustomer ? { id: "attachment_rule_1" } : null,
          warning: null,
        },
      });
    }
    if (path.includes(`/api/inbound-orders/${row.id}/files/`) && path.endsWith("/trust-action")) {
      const fileId = path.split("/files/")[1]?.split("/trust-action")[0];
      const existingFile = (detailOverrides.files ?? []).find((file: any) => file.id === fileId);
      if (!existingFile) return jsonResponse({ success: false, message: "Attachment not found" }, false, 404);
      existingFile.fileRecordId = existingFile.fileRecordId ?? `file_record_${fileId}`;
      existingFile.status = "available";
      existingFile.metadataJson = { ...(existingFile.metadataJson ?? {}), attachmentState: "downloaded" };
      return jsonResponse({ success: true, data: existingFile });
    }
    if (path.includes(`/api/inbound-orders/${row.id}/files/`) && path.endsWith("/download")) {
      const fileId = path.split("/files/")[1]?.split("/download")[0];
      const existingFile = (detailOverrides.files ?? []).find((file: any) => file.id === fileId);
      if (!existingFile?.fileRecordId) return blobResponse("application/json", "Unauthorized", false, 401);
      if (downloadFailures[fileId]) {
        const failure = downloadFailures[fileId];
        return blobResponse("application/json", failure.message ?? "Unauthorized", false, failure.status ?? 401);
      }
      return blobResponse(existingFile.mimeType ?? "application/octet-stream");
    }
    if (path === "/api/inbound-orders/customer-search?limit=20") return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/api/inbound-orders/product-search?")) return jsonResponse({ success: true, data: productSearchResults });
    if (path.startsWith("/api/inbound-orders/contact-search?")) return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/api/inbound-orders/product-options/") && options?.method === "POST") return jsonResponse(pbv2OptionsResponse());
    return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
  });
  return {
    getSavedBody: () => savedBody,
    getClassificationBody: () => classificationBody,
    getBulkClassificationBody: () => bulkClassificationBody,
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
  URL.createObjectURL = jest.fn((blob: Blob) => `blob:${blob.type || "attachment"}`) as any;
  URL.revokeObjectURL = jest.fn() as any;
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value: async function arrayBuffer(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error ?? new Error("Unable to read blob."));
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
  HTMLAnchorElement.prototype.click = jest.fn();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    setTransform: jest.fn(),
    clearRect: jest.fn(),
  })) as any;
  mockPdfRender.mockReset();
  mockPdfRender.mockImplementation(() => ({ promise: Promise.resolve() }));
  mockPdfGetDocument.mockReset();
  mockPdfGetDocument.mockImplementation(() => ({ promise: Promise.resolve(createMockPdfDocument()) }));
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
    expect(container.textContent).toContain("Order Workstation");
  });

  test("shows compact intent and issue badges in the queue without repeated trust metadata", async () => {
    const trusted = record({
      id: "trusted_1",
      sourceType: "email",
      senderTrustStatus: "trusted_sender",
      trustReason: "Sender matched inbound trust rule sender_email_exact.",
      canAutoDownloadAttachments: true,
      attachmentDownloadPolicy: "auto_download_allowed",
      rawPayloadJson: {
        sender: { name: "Trusted Buyer", email: "buyer@example.com" },
        subject: "Trusted PO",
      },
      normalizedPayloadJson: {
        inboundIntent: "CUSTOMER_COMMUNICATION",
      },
    });
    const untrusted = record({
      id: "untrusted_1",
      sourceType: "email",
      senderTrustStatus: "untrusted",
      trustReason: "Sender is not trusted for automatic attachment download.",
      canAutoDownloadAttachments: false,
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: {
        sender: { name: "New Buyer", email: "new@example.net" },
        subject: "New PO",
      },
    });
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([trusted, untrusted]));
      if (path === `/api/inbound-orders/${trusted.id}`) return jsonResponse({ success: true, data: detail(trusted) });
      if (path === `/api/inbound-orders/${trusted.id}/draft-preview`) return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Customer Communication");

    expect(container.textContent).toContain("Customer Communication");
    expect(container.textContent).toContain("New Buyer");
    expect(container.textContent).toContain("Untrusted");
    expect(container.textContent).not.toContain("Auto-download");
    expect(container.textContent).not.toContain("Pending Trust");
    expect(container.textContent).not.toContain("Trust Sender + Download Attachments");
  });

  test("debounces queue search without clearing the selected workspace immediately", async () => {
    const first = record({
      id: "inbound_1",
      externalReference: "PVC-PO",
      rawPayloadJson: {
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "PVC signs",
        bodyText: "Please make PVC signs.",
      },
    });
    const second = record({
      id: "inbound_2",
      externalReference: "BACKLIT-PO",
      rawPayloadJson: {
        sender: { name: "Grace Hopper", email: "grace@example.com" },
        subject: "Backlit signs",
        bodyText: "Please make backlit signs.",
      },
    });
    const listRequests: string[] = [];
    const detailRequests: string[] = [];

    apiFetchMock.mockImplementation(async (url: any) => {
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
      if (path.startsWith("/api/inbound-orders?")) {
        listRequests.push(path);
        const params = new URL(`http://test.local${path}`).searchParams;
        const search = params.get("search")?.toLowerCase() ?? "";
        const rows = search.includes("pvc") ? [first] : [first, second];
        return jsonResponse(listResponse(rows));
      }
      if (path === "/api/inbound-orders/inbound_1") {
        detailRequests.push(path);
        return jsonResponse({ success: true, data: detail(first) });
      }
      if (path === "/api/inbound-orders/inbound_2") {
        detailRequests.push(path);
        return jsonResponse({ success: true, data: detail(second) });
      }
      if (path === "/api/inbound-orders/inbound_1/draft-preview" || path === "/api/inbound-orders/inbound_2/draft-preview") {
        return jsonResponse(draftPreview());
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("PVC-PO");
    await waitForText("BACKLIT-PO");
    await waitForCondition(() => detailRequests.includes("/api/inbound-orders/inbound_1"), "initial inbound record selected");

    const searchInput = container.querySelector("input[placeholder='Search queue']") as HTMLInputElement;
    act(() => {
      Simulate.change(searchInput, { target: { value: "p" } } as any);
      Simulate.change(searchInput, { target: { value: "pv" } } as any);
      Simulate.change(searchInput, { target: { value: "pvc" } } as any);
    });

    expect(searchInput.value).toBe("pvc");
    expect(listRequests.some((path) => path.includes("search=pvc"))).toBe(false);
    expect(detailRequests).not.toContain("/api/inbound-orders/inbound_2");
    expect(container.textContent).toContain("PVC-PO");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await waitForCondition(() => listRequests.some((path) => path.includes("search=pvc")), "debounced queue search applied");

    expect(container.textContent).toContain("PVC-PO");
    expect(container.textContent).not.toContain("BACKLIT-PO");
    expect(detailRequests).not.toContain("/api/inbound-orders/inbound_2");
  });

  test("requests customer sorting and renders the server-sorted queue without changing the selected job", async () => {
    const t3 = record({
      id: "inbound_t3",
      externalReference: "T3-PO",
      extractedCustomerJson: { companyName: "T3 Signs" },
      rawPayloadJson: {
        reference: "T3-PO",
        sender: { name: "T3 Signs", email: "orders@t3.test" },
        subject: "T3 signs",
        bodyText: "T3 order",
      },
    });
    const alpha = record({
      id: "inbound_alpha",
      externalReference: "ALPHA-PO",
      extractedCustomerJson: { companyName: "Alpha Graphics" },
      rawPayloadJson: {
        reference: "ALPHA-PO",
        sender: { name: "Alpha Graphics", email: "orders@alpha.test" },
        subject: "Alpha signs",
        bodyText: "Alpha order",
      },
    });
    const listRequests: string[] = [];
    const detailRequests: string[] = [];

    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path === "/api/inbound-orders/email-settings") {
        return jsonResponse({ success: true, data: { inboundEmailIntakeEnabled: true, inboundEmailPullPaused: false } });
      }
      if (path.startsWith("/api/inbound-orders?")) {
        listRequests.push(path);
        const sort = new URL(`http://test.local${path}`).searchParams.get("sort");
        return jsonResponse(listResponse(sort === "customer_asc" ? [alpha, t3] : [t3, alpha]));
      }
      if (path === `/api/inbound-orders/${t3.id}`) {
        detailRequests.push(path);
        return jsonResponse({ success: true, data: detail(t3) });
      }
      if (path === `/api/inbound-orders/${alpha.id}`) {
        detailRequests.push(path);
        return jsonResponse({ success: true, data: detail(alpha) });
      }
      if (path.endsWith("/draft-preview")) return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForCondition(() => listRequests.length > 0, "initial sorted queue request");
    await waitForText("T3-PO");
    await waitForCondition(() => detailRequests.includes(`/api/inbound-orders/${t3.id}`), "T3 job selected");

    act(() => {
      Simulate.click(container.querySelector("button[aria-label='Open queue filters']") as HTMLButtonElement);
    });
    await waitForCondition(
      () => Boolean(document.body.querySelector("select[aria-label='Queue sort']")),
      "queue sort control",
    );
    const sortSelect = document.body.querySelector("select[aria-label='Queue sort']") as HTMLSelectElement;
    expect(sortSelect).not.toBeNull();
    act(() => {
      Simulate.change(sortSelect, { target: { value: "customer_asc" } } as any);
    });

    await waitForCondition(
      () => listRequests.some((path) => path.includes("sort=customer_asc")),
      "customer sort request",
    );
    await waitForText("ALPHA-PO");
    expect(container.textContent!.indexOf("ALPHA-PO")).toBeLessThan(container.textContent!.indexOf("T3-PO"));
    expect(detailRequests).not.toContain(`/api/inbound-orders/${alpha.id}`);
  });

  test("composes trusted quick filtering with the debounced server search and updates the visible count", async () => {
    const trusted = record({
      id: "trusted_t3",
      externalReference: "T3-TRUSTED",
      rawPayloadJson: {
        reference: "T3-TRUSTED",
        sender: { name: "T3 Trusted", email: "trusted@t3.test" },
        subject: "T3 trusted",
        bodyText: "T3 trusted order",
      },
      senderTrustStatus: "trusted_sender",
      canAutoDownloadAttachments: true,
    });
    const untrusted = record({
      id: "untrusted_t3",
      externalReference: "T3-UNTRUSTED",
      rawPayloadJson: {
        reference: "T3-UNTRUSTED",
        sender: { name: "T3 Untrusted", email: "untrusted@t3.test" },
        subject: "T3 untrusted",
        bodyText: "T3 untrusted order",
      },
      senderTrustStatus: "untrusted",
      attachmentDownloadPolicy: "pending_trust",
    });

    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path === "/api/inbound-orders/email-settings") {
        return jsonResponse({ success: true, data: { inboundEmailIntakeEnabled: true, inboundEmailPullPaused: false } });
      }
      if (path.startsWith("/api/inbound-orders?")) {
        const search = new URL(`http://test.local${path}`).searchParams.get("search");
        return jsonResponse(listResponse(search === "t3" ? [trusted, untrusted] : [trusted, untrusted]));
      }
      if (path === `/api/inbound-orders/${trusted.id}`) return jsonResponse({ success: true, data: detail(trusted) });
      if (path === `/api/inbound-orders/${untrusted.id}`) return jsonResponse({ success: true, data: detail(untrusted) });
      if (path.endsWith("/draft-preview")) return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("T3-TRUSTED");
    const searchInput = container.querySelector("input[placeholder='Search queue']") as HTMLInputElement;
    act(() => Simulate.change(searchInput, { target: { value: "t3" } } as any));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const cleanButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => Simulate.click(cleanButton));
    await waitForCondition(
      () => Boolean(container.querySelector("[data-testid='clean-queue-quick-filters']")),
      "Clean View queue quick filters",
    );

    const quickFilters = container.querySelector("[data-testid='clean-queue-quick-filters']") as HTMLElement;
    const trustedCheckbox = Array.from(quickFilters.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Trusted"))
      ?.querySelector("input") as HTMLInputElement;
    act(() => Simulate.change(trustedCheckbox, { target: { checked: true } } as any));

    const cleanQueue = container.querySelector("[data-testid='clean-inbound-queue']") as HTMLElement;
    expect(cleanQueue.textContent).toContain("1 visible");
    expect(cleanQueue.textContent).toContain("T3-TRUSTED");
    expect(cleanQueue.textContent).not.toContain("T3-UNTRUSTED");
  });

  test("does not auto-select a different inbound record on each debounced search result", async () => {
    const first = record({
      id: "inbound_1",
      externalReference: "PVC-PO",
      rawPayloadJson: {
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "PVC signs",
        bodyText: "Please make PVC signs.",
      },
    });
    const second = record({
      id: "inbound_2",
      externalReference: "BACKLIT-PO",
      rawPayloadJson: {
        sender: { name: "Grace Hopper", email: "grace@example.com" },
        subject: "Backlit signs",
        bodyText: "Please make backlit signs.",
      },
    });
    const listRequests: string[] = [];
    const detailRequests: string[] = [];

    apiFetchMock.mockImplementation(async (url: any) => {
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
      if (path.startsWith("/api/inbound-orders?")) {
        listRequests.push(path);
        const params = new URL(`http://test.local${path}`).searchParams;
        const search = params.get("search")?.toLowerCase() ?? "";
        const rows = search.includes("backlit") ? [second] : [first, second];
        return jsonResponse(listResponse(rows));
      }
      if (path === "/api/inbound-orders/inbound_1") {
        detailRequests.push(path);
        return jsonResponse({ success: true, data: detail(first) });
      }
      if (path === "/api/inbound-orders/inbound_2") {
        detailRequests.push(path);
        return jsonResponse({ success: true, data: detail(second) });
      }
      if (path === "/api/inbound-orders/inbound_1/draft-preview" || path === "/api/inbound-orders/inbound_2/draft-preview") {
        return jsonResponse(draftPreview());
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("PVC-PO");
    await waitForText("BACKLIT-PO");
    await waitForCondition(() => detailRequests.includes("/api/inbound-orders/inbound_1"), "initial inbound record selected");

    const searchInput = container.querySelector("input[placeholder='Search queue']") as HTMLInputElement;
    act(() => {
      Simulate.change(searchInput, { target: { value: "backlit" } } as any);
    });

    expect(listRequests.some((path) => path.includes("search=backlit"))).toBe(false);
    expect(detailRequests).not.toContain("/api/inbound-orders/inbound_2");
    expect(container.textContent).toContain("PVC-PO");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await waitForCondition(() => listRequests.some((path) => path.includes("search=backlit")), "debounced backlit search applied");

    expect(container.textContent).toContain("BACKLIT-PO");
    expect(container.textContent).toContain("PVC signs");
    expect(detailRequests).not.toContain("/api/inbound-orders/inbound_2");
  });

  test("trust filter sends the selected queue filter to the backend", async () => {
    const row = record({ sourceType: "email" });
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForCondition(
      () => Boolean(container.querySelector("button[aria-label='Open queue filters']")),
      "queue filter button",
    );
    act(() => {
      Simulate.click(container.querySelector("button[aria-label='Open queue filters']") as HTMLButtonElement);
    });
    await waitForCondition(
      () => Boolean(document.body.querySelector("select[aria-label='Sender trust filter']")),
      "sender trust filter",
    );
    const trustFilter = document.body.querySelector("select[aria-label='Sender trust filter']") as HTMLSelectElement;

    act(() => {
      trustFilter.value = "pending_attachment_trust";
      Simulate.change(trustFilter);
    });

    await waitForCondition(() => apiFetchMock.mock.calls.some(([url]) => (
      String(url).includes("trustFilter=pending_attachment_trust")
    )), "trust-filter-query-param");
  });

  test("select all filtered records and bulk trust sender creates trust rules without downloading", async () => {
    const first = record({
      id: "inbound_a",
      sourceType: "email",
      senderTrustStatus: "untrusted",
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: { sender: { name: "A", email: "a@example.com" }, subject: "A PO" },
    });
    const second = record({
      id: "inbound_b",
      sourceType: "email",
      senderTrustStatus: "untrusted",
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: { sender: { name: "B", email: "b@example.com" }, subject: "B PO" },
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("bulk trust");
    let bulkBody: any = null;
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([first, second]));
      if (path === `/api/inbound-orders/${first.id}`) return jsonResponse({ success: true, data: detail(first) });
      if (path === `/api/inbound-orders/${first.id}/draft-preview`) return jsonResponse(draftPreview());
      if (path === "/api/inbound-orders/bulk-action") {
        bulkBody = JSON.parse(options?.body ?? "{}");
        return jsonResponse({ success: true, data: { updatedIds: [first.id, second.id], errors: [] } });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Select all filtered records");
      const selectAll = container.querySelector("input[aria-label='Select all filtered inbound records']") as HTMLInputElement;
      act(() => {
        selectAll.checked = true;
        Simulate.change(selectAll);
      });
      await waitForText("2 selected");
      const trustButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Trust Sender")) as HTMLButtonElement;
      act(() => {
        Simulate.click(trustButton);
      });

      await waitForCondition(() => Boolean(bulkBody), "bulk-trust-body");
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Future emails"));
      expect(bulkBody).toMatchObject({
        recordIds: [first.id, second.id],
        action: "trust_sender",
        note: "bulk trust",
      });
    } finally {
      confirmSpy.mockRestore();
      promptSpy.mockRestore();
    }
  });

  test("queue Trust Sender creates a trust rule and updates the badge without navigation", async () => {
    const untrusted = record({
      id: "inline_trust_1",
      sourceType: "email",
      senderTrustStatus: "untrusted",
      trustReason: "Sender is not trusted for automatic attachment download.",
      canAutoDownloadAttachments: false,
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: { sender: { name: "New Buyer", email: "new@example.net" }, subject: "New PO" },
    });
    const trusted = record({
      ...untrusted,
      senderTrustStatus: "trusted_sender",
      trustReason: "Sender matched inbound trust rule sender_email_exact.",
      canAutoDownloadAttachments: true,
      attachmentDownloadPolicy: "auto_download_allowed",
    });
    let trustedApplied = false;
    let trustBody: any = null;
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      const current = trustedApplied ? trusted : untrusted;
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([current]));
      if (path === `/api/inbound-orders/${untrusted.id}`) return jsonResponse({ success: true, data: detail(current) });
      if (path === `/api/inbound-orders/${untrusted.id}/draft-preview`) return jsonResponse(draftPreview());
      if (path === `/api/inbound-orders/${untrusted.id}/trust-action`) {
        trustBody = JSON.parse(options?.body ?? "{}");
        trustedApplied = true;
        return jsonResponse({
          success: true,
          data: {
            result: { trustRuleType: "sender_email_exact", trustRuleValue: "new@example.net", attempted: 0, downloaded: 0, metadataOnly: 0, blocked: 0, failed: [] },
            inbound: detail(trusted),
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Actions");
      expect(container.querySelector(`[data-testid='queue-trust-action-${untrusted.id}-trust_sender']`)).toBeNull();
      openSelectedQueueActions();
      const trustButton = container.querySelector(`[data-testid='queue-trust-action-${untrusted.id}-trust_sender']`) as HTMLButtonElement;
      act(() => {
        Simulate.click(trustButton);
      });

      await waitForCondition(() => trustBody?.action === "trust_sender", "inline-trust-sender-body");
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("Pending Trust");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("queue Trust Sender resolves ignored-sender conflicts after confirmation", async () => {
    const row = record({
      id: "inline_conflict_1",
      sourceType: "email",
      senderTrustStatus: "ignored",
      canAutoDownloadAttachments: false,
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: { sender: { name: "Ignored Buyer", email: "ignored@example.net" }, subject: "New PO" },
    });
    const trusted = {
      ...row,
      senderTrustStatus: "trusted_sender",
      canAutoDownloadAttachments: true,
      attachmentDownloadPolicy: "auto_download_allowed",
    };
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const trustBodies: any[] = [];
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([trustBodies.some((body) => body.resolveConflict) ? trusted : row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(trustBodies.some((body) => body.resolveConflict) ? trusted : row) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview());
      if (path === `/api/inbound-orders/${row.id}/trust-action`) {
        const body = JSON.parse(options?.body ?? "{}");
        trustBodies.push(body);
        if (!body.resolveConflict) {
          return jsonResponse({
            success: false,
            code: "INBOUND_RULE_CONFLICT",
            message: "This sender/domain is currently ignored. Trusting it will disable the ignore rule.",
            conflict: { conflictType: "trust_conflicted_with_ignore", conflictingValue: "ignored@example.net" },
          }, false, 409);
        }
        return jsonResponse({
          success: true,
          data: {
            result: { trustRuleType: "sender_email_exact", trustRuleValue: "ignored@example.net", attempted: 0, downloaded: 0, metadataOnly: 0, blocked: 0, failed: [] },
            inbound: detail(trusted),
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Actions");
      expect(container.querySelector(`[data-testid='queue-trust-action-${row.id}-trust_sender']`)).toBeNull();
      openSelectedQueueActions();
      const trustButton = container.querySelector(`[data-testid='queue-trust-action-${row.id}-trust_sender']`) as HTMLButtonElement;
      act(() => {
        Simulate.click(trustButton);
      });

      await waitForCondition(
        () => trustBodies.some((body) => body.resolveConflict === "disable_conflicting_rule"),
        "inline trust conflict retry",
      );
      expect(confirmSpy).toHaveBeenCalledWith("This sender/domain is currently ignored. Trusting it will disable the ignore rule.");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("queue Trust Domain confirms before creating a domain trust rule", async () => {
    const row = record({
      id: "inline_domain_1",
      sourceType: "email",
      senderTrustStatus: "untrusted",
      canAutoDownloadAttachments: false,
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: { sender: { name: "New Buyer", email: "new@example.net" }, subject: "New PO" },
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    let trustBody: any = null;
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview());
      if (path === `/api/inbound-orders/${row.id}/trust-action`) {
        trustBody = JSON.parse(options?.body ?? "{}");
        return jsonResponse({
          success: true,
          data: {
            result: { trustRuleType: "sender_domain", trustRuleValue: "example.net", attempted: 0, downloaded: 0, metadataOnly: 0, blocked: 0, failed: [] },
            inbound: detail({ ...row, senderTrustStatus: "trusted_domain", canAutoDownloadAttachments: true }),
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Actions");
      expect(container.querySelector(`[data-testid='queue-trust-action-${row.id}-trust_domain']`)).toBeNull();
      openSelectedQueueActions();
      const trustButton = container.querySelector(`[data-testid='queue-trust-action-${row.id}-trust_domain']`) as HTMLButtonElement;
      act(() => {
        Simulate.click(trustButton);
      });

      await waitForCondition(() => trustBody?.action === "trust_domain", "inline-trust-domain-body");
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("example.net"));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("queue Trust Sender plus Download requests pending attachment processing", async () => {
    const row = record({
      id: "inline_download_1",
      sourceType: "email",
      senderTrustStatus: "untrusted",
      canAutoDownloadAttachments: false,
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: { sender: { name: "New Buyer", email: "new@example.net" }, subject: "New PO" },
    });
    let trustBody: any = null;
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row, {
        files: [{
          id: "file_pending",
          inboundRecordId: row.id,
          fileRecordId: null,
          role: "po",
          status: "uploaded",
          sourceFilename: "pending-po.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          providerAttachmentId: "att_pending",
          reviewNotes: "Pending trust",
          metadataJson: { attachmentState: "pending_trust" },
        }],
      }) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview());
      if (path === `/api/inbound-orders/${row.id}/trust-action`) {
        trustBody = JSON.parse(options?.body ?? "{}");
        return jsonResponse({
          success: true,
          data: {
            result: { trustRuleType: "sender_email_exact", trustRuleValue: "new@example.net", attempted: 1, downloaded: 1, metadataOnly: 0, blocked: 0, failed: [] },
            inbound: detail({ ...row, senderTrustStatus: "trusted_sender", canAutoDownloadAttachments: true, attachmentDownloadPolicy: "auto_download_allowed" }),
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Actions");
    expect(container.querySelector(`[data-testid='queue-trust-action-${row.id}-trust_sender_and_download']`)).toBeNull();
    openSelectedQueueActions();
    const trustDownloadButton = container.querySelector(`[data-testid='queue-trust-action-${row.id}-trust_sender_and_download']`) as HTMLButtonElement;
    act(() => {
      Simulate.click(trustDownloadButton);
    });

    await waitForCondition(() => trustBody?.action === "trust_sender_and_download", "inline-trust-download-body");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sender trust updated",
      description: expect.stringContaining("Downloaded 1"),
    }));
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
        intent: "ORDER_REQUEST",
        intentReason: "Explicit order intent detected: subject contains \"New Order\".",
        intentReasons: [
          "subject contains \"New Order\"",
          "quantity detected",
          "product phrase detected",
          "specs detected",
          "attachments present",
        ],
      },
      normalizedPayloadJson: {
        inboundIntent: "ORDER_REQUEST",
        inboundIntentReason: "Explicit order intent detected: subject contains \"New Order\".",
        inboundIntentReasons: [
          "subject contains \"New Order\"",
          "quantity detected",
          "product phrase detected",
          "specs detected",
          "attachments present",
        ],
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
    await waitForText("Source Documents");
    await waitForText("Hello CSR");
    await waitForText("PO candidate");
    await waitForText("Artwork candidate");
    await waitForText("Offset House Visual PO.pdf");
    expect(container.textContent).toContain("Metadata only");
    expect(container.textContent).not.toContain("Status: Quarantined");
    expect(container.textContent).toContain("File unavailable: Attachment download failed: Gmail attachment unavailable");
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
    await waitForText("Status: Quarantined");
    await waitForText("Attachment download failed: Gmail attachment unavailable");
    await waitForText("Intent evidence");
    await waitForText("subject contains \"New Order\"");
    await waitForText("quantity detected");
    await waitForText("specs detected");
    expect(window.localStorage.getItem("titanos.inboundOrders.reviewMode")).toBe("debug");
  });

  test("renders Clean View as a separate workstation and preserves existing views", async () => {
    const row = record({
      sourceType: "email",
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        sender: { name: "Rick Clark", email: "rick@example.com" },
        subject: "Magnets",
        bodyText: "Can you make me two Magnets that are 12 x 12 for PO-321 of the attached file thank you",
      },
      normalizedPayloadJson: {
        inboundIntent: "CUSTOMER_COMMUNICATION",
      },
    });
    const baseParsed = parsedDraft();
    const cleanParsed = parsedDraft({
      order: {
        ...baseParsed.order,
        poNumber: "PO-321",
      },
      lineItems: [{
        ...baseParsed.lineItems[0],
        sourceText: "two Magnets that are 12 x 12",
        productName: "Magnets",
        quantity: 2,
        width: 12,
        height: 12,
        dimensionsUnit: "in",
        materialText: "30 mil Magnetic",
        optionTexts: [],
        finishingTexts: ["Round Corners (0.25\")"],
        artworkLinks: [{
          fileId: "file_art",
          filename: "Lindsay X2.pdf",
          role: "artwork",
          source: "ai_suggested",
          confidence: 88,
        }],
      }],
      artwork: [{
        filename: "Lindsay X2.pdf",
        sourceReference: "attached file",
        likelyLineItemIndex: 0,
        purpose: "artwork",
        confidence: 88,
        warnings: [],
      }],
      missingDecisions: [],
      globalWarnings: [],
    });
    const cleanReview = reviewDraft(cleanParsed);
    cleanReview.reviewedLineItemsJson[0].selectedProductId = null;
    cleanReview.reviewedLineItemsJson[0].quantitySource = "source_evidence";
    cleanReview.reviewedLineItemsJson[0].dimensionsSource = "source_evidence";
    cleanReview.reviewedLineItemsJson[0].selectedProductSource = "source_evidence";
    cleanReview.reviewedLineItemsJson[0].productUnresolved = true;
    cleanReview.reviewedLineItemsJson[0].optionSelectionsJson = null;
    cleanReview.reviewedArtworkJson.unassignedAttachments.push({
      fileId: "file_art_image",
      fileRecordId: "file_record_art_image",
      filename: "magnet-proof.png",
      role: "artwork",
      source: "staff_selected",
      confidence: 96,
      mimeType: "image/png",
      sizeBytes: 123_400,
      classification: "ARTWORK",
      classificationSource: "manual_override",
    });
    const { getSavedBody, getClassificationBody } = setupParsedInboundReview({
      row,
      parsed: cleanParsed,
      review: cleanReview,
      productSearchResults: [{
        id: "product_pvc",
        name: "PVC Signs",
        category: "Rigid Signs",
        pricingMode: "pbv2",
        pbv2ActiveTreeVersionId: "tree_pvc",
        description: "PVC sign product",
      }],
      detailOverrides: {
        files: [{
          id: "file_art",
          inboundRecordId: row.id,
          fileRecordId: "file_record_art",
          role: "artwork",
          status: "uploaded",
          sourceFilename: "Lindsay X2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 509_800,
          providerAttachmentId: "att_art",
          reviewNotes: null,
        }, {
          id: "file_art_image",
          inboundRecordId: row.id,
          fileRecordId: "file_record_art_image",
          role: "artwork",
          status: "uploaded",
          sourceFilename: "magnet-proof.png",
          mimeType: "image/png",
          sizeBytes: 123_400,
          providerAttachmentId: "att_art_image",
          reviewNotes: null,
        }, {
          id: "file_po_reference",
          inboundRecordId: row.id,
          fileRecordId: "file_record_po_reference",
          role: "reference",
          status: "uploaded",
          sourceFilename: "Order No 321 Very Long Purchase Order Reference Document For Magnets.pdf",
          mimeType: "application/pdf",
          sizeBytes: 618_400,
          providerAttachmentId: "att_po_reference",
          reviewNotes: null,
        }, {
          id: "file_metadata_only",
          inboundRecordId: row.id,
          fileRecordId: null,
          role: "reference",
          status: "pending_trust",
          sourceFilename: "Metadata Only Customer Supplied Reference.pdf",
          mimeType: "application/pdf",
          sizeBytes: 91_200,
          providerAttachmentId: "att_metadata_only",
          reviewNotes: null,
        }],
      },
    });

    renderPage();
    await waitForText("Operational View");
    expect(container.textContent).toContain("Clean View");
    expect(container.textContent).toContain("Debug View");

    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Source Documents");
    await waitForText("Order Workstation");
    const cleanWorkspace = container.querySelector("[data-testid='clean-inbound-workspace']") as HTMLElement;
    expect(cleanWorkspace).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-inbound-queue']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-source-documents']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-order-workstation']")).toBeTruthy();
    const cleanFilterTrigger = container.querySelector("[aria-label='Open Clean View queue filters']") as HTMLButtonElement;
    act(() => {
      cleanFilterTrigger.click();
    });
    await waitForCondition(
      () => Boolean(document.body.querySelector("[data-testid='clean-queue-filters-popover']")),
      "Clean View filter popover portal",
    );
    const cleanFilterPopover = document.body.querySelector("[data-testid='clean-queue-filters-popover']") as HTMLElement;
    expect(container.querySelector("[data-testid='clean-inbound-queue']")?.contains(cleanFilterPopover)).toBe(false);
    expect(cleanFilterPopover.className).toContain("z-50");
    expect(container.querySelector("[data-testid='clean-inbound-queue']")?.className).toContain("h-full");
    expect(container.querySelector("[data-testid='clean-source-documents']")?.className).toContain("h-full");
    const cleanWorkstation = container.querySelector("[data-testid='clean-order-workstation']") as HTMLElement;
    expect(cleanWorkstation.className).toContain("h-full");
    expect(cleanWorkstation.className).toContain("flex-1");
    expect(cleanWorkstation.className).toContain("min-h-0");
    const cleanWorkstationScroller = Array.from(cleanWorkstation.children).find((element) => (
      element.className.includes("overflow-y-auto") && element.className.includes("flex-1") && element.className.includes("min-h-0")
    )) as HTMLElement;
    expect(cleanWorkstationScroller).toBeTruthy();
    const cleanQueuePanel = container.querySelector("[data-testid='clean-queue-panel']") as HTMLElement;
    const cleanSourcePanel = container.querySelector("[data-testid='clean-source-panel']") as HTMLElement;
    const cleanWorkstationPanel = container.querySelector("[data-testid='clean-workstation-panel']") as HTMLElement;
    expect(cleanQueuePanel.style.width).toBe("300px");
    expect(cleanQueuePanel.style.flex).toBe("0 0 300px");
    expect(cleanSourcePanel.style.flex).toContain(cleanWorkspace.style.getPropertyValue("--workspace-evidence-width").replace("px", ""));
    expect(cleanWorkstationPanel.style.flex).toContain(cleanWorkspace.style.getPropertyValue("--workspace-draft-width").replace("px", ""));
    expect(cleanWorkspace.querySelector("[aria-label='Resize queue panel']")).toBeTruthy();
    expect(cleanWorkspace.querySelector("[aria-label='Resize evidence panel']")).toBeTruthy();
    expect(cleanWorkspace.querySelector("[aria-label='Resize draft builder panel']")).toBeTruthy();
    act(() => {
      Simulate.mouseDown(cleanWorkspace.querySelector("[aria-label='Resize queue panel']") as HTMLButtonElement, { clientX: 300 } as any);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 340, bubbles: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await waitForCondition(() => cleanWorkspace.style.getPropertyValue("--workspace-queue-width") === "340px", "Clean View queue splitter resize");
    expect(window.localStorage.getItem("titanos.inboundOrders.queueWidth")).toBe("340");
    const startingCleanEvidenceWidth = Number.parseInt(cleanWorkspace.style.getPropertyValue("--workspace-evidence-width"), 10);
    act(() => {
      Simulate.mouseDown(cleanWorkspace.querySelector("[aria-label='Resize evidence panel']") as HTMLButtonElement, { clientX: 500 } as any);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 540, bubbles: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await waitForCondition(() => (
      cleanWorkspace.style.getPropertyValue("--workspace-evidence-width") === `${startingCleanEvidenceWidth + 40}px`
    ), "Clean View source/workstation splitter resize");
    expect(window.localStorage.getItem("titanos.inboundOrders.evidenceWidth")).toBe(String(startingCleanEvidenceWidth + 40));
    expect(container.querySelector("[data-testid='clean-ai-summary']")).toBeTruthy();
    expect(container.textContent).toContain("Order Summary");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain("92%");
    expect(container.querySelector("[data-testid='clean-source-chip-product']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-source-chip-quantity']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-completion-checklist']")).toBeTruthy();
    expect(container.textContent).toContain("Customer matched");
    expect(container.textContent).toContain("Product resolved");
    expect(container.textContent).toContain("Line Items");
    expect(container.textContent).toContain("Line Item 1");
    expect(container.textContent).not.toContain("Production Tickets");
    expect(container.textContent).not.toContain("Production Ticket 1");
    expect(container.querySelector("[data-testid='inbound-operational-email-panel']")).toBeNull();
    expect(container.textContent).not.toContain("Draft Builder");
    expect(container.querySelector("[data-clean-checklist-item='Product resolved']")?.getAttribute("data-complete")).toBe("false");

    expect(container.querySelector("[data-testid='clean-ticket-details']")).toBeNull();
    expect(container.textContent).not.toContain("Edit details");
    expect(container.querySelector("[data-testid='clean-product-catalog-selector']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-line-item-task-list']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-line-item-task-product']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-line-item-task-artwork']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-line-item-task-options']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-line-item-header-summary']")).toBeTruthy();
    expect(container.textContent).toContain("Re-scan");
    expect(container.textContent).toContain("Reparse");
    const evidenceCards = container.querySelectorAll("[data-testid='source-evidence-file-card']");
    expect(evidenceCards.length).toBeGreaterThan(0);
    expect(evidenceCards[0].className).toContain("min-w-0");
    expect(evidenceCards[0].className).toContain("overflow-hidden");
    expect(container.querySelector("a[aria-label='Open Lindsay X2.pdf']")).toBeNull();
    const emailOpenButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Open Lindsay X2.pdf") as HTMLButtonElement;
    expect(emailOpenButton).toBeTruthy();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Download Lindsay X2.pdf")).toBe(true);
    expect(container.querySelector("a[aria-label='Open Metadata Only Customer Supplied Reference.pdf']")).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Download Metadata Only Customer Supplied Reference.pdf")).toBe(false);
    await act(async () => {
      Simulate.click(emailOpenButton);
    });
    await waitForText("Document Viewer");
    expect(container.querySelector("[data-testid='clean-inline-attachment-viewer']")).toBeTruthy();
    expect(container.textContent).toContain("Order Workstation");
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-attachment-pdf-viewer']")), "app-controlled PDF viewer renders");
    expect(container.querySelector("[data-testid='clean-inline-attachment-viewer'] iframe")).toBeNull();
    expect(container.querySelector("[data-testid='clean-pdf-controls']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-pdf-canvas-stage']")?.getAttribute("data-fit-mode")).toBe("width");
    await waitForCondition(
      () => Boolean(container.querySelector("[data-testid='clean-pdf-page-canvas']")),
      "Clean View PDF page canvas rendered",
    );
    expect(container.querySelector("[data-testid='clean-pdf-page-canvas']")).toBeTruthy();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:application/pdf");
    expect(apiFetchMock.mock.calls.some(([url]) => String(url) === "/api/inbound-orders/inbound_1/files/file_art/download")).toBe(true);
    const zoomLabel = container.querySelector("[data-testid='clean-pdf-zoom-label']") as HTMLElement;
    const zoomBefore = zoomLabel.textContent;
    const zoomInButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Zoom in PDF") as HTMLButtonElement;
    act(() => {
      Simulate.click(zoomInButton);
    });
    await waitForCondition(() => zoomLabel.textContent !== zoomBefore, "PDF zoom in updates rendered scale");
    expect(container.querySelector("[data-testid='clean-pdf-canvas-stage']")?.getAttribute("data-fit-mode")).toBe("custom");
    const fitWidthButton = container.querySelector("[data-testid='clean-pdf-fit-width']") as HTMLButtonElement;
    act(() => {
      Simulate.click(fitWidthButton);
    });
    expect(container.querySelector("[data-testid='clean-pdf-canvas-stage']")?.getAttribute("data-fit-mode")).toBe("width");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Previous PDF page")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Next PDF page")).toBe(true);
    const expandButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Expand") as HTMLButtonElement;
    act(() => {
      Simulate.click(expandButton);
    });
    await waitForText("Attachment Viewer");
    const closeModalButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Close") as HTMLButtonElement;
    act(() => {
      Simulate.click(closeModalButton);
    });
    const closeViewerButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Close viewer") as HTMLButtonElement;
    act(() => {
      Simulate.click(closeViewerButton);
    });
    const downloadCallsBefore = apiFetchMock.mock.calls.filter(([url]) => String(url) === "/api/inbound-orders/inbound_1/files/file_art/download").length;
    const emailDownloadButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Download Lindsay X2.pdf") as HTMLButtonElement;
    await act(async () => {
      Simulate.click(emailDownloadButton);
    });
    await waitForCondition(() => (
      apiFetchMock.mock.calls.filter(([url]) => String(url) === "/api/inbound-orders/inbound_1/files/file_art/download").length > downloadCallsBefore
    ), "download uses authenticated file fetch");
    expect(container.textContent).toContain("Select product from catalog");
    expect(container.textContent).toContain("AI detected:");
    expect(container.querySelector("[data-testid='clean-quantity-workflow']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-size-workflow']")).toBeTruthy();
    expect(container.textContent).toContain("Quantity");
    expect(container.textContent).toContain("Size");
    expect(container.textContent).toContain("Step 1");
    expect(container.textContent).toContain("Step 5");
    const catalogProductSelect = container.querySelector("[data-testid='clean-product-catalog-select']") as HTMLSelectElement;
    expect(catalogProductSelect).toBeTruthy();
    expect(catalogProductSelect.tagName).toBe("SELECT");
    expect(labeledControl("Select product", "select")).toHaveProperty("value", "");
    expect(container.textContent).toContain("Product unresolved");
    const productSearchInput = container.querySelector("[data-testid='clean-product-catalog-search']") as HTMLInputElement;
    expect(productSearchInput).toBeTruthy();
    const productChecklistButton = container.querySelector("[data-clean-checklist-item='Product resolved']") as HTMLButtonElement;
    act(() => {
      Simulate.click(productChecklistButton);
    });
    await waitForCondition(() => (
      document.activeElement === productSearchInput
        || container.querySelector("[data-testid='clean-product-catalog-selector']")?.getAttribute("data-highlighted") === "true"
    ), "product checklist focuses inline catalog selector");

    const sizeSource = container.querySelector("[data-clean-source-target='dimensions']") as HTMLButtonElement;
    expect(sizeSource).toBeTruthy();
    act(() => {
      Simulate.click(sizeSource);
    });
    expect(container.querySelector("[data-clean-destination-target='dimensions']")?.getAttribute("data-highlighted")).toBe("true");

    const productSource = container.querySelector("[data-clean-source-target='product']") as HTMLButtonElement;
    act(() => {
      Simulate.click(productSource);
    });
    expect(container.querySelector("[data-clean-destination-target='product']")?.getAttribute("data-highlighted")).toBe("true");
    expect(container.querySelector("[data-testid='clean-evidence-comparison']")?.textContent).toContain("Product evidence");

    const quantityDestination = container.querySelector("[data-clean-destination-target='quantity']") as HTMLElement;
    act(() => {
      Simulate.mouseEnter(quantityDestination);
    });
    expect(container.querySelector("[data-clean-source-target='quantity']")?.getAttribute("data-highlighted")).toBe("true");

    const poSource = container.querySelector("[data-clean-source-target='po']") as HTMLButtonElement;
    act(() => {
      Simulate.click(poSource);
    });
    expect(container.querySelector("[data-testid='clean-po-field']")?.getAttribute("data-highlighted")).toBe("true");

    const productSourceChip = container.querySelector("[data-testid='clean-source-chip-product']") as HTMLButtonElement;
    act(() => {
      Simulate.click(productSourceChip);
    });
    await waitForCondition(() => (
      container.querySelector("[data-clean-source-target='product']")?.getAttribute("data-highlighted") === "true"
    ), "product source chip highlights source evidence");

    const artworkSource = container.querySelector("[data-clean-source-target='artwork']") as HTMLButtonElement;
    act(() => {
      Simulate.click(artworkSource);
    });
    expect(container.querySelector("[data-testid='clean-artwork-target']")?.getAttribute("data-highlighted")).toBe("true");
    expect(container.textContent).toContain("Artwork");
    expect(container.querySelector("[data-testid='clean-inline-artwork-select']")).toBeTruthy();
    const cleanAttachmentsSection = container.querySelector("[data-testid='clean-attachments-summary']") as HTMLDetailsElement;
    expect(cleanAttachmentsSection).toBeTruthy();
    expect(cleanAttachmentsSection.open).toBe(false);
    const cleanNotesSection = container.querySelector("[data-testid='clean-notes-section']") as HTMLDetailsElement;
    expect(cleanNotesSection).toBeTruthy();
    expect(cleanNotesSection.open).toBe(false);
    expect(cleanNotesSection.textContent).toContain("Internal: 0");
    expect(cleanNotesSection.textContent).toContain("Production: 1");
    const reviewTasksSection = container.querySelector("[data-testid='clean-review-tasks']") as HTMLDetailsElement;
    expect(reviewTasksSection).toBeTruthy();
    expect(reviewTasksSection.open).toBe(false);
    const readinessSection = container.querySelector("[data-testid='clean-readiness-validation']") as HTMLDetailsElement;
    expect(readinessSection).toBeTruthy();
    expect(readinessSection.open).toBe(false);
    expect(readinessSection.textContent).toContain("0 blocking issues");
    const missingBeforeConversionSection = container.querySelector("[data-testid='clean-missing-before-conversion']") as HTMLDetailsElement;
    expect(missingBeforeConversionSection).toBeTruthy();
    expect(missingBeforeConversionSection.open).toBe(false);
    expect(missingBeforeConversionSection.textContent).toContain("0 items");

    act(() => {
      Simulate.change(productSearchInput, { target: { value: "PVC" } } as any);
    });
    await waitForCondition(() => Array.from(catalogProductSelect.options).some((option) => option.value === "product_pvc"), "clean catalog search returns active product option");
    act(() => {
      Simulate.change(catalogProductSelect, { target: { value: "product_pvc" } } as any);
    });
    expect(container.textContent).toContain("Product resolved");
    expect(container.textContent).not.toContain("Product unresolved");
    expect(container.querySelector("[data-clean-checklist-item='Product resolved']")?.getAttribute("data-complete")).toBe("true");
    expect(container.querySelector("[aria-label='Dimension Unit']")).toBeTruthy();
    expect(container.textContent).not.toContain("Size Unit");
    expect(container.textContent).not.toContain("Finishing");
    expect(container.textContent).not.toContain("Line item notes");
    expect(container.textContent).not.toContain("Parsed material");
    expect(Array.from(container.querySelectorAll("label")).some((label) => label.textContent?.trim() === "Material")).toBe(false);
    await waitForText("PBV2 Product Options");
    expect(container.querySelector("[data-testid='clean-dynamic-product-options']")).toBeTruthy();
    await waitForText("Thickness");
    await waitForText("Print Sides");
    const keyOptionsEditor = Array.from(container.querySelectorAll("label")).find((label) => (
      label.textContent?.includes("Key Options") && Boolean(label.querySelector("input, select, textarea"))
    ));
    expect(keyOptionsEditor).toBeUndefined();

    const poTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "PO") as HTMLButtonElement;
    act(() => {
      Simulate.click(poTab);
    });
    await waitForText("PO Documents");
    await waitForText("Order No 321 Very Long Purchase Order Reference Document For Magnets.pdf");
    await waitForText("Likely PO / Reference PDF");
    expect(container.querySelector("a[aria-label='Open Order No 321 Very Long Purchase Order Reference Document For Magnets.pdf']")).toBeNull();
    const poOpenButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Open Order No 321 Very Long Purchase Order Reference Document For Magnets.pdf") as HTMLButtonElement;
    expect(poOpenButton).toBeTruthy();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Download Order No 321 Very Long Purchase Order Reference Document For Magnets.pdf")).toBe(true);
    await act(async () => {
      Simulate.click(poOpenButton);
    });
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-inline-attachment-viewer'] [data-testid='clean-attachment-pdf-viewer']")), "PO PDF opens in authenticated inline viewer");
    expect(container.textContent).toContain("Order Workstation");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Close viewer") as HTMLButtonElement);
    });

    const artworkTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Artwork") as HTMLButtonElement;
    act(() => {
      Simulate.click(artworkTab);
    });
    await waitForText("Artwork Files");
    expect(container.querySelector("a[aria-label='Open Lindsay X2.pdf']")).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Download Lindsay X2.pdf")).toBe(true);
    const imageOpenButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Open magnet-proof.png") as HTMLButtonElement;
    expect(imageOpenButton).toBeTruthy();
    await act(async () => {
      Simulate.click(imageOpenButton);
    });
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-inline-attachment-viewer'] [data-testid='clean-attachment-image-viewer']")), "artwork image opens in authenticated inline viewer");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Close viewer") as HTMLButtonElement);
    });
    const classifyButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.trim() === "Classify"
    )) as HTMLButtonElement;
    expect(classifyButton).toBeTruthy();
    act(() => {
      Simulate.click(classifyButton);
    });
    await waitForText("Classify attachment");
    const dialogClassificationSelect = labeledControl("Classification", "select") as HTMLSelectElement;
    act(() => {
      Simulate.change(dialogClassificationSelect, { target: { value: "REFERENCE" } } as any);
    });
    const rememberCheckbox = Array.from(container.querySelectorAll("input[type='checkbox']")).find((input) => (
      input.closest("label")?.textContent?.includes("Remember for this customer")
    )) as HTMLInputElement;
    expect(rememberCheckbox).toBeTruthy();
    act(() => {
      Simulate.change(rememberCheckbox, { target: { checked: true } } as any);
    });
    const saveClassificationButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save classification")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveClassificationButton);
    });
    await waitForCondition(() => Boolean(getClassificationBody()), "clean view attachment classification persisted");
    expect(container.textContent).toContain("Classification changed. Reparse to update draft.");
    expect(container.textContent).toContain("Reparse");
    expect(getClassificationBody()).toEqual(expect.objectContaining({
      classification: "REFERENCE",
      rememberForCustomer: true,
      rule: expect.objectContaining({
        customerId: "customer_1",
        senderDomain: "example.com",
        matchType: "filename_contains",
      }),
    }));

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "clean view manual attachment override saved");
    expect(getSavedBody().reviewedLineItemsJson[0]).toEqual(expect.objectContaining({
      selectedProductId: "product_pvc",
      productName: "PVC Signs",
      selectedProductSource: "staff_selected",
      productUnresolved: false,
    }));
    expect(getSavedBody().reviewedLineItemsJson[0].optionSelectionsJson).toEqual(expect.objectContaining({
      schemaVersion: 2,
      selected: expect.objectContaining({
        thickness: expect.objectContaining({ value: "3mm_white" }),
      }),
    }));
    expect(getSavedBody().reviewedArtworkJson.unassignedAttachments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filename: "Lindsay X2.pdf",
        classification: "REFERENCE",
        classificationSource: "manual_override",
      }),
    ]));

    const historyTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "History") as HTMLButtonElement;
    act(() => {
      Simulate.click(historyTab);
    });
    await waitForText("No thread history captured.");

    const operationalButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Operational View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(operationalButton);
    });
    await waitForText("Order Workstation");
    await waitForText("Draft Builder");
    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Debug View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(debugButton);
    });
    await waitForText("Source Evidence");
    await waitForText("Draft Builder");
  });

  test("does not prevent Space in Clean View PO Ref and preserves spaces in text inputs", async () => {
    const { getSavedBody } = setupParsedInboundReview();
    renderPage();
    await waitForText("Clean View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-order-workstation']")), "Clean View workstation renders");
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-po-field']")), "Clean View PO Ref input renders");

    const poInput = container.querySelector("[data-testid='clean-po-field']") as HTMLInputElement;
    expect(poInput).toBeTruthy();
    act(() => {
      poInput.focus();
    });
    expect(document.activeElement).toBe(poInput);
    const spaceEvent = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    const dispatched = poInput.dispatchEvent(spaceEvent);
    expect(dispatched).toBe(true);
    expect(spaceEvent.defaultPrevented).toBe(false);

    act(() => {
      Simulate.change(poInput, { target: { value: "PO 123 " } } as any);
    });
    await waitForCondition(() => poInput.value === "PO 123 ", "PO Ref preserves typed spaces");

    const carrierInput = labeledControl("Carrier", "input") as HTMLInputElement;
    act(() => {
      Simulate.change(carrierInput, { target: { value: "Fed Ex Freight " } } as any);
    });
    await waitForCondition(() => carrierInput.value === "Fed Ex Freight ", "Carrier preserves typed spaces");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    expect(saveButton).toBeTruthy();
    await waitForCondition(() => !saveButton.disabled, "Save Draft enabled after Clean View text changes");
    await act(async () => {
      Simulate.click(saveButton);
      await Promise.resolve();
    });
    await waitForCondition(() => Boolean(getSavedBody()), "Clean View draft saved after space regression edit");
    expect(getSavedBody().reviewedOrderJson.poNumber).toBe("PO 123 ");
    expect(getSavedBody().reviewedOrderJson.shipMethod).toBe("Fed Ex Freight ");
  });

  test("shows a Clean View attachment error when authenticated file access fails", async () => {
    const row = record({
      sourceType: "email",
      rawPayloadJson: {
        sender: { name: "Rick Clark", email: "rick@example.com" },
        subject: "PO access test",
        bodyText: "Please review the attached PO.",
      },
    });
    setupParsedInboundReview({
      row,
      detailOverrides: {
        files: [{
          id: "file_blocked",
          inboundRecordId: row.id,
          fileRecordId: "file_record_blocked",
          role: "po",
          status: "uploaded",
          sourceFilename: "Blocked PO.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          providerAttachmentId: "att_blocked",
          reviewNotes: null,
        }],
      },
      downloadFailures: {
        file_blocked: { status: 401, message: "Unauthorized" },
      },
    });

    renderPage();
    await waitForText("Clean View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });
    await waitForText("Blocked PO.pdf");
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Open Blocked PO.pdf") as HTMLButtonElement;
    await act(async () => {
      Simulate.click(openButton);
    });
    await waitForText("Document Viewer");
    expect(container.querySelector("[data-testid='clean-inline-attachment-viewer']")).toBeTruthy();
    await waitForText("Unauthorized");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Attachment open failed",
      description: expect.stringContaining("Unauthorized"),
      variant: "destructive",
    }));
    expect(container.querySelector("a[href='/api/inbound-orders/inbound_1/files/file_blocked/download']")).toBeNull();
  });

  test("shows why metadata-only files are unavailable and can fetch recoverable provider content", async () => {
    const metadataOnlyPdf = {
      id: "file_metadata_pdf",
      inboundRecordId: "inbound_1",
      fileRecordId: null,
      sourceFilename: "Coffee Bag Shoe Box V2 12.8.25.pdf",
      role: "artwork",
      status: "uploaded",
      providerAttachmentId: "att_metadata_pdf",
      providerMessageId: "gmail_msg_1",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      reviewNotes: "Attachment content was not downloaded during ingestion.",
      metadataJson: {
        attachmentState: "metadata_only",
        failureReason: "Attachment content was not downloaded during ingestion.",
      },
    };
    setupParsedInboundReview({ detailOverrides: { files: [metadataOnlyPdf] } });

    renderPage();
    await waitForText("Clean View");
    const cleanButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });
    await waitForText("Source Documents");
    await waitForText("Coffee Bag Shoe Box V2 12.8.25.pdf");
    expect(container.textContent).toContain("File unavailable: File content not stored yet. Fetch file to view/download.");
    expect(container.textContent).not.toContain("not supported for automatic download");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Open Coffee Bag Shoe Box V2 12.8.25.pdf")).toBe(false);

    const fetchButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Fetch file")) as HTMLButtonElement;
    expect(fetchButton).toBeTruthy();
    await act(async () => {
      Simulate.click(fetchButton);
    });

    await waitForCondition(() => apiFetchMock.mock.calls.some(([url, options]) => (
      String(url) === "/api/inbound-orders/inbound_1/files/file_metadata_pdf/trust-action"
        && JSON.parse(String(options?.body ?? "{}"))?.action === "download_once"
    )), "metadata-only attachment fetch request");
    await waitForCondition(() => Array.from(container.querySelectorAll("button")).some((button) => (
      button.getAttribute("aria-label") === "Open Coffee Bag Shoe Box V2 12.8.25.pdf"
    )), "fetched attachment open action");
  });

  test("allows quarantined ZIP attachments to be downloaded, classified as artwork, and assigned in Clean View", async () => {
    const zipFile = {
      id: "file_zip",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: "file_record_zip",
      sourceFilename: "Glass Barn Tractor Signs - 2026[1].zip",
      role: "other",
      mimeType: "application/zip",
      sizeBytes: 61_440,
      checksum: null,
      status: "quarantined",
      providerAttachmentId: "att_zip",
      providerMessageId: "msg_1",
      contentDisposition: "attachment",
      metadataJson: {
        attachmentState: "scan_pending",
        attachmentExtension: "zip",
        attachmentClassification: {
          classification: "OTHER",
          confidence: 35,
          source: "automatic",
          reasons: ["ZIP archive requires manual review."],
          breakdown: { filename: [], content: [], metadata: ["ZIP archive requires manual review."], manual: [], scores: { OTHER: 35 } },
        },
      },
      reviewNotes: "ZIP archive stored for manual review. Contents were not extracted.",
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: "2026-06-09T12:02:00.000Z",
      updatedAt: "2026-06-09T12:02:00.000Z",
    };
    const parsed = parsedDraft({ artwork: [], missingDecisions: [] });
    const review = reviewDraft(parsed);
    const { getSavedBody, getClassificationBody } = setupParsedInboundReview({
      parsed,
      review,
      detailOverrides: { files: [zipFile] },
    });

    renderPage();
    await waitForText("Operational View");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement);
    });
    await waitForText("Source Documents");
    await waitForText("Glass Barn Tractor Signs - 2026[1].zip");
    expect(container.textContent).toContain("ZIP / archive");
    expect(container.textContent).toContain("Quarantined");

    const downloadButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.getAttribute("aria-label") === "Download Glass Barn Tractor Signs - 2026[1].zip"
    )) as HTMLButtonElement;
    expect(downloadButton).toBeTruthy();
    await act(async () => {
      Simulate.click(downloadButton);
    });
    await waitForCondition(() => (
      apiFetchMock.mock.calls.some(([url]) => String(url) === "/api/inbound-orders/inbound_1/files/file_zip/download")
    ), "quarantined ZIP download uses authenticated fetch");

    const zipCard = Array.from(container.querySelectorAll("[data-testid='source-evidence-file-card']")).find((element) => (
      element.textContent?.includes("Glass Barn Tractor Signs - 2026[1].zip")
    )) as HTMLElement;
    const classifyButton = Array.from(zipCard.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Classify") as HTMLButtonElement;
    act(() => {
      Simulate.click(classifyButton);
    });
    await waitForText("Classify attachment");
    const classificationSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      Array.from(select.options).some((option) => option.value === "ARTWORK")
        && Array.from(select.options).some((option) => option.value === "OTHER")
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(classificationSelect, { target: { value: "ARTWORK" } } as any);
    });
    const saveClassificationButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save classification")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveClassificationButton);
    });
    await waitForCondition(() => getClassificationBody()?.classification === "ARTWORK", "ZIP manual artwork classification saved");

    const artworkSelect = container.querySelector("[data-testid='clean-inline-artwork-select']") as HTMLSelectElement;
    await waitForCondition(() => (
      Array.from(artworkSelect.options).some((option) => option.textContent === "Glass Barn Tractor Signs - 2026[1].zip")
    ), "quarantined ZIP appears as artwork assignment option");
    const zipOption = Array.from(artworkSelect.options).find((option) => option.textContent === "Glass Barn Tractor Signs - 2026[1].zip") as HTMLOptionElement;
    act(() => {
      Simulate.change(artworkSelect, { target: { value: zipOption.value } } as any);
    });
    await waitForText("Artwork linked");
    expect(artworkSelect.value).toBe(zipOption.value);
    expect(Array.from(artworkSelect.options).find((option) => option.value === zipOption.value)?.textContent).toContain("assigned");
    expect(artworkSelect.options[0]?.textContent).not.toContain("No artwork files available");

    const saveDraftButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveDraftButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "quarantined ZIP artwork assignment saved");
    expect(getSavedBody().reviewedLineItemsJson[0].artworkLinks[0]).toMatchObject({
      fileId: "file_zip",
      filename: "Glass Barn Tractor Signs - 2026[1].zip",
      classification: "ARTWORK",
      source: "staff_selected",
    });
  });

  test("shows Email attachment counts and bulk classifies visible attachments with unsafe files skipped", async () => {
    const files = [
      {
        id: "file_reference_1", inboundRecordId: "inbound_1", fileRecordId: "record_reference_1", sourceFilename: "sign-front.pdf", role: "reference", mimeType: "application/pdf", sizeBytes: 1200, status: "available", metadataJson: {}, createdAt: "2026-06-09T12:02:00.000Z", updatedAt: "2026-06-09T12:02:00.000Z",
      },
      {
        id: "file_reference_2", inboundRecordId: "inbound_1", fileRecordId: null, sourceFilename: "sign-back.png", role: "other", mimeType: "image/png", sizeBytes: 900, status: "available", metadataJson: {}, createdAt: "2026-06-09T12:02:00.000Z", updatedAt: "2026-06-09T12:02:00.000Z",
      },
      {
        id: "file_quarantined", inboundRecordId: "inbound_1", fileRecordId: "record_quarantined", sourceFilename: "unsafe.zip", role: "reference", mimeType: "application/zip", sizeBytes: 900, status: "quarantined", metadataJson: { attachmentState: "scan_pending" }, createdAt: "2026-06-09T12:02:00.000Z", updatedAt: "2026-06-09T12:02:00.000Z",
      },
    ];
    const { getBulkClassificationBody } = setupParsedInboundReview({ detailOverrides: { files } });

    renderPage();
    await waitForText("Clean View");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement);
    });
    await waitForText("Source Documents");
    await waitForCondition(() => Boolean(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Email")), "Email source tab rendered");
    const emailTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Email") as HTMLButtonElement;
    act(() => {
      Simulate.click(emailTab);
    });
    await waitForText("Attachments / Evidence (3) · Showing 3");
    const firstAttachmentCard = container.querySelector("[data-testid='source-evidence-file-card']") as HTMLElement;
    expect(firstAttachmentCard.textContent).toContain("Open");
    expect(firstAttachmentCard.textContent).toContain("Download");
    expect(firstAttachmentCard.textContent).toContain("Classify");
    const selectAll = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Select all visible") as HTMLButtonElement;
    expect(selectAll).toBeTruthy();
    act(() => {
      Simulate.click(selectAll);
    });
    await waitForText("3 files selected");
    expect(container.textContent).toContain("will be skipped when classifying as Artwork");
    const bulkArtworkButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Classify as Artwork") as HTMLButtonElement;
    await act(async () => {
      Simulate.click(bulkArtworkButton);
    });
    await waitForCondition(() => Boolean(getBulkClassificationBody()), "bulk artwork classification persisted");
    expect(getBulkClassificationBody()).toEqual({
      fileIds: ["file_reference_1", "file_reference_2", "file_quarantined"],
      classification: "ARTWORK",
    });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Classified 2 files as Artwork",
      description: expect.stringContaining("Reparse required"),
    }));

    const artworkQuantityMode = container.querySelector("select[aria-label='Artwork quantity mode for line item 1']") as HTMLSelectElement;
    act(() => {
      Simulate.change(artworkQuantityMode, { target: { value: "one_each_per_file" } } as any);
    });
    const multiAssignment = container.querySelector("[data-testid='clean-multi-artwork-assignment']") as HTMLElement;
    expect(multiAssignment).toBeTruthy();
    act(() => {
      Simulate.click(multiAssignment.querySelector("summary") as HTMLElement);
    });
    const selectAllArtwork = Array.from(multiAssignment.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Select all available") as HTMLButtonElement;
    act(() => {
      Simulate.click(selectAllArtwork);
    });
    const assignSelectedArtwork = Array.from(multiAssignment.querySelectorAll("button")).find((button) => button.textContent?.includes("Assign selected (2)")) as HTMLButtonElement;
    act(() => {
      Simulate.click(assignSelectedArtwork);
    });
    await waitForText("Artwork linked · 2 files");
    expect((container.querySelector("[data-testid='clean-inline-quantity-input']") as HTMLInputElement).value).toBe("2");
  });

  test("assigns explicit Front and Back artwork for a double-sided review line", async () => {
    const parsed = parsedDraft();
    const review = reviewDraft(parsed);
    review.reviewedLineItemsJson[0].optionSelectionsJson = {
      schemaVersion: 2,
      selected: { sides: { value: "double" } },
    };
    const files = [
      { id: "file_front", inboundRecordId: "inbound_1", fileRecordId: "record_front", sourceFilename: "front.pdf", role: "artwork", mimeType: "application/pdf", sizeBytes: 1200, status: "available", metadataJson: {}, createdAt: "2026-06-09T12:02:00.000Z", updatedAt: "2026-06-09T12:02:00.000Z" },
      { id: "file_back", inboundRecordId: "inbound_1", fileRecordId: "record_back", sourceFilename: "back.pdf", role: "artwork", mimeType: "application/pdf", sizeBytes: 1200, status: "available", metadataJson: {}, createdAt: "2026-06-09T12:02:00.000Z", updatedAt: "2026-06-09T12:02:00.000Z" },
    ];
    const { getSavedBody } = setupParsedInboundReview({ parsed, review, detailOverrides: { files } });

    renderPage();
    await waitForText("Clean View");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement);
    });
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-double-sided-artwork-assignment']")), "double-sided artwork controls rendered");

    const frontSelect = container.querySelector("[data-testid='clean-front-artwork-select']") as HTMLSelectElement;
    const backSelect = container.querySelector("[data-testid='clean-back-artwork-select']") as HTMLSelectElement;
    const frontOption = Array.from(frontSelect.options).find((option) => option.textContent === "front.pdf") as HTMLOptionElement;
    const backOption = Array.from(backSelect.options).find((option) => option.textContent === "back.pdf") as HTMLOptionElement;
    act(() => {
      Simulate.change(frontSelect, { target: { value: frontOption.value } } as any);
    });
    await waitForCondition(() => (
      (container.querySelector("[data-testid='clean-front-artwork-select']") as HTMLSelectElement)?.value === frontOption.value
    ), "Front artwork assignment applied");
    act(() => {
      Simulate.change(container.querySelector("[data-testid='clean-back-artwork-select']") as HTMLSelectElement, { target: { value: backOption.value } } as any);
    });
    await waitForCondition(() => (
      (container.querySelector("[data-testid='clean-back-artwork-select']") as HTMLSelectElement)?.value === backOption.value
    ), "Back artwork assignment applied");

    const saveDraftButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveDraftButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "side assignments saved");
    expect(getSavedBody().reviewedLineItemsJson[0].artworkLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "file_front", assignmentSide: "front" }),
      expect.objectContaining({ fileId: "file_back", assignmentSide: "back" }),
    ]));
  });

  test("lets staff select the same artwork for both sides before assigning the Front file", async () => {
    const parsed = parsedDraft();
    const review = reviewDraft(parsed);
    review.reviewedLineItemsJson[0].optionSelectionsJson = {
      schemaVersion: 2,
      selected: { sides: { value: "double" } },
    };
    const files = [{ id: "file_both", inboundRecordId: "inbound_1", fileRecordId: "record_both", sourceFilename: "same-art.pdf", role: "artwork", mimeType: "application/pdf", sizeBytes: 1200, status: "available", metadataJson: {}, createdAt: "2026-06-09T12:02:00.000Z", updatedAt: "2026-06-09T12:02:00.000Z" }];
    const { getSavedBody } = setupParsedInboundReview({ parsed, review, detailOverrides: { files } });

    renderPage();
    await waitForText("Clean View");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement);
    });
    await waitForCondition(() => Boolean(container.querySelector("[data-testid='clean-use-same-artwork-both-sides']")), "same-artwork control rendered");
    const sameArtworkCheckbox = container.querySelector("[data-testid='clean-use-same-artwork-both-sides']") as HTMLInputElement;
    act(() => {
      Simulate.change(sameArtworkCheckbox, { target: { checked: true } } as any);
    });
    const frontSelect = container.querySelector("[data-testid='clean-front-artwork-select']") as HTMLSelectElement;
    const option = Array.from(frontSelect.options).find((entry) => entry.textContent === "same-art.pdf") as HTMLOptionElement;
    act(() => {
      Simulate.change(frontSelect, { target: { value: option.value } } as any);
    });
    await waitForCondition(() => !container.querySelector("[data-testid='clean-back-artwork-select']"), "Back selector hidden for same-artwork mapping");

    const saveDraftButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveDraftButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "same-artwork assignment saved");
    expect(getSavedBody().reviewedLineItemsJson[0].artworkLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "file_both", assignmentSide: "both" }),
    ]));
  });

  test("shows a Clean View PDF render error instead of a blank viewer", async () => {
    mockPdfGetDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("PDF render failed")),
    }));
    const row = record({
      sourceType: "email",
      rawPayloadJson: {
        sender: { name: "PDF Customer", email: "pdf@example.com" },
        subject: "Broken PDF",
        bodyText: "Please review the attached PO.",
      },
    });
    setupParsedInboundReview({
      row,
      detailOverrides: {
        files: [{
          id: "file_pdf_error",
          inboundRecordId: row.id,
          fileRecordId: "file_record_pdf_error",
          role: "po",
          status: "uploaded",
          sourceFilename: "Broken PO.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          providerAttachmentId: "att_pdf_error",
          reviewNotes: null,
        }],
      },
    });

    renderPage();
    await waitForText("Clean View");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement);
    });
    await waitForText("Broken PO.pdf");
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Open Broken PO.pdf") as HTMLButtonElement;
    await act(async () => {
      Simulate.click(openButton);
    });
    await waitForText("Document Viewer");
    await waitForText("PDF render failed");
    expect(container.querySelector("[data-testid='clean-inline-attachment-viewer']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-inline-attachment-viewer'] iframe")).toBeNull();
  });

  test("clears the Clean View inline attachment viewer when switching records", async () => {
    const first = record({
      id: "inbound_first",
      sourceType: "email",
      rawPayloadJson: {
        sender: { name: "First Customer", email: "first@example.com" },
        subject: "First PO",
        bodyText: "First attached PO.",
      },
    });
    const second = record({
      id: "inbound_second",
      sourceType: "email",
      rawPayloadJson: {
        sender: { name: "Second Customer", email: "second@example.com" },
        subject: "Second PO",
        bodyText: "Second request.",
      },
    });
    const firstFile = {
      id: "file_first_po",
      inboundRecordId: first.id,
      fileRecordId: "file_record_first_po",
      role: "po",
      status: "uploaded",
      sourceFilename: "First PO.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      providerAttachmentId: "att_first",
      reviewNotes: null,
    };
    const parsed = parsedDraft();
    const review = reviewDraft(parsed);
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([first, second]));
      if (path === `/api/inbound-orders/${first.id}`) return jsonResponse({ success: true, data: detail(first, { files: [firstFile] }) });
      if (path === `/api/inbound-orders/${second.id}`) return jsonResponse({ success: true, data: detail(second, { files: [] }) });
      if (path === `/api/inbound-orders/${first.id}/draft-preview` || path === `/api/inbound-orders/${second.id}/draft-preview`) return jsonResponse(draftPreview({ draft: parsed }));
      if (path === `/api/inbound-orders/${first.id}/review-draft` || path === `/api/inbound-orders/${second.id}/review-draft`) return jsonResponse({ success: true, data: review });
      if (path === `/api/inbound-orders/${first.id}/files/${firstFile.id}/download`) return blobResponse("application/pdf");
      if (path === "/api/inbound-orders/customer-search?limit=20") return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/contact-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-options/") && options?.method === "POST") return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Clean View");
    act(() => {
      Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement);
    });
    await waitForText("First PO.pdf");
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Open First PO.pdf") as HTMLButtonElement;
    await act(async () => {
      Simulate.click(openButton);
    });
    await waitForText("Document Viewer");
    expect(container.querySelector("[data-testid='clean-inline-attachment-viewer']")).toBeTruthy();
    const secondRecordButton = Array.from(container.querySelectorAll("[data-testid='clean-inbound-queue'] button")).find((button) => button.textContent?.includes("Second Customer")) as HTMLButtonElement;
    act(() => {
      Simulate.click(secondRecordButton);
    });
    await waitForText("Second Customer");
    await waitForCondition(() => !container.querySelector("[data-testid='clean-inline-attachment-viewer']"), "inline viewer clears after record switch");
  });

  test("filters the Clean View queue by trusted, untrusted, and issue categories", async () => {
    const trusted = record({
      id: "trusted_clean",
      externalReference: "Trusted clean queue item",
      sourceType: "email",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
      senderTrustStatus: "trusted_sender",
      canAutoDownloadAttachments: true,
      attachmentDownloadPolicy: "auto_download_allowed",
      rawPayloadJson: {
        sender: { name: "Trusted Buyer", email: "trusted@example.com" },
        subject: "Trusted clean queue item",
        bodyText: "Trusted customer order.",
      },
      normalizedPayloadJson: {
        inboundIntent: "ORDER_REQUEST",
      },
    });
    const untrusted = record({
      id: "untrusted_clean",
      externalReference: "Untrusted clean queue item",
      sourceType: "email",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
      senderTrustStatus: "untrusted",
      canAutoDownloadAttachments: false,
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: {
        sender: { name: "Untrusted Sender", email: "new@example.net" },
        subject: "Untrusted clean queue item",
        bodyText: "New sender order.",
      },
      normalizedPayloadJson: {
        inboundIntent: "QUOTE_REQUEST",
      },
    });
    const issue = record({
      id: "issue_clean",
      externalReference: "Issue clean queue item",
      sourceType: "email",
      requiresHumanDecision: true,
      reviewRequiredReason: "Artwork needs review.",
      senderTrustStatus: "unknown",
      attachmentDownloadPolicy: "no_attachments",
      rawPayloadJson: {
        sender: { name: "Issue Sender", email: "issue@example.org" },
        subject: "Issue clean queue item",
        bodyText: "Needs artwork decision.",
      },
      normalizedPayloadJson: {
        inboundIntent: "CUSTOMER_COMMUNICATION",
      },
    });
    const rows = [trusted, untrusted, issue];

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse(rows));
      const detailRow = rows.find((row) => path === `/api/inbound-orders/${row.id}`);
      if (detailRow) return jsonResponse({ success: true, data: detail(detailRow) });
      const draftRow = rows.find((row) => path === `/api/inbound-orders/${row.id}/draft-preview`);
      if (draftRow) return jsonResponse(draftPreview());
      const reviewRow = rows.find((row) => path === `/api/inbound-orders/${row.id}/review-draft`);
      if (reviewRow && options?.method !== "PUT") return jsonResponse({ success: true, data: reviewDraft(parsedDraft()) });
      if (path === "/api/inbound-orders/customer-search?limit=20") return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/contact-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-options/") && options?.method === "POST") return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Trusted clean queue item");

    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Source Documents");
    const cleanQueue = container.querySelector("[data-testid='clean-inbound-queue']") as HTMLElement;
    expect(cleanQueue.textContent).toContain("Trusted clean queue item");
    expect(cleanQueue.textContent).toContain("Untrusted clean queue item");
    expect(cleanQueue.textContent).toContain("Issue clean queue item");

    const quickFilters = container.querySelector("[data-testid='clean-queue-quick-filters']") as HTMLElement;
    const [trustedFilter, untrustedFilter, issueFilter] = Array.from(quickFilters.querySelectorAll("input")) as HTMLInputElement[];
    act(() => {
      Simulate.change(untrustedFilter, { target: { checked: true } } as any);
    });
    expect(cleanQueue.textContent).not.toContain("Trusted clean queue item");
    expect(cleanQueue.textContent).toContain("Untrusted clean queue item");
    expect(cleanQueue.textContent).not.toContain("Issue clean queue item");

    act(() => {
      Simulate.change(issueFilter, { target: { checked: true } } as any);
    });
    expect(cleanQueue.textContent).not.toContain("Trusted clean queue item");
    expect(cleanQueue.textContent).toContain("Untrusted clean queue item");
    expect(cleanQueue.textContent).toContain("Issue clean queue item");

    act(() => {
      Simulate.change(untrustedFilter, { target: { checked: false } } as any);
      Simulate.change(issueFilter, { target: { checked: false } } as any);
      Simulate.change(trustedFilter, { target: { checked: true } } as any);
    });
    expect(cleanQueue.textContent).toContain("Trusted clean queue item");
    expect(cleanQueue.textContent).not.toContain("Untrusted clean queue item");
    expect(cleanQueue.textContent).not.toContain("Issue clean queue item");
  });

  test("keeps Clean View Parse and Re-scan loading states independent while hydrating parse results", async () => {
    const row = record({
      id: "clean_parse_1",
      sourceType: "email",
      parsedAt: null,
      rawPayloadJson: {
        sender: { name: "Parse Sender", email: "parse@example.com" },
        subject: "Parse clean queue item",
        bodyText: "Please make two magnets.",
      },
    });
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft, status: "completed" });
    const parseResolvers: Array<(response: any) => void> = [];
    const reprocessResolvers: Array<(response: any) => void> = [];
    const parseRequests: string[] = [];
    const reprocessRequests: string[] = [];
    let refreshFromLatestParseCalled = 0;
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview({ draft, latestAttempt: null }));
      if (path === `/api/inbound-orders/${row.id}/review-draft`) return jsonResponse({ success: true, data: null });
      if (path === `/api/inbound-orders/${row.id}/review-draft/refresh-from-latest-parse` && options?.method === "POST") {
        refreshFromLatestParseCalled += 1;
        return jsonResponse({ success: true, data: reviewDraft(draft) });
      }
      if (path === `/api/inbound-orders/${row.id}/parse` && options?.method === "POST") {
        parseRequests.push(path);
        return new Promise((resolve) => {
          parseResolvers.push(resolve);
        });
      }
      if (path === `/api/inbound-orders/${row.id}/email-reprocess` && options?.method === "POST") {
        reprocessRequests.push(path);
        return new Promise((resolve) => {
          reprocessResolvers.push(resolve);
        });
      }
      if (path === "/api/inbound-orders/customer-search?limit=20") return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/contact-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-options/") && options?.method === "POST") return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Clean View");
      const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
      act(() => {
        Simulate.click(cleanButton);
      });
      await waitForText("Source Documents");

      const cleanSource = container.querySelector("[data-testid='clean-source-documents']") as HTMLElement;
      const buttonByText = (text: string) => Array.from(cleanSource.querySelectorAll("button")).find((button) => (
        button.textContent?.trim() === text
      )) as HTMLButtonElement;
      const parseButton = buttonByText("Parse");
      const rescanButton = buttonByText("Re-scan");
      expect(parseButton).toBeTruthy();
      expect(rescanButton).toBeTruthy();

      act(() => {
        Simulate.click(rescanButton);
      });
      await waitForCondition(() => reprocessRequests.length === 1, "re-scan posts to email reprocess endpoint");
      expect(parseRequests.length).toBe(0);
      expect(rescanButton.querySelector(".animate-spin")).toBeTruthy();
      expect(parseButton.querySelector(".animate-spin")).toBeFalsy();
      await act(async () => {
        reprocessResolvers.shift()?.(jsonResponse({
          success: true,
          data: {
            result: {
              action: "reprocess_email",
              inboundRecordId: row.id,
              providerMessageId: "gmail_msg_1",
              providerThreadId: "thread_1",
              threadMessagesInspected: 1,
              latestThreadActivity: "2026-06-09T12:02:00.000Z",
              candidatesFound: 1,
              attempted: 1,
              stored: 0,
              metadataOnly: 0,
              failed: 0,
              skipped: 1,
              diagnosticsByMessage: [],
            },
            inbound: detail({ ...row, parsedAt: null }),
          },
        }));
      });
      await waitForCondition(() => !rescanButton.querySelector(".animate-spin"), "re-scan finishes independently");
      expect(refreshFromLatestParseCalled).toBe(0);

      act(() => {
        Simulate.click(parseButton);
      });
      await waitForCondition(() => parseRequests.length === 1, "parse posts to parse endpoint");
      expect(parseButton.querySelector(".animate-spin")).toBeTruthy();
      expect(rescanButton.querySelector(".animate-spin")).toBeFalsy();
      await act(async () => {
        parseResolvers.shift()?.(jsonResponse({
          success: true,
          data: {
            record: { ...row, parsedAt: "2026-06-09T12:03:00.000Z" },
            draft,
            latestAttempt: attempt,
            reviewDraft: reviewDraft(draft),
          },
        }));
      });
      await waitForCondition(() => !parseButton.querySelector(".animate-spin"), "parse finishes independently");
      expect(refreshFromLatestParseCalled).toBe(0);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("runs Clean View bulk actions against the visible filtered queue selection", async () => {
    const trusted = record({
      id: "trusted_bulk_clean",
      externalReference: "Trusted bulk clean item",
      sourceType: "email",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
      senderTrustStatus: "trusted_sender",
      attachmentDownloadPolicy: "auto_download_allowed",
      rawPayloadJson: {
        sender: { name: "Trusted Bulk", email: "trusted-bulk@example.com" },
        subject: "Trusted bulk clean item",
      },
    });
    const untrusted = record({
      id: "untrusted_bulk_clean",
      externalReference: "Untrusted bulk clean item",
      sourceType: "email",
      requiresHumanDecision: false,
      reviewRequiredReason: null,
      senderTrustStatus: "untrusted",
      attachmentDownloadPolicy: "pending_trust",
      rawPayloadJson: {
        sender: { name: "Untrusted Bulk", email: "untrusted-bulk@example.net" },
        subject: "Untrusted bulk clean item",
      },
    });
    const rows = [trusted, untrusted];
    let bulkBody: any = null;
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("clean bulk note");

    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse(rows));
      const detailRow = rows.find((row) => path === `/api/inbound-orders/${row.id}`);
      if (detailRow) return jsonResponse({ success: true, data: detail(detailRow) });
      const draftRow = rows.find((row) => path === `/api/inbound-orders/${row.id}/draft-preview`);
      if (draftRow) return jsonResponse(draftPreview());
      const reviewRow = rows.find((row) => path === `/api/inbound-orders/${row.id}/review-draft`);
      if (reviewRow && options?.method !== "PUT") return jsonResponse({ success: true, data: reviewDraft(parsedDraft()) });
      if (path === "/api/inbound-orders/bulk-action" && options?.method === "POST") {
        bulkBody = JSON.parse(options.body);
        return jsonResponse({ success: true, data: { updatedIds: bulkBody.recordIds, errors: [] } });
      }
      if (path === "/api/inbound-orders/customer-search?limit=20") return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/contact-search?")) return jsonResponse({ success: true, data: [] });
      if (path.startsWith("/api/inbound-orders/product-options/") && options?.method === "POST") return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    try {
      renderPage();
      await waitForText("Clean View");
      const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
      act(() => {
        Simulate.click(cleanButton);
      });
      await waitForText("Source Documents");

      const cleanQueue = container.querySelector("[data-testid='clean-inbound-queue']") as HTMLElement;
      const quickFilters = container.querySelector("[data-testid='clean-queue-quick-filters']") as HTMLElement;
      const [, untrustedFilter] = Array.from(quickFilters.querySelectorAll("input")) as HTMLInputElement[];
      act(() => {
        Simulate.change(untrustedFilter, { target: { checked: true } } as any);
      });
      expect(cleanQueue.textContent).not.toContain("Trusted bulk clean item");
      expect(cleanQueue.textContent).toContain("Untrusted bulk clean item");

      const selectVisible = cleanQueue.querySelector("input[aria-label='Select all visible Clean View queue records']") as HTMLInputElement;
      act(() => {
        Simulate.change(selectVisible, { target: { checked: true } } as any);
      });
      await waitForText("1 selected");
      const ignoreOnceButton = Array.from(cleanQueue.querySelectorAll("button")).find((button) => button.textContent?.includes("Ignore Once")) as HTMLButtonElement;
      await act(async () => {
        Simulate.click(ignoreOnceButton);
      });
      await waitForCondition(() => Boolean(bulkBody), "clean bulk action submitted");
      expect(bulkBody).toMatchObject({
        action: "ignore_once",
        note: "clean bulk note",
        recordIds: ["untrusted_bulk_clean"],
      });
    } finally {
      promptSpy.mockRestore();
    }
  });

  test("updates Clean View completion checklist as line item fields are resolved", async () => {
    const baseParsed = parsedDraft();
    const cleanParsed = parsedDraft({
      lineItems: [{
        ...baseParsed.lineItems[0],
        productName: "Magnets",
        quantity: null,
        width: 12,
        height: 12,
        dimensionsUnit: "in",
      }],
      missingDecisions: [{
        field: "lineItems.0.quantity",
        label: "What quantity is needed?",
        reason: "No clear quantity was detected for this line item.",
        severity: "blocking",
      }],
      globalWarnings: [],
    });
    const cleanReview = reviewDraft(cleanParsed);
    cleanReview.reviewedLineItemsJson[0].quantity = null;
    cleanReview.reviewedLineItemsJson[0].quantitySource = null;
    setupParsedInboundReview({ parsed: cleanParsed, review: cleanReview });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Blocking Decisions");
    const quantityChecklistItem = () => container.querySelector("[data-clean-checklist-item='Quantity confirmed']");
    expect(quantityChecklistItem()?.getAttribute("data-complete")).toBe("false");
    expect(container.textContent).toContain("What quantity is needed?");
    expect(container.querySelector("[data-testid='clean-ticket-details']")).toBeNull();
    const inlineQuantityInput = container.querySelector("[data-testid='clean-inline-quantity-input']") as HTMLInputElement;
    expect(inlineQuantityInput).toBeTruthy();
    act(() => {
      Simulate.click(quantityChecklistItem() as Element);
    });
    await waitForCondition(() => (
      document.activeElement === inlineQuantityInput
        || container.querySelector("[data-clean-resolution-target='quantity']")?.getAttribute("data-highlighted") === "true"
    ), "quantity checklist focuses inline quantity input");

    act(() => {
      Simulate.change(inlineQuantityInput, { target: { value: "2" } } as any);
    });
    expect(quantityChecklistItem()?.getAttribute("data-complete")).toBe("true");
    expect(container.textContent).not.toContain("What quantity is needed?");
  });

  test("clears a stale Clean View size decision when staff enters valid dimensions", async () => {
    const baseParsed = parsedDraft();
    const cleanParsed = parsedDraft({
      lineItems: [{
        ...baseParsed.lineItems[0],
        width: null,
        height: null,
        dimensionsUnit: "in",
      }],
      missingDecisions: [{
        field: "lineItems.0.dimensions",
        label: "What size stickers are needed?",
        reason: "No clear dimensions were detected for this line item.",
        severity: "blocking",
      }],
      globalWarnings: [],
    });
    const cleanReview = reviewDraft(cleanParsed);
    cleanReview.reviewedLineItemsJson[0].width = null;
    cleanReview.reviewedLineItemsJson[0].height = null;
    cleanReview.reviewedLineItemsJson[0].dimensionsSource = null;
    setupParsedInboundReview({ parsed: cleanParsed, review: cleanReview });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Blocking Decisions");
    expect(container.textContent).toContain("What size stickers are needed?");
    const widthInput = container.querySelector("input[aria-label='Width']") as HTMLInputElement;
    const heightInput = container.querySelector("input[aria-label='Height']") as HTMLInputElement;
    expect(widthInput).toBeTruthy();
    expect(heightInput).toBeTruthy();

    act(() => {
      Simulate.change(widthInput, { target: { value: "21" } } as any);
    });
    await waitForCondition(() => widthInput.value === "21", "Clean View width update");
    act(() => {
      Simulate.change(heightInput, { target: { value: "13" } } as any);
    });

    expect(container.querySelector("[data-testid='clean-size-workflow']")?.textContent).toContain("Done");
    expect(container.textContent).not.toContain("What size stickers are needed?");
  });

  test("shows a detected PDF page size and applies it to an empty inbound line item", async () => {
    const baseParsed = parsedDraft();
    const pdfArtwork = {
      id: "file_detected_pdf",
      fileRecordId: "canonical_detected_pdf",
      sourceFilename: "decals.pdf",
      role: "artwork",
      mimeType: "application/pdf",
      sizeBytes: 2200,
      status: "available",
      metadataJson: {
        pdfSizeAnalysis: {
          status: "succeeded",
          analyzedAt: "2026-07-27T12:00:00.000Z",
          fileIdentity: "canonical_detected_pdf:checksum:2200",
          pageCount: 1,
          pages: [{ pageNumber: 1, widthInches: 7.25, heightInches: 3.5, rotation: 0, sourceBox: "MediaBox" }],
          uniformPageSize: true,
          effectiveWidthInches: 7.25,
          effectiveHeightInches: 3.5,
          units: "in",
          errorCode: null,
        },
      },
    };
    const cleanParsed = parsedDraft({
      lineItems: [{ ...baseParsed.lineItems[0], width: null, height: null, dimensionsUnit: "in", artworkLinks: [{ fileId: pdfArtwork.id, fileRecordId: pdfArtwork.fileRecordId, filename: pdfArtwork.sourceFilename, mimeType: pdfArtwork.mimeType, role: "artwork", source: "staff_selected", assignmentSide: "unassigned" }] }],
      globalWarnings: [],
    });
    const cleanReview = reviewDraft(cleanParsed);
    setupParsedInboundReview({ parsed: cleanParsed, review: cleanReview, detailOverrides: { files: [pdfArtwork] } });

    renderPage();
    await waitForText("Operational View");
    act(() => { Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement); });
    await waitForText("Use for line item");
    expect(container.textContent).toContain("Detected PDF size: 7.25 × 3.5 in");
    act(() => { Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Use for line item")) as HTMLButtonElement); });
    expect((container.querySelector("input[aria-label='Width']") as HTMLInputElement).value).toBe("7.25");
    expect((container.querySelector("input[aria-label='Height']") as HTMLInputElement).value).toBe("3.5");
  });

  test("does not flag an entered feet size when an assigned PDF is physically equivalent after rotation", async () => {
    const baseParsed = parsedDraft();
    const pdfArtwork = {
      id: "file_equivalent_pdf",
      fileRecordId: "canonical_equivalent_pdf",
      sourceFilename: "banner.pdf",
      role: "artwork",
      mimeType: "application/pdf",
      sizeBytes: 2200,
      status: "available",
      metadataJson: {
        pdfSizeAnalysis: {
          status: "succeeded",
          analyzedAt: "2026-07-27T12:00:00.000Z",
          fileIdentity: "canonical_equivalent_pdf:checksum:2200",
          pageCount: 1,
          pages: [{ pageNumber: 1, widthInches: 96, heightInches: 36, rotation: 0, sourceBox: "MediaBox" }],
          uniformPageSize: true,
          effectiveWidthInches: 96,
          effectiveHeightInches: 36,
          units: "in",
          errorCode: null,
        },
      },
    };
    const cleanParsed = parsedDraft({
      lineItems: [{ ...baseParsed.lineItems[0], width: 3, height: 8, dimensionsUnit: "ft", artworkLinks: [{ fileId: pdfArtwork.id, fileRecordId: pdfArtwork.fileRecordId, filename: pdfArtwork.sourceFilename, mimeType: pdfArtwork.mimeType, role: "artwork", source: "staff_selected", assignmentSide: "unassigned" }] }],
      globalWarnings: [],
    });
    setupParsedInboundReview({ parsed: cleanParsed, review: reviewDraft(cleanParsed), detailOverrides: { files: [pdfArtwork] } });

    renderPage();
    await waitForText("Operational View");
    act(() => { Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement); });
    await waitForText("Detected size: 96 × 36 in");
    expect(container.textContent).not.toContain("Entered size differs; not changed.");
  });

  test("continues to flag a genuinely different entered size from an assigned PDF", async () => {
    const baseParsed = parsedDraft();
    const pdfArtwork = {
      id: "file_mismatched_pdf",
      fileRecordId: "canonical_mismatched_pdf",
      sourceFilename: "banner.pdf",
      role: "artwork",
      mimeType: "application/pdf",
      sizeBytes: 2200,
      status: "available",
      metadataJson: {
        pdfSizeAnalysis: {
          status: "succeeded",
          analyzedAt: "2026-07-27T12:00:00.000Z",
          fileIdentity: "canonical_mismatched_pdf:checksum:2200",
          pageCount: 1,
          pages: [{ pageNumber: 1, widthInches: 96, heightInches: 36, rotation: 0, sourceBox: "MediaBox" }],
          uniformPageSize: true,
          effectiveWidthInches: 96,
          effectiveHeightInches: 36,
          units: "in",
          errorCode: null,
        },
      },
    };
    const cleanParsed = parsedDraft({
      lineItems: [{ ...baseParsed.lineItems[0], width: 4, height: 8, dimensionsUnit: "ft", artworkLinks: [{ fileId: pdfArtwork.id, fileRecordId: pdfArtwork.fileRecordId, filename: pdfArtwork.sourceFilename, mimeType: pdfArtwork.mimeType, role: "artwork", source: "staff_selected", assignmentSide: "unassigned" }] }],
      globalWarnings: [],
    });
    setupParsedInboundReview({ parsed: cleanParsed, review: reviewDraft(cleanParsed), detailOverrides: { files: [pdfArtwork] } });

    renderPage();
    await waitForText("Operational View");
    act(() => { Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement); });
    await waitForText("Entered size differs; not changed.");
  });

  test("collapses a completed Clean View line item into a compact summary", async () => {
    const baseParsed = parsedDraft();
    const cleanParsed = parsedDraft({
      lineItems: [{
        ...baseParsed.lineItems[0],
        sourceText: "two magnets 12 x 12",
        productName: "Magnets",
        quantity: 2,
        width: 12,
        height: 12,
        dimensionsUnit: "in",
        optionSelectionsJson: {
          schemaVersion: 2,
          selected: {
            thickness: { value: "30mil", note: "Staff selected", origin: "USER_SELECTED", evidence: null },
          },
        },
        pbv2TreeVersionId: "tree_magnets",
        artworkLinks: [{
          fileId: "file_art",
          filename: "Lindsay X2.pdf",
          role: "artwork",
          source: "staff_selected",
          confidence: 100,
        }],
      }],
      missingDecisions: [],
      globalWarnings: [],
    });
    const cleanReview = reviewDraft(cleanParsed);
    Object.assign(cleanReview.reviewedLineItemsJson[0], {
      selectedProductId: "product_magnets",
      selectedProductSource: "staff_selected",
      productUnresolved: false,
    });
    setupParsedInboundReview({ parsed: cleanParsed, review: cleanReview });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Line Item 1");
    const lineItemCard = container.querySelector("[data-testid='clean-line-item-card']") as HTMLElement;
    expect(lineItemCard).toBeTruthy();
    expect(lineItemCard.getAttribute("data-workflow-complete")).toBe("true");
    expect(container.querySelector("[data-testid='clean-line-item-decision-strip']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-line-item-header-summary']")?.textContent).toContain("Magnets");
    expect(container.querySelector("[data-testid='clean-line-item-header-summary']")?.textContent).toContain("Qty 2");
    expect(container.querySelector("[data-testid='clean-line-item-collapsed-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='clean-quantity-workflow']")).toBeNull();
    expect(container.querySelector("[data-testid='clean-size-workflow']")).toBeNull();
    expect(container.querySelector("[data-testid='clean-dynamic-product-options']")).toBeNull();

    const editButton = Array.from(lineItemCard.querySelectorAll("button")).find((button) => button.textContent?.includes("Edit line item")) as HTMLButtonElement;
    act(() => {
      Simulate.click(editButton);
    });
    expect(container.querySelector("[data-testid='clean-quantity-workflow']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-size-workflow']")).toBeTruthy();
    expect(container.querySelector("[data-testid='clean-dynamic-product-options']")).toBeTruthy();
  });

  test("Clean View exposes line item add, duplicate, remove, and split controls", async () => {
    const baseParsed = parsedDraft();
    const cleanParsed = parsedDraft({
      lineItems: [{
        ...baseParsed.lineItems[0],
        sourceText: "One banner is 2' x 10'. The other banner is 30\" x 60\". All with hems and grommets, just one each.",
        productName: "Banner",
        quantity: 2,
        width: 24,
        height: 120,
        dimensionsUnit: "in",
        optionTexts: ["hems", "grommets"],
        finishingTexts: ["hems", "grommets"],
      }],
      missingDecisions: [],
      globalWarnings: [],
    });
    const cleanReview = reviewDraft(cleanParsed);
    cleanReview.missingDecisionsJson.push({
      field: "lineItems.1.artwork",
      label: "Is artwork supplied for line item 2?",
      reason: "The parser split a second line item that staff removed.",
      severity: "blocking",
      status: "still_blocking",
      resolutionNote: null,
    });
    const { getSavedBody } = setupParsedInboundReview({ parsed: cleanParsed, review: cleanReview });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Line Items");
    const cards = () => Array.from(container.querySelectorAll("[data-testid='clean-line-item-card']"));
    expect(cards()).toHaveLength(1);

    const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add line item")) as HTMLButtonElement;
    act(() => {
      Simulate.click(addButton);
    });
    expect(cards()).toHaveLength(2);

    let secondRemove = Array.from((cards()[1] as HTMLElement).querySelectorAll("button")).find((button) => button.textContent?.includes("Remove")) as HTMLButtonElement;
    act(() => {
      Simulate.click(secondRemove);
    });
    expect(cards()).toHaveLength(1);

    const duplicateButton = Array.from((cards()[0] as HTMLElement).querySelectorAll("button")).find((button) => button.textContent?.includes("Duplicate")) as HTMLButtonElement;
    act(() => {
      Simulate.click(duplicateButton);
    });
    expect(cards()).toHaveLength(2);

    secondRemove = Array.from((cards()[1] as HTMLElement).querySelectorAll("button")).find((button) => button.textContent?.includes("Remove")) as HTMLButtonElement;
    act(() => {
      Simulate.click(secondRemove);
    });
    expect(cards()).toHaveLength(1);

    const splitButton = Array.from((cards()[0] as HTMLElement).querySelectorAll("button")).find((button) => button.textContent?.includes("Split")) as HTMLButtonElement;
    act(() => {
      Simulate.click(splitButton);
    });
    expect(cards()).toHaveLength(2);

    const quantityInputs = Array.from(container.querySelectorAll("[data-testid='clean-inline-quantity-input']")) as HTMLInputElement[];
    expect(quantityInputs.map((input) => input.value)).toEqual(["1", "1"]);

    const saveDraftButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveDraftButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "split line items saved");
    expect(getSavedBody().reviewedLineItemsJson).toHaveLength(2);
    expect(getSavedBody().reviewedLineItemsJson.map((lineItem: any) => lineItem.quantity)).toEqual([1, 1]);
    expect(getSavedBody().reviewedLineItemsJson[0]).not.toBe(getSavedBody().reviewedLineItemsJson[1]);
    expect(getSavedBody().missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "lineItems.1.artwork",
        status: "resolved",
        resolutionNote: "Obsolete: reviewed line item was removed.",
      }),
    ]));
  });

  test("Clean View reindexes active-line decisions when the first line is removed", async () => {
    const cleanParsed = parsedDraft({ missingDecisions: [], globalWarnings: [] });
    const cleanReview = reviewDraft(cleanParsed);
    cleanReview.missingDecisionsJson.push({
      field: "lineItems.1.artwork",
      label: "Is artwork supplied for line item 2?",
      reason: "The remaining line still needs artwork.",
      severity: "blocking",
      status: "still_blocking",
      resolutionNote: null,
    });
    const { getSavedBody } = setupParsedInboundReview({ parsed: cleanParsed, review: cleanReview });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });
    await waitForText("Line Items");

    const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add line item")) as HTMLButtonElement;
    act(() => {
      Simulate.click(addButton);
    });
    const cards = () => Array.from(container.querySelectorAll("[data-testid='clean-line-item-card']")) as HTMLElement[];
    expect(cards()).toHaveLength(2);
    const firstRemove = Array.from(cards()[0].querySelectorAll("button")).find((button) => button.textContent?.includes("Remove")) as HTMLButtonElement;
    act(() => {
      Simulate.click(firstRemove);
    });
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain("Line Item 1");

    const saveDraftButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveDraftButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "reindexed draft saved");
    expect(getSavedBody().missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "lineItems.0.artwork",
        label: "Is artwork supplied for line item 1?",
        status: "still_blocking",
      }),
    ]));
  });

  test("groups Clean View review tasks into operator-facing categories", async () => {
    const cleanParsed = parsedDraft({
      missingDecisions: [{
        field: "lineItems.0.productName",
        label: "productName",
        reason: "lineItems.0.productName is missing.",
        severity: "blocking",
      }],
      globalWarnings: [{
        code: "requestedDueDate_missing",
        message: "requestedDueDate was not found.",
        severity: "info",
        fieldPath: "order.requestedDueDate",
      }],
      evidence: {
        items: [],
        conflicts: [{
          code: "evidence_quantity_conflict",
          message: "lineItems.0.quantity differs between the purchase order and email.",
          severity: "warning",
          fieldPath: "lineItems.0.quantity",
        }],
      },
      unsupportedRequests: [{
        type: "UNSUPPORTED_REQUEST",
        requestedText: "grommets in the corners",
        category: "grommets",
        matchedProduct: "PVC",
        reason: "No compatible PBV2 option found.",
        severity: "review_required",
        suggestedAction: "Add manually or select a different product.",
      }],
    });
    setupParsedInboundReview({ parsed: cleanParsed });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });

    await waitForText("Review Tasks");
    const reviewTasks = container.querySelector("[data-testid='clean-review-tasks']") as HTMLElement;
    expect(reviewTasks).toBeTruthy();
    const reviewText = reviewTasks.textContent ?? "";
    expect(reviewText).toContain("Blocking Decisions");
    expect(reviewText).toContain("Evidence Conflicts");
    expect(reviewText).toContain("AI Suggestions");
    expect(reviewText).toContain("Information");
    expect(reviewText.indexOf("Blocking Decisions")).toBeLessThan(reviewText.indexOf("Evidence Conflicts"));
    expect(reviewText.indexOf("Evidence Conflicts")).toBeLessThan(reviewText.indexOf("AI Suggestions"));
    expect(reviewText.indexOf("AI Suggestions")).toBeLessThan(reviewText.indexOf("Information"));
    expect(reviewText).toContain("Product not selected");
    expect(reviewText).toContain("1 conflict");
    expect(reviewText).toContain("The quantity in the purchase order differs from the email.");
    expect(reviewText).toContain("Review manually or select a different product.");
    expect(reviewText).not.toContain("lineItems");
    expect(reviewText).not.toContain("productName");
    expect(reviewText).not.toContain("requestedDueDate");
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
    await waitForText("Source Documents");
    await waitForText("Please quote 3 aluminum signs, 24x36.");
    expect(container.textContent).toContain("Text");
  });

  test("backfills attachments from the operational email toolbar", async () => {
    const row = record({
      id: "inbound_email_1",
      sourceType: "email",
      sourceLabel: "TEMP_INBOUND email intake",
      sourceRecordId: "gmail_msg_1",
      sourceMessageId: "gmail_msg_1",
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        provider: "gmail",
        messageId: "gmail_msg_1",
        threadId: "thread_1",
        sender: { name: "Shawn Fears", email: "shawn@brainstormprint.com" },
        subject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
        bodyText: "Please see attached PO.",
        thread: {
          id: "thread_1",
          messageCount: 2,
          latestActivityAt: "2026-06-19T14:00:00.000Z",
          messages: [
            {
              messageId: "gmail_msg_1",
              subject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
              senderName: "Shawn Fears",
              senderEmail: "shawn@brainstormprint.com",
              receivedAt: "2026-06-19T13:00:00.000Z",
              attachmentCount: 1,
            },
            {
              messageId: "gmail_msg_2",
              subject: "Re: Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
              senderName: "Shawn Fears",
              senderEmail: "shawn@brainstormprint.com",
              receivedAt: "2026-06-19T14:00:00.000Z",
              attachmentCount: 1,
            },
          ],
        },
      },
      normalizedPayloadJson: {
        source: { type: "email", provider: "gmail", messageId: "gmail_msg_1", threadId: "thread_1" },
      },
      senderTrustStatus: "trusted_domain",
      trustReason: "Sender matched inbound trust rule sender_domain.",
      canAutoDownloadAttachments: true,
      attachmentDownloadPolicy: "auto_download_allowed",
      externalReference: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
    });
    let reprocessBody: any = null;
    apiFetchMock.mockImplementation(async (url: any, options?: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview({ draft: parsedDraft(), latestAttempt: null }));
      if (path === `/api/inbound-orders/${row.id}/review-draft`) return jsonResponse({ success: true, data: reviewDraft(parsedDraft()) });
      if (path === `/api/inbound-orders/${row.id}/email-reprocess`) {
        reprocessBody = JSON.parse(options.body);
        return jsonResponse({
          success: true,
          data: {
            result: {
              action: "backfill_attachments",
              inboundRecordId: row.id,
              providerMessageId: "gmail_msg_1",
              providerThreadId: "thread_1",
              threadMessagesInspected: 2,
              latestThreadActivity: "2026-06-19T14:00:00.000Z",
              candidatesFound: 2,
              attempted: 2,
              stored: 1,
              metadataOnly: 1,
              failed: 0,
              skipped: 0,
            },
            inbound: detail(row, {
              files: [{
                id: "file_1",
                inboundRecordId: row.id,
                sourceFilename: "po.pdf",
                role: "po",
                status: "available",
                fileRecordId: "file_record_1",
                providerAttachmentId: "att_1",
                providerMessageId: "gmail_msg_1",
                mimeType: "application/pdf",
                sizeBytes: 4,
                metadataJson: { attachmentState: "downloaded" },
              }],
            }),
          },
        });
      }
      if (path.startsWith("/api/inbound-orders/customer-search")
        || path.startsWith("/api/inbound-orders/contact-search")
        || path.startsWith("/api/inbound-orders/product-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      if (path.startsWith("/api/inbound-orders/product-options/")) return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();

    await waitForText("Backfill Attachments");
    await waitForText("Thread messages: 2");
    await waitForText("Thread messages: 2");
    expect(container.textContent).not.toContain("Thread Timeline");
    const historyTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "History") as HTMLButtonElement;
    act(() => {
      Simulate.click(historyTab);
    });
    await waitForText("Thread Timeline");
    await waitForText("Message 2");
    const backfillButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Backfill Attachments")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(backfillButton);
    });

    await waitForCondition(() => reprocessBody?.action === "backfill_attachments", "email reprocess body");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Attachments backfilled",
      description: expect.stringContaining("Candidates 2, attempted 2, stored 1, metadata-only 1"),
    }));
  });

  test("renders Gmail thread messages separately and collapses inline signature images", async () => {
    const row = record({
      id: "thread_display_1",
      sourceType: "email",
      sourceLabel: "TEMP_INBOUND email thread intake",
      sourceRecordId: "gmail_msg_latest",
      sourceMessageId: "gmail_msg_latest",
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        provider: "gmail",
        messageId: "gmail_msg_latest",
        threadId: "thread_brainstorm",
        sender: { name: "Shawn Fears", email: "shawn@brainstormprint.com" },
        subject: "Re: Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
        bodyText: "Artwork attached.\n\n--- Thread message ---\n\nPlease see attached PO.",
        thread: {
          id: "thread_brainstorm",
          messageCount: 2,
          latestActivityAt: "2026-06-19T14:00:00.000Z",
          messages: [
            {
              messageId: "gmail_msg_po",
              subject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
              displaySubject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
              senderName: "Shawn Fears",
              senderEmail: "shawn@brainstormprint.com",
              to: ["orders@titan-graphics.com"],
              cc: [],
              receivedAt: "2026-06-19T13:00:00.000Z",
              bodyText: "Please see attached PO.",
              attachmentCount: 2,
            },
            {
              messageId: "gmail_msg_latest",
              subject: "Re: Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
              displaySubject: "Re: Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
              senderName: "Shawn Fears",
              senderEmail: "shawn@brainstormprint.com",
              to: ["orders@titan-graphics.com"],
              cc: ["csr@brainstormprint.com"],
              receivedAt: "2026-06-19T14:00:00.000Z",
              bodyText: "Artwork attached.\n\nOn Jun 19, 2026, Titan wrote:\n> Please send files.",
              attachmentCount: 2,
            },
          ],
        },
      },
      normalizedPayloadJson: {
        source: { type: "email", provider: "gmail", messageId: "gmail_msg_latest", threadId: "thread_brainstorm" },
      },
      senderTrustStatus: "trusted_contact",
      trustReason: "Sender matched known contact email.",
      canAutoDownloadAttachments: true,
      attachmentDownloadPolicy: "auto_download_allowed",
      externalReference: "Re: Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
    });
    const draft = parsedDraft({
      evidence: {
        items: [{
          type: "PDF_ATTACHMENT",
          label: "Purchase Order 151534.pdf",
          sourceId: "file_po",
          fileName: "Purchase Order 151534.pdf",
          mimeType: "application/pdf",
          rawText: "Purchase Order No 151534\nQty 10 Yard Signs",
          pageCount: 1,
          documentType: "purchase_order",
          documentConfidence: 98,
          extractionStatus: "successful",
          poSummary: {
            poNumber: "151534",
            customer: "Brainstorm Print",
            contact: "Shawn Fears",
            dueDate: "2026-06-19",
            quantity: 10,
            productDescription: "Yard Signs",
            material: "Coroplast",
            dimensions: "24x18",
            printSpecs: [],
            shippingNotes: null,
            price: null,
            versionCount: null,
            dateCandidates: [],
            fieldSources: {},
          },
          warnings: [],
        }],
        conflicts: [],
      },
    });
    const files = [
      {
        id: "file_po",
        inboundRecordId: row.id,
        sourceFilename: "Purchase Order 151534.pdf",
        role: "po",
        status: "available",
        fileRecordId: "file_record_po",
        providerAttachmentId: "att_po",
        providerMessageId: "gmail_msg_po",
        mimeType: "application/pdf",
        sizeBytes: 120000,
        contentDisposition: "attachment",
        metadataJson: { attachmentState: "downloaded" },
      },
      {
        id: "file_logo_1",
        inboundRecordId: row.id,
        sourceFilename: "image001.gif",
        role: "email_attachment",
        status: "available",
        fileRecordId: "file_record_logo_1",
        providerAttachmentId: "att_logo_1",
        providerMessageId: "gmail_msg_po",
        mimeType: "image/gif",
        sizeBytes: 2345,
        contentDisposition: "inline",
        metadataJson: { attachmentState: "downloaded", contentId: "logo@example" },
      },
      {
        id: "file_art",
        inboundRecordId: row.id,
        sourceFilename: "yard-sign-art.pdf",
        role: "artwork",
        status: "available",
        fileRecordId: "file_record_art",
        providerAttachmentId: "att_art",
        providerMessageId: "gmail_msg_latest",
        mimeType: "application/pdf",
        sizeBytes: 320000,
        contentDisposition: "attachment",
        metadataJson: { attachmentState: "downloaded" },
      },
      {
        id: "file_logo_2",
        inboundRecordId: row.id,
        sourceFilename: "image001.gif",
        role: "email_attachment",
        status: "available",
        fileRecordId: "file_record_logo_2",
        providerAttachmentId: "att_logo_2",
        providerMessageId: "gmail_msg_latest",
        mimeType: "image/gif",
        sizeBytes: 2345,
        contentDisposition: "inline",
        metadataJson: { attachmentState: "downloaded", contentId: "logo@example" },
      },
    ];

    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === `/api/inbound-orders/${row.id}`) return jsonResponse({ success: true, data: detail(row, { files }) });
      if (path === `/api/inbound-orders/${row.id}/draft-preview`) return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      if (path === `/api/inbound-orders/${row.id}/review-draft`) return jsonResponse({ success: true, data: reviewDraft(draft) });
      if (path.startsWith("/api/inbound-orders/customer-search")
        || path.startsWith("/api/inbound-orders/contact-search")
        || path.startsWith("/api/inbound-orders/product-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      if (path.startsWith("/api/inbound-orders/product-options/")) return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();

    await waitForText("Source Documents");
    await waitForText("Artwork attached.");
    expect(container.querySelector("[data-testid='source-document-viewer']")).toBeTruthy();
    expect(container.textContent).not.toContain("Thread Timeline");
    expect(container.textContent).not.toContain("Expand previous messages (1)");
    expect(container.textContent).not.toContain("Please see attached PO.");
    expect(container.textContent).toContain("Quoted content in this message");
    expect(container.textContent).not.toContain("Signature/inline images");
    expect(container.textContent).toContain("Purchase Order 151534.pdf");
    expect(container.textContent).toContain("PO candidate");
    expect(container.textContent).toContain("yard-sign-art.pdf");
    expect(container.textContent).toContain("Artwork candidate");
    expect(container.textContent).not.toContain("Evidence Used");

    const poTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "PO") as HTMLButtonElement;
    act(() => {
      Simulate.click(poTab);
    });
    await waitForText("PO Documents");
    await waitForText("PO Extraction Summary");
    expect(container.textContent).toContain("151534");
    expect(container.textContent).toContain("Yard Signs");
    expect(container.textContent).toContain("Confidence: 98%");

    const artworkTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Artwork") as HTMLButtonElement;
    act(() => {
      Simulate.click(artworkTab);
    });
    await waitForText("Artwork Files");
    await waitForText("Junk / Signature Images");
    expect(container.textContent).toContain("Manual reclassification controls are preserved");

    const historyTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "History") as HTMLButtonElement;
    act(() => {
      Simulate.click(historyTab);
    });
    await waitForText("Thread Timeline");
    expect(container.textContent).toContain("Message 1");
    expect(container.textContent).toContain("Message 2");
    expect(container.textContent).toContain("Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26");
  });

  test("Clean View PO summary displays product resolved from PO material evidence", async () => {
    const parsed = parsedDraft({
      lineItems: [{
        sourceText: "Foam Core Sign\nStock: 3/16\" Foam Core\nFinal Trim: 24 x 36\nQTY: 1",
        productName: "Foam Core Sign",
        quantity: 1,
        width: 24,
        height: 36,
        dimensionsUnit: "in",
        materialText: "3/16\" Foam Core",
        productCandidates: [{
          id: "product_foam",
          label: "Foam Board",
          confidence: 95,
          reason: "AI Parsing Description matched foam core material evidence.",
        }],
        candidateProductIds: ["product_foam"],
      }],
      evidence: {
        items: [{
          type: "PDF_ATTACHMENT",
          label: "Foam Core PO.pdf",
          sourceId: "file_po_foam",
          fileName: "Foam Core PO.pdf",
          mimeType: "application/pdf",
          rawText: "Foam Core Sign\nStock: 3/16\" Foam Core\nFinal Trim: 24 x 36\nQTY: 1",
          pageCount: 1,
          documentType: "purchase_order",
          documentConfidence: 96,
          extractionStatus: "successful",
          poSummary: {
            poNumber: "151900",
            customer: "Brainstorm Print",
            contact: "Shawn Fears",
            dueDate: null,
            quantity: 1,
            productDescription: null,
            material: "3/16\" Foam Core",
            dimensions: "24 x 36",
            printSpecs: [],
            shippingNotes: null,
            price: null,
            versionCount: null,
            dateCandidates: [],
            fieldSources: {},
          },
          warnings: [],
        }],
        conflicts: [],
      },
    });
    const review = reviewDraft(parsed);
    Object.assign(review.reviewedLineItemsJson[0], {
      productName: "Foam Board",
      selectedProductId: "product_foam",
      selectedProductSource: "source_evidence",
      interpretedProductId: "product_foam",
      interpretedProductReason: "Exact material evidence matched Foam Board.",
      interpretedProductConfidence: 95,
      productUnresolved: false,
      materialText: "3/16\" Foam Core",
      quantity: 1,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
    });

    setupParsedInboundReview({
      parsed,
      review,
      detailOverrides: {
        files: [{
          id: "file_po_foam",
          inboundRecordId: "inbound_1",
          sourceFilename: "Foam Core PO.pdf",
          role: "po",
          status: "available",
          fileRecordId: "file_record_foam",
          providerAttachmentId: "att_foam",
          providerMessageId: "gmail_msg_foam",
          mimeType: "application/pdf",
          sizeBytes: 64000,
          contentDisposition: "attachment",
          metadataJson: { attachmentState: "downloaded" },
        }],
      },
    });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });
    await waitForText("Source Documents");
    const poTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "PO") as HTMLButtonElement;
    act(() => {
      Simulate.click(poTab);
    });

    await waitForText("PO Extraction Summary");
    const sourceDocumentsText = container.querySelector("[data-testid='clean-source-documents']")?.textContent ?? "";
    expect(sourceDocumentsText).toContain("Product");
    expect(sourceDocumentsText).toContain("Foam Board");
    expect(sourceDocumentsText).toContain("Evidence: Resolved from 3/16\" Foam Core");
    expect(sourceDocumentsText).toContain("Material");
    expect(sourceDocumentsText).toContain("3/16\" Foam Core");
    expect(sourceDocumentsText).toContain("24 x 36");
    expect(sourceDocumentsText).not.toContain("Resolved product candidates");
  });

  test("Clean View PO summary does not pretend ambiguous multi-line products were directly printed", async () => {
    const parsed = parsedDraft({
      lineItems: [{
        sourceText: "Stock: 3/16\" Foam Core\nFinal Trim: 24 x 36\nQTY: 1",
        productName: "Foam Core Sign",
        quantity: 1,
        width: 24,
        height: 36,
        dimensionsUnit: "in",
        materialText: "3/16\" Foam Core",
        productCandidates: [{ id: "product_foam", label: "Foam Board", confidence: 95, reason: "Alias matched." }],
        candidateProductIds: ["product_foam"],
      }, {
        sourceText: "Stock: 3/16\" Foam Core\nFinal Trim: 24 x 36\nQTY: 1",
        productName: "Foam Core Display",
        quantity: 1,
        width: 24,
        height: 36,
        dimensionsUnit: "in",
        materialText: "3/16\" Foam Core",
        productCandidates: [{ id: "product_display", label: "Foam Core Display", confidence: 92, reason: "Alias matched." }],
        candidateProductIds: ["product_display"],
      }],
      evidence: {
        items: [{
          type: "PDF_ATTACHMENT",
          label: "Multi Line Foam PO.pdf",
          sourceId: "file_po_multi",
          fileName: "Multi Line Foam PO.pdf",
          mimeType: "application/pdf",
          rawText: "Stock: 3/16\" Foam Core\nFinal Trim: 24 x 36\nQTY: 1",
          pageCount: 1,
          documentType: "purchase_order",
          documentConfidence: 96,
          extractionStatus: "successful",
          poSummary: {
            poNumber: "151901",
            customer: "Brainstorm Print",
            contact: "Shawn Fears",
            dueDate: null,
            quantity: 1,
            productDescription: null,
            material: "3/16\" Foam Core",
            dimensions: "24 x 36",
            printSpecs: [],
            shippingNotes: null,
            price: null,
            versionCount: null,
            dateCandidates: [],
            fieldSources: {},
          },
          warnings: [],
        }],
        conflicts: [],
      },
    });
    const review = reviewDraft(parsed);
    Object.assign(review.reviewedLineItemsJson[0], {
      productName: "Foam Board",
      selectedProductId: "product_foam",
      productUnresolved: false,
      materialText: "3/16\" Foam Core",
    });
    Object.assign(review.reviewedLineItemsJson[1], {
      productName: "Foam Core Display",
      selectedProductId: "product_display",
      productUnresolved: false,
      materialText: "3/16\" Foam Core",
    });

    setupParsedInboundReview({
      parsed,
      review,
      detailOverrides: {
        files: [{
          id: "file_po_multi",
          inboundRecordId: "inbound_1",
          sourceFilename: "Multi Line Foam PO.pdf",
          role: "po",
          status: "available",
          fileRecordId: "file_record_multi",
          providerAttachmentId: "att_multi",
          providerMessageId: "gmail_msg_multi",
          mimeType: "application/pdf",
          sizeBytes: 64000,
          contentDisposition: "attachment",
          metadataJson: { attachmentState: "downloaded" },
        }],
      },
    });

    renderPage();
    await waitForText("Operational View");
    const cleanButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clean View")) as HTMLButtonElement;
    act(() => {
      Simulate.click(cleanButton);
    });
    await waitForText("Source Documents");
    const poTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "PO") as HTMLButtonElement;
    act(() => {
      Simulate.click(poTab);
    });

    await waitForText("Resolved product candidates");
    const sourceDocumentsText = container.querySelector("[data-testid='clean-source-documents']")?.textContent ?? "";
    expect(sourceDocumentsText).toContain("Resolved product candidates");
    expect(sourceDocumentsText).toContain("Foam Board");
    expect(sourceDocumentsText).toContain("Foam Core Display");
    expect(sourceDocumentsText).toContain("Multiple line items may match this PO evidence");
  });

  test("supports operational line item add, duplicate, remove, and product picker rendering", async () => {
    setupParsedInboundReview();

    renderPage();
    await waitForText("Order Workstation");
    await waitForText("Add line item");
    await waitForText("Production ticket 1");
    expect(container.textContent).toContain("Line Items / Products");
    expect(container.textContent).toContain("Edit details");
    const editDetails = Array.from(container.querySelectorAll("details")).find((details) => (
      details.textContent?.includes("Edit details")
    )) as HTMLDetailsElement;
    expect(editDetails).toBeTruthy();
    expect(editDetails.open).toBe(false);
    act(() => {
      Simulate.click(editDetails.querySelector("summary") as HTMLElement);
    });
    expect(editDetails.open).toBe(true);
    act(() => {
      Simulate.click(editDetails.querySelector("summary") as HTMLElement);
    });
    expect(editDetails.open).toBe(false);
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

  test("shows a blocking toast when draft-order conversion requirements are missing", async () => {
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

    const orderButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Create Order")) as HTMLButtonElement;
    const quoteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Convert to Draft Quote")) as HTMLButtonElement;
    expect(orderButton.disabled).toBe(false);
    expect(quoteButton.disabled).toBe(true);
    await act(async () => {
      Simulate.click(orderButton);
    });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Draft order is not ready",
      description: expect.stringContaining("Select a customer candidate or mark the customer unresolved."),
      variant: "destructive",
    }));
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      "/api/inbound-orders/inbound_1/create-order",
      expect.anything(),
    );
  });

  test("staff edits survive operational/debug view toggles and save with draft payload", async () => {
    const { getSavedBody } = setupParsedInboundReview();

    renderPage();
    await waitForText("Order Workstation");
    await waitForText("PO Ref");
    act(() => {
      Simulate.change(labeledControl("PO Ref", "input"), { target: { value: "PO-999" } } as any);
    });
    act(() => {
      Simulate.change(labeledControl("Intent", "select"), { target: { value: "order" } } as any);
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
    await waitForText("Order Workstation");
    expect(labeledControl("PO Ref", "input")).toHaveProperty("value", "PO-999");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "operational review draft saved");
    expect(getSavedBody().reviewedOrderJson.poNumber).toBe("PO-999");
    expect(getSavedBody().reviewedOrderJson.intent).toBe("order");
  });

  test("shows PO price mismatch warning and saves staff pricing resolution", async () => {
    const parsed = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        pricingReviewJson: {
          status: "mismatch",
          message: "PO price differs from system price.",
          acknowledged: false,
          resolution: null,
          resolutionNote: null,
          poPriceCents: 5000,
          poUnitPriceCents: null,
          poExtendedPriceCents: null,
          poRushFeesCents: 500,
          poTotalPriceCents: 5000,
          systemPriceCents: 4500,
          systemUnitPriceCents: 2250,
          differenceCents: -500,
          comparisonType: "total",
          sourceEvidence: ["Total: $50.00", "System line price: $45.00"],
          alternatePricingNotes: ["Approved by buyer"],
          evaluatedAt: "2026-06-09T12:05:00.000Z",
        },
      }],
    });
    const review = reviewDraft(parsed, {
      validationErrors: ["Banner: PO price differs from system price. Acknowledge or resolve pricing before conversion."],
    });
    const { getSavedBody } = setupParsedInboundReview({ parsed, review });

    renderPage();
    await waitForText("Order Workstation");
    await waitForText("PO price differs from system price.");
    await waitForText("$50.00");
    await waitForText("$45.00");
    await waitForText("Pricing review");
    await waitForText("Effective");
    await waitForText("Rush fee $5.00");
    await waitForText("Source evidence: Total: $50.00; System line price: $45.00");
    expect(container.textContent).toContain("Line 1: PO price differs from system price.");

    const resolutionSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Resolve PO price mismatch"
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(resolutionSelect, { target: { value: "honor_po_price" } } as any);
    });
    const noteInput = Array.from(container.querySelectorAll("input")).find((input) => (
      input.getAttribute("aria-label") === "Pricing resolution note"
    )) as HTMLInputElement;
    act(() => {
      Simulate.change(noteInput, { target: { value: "Honor customer PO for this order." } } as any);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "pricing resolution saved");
    expect(getSavedBody().reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      status: "resolved",
      acknowledged: true,
      resolution: "honor_po_price",
      resolutionNote: "Honor customer PO for this order.",
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 5000,
      priceOverrideSource: "po",
      effectiveTotalCents: 5000,
    });
  });

  test("saves a manual inbound unit price override and shows its effective total", async () => {
    const parsed = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        quantity: 3,
        pricingReviewJson: {
          status: "not_available",
          message: null,
          acknowledged: false,
          resolution: null,
          resolutionNote: null,
          poPriceCents: null,
          poUnitPriceCents: null,
          poExtendedPriceCents: null,
          poRushFeesCents: null,
          poTotalPriceCents: null,
          systemPriceCents: 4500,
          systemUnitPriceCents: 1500,
          differenceCents: null,
          comparisonType: null,
          sourceEvidence: [],
          alternatePricingNotes: [],
          evaluatedAt: "2026-06-09T12:05:00.000Z",
        },
      }],
    });
    const { getSavedBody } = setupParsedInboundReview({ parsed, review: reviewDraft(parsed) });

    renderPage();
    await waitForText("Order Workstation");
    await waitForText("$45.00 total");

    const overrideMode = container.querySelector("select[aria-label='Inbound price override mode']") as HTMLSelectElement;
    const overrideAmount = container.querySelector("input[aria-label='Inbound price override amount']") as HTMLInputElement;
    expect(overrideAmount.disabled).toBe(true);
    act(() => {
      Simulate.change(overrideMode, { target: { value: "override_unit_after_margin" } } as any);
    });
    expect(overrideAmount.disabled).toBe(false);
    act(() => {
      Simulate.change(overrideAmount, { target: { value: "20.00" } } as any);
    });
    expect(overrideAmount.value).toBe("20.00");
    await waitForText("$60.00 total");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "manual price override saved");
    expect(getSavedBody().reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      priceOverrideMode: "override_unit_after_margin",
      priceOverrideValueCents: 2000,
      priceOverrideSource: "staff",
      effectiveUnitPriceCents: 2000,
      effectiveTotalCents: 6000,
    });
  });

  test("accepts a total override and clears a stale price-needed blocker when system pricing is unavailable", async () => {
    const parsed = parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        quantity: null,
        quantitySource: null,
        pricingReviewJson: {
          status: "not_available",
          message: "PBV2 pricing failed",
          acknowledged: false,
          resolution: null,
          resolutionNote: null,
          poPriceCents: null,
          poUnitPriceCents: null,
          poExtendedPriceCents: null,
          poRushFeesCents: null,
          poTotalPriceCents: null,
          systemPriceCents: 0,
          systemUnitPriceCents: 0,
          differenceCents: null,
          comparisonType: null,
          sourceEvidence: [],
          alternatePricingNotes: [],
          evaluatedAt: "2026-06-09T12:05:00.000Z",
          priceOverrideMode: null,
          priceOverrideValueCents: 0,
          priceOverrideSource: null,
          effectiveUnitPriceCents: 0,
          effectiveTotalCents: 0,
        },
      }],
    });
    const review = reviewDraft(parsed, {
      validationErrors: ["Banner: system pricing is unavailable or zero. Enter a valid unit or total price override before conversion."],
    });
    const { getSavedBody } = setupParsedInboundReview({ parsed, review });

    renderPage();
    await waitForText("System pricing error: PBV2 pricing failed Enter a unit or total override before conversion.");

    const overrideMode = container.querySelector("select[aria-label='Inbound price override mode']") as HTMLSelectElement;
    const overrideAmount = container.querySelector("input[aria-label='Inbound price override amount']") as HTMLInputElement;
    expect(overrideAmount.disabled).toBe(true);
    act(() => {
      Simulate.change(overrideMode, { target: { value: "override_total_after_margin" } } as any);
    });
    expect(overrideAmount.disabled).toBe(false);
    act(() => {
      Simulate.change(overrideAmount, { target: { value: "30.00" } } as any);
    });
    expect(overrideAmount.value).toBe("30.00");
    await waitForText("$30.00 total");
    await waitForCondition(() => !container.textContent?.includes("system pricing is unavailable or zero"), "stale price blocker cleared");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "manual total override saved");
    expect(getSavedBody().reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 3000,
      priceOverrideSource: "staff",
      effectiveTotalCents: 3000,
    });
  });

  test("manual attachment classification override persists and wins in review draft", async () => {
    const attachmentLink = {
      fileId: "file_1",
      fileRecordId: "file_record_1",
      filename: "final-banner-art.pdf",
      mimeType: "application/pdf",
      sizeBytes: 44_000,
      role: "artwork",
      source: "unresolved",
      confidence: 80,
      reason: "Stored inbound attachment awaiting staff assignment.",
      classification: "ARTWORK",
      classificationConfidence: 91,
      classificationReasons: ["filename contains artwork or production terms"],
      classificationSource: "automatic",
      classificationBreakdown: {
        filename: ["filename contains artwork or production terms"],
        content: [],
        metadata: [],
        manual: [],
        scores: { ARTWORK: 91 },
      },
      manualOverride: false,
    };
    const files = [{
      id: "file_1",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: "file_record_1",
      sourceFilename: "final-banner-art.pdf",
      role: "artwork",
      mimeType: "application/pdf",
      sizeBytes: 44_000,
      checksum: null,
      status: "available",
      providerAttachmentId: "att_1",
      providerMessageId: "msg_1",
      contentDisposition: "attachment",
      metadataJson: {
        attachmentClassification: {
          classification: "ARTWORK",
          confidence: 91,
          reasons: ["filename contains artwork or production terms"],
          source: "automatic",
          breakdown: attachmentLink.classificationBreakdown,
        },
      },
      reviewNotes: null,
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: "2026-06-09T12:02:00.000Z",
      updatedAt: "2026-06-09T12:02:00.000Z",
    }];
    const parsed = parsedDraft();
    const review = reviewDraft(parsed, { unassignedAttachments: [attachmentLink] });
    const { getSavedBody } = setupParsedInboundReview({ parsed, review, detailOverrides: { files } });

    renderPage();
    await waitForText("Order Workstation");
    await waitForCondition(() => (
      Array.from(container.querySelectorAll("select")).some((select) => select.getAttribute("aria-label") === "Classify final-banner-art.pdf")
    ), "attachment classification override control rendered");
    const overrideSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Classify final-banner-art.pdf"
    )) as HTMLSelectElement;

    act(() => {
      Simulate.change(overrideSelect, { target: { value: "PO" } } as any);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "attachment override saved");
    const savedLink = getSavedBody().reviewedArtworkJson.unassignedAttachments[0];
    expect(savedLink).toMatchObject({
      role: "po",
      classification: "PO",
      classificationConfidence: 100,
      classificationSource: "manual_override",
      automaticClassification: "ARTWORK",
      automaticClassificationConfidence: 91,
      manualOverride: true,
      learningEvidence: expect.objectContaining({
        inboundRecordId: "inbound_1",
        attachmentKey: "record:file_record_1",
        filename: "final-banner-art.pdf",
        extension: "pdf",
        originalAutomaticClassification: "ARTWORK",
        correctedManualClassification: "PO",
        automaticConfidence: 91,
        automaticReasons: ["filename contains artwork or production terms"],
        note: "Manual correction captured for future classification learning.",
      }),
    });
    expect(savedLink.classificationReasons).toContain("Staff manually classified as Purchase Order.");
  });

  test("manual PO to Artwork override appears in artwork dropdown and saves learning evidence", async () => {
    const attachmentLink = {
      fileId: "file_po",
      fileRecordId: "file_record_po",
      filename: "customer-po.pdf",
      mimeType: "application/pdf",
      sizeBytes: 31_000,
      role: "po",
      source: "unresolved",
      confidence: 82,
      reason: "Stored inbound attachment awaiting staff assignment.",
      classification: "PO",
      classificationConfidence: 88,
      classificationReasons: ["filename contains PO"],
      classificationSource: "automatic",
      classificationBreakdown: {
        filename: ["filename contains PO"],
        content: [],
        metadata: [],
        manual: [],
        scores: { PO: 88 },
      },
      manualOverride: false,
    };
    const parsed = parsedDraft();
    const review = reviewDraft(parsed, { unassignedAttachments: [attachmentLink] });
    const { getSavedBody } = setupParsedInboundReview({ parsed, review });

    renderPage();
    await waitForText("Order Workstation");
    await waitForCondition(() => (
      Array.from(container.querySelectorAll("select")).some((select) => select.getAttribute("aria-label") === "Classify customer-po.pdf")
    ), "PO classification override control rendered");

    const overrideSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Classify customer-po.pdf"
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(overrideSelect, { target: { value: "ARTWORK" } } as any);
    });

    await waitForCondition(() => (
      Array.from((Array.from(container.querySelectorAll("select")).find((select) => (
        select.getAttribute("aria-label") === "Attach artwork to line item 1"
      )) as HTMLSelectElement).options)
        .some((option) => option.textContent === "customer-po.pdf")
    ), "manual artwork is available to line item dropdown");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "manual artwork override saved");

    const savedLink = getSavedBody().reviewedArtworkJson.unassignedAttachments[0];
    expect(savedLink).toMatchObject({
      role: "artwork",
      classification: "ARTWORK",
      classificationConfidence: 100,
      classificationSource: "manual_override",
      automaticClassification: "PO",
      manualOverride: true,
      learningEvidence: expect.objectContaining({
        originalAutomaticClassification: "PO",
        correctedManualClassification: "ARTWORK",
        filename: "customer-po.pdf",
      }),
    });
  });

  test("manual Junk Signature override is excluded from artwork dropdown", async () => {
    const attachmentLink = {
      fileId: "file_logo",
      fileRecordId: "file_record_logo",
      filename: "signature-logo.png",
      mimeType: "image/png",
      sizeBytes: 1_200,
      role: "artwork",
      source: "unresolved",
      confidence: 70,
      reason: "Stored inbound attachment awaiting staff assignment.",
      classification: "ARTWORK",
      classificationConfidence: 70,
      classificationReasons: ["image file type"],
      classificationSource: "automatic",
      classificationBreakdown: {
        filename: [],
        content: [],
        metadata: ["image file type"],
        manual: [],
        scores: { ARTWORK: 70 },
      },
      manualOverride: false,
    };
    const parsed = parsedDraft();
    const review = reviewDraft(parsed, { unassignedAttachments: [attachmentLink] });
    const { getSavedBody } = setupParsedInboundReview({ parsed, review });

    renderPage();
    await waitForText("Order Workstation");
    await waitForCondition(() => (
      Array.from(container.querySelectorAll("select")).some((select) => select.getAttribute("aria-label") === "Classify signature-logo.png")
    ), "signature classification override control rendered");

    const overrideSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Classify signature-logo.png"
    )) as HTMLSelectElement;
    act(() => {
      Simulate.change(overrideSelect, { target: { value: "IGNORE_INLINE" } } as any);
    });

    await waitForCondition(() => (
      !Array.from((Array.from(container.querySelectorAll("select")).find((select) => (
        select.getAttribute("aria-label") === "Attach artwork to line item 1"
      )) as HTMLSelectElement).options)
        .some((option) => option.textContent === "signature-logo.png")
    ), "manual junk is excluded from artwork dropdown");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft")) as HTMLButtonElement;
    await act(async () => {
      Simulate.click(saveButton);
    });
    await waitForCondition(() => Boolean(getSavedBody()), "manual junk override saved");

    const savedLink = getSavedBody().reviewedArtworkJson.unassignedAttachments[0];
    expect(savedLink).toMatchObject({
      role: "ignore_inline",
      classification: "IGNORE_INLINE",
      classificationConfidence: 100,
      classificationSource: "manual_override",
      automaticClassification: "ARTWORK",
      manualOverride: true,
      learningEvidence: expect.objectContaining({
        originalAutomaticClassification: "ARTWORK",
        correctedManualClassification: "IGNORE_INLINE",
        filename: "signature-logo.png",
      }),
    });
  });

  test("PO artwork grouping uses deduped attachments and preserves manual duplicate override", async () => {
    const duplicateFiles = [
      {
        id: "file_original",
        organizationId: "org_1",
        inboundRecordId: "inbound_1",
        inboundLineItemId: null,
        fileRecordId: "file_record_original",
        sourceFilename: "PO 151793.pdf",
        role: "po",
        mimeType: "application/pdf",
        sizeBytes: 44_000,
        checksum: null,
        status: "available",
        providerAttachmentId: "att_a",
        providerMessageId: "gmail_msg_1",
        contentDisposition: "attachment",
        metadataJson: {
          seenProviderMessageIds: ["gmail_msg_1", "gmail_msg_2"],
          seenInMessageCount: 2,
          attachmentClassification: {
            classification: "PO",
            confidence: 91,
            reasons: ["filename contains PO"],
            source: "automatic",
          },
        },
        reviewNotes: null,
        createdQuoteAttachmentId: null,
        createdOrderAttachmentId: null,
        createdAt: "2026-06-09T12:02:00.000Z",
        updatedAt: "2026-06-09T12:02:00.000Z",
      },
      {
        id: "file_duplicate",
        organizationId: "org_1",
        inboundRecordId: "inbound_1",
        inboundLineItemId: null,
        fileRecordId: "file_record_duplicate",
        sourceFilename: "PO 151793.pdf",
        role: "po",
        mimeType: "application/pdf",
        sizeBytes: 44_000,
        checksum: null,
        status: "available",
        providerAttachmentId: "att_b",
        providerMessageId: "gmail_msg_2",
        contentDisposition: "attachment",
        metadataJson: {
          seenProviderMessageIds: ["gmail_msg_1", "gmail_msg_2"],
          seenInMessageCount: 2,
          attachmentClassification: {
            classification: "PO",
            confidence: 91,
            reasons: ["filename contains PO"],
            source: "automatic",
          },
        },
        reviewNotes: null,
        createdQuoteAttachmentId: null,
        createdOrderAttachmentId: null,
        createdAt: "2026-06-09T12:03:00.000Z",
        updatedAt: "2026-06-09T12:03:00.000Z",
      },
    ];
    const manualDuplicateLink = {
      fileId: "file_duplicate",
      fileRecordId: "file_record_duplicate",
      filename: "PO 151793.pdf",
      mimeType: "application/pdf",
      sizeBytes: 44_000,
      role: "artwork",
      source: "unresolved",
      confidence: 100,
      reason: "Staff manually classified as Artwork.",
      classification: "ARTWORK",
      classificationConfidence: 100,
      classificationReasons: ["Staff manually classified as Artwork."],
      classificationSource: "manual_override",
      automaticClassification: "PO",
      automaticClassificationConfidence: 91,
      automaticClassificationReasons: ["filename contains PO"],
      manualOverride: true,
    };
    const parsed = parsedDraft();
    const review = reviewDraft(parsed, { unassignedAttachments: [manualDuplicateLink] });
    setupParsedInboundReview({ parsed, review, detailOverrides: { files: duplicateFiles } });

    renderPage();
    await waitForText("Order Workstation");

    await waitForCondition(() => (
      Array.from(container.querySelectorAll("select")).filter((select) => (
        select.getAttribute("aria-label") === "Classify PO 151793.pdf"
      )).length === 1
    ), "deduped attachment classification control rendered once");
    const classificationSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Classify PO 151793.pdf"
    )) as HTMLSelectElement;
    expect(classificationSelect.value).toBe("ARTWORK");

    const artworkSelect = Array.from(container.querySelectorAll("select")).find((select) => (
      select.getAttribute("aria-label") === "Attach artwork to line item 1"
    )) as HTMLSelectElement;
    expect(Array.from(artworkSelect.options).filter((option) => option.textContent === "PO 151793.pdf")).toHaveLength(1);
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
      return evidence >= 320 && draftWidthValue >= 360 && evidence + draftWidthValue <= 1066;
    }, "initial layout widths clamped");
    const initialEvidenceWidth = workspace.style.getPropertyValue("--workspace-evidence-width");
    const initialDraftWidth = workspace.style.getPropertyValue("--workspace-draft-width");
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("300px");
    expect(queuePanel.style.width).toBe("300px");
    expect(queuePanel.style.flex).toBe("0 0 300px");

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
    expect(container.textContent).toContain("Order Workstation will appear after parsing.");
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("300px");
    expect(queuePanel.style.width).toBe("300px");
    expect(queuePanel.style.flex).toBe("0 0 300px");
    expect(workspace.style.getPropertyValue("--workspace-evidence-width")).toBe(initialEvidenceWidth);
    expect(workspace.style.getPropertyValue("--workspace-draft-width")).toBe(initialDraftWidth);
    expect(window.localStorage.getItem("titanos.inboundOrders.evidenceWidth")).toBeTruthy();
    expect(window.localStorage.getItem("titanos.inboundOrders.draftWidth")).toBeTruthy();
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
    await waitForText("Order Workstation will appear after parsing.");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Order")
    ));
    expect(createDraftButton).toBeTruthy();
    expect(createDraftButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Order Workstation will appear after parsing.");
  });

  test("keeps long inbound queue row content inside the 300px panel", async () => {
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
    expect(queuePanel.style.width).toBe("300px");
    expect(queuePanel.style.flex).toBe("0 0 300px");

    expect(queuePanel.querySelector("[data-radix-scroll-area-viewport]")).toBeNull();
    const queueScrollArea = Array.from(queuePanel.querySelectorAll("div")).find((element) => (
      element.className.includes("overflow-y-auto") && element.className.includes("overflow-x-hidden")
    ));
    expect(queueScrollArea).toBeTruthy();
    expect(queueScrollArea?.className).toContain("min-w-0");
    expect(queueScrollArea?.className).toContain("max-w-full");

    const searchInput = queuePanel.querySelector("input[placeholder='Search queue']") as HTMLInputElement;
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

    const metadataRow = Array.from(queueCard.querySelectorAll("div")).find((element) => (
      element.className.includes("text-[11px]") && element.textContent?.includes("Issue")
    )) as HTMLDivElement;
    expect(metadataRow).toBeTruthy();
    expect(metadataRow.className).toContain("max-w-full");
    expect(metadataRow.className).toContain("overflow-hidden");

    expect(queueCard.textContent).not.toContain(longWarning);
    expect(queueCard.textContent).toContain("Issue");
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
    expect(workspace.style.getPropertyValue("--workspace-queue-width")).toBe("300px");
    expect(queuePanel.style.width).toBe("300px");
    expect(queuePanel.style.flex).toBe("0 0 300px");
    expect(queuePanel.className).toContain("min-[1024px]:w-[var(--workspace-queue-width)]");

    const draftPanel = container.querySelector("[data-testid='inbound-draft-panel']") as HTMLElement;
    expect(draftPanel).toBeTruthy();
    expect(draftPanel.className).toContain("overflow-hidden");
    expect(container.textContent).toContain("Order Workstation");

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
    const queueResizeHandle = container.querySelector("[aria-label='Resize queue panel']") as HTMLButtonElement;
    act(() => {
      Simulate.mouseDown(queueResizeHandle, { clientX: 300 } as any);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 340, bubbles: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await waitForCondition(() => (
      workspace.style.getPropertyValue("--workspace-queue-width") === "340px"
    ), "queue width resize");
    expect(window.localStorage.getItem("titanos.inboundOrders.queueWidth")).toBe("340");

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
        && workspace.style.getPropertyValue("--workspace-queue-width") === "300px"
    ), "layout restore persistence");
  });

  test("keeps queue visible in the workstation layout and exposes compact filters", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1366,
    });
    const row = record({ sourceType: "email" });
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Source Documents");

    const workspace = container.querySelector("[data-testid='inbound-review-workspace']") as HTMLElement;
    const queuePanel = container.querySelector("[data-testid='inbound-queue-panel']") as HTMLElement;
    expect(workspace.className).toContain("min-[1024px]:flex-row");
    expect(queuePanel.className).toContain("min-[1024px]:flex");
    expect(queuePanel.style.width).toBe("300px");
    const filterTrigger = container.querySelector("[aria-label='Open queue filters']") as HTMLButtonElement;
    expect(filterTrigger).toBeTruthy();
    act(() => {
      filterTrigger.click();
    });
    await waitForCondition(
      () => Boolean(document.body.querySelector("[data-testid='inbound-queue-filters-popover']")),
      "queue filter popover portal",
    );
    const filterPopover = document.body.querySelector("[data-testid='inbound-queue-filters-popover']") as HTMLElement;
    expect(queuePanel.contains(filterPopover)).toBe(false);
    expect(filterPopover.className).toContain("z-50");
    expect(container.textContent).toContain("Source Documents");
    expect(container.textContent).toContain("Order Workstation");
  });

  test("exposes narrow layout controls for queue drawer and docs/workstation tabs", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 900,
    });
    const row = record({ sourceType: "email" });
    const draft = parsedDraft();
    apiFetchMock.mockImplementation(async (url: any) => {
      const path = String(url);
      if (path.startsWith("/api/inbound-orders?")) return jsonResponse(listResponse([row]));
      if (path === "/api/inbound-orders/inbound_1") return jsonResponse({ success: true, data: detail(row) });
      if (path === "/api/inbound-orders/inbound_1/draft-preview") return jsonResponse(draftPreview({ draft, latestAttempt: parseAttempt({ parsedDraft: draft }) }));
      if (path === "/api/inbound-orders/inbound_1/review-draft") return jsonResponse({ success: true, data: reviewDraft(draft) });
      if (path.startsWith("/api/inbound-orders/customer-search")
        || path.startsWith("/api/inbound-orders/contact-search")
        || path.startsWith("/api/inbound-orders/product-search")) {
        return jsonResponse({ success: true, data: [] });
      }
      if (path.startsWith("/api/inbound-orders/product-options/")) return jsonResponse(pbv2OptionsResponse());
      return jsonResponse({ message: `Unexpected URL ${path}` }, false, 500);
    });

    renderPage();
    await waitForText("Queue");

    const workspace = container.querySelector("[data-testid='inbound-review-workspace']") as HTMLElement;
    const queuePanel = container.querySelector("[data-testid='inbound-queue-panel']") as HTMLElement;
    const evidencePanel = container.querySelector("[data-testid='inbound-evidence-panel']") as HTMLElement;
    const draftPanel = container.querySelector("[data-testid='inbound-draft-panel']") as HTMLElement;
    expect(workspace.className).toContain("min-[1024px]:flex-row");
    expect(queuePanel.className).toContain("hidden");
    expect(evidencePanel.className).toContain("flex");
    expect(draftPanel.className).toContain("hidden");

    const queueButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Queue")) as HTMLButtonElement;
    act(() => {
      Simulate.click(queueButton);
    });
    expect(queuePanel.className).toContain("fixed");
    expect(queuePanel.className).toContain("max-w-[calc(100vw-1rem)]");

    const reviewTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Workstation") as HTMLButtonElement;
    act(() => {
      Simulate.click(reviewTab);
    });
    expect(evidencePanel.className).toContain("hidden");
    expect(draftPanel.className).toContain("flex");
    await waitForText("Confirmed customer");
    expect(container.textContent).not.toContain("Evidence Used");
    expect(container.textContent).toContain("Confirmed customer");
    expect(container.textContent).toContain("Change");
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
    expect(window.localStorage.getItem("titanos.inboundOrders.evidenceWidth")).toBe("900");
    expect(window.localStorage.getItem("titanos.inboundOrders.draftWidth")).toBe("900");
    const actionFooter = Array.from(container.querySelectorAll("section")).find((section) => (
      section.className.includes("sticky") && section.textContent?.includes("Save Review Draft")
    ));
    expect(actionFooter).toBeTruthy();
    const phaseFourButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Order")
    ));
    expect(phaseFourButton).toBeTruthy();
    expect(phaseFourButton?.disabled).toBe(false);
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
    let parseCompleted = false;

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
        parseCompleted = true;
        return jsonResponse({
          success: true,
          data: {
            draft,
            latestAttempt: attempt,
            record: { ...row, status: "needs_review", parsedAt: "2026-06-09T12:01:00.000Z" },
            reviewDraft: reviewDraft(draft, {
              id: "review_snapshot_after_parse",
              snapshotId: "review_snapshot_after_parse",
              initializedFromParse: true,
            }),
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
    await waitForCondition(() => parseCompleted, "parse completed");
    expect(refreshFromLatestParseCalled).toBe(false);
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
    expect(container.textContent).toContain("Create Order");
    expect(labeledControl("Due date", "input")).toHaveProperty("value", "2026-06-11");
    expect(labeledControl("Quantity", "input")).toHaveProperty("value", "3");
    expect(labeledControl("Material", "input")).toHaveProperty("value", "3mm White PVC");

    const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Order")
    ));
    expect(createDraftButton?.disabled).toBe(false);
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
    let parseCompleted = false;

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
        parseCompleted = true;
        return jsonResponse({
          success: true,
          data: {
            draft: latestDraft,
            latestAttempt,
            record: { ...row, status: "needs_review", parsedAt: "2026-06-09T12:05:00.000Z" },
            reviewDraft: reviewDraft(latestDraft, {
              id: "review_snapshot_latest",
              snapshotId: "review_snapshot_latest",
              sourceParseAttemptId: "attempt_2",
              sourceParseAttemptCreatedAt: "2026-06-09T12:01:00.000Z",
              initializedFromParse: true,
            }),
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

    await waitForCondition(() => parseCompleted, "latest parse auto-applied to review draft");
    expect(refreshFromLatestParseCalled).toBe(false);
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
    await waitForText("Review Tasks");
    expect(container.textContent).toContain("grommets in the corners");
    expect(container.textContent).toContain("Review Required");
    expect(container.textContent).toContain("No compatible PBV2 option found.");
    expect(container.textContent).toContain("Add manually or select a different product.");
    expect(container.textContent).toContain("Create Order");
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
    await waitForText("Missing required options: Print Sides");

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

      act(() => {
        Simulate.click(container.querySelector("button[aria-label='Open queue filters']") as HTMLButtonElement);
      });
      await waitForCondition(
        () => Boolean(document.body.querySelector("[data-testid='inbound-queue-filters-popover']")),
        "rejected queue filters",
      );
      const rejectedFilter = Array.from(document.body.querySelectorAll("button")).find((button) => (
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
    let createOrderBody: any = null;
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
      if (path === "/api/inbound-orders/inbound_1/create-order" && options?.method === "POST") {
        createOrderBody = JSON.parse(String(options.body ?? "{}"));
        converted = true;
        return jsonResponse({
          success: true,
          data: {
            orderId: "order_1",
            orderNumber: "1001",
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
      const queryClient = renderPage();
      const invalidateQueriesSpy = jest.spyOn(queryClient, "invalidateQueries");
      const setQueryDataSpy = jest.spyOn(queryClient, "setQueryData");
      await waitForText("Phase 4: Create draft order from reviewed inbound record.");

      const createDraftButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Create Order")
      ));
      expect(createDraftButton).toBeTruthy();
      expect(createDraftButton?.disabled).toBe(false);

      act(() => {
        Simulate.change(labeledControl("PO Ref", "input"), { target: { value: "PO-CURRENT" } } as any);
      });

      await act(async () => {
        Simulate.click(createDraftButton!);
      });
      await waitForText("Open order 1001");

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(createOrderBody?.reviewedOrderJson?.poNumber).toBe("PO-CURRENT");
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/inbound-orders/inbound_1/create-order",
        expect.objectContaining({ method: "POST", body: expect.any(String) }),
      );
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Draft order created",
        description: expect.stringContaining("Order 1001"),
      }));
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ["orders", "detail", "order_1"],
        expect.objectContaining({ id: "order_1", orderNumber: "1001" }),
      );
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["orders", "list"] });
      expect(container.querySelector("a[href='/orders/order_1']")?.textContent).toContain("Open order 1001");
      expect(container.querySelector("a[href='/orders/order_1']")).toBeTruthy();
      await waitForText("No inbound records");

      act(() => {
        (container.querySelector("[aria-label='Open queue filters']") as HTMLButtonElement).click();
      });
      await waitForCondition(
        () => Boolean(document.body.querySelector("[data-testid='inbound-queue-filters-popover']")),
        "converted queue filters",
      );
      const convertedFilter = Array.from(document.body.querySelectorAll("button")).find((button) => (
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
      if (path === "/api/inbound-orders/inbound_1/create-order" && options?.method === "POST") {
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
        button.textContent?.includes("Create Order")
      ));
      await act(async () => {
        Simulate.click(createDraftButton!);
      });

      await waitForText("Draft order creation failed");
      expect(container.textContent).toContain("Select an existing customer before creating a draft order.");
      const retryButton = Array.from(container.querySelectorAll("button")).find((button) => (
        button.textContent?.includes("Create Order")
      ));
      expect(retryButton?.disabled).toBe(false);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Draft order was not created",
        variant: "destructive",
      }));
      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Draft order created" }));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test("edits and saves review draft fields while keeping conversion visibly blocked", async () => {
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

    await act(async () => {
      Simulate.click(refreshButton!);
    });
    await waitForCondition(() => refreshFromLatestParseCalled, "refresh from latest parse called");

    const artworkStatus = labeledControl("Artwork status", "select") as HTMLSelectElement;
    expect(Array.from(artworkStatus.options).map((option) => option.text)).toContain(
      "Bypass artwork for order (artwork to follow)",
    );
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

    const createOrderButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Create Order")
    ));
    expect(createOrderButton?.disabled).toBe(false);
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      Simulate.click(createOrderButton!);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(markReadyCalled).toBe(false);
    confirmSpy.mockRestore();
  });
});
