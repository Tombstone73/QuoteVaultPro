import {
  buildTicketData,
  formatTicketDate,
  DEFAULT_TICKET_TEMPLATE,
  TICKET_FIELD_ORDER,
  type TicketSourceData,
  type TicketTemplate,
} from "../productionTicket";

const baseSource: TicketSourceData = {
  jobId: "job-abc-12345678",
  orderId: "order-xyz",
  orderNumber: "SO-1042",
  customerName: "Acme Signs Inc.",
  contactName: "Jane Doe",
  assignedTo: "Bob Operator",
  dueDate: "2026-05-22T00:00:00.000Z",
  priority: "normal",
  description: "Coroplast yard sign — full color",
  quantity: 25,
  size: "24 × 18",
  material: "4mm Coroplast",
  productionNotes: "Round corners, grommets top",
  internalNotes: "Customer is picky about color match",
  reprintCount: 1,
  stationKey: "flatbed",
};

describe("formatTicketDate", () => {
  it("formats an ISO date compactly", () => {
    expect(formatTicketDate("2026-05-22T00:00:00.000Z")).toBe("May 22, 2026");
  });

  it("returns empty string for missing or invalid dates", () => {
    expect(formatTicketDate(null)).toBe("");
    expect(formatTicketDate(undefined)).toBe("");
    expect(formatTicketDate("not-a-date")).toBe("");
  });
});

describe("buildTicketData — data mapping", () => {
  it("maps all populated fields into rows", () => {
    const ticket = buildTicketData(baseSource);
    const byKey = Object.fromEntries(ticket.rows.map((r) => [r.key, r]));

    expect(byKey.orderNumber.value).toBe("SO-1042");
    expect(byKey.customerName.value).toBe("Acme Signs Inc.");
    expect(byKey.contactName.value).toBe("Jane Doe");
    expect(byKey.assignedTo.value).toBe("Bob Operator");
    expect(byKey.dueDate.value).toBe("May 22, 2026");
    expect(byKey.quantity.value).toBe("25");
    expect(byKey.material.value).toBe("4mm Coroplast");
    expect(byKey.productionNotes.value).toBe("Round corners, grommets top");
  });

  it("omits the rush row when the job is not rush", () => {
    const ticket = buildTicketData(baseSource);
    expect(ticket.isRush).toBe(false);
    expect(ticket.rows.find((r) => r.key === "rush")).toBeUndefined();
  });

  it("includes a prominent rush row when priority is rush", () => {
    const ticket = buildTicketData({ ...baseSource, priority: "RUSH" });
    expect(ticket.isRush).toBe(true);
    const rush = ticket.rows.find((r) => r.key === "rush");
    expect(rush).toBeDefined();
    expect(rush!.value).toBe("RUSH");
    expect(rush!.format.fontSize).toBe("xlarge");
    expect(rush!.format.fontWeight).toBe("bold");
  });

  it("drops optional fields with no value", () => {
    const ticket = buildTicketData({
      ...baseSource,
      contactName: null,
      assignedTo: "",
      productionNotes: null,
      internalNotes: "  ",
    });
    const keys = ticket.rows.map((r) => r.key);
    expect(keys).not.toContain("contactName");
    expect(keys).not.toContain("assignedTo");
    expect(keys).not.toContain("productionNotes");
    expect(keys).not.toContain("internalNotes");
  });

  it("keeps required fields with an em-dash placeholder when empty", () => {
    const ticket = buildTicketData({ ...baseSource, size: "", material: "" });
    const byKey = Object.fromEntries(ticket.rows.map((r) => [r.key, r]));
    expect(byKey.size.value).toBe("—");
    expect(byKey.material.value).toBe("—");
  });
});

describe("buildTicketData — template formatting", () => {
  it("applies the default emphasis for key fields", () => {
    const ticket = buildTicketData(baseSource);
    const byKey = Object.fromEntries(ticket.rows.map((r) => [r.key, r]));

    expect(byKey.orderNumber.format.fontSize).toBe("xlarge");
    expect(byKey.orderNumber.format.fontWeight).toBe("bold");
    expect(byKey.customerName.format.fontSize).toBe("large");
    expect(byKey.customerName.format.fontWeight).toBe("bold");
    expect(byKey.dueDate.format.fontWeight).toBe("bold");
  });

  it("respects show/hide from the template", () => {
    const template: TicketTemplate = {
      ...DEFAULT_TICKET_TEMPLATE,
      fields: {
        ...DEFAULT_TICKET_TEMPLATE.fields,
        internalNotes: { ...DEFAULT_TICKET_TEMPLATE.fields.internalNotes, show: false },
      },
    };
    const ticket = buildTicketData(baseSource, template);
    expect(ticket.rows.find((r) => r.key === "internalNotes")).toBeUndefined();
  });

  it("applies a label override", () => {
    const template: TicketTemplate = {
      ...DEFAULT_TICKET_TEMPLATE,
      fields: {
        ...DEFAULT_TICKET_TEMPLATE.fields,
        quantity: { ...DEFAULT_TICKET_TEMPLATE.fields.quantity, labelOverride: "Pieces" },
      },
    };
    const ticket = buildTicketData(baseSource, template);
    expect(ticket.rows.find((r) => r.key === "quantity")!.label).toBe("Pieces");
  });

  it("orders rows by the template order field", () => {
    const template: TicketTemplate = {
      ...DEFAULT_TICKET_TEMPLATE,
      fields: {
        ...DEFAULT_TICKET_TEMPLATE.fields,
        jobId: { ...DEFAULT_TICKET_TEMPLATE.fields.jobId, order: -100 },
      },
    };
    const ticket = buildTicketData(baseSource, template);
    expect(ticket.rows[0].key).toBe("jobId");
  });

  it("keeps the canonical field set complete", () => {
    expect(new Set(TICKET_FIELD_ORDER).size).toBe(TICKET_FIELD_ORDER.length);
    expect(Object.keys(DEFAULT_TICKET_TEMPLATE.fields).sort()).toEqual(
      [...TICKET_FIELD_ORDER].sort(),
    );
  });
});
