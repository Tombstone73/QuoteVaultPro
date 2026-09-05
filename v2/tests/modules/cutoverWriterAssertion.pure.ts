import assert from "node:assert/strict";
import { assertWriteFreeCutover, type CutoverAuthorityState } from "../../src/modules/cutover/cutoverWriterAssertion.js";

const expected = ["http", "prepress", "migrations"] as const;
const safe: CutoverAuthorityState[] = expected.map((authority) => ({
  authority,
  admission: authority === "http" ? "closed" : "not_applicable",
  process: "stopped",
  drain: "drained",
  canMutateCutoverState: false,
}));

assert.equal(assertWriteFreeCutover(expected, safe).pass, true);
assert.equal(assertWriteFreeCutover(expected, safe.slice(0, 2)).pass, false, "missing authority fails closed");
assert.equal(assertWriteFreeCutover(expected, [{ ...safe[0], canMutateCutoverState: true }, ...safe.slice(1)]).pass, false, "live writers fail closed");
assert.equal(assertWriteFreeCutover(expected, [{ ...safe[0], process: "unknown" }, ...safe.slice(1)]).pass, false, "unknown state fails closed");

console.log("cutover writer assertion pure checks passed");
