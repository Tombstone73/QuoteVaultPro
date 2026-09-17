/** @jest-environment jsdom */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { apiFetch } from "@/lib/queryClient";
import { useInvoicePdfPreview } from "./useInvoicePdfPreview";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function response(options: { ok?: boolean; status?: number; contentType?: string; body?: Blob } = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? (options.contentType ?? "application/pdf") : null },
    blob: async () => options.body ?? new Blob(["%PDF-1.7"], { type: "application/pdf" }),
  } as Response;
}

function PreviewFixture({ url, open }: { url: string; open: boolean }) {
  const preview = useInvoicePdfPreview(url, open);
  return <div><span data-state={preview.state}>{preview.previewUrl ?? ""}</span><span>{preview.error ?? ""}</span><button onClick={preview.retry}>Retry</button></div>;
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("useInvoicePdfPreview", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    mockedApiFetch.mockReset();
    URL.createObjectURL = jest.fn(() => "blob:invoice-preview");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  test("fetches the invoice PDF through the canonical API client and supplies a Blob URL", async () => {
    mockedApiFetch.mockResolvedValue(response({ body: new Blob(["%PDF-1.7"], { type: "application/pdf" }) }));

    await act(async () => { root.render(<PreviewFixture url="/api/invoices/invoice_123/pdf" open />); });
    await flush();

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/invoices/invoice_123/pdf", {
      method: "GET", credentials: "include", headers: { Accept: "application/pdf" },
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("ready");
    expect(host.textContent).toContain("blob:invoice-preview");
  });

  test("revokes the preview when the modal closes and when its invoice changes", async () => {
    (URL.createObjectURL as jest.Mock).mockReturnValueOnce("blob:invoice-one").mockReturnValueOnce("blob:invoice-two");
    mockedApiFetch.mockResolvedValue(response());
    await act(async () => { root.render(<PreviewFixture url="/api/invoices/invoice_one/pdf" open />); });
    await flush();
    await act(async () => { root.render(<PreviewFixture url="/api/invoices/invoice_two/pdf" open />); });
    await flush();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:invoice-one");
    await act(async () => { root.render(<PreviewFixture url="/api/invoices/invoice_two/pdf" open={false} />); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:invoice-two");
  });

  test("shows a failed state and retries the canonical PDF request", async () => {
    mockedApiFetch.mockResolvedValueOnce(response({ ok: false, status: 502 })).mockResolvedValueOnce(response());
    await act(async () => { root.render(<PreviewFixture url="/api/invoices/invoice_123/pdf" open />); });
    await flush();
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("error");
    expect(host.textContent).toContain("PDF request failed (502)");
    await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
    await flush();
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("ready");
  });
});
