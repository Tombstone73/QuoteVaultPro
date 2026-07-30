import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { expect, describe, jest, test } from "@jest/globals";

jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path }));
jest.mock("./AssistantWorkspaceProvider", () => ({ useAssistantWorkspace: () => ({}) }));

import { AssistantComposer } from "./AssistantWorkspace";
import { assistantTurnRequestBody } from "@/hooks/useAssistantApi";

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
});
