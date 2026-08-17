import assert from "node:assert/strict";
import { productPath, readProductLocation } from "./productRouting";

assert.deepEqual(readProductLocation("/products"), {});
assert.deepEqual(readProductLocation("/products/product-a"), { productId: "product-a" });
assert.deepEqual(readProductLocation("/products/product%2Da"), { productId: "product-a" });
assert.equal(readProductLocation("/products/%2Fwrong"), null);
assert.equal(readProductLocation("/quotes"), null);
assert.equal(productPath("product a"), "/products/product%20a");
