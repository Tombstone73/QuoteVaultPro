import React from "react";
import { describe, expect, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";
import { LineItemAttachmentsPanel } from "./LineItemAttachmentsPanel";

jest.mock("@/lib/apiConfig", () => ({
  objectsUrl: (value: string) => value,
  resolveObjectsPublicUrl: (value: string) => value,
}));

jest.mock("@/lib/getThumbSrc", () => ({ getThumbSrc: () => null }));

jest.mock("@/components/AttachmentViewerDialog", () => ({
  AttachmentViewerDialog: () => null,
}));

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

function renderPanel(doubleSided: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/orders/order-1/line-items/line-1/files"], [
    {
      id: "art-front",
      source: "attachment",
      fileName: "front.pdf",
      fileUrl: "/objects/front.pdf",
      mimeType: "application/pdf",
      createdAt: "2026-07-16T00:00:00.000Z",
      side: "front",
    },
  ]);

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LineItemAttachmentsPanel
        quoteId={null}
        parentType="order"
        orderId="order-1"
        lineItemId="line-1"
        defaultExpanded
        doubleSided={doubleSided}
      />
    </QueryClientProvider>,
  );
}

describe("LineItemAttachmentsPanel double-sided artwork controls", () => {
  test("shows explicit Front/Back assignment controls only for double-sided line items", () => {
    const doubleSided = renderPanel(true);
    expect(doubleSided).toContain("Use same artwork on both sides");
    expect(doubleSided).toContain("Front artwork");
    expect(doubleSided).toContain("Back artwork");
    expect(doubleSided).toContain("Back artwork not assigned");

    const singleSided = renderPanel(false);
    expect(singleSided).not.toContain("Use same artwork on both sides");
  });
});
