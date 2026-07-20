import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { QuoteRecipientFallbackDialog } from "./QuoteRecipientFallbackDialog";

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ id, checked, onCheckedChange }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <button id={id}>{children}</button>,
  SelectValue: () => <span>Customer contact</span>,
}));

describe("QuoteRecipientFallbackDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("renders editable default subject/body and submits staff edits", () => {
    const onSubmit = jest.fn();
    act(() => root.render(
      <QuoteRecipientFallbackDialog
        open
        contacts={[]}
        initialRecipientEmail="mike@example.com"
        initialRecipientName="Mike"
        initialSubject="Quote QT-20000 from Titan Graphics"
        initialBody="Hello Mike, please review the quote."
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />,
    ));

    const subject = container.querySelector("#quote-email-subject") as HTMLInputElement;
    const body = container.querySelector("#quote-email-body") as HTMLTextAreaElement;
    expect(subject.value).toBe("Quote QT-20000 from Titan Graphics");
    expect(body.value).toBe("Hello Mike, please review the quote.");

    act(() => {
      Simulate.change(subject, { target: { value: "Updated quote subject" } } as any);
      Simulate.change(body, { target: { value: "Please review the revised amount." } } as any);
    });
    const sendButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Send Quote") as HTMLButtonElement;
    act(() => sendButton.click());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: "mike@example.com",
      subject: "Updated quote subject",
      body: "Please review the revised amount.",
      attachPdf: true,
    }));
  });
});
