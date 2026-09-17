/** @jest-environment jsdom */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "@jest/globals";
import { PdfViewer } from "./PdfViewer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("passes a Blob URL directly to the native PDF object without application-path rewriting", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => { root.render(<PdfViewer viewerUrl="blob:invoice-preview" downloadUrl="/api/invoices/invoice_123/pdf?download=1" />); });
  expect(host.querySelector("object")?.getAttribute("data")).toBe("blob:invoice-preview");
  act(() => root.unmount());
});
