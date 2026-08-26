import {
  buildTicketData,
  buildOrderTravelerData,
  formatTicketDate,
  DEFAULT_TICKET_TEMPLATE,
  TICKET_FIELD_ORDER,
  type OrderTravelerSource,
  type TicketSourceData,
  type TicketTemplate,
} from "../productionTicket";

const baseSource: TicketSourceData = {
  jobId: "job-abc-12345678",
  orderId: "order-xyz",
  orderNumber: "SO-1042",
  poNumber: "PO-7788",
  customerName: "Acme Signs Inc.",
  contactName: "Jane Doe",
  fulfillment: "Pickup",
  stationRoute: "Flatbed",
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
    expect(byKey.poNumber.value).toBe("PO-7788");
    expect(byKey.customerName.value).toBe("Acme Signs Inc.");
    expect(byKey.contactName.value).toBe("Jane Doe");
    expect(byKey.fulfillment.value).toBe("Pickup");
    expect(byKey.stationRoute.value).toBe("Flatbed");
    expect(byKey.dueDate.value).toBe("May 22, 2026");
    expect(byKey.quantity.value).toBe("25");
    expect(byKey.material.value).toBe("4mm Coroplast");
    expect(byKey.productionNotes.value).toBe("Round corners, grommets top");
  });

  it("hides Assigned To by default even when populated", () => {
    const ticket = buildTicketData(baseSource);
    expect(ticket.rows.find((r) => r.key === "assignedTo")).toBeUndefined();
  });

  it("places PO # directly under Order #, both above Customer", () => {
    const ticket = buildTicketData(baseSource);
    const keys = ticket.rows.map((r) => r.key);
    expect(keys.indexOf("orderNumber")).toBeLessThan(keys.indexOf("poNumber"));
    expect(keys.indexOf("poNumber")).toBeLessThan(keys.indexOf("customerName"));
  });

  it("renders a print-only quantity display override without changing data", () => {
    const ticket = buildTicketData({ ...baseSource, quantityDisplay: "150 of 200" });
    const qty = ticket.rows.find((r) => r.key === "quantity");
    expect(qty!.value).toBe("150 of 200");
  });

  it("shows a print-only ticket note when provided", () => {
    const withNote = buildTicketData({ ...baseSource, ticketNote: "Partial batch" });
    expect(withNote.rows.find((r) => r.key === "ticketNote")!.value).toBe("Partial batch");
    const without = buildTicketData(baseSource);
    expect(without.rows.find((r) => r.key === "ticketNote")).toBeUndefined();
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
    expect(byKey.customerName.format.fontSize).toBe("xlarge");
    expect(byKey.customerName.format.fontWeight).toBe("bold");
    expect(byKey.description.format.fontSize).toBe("large");
    expect(byKey.size.format.fontSize).toBe("large");
    expect(byKey.material.format.fontSize).toBe("large");
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

  it("keeps custom templates above the thermal readability floor", () => {
    const template: TicketTemplate = {
      ...DEFAULT_TICKET_TEMPLATE,
      fields: {
        ...DEFAULT_TICKET_TEMPLATE.fields,
        customerName: { ...DEFAULT_TICKET_TEMPLATE.fields.customerName, fontSize: "small" },
        material: { ...DEFAULT_TICKET_TEMPLATE.fields.material, fontSize: "normal" },
      },
    };
    const ticket = buildTicketData(baseSource, template);
    const byKey = Object.fromEntries(ticket.rows.map((r) => [r.key, r]));
    expect(byKey.customerName.format.fontSize).toBe("xlarge");
    expect(byKey.material.format.fontSize).toBe("large");
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

const baseTraveler: OrderTravelerSource = {
  orderId: "order-xyz",
  orderNumber: "SO-1042",
  poNumber: "PO-7788",
  jobLabel: "Front Lobby Signs",
  customerName: "Acme Signs Inc.",
  contactName: "Jane Doe",
  dueDate: "2026-05-22T00:00:00.000Z",
  priority: "normal",
  internalNotes: "Pickup, not shipping",
  lineItems: [
    { description: "Yard sign", quantity: 25, size: "24 × 18", material: "Coroplast", productionNotes: "Grommets" },
    { description: "Banner", quantity: 2, size: "96 × 36", material: "13oz Vinyl", productionNotes: null },
  ],
};

describe("buildOrderTravelerData", () => {
  it("builds a formatted order-level header", () => {
    const traveler = buildOrderTravelerData(baseTraveler);
    const byKey = Object.fromEntries(traveler.headerRows.map((r) => [r.key, r]));
    expect(byKey.orderNumber.value).toBe("SO-1042");
    expect(byKey.orderNumber.format.fontSize).toBe("xlarge");
    expect(byKey.poNumber.value).toBe("PO-7788");
    expect(byKey.poNumber.format.fontSize).toBe("large");
    expect(byKey.jobLabel.value).toBe("Front Lobby Signs");
    expect(byKey.jobLabel.format.fontSize).toBe("large");
    expect(byKey.customerName.value).toBe("Acme Signs Inc.");
    expect(byKey.dueDate.value).toBe("May 22, 2026");
  });

  it("does not render line-item-only fields in the header", () => {
    const traveler = buildOrderTravelerData(baseTraveler);
    const keys = traveler.headerRows.map((r) => r.key);
    expect(keys).not.toContain("quantity");
    expect(keys).not.toContain("material");
    expect(keys).not.toContain("description");
  });

  it("places the PO directly below the order number", () => {
    const keys = buildOrderTravelerData(baseTraveler).headerRows.map((row) => row.key);
    expect(keys.indexOf("orderNumber")).toBeLessThan(keys.indexOf("poNumber"));
    expect(keys.indexOf("poNumber")).toBeLessThan(keys.indexOf("jobLabel"));
    expect(keys.indexOf("poNumber")).toBeLessThan(keys.indexOf("customerName"));
  });

  it.each([
    ["both identifiers", "PO-7788", "Front Lobby Signs", "PO-7788", "Front Lobby Signs"],
    ["PO only", "Email PO", null, "Email PO", "—"],
    ["job only", null, "Front Lobby Signs", "—", "Front Lobby Signs"],
    ["neither identifier", null, null, "—", "—"],
  ])("keeps structural PO and Job rows when %s", (_case, poNumber, jobLabel, expectedPo, expectedJob) => {
    const byKey = Object.fromEntries(buildOrderTravelerData({
      ...baseTraveler,
      poNumber,
      jobLabel,
    }).headerRows.map((row) => [row.key, row]));

    expect(byKey.poNumber.value).toBe(expectedPo);
    expect(byKey.jobLabel.value).toBe(expectedJob);
  });

  it("retains long job identifiers and prints one header for multiple lines", () => {
    const longPo = "PO-" + "X".repeat(120);
    const longJob = "Customer lobby signage package " + "with extended production instructions ".repeat(8);
    const traveler = buildOrderTravelerData({
      ...baseTraveler,
      poNumber: longPo,
      jobLabel: longJob,
      lineItems: [
        ...baseTraveler.lineItems,
        { description: "Linked child panel", quantity: 1, size: "12 × 18", material: "Coroplast", productionNotes: null },
      ],
    });

    expect(traveler.headerRows.filter((row) => row.key === "poNumber")).toHaveLength(1);
    expect(traveler.headerRows.filter((row) => row.key === "jobLabel")).toHaveLength(1);
    expect(traveler.headerRows.find((row) => row.key === "poNumber")?.value).toBe(longPo);
    expect(traveler.headerRows.find((row) => row.key === "jobLabel")?.value).toBe(longJob.trim());
    expect(traveler.lineItemCount).toBe(3);
  });

  it("retains every required identifier when an older template hides optional fields", () => {
    const traveler = buildOrderTravelerData(baseTraveler, {
      ...DEFAULT_TICKET_TEMPLATE,
      fields: {
        ...DEFAULT_TICKET_TEMPLATE.fields,
        poNumber: { ...DEFAULT_TICKET_TEMPLATE.fields.poNumber, show: false },
        jobLabel: { ...DEFAULT_TICKET_TEMPLATE.fields.jobLabel, show: false },
      },
    });
    const keys = traveler.headerRows.map((row) => row.key);

    expect(keys).toEqual(expect.arrayContaining(["orderNumber", "customerName", "poNumber", "jobLabel", "dueDate"]));
  });

  it("lists every line item with resolved values", () => {
    const traveler = buildOrderTravelerData(baseTraveler);
    expect(traveler.lineItemCount).toBe(2);
    expect(traveler.totalQuantity).toBe(27);
    expect(traveler.lineItems[0]).toMatchObject({
      index: 1,
      description: "Yard sign",
      quantity: "25",
      material: "Coroplast",
    });
    expect(traveler.lineItems[1].index).toBe(2);
    expect(traveler.lineItems[1].productionNotes).toBe("");
  });

  it("falls back to em-dash for missing line-item values", () => {
    const traveler = buildOrderTravelerData({
      ...baseTraveler,
      lineItems: [{ description: "", quantity: NaN, size: null, material: null, productionNotes: null }],
    });
    expect(traveler.lineItems[0].description).toBe("—");
    expect(traveler.lineItems[0].quantity).toBe("—");
    expect(traveler.lineItems[0].size).toBe("—");
    expect(traveler.lineItems[0].material).toBe("—");
  });

  it("surfaces the rush header row only when the order is rush", () => {
    expect(buildOrderTravelerData(baseTraveler).headerRows.find((r) => r.key === "rush")).toBeUndefined();
    const rush = buildOrderTravelerData({ ...baseTraveler, priority: "rush" });
    expect(rush.isRush).toBe(true);
    expect(rush.headerRows.find((r) => r.key === "rush")).toBeDefined();
  });
});
