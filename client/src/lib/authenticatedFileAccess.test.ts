import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { downloadAuthenticatedFile, openAuthenticatedFile } from "@/lib/authenticatedFileAccess";
import { apiFetch } from "@/lib/queryClient";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function response(options: { ok?: boolean; status?: number; body?: Blob; json?: unknown }): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    clone: () => response(options),
    json: async () => options.json ?? null,
    text: async () => "",
    blob: async () => options.body ?? new Blob(["file"]),
  } as Response;
}

describe("authenticated file access", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalOpen = window.open;

  beforeEach(() => {
    jest.useFakeTimers();
    mockedApiFetch.mockReset();
    URL.createObjectURL = jest.fn(() => "blob:production-file");
    URL.revokeObjectURL = jest.fn();
    window.open = jest.fn(() => ({ closed: false } as Window));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    window.open = originalOpen;
    jest.restoreAllMocks();
  });

  test("opens a protected production file from an authenticated Blob, not the naked API URL", async () => {
    mockedApiFetch.mockResolvedValue(response({ body: new Blob(["%PDF-1.4"], { type: "application/pdf" }) }));

    await openAuthenticatedFile("/api/prepress/files/final-1/download?inline=1");

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/prepress/files/final-1/download?inline=1", {
      method: "GET",
      credentials: "include",
    });
    expect(window.open).toHaveBeenCalledWith("blob:production-file", "_blank", "noopener,noreferrer");
    expect(window.open).not.toHaveBeenCalledWith("/api/prepress/files/final-1/download?inline=1", expect.anything(), expect.anything());
  });

  test("downloads a protected production file through the authenticated request path", async () => {
    const click = jest.fn();
    const remove = jest.fn();
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "a") return { click, remove, rel: "", href: "", download: "" } as any;
      return originalCreateElement(tagName);
    });
    jest.spyOn(document.body, "appendChild").mockImplementation((node: Node) => node);
    mockedApiFetch.mockResolvedValue(response({}));

    await downloadAuthenticatedFile("/api/prepress/files/final-1/download", "final.pdf");

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/prepress/files/final-1/download", {
      method: "GET",
      credentials: "include",
    });
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  test("does not open a raw URL when authenticated access is rejected", async () => {
    mockedApiFetch.mockResolvedValue(response({ ok: false, status: 401, json: { message: "Unauthorized" } }));

    await expect(openAuthenticatedFile("/api/prepress/files/final-1/download?inline=1")).rejects.toThrow("Unauthorized");
    expect(window.open).not.toHaveBeenCalled();
  });
});
