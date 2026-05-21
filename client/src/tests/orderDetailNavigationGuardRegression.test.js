const { readFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("order detail navigation guard regression", () => {
  it("uses canonical order and line-item dirty sources for blocking navigation", () => {
    const source = readRepoFile("client/src/pages/order-detail.tsx");

    expect(source).toContain("const [hasDirtyLineItem, setHasDirtyLineItem] = useState(false);");
    expect(source).toContain("const hasStagedOrderChanges = hasAnyStagedChanges(pendingOrderPatch);");
    expect(source).toContain("const isDirty = hasStagedOrderChanges || hasDirtyLineItem;");
    expect(source).toContain("isDirtyRef.current = isDirty;");
    expect(source).toContain("onDirtyChange={setHasDirtyLineItem}");
    expect(source).toContain("saveDirtyItemRef={saveDirtyLineItemRef}");
  });

  it("reports Save Item dirty state back to order detail and clears it after save", () => {
    const source = readRepoFile("client/src/components/orders/OrderLineItemsSection.tsx");

    expect(source).toContain("onDirtyChange?: (isDirty: boolean) => void;");
    expect(source).toContain("saveDirtyItemRef?: MutableRefObject<(() => Promise<void>) | null>;");
    expect(source).toContain("onDirtyChange?.(isDirty);");
    expect(source).toContain("saveDirtyItemRef.current = isDirty ? saveDirtyItemFromRef : null;");
    expect(source).toContain("savedSnapshotRef.current[itemId] = {");
  });
});
