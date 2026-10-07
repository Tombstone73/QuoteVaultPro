import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QuoteHeader } from "./QuoteHeader";

describe("Quote detail header", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test("uses Order detail header geometry and has no global Edit Mode", () => {
    const onDuplicateQuote = jest.fn();
    act(() => root.render(<QuoteHeader quoteId="quote-1" quoteNumber="123" effectiveWorkflowState="draft" onBack={jest.fn()} canDuplicateQuote onDuplicateQuote={onDuplicateQuote} />));
    expect(host.querySelector("header")?.className).toContain("border-b");
    expect(host.querySelector('[aria-label="Quote controls"]')).not.toBeNull();
    expect(host.textContent).toContain("Quote #123");
    expect(host.textContent).not.toContain("Edit Mode");
    act(() => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Duplicate")) as HTMLButtonElement).click());
    expect(onDuplicateQuote).toHaveBeenCalledTimes(1);
  });

  test("keeps the locked Quote revision action", () => {
    const onReviseQuote = jest.fn();
    act(() => root.render(<QuoteHeader quoteId="quote-1" quoteNumber="123" effectiveWorkflowState="approved" showReviseButton onBack={jest.fn()} onReviseQuote={onReviseQuote} />));
    act(() => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Revise Quote")) as HTMLButtonElement).click());
    expect(onReviseQuote).toHaveBeenCalledTimes(1);
  });

  test("places the existing save callback in the detail header", () => {
    const onSave = jest.fn();
    act(() => root.render(<QuoteHeader quoteId="quote-1" quoteNumber="123" onBack={jest.fn()} onSave={onSave} canSaveQuote />));
    act(() => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Save Changes")) as HTMLButtonElement).click());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("places Quote primary actions in the shared Order header action strip", () => {
    const onPreview = jest.fn();
    act(() => root.render(<QuoteHeader quoteId="quote-1" quoteNumber="123" onBack={jest.fn()} primaryActions={<button type="button" onClick={onPreview}>Preview</button>} />));
    const strip = host.querySelector('[aria-label="Quote controls"]');
    expect(strip?.textContent).toContain("Preview");
    act(() => (Array.from(strip!.querySelectorAll("button")).find(button => button.textContent === "Preview") as HTMLButtonElement).click());
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  test("shows the Order-style list position controls when opened from the Quote list", () => {
    const go = jest.fn(async (_direction: -1 | 1) => {});
    act(() => root.render(<QuoteHeader quoteId="quote-1" quoteNumber="123" onBack={jest.fn()} onSectionHome={jest.fn()} listNavigation={{ context: {}, position: 2, total: 5, isLoading: false, canPrevious: true, canNext: true, go }} />));
    expect(host.textContent).toContain("Open Quotes");
    expect(host.textContent).toContain("2 of 5");
    act(() => (host.querySelector('[aria-label="Next quote"]') as HTMLButtonElement).click());
    expect(go).toHaveBeenCalledWith(1);
  });

  test("keeps New Quote entry's existing header and edit toggle", () => {
    const onEditModeChange = jest.fn();
    act(() => root.render(<QuoteHeader quoteId={null} detailPresentation={false} editMode onEditModeChange={onEditModeChange} onBack={jest.fn()} />));
    expect(host.textContent).toContain("New Quote");
    expect(host.textContent).toContain("Edit Mode");
    expect(host.querySelector('[aria-label="Quote controls"]')).toBeNull();
  });
});
