import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

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
assert.match(orderRoute, /\/:orderId\/duplicate/);
assert.match(orderRoute, /businessRequestId/);
assert.match(orderTx, /ORDER BY position/);
assert.match(workspaceReads, /dueFrom = request\.dueFrom/);
assert.match(workspaceReads, /requested_due_date >= \$4::date/);
assert.match(workspaceReads, /updated_asc/);
assert.match(workspaceReads, /cursor\.sort !== sort/);

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
  assert.match(ui, /localStorage/);
  assert.match(ui, /<summary>Actions<\/summary>/);
}

console.log("Sales operator duplication, ordering, terms, and expiry contract tests passed.");
