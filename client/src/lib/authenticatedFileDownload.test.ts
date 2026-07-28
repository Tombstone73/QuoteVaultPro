import { describe, expect, jest, test, beforeEach, afterEach } from "@jest/globals";

const apiFetch = jest.fn();
const notifySessionExpired = jest.fn();

jest.mock("./queryClient", () => ({ apiFetch }));
jest.mock("./authUtils", () => ({ notifySessionExpired }));

import { downloadAuthenticatedFile, filenameFromContentDisposition } from "./authenticatedFileDownload";

describe("authenticated file downloads", () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    apiFetch.mockReset();
    notifySessionExpired.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:test-file") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectUrl });
  });

  test("prefers the RFC-compatible filename over its ASCII fallback", () => {
    expect(filenameFromContentDisposition(
      "attachment; filename=job__PRINT.pdf; filename*=UTF-8''job%20%C3%A9_PRINT.pdf",
      "fallback.pdf",
    )).toBe("job é_PRINT.pdf");
  });

  test("downloads an authorized file through the credential-aware API fetch path", async () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    apiFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": "attachment; filename=production.pdf" }),
      blob: async () => new Blob(["pdf"]),
    });

    await downloadAuthenticatedFile("/api/prepress/files/file-1/download", "fallback.pdf");

    expect(apiFetch).toHaveBeenCalledWith("/api/prepress/files/file-1/download", { method: "GET" });
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  test("surfaces structured authorization failures without navigating away", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Authentication required" }),
    });

    await expect(downloadAuthenticatedFile("/api/prepress/files/file-1/download", "fallback.pdf"))
      .rejects.toThrow("Authentication required");

    expect(notifySessionExpired).toHaveBeenCalledWith("file-download");
  });
});
