import { describe, expect, it } from "@jest/globals";
import {
  parseTicketOverrides,
  serializeTicketOverrides,
  formatQuantityDisplay,
  resolveQuantityDisplay,
  ticketReasonBanner,
  DEFAULT_TICKET_OVERRIDES,
  type TicketPrintOverrides,
} from "./ticketPrintOverrides";

describe("formatQuantityDisplay", () => {
  it("formats a partial quantity as 'done of total'", () => {
    expect(formatQuantityDisplay(150, 200)).toBe("150 of 200");
  });

  it("returns empty string for incomplete or invalid pairs", () => {
    expect(formatQuantityDisplay(undefined, 200)).toBe("");
    expect(formatQuantityDisplay(150, undefined)).toBe("");
    expect(formatQuantityDisplay(150, 0)).toBe("");
  });
});

describe("resolveQuantityDisplay", () => {
  it("uses the actual quantity in default mode", () => {
    expect(resolveQuantityDisplay(DEFAULT_TICKET_OVERRIDES, 200)).toBe("200");
  });

  it("uses 'done of total' in partial mode", () => {
    const o: TicketPrintOverrides = {
      reason: "partial",
      quantityMode: "partial",
      quantityDone: 150,
      quantityTotal: 200,
    };
    expect(resolveQuantityDisplay(o, 200)).toBe("150 of 200");
  });

  it("falls back to the actual quantity as total when total omitted", () => {
    const o: TicketPrintOverrides = {
      reason: "partial",
      quantityMode: "partial",
      quantityDone: 150,
    };
    expect(resolveQuantityDisplay(o, 200)).toBe("150 of 200");
  });
});

describe("parseTicketOverrides", () => {
  it("returns standard defaults for an empty query", () => {
    const o = parseTicketOverrides(new URLSearchParams());
    expect(o.reason).toBe("standard");
    expect(o.quantityMode).toBe("default");
  });

  it("parses all override params", () => {
    const o = parseTicketOverrides(
      new URLSearchParams(
        "reason=partial&dest=Flatbed%20printer&qtyMode=partial&qtyDone=150&qtyTotal=200&note=Remaining%2050&route=Flatbed&fulfillment=Pickup",
      ),
    );
    expect(o).toMatchObject({
      reason: "partial",
      destination: "Flatbed printer",
      quantityMode: "partial",
      quantityDone: 150,
      quantityTotal: 200,
      note: "Remaining 50",
      stationRoute: "Flatbed",
      fulfillment: "Pickup",
    });
  });

  it("treats legacy completion=1 as the completion reason", () => {
    expect(parseTicketOverrides(new URLSearchParams("completion=1")).reason).toBe("completion");
  });

  it("ignores an invalid reason", () => {
    expect(parseTicketOverrides(new URLSearchParams("reason=bogus")).reason).toBe("standard");
  });
});

describe("serializeTicketOverrides", () => {
  it("omits default/empty values", () => {
    expect(serializeTicketOverrides(DEFAULT_TICKET_OVERRIDES)).toBe("");
  });

  it("round-trips through parse", () => {
    const original: TicketPrintOverrides = {
      reason: "partial",
      destination: "Roll printer",
      quantityMode: "partial",
      quantityDone: 30,
      quantityTotal: 80,
      note: "Batch 1",
      stationRoute: "Roll",
      fulfillment: "Delivery",
    };
    const round = parseTicketOverrides(new URLSearchParams(serializeTicketOverrides(original)));
    expect(round).toEqual(original);
  });
});

describe("ticketReasonBanner", () => {
  it("returns a banner for non-standard reasons", () => {
    expect(ticketReasonBanner("completion")).toContain("COMPLETED");
    expect(ticketReasonBanner("partial")).toContain("PARTIAL");
    expect(ticketReasonBanner("reprint")).toContain("REPRINT");
  });

  it("returns null for the standard reason", () => {
    expect(ticketReasonBanner("standard")).toBeNull();
  });
});
