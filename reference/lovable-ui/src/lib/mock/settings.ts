/* Sample presentation data for the Settings visual reference.
   Not canonical application data — no persistence, no backend contracts. */

export type Readiness = "ready" | "attention" | "not-configured" | "reconnect" | "error" | "optional";

export const READINESS_LABEL: Record<Readiness, string> = {
  ready: "Ready",
  attention: "Needs attention",
  "not-configured": "Not configured",
  reconnect: "Reconnect required",
  error: "Error",
  optional: "Optional",
};

export const businessProfile = {
  displayName: "Hensley Print Co.",
  legalName: "Hensley Graphics LLC",
  phone: "765-555-8800",
  email: "hello@hensleyprint.com",
  website: "hensleyprint.com",
  address1: "1400 Sagamore Pkwy",
  address2: "Suite 120",
  city: "Lafayette",
  region: "Indiana",
  postal: "47904",
  country: "United States",
  pickupSameAsBusiness: true,
  timezone: "America/Indiana/Indianapolis",
  locale: "English (United States)",
  currency: "USD — US Dollar",
  updatedBy: "Dale Hensley",
  updatedAt: "Aug 12, 2026",
};

export const numbering = [
  { id: "quote", label: "Quotes", prefix: "Q-", next: 10461, example: "Q-10461", protected: false, updated: "Jan 4, 2026 · Dale Hensley" },
  { id: "order", label: "Orders / Jobs", prefix: "", next: 10674, example: "10674", protected: true, updated: "Jan 4, 2026 · Dale Hensley" },
  { id: "invoice", label: "Invoices", prefix: "INV-", next: 5218, example: "INV-5218", protected: true, updated: "Mar 22, 2026 · Dale Hensley" },
];

export type StaffState = "Active" | "Invitation pending" | "Disabled";

export const staff: { id: string; name: string; email: string; set: string; state: StaffState; lastActive: string }[] = [
  { id: "u1", name: "Dale Hensley", email: "dale@hensleyprint.com", set: "Administrator", state: "Active", lastActive: "Today, 9:42 AM" },
  { id: "u2", name: "Marcy Alvarez", email: "marcy@hensleyprint.com", set: "Sales", state: "Active", lastActive: "Today, 8:15 AM" },
  { id: "u3", name: "Ty Robbins", email: "ty@hensleyprint.com", set: "Production", state: "Active", lastActive: "Yesterday, 5:58 PM" },
  { id: "u4", name: "Jen Whitaker", email: "jen@hensleyprint.com", set: "Billing", state: "Invitation pending", lastActive: "Invited Aug 24" },
  { id: "u5", name: "Cody Blake", email: "cody@hensleyprint.com", set: "Production", state: "Disabled", lastActive: "May 2, 2026" },
];

export const settingsPermissionSets = [
  { id: "sps1", name: "Administrator", users: 1, system: true, summary: "Full access, including Settings and permissions.", floor: true },
  { id: "sps2", name: "Sales", users: 2, system: true, summary: "Quotes, orders, customers and contacts. No settings." },
  { id: "sps3", name: "Production", users: 2, system: true, summary: "Production, prepress and fulfillment work. Read-only pricing." },
  { id: "sps4", name: "Billing", users: 1, system: true, summary: "Invoices, payments and refunds. Read-only production." },
  { id: "sps5", name: "Front Desk (Custom)", users: 0, system: false, summary: "Pickups, payments and phone orders." },
];

export const capabilityGroups: { group: string; items: string[] }[] = [
  { group: "Sales", items: ["View quotes", "Edit quotes", "Send quotes", "Convert quote to order", "Override selling price"] },
  { group: "Customers", items: ["View customers", "Edit customers", "Manage portal access"] },
  { group: "Products & Pricing", items: ["View products", "Edit products", "Manage formulas"] },
  { group: "Production", items: ["View production", "Start and complete work", "Reroute jobs"] },
  { group: "Fulfillment", items: ["View fulfillment", "Ship and pick up", "Void shipments"] },
  { group: "Billing", items: ["View invoices", "Issue invoices", "Record payments", "Refund payments"] },
  { group: "Settings", items: ["View settings", "Manage organization settings", "Manage team & access", "Manage integrations"] },
];

export const portalAccess = [
  { id: "pa1", customer: "Delta Signs & Graphics", contact: "Renee Colton", email: "renee@deltasigns.com", access: "Full portal", state: "Active", invited: "Feb 2, 2026" },
  { id: "pa2", customer: "Wabash Valley Schools", contact: "Mark Feld", email: "mfeld@wvschools.org", access: "View only", state: "Active", invited: "Apr 18, 2026" },
  { id: "pa3", customer: "Northend Brewing", contact: "Sam Ortiz", email: "sam@northendbrew.com", access: "Full portal", state: "Invitation pending", invited: "Aug 21, 2026" },
  { id: "pa4", customer: "Lafayette Parks Dept.", contact: "Dana Reyes", email: "dreyes@lafayetteparks.gov", access: "View only", state: "Disabled", invited: "Nov 9, 2025" },
];

export const homeJurisdiction = {
  name: "Indiana Sales Tax",
  country: "United States",
  region: "Indiana",
  postal: "47904",
  rate: "7.00",
  activeForPickup: true,
};

export const destinationJurisdictions: {
  id: string; name: string; region: string; coverage: string; rate: string; appliesTo: string; status: Readiness;
}[] = [];

export const emailDelivery = {
  provider: "Google / Gmail",
  status: "ready" as Readiness,
  sender: "dale@hensleyprint.com",
  lastValidated: "Today, 6:10 AM",
  history: [
    { at: "Today, 6:10 AM", what: "Sending account validated" },
    { at: "Aug 19, 2026", what: "Connected by Dale Hensley" },
  ],
};

export const invoiceDefaults = {
  terms: "Net 30",
  dueBehavior: "Due on terms from issue date",
  instructions: "Please reference the invoice number with your payment. Checks payable to Hensley Graphics LLC.",
  updated: "Jun 3, 2026 · Dale Hensley",
};

export const documentBranding = {
  logo: "HG",
  footer: "Hensley Graphics LLC · 1400 Sagamore Pkwy, Lafayette, IN 47904 · 765-555-8800",
  payment: "Payment due per terms. ACH and card payments accepted through the customer portal.",
  remitTo: "Hensley Graphics LLC, PO Box 812, Lafayette, IN 47902",
};

export const connections: {
  category: "Accounting" | "Payments" | "Shipping" | "Production";
  name: string;
  status: Readiness;
  detail: string;
  available: boolean;
}[] = [
  { category: "Accounting", name: "QuickBooks Online", status: "not-configured", detail: "Not connected.", available: false },
  { category: "Accounting", name: "Xero", status: "optional", detail: "Planned. Not available yet.", available: false },
  { category: "Payments", name: "Card & ACH processing", status: "not-configured", detail: "No payment provider is connected.", available: false },
  { category: "Shipping", name: "UPS", status: "optional", detail: "Carrier integration is not available yet.", available: false },
  { category: "Shipping", name: "FedEx", status: "optional", detail: "Carrier integration is not available yet.", available: false },
  { category: "Production", name: "Local device bridge", status: "error", detail: "Bridge has been offline since 6:04 AM.", available: true },
  { category: "Production", name: "Onyx RIP hot folders", status: "ready", detail: "4 hot folders in use.", available: true },
];

export const productRoutingReadiness = {
  activeProducts: 46,
  routable: 34,
  needsRouting: 12,
};

export const notificationGroups: { group: string; items: { label: string; hint: string }[] }[] = [
  { group: "Workflow alerts", items: [
    { label: "Proof approved or revision requested", hint: "When a customer responds to a proof you sent." },
    { label: "Job blocked in production", hint: "When work you own cannot continue." },
  ] },
  { group: "Assignments", items: [
    { label: "Work assigned to me", hint: "Design, prepress and production assignments." },
    { label: "Mentions in notes", hint: "When someone mentions you on an order." },
  ] },
  { group: "Due dates", items: [
    { label: "Due today", hint: "Morning summary of work due today." },
    { label: "Late work", hint: "When work you own passes its due date." },
  ] },
];
