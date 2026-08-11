import { describe, expect, test } from "@jest/globals";
import { createAssistantToolRegistry, validateAssistantToolResult } from "../services/assistant/toolRegistry";
import { normalizeGlobalSearchResultForRegistry } from "../services/assistant/assistantToolAdapters";

const capturedAt = "2026-08-10T17:54:28.895Z";

describe("search.global registry adapter", () => {
  test("returns not_found for the Translucent-Vinyl-shaped zero-match result instead of a successful result without provenance", () => {
    const result = normalizeGlobalSearchResultForRegistry({ data: { results: [] }, freshness: capturedAt });

    expect(result).toEqual({ status: "not_found", data: null });
    expect(validateAssistantToolResult(createAssistantToolRegistry().get("search.global")!, result)).toEqual(result);
  });

  test("keeps a valid Banner match as a source-linked successful result", () => {
    const result = normalizeGlobalSearchResultForRegistry({
      data: { results: [{
        entityType: "product", recordId: "product_banner_1", displayLabel: "13 oz Banner", secondaryDescription: "Banners", status: "active",
        route: "/products/product_banner_1/edit", freshness: capturedAt,
      }] },
      freshness: capturedAt,
    });

    expect(validateAssistantToolResult(createAssistantToolRegistry().get("search.global")!, result)).toMatchObject({
      status: "succeeded", data: { matches: [expect.objectContaining({ label: "13 oz Banner" })] },
      provenance: { sourceLinks: [expect.objectContaining({ href: "/products/product_banner_1/edit" })] },
    });
  });

  test("continues to reject malformed search records", () => {
    expect(() => normalizeGlobalSearchResultForRegistry({
      data: { results: [{
        entityType: "product", recordId: "product_banner_1", displayLabel: "13 oz Banner", secondaryDescription: "Banners", status: "active",
        route: "https://untrusted.example/product", freshness: capturedAt,
      }] },
      freshness: capturedAt,
    })).toThrow();
  });
});
