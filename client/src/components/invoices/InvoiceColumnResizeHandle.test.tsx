import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InvoiceColumnResizeHandle } from "./InvoiceColumnResizeHandle";

function pointer(type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: 7 });
  return event;
}

test("drag previews width, persists on release, and never activates the header sort", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const sort = jest.fn();
  const preview = jest.fn();
  const commit = jest.fn();
  act(() => root.render(
    <div onClick={sort}>
      <InvoiceColumnResizeHandle label="Customer" width={220} onPreview={preview} onCommit={commit} />
    </div>,
  ));
  const handle = host.querySelector('[role="separator"]') as HTMLElement;

  act(() => {
    handle.dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointermove", 125));
  });
  expect(preview).toHaveBeenLastCalledWith(245);
  expect(commit).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(pointer("pointerup", 130));
    handle.click();
  });
  expect(commit).toHaveBeenLastCalledWith(250);
  expect(sort).not.toHaveBeenCalled();

  act(() => root.unmount());
  host.remove();
});

test("keyboard resizing commits without sorting", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const sort = jest.fn();
  const commit = jest.fn();
  act(() => root.render(
    <div onKeyDown={sort}>
      <InvoiceColumnResizeHandle label="Customer" width={220} onPreview={() => {}} onCommit={commit} />
    </div>,
  ));
  const handle = host.querySelector('[role="separator"]') as HTMLElement;
  act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(commit).toHaveBeenCalledWith(230);
  expect(sort).not.toHaveBeenCalled();
  act(() => root.unmount());
  host.remove();
});
