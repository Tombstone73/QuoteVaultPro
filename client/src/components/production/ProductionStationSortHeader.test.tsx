/** @jest-environment jsdom */

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import { ProductionStationSortHeader, useProductionStationSort } from "./ProductionStationSortHeader";
import type { ProductionStationPage } from "@/lib/productionBoard";

jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "operator-1" } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ station }: { station: ProductionStationPage }) {
  const { sort, toggleSort } = useProductionStationSort(station);
  const [selectedJob, setSelectedJob] = useState("work-1");
  return (
    <>
      <p data-testid="selected-job">{selectedJob}</p>
      <button onClick={() => setSelectedJob("work-2")}>Select another job</button>
      <table><thead><tr>
        <th>SELECT</th>
        <ProductionStationSortHeader field="customer" sort={sort} onSort={toggleSort}>CLIENT</ProductionStationSortHeader>
        <ProductionStationSortHeader field="due" sort={sort} onSort={toggleSort}>DUE DATE</ProductionStationSortHeader>
        <th>ART</th>
      </tr></thead></table>
    </>
  );
}

describe("production station sort headers and persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  test("clicks show direction, leave action headers inert, and retain selected job", () => {
    act(() => root.render(<Harness station="roll" />));
    const due = () => container.querySelector('th[aria-sort]:has(button[aria-label^="Sort by DUE DATE"])');
    expect(due()?.getAttribute("aria-sort")).toBe("none");
    const dueButton = container.querySelector('button[aria-label^="Sort by DUE DATE"]') as HTMLButtonElement;
    act(() => dueButton.click());
    expect(due()?.getAttribute("aria-sort")).toBe("ascending");
    act(() => dueButton.click());
    expect(due()?.getAttribute("aria-sort")).toBe("descending");
    expect(container.querySelectorAll('th[aria-sort]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="selected-job"]')?.textContent).toBe("work-1");
  });

  test("Roll and Flatbed restore separate saved sorts across navigation and remount", () => {
    act(() => root.render(<Harness station="roll" />));
    act(() => (container.querySelector('button[aria-label^="Sort by CLIENT"]') as HTMLButtonElement).click());
    act(() => root.render(<Harness station="flatbed" />));
    act(() => (container.querySelector('button[aria-label^="Sort by DUE DATE"]') as HTMLButtonElement).click());
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Harness station="roll" />));
    expect(container.querySelector('button[aria-label^="Sort by CLIENT"]')?.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    act(() => root.render(<Harness station="flatbed" />));
    expect(container.querySelector('button[aria-label^="Sort by DUE DATE"]')?.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
  });
});
