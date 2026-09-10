import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "node:util";

jest.mock("@/lib/queryClient", () => ({ apiRequest: jest.fn() }));
jest.mock("@/components/LineItemAttachmentsPanel", () => ({ LineItemAttachmentsPanel: () => <div data-testid="artwork-panel" /> }));
jest.mock("@/components/LineItemThumbnail", () => ({ LineItemThumbnail: () => <div data-testid="line-thumbnail" /> }));

import { cloneQuoteLineItemDraft } from "../quoteLineItemClone";
import type { QuoteLineItemDraft } from "../types";
import { LineItemsSection } from "./LineItemsSection";

Object.assign(globalThis, { TextEncoder, TextDecoder });
// react-dom/server selects its browser entry under jsdom, which needs these
// node-provided globals before the module is loaded.
const { renderToString } = require("react-dom/server");

const original: QuoteLineItemDraft = {
  id: "quote-line-original", productId: "product-1", productName: "Banner", variantId: null, variantName: null,
  productType: "wide_roll", width: 24, height: 36, quantity: 2, specsJson: { notes: "Original note" },
  selectedOptions: [], linePrice: 42, priceBreakdown: { total: 42 }, displayOrder: 0, status: "active",
  description: "Original description", productionNotes: "Original production note",
};

test("renders an expanded duplicate as its own editable Quote editor card", () => {
  const duplicate = { ...cloneQuoteLineItemDraft(original, 1), description: "Duplicated description", quantity: 5 };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  let markup = "";
  try {
    markup = renderToString(
      <QueryClientProvider client={client}>
        <LineItemsSection
          quoteId="quote-1"
          customerId="customer-1"
          readOnly={false}
          lineItems={[original, duplicate]}
          products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
          expandedKey={duplicate.tempId!}
          onExpandedKeyChange={() => undefined}
          onCreateDraftLineItem={async () => null}
          onUpdateLineItem={() => undefined}
          onSaveLineItem={async () => true}
          onDuplicateLineItem={() => undefined}
          onRemoveLineItem={() => undefined}
        />
      </QueryClientProvider>,
    );
  } finally {
    errorSpy.mockRestore();
  }

  expect(duplicate.tempId).not.toBe(original.id);
  expect(markup).toContain("Original description");
  expect(markup).toContain("Duplicated description");
  expect(markup).toContain("Qty 5");
  expect(markup).toContain("Save Item");
});
