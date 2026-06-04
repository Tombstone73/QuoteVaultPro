import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { openAuthenticatedPdfPreview } from "@/lib/authenticatedPdfPreview";
import { apiFetch } from "@/lib/queryClient";

jest.mock("@/lib/queryClient", () => ({
  apiFetch: jest.fn(),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function mockResponse(options: {
  ok: boolean;
  status: number;
  contentType: string;
  json?: unknown;
  text?: string;
  blob?: Blob;
}): Response {
  return {
    ok: options.ok,
    status: options.status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? options.contentType : null),
    },
    clone: () => mockResponse(options),
    json: async () => {
      if (options.json === undefined) throw new Error("No JSON body");
      return options.json;
    },
    text: async () => options.text ?? "",
    blob: async () => options.blob ?? new Blob(),
  } as Response;
}

describe("openAuthenticatedPdfPreview", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalOpen = window.open;

  beforeEach(() => {
    jest.useFakeTimers();
    mockedApiFetch.mockReset();
    URL.createObjectURL = jest.fn(() => "blob:quote-pdf");
    URL.revokeObjectURL = jest.fn();
    window.open = jest.fn(() => ({ closed: false } as Window));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    window.open = originalOpen;
  });

  test("fetches the quote PDF through the authenticated API path and opens a Blob URL", async () => {
    mockedApiFetch.mockResolvedValue(
      mockResponse({
        ok: true,
        status: 200,
        contentType: "application/pdf",
        blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      }),
    );

    await openAuthenticatedPdfPreview("/api/quotes/quote_123/pdf");

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/quotes/quote_123/pdf", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/pdf",
      },
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(window.open).toHaveBeenCalledWith("blob:quote-pdf", "_blank", "noopener,noreferrer");
    expect(window.open).not.toHaveBeenCalledWith("/api/quotes/quote_123/pdf", "_blank", "noopener,noreferrer");

    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:quote-pdf");
  });

  test("surfaces JSON error messages without opening a direct PDF URL", async () => {
    mockedApiFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 401,
        contentType: "application/json",
        json: { message: "Unauthorized" },
      }),
    );

    await expect(openAuthenticatedPdfPreview("/api/quotes/quote_123/pdf")).rejects.toThrow("Unauthorized");

    expect(window.open).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
