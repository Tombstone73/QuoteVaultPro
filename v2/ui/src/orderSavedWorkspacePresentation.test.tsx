import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderBillingSummary, OrderLineDescriptionEditor } from "./OrderWorkspace";

const editable = renderToStaticMarkup(
  <OrderLineDescriptionEditor
    description="Window decals"
    editable
    busy={false}
    csrfReady
    onSave={() => undefined}
  />,
);
assert.match(editable, /Order line description/);
assert.match(editable, /Save description/);
assert.doesNotMatch(editable, /<input[^>]*disabled/);
assert.match(editable, /Product, frozen configuration, and calculated pricing remain unchanged/);

const locked = renderToStaticMarkup(
  <OrderLineDescriptionEditor
    description="Window decals"
    editable={false}
    busy={false}
    csrfReady
    onSave={() => undefined}
  />,
);
assert.match(locked, /<input[^>]*disabled=""/);
assert.match(locked, /This Order is locked/);
assert.doesNotMatch(locked, /Save description/);

const billing = renderToStaticMarkup(
  <OrderBillingSummary
    invoice={{ invoiceId: "invoice-1", sourceOrderNumber: "ORD-1010", lifecycle: "draft", total: { cents: 11008, currency: "USD" } } as never}
    settlement={{ settlement: { paid: { cents: 0, currency: "USD" }, balance: { cents: 11008, currency: "USD" } } } as never}
    onOpen={() => undefined}
  />,
);
assert.match(billing, /<h3>Billing<\/h3>/);
assert.match(billing, /<strong>Invoice ORD-1010<\/strong>/);
assert.match(billing, /Draft/);
assert.match(billing, /Paid/);
assert.doesNotMatch(billing, /BillingInvoice/);

const workspace = await readFile(new URL("./OrderWorkspace.tsx", import.meta.url), "utf8");
assert.match(workspace, /kind: "update_description"/);
assert.match(workspace, /showConfigurationFields=\{false\}/);
assert.match(workspace, /Fulfillment method/);
assert.match(workspace, /Available to fulfill/);
assert.match(workspace, /v2-order-owner-summaries/);
assert.doesNotMatch(workspace, /requestedFulfillment\.method\.replaceAll/);

console.log("Order saved workspace presentation tests passed.");
