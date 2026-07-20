import { describe, expect, test } from "@jest/globals";
import { insertProductSchema, updateProductSchema } from "@shared/schema";

describe("product shop name contracts", () => {
  test("create and update contracts preserve the tenant shop name", () => {
    const created = insertProductSchema.parse({
      name: "ACM / Dibond / Max Metal / Aluminum Composite Material",
      shopName: "ACM",
      description: "Aluminum composite sign panel",
    });
    expect(created.shopName).toBe("ACM");

    const reloaded = updateProductSchema.parse({ shopName: created.shopName });
    expect(reloaded.shopName).toBe("ACM");
  });

  test("shop name remains optional for existing products", () => {
    expect(insertProductSchema.parse({ name: "Banner", description: "Banner" }).shopName).toBeUndefined();
    expect(updateProductSchema.parse({ shopName: null }).shopName).toBeNull();
  });
});
