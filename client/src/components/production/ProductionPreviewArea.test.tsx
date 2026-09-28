/** @jest-environment jsdom */

import React, { act, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { ProductionPreviewArea, type ProductionPreviewSize } from "./ProductionPreviewArea";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Files = { artwork: number; production: number };

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function Harness({
  initial = { artwork: 2, production: 1 },
  onArtworkOpen = jest.fn(),
  onProductionOpen = jest.fn(),
  onDownload = jest.fn(),
}: {
  initial?: Files;
  onArtworkOpen?: () => void;
  onProductionOpen?: () => void;
  onDownload?: () => void;
}) {
  const [job, setJob] = useState({ id: "roll-1", ...initial });
  const [size, setSize] = useState<ProductionPreviewSize>("normal");
  const [filter, setFilter] = useState("all");

  return (
    <>
      <div data-testid="selected-job">{job.id}</div>
      <div data-testid="station-filter">{filter}</div>
      <button type="button" onClick={() => setFilter("queued")}>Filter queued</button>
      <button type="button" onClick={() => setJob({ id: "flatbed-2", artwork: 0, production: 1 })}>Select production-only job</button>
      <button type="button" onClick={() => setJob({ id: "roll-3", artwork: 1, production: 0 })}>Select artwork-only job</button>
      <ProductionPreviewArea
        jobId={job.id}
        size={size}
        artworkCount={job.artwork}
        productionFileCount={job.production}
        productionFileName={job.production ? "imposed-sheet.pdf" : null}
        productionFileStatus={job.production ? "available" : null}
        onSizeChange={setSize}
        artworkPreview={<button type="button" onClick={onArtworkOpen}>Open artwork viewer</button>}
        productionFilePreview={(
          <div>
            <button type="button" onClick={onProductionOpen}>Open production file</button>
            <button type="button" onClick={onDownload}>Download production file</button>
          </div>
        )}
      />
    </>
  );
}

describe("ProductionPreviewArea shared by Roll and Flatbed", () => {
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

  test("both files default to Original Artwork with only one mounted viewer", () => {
    act(() => root.render(<Harness />));
    expect(findButton(container, "Original Artwork")).toBeTruthy();
    expect(findButton(container, "Production File / Layout")).toBeTruthy();
    expect(container.querySelector('[data-testid="production-artwork-previews"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="production-file-previews"]')).toBeNull();
  });

  test("switching tabs preserves job and filter state and keeps file actions", () => {
    const onArtworkOpen = jest.fn();
    const onProductionOpen = jest.fn();
    const onDownload = jest.fn();
    act(() => root.render(<Harness onArtworkOpen={onArtworkOpen} onProductionOpen={onProductionOpen} onDownload={onDownload} />));
    act(() => findButton(container, "Filter queued").click());
    act(() => findButton(container, "Open artwork viewer").click());
    act(() => findButton(container, "Production File / Layout").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(container.querySelector('[data-testid="production-artwork-previews"]')).toBeNull();
    expect(container.querySelector('[data-testid="production-file-previews"]')).toBeTruthy();
    act(() => findButton(container, "Open production file").click());
    act(() => findButton(container, "Download production file").click());
    expect(onArtworkOpen).toHaveBeenCalledTimes(1);
    expect(onProductionOpen).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="selected-job"]')?.textContent).toBe("roll-1");
    expect(container.querySelector('[data-testid="station-filter"]')?.textContent).toBe("queued");
  });

  test("job switches fall back to the available viewer", () => {
    act(() => root.render(<Harness />));
    act(() => findButton(container, "Select production-only job").click());
    expect(container.querySelector('[data-testid="production-file-previews"]')).toBeTruthy();
    act(() => findButton(container, "Select artwork-only job").click());
    expect(container.querySelector('[data-testid="production-artwork-previews"]')).toBeTruthy();
  });

  test("artwork-only and production-only jobs default to useful content", () => {
    act(() => root.render(<Harness initial={{ artwork: 1, production: 0 }} />));
    expect(container.querySelector('[data-testid="production-artwork-previews"]')).toBeTruthy();
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Harness initial={{ artwork: 0, production: 1 }} />));
    expect(container.querySelector('[data-testid="production-file-previews"]')).toBeTruthy();
  });

  test("a job without either file shows a compact empty state", () => {
    act(() => root.render(<Harness initial={{ artwork: 0, production: 0 }} />));
    expect(container.textContent).toContain("No artwork or production file available for this job.");
    expect(container.querySelector('[data-testid="production-artwork-previews"]')).toBeNull();
    expect(container.querySelector('[data-testid="production-file-previews"]')).toBeNull();
  });

  test("size controls remain available and both stations use the shared viewer", () => {
    act(() => root.render(<Harness />));
    for (const label of ["compact", "normal", "large"]) expect(findButton(container, label)).toBeTruthy();
    for (const station of ["RollProductionView", "FlatbedProductionView"]) {
      const source = fs.readFileSync(path.join(process.cwd(), `client/src/features/production/views/${station}.tsx`), "utf8");
      expect(source).toContain("<ProductionPreviewArea");
      expect(source).toContain("jobId={job.id}");
      expect(source).toContain("productionFileCount={productionFiles.length}");
    }
  });
});
