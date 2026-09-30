import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PostgresSalesWorkspaceReads } from "../../infrastructure/sales/postgresSalesWorkspaceReads.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { SalesWorkspacePageRequest } from "../../src/modules/sales/workspaceReads.js";

const source = (relative: string) =>
  readFile(path.join(process.cwd(), relative), "utf8");

const [quote, order, quoteRoute, orderRoute, quoteTx, orderTx, workspaceReads, quoteUi, orderUi, quoteListUi, orderListUi] =
  await Promise.all([
    source("v2/src/modules/sales/quoteApplication.ts"),
    source("v2/src/modules/sales/orderApplication.ts"),
    source("v2/src/interfaces/http/quoteRoutes.ts"),
    source("v2/src/interfaces/http/orderRoutes.ts"),
    source("v2/infrastructure/sales/postgresQuoteTransaction.ts"),
    source("v2/infrastructure/sales/postgresOrderTransaction.ts"),
    source("v2/infrastructure/sales/postgresSalesWorkspaceReads.ts"),
    source("v2/ui/src/App.tsx"),
    source("v2/ui/src/OrderWorkspace.tsx"),
    source("v2/ui/src/QuotesList.tsx"),
    source("v2/ui/src/OrdersList.tsx"),
  ]);

assert.match(quote, /async duplicate\(/);
assert.match(quote, /sales\.quote\.duplicate\.v1/);
assert.match(quote, /lineId: brandedId<"SalesLineId">\(randomUUID\(\)\)/);
assert.match(quote, /quote\.overridePrice/);
assert.match(quote, /kind: "duplicate"/);
assert.match(quote, /kind: "reorder"/);
assert.match(quote, /Quote line order must include every line exactly once/);
assert.match(quoteRoute, /\/:quoteId\/duplicate/);
assert.match(quoteRoute, /businessRequestId/);
assert.match(quoteTx, /expires_at=\$3/);

assert.match(order, /async duplicate\(/);
assert.match(order, /sales\.order\.duplicate\.v1/);
assert.match(order, /New Orders deliberately require an intentional PO and due-date/);
assert.match(order, /materialRequirements\.freeze\(context\.organizationId, input\.orderId, added\)/);
assert.match(order, /Order line order must include every line exactly once/);
assert.match(order, /kind: "update_note"/);
assert.match(order, /Requested fulfillment is frozen after a handoff/);
assert.match(order, /Order line operational note updated/);
assert.match(order, /Order line presentation sequence updated/);
assert.match(orderRoute, /\/:orderId\/duplicate/);
assert.match(orderRoute, /businessRequestId/);
assert.match(orderTx, /ORDER BY position/);
assert.match(orderTx, /operational_note/);
assert.match(workspaceReads, /dueFrom = request\.dueFrom/);
assert.match(workspaceReads, /requested_due_date >= \$4::date/);
assert.match(workspaceReads, /updated_asc/);

// Exercise the public readers and their query boundary, not the spelling of
// the private cursor guard. Database results are canned keyset-page fixtures.
for (const kind of ["quote", "order"] as const) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  let releases = 0;
  const row = (id: string, day: string) => ({
    source: "v2", id, number: `${kind}-${id}`, customer_display_name: "Cursor Customer",
    lifecycle: kind === "quote" ? "draft" : "open", selling_total_cents: "100", currency: "USD",
    requested_due_date: "2026-06-01", updated_at: new Date(`2026-01-${day}T00:00:00Z`),
    cursor_updated_at: `2026-01-${day}T00:00:00.000000Z`, order_id: null, order_number: null,
    purchase_order_number: null, line_count: "1", archived_at: null, invoice_id: null,
    invoice_total_cents: null, route_count: "0",
  });
  const early = row("early", "10"), middle = row("middle", "20"), late = row("late", "30");
  const cursorOffset = kind === "quote" ? 5 : 6;
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values: [...values] });
      if (text.startsWith("BEGIN") || text === "COMMIT") return { rows: [] };
      if (text.startsWith("SELECT 'v2'")) {
        const cursorId = values[cursorOffset + 2];
        if (cursorId === "early") return { rows: [middle, late] };
        if (cursorId === "late") return { rows: [middle, early] };
        assert.equal(cursorId, null, "only a matching cursor may select a continuation fixture");
        return { rows: text.includes("ORDER BY d.updated_at ASC") ? [early, middle] : [late, middle] };
      }
      if (text.startsWith("SELECT 'legacy'")) return { rows: [] };
      if (text.startsWith("SELECT count(*)")) {
        return { rows: [text.includes("FROM v2_sales_documents")
          ? { item_count: "3", selling_total_cents: "300", currency_count: "1", currency: "USD" }
          : { item_count: "0", selling_total_cents: "0", currency_count: "0", currency: null }] };
      }
      if (kind === "order" && text.includes("d.id=ANY($2::text[])")) return { rows: [] };
      throw new Error(`Unexpected ${kind} reader query: ${text}`);
    },
    release() { releases++; },
  };
  const reader = new PostgresSalesWorkspaceReads({ connect: async () => client } as unknown as ConstructorParameters<typeof PostgresSalesWorkspaceReads>[0]);
  const organizationId = brandedId<"OrganizationId">("org-cursor");
  const read = async (request: SalesWorkspacePageRequest) => {
    const start = calls.length, before = releases;
    const page = kind === "quote"
      ? await reader.listQuotes(organizationId, request)
      : await reader.listOrdersForWorkspace(organizationId, request);
    const queries = calls.slice(start);
    assert.equal(queries[0].text, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(queries.at(-1)?.text, "COMMIT");
    assert.equal(releases, before + 1);
    assert.equal(page.totalMatching, 3, "the summary is independent of the cursor position");
    assert.deepEqual(page.summary, { itemCount: 3, currencies: ["USD"], sellingTotalCents: 300 });
    const lists = queries.filter(query => /^SELECT '(v2|legacy)'/.test(query.text));
    assert.equal(lists.length, 2, "native and legacy list queries share the pagination policy");
    for (const query of lists) {
      assert.deepEqual(query.values.slice(0, 5), [organizationId, "Cursor", request.lifecycle, "2026-01-01", "2026-12-31"]);
      if (kind === "order") assert.equal(query.values[5], "active");
      assert.equal(query.values[cursorOffset + 3], 2, "queries retain the requested page size plus one");
      const direction = request.sort === "updated_asc" ? "ASC" : "DESC";
      const operator = request.sort === "updated_asc" ? ">" : "<";
      assert.match(query.text, new RegExp(`\\) ${operator} \\(`));
      assert.match(query.text, new RegExp(`ORDER BY [^]*? ${direction}[^]*?LIMIT`));
    }
    return { page, lists };
  };
  for (const sort of ["updated_asc", "updated_desc"] as const) {
    const request = { sort, limit: 1, search: "Cursor", lifecycle: kind === "quote" ? "draft" : "open", dueFrom: "2026-01-01", dueTo: "2026-12-31" };
    const first = await read(request);
    assert.equal(first.page.items[0].recordId, sort === "updated_asc" ? early.id : late.id);
    assert.ok(first.page.nextCursor, "the reader supplies a real continuation cursor");
    const cursor = JSON.parse(Buffer.from(first.page.nextCursor, "base64url").toString("utf8"));
    const next = await read({ ...request, cursor: first.page.nextCursor });
    for (const query of next.lists) {
      assert.deepEqual(query.values.slice(cursorOffset, cursorOffset + 3), [cursor.updatedAt, cursor.source, cursor.id]);
    }
    assert.equal(next.page.items[0].recordId, middle.id, "a matching cursor continues instead of restarting");
    assert.notEqual(next.page.nextCursor, first.page.nextCursor);

    const changedSort = sort === "updated_asc" ? "updated_desc" : "updated_asc";
    const restarted = await read({ ...request, sort: changedSort, cursor: first.page.nextCursor });
    for (const query of restarted.lists) {
      assert.deepEqual(query.values.slice(cursorOffset, cursorOffset + 3), [null, null, null], "a mismatched cursor position is ignored, not used or rejected");
    }
    const fresh = await read({ ...request, sort: changedSort });
    assert.deepEqual(restarted.page, fresh.page, "sort changes restart at the same page as a request without a cursor");
    assert.equal(restarted.page.items[0].recordId, changedSort === "updated_asc" ? early.id : late.id);
    assert.ok(restarted.page.nextCursor);
    assert.equal(JSON.parse(Buffer.from(restarted.page.nextCursor, "base64url").toString("utf8")).sort, changedSort);
  }
}

for (const ui of [quoteUi, orderUi]) {
  assert.match(ui, /Duplicate (Quote|Order|line)/);
  assert.match(ui, /Move up/);
  assert.match(ui, /Move down/);
}
assert.match(quoteUi, /Quote expiry/);
assert.match(quoteUi, /Terms/);
assert.match(orderUi, /termsCode/);
for (const ui of [quoteListUi, orderListUi]) {
  assert.match(ui, /Due from/);
  assert.match(ui, /Updated: newest/);
  assert.match(ui, /useSalesUpdatedSortPreference/);
  assert.match(ui, /preferenceReady/);
  assert.match(ui, /<summary>Actions<\/summary>/);
}

console.log("Sales operator duplication, ordering, terms, and expiry contract tests passed.");
