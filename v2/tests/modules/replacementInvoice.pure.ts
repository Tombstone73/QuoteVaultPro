import assert from "node:assert/strict";
import { nextReplacementInvoiceSequence, proportionalReplacementLineCents, replacementInvoiceSuffix } from "../../src/modules/billing/replacementInvoice.js";

assert.equal(replacementInvoiceSuffix(2),"B");
assert.equal(replacementInvoiceSuffix(3),"C");
assert.equal(replacementInvoiceSuffix(26),"Z");
assert.throws(()=>replacementInvoiceSuffix(27),/supported B-Z range/);
assert.equal(nextReplacementInvoiceSequence([1]),2,"first additional Invoice is B");
assert.equal(nextReplacementInvoiceSequence([1,2]),3,"second additional Invoice is C");
assert.equal(nextReplacementInvoiceSequence([1,2,3]),4,"subsequent additional Invoice is D");
assert.throws(()=>nextReplacementInvoiceSequence(Array.from({length:26},(_,index)=>index+1)),/capacity is exhausted/);
assert.equal(proportionalReplacementLineCents(10_000,8,3),3_750,"partial replacement uses the frozen effective line basis");
assert.equal(proportionalReplacementLineCents(9_999,4,1),2_500,"partial override pricing uses canonical half-up cents");
assert.equal(proportionalReplacementLineCents(7_500,3,5),12_500,"the frozen basis scales without invoking current pricing");
console.log("billable replacement Invoice numbering and pricing contracts passed.");
