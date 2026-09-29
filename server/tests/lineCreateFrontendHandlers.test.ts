import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@jest/globals";
import { LineCreateIntentStore, LineCreateSubmitGuard } from "../../client/src/lib/lineCreateIntent";

function expression(file: string, match: (node: ts.Node) => boolean, select: (node: any) => ts.Node) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  function visit(node: ts.Node) { if (!found && match(node)) found = node; ts.forEachChild(node, visit); }
  visit(source);
  if (!found) throw new Error(`Missing handler in ${file}`);
  return ts.transpileModule(`(${select(found).getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const quoteFile = "client/src/features/quotes/editor/useQuoteEditorState.ts";
const variable = (name: string, select = (node: any) => node.initializer) => expression(quoteFile, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name, select);
const noop = () => {};

test("actual Order selection ignores repeated events until create and refetch settle", async () => {
  const body = expression("client/src/components/orders/OrderLineItemsSection.tsx", (node) => ts.isJsxAttribute(node) && node.name.getText() === "onSelect" && node.getText().includes("createLineItem.mutateAsync"), (node) => node.initializer.expression);
  let finish!: () => void; let requests = 0;
  const handler = vm.runInNewContext(body, {
    lineCreateGuard: { current: new LineCreateSubmitGuard() },
    blurActiveElement: noop, normalizePbv2Tree: noop, getPbv2Tree: noop, p: { id: "p" }, orderId: "o", childParentLineItemId: "parent",
    buildInitialOrderLineItemDraftFromProduct: () => ({ productId: "p", orderId: "o" }), console: { info: noop },
    createLineItem: { mutateAsync: async (payload: any) => { requests++; expect(payload.parentLineItemId).toBe("parent"); await new Promise<void>((resolve) => { finish = resolve; }); return { id: "one" }; } },
    setSearchQuery: noop, setSearchOpen: noop, setChildParentLineItemId: noop, setInitialDraftDebugByLineItemId: noop,
    setUserEditedOptionsByLineItemId: noop, setExpandedId: noop, setPendingJumpToLineItemId: noop, onAfterLineItemsChange: noop, toast: noop,
  });
  handler(); handler(); handler(); expect(requests).toBe(1);
  finish(); await new Promise((resolve) => setTimeout(resolve, 0));
});

test("actual Quote callback retains uncertain request, creates no local placeholder, and reconciles refetched row", async () => {
  let rows: any[] = []; let inserts = 0; let loseResponse = true; let sequence = 0;
  const persisted = new Map<string, any>(); const keys: string[] = [];
  const context: any = {
    Response, products: [{ id: "p", name: "Fixture" }], quoteId: "q", lineItems: [], getProductWorkflowDefaults: () => ({}),
    lineCreateIntents: { current: new LineCreateIntentStore() }, lineCreateGuard: { current: new LineCreateSubmitGuard() },
    createQuoteLineItemTempId: () => `temp-${++sequence}`, setIsCreatingDraft: noop, toast: noop, console: { error: noop },
    setLineItems: (update: any) => { rows = update(rows); },
    apiRequest: async (_method: string, _url: string, _payload: any, options: any) => {
      const key = options.headers["Idempotency-Key"]; keys.push(key);
      if (!persisted.has(key)) persisted.set(key, { id: `canonical-${++inserts}` });
      if (loseResponse) { loseResponse = false; throw new Error("connection lost after commit"); }
      return new Response(JSON.stringify(persisted.get(key)));
    },
  };
  context.requestLineCreate = vm.runInNewContext(variable("requestLineCreate"), context);
  const add = vm.runInNewContext(variable("createDraftLineItem", (node) => node.initializer.arguments[0]), context);
  const first = add("p"); const repeated = add("p");
  expect(await repeated).toBeNull(); expect(await first).toBeNull(); expect(rows).toHaveLength(0);
  // A refresh may already have delivered the committed canonical row.
  rows = [{ id: "canonical-1" }];
  expect((await add("p")).id).toBe("canonical-1");
  expect(rows).toHaveLength(1); expect(inserts).toBe(1); expect(keys[0]).toBe(keys[1]);
  await add("p"); expect(inserts).toBe(2); expect(rows).toHaveLength(2);
});

test("all canonical frontend create calls use guarded request identity; no automatic mutation retry", () => {
  const source = readFileSync(quoteFile, "utf8");
  expect(source.match(/apiRequest\("POST", url, frozen/g)).toHaveLength(1);
  expect(source).not.toMatch(/apiRequest\("POST", `\/api\/quotes\/\$\{quoteId\}\/line-items`/);
  expect(readFileSync("client/src/lib/queryClient.ts", "utf8")).toMatch(/mutations:\s*{\s*retry: false/);
  const order = readFileSync("client/src/components/orders/OrderLineItemsSection.tsx", "utf8");
  expect(order).toMatch(/handleDuplicateItem = async[^]*?lineCreateGuard.current.run/);
  expect(order).toContain('aria-label="Add Product"');
  const quote = readFileSync("client/src/features/quotes/editor/components/LineItemsSection.tsx", "utf8");
  expect(quote).toMatch(/type="button"\s+disabled={isCreatingDraft}\s+role="combobox"/);
});
