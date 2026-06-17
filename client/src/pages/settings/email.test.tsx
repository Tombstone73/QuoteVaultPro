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

async function renderEmailSettings(mailboxes: unknown[]) {
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
  apiFetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/api/inbound-orders/email/mailboxes/gmail/start")) {
      return await new Promise(() => undefined) as any;
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
