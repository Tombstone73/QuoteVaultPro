import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const orderMarkup = renderToStaticMarkup(
  <SalesDocumentFrame
    documentType="Order"
    number="ORD-1000"
    status={<span>open</span>}
    metadata={<span>3 Alarm Graphics</span>}
    panels={{ Items: <span>Items</span>, Artwork: <span>Artwork</span>, Notes: <span>Notes</span>, Billing: <span>Billing</span>, Fulfillment: <span>Fulfillment</span>, History: <span>History</span> }}
  />,
);
for (const tab of ["Items", "Artwork", "Notes", "Billing", "Fulfillment", "History"]) assert.match(orderMarkup, new RegExp(`>${tab}<`));

const closed = renderToStaticMarkup(<SalesDocumentSplit left={<span>Items table</span>} right={null} />);
assert.match(closed, /Items table/);
assert.doesNotMatch(closed, /Resize document editor/);
const orderSplit = renderToStaticMarkup(<SalesDocumentSplit className="v2-order-items-split" left={<span>Items table</span>} right={<span>Artwork section</span>} />);
assert.match(orderSplit, /v2-order-items-split/);
const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
assert.match(styles, /\.v2-order-items-split\{align-items:start;min-height:0\}/, "Order detail split must grow with page content rather than claim a viewport-height pane");
assert.match(styles, /\.v2-order-items-split[^\n]*max-height:none;overflow:visible/, "Order line detail must not establish desktop vertical scrolling");

console.log("Shared Sales document workspace visual contract tests passed.");
