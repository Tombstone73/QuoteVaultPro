// Mock data layer for the PrintersHero V2 prototype.
// No backend — everything here is realistic print-shop sample data.

export type DocumentType = "Quote" | "Order";
export type QuoteStatus = "Draft" | "Sent" | "Accepted" | "Converted" | "Declined" | "Expired";
export type OrderStatus = "Open" | "In Production" | "Ready" | "Shipped" | "Complete" | "Cancelled";
export type InvoiceStatus = "Draft" | "Issued";
export type Settlement = "Unpaid" | "Partially Paid" | "Paid";
export type RouteStepKey = "Proofing" | "Prepress" | "Production" | "Finishing" | "Fulfillment";
export type ArtworkStatus = "Needs Artwork" | "Proof Pending" | "Approved" | "Production Ready";

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  title?: string | undefined;
  portalAccess?: string | undefined;
}

export interface Customer {
  id: string;
  name: string;
  status: "Active" | "On Hold" | "Prospect";
  terms: string;
  primaryContactId: string;
  contacts: Contact[];
  address: string;
  openOrders: number;
  balance: number;
  creditLimit: number;
  lastOrder: string;
  totalSales: number;
  rep: string;
  brand?: { color: string; slug: string } | undefined;
}

export interface ProductOption {
  label: string;
  value: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  type: "Printed" | "Printed + Finishing" | "Static / Resale" | "Apparel";
  pricingMethod: "Area Matrix" | "Qty Tier" | "Formula" | "Flat";
  active: boolean;
  routeTemplate: string;
  basis: string;
  recipe: { material: string; rule: string; waste: string }[];
}

export type ArtSide = "Single" | "Front" | "Back";

/** Artwork attached to a line item. Sales displays it; the Artwork module owns versions/relationships. */
export interface LineArt {
  id: string;
  name: string;
  side: ArtSide;
  kind: "line" | "production";
  addedBy?: string | undefined;
  addedAt?: string | undefined;
}

export interface LineItem {
  id: string;
  productId: string;
  description: string;
  size?: string | undefined;
  qty: number;
  options: ProductOption[];
  calcUnit: number;
  sellUnit: number;
  overrideReason?: string | undefined;
  overrideBy?: string | undefined;
  artworkStatus: ArtworkStatus;
  routeStep: RouteStepKey;
  station?: string | undefined;
  pickedUp?: number | undefined;
  /** Note attached to this specific line item (distinct from order/customer notes). */
  notes?: string | undefined;
  /** Artwork attached to this line item. Sales may add Line Art; Production Art is read-only here. */
  art?: LineArt[] | undefined;
}

export interface HistoryEntry {
  at: string;
  who: string;
  what: string;
  kind?: "revision" | "convert" | "edit" | "status" | undefined;
}

export interface SalesDoc {
  id: string;
  number: string;
  documentType: DocumentType;
  status: QuoteStatus | OrderStatus;
  customerId: string;
  contactId: string;
  po: string;
  dueDate: string;
  createdAt: string;
  rep: string;
  notes: string;
  lines: LineItem[];
  history: HistoryEntry[];
  invoiceId?: string | undefined;
  convertedTo?: string | undefined;
  convertedFrom?: string | undefined;
  shipMethod?: string | undefined;
  jobName?: string | undefined;
  customerNotes?: string | undefined;
}

export interface Payment {
  id: string;
  date: string;
  method: string;
  ref: string;
  amount: number;
  by?: string | undefined;
}

export interface Refund {
  id: string;
  paymentId: string;
  date: string;
  method: string;
  ref: string;
  amount: number;
  by?: string | undefined;
}

export interface Invoice {
  id: string;
  number: string;
  orderId: string;
  customerId: string;
  status: InvoiceStatus;
  issueDate?: string | undefined;
  dueDate?: string | undefined;
  terms: string;
  payments: Payment[];
  refunds: Refund[];
}

export interface Material {
  id: string;
  name: string;
  sku: string;
  category: string;
  onHand: number;
  reserved: number;
  reorder: number;
  unit: string;
  vendor: string;
  cost: number;
}

export const CURRENT_USER = { name: "Dale Hensley", initials: "DH", role: "Owner", org: "Hensley Print Co." };

export const customers: Customer[] = [
  {
    id: "c1", name: "Delta Faucet Company", status: "Active", terms: "Net 30",
    primaryContactId: "ct1", address: "55 E 111th St, Indianapolis, IN",
    openOrders: 4, balance: 8420.5, creditLimit: 25000, lastOrder: "Aug 12, 2026", totalSales: 184320, rep: "Dale",
    brand: { color: "#0B6FB4", slug: "delta" },
    contacts: [
      { id: "ct1", name: "Susan Johnson", email: "susan@deltafaucet.com", phone: "317-555-1212", title: "Marketing Ops", portalAccess: "Full Portal Customer" },
      { id: "ct2", name: "Marcus Webb", email: "mwebb@deltafaucet.com", phone: "317-555-8890", title: "Facilities", portalAccess: "View Only Customer" },
    ],
  },
  {
    id: "c2", name: "Ace Hardware — Lafayette", status: "Active", terms: "Net 15",
    primaryContactId: "ct3", address: "2200 Sagamore Pkwy, Lafayette, IN",
    openOrders: 2, balance: 1240, creditLimit: 10000, lastOrder: "Aug 13, 2026", totalSales: 42890, rep: "Dale",
    brand: { color: "#C8102E", slug: "ace" },
    contacts: [{ id: "ct3", name: "Bill Kramer", email: "bill@acelaf.com", phone: "765-555-3311", title: "Store Manager" }],
  },
  {
    id: "c3", name: "Metro Area Printing", status: "Active", terms: "Net 30",
    primaryContactId: "ct4", address: "912 Industrial Dr, Indianapolis, IN",
    openOrders: 6, balance: 15230.75, creditLimit: 40000, lastOrder: "Aug 14, 2026", totalSales: 322400, rep: "Angela",
    contacts: [{ id: "ct4", name: "Priya Raman", email: "priya@metroareaprint.com", phone: "317-555-7744", title: "Trade Buyer" }],
  },
  {
    id: "c4", name: "Creative Ink Lafayette", status: "Active", terms: "Net 30",
    primaryContactId: "ct5", address: "410 Main St, Lafayette, IN",
    openOrders: 1, balance: 0, creditLimit: 7500, lastOrder: "Jul 30, 2026", totalSales: 28100, rep: "Angela",
    contacts: [{ id: "ct5", name: "Toby Ellison", email: "toby@creativeink.co", phone: "765-555-2200" }],
  },
  {
    id: "c5", name: "McDonald's Franchise Group", status: "Active", terms: "Net 45",
    primaryContactId: "ct6", address: "77 Franchise Way, Carmel, IN",
    openOrders: 3, balance: 6110.25, creditLimit: 50000, lastOrder: "Aug 11, 2026", totalSales: 210500, rep: "Dale",
    contacts: [{ id: "ct6", name: "Renee Alvarez", email: "renee@mcdfg.com", phone: "317-555-9021", title: "Regional Marketing" }],
  },
  {
    id: "c6", name: "Purdue Athletics", status: "On Hold", terms: "Prepay",
    primaryContactId: "ct7", address: "900 John R Wooden Dr, West Lafayette, IN",
    openOrders: 0, balance: 3200, creditLimit: 15000, lastOrder: "Jun 22, 2026", totalSales: 96700, rep: "Angela",
    contacts: [{ id: "ct7", name: "Coach Dan Whitley", email: "dwhitley@purdue.edu", phone: "765-555-0100" }],
  },
];

export const products: Product[] = [
  {
    id: "p1", sku: "BAN-13OZ", name: "13oz Vinyl Banner", category: "Banners", type: "Printed + Finishing",
    pricingMethod: "Area Matrix", active: true, routeTemplate: "Printed + Finishing", basis: "sq ft",
    recipe: [
      { material: "13oz Scrim Banner", rule: "area", waste: "6%" },
      { material: "Banner Hem Tape", rule: "perimeter", waste: "3%" },
      { material: "Brass Grommet", rule: "selected.grommetCount", waste: "0%" },
    ],
  },
  {
    id: "p2", sku: "CORO-4MM", name: "4mm Coroplast Sign", category: "Rigid Signs", type: "Printed",
    pricingMethod: "Area Matrix", active: true, routeTemplate: "Printed Product", basis: "sq ft",
    recipe: [
      { material: "4mm Coroplast 48x96", rule: "area", waste: "5%" },
      { material: "UV Ink Set", rule: "coverage", waste: "0%" },
    ],
  },
  {
    id: "p3", sku: "STK-CONTOUR", name: "Contour Cut Stickers", category: "Decals", type: "Printed + Finishing",
    pricingMethod: "Qty Tier", active: true, routeTemplate: "Printed + Finishing", basis: "each",
    recipe: [
      { material: "Cast Vinyl 54in", rule: "area", waste: "12%" },
      { material: "Gloss Laminate", rule: "area", waste: "12%" },
    ],
  },
  {
    id: "p4", sku: "SIGN-REFL", name: "Reflective Pole Sign", category: "Traffic", type: "Printed + Finishing",
    pricingMethod: "Formula", active: true, routeTemplate: "Printed + Finishing", basis: "each",
    recipe: [
      { material: "4mm Coroplast 48x96", rule: "area", waste: "5%" },
      { material: "Reflective Vinyl", rule: "area", waste: "8%" },
      { material: "Brass Grommet", rule: "2 each", waste: "0%" },
    ],
  },
  {
    id: "p5", sku: "ACM-3MM", name: "ACM Sign Panel", category: "Rigid Signs", type: "Printed",
    pricingMethod: "Area Matrix", active: true, routeTemplate: "Printed Product", basis: "sq ft",
    recipe: [{ material: "3mm ACM 48x96", rule: "area", waste: "7%" }],
  },
  {
    id: "p6", sku: "VIN-TRANS", name: "Translucent Vinyl Print", category: "Decals", type: "Printed",
    pricingMethod: "Area Matrix", active: true, routeTemplate: "Printed Product", basis: "sq ft",
    recipe: [{ material: "Translucent Vinyl 54in", rule: "area", waste: "10%" }],
  },
  {
    id: "p7", sku: "APP-DTF", name: "Apparel Print — DTF", category: "Apparel", type: "Apparel",
    pricingMethod: "Qty Tier", active: true, routeTemplate: "Printed Product", basis: "each",
    recipe: [{ material: "DTF Film", rule: "area", waste: "9%" }],
  },
  {
    id: "p8", sku: "HW-UCHAN", name: "U-Channel Stake 30in", category: "Hardware", type: "Static / Resale",
    pricingMethod: "Flat", active: true, routeTemplate: "Static / Resale", basis: "each",
    recipe: [{ material: "U-Channel Stake", rule: "1 each", waste: "0%" }],
  },
];

export const materials: Material[] = [
  { id: "m1", name: "4mm Coroplast 48x96", sku: "CORO-4896", category: "Rigid Substrate", onHand: 210, reserved: 64, reorder: 100, unit: "sheet", vendor: "Grimco", cost: 8.4 },
  { id: "m2", name: "13oz Scrim Banner", sku: "BAN-13-54", category: "Roll Media", onHand: 6, reserved: 2, reorder: 8, unit: "roll", vendor: "Fellers", cost: 128 },
  { id: "m3", name: "Reflective Vinyl", sku: "REF-3M-48", category: "Roll Media", onHand: 2, reserved: 1, reorder: 4, unit: "roll", vendor: "3M", cost: 410 },
  { id: "m4", name: "Brass Grommet", sku: "GRM-BR-38", category: "Hardware", onHand: 4200, reserved: 850, reorder: 1500, unit: "each", vendor: "Grimco", cost: 0.06 },
  { id: "m5", name: "Cast Vinyl 54in", sku: "CST-54", category: "Roll Media", onHand: 9, reserved: 3, reorder: 5, unit: "roll", vendor: "Fellers", cost: 245 },
  { id: "m6", name: "Gloss Laminate", sku: "LAM-G-54", category: "Roll Media", onHand: 3, reserved: 1, reorder: 4, unit: "roll", vendor: "Fellers", cost: 198 },
  { id: "m7", name: "3mm ACM 48x96", sku: "ACM-3-4896", category: "Rigid Substrate", onHand: 48, reserved: 20, reorder: 30, unit: "sheet", vendor: "Grimco", cost: 34.5 },
  { id: "m8", name: "U-Channel Stake", sku: "UCH-30", category: "Hardware", onHand: 320, reserved: 100, reorder: 150, unit: "each", vendor: "Grimco", cost: 3.1 },
  { id: "m9", name: "DTF Film", sku: "DTF-24", category: "Roll Media", onHand: 5, reserved: 0, reorder: 3, unit: "roll", vendor: "STS", cost: 89 },
];

const L = (o: Partial<LineItem> & { id: string; productId: string; qty: number; calcUnit: number }): LineItem => ({
  description: "", options: [], sellUnit: o.calcUnit, artworkStatus: "Production Ready",
  routeStep: "Production", ...o,
});

export const salesDocs: SalesDoc[] = [
  {
    id: "d1", number: "10452", documentType: "Quote", status: "Sent", customerId: "c1", contactId: "ct1",
    po: "84721", dueDate: "Aug 22, 2026", createdAt: "Aug 14, 2026", rep: "Dale",
    notes: "Customer wants matching artwork across all three sizes. Confirm reflective grade before production.",
    lines: [
      L({ id: "l1", productId: "p4", qty: 50, calcUnit: 52.4, sellUnit: 50, overrideReason: "Volume match to competitor bid", overrideBy: "Dale", size: '18" × 24"', description: "Reflective Pole Sign — Engineer Grade", options: [{ label: "Grommets", value: "2 (top)" }, { label: "Sides", value: "Single" }], artworkStatus: "Approved", routeStep: "Proofing" }),
      L({ id: "l2", productId: "p2", qty: 100, calcUnit: 11.8, size: '24" × 18"', description: "4mm Coroplast Sign — Full Color", options: [{ label: "Sides", value: "Double" }, { label: "Flutes", value: "Vertical" }], artworkStatus: "Proof Pending", routeStep: "Proofing" }),
      L({ id: "l3", productId: "p8", qty: 100, calcUnit: 4.25, description: "U-Channel Stake 30in", options: [], artworkStatus: "Production Ready", routeStep: "Fulfillment" }),
    ],
    history: [
      { at: "Aug 14, 9:12 AM", who: "Dale", what: "Quote created", kind: "edit" },
      { at: "Aug 15, 2:40 PM", who: "Dale", what: "Quote sent to susan@deltafaucet.com", kind: "revision" },
      { at: "Aug 17, 10:05 AM", who: "Dale", what: 'Changed quantity on "4mm Coroplast Sign" from 75 to 100', kind: "edit" },
      { at: "Aug 17, 4:22 PM", who: "Dale", what: "Quote sent to susan@deltafaucet.com", kind: "revision" },
    ],
  },
  {
    id: "d2", number: "10671", documentType: "Order", status: "In Production", customerId: "c1", contactId: "ct1",
    po: "84902", dueDate: "Aug 19, 2026", createdAt: "Aug 12, 2026", rep: "Dale", invoiceId: "i1", convertedFrom: "10388",
    shipMethod: "Customer Pickup",
    jobName: "Delta — Store Hours Refresh",
    notes: "Susan will pick up in two visits. First 40 signs by Friday morning.",
    customerNotes: "Pickup at the front counter, ask for Susan Johnson. Bring the banner rolled, not folded.",
    lines: [
      L({ id: "l4", productId: "p2", qty: 75, calcUnit: 12.6, sellUnit: 12.6, size: '24" × 18"', description: "4mm Coroplast Sign — Store Hours", options: [{ label: "Sides", value: "Single" }], routeStep: "Production", station: "Océ Arizona", pickedUp: 40, art: [
        { id: "a1", name: "delta-store-hours.pdf", side: "Single", kind: "line", addedBy: "Dale", addedAt: "Aug 12" },
        { id: "a2", name: "print-ready-store-hours.pdf", side: "Single", kind: "production", addedBy: "Prepress", addedAt: "Aug 14" },
      ] }),
      L({ id: "l5", productId: "p1", qty: 6, calcUnit: 84, sellUnit: 78, overrideReason: "Reprint credit applied", overrideBy: "Angela", size: "3ft × 8ft", description: "13oz Banner — Grand Reopening", options: [{ label: "Hem", value: "All sides" }, { label: "Grommets", value: "Every 24in" }], artworkStatus: "Needs Artwork", routeStep: "Finishing", station: "Finishing Bench", pickedUp: 0 }),
      L({ id: "l6", productId: "p3", qty: 500, calcUnit: 0.92, description: "Contour Cut Stickers — Logo 3in", options: [{ label: "Laminate", value: "Gloss" }, { label: "Sides", value: "Double" }], routeStep: "Prepress", station: "Roland", pickedUp: 0, artworkStatus: "Proof Pending", art: [
        { id: "a3", name: "logo-3in-front.ai", side: "Front", kind: "line", addedBy: "Angela", addedAt: "Aug 13" },
        { id: "a4", name: "logo-3in-back.ai", side: "Back", kind: "line", addedBy: "Angela", addedAt: "Aug 13" },
      ] }),
    ],
    history: [
      { at: "Aug 12, 10:42 AM", who: "Susan", what: "Changed Contact and Due Date", kind: "edit" },
      { at: "Aug 12, 10:51 AM", who: "Dale", what: 'Changed quantity on "4mm Coroplast Sign" from 50 to 75', kind: "edit" },
      { at: "Aug 12, 11:02 AM", who: "Dale", what: "Quote 10388 converted to Order #10671", kind: "convert" },
      { at: "Aug 13, 8:30 AM", who: "Marco", what: "Prepress marked ready — Océ Arizona", kind: "status" },
      { at: "Aug 14, 1:15 PM", who: "Susan", what: "Partial pickup recorded — 40 of 75 signs", kind: "status" },
    ],
  },
  {
    id: "d3", number: "10672", documentType: "Order", status: "Open", customerId: "c5", contactId: "ct6",
    po: "MCD-2291", dueDate: "Aug 18, 2026", createdAt: "Aug 13, 2026", rep: "Dale", invoiceId: "i2",
    shipMethod: "UPS Ground",
    notes: "Twelve store locations — pack per store.",
    lines: [
      L({ id: "l7", productId: "p6", qty: 240, calcUnit: 3.4, size: '12" × 12"', description: "Translucent Vinyl — Window Cling Set", options: [{ label: "Cut", value: "Kiss cut" }], routeStep: "Prepress", station: "Roland", artworkStatus: "Proof Pending" }),
      L({ id: "l8", productId: "p5", qty: 12, calcUnit: 96.5, size: '48" × 24"', description: "ACM Sign Panel — Drive-Thru", options: [{ label: "Mount", value: "Predrilled" }], routeStep: "Production", station: "Océ Arizona" }),
    ],
    history: [{ at: "Aug 13, 3:02 PM", who: "Dale", what: "Order created", kind: "edit" }],
  },
  {
    id: "d4", number: "10673", documentType: "Order", status: "Ready", customerId: "c2", contactId: "ct3",
    po: "ACE-5512", dueDate: "Aug 15, 2026", createdAt: "Aug 10, 2026", rep: "Dale", invoiceId: "i3",
    shipMethod: "Customer Pickup", notes: "",
    lines: [
      L({ id: "l9", productId: "p1", qty: 2, calcUnit: 96, size: "4ft × 10ft", description: "13oz Banner — Fall Sale", options: [{ label: "Hem", value: "All sides" }], routeStep: "Fulfillment", pickedUp: 0 }),
    ],
    history: [{ at: "Aug 10, 9:00 AM", who: "Angela", what: "Order created", kind: "edit" }],
  },
  {
    id: "d5", number: "10460", documentType: "Quote", status: "Draft", customerId: "c3", contactId: "ct4",
    po: "", dueDate: "Aug 29, 2026", createdAt: "Aug 15, 2026", rep: "Angela", notes: "Trade pricing.",
    lines: [
      L({ id: "l10", productId: "p3", qty: 2000, calcUnit: 0.54, description: "Contour Cut Stickers — 2in circle", options: [{ label: "Laminate", value: "Matte" }], routeStep: "Proofing", artworkStatus: "Needs Artwork" }),
    ],
    history: [{ at: "Aug 15, 8:15 AM", who: "Angela", what: "Quote created", kind: "edit" }],
  },
  {
    id: "d6", number: "10455", documentType: "Quote", status: "Accepted", customerId: "c4", contactId: "ct5",
    po: "CI-8890", dueDate: "Aug 26, 2026", createdAt: "Aug 13, 2026", rep: "Angela", notes: "",
    lines: [
      L({ id: "l11", productId: "p7", qty: 144, calcUnit: 7.25, description: "Apparel Print — DTF 11in front", options: [{ label: "Placement", value: "Front center" }], routeStep: "Proofing" }),
    ],
    history: [
      { at: "Aug 13, 11:00 AM", who: "Angela", what: "Quote created", kind: "edit" },
      { at: "Aug 13, 4:30 PM", who: "Angela", what: "Quote sent to toby@creativeink.co", kind: "revision" },
      { at: "Aug 14, 9:10 AM", who: "Toby", what: "Quote accepted by customer", kind: "status" },
    ],
  },
];

export const invoices: Invoice[] = [
  {
    id: "i1", number: "INV-10671", orderId: "d2", customerId: "c1", status: "Issued",
    issueDate: "Aug 14, 2026", dueDate: "Sep 13, 2026", terms: "Net 30",
    payments: [
      { id: "pay1", date: "Aug 15, 2026", method: "ACH", ref: "TRN-88213", amount: 500, by: "Dale" },
      { id: "pay1b", date: "Aug 16, 2026", method: "Card / Electronic", ref: "ch_3PqLm2", amount: 250, by: "Dale" },
    ],
    refunds: [
      { id: "ref1", paymentId: "pay1b", date: "Aug 17, 2026", method: "Card / Electronic", ref: "re_3PqLm2", amount: 100, by: "Dale" },
    ],
  },
  { id: "i2", number: "INV-10672", orderId: "d3", customerId: "c5", status: "Draft", terms: "Net 45", payments: [], refunds: [] },
  {
    id: "i3", number: "INV-10673", orderId: "d4", customerId: "c2", status: "Issued",
    issueDate: "Aug 12, 2026", dueDate: "Aug 27, 2026", terms: "Net 15",
    payments: [{ id: "pay2", date: "Aug 14, 2026", method: "Credit Card", ref: "ch_3PqL", amount: 203.52, by: "Renee" }],
    refunds: [],
  },
];

export const routeTemplates = [
  { id: "rt1", name: "Printed Product", steps: [{ name: "Proofing", station: "Art Desk", required: true }, { name: "Prepress", station: "Prepress", required: true }, { name: "Production", station: "Print Floor", required: true }, { name: "Fulfillment", station: "Shipping Bench", required: true }], usedBy: 4 },
  { id: "rt2", name: "Printed + Finishing", steps: [{ name: "Proofing", station: "Art Desk", required: true }, { name: "Prepress", station: "Prepress", required: true }, { name: "Production", station: "Print Floor", required: true }, { name: "Finishing", station: "Finishing Bench", required: true }, { name: "Fulfillment", station: "Shipping Bench", required: true }], usedBy: 3 },
  { id: "rt3", name: "Static / Resale", steps: [{ name: "Fulfillment", station: "Shipping Bench", required: true }], usedBy: 1 },
];

export const permissionSets = [
  { id: "ps1", name: "Production Manager", users: 3, active: true, description: "Runs the floor, no financial edits." },
  { id: "ps2", name: "Sales Rep", users: 4, active: true, description: "Quotes, orders, customers." },
  { id: "ps3", name: "Front Desk", users: 2, active: true, description: "Pickups, payments, phone orders." },
  { id: "ps4", name: "Owner", users: 1, active: true, description: "Everything." },
  { id: "ps5", name: "Seasonal Temp", users: 0, active: false, description: "Read-only production access." },
];

export const permissionGroups: { group: string; items: string[] }[] = [
    { group: "Sales", items: ["View Quotes", "Edit Quotes", "Send Quotes", "View Orders", "Edit Orders", "Convert Quote to Order", "Cancel Orders", "Override Selling Price"] },
    { group: "Customers", items: ["View Customers", "Edit Customers", "Manage Portal Users", "Set Credit Limit"] },
    { group: "Artwork", items: ["View Artwork", "Upload Artwork", "Replace Artwork", "Approve Proof"] },
    { group: "Production", items: ["View Production", "Start Production", "Complete Production", "Skip Route Step", "Reroute Job"] },
    { group: "Inventory", items: ["View Materials", "Adjust Inventory", "Receive Material", "Create Purchase Order"] },
    { group: "Billing", items: ["View Invoices", "Issue Invoice", "Edit Issued Invoice", "Record Payment", "Refund Payment", "Void Invoice"] },
  { group: "Administration", items: ["Manage Users", "Manage Permission Sets", "Manage Settings", "Manage Integrations"] },
];

export const defaultGranted: Record<string, string[]> = {
  ps1: ["View Quotes", "View Orders", "Edit Orders", "View Customers", "View Artwork", "Upload Artwork", "Replace Artwork", "View Production", "Start Production", "Complete Production", "Skip Route Step", "Reroute Job", "View Materials", "Adjust Inventory", "View Invoices"],
  ps2: ["View Quotes", "Edit Quotes", "Send Quotes", "View Orders", "Edit Orders", "Convert Quote to Order", "View Customers", "Edit Customers", "View Artwork", "View Production", "View Invoices"],
  ps3: ["View Orders", "View Customers", "View Artwork", "View Production", "View Invoices", "Record Payment"],
  ps4: permissionGroups.flatMap((g) => g.items),
  ps5: ["View Production", "View Orders"],
};

export const portalPermissionSets = [
  { id: "cp1", name: "Full Portal Customer", items: ["View Products", "See Pricing", "Place Orders", "View Orders", "Upload Artwork", "Respond to Proof", "View Invoices", "Pay Invoice"] },
  { id: "cp2", name: "View Only Customer", items: ["View Products", "View Orders", "View Invoices"] },
];

export const stations = ["Océ Arizona", "Roland", "HP Latex", "Finishing Bench", "Router", "Shipping Bench"];

export const integrations = [
  { name: "QuickBooks Online", category: "Accounting", status: "Connected", detail: "Last sync 12 min ago" },
  { name: "Stripe", category: "Payments", status: "Connected", detail: "Live mode" },
  { name: "Outbound Email", category: "Communications", status: "Connected", detail: "quotes@hensleyprint.com" },
  { name: "UPS", category: "Shipping", status: "Connected", detail: "Account ending 4417" },
  { name: "FedEx", category: "Shipping", status: "Not Connected", detail: "" },
  { name: "Local Bridge", category: "Workstation", status: "Error", detail: "Agent offline since 6:04 AM" },
  { name: "Onyx RIP", category: "Prepress", status: "Connected", detail: "Hot folders: 4" },
  { name: "Illustrator Automation", category: "Prepress", status: "Not Connected", detail: "" },
  { name: "API / MCP", category: "Platform", status: "Connected", detail: "2 keys active" },
];

export const communications = [
  { id: "cm1", type: "Quote", subject: "Quote #10452 from Hensley Print Co.", to: "susan@deltafaucet.com", at: "Aug 17, 4:22 PM", status: "Opened" },
  { id: "cm2", type: "Proof", subject: "Proof ready for Order #10671", to: "susan@deltafaucet.com", at: "Aug 13, 9:12 AM", status: "Approved" },
  { id: "cm3", type: "Invoice", subject: "Invoice INV-10671", to: "ap@deltafaucet.com", at: "Aug 14, 5:00 PM", status: "Delivered" },
  { id: "cm4", type: "Shipping", subject: "Your order has shipped — 1Z999AA10123456784", to: "renee@mcdfg.com", at: "Aug 12, 2:31 PM", status: "Delivered" },
  { id: "cm5", type: "Reminder", subject: "Invoice INV-10650 is past due", to: "ap@metroareaprint.com", at: "Aug 11, 8:00 AM", status: "Bounced" },
];

export const inboundOrders = [
  {
    id: "ib1", source: "Email", from: "susan@deltafaucet.com", received: "Aug 15, 7:42 AM", confidence: 0.94,
    subject: "Re: need 75 more store hour signs",
    body: `Hi Dale,\n\nCan we get another 75 of the 24x18 coroplast store-hour signs, same art as last time? PO 84930. We need them by next Friday if possible.\n\nAlso add 12 of the reflective pole signs 18x24 with two grommets.\n\nThanks,\nSusan Johnson\nDelta Faucet Company`,
    parsed: { customer: "Delta Faucet Company", contact: "Susan Johnson", po: "84930", due: "Aug 21, 2026" },
    lines: [
      { product: "4mm Coroplast Sign", size: '24" × 18"', qty: 75, confidence: 0.97, missing: [] as string[] },
      { product: "Reflective Pole Sign", size: '18" × 24"', qty: 12, confidence: 0.72, missing: ["Reflective grade"] },
    ],
  },
  {
    id: "ib2", source: "PDF Purchase Order", from: "purchasing@mcdfg.com", received: "Aug 14, 4:10 PM", confidence: 0.68,
    subject: "PO MCD-2304.pdf",
    body: `PURCHASE ORDER MCD-2304\nMcDonald's Franchise Group\n\nLine 1: Window cling set, 12x12, qty 240\nLine 2: Drive thru panel, aluminum, 48x24, qty 12\n\nShip to: 12 locations (see attached list)\nRequired: 08/28/2026`,
    parsed: { customer: "McDonald's Franchise Group", contact: "Renee Alvarez", po: "MCD-2304", due: "Aug 28, 2026" },
    lines: [
      { product: "Translucent Vinyl Print", size: '12" × 12"', qty: 240, confidence: 0.81, missing: [] as string[] },
      { product: "ACM Sign Panel", size: '48" × 24"', qty: 12, confidence: 0.63, missing: ["Mounting method", "Split shipping list"] },
    ],
  },
  {
    id: "ib3", source: "Storefront", from: "bill@acelaf.com", received: "Aug 14, 11:20 AM", confidence: 0.99,
    subject: "Storefront order — 2 banners",
    body: `Submitted through the Ace Hardware storefront.\n\n13oz Banner 4ft x 10ft — qty 2 — "Fall Sale"\nArtwork uploaded: fall-sale-2026.pdf`,
    parsed: { customer: "Ace Hardware — Lafayette", contact: "Bill Kramer", po: "ACE-5590", due: "Aug 24, 2026" },
    lines: [{ product: "13oz Vinyl Banner", size: "4ft × 10ft", qty: 2, confidence: 0.99, missing: [] as string[] }],
  },
];

export const artworkFiles = [
  { id: "a1", name: "delta-storehours-original.pdf", kind: "Customer Artwork", order: "10671", size: "12.4 MB", status: "Approved", child: "delta-storehours-print.pdf" },
  { id: "a2", name: "delta-storehours-print.pdf", kind: "Production Artwork", order: "10671", size: "48.9 MB", status: "Production Ready", child: "proof-10671-v2.pdf" },
  { id: "a3", name: "proof-10671-v2.pdf", kind: "Proof", order: "10671", size: "2.1 MB", status: "Approved", child: "" },
  { id: "a4", name: "mcd-cling-set.ai", kind: "Customer Artwork", order: "10672", size: "31.0 MB", status: "Proof Pending", child: "mcd-cling-print.pdf" },
  { id: "a5", name: "mcd-cling-print.pdf", kind: "Production Artwork", order: "10672", size: "62.3 MB", status: "Proof Pending", child: "proof-10672-v1.pdf" },
  { id: "a6", name: "logo-vector-master.eps", kind: "Customer Artwork", order: "—", size: "4.8 MB", status: "Approved", child: "" },
];

export const vendors = [
  { id: "v1", name: "Grimco", terms: "Net 30", openPOs: 2, spend: 42100 },
  { id: "v2", name: "Fellers", terms: "Net 30", openPOs: 1, spend: 28400 },
  { id: "v3", name: "3M Direct", terms: "Prepay", openPOs: 0, spend: 9800 },
  { id: "v4", name: "STS Inks", terms: "Net 15", openPOs: 1, spend: 5100 },
];

export const purchaseOrders = [
  { id: "po1", number: "PO-2291", vendor: "Grimco", status: "Partially Received", expected: "Aug 18, 2026", total: 2140.5, received: 0.6 },
  { id: "po2", number: "PO-2292", vendor: "Fellers", status: "Ordered", expected: "Aug 20, 2026", total: 1476, received: 0 },
  { id: "po3", number: "PO-2288", vendor: "STS Inks", status: "Received", expected: "Aug 11, 2026", total: 534, received: 1 },
  { id: "po4", number: "PO-2293", vendor: "Grimco", status: "Draft", expected: "Aug 25, 2026", total: 890.4, received: 0 },
];

export const shipments = [
  { id: "s1", tracking: "1Z999AA10123456784", order: "10672", carrier: "UPS", service: "Ground", to: "McDonald's — Carmel", status: "In Transit", cost: 42.18, weight: "38 lb" },
  { id: "s2", tracking: "1Z999AA10123456785", order: "10669", carrier: "UPS", service: "2nd Day Air", to: "Metro Area Printing", status: "Delivered", cost: 88.4, weight: "12 lb" },
  { id: "s3", tracking: "—", order: "10673", carrier: "—", service: "Customer Pickup", to: "Ace Hardware — Lafayette", status: "Awaiting Pickup", cost: 0, weight: "—" },
];

export const bugReports = [
  { id: "b1", title: "Line item price flickers when changing qty quickly", page: "/sales/10452", severity: "Low", category: "UI", status: "Open", by: "Angela", at: "Aug 14" },
  { id: "b2", title: "Prepress thumbnail missing for multi-page PDFs", page: "/prepress", severity: "Medium", category: "Artwork", status: "In Review", by: "Marco", at: "Aug 12" },
  { id: "b3", title: "Local Bridge disconnects overnight", page: "/integrations", severity: "High", category: "Integration", status: "Open", by: "Dale", at: "Aug 15" },
];

export const salesByWeek = [
  { label: "Jul 6", sales: 28400, quotes: 41200 },
  { label: "Jul 13", sales: 31200, quotes: 38900 },
  { label: "Jul 20", sales: 26800, quotes: 44100 },
  { label: "Jul 27", sales: 35600, quotes: 39800 },
  { label: "Aug 3", sales: 39100, quotes: 47500 },
  { label: "Aug 10", sales: 42300, quotes: 51200 },
];

export const stationLoad = [
  { station: "Océ Arizona", jobs: 14, hours: 22 },
  { station: "Roland", jobs: 9, hours: 11 },
  { station: "HP Latex", jobs: 6, hours: 8 },
  { station: "Finishing", jobs: 12, hours: 14 },
  { station: "Router", jobs: 3, hours: 5 },
];

export const arAging = [
  { bucket: "Current", amount: 18420 },
  { bucket: "1–30", amount: 9240 },
  { bucket: "31–60", amount: 3110 },
  { bucket: "61–90", amount: 1220 },
  { bucket: "90+", amount: 640 },
];

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const lineTotal = (l: LineItem) => l.qty * l.sellUnit;
export const docTotal = (d: SalesDoc) => d.lines.reduce((s, l) => s + lineTotal(l), 0);
export const docTax = (d: SalesDoc) => docTotal(d) * 0.07;
export const docGrand = (d: SalesDoc) => docTotal(d) + docTax(d);
export const invoicePaid = (i: Invoice) => i.payments.reduce((s, p) => s + p.amount, 0);

export const invoiceRefunded = (i: Invoice) => i.refunds.reduce((s, r) => s + r.amount, 0);
export const invoiceNetPaid = (i: Invoice) => invoicePaid(i) - invoiceRefunded(i);
export const paymentRefunded = (i: Invoice, paymentId: string) =>
  i.refunds.filter((r) => r.paymentId === paymentId).reduce((s, r) => s + r.amount, 0);
export const invoiceSettlement = (i: Invoice, total: number): Settlement => {
  const net = invoiceNetPaid(i);
  if (net <= 0.005) return "Unpaid";
  return net >= total - 0.005 ? "Paid" : "Partially Paid";
};
