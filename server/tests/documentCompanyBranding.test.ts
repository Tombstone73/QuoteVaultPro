import { describe, expect, test } from "@jest/globals";
import { buildDocumentAddressBlock } from "../lib/documentCompanyBranding";

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
