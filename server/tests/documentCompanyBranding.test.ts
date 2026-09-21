import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { buildDocumentAddressBlock, readBufferFromStorageHandle } from "../lib/documentCompanyBranding";

describe("document address formatting", () => {
  test("omits country by default", () => {
    expect(buildDocumentAddressBlock({
      line1: "1 Shop Way",
      city: "Dayton",
      state: "OH",
      postalCode: "45402",
      country: "United States",
    })).toBe("1 Shop Way\nDayton, OH 45402");
  });

  test("can include country when requested", () => {
    expect(buildDocumentAddressBlock({
      line1: "1 Shop Way",
      city: "Dayton",
      state: "OH",
      postalCode: "45402",
      country: "United States",
      includeCountry: true,
    })).toBe("1 Shop Way\nDayton, OH 45402\nUnited States");
  });
});

describe("invoice branding storage reads", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test("aborts a stalled optional logo read instead of holding invoice PDF generation", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted by test")));
    })) as unknown as typeof fetch;

    const read = readBufferFromStorageHandle({ kind: "signed_url", value: "https://storage.example.test/logo.png" });
    const expectation = expect(read).rejects.toThrow("Logo storage read timed out after 5000ms");
    await jest.advanceTimersByTimeAsync(5_000);

    await expectation;
  });
});
