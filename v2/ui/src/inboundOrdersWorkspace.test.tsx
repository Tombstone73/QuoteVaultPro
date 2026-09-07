import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { InboundOrdersWorkspace } from "./InboundOrdersWorkspace";

const item = {
  inboundOrderId: "inbound-a",
  status: "needs_review" as const,
  sourceProvider: "manual_import",
  sourceMessageId: "message-a",
  senderEmail: "buyer@example.test",
  subject: "Need 25 banners",
  receivedAt: "2026-09-07T12:00:00.000Z",
  attachmentCount: 1,
  customerDisplayName: "Example Customer",
  extractedPurchaseOrderNumber: "PO-42",
};
const detail = {
  ...item,
  source: { provider: "manual_import", messageId: "message-a", senderEmail: "buyer@example.test", subject: item.subject, receivedAt: item.receivedAt, bodyText: "Please make banners." },
  attachments: [{ attachmentId: "attachment-a", filename: "banner.pdf", contentType: "application/pdf", role: "reference" as const, adoptionState: "pending" as const }],
  customerCandidates: [{ customerId: "customer-a", displayName: "Example Customer", confidence: "strong" as const, contactCandidates: [{ contactId: "contact-a", displayName: "Buyer", email: "buyer@example.test", confidence: "strong" as const }] }],
  draft: { lines: [{ draftLineId: "line-a", description: "Banner", quantity: 25, dimensions: { width: "24", height: "72", unit: "in" as const } }], blockers: ["Select a canonical Product before conversion."] },
};
const client = new QueryClient();
client.setQueryData(["v2", "scope-a", "org-a", "inbound-orders", "list", "needs_review", "", ""], { items: [item], totalMatching: 1 });
client.setQueryData(["v2", "scope-a", "org-a", "inbound-orders", "inbound-a"], detail);
const markup = renderToStaticMarkup(<QueryClientProvider client={client}><InboundOrdersWorkspace organizationId="org-a" sessionScope="scope-a" canView canReview canConvert csrfReady openOrder={() => undefined} openCustomer={() => undefined} /></QueryClientProvider>);
assert.match(markup, /Inbound Orders/);
assert.match(markup, /Review source evidence before creating a canonical Order/);
assert.match(markup, /Need 25 banners/);
assert.match(markup, /Source message/);
assert.match(markup, /banner.pdf/);
assert.match(markup, /Reviewed Order draft/);
assert.match(markup, /Select a canonical Product before conversion/);
assert.match(markup, /Convert to Order/);
assert.match(markup, /Mark duplicate/);
assert.match(markup, new RegExp("Reject / ignore"));
assert.doesNotMatch(markup, /Fetch Gmail|Sync Gmail/);
console.log("Inbound Orders workspace presentation tests passed.");
