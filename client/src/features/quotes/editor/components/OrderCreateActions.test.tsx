import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { OrderCreateActions } from "./OrderCreateActions";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test.each([false, true])("relocated create actions retain callbacks and guards (inline %s)", (inline) => {
  const onSave = jest.fn(); const onDiscard = jest.fn();
  const render = (canSaveQuote: boolean, isSaving: boolean) => act(() => root.render(
    <OrderCreateActions {...{ inline, canSaveQuote, isSaving, onSave, onDiscard }} />,
  ));
  render(false, false);
  let [save, discard] = Array.from(host.querySelectorAll("button"));
  expect(save.disabled).toBe(true);
  expect(discard.disabled).toBe(false);
  act(() => save.click()); expect(onSave).not.toHaveBeenCalled();
  render(true, false);
  [save, discard] = Array.from(host.querySelectorAll("button"));
  act(() => { save.click(); discard.click(); });
  expect(onSave).toHaveBeenCalledTimes(1); expect(onDiscard).toHaveBeenCalledTimes(1);
  render(true, true);
  [save, discard] = Array.from(host.querySelectorAll("button"));
  expect(save.disabled).toBe(true); expect(discard.disabled).toBe(true);
  expect(save.textContent).toContain("Creating Order");
  act(() => { save.click(); discard.click(); });
  expect(onSave).toHaveBeenCalledTimes(1); expect(onDiscard).toHaveBeenCalledTimes(1);
});

test("retains configured labels and optional discard visibility", () => {
  act(() => root.render(<OrderCreateActions canSaveQuote isSaving={false} onSave={jest.fn()} onDiscard={jest.fn()}
    showDiscard={false} primaryActionLabel="Submit order" />));
  expect(host.querySelectorAll("button")).toHaveLength(1);
  expect(host.textContent).toBe("Submit order");
});
