import { describe, expect, test } from "@jest/globals";
import { compareCustomerQuoteLinePrice, formatCustomerPoReference, presentQuoteOptionSelections, quotePriceComparisonReviewText, savedQuoteLineTotalsMatch } from "../quoteProposalPresentation";

describe("Quote proposal display contracts", () => {
  test.each(["152858", "PO 152858", "PO #152858", "PO PO 152858"])("formats %s once", (value) => {
    expect(formatCustomerPoReference(value)).toBe("PO 152858");
  });

  test("compares complete customer line totals, including eight pieces", () => {
    expect(compareCustomerQuoteLinePrice(8436, 8436)).toMatchObject({ status: "matches", customerTotalCents: 8436, differenceCents: 0 });
    expect(compareCustomerQuoteLinePrice(8436, 12000, "Customer PO 152858")).toMatchObject({ status: "different", source: "customer_or_po_supplied", customerTotalCents: 8436, systemTotalCents: 12000, differenceCents: -3564 });
    expect(compareCustomerQuoteLinePrice(8436, 12000, "Staff approved")).toMatchObject({ source: "manual" });
    expect(compareCustomerQuoteLinePrice(8436, null)).toMatchObject({ status: "unavailable", systemTotalCents: null, differenceCents: null });
    expect(quotePriceComparisonReviewText(compareCustomerQuoteLinePrice(8436, 12000, "Customer PO"), 8))
      .toContain("$84.36 line total for 8 pieces; system $120.00 line total; difference $35.64 below");
  });

  test("requires each reviewed manual total after GO, even when the document total is unchanged", () => {
    const reviewed = [{ productId: "foam", quantity: 8, lineSubtotalCents: 8436 }, { productId: "foam", quantity: 1, lineSubtotalCents: 1200 }];
    expect(savedQuoteLineTotalsMatch(reviewed, [{ productId: "foam", quantity: 8, linePrice: "84.36" }, { productId: "foam", quantity: 1, linePrice: "12.00" }])).toBe(true);
    expect(savedQuoteLineTotalsMatch(reviewed, [{ productId: "foam", quantity: 8, linePrice: "83.36" }, { productId: "foam", quantity: 1, linePrice: "13.00" }])).toBe(false);
  });

  test("resolves imported Product identifiers and choice labels without changing saved selections", () => {
    const id = "c1857862-93e5-48ed-b197-01e3109f7b2b";
    const key = `opt_opt_${id}`;
    const selections = { [key]: "choice_1" };
    const snapshot = { treeJson: { schemaVersion: 2, rootNodeIds: [id], nodes: { [id]: {
      id, key, kind: "question", label: "Printing", input: { type: "select", selectionKey: key },
      choices: [{ value: "choice_1", label: "Double-sided" }, { value: "choice_2", label: "Single-sided" }],
    } }, edges: [] } };
    expect(presentQuoteOptionSelections(selections, snapshot)).toEqual([{ label: "Printing", choice: "Double-sided", available: true }]);
    expect(selections[key]).toBe("choice_1");
    expect(presentQuoteOptionSelections({ [key]: "choice_9" }, snapshot)).toEqual([{ label: "Printing", choice: "Saved choice unavailable", available: false }]);
    expect(presentQuoteOptionSelections({ unknown_id: "choice_1" }, snapshot)).toEqual([{ label: "Option unavailable", choice: "Saved choice unavailable", available: false }]);
  });

  test("uses saved legacy option labels only when both labels were actually persisted", () => {
    const selections = { legacy_print: "double_sided" };
    expect(presentQuoteOptionSelections(selections, { selectedOptions: [{ optionId: "legacy_print", optionName: "Printing", value: "double_sided", selectedLabel: "Double-sided" }] }))
      .toEqual([{ label: "Printing", choice: "Double-sided", available: true }]);
    expect(presentQuoteOptionSelections(selections, { selectedOptions: [{ optionId: "legacy_print", optionName: "Printing", value: "double_sided" }] }))
      .toEqual([{ label: "Printing", choice: "Saved choice unavailable", available: false }]);
  });
});
