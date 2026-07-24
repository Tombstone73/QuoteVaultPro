import { assertValidParentLink } from "../services/lineItemParentLinking";

describe("line item parent linking", () => {
  const lines = [
    { id: "parent-a", lineItemRole: "standalone", parentLineItemId: null },
    { id: "parent-b", lineItemRole: "standalone", parentLineItemId: null },
    { id: "child", lineItemRole: "child", parentLineItemId: "parent-a" },
  ];

  it("allows linking an existing standalone line and changing its parent", () => {
    expect(() => assertValidParentLink(lines, "parent-b", "parent-a")).not.toThrow();
    expect(() => assertValidParentLink(lines, "child", "parent-b")).not.toThrow();
  });

  it("allows unlinking a child back to a standalone line", () => {
    expect(() => assertValidParentLink(lines, "child", null)).not.toThrow();
  });

  it("rejects self-parenting", () => {
    expect(() => assertValidParentLink(lines, "parent-a", "parent-a")).toThrow("own parent");
  });

  it("rejects parent ids outside the quote or order", () => {
    expect(() => assertValidParentLink(lines, "child", "other-document-line")).toThrow("same quote or order");
  });

  it("rejects a circular parent relationship", () => {
    expect(() => assertValidParentLink(lines, "parent-a", "child")).toThrow("descendants");
  });
});
