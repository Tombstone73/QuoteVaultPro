import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtworkLineIntake } from "./ArtworkLineIntake";

const markup = renderToStaticMarkup(<ArtworkLineIntake productionRequirements={{ state: "configured", specificationFingerprint: "sha256:test", units: [{ key: "front", side: "front" }, { key: "back", side: "back" }] }} onChange={() => undefined} onDetectedDimensions={() => true} />);
assert.match(markup, /Artwork/);
assert.match(markup, /Optional/);
assert.match(markup, /Choose PDF/);
assert.match(markup, /aria-label="Choose Artwork PDF"/);
assert.match(markup, /accept="application\/pdf,.pdf"/);
assert.match(markup, /No artwork selected/);
console.log("Inline Sales Artwork visual contract passed.");
