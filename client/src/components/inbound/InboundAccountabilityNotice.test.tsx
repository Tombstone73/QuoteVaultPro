/** @jest-environment node */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InboundAccountabilityNotice } from "./InboundAccountabilityNotice";

test("a quote-only record states that it is awaiting acceptance and retains its link", () => {
  const html = renderToStaticMarkup(<InboundAccountabilityNotice record={{ status: "approved", createdQuoteId: "quote/1" }} />);
  expect(html).toContain("Awaiting quote acceptance");
  expect(html).toContain('href="/quotes/quote%2F1"');
  expect(html).toContain("Quote linkage alone does not resolve");
});
test("new evidence retains the existing Order link and explains deliberate handling", () => {
  const html = renderToStaticMarkup(<InboundAccountabilityNotice record={{ status: "needs_review", createdOrderId: "order/1",
    normalizedPayloadJson: { unresolvedEvidenceFingerprint: "new" } }} />);
  expect(html).toContain("linked Order requires review"); expect(html).toContain('href="/orders/order%2F1"');
  expect(html).toContain("Attach it deliberately or dismiss it"); expect(html).toContain("No Order changes");
  expect(html).not.toContain("<button");
});
test("resolved Order evidence is not presented as unresolved or a new Order proposal", () => {
  const html = renderToStaticMarkup(<InboundAccountabilityNotice record={{ status: "submitted", createdOrderId: "order" }} />);
  expect(html).toContain("Open linked Order"); expect(html).not.toContain("requires review");
  expect(html).not.toContain("<button");
});
test("explicit attachment uses its canonical Order linkage", () => {
  const html = renderToStaticMarkup(<InboundAccountabilityNotice record={{ status: "submitted", normalizedPayloadJson: { attachedOrderId: "existing-order" } }} />);
  expect(html).toContain('href="/orders/existing-order"');
});
test("a merged source with subsequent evidence keeps its parent's verified Order visible", () => {
  const html = renderToStaticMarkup(<InboundAccountabilityNotice record={{ status: "needs_review", linkedParentOrderId: "parent-order",
    normalizedPayloadJson: { combinedParentRecordId: "parent", unresolvedEvidenceFingerprint: "new" } }} />);
  expect(html).toContain('href="/orders/parent-order"'); expect(html).toContain("linked Order requires review");
});
