import { describe, expect, test } from "@jest/globals";
import { resolveCatalogMigrationAnalyzerSource } from "./catalogMigrationLabSource";

describe("CatalogMigrationLab source resolution", () => {
  test("starts empty when no upload, paste, or sample source exists", () => {
    expect(resolveCatalogMigrationAnalyzerSource({
      activeSource: null,
      uploadedJsonText: "",
      pastedJsonText: "",
      sampleJsonText: "",
    })).toEqual({ kind: null, text: "", label: "No source selected" });
  });

  test("uses the selected source when multiple sources are available", () => {
    expect(resolveCatalogMigrationAnalyzerSource({
      activeSource: "paste",
      uploadedJsonText: "{\"uploaded\":true}",
      pastedJsonText: "{\"pasted\":true}",
      sampleJsonText: "{\"sample\":true}",
    })).toEqual({ kind: "paste", text: "{\"pasted\":true}", label: "Pasted JSON content" });
  });

  test("falls back to the first available source if the selected source is empty", () => {
    expect(resolveCatalogMigrationAnalyzerSource({
      activeSource: "paste",
      uploadedJsonText: "{\"uploaded\":true}",
      pastedJsonText: "",
      sampleJsonText: "{\"sample\":true}",
    })).toEqual({ kind: "upload", text: "{\"uploaded\":true}", label: "Uploaded file content" });
  });
});
