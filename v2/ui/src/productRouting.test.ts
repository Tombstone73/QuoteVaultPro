import assert from "node:assert/strict";
import { customerPath, productPath, readCustomerLocation, readProductLocation, readWorkspaceLocation, workspacePath } from "./productRouting";

assert.deepEqual(readProductLocation("/products"), {});
assert.deepEqual(readProductLocation("/products/product-a"), { productId: "product-a" });
assert.deepEqual(readProductLocation("/products/product%2Da"), { productId: "product-a" });
assert.equal(readProductLocation("/products/%2Fwrong"), null);
assert.equal(readProductLocation("/quotes"), null);
assert.equal(productPath("product a"), "/products/product%20a");
assert.deepEqual(readCustomerLocation("/customers"), {});
assert.deepEqual(readCustomerLocation("/customers/customer-a"), { customerId: "customer-a" });
assert.equal(readCustomerLocation("/customers/%2Fwrong"), null);
assert.deepEqual(readWorkspaceLocation("/customers/customer-a"), { page: "customers", customerId: "customer-a" });
assert.deepEqual(readWorkspaceLocation("/products/product-a"), { page: "products", productId: "product-a" });
assert.equal(customerPath("customer a"), "/customers/customer%20a");
assert.deepEqual(readWorkspaceLocation("/artwork"), { page: "artwork" });
assert.deepEqual(readWorkspaceLocation("/proofing"), { page: "proofing" });
assert.deepEqual(readWorkspaceLocation("/prepress"), { page: "prepress" });
assert.equal(workspacePath("artwork"), "/artwork");
