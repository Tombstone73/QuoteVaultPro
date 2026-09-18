import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockUseInvoiceEmailRecipients = jest.fn();
const mockUseInvoiceEmailDraft = jest.fn();
const mockUseSendInvoice = jest.fn();
const mockToast = jest.fn();
let selectRecipient = (_email: string) => undefined;

jest.mock("@/hooks/useInvoices", () => ({
  useInvoiceEmailRecipients: mockUseInvoiceEmailRecipients,
  useInvoiceEmailDraft: mockUseInvoiceEmailDraft,
  useSendInvoice: mockUseSendInvoice,
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogClose: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <section>{children}</section>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: any) => <>{children}</>,
}));
jest.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => {
    selectRecipient = onValueChange;
    return <div data-testid="customer-email-select">{children}</div>;
  },
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, id }: any) => <div id={id}>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

import { InvoiceEmailSendDialog } from "./InvoiceEmailSendDialog";

type Recipient = { name: string; email: string; source: "billing_contact" };
const recipients: Recipient[] = [
  { name: "Jessica Selzer", email: "jess@brainstormprint.com", source: "billing_contact" },
  { name: "John Smith", email: "john@brainstormprint.com", source: "billing_contact" },
  { name: "Maya Chen", email: "maya@brainstormprint.com", source: "billing_contact" },
];

let container: HTMLDivElement;
let root: Root;
let sendMutation: ReturnType<typeof jest.fn>;

function configureRecipients(items: Recipient[], options: { loading?: boolean; error?: boolean } = {}) {
  mockUseInvoiceEmailRecipients.mockReturnValue({
    data: options.loading || options.error ? undefined : { recipients: items, defaultRecipient: items[0] ?? null },
    isLoading: options.loading === true,
    isError: options.error === true,
  });
}

async function renderDialog() {
  await act(async () => {
    root.render(<InvoiceEmailSendDialog invoiceId="invoice-1" open onOpenChange={jest.fn()} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function changeManualEmail(value: string) {
  const input = container.querySelector("#invoice-other-email") as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function changeComposeField(id: string, value: string) {
  const input = container.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  sendMutation = jest.fn().mockResolvedValue({});
  mockUseSendInvoice.mockReturnValue({ mutateAsync: sendMutation, isPending: false });
  mockUseInvoiceEmailRecipients.mockReset();
  mockUseInvoiceEmailDraft.mockReset();
  mockUseInvoiceEmailDraft.mockReturnValue({
    data: { subject: "Invoice #20469 from Titan Graphics", message: "Dear Brainstorm Print,\n\nPlease find attached Invoice #20469." },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockToast.mockReset();
  selectRecipient = () => undefined;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

describe("InvoiceEmailSendDialog recipients", () => {
  test("loads the server-owned draft and submits staff edits", async () => {
    configureRecipients(recipients.slice(0, 1));
    await renderDialog();

    expect((container.querySelector("#invoice-email-subject") as HTMLInputElement).value).toBe("Invoice #20469 from Titan Graphics");
    expect((container.querySelector("#invoice-email-message") as HTMLTextAreaElement).value).toContain("Dear Brainstorm Print");
    await changeComposeField("invoice-email-subject", "Paid Invoice #20469 for your records");
    await changeComposeField("invoice-email-message", "Thank you for your payment.\nThis copy is for your records.");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send") as HTMLButtonElement).click(); await Promise.resolve(); });

    expect(sendMutation).toHaveBeenCalledWith({
      id: "invoice-1",
      allowUnapproved: false,
      subject: "Paid Invoice #20469 for your records",
      message: "Thank you for your payment.\nThis copy is for your records.",
    });
  });

  test("shows the configured recipient's name and email", async () => {
    configureRecipients(recipients.slice(0, 1));
    await renderDialog();
    expect(container.textContent).toContain("1 configured invoice recipient");
    expect(container.textContent).toContain("Jessica Selzer");
    expect(container.textContent).toContain("jess@brainstormprint.com");
  });

  test.each([2, 3])("shows every configured recipient when %s recipients will receive the invoice", async (count) => {
    configureRecipients(recipients.slice(0, count));
    await renderDialog();
    expect(container.textContent).toContain(`${count} configured invoice recipients`);
    recipients.slice(0, count).forEach((recipient) => {
      expect(container.textContent).toContain(recipient.name);
      expect(container.textContent).toContain(recipient.email);
    });
  });

  test("shows only a saved-email override and preserves its single-address send payload", async () => {
    configureRecipients(recipients.slice(0, 2));
    await renderDialog();
    await act(async () => { selectRecipient("john@brainstormprint.com"); await Promise.resolve(); });

    const targets = container.querySelector('[data-testid="invoice-send-targets"]')?.textContent || "";
    expect(targets).toContain("John Smith");
    expect(targets).toContain("john@brainstormprint.com");
    expect(targets).not.toContain("2 configured invoice recipients");
    expect(targets).not.toContain("Jessica Selzer");

    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send") as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(sendMutation).toHaveBeenCalledWith(expect.objectContaining({ id: "invoice-1", toEmail: "john@brainstormprint.com", allowUnapproved: false }));
  });

  test("shows only a one-time manual recipient and restores configured recipients after it is cleared", async () => {
    configureRecipients(recipients.slice(0, 2));
    await renderDialog();
    await changeManualEmail("one-time@example.com");
    const manualTargets = container.querySelector('[data-testid="invoice-send-targets"]')?.textContent || "";
    expect(manualTargets).toContain("One-time recipient");
    expect(manualTargets).toContain("one-time@example.com");
    expect(manualTargets).not.toContain("2 configured invoice recipients");

    await changeManualEmail("");
    const configuredTargets = container.querySelector('[data-testid="invoice-send-targets"]')?.textContent || "";
    expect(configuredTargets).toContain("2 configured invoice recipients");
    expect(configuredTargets).toContain("Jessica Selzer");
    expect(configuredTargets).toContain("John Smith");
  });

  test("keeps the all-configured recipient send payload unchanged", async () => {
    configureRecipients(recipients.slice(0, 2));
    await renderDialog();
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send") as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(sendMutation).toHaveBeenCalledWith(expect.objectContaining({ id: "invoice-1", allowUnapproved: false }));
  });

  test("preserves loading and empty recipient states", async () => {
    configureRecipients([], { loading: true });
    await renderDialog();
    expect(container.textContent).toContain("Resolving recipient…");

    configureRecipients([]);
    await renderDialog();
    expect(container.textContent).toContain("No recipient selected");
    expect(container.textContent).toContain("No saved customer email is available for this invoice.");
  });

  test("keeps edits for an unapproved Send Anyway retry", async () => {
    configureRecipients(recipients.slice(0, 1));
    const approvalError = Object.assign(new Error("Approval required"), { code: "INVOICE_APPROVAL_REQUIRED" });
    sendMutation.mockRejectedValueOnce(approvalError).mockResolvedValueOnce({});
    await renderDialog();
    await changeComposeField("invoice-email-message", "Custom approval-safe note");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send") as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(container.textContent).toContain("Send Unapproved Invoice?");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send Anyway") as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(sendMutation).toHaveBeenLastCalledWith(expect.objectContaining({ allowUnapproved: true, message: "Custom approval-safe note" }));
  });

  test("shows a retryable compose error instead of a blank email", async () => {
    configureRecipients(recipients.slice(0, 1));
    const refetch = jest.fn();
    mockUseInvoiceEmailDraft.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    await renderDialog();
    expect(container.textContent).toContain("Unable to prepare invoice email");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry") as HTMLButtonElement).click(); await Promise.resolve(); });
    expect(refetch).toHaveBeenCalled();
  });

  test("retains edits after an ordinary failed send so staff can retry", async () => {
    configureRecipients(recipients.slice(0, 1));
    sendMutation.mockRejectedValueOnce(new Error("Provider unavailable"));
    await renderDialog();
    await changeComposeField("invoice-email-message", "Please keep this note for the retry.");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send") as HTMLButtonElement).click(); await Promise.resolve(); });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invoice send failed" }));
    expect((container.querySelector("#invoice-email-message") as HTMLTextAreaElement).value).toBe("Please keep this note for the retry.");
  });
});
