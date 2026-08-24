import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductDraftOption } from "../api";
import { applyDefaultChoice, OptionGroupsSection } from "./optionGroups";

const options: readonly ProductDraftOption[] = [{
  optionId: "persisted-finish",
  label: "Finish",
  inputType: "select",
  required: false,
  defaultValue: "matte",
  choices: [
    { choiceValue: "matte", label: "Matte" },
    { choiceValue: "gloss", label: "Gloss" },
  ],
  canRemove: true,
}];

const markup = renderToStaticMarkup(<OptionGroupsSection options={options} onChange={() => {}} />);

assert.match(markup, /Default choice/);
assert.match(markup, /aria-label="Default choice"/);
assert.match(markup, /<option value="matte" selected="">Matte<\/option>/);
assert.match(markup, /<option value="gloss">Gloss<\/option>/);
assert.doesNotMatch(markup, /Default choice[^]*Choice value/);

const changes: ProductDraftOption[] = [];
applyDefaultChoice(options[0]!, "gloss", (next) => changes.push(next));
assert.equal(changes.length, 1);
assert.equal(changes[0]?.defaultValue, "gloss");
assert.equal(changes[0]?.optionId, "persisted-finish");
assert.deepEqual(changes[0]?.choices, options[0]?.choices);

const typedMarkup = renderToStaticMarkup(<OptionGroupsSection options={[{
  optionId: "persisted-proof",
  selectionKey: "proof_required",
  label: "Proof required",
  inputType: "boolean",
  required: false,
  defaultValue: false,
  choices: [],
  canRemove: true,
}]} onChange={() => {}} />);
const textareaMarkup = renderToStaticMarkup(<OptionGroupsSection options={[{
  optionId: "persisted-notes",
  selectionKey: "notes",
  label: "Notes",
  inputType: "textarea",
  required: false,
  defaultValue: "Handle with care",
  choices: [],
  canRemove: true,
}]} onChange={() => {}} />);
assert.match(typedMarkup, /aria-label="Boolean default"/);
assert.match(typedMarkup, /<option value="false" selected="">False<\/option>/);
assert.match(textareaMarkup, /aria-label="Text default"/);
assert.match(textareaMarkup, /Handle with care/);

console.log("Product Builder option default-choice presentation tests passed.");
