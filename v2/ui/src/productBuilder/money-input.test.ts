import assert from "node:assert/strict";
import {
  formatCentsForEdit,
  normalizeCurrencyOnBlur,
  parseCurrencyEdit,
} from "./money-input";

const valid = (raw: string, cents: number) =>
  assert.deepEqual(parseCurrencyEdit(raw), { kind: "valid", cents }, raw);
const incomplete = (raw: string) =>
  assert.deepEqual(parseCurrencyEdit(raw), { kind: "incomplete" }, raw);
const invalid = (raw: string) =>
  assert.deepEqual(parseCurrencyEdit(raw), { kind: "invalid" }, raw);

// Loading canonical cents produces an ordinary dollar editing string, not a
// calculator-style digit buffer.
assert.equal(formatCentsForEdit(125), "1.25");
assert.equal(formatCentsForEdit(750), "7.50");
assert.equal(formatCentsForEdit(0), "0.00");
assert.equal(formatCentsForEdit(null), "");

// Select-all replacement is represented by the browser's raw replacement
// text. It must remain exactly "7" while editing, then commit to 700 cents.
assert.equal(formatCentsForEdit(125), "1.25");
valid("7", 700);
assert.equal(normalizeCurrencyOnBlur("7"), "7.00");

// Natural decimal entry and canonical cents conversion. These are the Product
// Builder values used for rates, minimums, fees, Matrix rates, and monetary
// option impacts.
valid("7.50", 750);
valid("1.25", 125);
valid("0.75", 75);
valid("44.00", 4400);

// The local editor must retain partially-entered decimals instead of
// reformatting after each keypress.
assert.deepEqual(parseCurrencyEdit(""), { kind: "empty" });
incomplete("7.");
incomplete("0.");
valid("7.5", 750);
assert.equal(normalizeCurrencyOnBlur("7."), "7.00");
assert.equal(normalizeCurrencyOnBlur("0."), "0.00");
assert.equal(normalizeCurrencyOnBlur("7.5"), "7.50");

// Browser Backspace/Delete operations simply deliver their normal replacement
// strings. Parsing those strings must not shift cents or move the decimal.
valid("1.5", 150); // deleting/backspacing the "2" from "1.25"
valid("1.2", 120); // deleting/backspacing the "5" from "1.25"
assert.equal(normalizeCurrencyOnBlur("1.5"), "1.50");
assert.equal(normalizeCurrencyOnBlur("1.2"), "1.20");

// Pasting a valid value works as a single normal replacement operation.
valid("12.34", 1234);
assert.equal(normalizeCurrencyOnBlur("12.34"), "12.34");

// Invalid or unsupported text is never coerced into a different amount.
invalid("1.2.3");
invalid("not money");
invalid("-1.00");
invalid("1.234");
incomplete(".");
assert.equal(normalizeCurrencyOnBlur("1.2.3"), null);
assert.equal(normalizeCurrencyOnBlur("-1.00"), null);
assert.equal(normalizeCurrencyOnBlur("."), "0.00");
assert.equal(normalizeCurrencyOnBlur(""), "");

console.log("Product Builder money input editing tests passed.");
