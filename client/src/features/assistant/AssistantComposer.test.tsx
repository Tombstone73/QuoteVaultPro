import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, expect, describe, jest, test } from "@jest/globals";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS } from "@shared/assistantContracts";
import { syntheticLongOrder } from "../../../../server/tests/helpers/assistantLongOrderFixture";

jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path }));
jest.mock("./AssistantWorkspaceProvider", () => ({ useAssistantWorkspace: () => ({}) }));

import { AssistantComposer } from "./AssistantWorkspace";
import { assistantTurnFailureMessage, assistantTurnRequestBody } from "@/hooks/useAssistantApi";
import { ApiRequestError } from "@/lib/queryClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const matrix = `| Thickness | Single-sided | Double-sided |
| --- | --- | --- |
| 3mm | $4.50 | $5.75 |
| 6mm | $6.25 | $7.75 |
| 12mm | $9.75 | $11.50 |
| 18mm | $12.50 | $14.75 |`;

function renderComposer(initialValue = "", onRequestSend = jest.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [value, setValue] = React.useState(initialValue);
    return <form onSubmit={(event) => { event.preventDefault(); onRequestSend(value); }}><AssistantComposer value={value} onChange={setValue} onRequestSend={() => onRequestSend(value)} disabled={false} placeholder="Ask about this workspace" /></form>;
  }
  act(() => root.render(<Harness />));
  return { container, root, onRequestSend };
}

describe("Assistant composer", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  test("retains a 100-line Order beyond the former paste limit, including whitespace and attachment references", () => {
    const message = syntheticLongOrder(100), view = renderComposer(message);
    const textarea = view.container.querySelector("textarea")!;
    expect(message.length).toBeGreaterThan(8000);
    expect(textarea.hasAttribute("maxlength")).toBe(false);
    expect(textarea.value).toBe(message);
    act(() => Simulate.keyDown(textarea, { key: "Enter", shiftKey: false } as any));
    expect(view.onRequestSend).toHaveBeenCalledWith(message);
    const context = { contextVersion: "v1" as const, route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-11-04T00:00:00.000Z", unsavedChanges: false };
    const refs = ["a", "b", "c", "d"];
    expect(assistantTurnRequestBody(message, context, "request_1", refs)).toMatchObject({ message, attachmentIds: refs, clientRequestId: "request_1" });
    act(() => view.root.unmount());
  });

  test("oversize input remains complete, has an accessible error, and can be corrected without sending", () => {
    const message = "x".repeat(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS + 1), view = renderComposer(message);
    const textarea = view.container.querySelector("textarea")!;
    expect(textarea.value).toBe(message);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("No input was truncated");
    expect((view.container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => Simulate.keyDown(textarea, { key: "Enter" } as any));
    expect(view.onRequestSend).not.toHaveBeenCalled();
    act(() => Simulate.change(textarea, { target: { value: "Corrected request" } } as any));
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect((view.container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(false);
    act(() => view.root.unmount());
  });

  test("input and task-storage failures give safe retained-draft guidance", () => {
    for (const code of ["message_too_long", "task_persistence_failed"]) {
      const message = assistantTurnFailureMessage(new ApiRequestError("private SQL and Order text", 503, code, "ref_123"));
      expect(message).toContain("retained"); expect(message).toContain("ref_123");
      expect(message).not.toContain("private SQL");
    }
  });

  test("preserves pasted Markdown-table rows and submits the original multiline body", () => {
    const view = renderComposer();
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement;
    const form = view.container.querySelector("form") as HTMLFormElement;

    act(() => Simulate.change(textarea, { target: { value: matrix } } as any));
    expect(textarea.value).toBe(matrix);
    expect(textarea.value.split("\n")).toHaveLength(6);

    act(() => Simulate.submit(form));
    expect(view.onRequestSend).toHaveBeenCalledWith(matrix);
    expect(assistantTurnRequestBody(matrix, { contextVersion: "v1", route: "/dashboard", pageTitle: "Dashboard", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-30T00:00:00.000Z", unsavedChanges: false })).toMatchObject({ message: matrix });
    act(() => view.root.unmount());
  });

  test("preserves CSV-style line breaks and sends normal Enter messages", () => {
    const csv = "Thickness,Single-sided,Double-sided\n3mm,$4.50,$5.75\n6mm,$6.25,$7.75";
    const view = renderComposer(csv);
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement;

    expect(textarea.value).toBe(csv);
    act(() => Simulate.keyDown(textarea, { key: "Enter", shiftKey: false } as any));
    expect(view.onRequestSend).toHaveBeenCalledWith(csv);
    act(() => view.root.unmount());
  });

  test("inserts a newline with Shift+Enter without sending", () => {
    const view = renderComposer("Matrix");
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 6);

    act(() => Simulate.keyDown(textarea, { key: "Enter", shiftKey: true } as any));
    expect(textarea.value).toBe("Matrix\n");
    expect(view.onRequestSend).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });

  test("keeps single-line messages usable and prevents empty sends", () => {
    const empty = renderComposer("   ");
    const emptyTextarea = empty.container.querySelector("textarea") as HTMLTextAreaElement;
    const emptyButton = empty.container.querySelector("button") as HTMLButtonElement;
    expect(emptyButton.disabled).toBe(true);
    act(() => Simulate.keyDown(emptyTextarea, { key: "Enter", shiftKey: false } as any));
    expect(empty.onRequestSend).not.toHaveBeenCalled();
    act(() => empty.root.unmount());

    const single = renderComposer("Are any production jobs overdue?");
    const singleTextarea = single.container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => Simulate.keyDown(singleTextarea, { key: "Enter", shiftKey: false } as any));
    expect(single.onRequestSend).toHaveBeenCalledWith("Are any production jobs overdue?");
    act(() => single.root.unmount());
  });

  test("offers an immediate Stop control during an active turn without submitting", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onStop = jest.fn();
    const onSend = jest.fn();
    act(() => root.render(<form onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      <AssistantComposer value="yes" onChange={jest.fn()} onRequestSend={onSend} onStop={onStop} turnPending disabled placeholder="Ask" />
    </form>));
    const stop = container.querySelector('button[aria-label="Stop generating"]') as HTMLButtonElement;
    expect(stop).not.toBeNull();
    expect(stop.disabled).toBe(false);
    expect(container.querySelector('button[aria-label="Send message"]')).toBeNull();
    act(() => Simulate.click(stop));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test("shows the persistence failure boundary and correlation reference without raw server text", () => {
    const error = new ApiRequestError("503: sensitive response", 503, "message_persistence_failed", "corr_123");
    const message = assistantTurnFailureMessage(error);
    expect(message).toContain("could not confirm this turn was saved");
    expect(message).toContain("message is preserved");
    expect(message).toContain("corr_123");
    expect(message).not.toContain("sensitive response");
  });
});
