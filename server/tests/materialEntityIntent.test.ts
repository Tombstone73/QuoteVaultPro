import { resolveExplicitCreationEntity } from "../services/assistant/materialEntityIntent";

describe("resolveExplicitCreationEntity", () => {
  it.each([
    "Add a material",
    "Create Digitech TruFire KSJ Ink - Cyan as a material",
    "Add a new ink material that costs $130 per liter from Digitech",
    "make a new material",
  ])("routes explicit Material creation to materials: %s", (message) => {
    expect(resolveExplicitCreationEntity(message)).toBe("material");
  });

  it.each([
    "Create a product called Cyan Ink",
    "Create a product using Digitech TruFire KSJ Ink - Cyan",
  ])("keeps explicit Product creation in products: %s", (message) => {
    expect(resolveExplicitCreationEntity(message)).toBe("product");
  });

  it("does not infer a creation entity from a material lookup", () => {
    expect(resolveExplicitCreationEntity("I cannot find Digitech TruFire KSJ Ink - Cyan")).toBeNull();
  });
});
