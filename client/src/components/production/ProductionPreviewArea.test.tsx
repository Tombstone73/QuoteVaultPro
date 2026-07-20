/** @jest-environment jsdom */

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { ProductionPreviewArea, type ProductionPreviewSize } from "./ProductionPreviewArea";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function Harness({ onArtworkOpen = jest.fn(), onProductionOpen = jest.fn(), onDownload = jest.fn() }) {
  const [artworkCollapsed, setArtworkCollapsed] = useState(false);
  const [productionFileCollapsed, setProductionFileCollapsed] = useState(false);
  const [size, setSize] = useState<ProductionPreviewSize>("normal");

  return (
    <ProductionPreviewArea
      artworkCollapsed={artworkCollapsed}
      productionFileCollapsed={productionFileCollapsed}
      size={size}
      artworkCount={2}
      productionFileName="imposed-sheet.pdf"
      productionFileStatus="available"
      onToggleArtwork={() => setArtworkCollapsed((current) => !current)}
      onToggleProductionFile={() => setProductionFileCollapsed((current) => !current)}
      onSizeChange={setSize}
      artworkPreview={<button type="button" onClick={onArtworkOpen}>Open artwork viewer</button>}
      productionFilePreview={(
        <div>
          <button type="button" onClick={onProductionOpen}>Open</button>
          <button type="button" onClick={onDownload}>Download</button>
        </div>
      )}
    />
  );
}

describe("ProductionPreviewArea", () => {
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

  test("artwork and production file sections collapse independently", () => {
    act(() => root.render(<Harness />));

    act(() => findButton(container, "Collapse Artwork").click());
    expect(container.textContent).not.toContain("Open artwork viewer");
    expect(container.textContent).toContain("Open");
    expect(container.textContent).toContain("Download");

    act(() => findButton(container, "Collapse Production File").click());
    expect(container.textContent).not.toContain("Download");
    expect(container.textContent).toContain("Show Artwork");
    expect(container.textContent).toContain("Show Production File");
    expect(findButton(container, "compact")).toBeTruthy();
    expect(findButton(container, "normal")).toBeTruthy();
    expect(findButton(container, "large")).toBeTruthy();

    act(() => findButton(container, "Show Artwork").click());
    act(() => findButton(container, "Show Production File").click());
    expect(container.textContent).toContain("Open artwork viewer");
    expect(container.textContent).toContain("Download");
  });

  test("size presets and visible preview actions remain available", () => {
    const onArtworkOpen = jest.fn();
    const onProductionOpen = jest.fn();
    const onDownload = jest.fn();
    act(() => root.render(<Harness onArtworkOpen={onArtworkOpen} onProductionOpen={onProductionOpen} onDownload={onDownload} />));

    for (const label of ["compact", "normal", "large"]) expect(findButton(container, label)).toBeTruthy();
    act(() => findButton(container, "large").click());
    expect(container.textContent).toContain("Open artwork viewer");

    act(() => findButton(container, "Open artwork viewer").click());
    act(() => findButton(container, "Open").click());
    act(() => findButton(container, "Download").click());
    expect(onArtworkOpen).toHaveBeenCalledTimes(1);
    expect(onProductionOpen).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});
