import { describe, expect, test } from "@jest/globals";
import { escapeCsvValue, buildCsv } from "@shared/csv";

describe("csv helpers", () => {
  test("escapeCsvValue escapes quotes", () => {
    expect(escapeCsvValue('He said "hi"')).toBe('"He said ""hi"""');
  });

  test("escapeCsvValue quotes commas and newlines", () => {
    expect(escapeCsvValue("a,b")).toBe('"a,b"');
    expect(escapeCsvValue("a\nb")).toBe('"a\nb"');
  });

  test("buildCsv uses CRLF and trailing CRLF", () => {
    const csv = buildCsv([
      ["H1", "H2"],
      ["a", "b"],
    ]);
    expect(csv).toBe("H1,H2\r\na,b\r\n");
  });

  test("buildCsv can skip headers", () => {
    const csv = buildCsv(
      [
        ["H1", "H2"],
        ["a", "b"],
      ],
      { includeHeaders: false }
    );
    expect(csv).toBe("a,b\r\n");
  });
});
