import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesDocumentFrame, SalesDocumentSplit } from "./SalesDocumentWorkspace";

const markup = renderToStaticMarkup(
  <SalesDocumentFrame
    documentType="Quote"
    number="QT-1000"
    status={<span>converted</span>}
    metadata={<span>3 Alarm Graphics</span>}
    panels={{
      Items: <SalesDocumentSplit left={<span>Product</span>} right={<span>Line editor</span>} />,
      Artwork: <span>Artwork</span>,
      Notes: <span>Notes</span>,
      History: <span>History</span>,
    }}
  />,
);

assert.match(markup, /Quote/);
assert.match(markup, /QT-1000/);
assert.match(markup, /Items/);
assert.match(markup, /Artwork/);
assert.match(markup, /Notes/);
assert.match(markup, /History/);
assert.match(markup, /Resize document editor/);
assert.match(markup, /Product/);
assert.match(markup, /Line editor/);

const closed = renderToStaticMarkup(<SalesDocumentSplit left={<span>Items table</span>} right={null} />);
assert.match(closed, /Items table/);
assert.doesNotMatch(closed, /Resize document editor/);

console.log("Shared Sales document workspace visual contract tests passed.");
