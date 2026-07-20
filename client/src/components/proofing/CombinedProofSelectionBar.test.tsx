/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { CombinedProofSelectionBar } from "./CombinedProofSelectionBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CombinedProofSelectionBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("one selected line exposes select all for the matching job", () => {
    const onSelectAll = jest.fn();
    const onClear = jest.fn();
    act(() => root.render(
      <CombinedProofSelectionBar
        selectedCount={1}
        jobLabel="#20004"
        matchingCount={3}
        onSelectAll={onSelectAll}
        onClear={onClear}
      />,
    ));

    expect(container.textContent).toContain("1 selected");
    const selectAll = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Select all for job #20004"));
    expect(selectAll).toBeTruthy();
    act(() => (selectAll as HTMLButtonElement).click());
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  test("all matching lines selected keeps clear available without another select-all action", () => {
    const onClear = jest.fn();
    act(() => root.render(
      <CombinedProofSelectionBar
        selectedCount={3}
        jobLabel="#20004"
        matchingCount={3}
        onSelectAll={jest.fn()}
        onClear={onClear}
      />,
    ));

    expect(container.textContent).not.toContain("Select all for job");
    const clear = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clear selection"));
    act(() => (clear as HTMLButtonElement).click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
