import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import EmailSettings from "./email";
import { apiFetch, apiRequest } from "@/lib/queryClient";

jest.mock("@/components/admin-settings", () => ({
  EmailSettingsTab: () => <section>Outbound Gmail Settings</section>,
}));

jest.mock("@/components/titan", () => ({
  TitanCard: ({ children, ...props }: any) => <section {...props}>{children}</section>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild) return children;
    return <button {...props}>{children}</button>;
  },
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: any) => <section {...props}>{children}</section>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  CardHeader: ({ children, ...props }: any) => <header {...props}>{children}</header>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: any) => <div {...props}>Loading</div>,
}));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      {...props}
    />
  ),
}));

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
}));

jest.mock("@/components/ui/form", () => ({
  Form: ({ children }: any) => <>{children}</>,
  FormControl: ({ children }: any) => <>{children}</>,
  FormDescription: ({ children }: any) => <p>{children}</p>,
  FormField: ({ render, name }: any) => render({ field: { name, value: "", onChange: jest.fn(), onBlur: jest.fn() } }),
  FormItem: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  FormMessage: () => null,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/lib/queryClient", () => ({
  apiFetch: jest.fn(),
  apiRequest: jest.fn(),
  queryClient: { invalidateQueries: jest.fn() },
}));

const apiFetchMock = jest.mocked(apiFetch);
const apiRequestMock = jest.mocked(apiRequest);

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  } as any;
}

function preferencesResponse() {
  return jsonResponse({
    inboundEmail: {
      inboundEmailIntakeEnabled: true,
      inboundEmailPullPaused: false,
    },
    emailTemplates: {},
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForText(text: string) {
  for (let i = 0; i < 20; i += 1) {
    await flush();
    if (container.textContent?.includes(text)) return;
  }
  throw new Error(`Expected text not found: ${text}\n${container.textContent}`);
}

async function waitForCondition(predicate: () => boolean, label: string) {
  for (let i = 0; i < 20; i += 1) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(`Expected condition not met: ${label}`);
}

async function renderEmailSettings(mailboxes: unknown[], ignoreRules: unknown[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && url === "/api/organization/preferences") {
      return preferencesResponse();
    }
    return jsonResponse({}, false, 404);
  });
  apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    const requestUrl = String(url);
    const method = options?.method ?? "GET";
    if (requestUrl.includes("/api/inbound-orders/email/mailboxes/gmail/start")) {
      return await new Promise(() => undefined) as any;
    }
    if (requestUrl === "/api/inbound-orders/email/mailboxes") {
      return jsonResponse({
        success: true,
        data: { mailboxes },
      });
    }
    if (requestUrl === "/api/inbound-orders/email/ignore-rules" && method === "GET") {
      return jsonResponse({
        success: true,
        data: { rules: ignoreRules },
      });
    }
    if (requestUrl.startsWith("/api/inbound-orders/email/pull-diagnostics")) {
      const hasSubject = requestUrl.includes("subject=");
      return jsonResponse({
        success: true,
        data: {
          organizationId: "org_1",
          generatedAt: "2026-06-18T15:00:00.000Z",
          subject: hasSubject ? "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26" : null,
          enabledMailboxCount: mailboxes.filter((mailbox: any) => mailbox.enabled).length,
          mailboxes,
          latestPullSummary: null,
          recentPullMessageDiagnostics: hasSubject ? [{
            message: "duplicate_message_attachment_backfill",
            eventType: "email.attachment_ingestion_diagnostics",
            metadataJson: {
              attachmentPartsDiscovered: 1,
              attachmentRowsCreated: 1,
            },
            createdAt: "2026-06-18T14:01:00.000Z",
          }] : [],
          recentFailedMessageDiagnostics: hasSubject ? [{ message: "Attachment download failed", createdAt: "2026-06-18T14:00:00.000Z" }] : [],
          recentIgnoredMessageDiagnostics: [],
          recentCreatedInboundRecords: [{
            id: "inbound_email_1",
            status: "needs_review",
            reviewOutcome: null,
            subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
            senderName: "Audrey Powell",
            senderEmail: "prepress@offsethouse.example",
            sourceMessageId: "gmail_msg_1",
            sourceThreadId: "thread_1",
            receivedAt: "2026-06-18T14:54:00.000Z",
            attachmentCount: 0,
            rawGmailPayloadAttachmentIndicators: {
              rawAttachmentCount: 1,
              normalizedAttachmentCount: 1,
              rawAttachmentMetadata: [{ filename: "visual-po.pdf", attachmentId: "att_1" }],
            },
            attachmentHints: {
              mentionsAttached: true,
              mentionsPo: true,
              mentionsArtwork: true,
              hasLinks: true,
              hasGoogleDriveLinks: true,
            },
            attachmentPipelineDiagnostics: {
              gmailPartsDiscovered: 1,
              attachmentCandidatesDiscovered: 1,
              attachmentIdsDiscovered: ["att_1"],
              attachmentPartsAttempted: 1,
              downloadAttempts: 1,
              downloadSuccesses: 0,
              downloadFailures: 1,
              metadataOnlyRowsCreated: 1,
              storedFileRowsCreated: 0,
              skippedExistingProviderAttachments: 0,
              ingestionCallStatus: "failed",
              ingestionCallError: "Gmail attachment unavailable",
              ingestionCallEvents: [{
                eventType: "attachment_ingestion_call_started",
                metadataJson: {
                  providerMessageId: "gmail_msg_1",
                  subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
                  candidateCount: 1,
                  trustStatus: "trusted_domain",
                  attachmentPolicy: "auto_download_allowed",
                },
              }, {
                eventType: "attachment_ingestion_call_failed",
                metadataJson: {
                  providerMessageId: "gmail_msg_1",
                  subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
                  candidateCount: 1,
                  trustStatus: "trusted_domain",
                  attachmentPolicy: "auto_download_allowed",
                  errorMessage: "Gmail attachment unavailable",
                },
              }],
              failures: [{
                filename: "visual-po.pdf",
                failureReason: "Gmail attachment unavailable",
                gmailApiError: "Gmail attachment unavailable",
                storageError: null,
                unsupportedMimeReason: null,
              }],
            },
            createdAt: "2026-06-18T14:55:01.000Z",
          }],
          recentInboundFiles: [{
            id: "file_1",
            sourceFilename: "po-151753.pdf",
            role: "po",
            status: "available",
          }],
          ignoreRuleCount: ignoreRules.length,
          activeIgnoreRules: ignoreRules.filter((rule: any) => rule.enabled).map((rule: any) => ({
            id: rule.id,
            ruleType: rule.ruleType,
            ruleValuePreview: rule.ruleValue,
            enabled: rule.enabled,
            matchCount: rule.matchCount ?? 0,
            lastMatchedAt: rule.lastMatchedAt ?? null,
            notes: rule.notes ?? null,
          })),
          subjectSearch: {
            provided: hasSubject,
            found: hasSubject,
            matchingRecords: hasSubject ? [
              {
                id: "inbound_email_1",
                status: "needs_review",
                reviewOutcome: null,
                subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
                sourceMessageId: "gmail_msg_1",
                sourceThreadId: "thread_1",
                attachmentCount: 0,
                rawGmailPayloadAttachmentIndicators: { rawAttachmentCount: 1 },
                attachmentHints: { mentionsAttached: true, mentionsPo: true, mentionsArtwork: true },
                attachmentPipelineDiagnostics: {
                  gmailPartsDiscovered: 1,
                  attachmentCandidatesDiscovered: 1,
                  attachmentIdsDiscovered: ["att_1"],
                  attachmentPartsAttempted: 1,
                  downloadAttempts: 1,
                  downloadSuccesses: 0,
                  downloadFailures: 1,
                  metadataOnlyRowsCreated: 1,
                  storedFileRowsCreated: 0,
                  skippedExistingProviderAttachments: 0,
                  ingestionCallStatus: "failed",
                  ingestionCallError: "Gmail attachment unavailable",
                  ingestionCallEvents: [{
                    eventType: "attachment_ingestion_call_started",
                    metadataJson: {
                      providerMessageId: "gmail_msg_1",
                      subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
                      candidateCount: 1,
                      trustStatus: "trusted_domain",
                      attachmentPolicy: "auto_download_allowed",
                    },
                  }, {
                    eventType: "attachment_ingestion_call_failed",
                    metadataJson: {
                      providerMessageId: "gmail_msg_1",
                      subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
                      candidateCount: 1,
                      trustStatus: "trusted_domain",
                      attachmentPolicy: "auto_download_allowed",
                      errorMessage: "Gmail attachment unavailable",
                    },
                  }],
                  failures: [{ filename: "visual-po.pdf", failureReason: "Gmail attachment unavailable", gmailApiError: "Gmail attachment unavailable" }],
                },
              },
            ] : [],
            matchingFiles: hasSubject ? [
              { id: "file_1", sourceFilename: "po-151753.pdf", role: "po", status: "available" },
            ] : [],
            matchingIgnoreRules: [],
            gmailPayloadDiagnostics: hasSubject ? [{
              inboundRecordId: "inbound_email_1",
              sourceMessageId: "gmail_msg_1",
              subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
              extractedAttachmentCount: 1,
              payloadTree: {
                partId: null,
                mimeType: "multipart/mixed",
                filenamePresent: false,
                filename: null,
                attachmentIdPresent: false,
                bodySize: null,
                headers: { contentType: "multipart/mixed", contentDisposition: null, contentId: null },
                childParts: [{
                  partId: "1",
                  mimeType: "application/pdf",
                  filenamePresent: true,
                  filename: "visual-po.pdf",
                  attachmentIdPresent: true,
                  bodySize: 4096,
                  headers: {
                    contentType: "application/pdf; name=\"visual-po.pdf\"",
                    contentDisposition: "attachment; filename=\"visual-po.pdf\"",
                    contentId: null,
                  },
                  childParts: [],
                }],
              },
            }] : [],
            duplicateDetection: {
              durableSkippedMessageLogsStored: false,
              possibleDuplicateRecords: [],
            },
          },
          storageNotes: {
            latestPullSummaryStored: false,
            perMessageFailureDiagnosticsStored: hasSubject,
            ignoredMessageDiagnosticsStored: false,
            duplicateSkipDiagnosticsStored: false,
          },
        },
      });
    }
    if (requestUrl === "/api/inbound-orders/email/ignore-rules" && method === "POST") {
      return jsonResponse({
        success: true,
        data: {
          id: "rule_created",
          organizationId: "org_1",
          matchCount: 0,
          lastMatchedAt: null,
          createdAt: "2026-06-17T12:00:00.000Z",
          updatedAt: "2026-06-17T12:00:00.000Z",
          ...JSON.parse(String(options?.body ?? "{}")),
        },
      });
    }
    if (requestUrl.startsWith("/api/inbound-orders/email/ignore-rules/") && method === "PATCH") {
      return jsonResponse({
        success: true,
        data: {
          id: decodeURIComponent(requestUrl.split("/").pop() ?? "rule_1"),
          organizationId: "org_1",
          matchCount: 0,
          lastMatchedAt: null,
          createdAt: "2026-06-17T12:00:00.000Z",
          updatedAt: "2026-06-17T12:00:00.000Z",
          ruleType: "sender_email_exact",
          ruleValue: "notifications@example.com",
          notes: null,
          enabled: true,
          ...JSON.parse(String(options?.body ?? "{}")),
        },
      });
    }
    if (requestUrl.startsWith("/api/inbound-orders/email/ignore-rules/") && method === "DELETE") {
      return jsonResponse({
        success: true,
        data: {
          id: decodeURIComponent(requestUrl.split("/").pop() ?? "rule_1"),
          organizationId: "org_1",
          ruleType: "sender_email_exact",
          ruleValue: "notifications@example.com",
          enabled: false,
          notes: null,
          matchCount: 0,
          lastMatchedAt: null,
          createdAt: "2026-06-17T12:00:00.000Z",
          updatedAt: "2026-06-17T12:00:00.000Z",
        },
      });
    }
    return jsonResponse({
      success: true,
      data: { mailboxes },
    });
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <EmailSettings />
      </QueryClientProvider>,
    );
  });
}

function ignoreRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule_1",
    organizationId: "org_1",
    enabled: true,
    ruleType: "sender_email_exact",
    ruleValue: "notifications@example.com",
    notes: "Processor notice",
    matchCount: 0,
    lastMatchedAt: null,
    createdAt: "2026-06-17T12:00:00.000Z",
    updatedAt: "2026-06-17T12:00:00.000Z",
    ...overrides,
  };
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function getIgnoreRulePostBody() {
  const call = apiFetchMock.mock.calls.find(([url, options]) => (
    String(url) === "/api/inbound-orders/email/ignore-rules"
    && (options as RequestInit | undefined)?.method === "POST"
  ));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
}

function getIgnoreRulePatchBody(ruleId = "rule_1") {
  const call = apiFetchMock.mock.calls.find(([url, options]) => (
    String(url) === `/api/inbound-orders/email/ignore-rules/${ruleId}`
    && (options as RequestInit | undefined)?.method === "PATCH"
  ));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("EmailSettings inbound mailbox settings", () => {
  test("shows a no-mailbox state and active inbound Gmail connect button", async () => {
    await renderEmailSettings([]);

    await waitForText("Inbound Email Mailboxes");
    await waitForText("No inbound mailboxes are configured yet.");
    await waitForText("This creates a dedicated inbound Gmail mailbox");

    const connectButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Connect Gmail Inbound Mailbox"));
    expect(connectButton).toBeTruthy();
    expect(connectButton).toHaveProperty("disabled", false);
  });

  test("renders disabled and enabled inbound mailbox rows without secret fields", async () => {
    await renderEmailSettings([
      {
        id: "mailbox_disabled",
        provider: "gmail",
        name: "Orders Inbox",
        emailAddress: "orders@example.com",
        enabled: false,
        isDefault: true,
        lastPulledAt: null,
        lastPullStatus: null,
        lastPullError: null,
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-09T12:00:00.000Z",
        authJson: { refreshToken: "secret_refresh_token" },
      },
      {
        id: "mailbox_enabled",
        provider: "gmail",
        name: "Quotes Inbox",
        emailAddress: "quotes@example.com",
        enabled: true,
        isDefault: false,
        lastPulledAt: "2026-06-09T12:05:00.000Z",
        lastPullStatus: "success",
        lastPullError: "Last warning stayed readable",
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-09T12:05:00.000Z",
        refreshToken: "secret_refresh_token",
      },
    ]);

    await waitForText("orders@example.com");
    await waitForText("quotes@example.com");
    await waitForText("Orders Inbox");
    await waitForText("Quotes Inbox");
    await waitForText("success");
    await waitForText("Last warning stayed readable");

    expect(container.textContent).not.toContain("authJson");
    expect(container.textContent).not.toContain("refreshToken");
    expect(container.textContent).not.toContain("secret_refresh_token");
  });

  test("renders email pull diagnostics and searches by subject", async () => {
    await renderEmailSettings([
      {
        id: "mailbox_enabled",
        provider: "gmail",
        name: "Orders Inbox",
        emailAddress: "orders@example.com",
        enabled: true,
        isDefault: true,
        lastPulledAt: "2026-06-18T14:55:00.000Z",
        lastPullStatus: "failed",
        lastPullError: "invalid_grant",
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-18T14:55:00.000Z",
      },
    ], [ignoreRule({ ruleType: "subject_contains", ruleValue: "Payment Received" })]);

    await waitForText("Email Pull Diagnostics");
    await waitForText("invalid_grant");
    await waitForText("Payment Received");
    await waitForText("Recent Email Records");
    await waitForText("Audrey Powell");
    expect(container.textContent).toContain("Files: 0");
    expect(container.textContent).toContain("Raw Gmail parts: 1");
    expect(container.textContent).toContain("Attached, Po, Artwork, Links, Google Drive Links");
    expect(container.textContent).toContain("Attachment Diagnostics");
    expect(container.textContent).toContain("Gmail parts: 1");
    expect(container.textContent).toContain("Attempts: 1");
    expect(container.textContent).toContain("Successes: 0");
    expect(container.textContent).toContain("Ingestion call: failed / Error: Gmail attachment unavailable");
    expect(container.textContent).toContain("Ingestion Call Audit");
    expect(container.textContent).toContain("attachment_ingestion_call_started");
    expect(container.textContent).toContain("attachment_ingestion_call_failed");
    expect(container.textContent).toContain("Policy: auto_download_allowed");
    expect(container.textContent).toContain("Gmail API error: Gmail attachment unavailable");

    const subjectInput = container.querySelector("input[aria-label='Email diagnostics subject search']") as HTMLInputElement;
    await setValue(subjectInput, "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26");
    const searchButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Search") as HTMLButtonElement;
    await act(async () => {
      searchButton.click();
    });

    await waitForText("Subject Search");
    await waitForText("Found");
    await waitForText("po-151753.pdf");
    await waitForText("duplicate_message_attachment_backfill");
    await waitForText("Sanitized Gmail Payload Shape");
    await waitForText("Extracted attachments: 1");
    expect(container.textContent).toContain("application/pdf");
    expect(container.textContent).toContain("Attachment ID present: true");
    expect(apiFetchMock.mock.calls.some(([url]) => (
      String(url) === "/api/inbound-orders/email/pull-diagnostics?subject=Purchase%20Order%20No%20151753%20Titan%20Compass%20ACM%20Sign%206_18_26"
    ))).toBe(true);
    expect(container.textContent).not.toContain("refreshToken");
    expect(container.textContent).not.toContain("secret_refresh_token");
  });

  test("collapses email pull diagnostics to stats and mailbox only", async () => {
    await renderEmailSettings([
      {
        id: "mailbox_enabled",
        provider: "gmail",
        name: "Orders Inbox",
        emailAddress: "orders@example.com",
        enabled: true,
        isDefault: true,
        lastPulledAt: "2026-06-18T14:55:00.000Z",
        lastPullStatus: "success",
        lastPullError: null,
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-18T14:55:00.000Z",
      },
    ], [ignoreRule({ ruleType: "subject_contains", ruleValue: "Payment Received" })]);

    await waitForText("Email Pull Diagnostics");
    await waitForText("Recent Email Records");
    const collapseButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Collapse Details")) as HTMLButtonElement;

    await act(async () => {
      collapseButton.click();
    });

    expect(container.textContent).toContain("Enabled Mailboxes");
    expect(container.textContent).toContain("orders@example.com");
    expect(container.textContent).not.toContain("Recent Email Records");
    expect(container.textContent).not.toContain("Attachment Diagnostics");
    expect(container.textContent).not.toContain("Audrey Powell");
    expect(container.querySelector("input[aria-label='Email diagnostics subject search']")).toBeNull();

    const expandButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Expand Details")) as HTMLButtonElement;
    await act(async () => {
      expandButton.click();
    });

    await waitForText("Recent Email Records");
    expect(container.querySelector("input[aria-label='Email diagnostics subject search']")).toBeTruthy();
  });

  test("collapses active ignore rules in diagnostics when there are many", async () => {
    await renderEmailSettings([
      {
        id: "mailbox_enabled",
        provider: "gmail",
        name: "Orders Inbox",
        emailAddress: "orders@example.com",
        enabled: true,
        isDefault: true,
        lastPulledAt: "2026-06-18T14:55:00.000Z",
        lastPullStatus: "success",
        lastPullError: null,
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-18T14:55:00.000Z",
      },
    ], [
      ignoreRule({ id: "rule_1", ruleValue: "rule one" }),
      ignoreRule({ id: "rule_2", ruleValue: "rule two" }),
      ignoreRule({ id: "rule_3", ruleValue: "rule three" }),
      ignoreRule({ id: "rule_4", ruleValue: "rule four" }),
    ]);

    await waitForText("Email Pull Diagnostics");
    await waitForText("4 active ignore rules hidden.");
    const toggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Active Ignore Rules")) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("starts inbound Gmail OAuth for a new mailbox connection", async () => {
    await renderEmailSettings([]);

    await waitForText("No inbound mailboxes are configured yet.");

    const connectButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Connect Gmail Inbound Mailbox")) as HTMLButtonElement;
    await act(async () => {
      connectButton.click();
    });
    await waitForCondition(
      () => apiFetchMock.mock.calls.some(([url]) => String(url) === "/api/inbound-orders/email/mailboxes/gmail/start"),
      "connect Gmail start request",
    );
  });

  test("starts inbound Gmail OAuth for reconnecting an existing mailbox", async () => {
    await renderEmailSettings([
      {
        id: "mailbox_enabled",
        provider: "gmail",
        name: "Quotes Inbox",
        emailAddress: "quotes@example.com",
        enabled: true,
        isDefault: true,
        lastPulledAt: null,
        lastPullStatus: null,
        lastPullError: null,
        createdAt: "2026-06-09T12:00:00.000Z",
        updatedAt: "2026-06-09T12:00:00.000Z",
      },
    ]);

    await waitForText("quotes@example.com");

    const reconnectButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Reconnect") as HTMLButtonElement;
    await act(async () => {
      reconnectButton.click();
    });
    await waitForCondition(
      () => apiFetchMock.mock.calls.some(([url]) => String(url) === "/api/inbound-orders/email/mailboxes/gmail/start?reconnectMailboxId=mailbox_enabled"),
      "reconnect Gmail start request",
    );
  });
});

describe("EmailSettings inbound ignore rule management", () => {
  test("adds an ignore rule with trimmed lowercase sender email values", async () => {
    await renderEmailSettings([]);

    await waitForText("Inbound Ignore Rules");
    const valueInput = container.querySelector("input[placeholder*='notifications@example.com']") as HTMLInputElement;
    const notesInput = container.querySelector("textarea[placeholder='Optional notes']") as HTMLTextAreaElement;

    await setValue(valueInput, "  Notifications@Example.COM  ");
    await setValue(notesInput, "  Processor notifications  ");

    const addButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Add Rule") as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });

    await waitForCondition(() => Boolean(getIgnoreRulePostBody()), "ignore rule POST");
    expect(getIgnoreRulePostBody()).toEqual({
      ruleType: "sender_email_exact",
      ruleValue: "notifications@example.com",
      notes: "Processor notifications",
      enabled: true,
    });
  });

  test("edits an existing ignore rule and can save it disabled", async () => {
    await renderEmailSettings([], [ignoreRule({
      id: "rule_1",
      ruleType: "subject_contains",
      ruleValue: "Payment Received",
      notes: "Old note",
      enabled: true,
    })]);

    await waitForText("Payment Received");
    const editButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Edit") as HTMLButtonElement;
    await act(async () => {
      editButton.click();
    });

    const typeSelect = container.querySelector("select[aria-label='Ignore rule type']") as HTMLSelectElement;
    const valueInput = container.querySelector("input[placeholder*='notifications@example.com']") as HTMLInputElement;
    const notesInput = container.querySelector("textarea[placeholder='Optional notes']") as HTMLTextAreaElement;
    const enabledSwitch = container.querySelector("input[aria-label='Ignore rule enabled']") as HTMLInputElement;

    await setValue(typeSelect, "sender_domain");
    await setValue(valueInput, "  Payments.Example.COM  ");
    await setValue(notesInput, "  Updated note  ");
    await act(async () => {
      enabledSwitch.click();
    });

    const saveButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Save Rule") as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });

    await waitForCondition(() => Boolean(getIgnoreRulePatchBody()), "ignore rule PATCH");
    expect(getIgnoreRulePatchBody()).toEqual({
      ruleType: "sender_domain",
      ruleValue: "payments.example.com",
      notes: "Updated note",
      enabled: false,
    });
  });

  test("toggles and deletes existing ignore rules", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    await renderEmailSettings([], [ignoreRule({
      id: "rule_1",
      ruleType: "sender_domain",
      ruleValue: "payments.example.com",
      enabled: true,
    })]);

    await waitForText("payments.example.com");
    const rowSwitch = container.querySelector("input[aria-label='Enable ignore rule payments.example.com']") as HTMLInputElement;
    await act(async () => {
      rowSwitch.click();
    });

    await waitForCondition(() => Boolean(getIgnoreRulePatchBody()), "ignore rule toggle PATCH");
    expect(getIgnoreRulePatchBody()).toEqual({ enabled: false });

    const deleteButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Delete") as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
    });

    await waitForCondition(
      () => apiFetchMock.mock.calls.some(([url, options]) => (
        String(url) === "/api/inbound-orders/email/ignore-rules/rule_1"
        && (options as RequestInit | undefined)?.method === "DELETE"
      )),
      "ignore rule DELETE",
    );
    confirmSpy.mockRestore();
  });

  test("blocks duplicate enabled ignore rules before submitting", async () => {
    await renderEmailSettings([], [ignoreRule({
      id: "rule_1",
      ruleType: "sender_email_exact",
      ruleValue: "notifications@example.com",
      enabled: true,
    })]);

    await waitForText("notifications@example.com");
    const valueInput = container.querySelector("input[placeholder*='notifications@example.com']") as HTMLInputElement;
    await setValue(valueInput, "  Notifications@Example.COM  ");

    const addButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Add Rule") as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });
    await flush();

    expect(getIgnoreRulePostBody()).toBeNull();
  });
});
