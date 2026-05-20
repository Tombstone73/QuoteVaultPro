const { readFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("order entry diagnostics cleanup regression", () => {
  it("does not render the OrderNewRoute debug banner", () => {
    const source = readRepoFile("client/src/pages/order-new.tsx");

    expect(source).not.toContain("RenderPathBanner");
    expect(source).toContain('<QuoteEditorPage mode="edit" createTarget="order" />');
  });

  it("keeps the Add Product flow free of removed diagnostics helpers", () => {
    const source = readRepoFile("client/src/features/quotes/editor/components/LineItemsSection.tsx");

    expect(source).not.toContain("addRuntimeDebugEvent");
    expect(source).not.toContain("describeDebugElement");
    expect(source).toContain("const created = await onCreateDraftLineItem(p.id);");
    expect(source).toContain("if (k) onExpandedKeyChange(k);");
  });
});
