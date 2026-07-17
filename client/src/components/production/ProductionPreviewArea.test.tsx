import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

import { ProductionPreviewArea } from "./ProductionPreviewArea";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

describe("ProductionPreviewArea", () => {
  test("collapsed state preserves a compact file summary and hides preview content", () => {
    const html = renderToStaticMarkup(
      <ProductionPreviewArea
        collapsed
        size="normal"
        artworkCount={2}
        productionFileName="imposed-sheet.pdf"
        productionFileStatus="available"
        onToggle={jest.fn()}
        onSizeChange={jest.fn()}
      >
        <div>preview-content</div>
      </ProductionPreviewArea>,
    );

    expect(html).toContain("2 artwork files");
    expect(html).toContain("imposed-sheet.pdf");
    expect(html).toContain("Expand previews");
    expect(html).not.toContain("preview-content");
  });

  test("expanded state renders previews and size controls", () => {
    const html = renderToStaticMarkup(
      <ProductionPreviewArea
        collapsed={false}
        size="compact"
        artworkCount={1}
        productionFileName="imposed-sheet.pdf"
        productionFileStatus="pending"
        onToggle={jest.fn()}
        onSizeChange={jest.fn()}
      >
        <div>preview-content</div>
      </ProductionPreviewArea>,
    );

    expect(html).toContain("preview-content");
    expect(html).toContain("Preview processing");
    expect(html).toContain(">compact</button>");
    expect(html).toContain("Collapse previews");
  });
});
