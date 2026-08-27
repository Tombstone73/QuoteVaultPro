import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createQuoteRouter, type QuoteHttpDependencies } from "../../src/interfaces/http/quoteRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const staff: StaffPrincipal = {
  kind: "staff",
  organizationId: "org-a",
  userId: "staff-a",
  authority: { membershipId: "membership-a", capabilities: ["quote.view"] },
};

const page = { items: [] };

const app = (seen: Array<Record<string, unknown>>) =>
  express().use("/v2/organizations/:organizationId/quotes", createQuoteRouter({
    principals: { principal: async () => staff },
    formReads: {} as QuoteHttpDependencies["formReads"],
    service: {} as QuoteHttpDependencies["service"],
    workspace: {
      listQuotes: async (_organizationId, input) => {
        seen.push({ ...input });
        return page;
      },
    } as QuoteHttpDependencies["workspace"],
  }));

const cases: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ["exact range", "?dueFrom=2026-09-10&dueTo=2026-09-10", { dueFrom: "2026-09-10", dueTo: "2026-09-10" }],
  ["from only", "?dueFrom=2026-09-10", { dueFrom: "2026-09-10" }],
  ["through only", "?dueTo=2026-09-10", { dueTo: "2026-09-10" }],
  ["combined number and sorting", "?q=QT-1000&dueFrom=2026-09-10&dueTo=2026-09-11&sort=updated_asc", { search: "QT-1000", dueFrom: "2026-09-10", dueTo: "2026-09-11", sort: "updated_asc" }],
];

for (const [_name, query, expected] of cases) {
  const seen: Array<Record<string, unknown>> = [];
  const response = await request(app(seen)).get(`/v2/organizations/org-a/quotes${query}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, data: page });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { limit: 25, ...expected });
}

for (const [query, message] of [
  ["?dueFrom=2026-02-30", "Due-date filters must use a real calendar date."],
  ["?dueTo=10-09-2026", "Due-date filters must use YYYY-MM-DD."],
] as const) {
  const seen: Array<Record<string, unknown>> = [];
  const response = await request(app(seen)).get(`/v2/organizations/org-a/quotes${query}`);
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { ok: false, error: { code: "VALIDATION_ERROR", message } });
  assert.deepEqual(seen, []);
}

console.log("Quote due-date HTTP filter contract tests passed.");
