import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

const mockApiRequest = jest.fn(async (method: string) => ({ json: async () => method === "GET" ? { emailTemplates: {
  quoteEmailSubject: "Quote #{quoteNumber}", quoteEmailBody: "Hello {recipientName}",
  invoiceEmailSubject: "Invoice #{invoiceNumber} |", invoiceEmailBody: "Hello {customerName}",
} } : {} }));
jest.mock("@/lib/queryClient", () => ({ apiRequest: mockApiRequest, queryClient: { invalidateQueries: jest.fn() } }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/admin-settings", () => ({ EmailSettingsTab: () => null }));
import { EmailTemplatesCard } from "./email";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mockApiRequest.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function renderCard() {
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EmailTemplatesCard /></QueryClientProvider>));
  for (let i = 0; i < 10 && !container.querySelector('input[name="quoteEmailSubject"]'); i++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  }
}
function button(text: string) { return Array.from(container.querySelectorAll("button")).find(item => item.textContent?.trim() === text)!; }

test("shows Quote and Invoice variables, sample preview, and inserts at Subject and Body cursors", async () => {
  await renderCard();
  expect(container.textContent).toContain("{quoteNumber}");
  expect(container.textContent).not.toContain("{invoiceNumber} | PO");
  await act(async () => Simulate.click(button("Edit Templates")));
  await act(async () => Simulate.mouseDown(button("Invoice Template"), { button: 0, ctrlKey: false }));
  expect(container.textContent).toContain("{invoiceNumber}");
  expect(container.textContent).toContain("{poNumber}");
  expect(container.textContent).not.toContain("{quoteNumber}");
  const subject = container.querySelector('input[name="invoiceEmailSubject"]') as HTMLInputElement;
  await act(async () => { subject.focus(); subject.setSelectionRange(subject.value.length, subject.value.length); Simulate.select(subject); });
  await act(async () => Simulate.click(button("{poNumber}Linked Order customer PO number, if available")));
  expect(subject.value).toBe("Invoice #{invoiceNumber} |{poNumber}");
  const body = container.querySelector('textarea[name="invoiceEmailBody"]') as HTMLTextAreaElement;
  await act(async () => { body.focus(); body.setSelectionRange(6, 6); Simulate.select(body); });
  await act(async () => Simulate.click(button("{jobLabel}Customer-facing Quote or linked Order job label")));
  expect(body.value).toBe("Hello {jobLabel}{customerName}");
  expect(container.textContent).toContain("Sample Preview");
  expect(container.textContent).toContain("152594");
});

test("warns and refuses to save an unsupported variable", async () => {
  await renderCard();
  await act(async () => Simulate.click(button("Edit Templates")));
  const subject = container.querySelector('input[name="quoteEmailSubject"]') as HTMLInputElement;
  await act(async () => Simulate.change(subject, { target: { value: "Quote {jobNmae}" } } as any));
  expect(container.textContent).toContain("Unknown variable: {jobNmae}");
  await act(async () => Simulate.click(button("Save Templates")));
  expect(mockApiRequest.mock.calls.some(call => call[0] === "PUT")).toBe(false);
});
