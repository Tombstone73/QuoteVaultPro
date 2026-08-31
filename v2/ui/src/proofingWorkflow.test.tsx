import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { proofingApi, type ProofWorkProjection } from "./api";
import { ProofWorkflowActions, proofWorkSelectionForScope, type ProofingOrderLineContext } from "./ProofingWorkspace";

const context = { order: { number: { display: "ORD-1007", core: "1007" }, order: { orderId: "order-a", customerContact: { organizationId: "org-a", customerId: "customer-a" }, commercialState: "open", currency: "USD", terms: {}, lines: [{ lineId: "line-a", description: "Sign Vinyl", position: 0, quantity: 1 }] }, revision: "r1", totals: { calculated: { cents: 600, currency: "USD" }, selling: { cents: 600, currency: "USD" } }, routes: [] }, line: { lineId: "line-a", description: "Sign Vinyl", position: 0, quantity: 1 }, sourceArtwork: [{ file: { id: "file-a", displayFilename: "proof.pdf" }, assignment: { id: "art-a", orderLineId: "line-a", purpose: "customer_supplied" } }] } as unknown as ProofingOrderLineContext;
const proofQueue = [{ work: { proofWorkId: "foreign-work", orderId: "foreign-order", orderLineId: "foreign-line" } }, { work: { proofWorkId: "scoped-work", orderId: "order-a", orderLineId: "line-a" } }] as never[];
assert.equal(proofWorkSelectionForScope(proofQueue, undefined, "order-a", "line-a"), "scoped-work");
assert.equal(proofWorkSelectionForScope(proofQueue, undefined, "order-a", "missing-line"), "");
assert.equal(proofWorkSelectionForScope(proofQueue), "foreign-work");
const render = (projection?: ProofWorkProjection) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ProofWorkflowActions organizationId="org-a" context={context} projection={projection} canPrepare canIssue canRespond onRefresh={async () => undefined} /></QueryClientProvider>);
assert.match(render(), /Start Proofing/); assert.doesNotMatch(render(), /OrderLine ID|Artwork Assignment ID/);
const draft = { work: { proofWorkId: "work-a", orderId: "order-a", orderLineId: "line-a", createdAt: "2026-08-20T00:00:00.000Z" }, versions: [{ version: { proofVersionId: "version-a", proofWorkId: "work-a", sequence: 1, artwork: [], createdAt: "2026-08-20T00:00:00.000Z" } }] } as unknown as ProofWorkProjection;
assert.match(render(draft), /has no immutable Artwork evidence/); assert.doesNotMatch(render(draft), /Issue Proof/);
const evidencedDraft = { ...draft, versions: [{ version: { ...draft.versions[0]!.version, artwork: [{ position: 0, artworkAssignmentId: "art-a", artworkFileId: "file-a" }] } }] } as unknown as ProofWorkProjection;
assert.match(render(evidencedDraft), /Issue Proof/);
const issued = { ...evidencedDraft, versions: [{ version: { ...evidencedDraft.versions[0]!.version, issuedAt: "2026-08-20T00:01:00.000Z" } }] };
assert.match(render(issued), /Approve Proof/); assert.match(render(issued), /Request Revision/);
assert.match(render({ ...issued, versions: [{ ...issued.versions[0]!, response: { outcome: "approved" } }] } as unknown as ProofWorkProjection), /Proofing complete/);
const requests: { url: string; body: Record<string, unknown> }[] = []; const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) }); return new Response(JSON.stringify({ ok: true, data: { work: { proofWorkId: "work-a", orderId: "order-a", orderLineId: "line-a", createdAt: "now" } } }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
try { await proofingApi.start("org a", "start-a", "order-a", "line-a"); await proofingApi.createVersion("org a", "work-a", "create-a", ["art-a"]); await proofingApi.issue("org a", "version-a", "issue-a"); await proofingApi.respond("org a", "version-a", "response-a", "approved", "QA approval", "customer-a"); } finally { globalThis.fetch = originalFetch; }
assert.deepEqual(requests.map((request) => request.url), ["/v2/organizations/org%20a/proofing/works", "/v2/organizations/org%20a/proofing/works/work-a/versions", "/v2/organizations/org%20a/proofing/versions/version-a/issue", "/v2/organizations/org%20a/proofing/versions/version-a/respond"]);
assert.deepEqual(requests.map((request) => request.body), [{ orderId: "order-a", orderLineId: "line-a", businessRequestId: "start-a" }, { artworkAssignmentIds: ["art-a"], businessRequestId: "create-a" }, { businessRequestId: "issue-a" }, { outcome: "approved", comment: "QA approval", recordedCustomerId: "customer-a", businessRequestId: "response-a" }]);
console.log("Proofing workflow UI and canonical API contracts passed.");
