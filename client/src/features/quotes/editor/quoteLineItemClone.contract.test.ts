import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("quote duplicate action uses detached clone data and stable local keys", () => {
  const state = read("client/src/features/quotes/editor/useQuoteEditorState.ts");
  const editor = read("client/src/features/quotes/editor/components/LineItemsSection.tsx");
  const savePayload = read("client/src/features/quotes/editor/quoteLineItemSavePayload.ts");
  const routes = read("server/routes/quotes.routes.ts");

  expect(state).toContain('cloneQuoteLineItemDraft(source, sourceIndex + 1)');
  expect(state).toContain('setLineItems((currentLineItems) =>');
  expect(state).not.toContain('tempId: `temp-${Date.now()}`');
  expect(editor).toContain('function getItemKey(item: QuoteLineItemDraft): string');
  expect(editor).toContain('<SortableLineItemWrapper key={itemKey} id={itemKey}>');
  expect(editor).toContain('onUpdateLineItem(expandedKey, {');
  expect(savePayload).toContain('description: mergedItem.description ?? null');
  expect(savePayload).toContain('productionNotes: mergedItem.productionNotes ?? null');
  expect(routes).toContain('description: lineItem.description ?? null');
  expect(routes).toContain('productionNotes: lineItem.productionNotes ?? null');
});
