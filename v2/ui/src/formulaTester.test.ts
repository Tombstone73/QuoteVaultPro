import assert from "node:assert/strict";
import { acceptsFormulaTesterResponse } from "./FormulaLibraryWorkspace";

assert.equal(
  acceptsFormulaTesterResponse(2, 1),
  false,
  "a response from a superseded live Formula Tester request must be ignored",
);
assert.equal(
  acceptsFormulaTesterResponse(2, 2),
  true,
  "the current live Formula Tester request may update the confirmed result",
);

console.log("Formula Tester stale-response guard tests passed.");
