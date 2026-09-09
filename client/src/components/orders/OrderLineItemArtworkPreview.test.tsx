import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, jest, test } from "@jest/globals";

import { OrderLineItemArtworkPreview } from "./OrderLineItemArtworkPreview";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderLineItemArtworkPreview", () => {
  test("the rendered Order Detail thumbnail passes the canonical file record without parent navigation", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const openArtwork = jest.fn();
    const navigateParent = jest.fn();

    try {
      await act(async () => {
        root.render(
          <div onClick={navigateParent}>
            <OrderLineItemArtworkPreview
              lineNumber={3}
              thumbnailUrl="https://signed.example.test/thumb?expires=old"
              totalCount={2}
              target={{ fileRecordId: "canonical-file-3", artworkId: "artwork-assignment-3", attachmentId: "legacy-attachment-3" }}
              onOpenArtwork={openArtwork}
            />
          </div>,
        );
      });

      const thumbnail = host.querySelector('button[aria-label="View artwork for Line 3"]') as HTMLButtonElement;
      await act(async () => {
        thumbnail.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(openArtwork).toHaveBeenCalledWith({
        fileRecordId: "canonical-file-3",
        artworkId: "artwork-assignment-3",
        attachmentId: "legacy-attachment-3",
      });
      expect(navigateParent).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
