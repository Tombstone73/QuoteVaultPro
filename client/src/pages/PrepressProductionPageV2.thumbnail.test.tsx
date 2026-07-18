import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";

import { PrepressFileThumbnail } from "@/components/prepress/PrepressFileThumbnail";

jest.mock("@/lib/apiConfig", () => ({
  resolveObjectsPublicUrl: (value: string) => value,
}));

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

function renderThumbnail(props: React.ComponentProps<typeof PrepressFileThumbnail>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PrepressFileThumbnail {...props} />
    </QueryClientProvider>,
  );
}

describe("Prepress final production thumbnail", () => {
  test("renders the generated final PDF thumbnail", () => {
    const html = renderThumbnail({
      fileId: "file_1",
      filename: "imposed-sheet.pdf",
      mimeType: "application/pdf",
      thumbnailUrl: "/objects/generated-thumb.jpg",
      thumbnailAvailabilityStatus: "available",
    });

    expect(html).toContain("generated-thumb.jpg");
    expect(html).toContain("<img");
  });

  test("shows preview processing for a pending PDF derivative", () => {
    const html = renderThumbnail({
      fileId: "file_1",
      filename: "imposed-sheet.pdf",
      mimeType: "application/pdf",
      thumbnailAvailabilityStatus: "pending",
    });

    expect(html).toContain("Preview processing");
    expect(html).not.toContain("<img");
  });

  test("shows the PDF placeholder after preview failure", () => {
    const html = renderThumbnail({
      fileId: "file_1",
      filename: "imposed-sheet.pdf",
      mimeType: "application/pdf",
      thumbnailAvailabilityStatus: "missing",
    });

    expect(html).toContain("PDF");
    expect(html).not.toContain("<img");
  });
});
