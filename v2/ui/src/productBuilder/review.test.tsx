import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewSummary } from "./review";

const markup = renderToStaticMarkup(<ReviewSummary
  rows={[{ label: "Product", value: "Banner" }]}
  validation={{ status: "invalid", summary: "Save Changes before publishing." }}
  onJump={() => {}}
  findings={[
    { severity: "error", code: "MATRIX_PRICING_INCOMPLETE", section: "pricing", message: "Matrix pricing must contain a rate for every selected Option combination." },
    { severity: "warning", code: "RECIPE_MISSING", section: "materials", message: "No Material recipe is configured.", details: "Material consumption may be unavailable." },
    { severity: "info", code: "ROUTING_UNCONFIGURED", section: "routing", message: "Routing is unconfigured; orders will need manual routing." },
  ]}
/>);

assert.match(markup, /Blocking issues/);
assert.match(markup, /Warnings/);
assert.match(markup, /Notes/);
assert.match(markup, /Matrix pricing must contain a rate/);
assert.match(markup, /No Material recipe is configured/);
assert.match(markup, /Diagnostic: MATRIX_PRICING_INCOMPLETE/);
assert.match(markup, /Go to pricing/);
assert.match(markup, /Go to materials/);
assert.doesNotMatch(markup, /Ready for server validation/);

const cleanMarkup = renderToStaticMarkup(<ReviewSummary
  rows={[]}
  validation={{ status: "unknown", summary: "Publishing runs canonical server validation and readiness checks." }}
/>);
assert.match(cleanMarkup, /Ready for server validation/);
assert.match(cleanMarkup, /No local blocking issue is known/);

console.log("Product Builder Review readiness presentation tests passed.");
