import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Order Detail line-item thumbnails contract", () => {
  test("exposes a user-toggleable display control while retaining the compact path", () => {
    const section = read("client/src/components/orders/OrderLineItemsSection.tsx");

    expect(section).toContain("Show thumbnails");
    expect(section).toContain('id="order-detail-show-thumbnails"');
    expect(section).toContain("showOrderLineThumbnails ?");
    expect(section).toContain("compactThumbnailNode");
  });

  test("renders multiple canonical derivative previews, with safe no-art and viewer paths", () => {
    const section = read("client/src/components/orders/OrderLineItemsSection.tsx");
    const preview = read("client/src/components/orders/OrderLineItemArtworkPreview.tsx");

    expect(section).toContain("expandedPreviewEntries.map");
    expect(section).toContain("previewThumbnailUrl: target.thumbnailUrl");
    expect(section).toContain("order-line-no-art-");
    expect(section).toContain("setArtworkViewerTarget");
    expect(preview).toContain('loading="lazy"');
    expect(preview).toContain("event.stopPropagation()");
    expect(preview).toContain("Thumbnail unavailable");
  });
});
