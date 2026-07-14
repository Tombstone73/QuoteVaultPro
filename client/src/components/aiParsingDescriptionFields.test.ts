import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const repoRoot = process.cwd();

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("AI parsing description editor fields", () => {
  test("product editor exposes linked checkbox, textarea, disabled state, and defaults", () => {
    const productForm = readWorkspaceFile("client/src/components/ProductForm.tsx");
    const productEditor = readWorkspaceFile("client/src/pages/ProductEditorPage.tsx");

    expect(productForm).toContain("Use product description for AI parsing");
    expect(productForm).toContain("AI Parsing Description");
    expect(productForm).toContain("Generate with AI");
    expect(productForm).toContain("isGeneratingAiParsingDescription");
    expect(productForm).toContain("disabled={aiParsingLinkedToDescription}");
    expect(productEditor).toContain("aiParsingDescription: null");
    expect(productEditor).toContain("aiParsingDescriptionLinkedToDescription: false");
    expect(productEditor).toContain("product.aiParsingDescription");
    expect(productEditor).toContain("product.aiParsingDescriptionLinkedToDescription");
    expect(productEditor).toContain("if (aiParsingDescriptionMutation.isPending) return");
    expect(productEditor).toContain("Improve existing");
    expect(productEditor).toContain("Replace");
    expect(productEditor).toContain("normalizeGeneratedAiParsingDescriptionResponse");
  });

  test("material editor exposes linked checkbox, textarea, disabled state, and save payload", () => {
    const materialForm = readWorkspaceFile("client/src/components/MaterialForm.tsx");

    expect(materialForm).toContain("Use material description for AI parsing");
    expect(materialForm).toContain("AI Parsing Description");
    expect(materialForm).toContain("disabled={aiParsingLinkedToDescription}");
    expect(materialForm).toContain("aiParsingDescription: nullableTrimmed(values.aiParsingDescription)");
    expect(materialForm).toContain("aiParsingDescriptionLinkedToDescription: Boolean(values.aiParsingDescriptionLinkedToDescription)");
  });
});
