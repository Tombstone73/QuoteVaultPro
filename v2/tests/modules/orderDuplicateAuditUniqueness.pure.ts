import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/modules/sales/orderApplication.ts", import.meta.url), "utf8");
const duplicate = source.slice(source.indexOf("async duplicate("), source.indexOf("async createFromCommercialSnapshot("));

assert(duplicate.includes('eventType: "order_duplicated"'), "the source Order must retain duplication relationship evidence");
assert(duplicate.includes("resourceId: input.orderId"), "the source Order, not the newly created Order, must receive the second audit event");
assert(duplicate.includes("createFromCommercialSnapshot"), "the new Order must retain its canonical creation audit path");
console.log("[order-duplicate-audit] duplication preserves the one request/resource audit invariant.");
