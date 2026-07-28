import { describe, expect, test } from "@jest/globals";
import { isClearlyGeneratedInboundProvenance } from "./inboundInternalNotes";

describe("inbound internal-note compatibility projection", () => {
  test("hides only the former provenance-only text shape", () => {
    expect(isClearlyGeneratedInboundProvenance([
      "Created from inbound reviewed draft.",
      "Inbound record: inbound_123",
      "Source: email",
      "Reference: PO-123",
    ].join("\n"))).toBe(true);
  });

  test("keeps mixed and human-entered text visible", () => {
    expect(isClearlyGeneratedInboundProvenance([
      "Created from inbound reviewed draft.",
      "Inbound record: inbound_123",
      "Source: email",
      "Internal notes: Call before production.",
    ].join("\n"))).toBe(false);
    expect(isClearlyGeneratedInboundProvenance("Call before production.")).toBe(false);
  });
});
