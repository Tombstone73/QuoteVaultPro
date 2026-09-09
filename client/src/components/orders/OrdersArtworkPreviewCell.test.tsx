import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, jest, test } from "@jest/globals";

import { OrdersArtworkPreviewCell } from "./OrdersArtworkPreviewCell";

jest.mock("@/lib/getThumbSrc", () => ({
  getThumbSrc: (value: any) => value?.thumbnailUrl ?? null,
}));

jest.mock("@/lib/apiConfig", () => ({
  resolveObjectsPublicUrl: (value: string) => value,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("OrdersArtworkPreviewCell", () => {
  test("a rendered Preview thumbnail opens its canonical viewer target without triggering row navigation", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const openArtwork = jest.fn();
    const navigateRow = jest.fn();

    try {
      await act(async () => {
        root.render(
          <div onClick={navigateRow}>
            <OrdersArtworkPreviewCell
              row={{
                id: "order-1",
                attachmentsSummary: {
                  totalCount: 2,
                  previews: [
                    { id: "attachment-a", filename: "front.pdf", thumbnailUrl: "/objects/front-thumb.png" },
                    { id: "attachment-b", filename: "back.pdf", thumbnailUrl: "/objects/back-thumb.png" },
                  ],
                },
              } as any}
              includeThumbnails
              loading={false}
              onOpenArtwork={openArtwork}
            />
          </div>,
        );
      });

      const selectedPreview = host.querySelector('button[aria-label="Open artwork viewer for back.pdf"]') as HTMLButtonElement;
      expect(selectedPreview).not.toBeNull();

      await act(async () => {
        selectedPreview.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(openArtwork).toHaveBeenCalledWith("order-1", {
        attachmentId: "attachment-b",
        thumbnailUrl: "/objects/back-thumb.png",
      });
      expect(navigateRow).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain("No attachments");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
