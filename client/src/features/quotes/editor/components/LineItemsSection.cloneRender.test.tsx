import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "node:util";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

jest.mock("@/lib/queryClient", () => ({ apiRequest: jest.fn() }));
let mockArtworkProps: any;
jest.mock("@/components/LineItemAttachmentsPanel", () => ({ LineItemAttachmentsPanel: (props: any) => { mockArtworkProps = props; return <div data-testid="artwork-panel" />; } }));
jest.mock("@/components/LineItemThumbnail", () => ({ LineItemThumbnail: () => <div data-testid="line-thumbnail" /> }));

import { cloneQuoteLineItemDraft } from "../quoteLineItemClone";
import { apiRequest } from "@/lib/queryClient";
import type { QuoteLineItemDraft } from "../types";
import { LineItemsSection } from "./LineItemsSection";

Object.assign(globalThis, { TextEncoder, TextDecoder });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

test("saved Quote detail uses the Order line-item section and expanded column geometry", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement("div");
  try {
    host.innerHTML = renderToString(
      <QueryClientProvider client={client}>
        <LineItemsSection
          detailPresentation quoteId="quote-1" customerId="customer-1" readOnly={false}
          lineItems={[original]} products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
          expandedKey={original.id!} onExpandedKeyChange={() => undefined}
          onCreateDraftLineItem={async () => null} onUpdateLineItem={() => undefined}
          onSaveLineItem={async () => true} onDuplicateLineItem={() => undefined} onRemoveLineItem={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(host.querySelector(".border-0.bg-transparent.shadow-none")).not.toBeNull();
    expect(host.textContent).toContain("Line Items");
    expect(host.textContent).toContain("1 item");
    expect(host.querySelectorAll('section[aria-label="Dimensions & Pricing"]')).toHaveLength(1);
    expect(host.querySelectorAll('section[aria-label="Product Options"]')).toHaveLength(1);
    expect(host.querySelectorAll('section[aria-label="Artwork"]')).toHaveLength(1);
    expect(Array.from(host.querySelectorAll("button")).filter(button => /add product/i.test(button.textContent ?? ""))).toHaveLength(1);
  } finally {
    errorSpy.mockRestore(); client.clear();
  }
});

test.each([
  { lineItems: [] },
  { lineItems: [original] },
  { lineItems: [original, { ...original, id: "line-two", displayOrder: 1 }] },
])(
  "Order Entry exposes one Add Product picker for $lineItems.length lines",
  ({ lineItems }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement("div");
    try {
      host.innerHTML = renderToString(
        <QueryClientProvider client={client}>
          <LineItemsSection
            createTarget="order" quoteId={null} customerId="customer-1" readOnly={false}
            lineItems={lineItems} products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
            expandedKey={null} onExpandedKeyChange={() => undefined}
            onCreateDraftLineItem={async () => null} onUpdateLineItem={() => undefined}
            onSaveLineItem={async () => true} onDuplicateLineItem={() => undefined} onRemoveLineItem={() => undefined}
          />
        </QueryClientProvider>,
      );
      const addButtons = Array.from(host.querySelectorAll("button")).filter((button) => /add product/i.test(button.textContent ?? ""));
      expect(addButtons).toHaveLength(1);
      expect(host.textContent?.includes("No line items yet")).toBe(lineItems.length === 0);
      if (lineItems.length) expect(host.textContent).toContain("Original description");
    } finally {
      errorSpy.mockRestore(); client.clear();
    }
  },
);

test("expanded New Order line exposes the displayed Unit Price as the edit target", () => {
  const line = { ...original, quantity: 20, linePrice: 120, formulaLinePrice: 120, priceBreakdown: { total: 120 } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement("div");
  try {
    host.innerHTML = renderToString(
      <QueryClientProvider client={client}>
        <LineItemsSection
          createTarget="order" quoteId={null} customerId="customer-1" readOnly={false}
          lineItems={[line]}
          products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
          expandedKey={line.id!} onExpandedKeyChange={() => undefined}
          onCreateDraftLineItem={async () => null} onUpdateLineItem={() => undefined}
          onSaveLineItem={async () => true} onDuplicateLineItem={() => undefined} onRemoveLineItem={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(host.querySelector('button[aria-label="Edit unit price"]')).toBeTruthy();
    expect(host.textContent).toContain("$6.00/ea");
    expect(host.textContent).toContain("$120.00");
    expect(host.querySelector('select[aria-label="Price override mode"]')).toBeTruthy();
  } finally {
    errorSpy.mockRestore(); client.clear();
  }
});

test.each([
  { mode: "override_total_after_margin", totalEditable: true },
  { mode: "override_unit_after_margin", totalEditable: false },
])("New Order $mode places editing on the corresponding price field", ({ mode, totalEditable }) => {
  const line = {
    ...original, quantity: 20, linePrice: 110, formulaLinePrice: 120,
    priceOverride: { mode, valueCents: totalEditable ? 11_000 : 550 }, overridePriceCents: 11_000,
  } as QuoteLineItemDraft;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement("div");
  try {
    host.innerHTML = renderToString(
      <QueryClientProvider client={client}>
        <LineItemsSection
          createTarget="order" quoteId={null} customerId="customer-1" readOnly={false}
          lineItems={[line]}
          products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
          expandedKey={line.id!} onExpandedKeyChange={() => undefined}
          onCreateDraftLineItem={async () => null} onUpdateLineItem={() => undefined}
          onSaveLineItem={async () => true} onDuplicateLineItem={() => undefined} onRemoveLineItem={() => undefined}
        />
      </QueryClientProvider>,
    );
    const pricing = host.querySelector('[data-testid="order-line-pricing-row"]')!;
    const totalButton = Array.from(pricing.querySelectorAll("button")).find((button) => button.textContent?.includes("$110.00"));
    expect(totalButton).toBeTruthy();
    expect(totalButton?.disabled).toBe(!totalEditable);
    expect(pricing.querySelector('button[aria-label="Edit unit price"]')).toBeTruthy();
  } finally {
    errorSpy.mockRestore(); client.clear();
  }
});

test("typing into New Order Unit Price saves the existing unit override metadata", async () => {
  const line = { ...original, quantity: 20, linePrice: 120, formulaLinePrice: 120, priceBreakdown: { total: 120 } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onUpdateLineItem = jest.fn();
  const onSaveLineItem = jest.fn(async () => true);
  jest.mocked(apiRequest).mockResolvedValue({ json: async () => ({ linePrice: 120 }) } as any);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <LineItemsSection
            createTarget="order" quoteId={null} customerId="customer-1" readOnly={false}
            lineItems={[line]}
            products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
            expandedKey={line.id!} onExpandedKeyChange={() => undefined}
            onCreateDraftLineItem={async () => null} onUpdateLineItem={onUpdateLineItem}
            onSaveLineItem={onSaveLineItem} onDuplicateLineItem={() => undefined} onRemoveLineItem={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
    const edit = host.querySelector('button[aria-label="Edit unit price"]') as HTMLButtonElement;
    expect(edit).toBeTruthy();
    await act(async () => edit.click());
    const input = host.querySelector('input[aria-label="Unit price override"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      input.value = "5.50";
      Simulate.change(input);
    });
    await act(async () => Simulate.blur(input));
    expect(onUpdateLineItem.mock.calls.some(([, patch]) => (patch as any)?.priceOverride?.mode === "override_unit_after_margin"
      && (patch as any)?.priceOverride?.valueCents === 550
      && (patch as any)?.priceOverride?.effectiveTotalCents === 11_000)).toBe(true);
    expect(onSaveLineItem).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove(); client.clear();
    jest.mocked(apiRequest).mockReset();
  }
});

test("switching a New Order Total Override to Unit Override starts from the displayed unit price", async () => {
  const line = {
    ...original, quantity: 20, linePrice: 110, formulaLinePrice: 120,
    priceOverride: { mode: "override_total_after_margin", valueCents: 11_000 }, overridePriceCents: 11_000,
  } as QuoteLineItemDraft;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onUpdateLineItem = jest.fn();
  jest.mocked(apiRequest).mockResolvedValue({ json: async () => ({ linePrice: 120 }) } as any);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <LineItemsSection
            createTarget="order" quoteId={null} customerId="customer-1" readOnly={false}
            lineItems={[line]}
            products={[{ id: "product-1", name: "Banner", measurementMode: "dimensions_required", optionsJson: [] } as any]}
            expandedKey={line.id!} onExpandedKeyChange={() => undefined}
            onCreateDraftLineItem={async () => null} onUpdateLineItem={onUpdateLineItem}
            onSaveLineItem={async () => true} onDuplicateLineItem={() => undefined} onRemoveLineItem={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
    const select = host.querySelector('select[aria-label="Price override mode"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "override_unit_after_margin";
      Simulate.change(select);
    });
    expect(onUpdateLineItem.mock.calls.some(([, patch]) => (patch as any)?.priceOverride?.mode === "override_unit_after_margin"
      && (patch as any)?.priceOverride?.valueCents === 550
      && (patch as any)?.priceOverride?.effectiveTotalCents === 11_000)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove(); client.clear();
    jest.mocked(apiRequest).mockReset();
  }
});

test("applying PDF inches uses shared PBV2 pricing and preserves quantity, choices, overrides and artwork through saved rehydration", async () => {
  const tree = { schemaVersion: 2, rootNodeIds: ['finish'], nodes: { finish: { id: 'finish', kind: 'question', label: 'Finish', input: { type: 'select', required: true, selectionKey: 'finish' }, choices: [{value:'matte',label:'Matte'},{value:'gloss',label:'Gloss'}] } }, meta: { requiresDimensions: true } };
  const options = { schemaVersion: 2 as const, selected: { finish: { value: 'matte' } } };
  const attachment = { uploadId: 'existing-art', fileName: 'art.pdf', mimeType: 'application/pdf', sizeBytes: 100, uploadedAt: '2026-11-03T00:00:00Z', role: 'artwork' as const, productionQuantity: 28 };
  const initial = { ...original, width: 24, height: 36, quantity: 28, linePrice: 165, formulaLinePrice: 120, pbv2TreeVersionId: 'tree-1', optionSelectionsJson: options, pbv2SnapshotJson: {treeJson: tree}, pendingOrderAttachments: [attachment], priceOverride: { mode: 'override_total_after_margin', valueCents: 16500 }, overridePriceCents: 16500 } as QuoteLineItemDraft;
  let current = initial;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['/api/products', 'product-1', 'pbv2/tree', 'tree-1'], { active: { id: 'tree-1', treeJson: tree } });
  jest.mocked(apiRequest).mockResolvedValue({ json: async () => ({ linePrice: 90, pbv2TreeVersionId: 'tree-1' }) } as any);
  function Harness({ saved = initial }: { saved?: QuoteLineItemDraft }) {
    const [line, setLine] = useState(saved); current = line;
    return <LineItemsSection createTarget="order" quoteId={null} readOnly={false} lineItems={[line]} products={[{ id: 'product-1', name: 'Banner', measurementMode: 'dimensions_required', pbv2ActiveTreeVersionId: 'tree-1', optionsJson: [] } as any]} expandedKey={line.id!} onExpandedKeyChange={() => {}} onCreateDraftLineItem={async () => null} onUpdateLineItem={(_key, patch) => setLine(previous => ({ ...previous, ...patch }))} onSaveLineItem={async () => true} onDuplicateLineItem={() => {}} onRemoveLineItem={() => {}} />;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    expect(mockArtworkProps.showPdfDimensions).toBe(true); expect(mockArtworkProps.onApplyPdfDimensions).toBeInstanceOf(Function);
    await act(async () => mockArtworkProps.onApplyPdfDimensions(2.25, 2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
    expect(jest.mocked(apiRequest).mock.calls.some(([method, url, payload]) => method === 'POST' && url === '/api/quotes/calculate' && (payload as any).width === 2.25 && (payload as any).height === 2 && (payload as any).quantity === 28 && (payload as any).optionSelectionsJson?.finish?.value === 'matte')).toBe(true);
    expect(current).toMatchObject({ width: 2.25, height: 2, quantity: 28, linePrice: 165, overridePriceCents: 16500, optionSelectionsJson: options, pendingOrderAttachments: [attachment] });
    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Save Item')!;
    await act(async () => save.click());
    const saved = JSON.parse(JSON.stringify(current));
    await act(async () => root.render(<QueryClientProvider client={client}><Harness key="fresh-readback" saved={saved} /></QueryClientProvider>));
    expect(current).toMatchObject({ width: 2.25, height: 2, quantity: 28, linePrice: 165, optionSelectionsJson: options, pendingOrderAttachments: [attachment] });
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); jest.mocked(apiRequest).mockReset(); }
});
