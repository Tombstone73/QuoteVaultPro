import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const repoRoot = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("product measurement mode editor wiring", () => {
  test("product editor saves and reloads the explicit measurement mode", () => {
    const form = read("client/src/components/ProductForm.tsx");
    const editor = read("client/src/pages/ProductEditorPage.tsx");

    expect(form).toContain('name="measurementMode"');
    expect(form).toContain('value="quantity_only"');
    expect(form).toContain('measurementMode === "dimensions_required"');
    expect(editor).toContain('measurementMode: "dimensions_required"');
    expect(editor).toContain('measurementMode: product.measurementMode || "dimensions_required"');
  });
});
