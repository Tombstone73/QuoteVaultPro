/**
 * PrintersHero Customer Portal — presentation models.
 * These are UI-facing types only. The real application owns the source of
 * truth; every value here arrives already computed from the server.
 */

export type OrderStatus =
  | "Received"
  | "In Design"
  | "Awaiting Your Approval"
  | "In Production"
  | "Partially Shipped"
  | "Ready for Pickup"
  | "Shipped"
  | "Completed"
  | "Cancelled";

export type ProofStatus = "Awaiting Your Approval" | "Approved" | "Revision Requested" | "Superseded";
export type QuoteStatus = "Open" | "Accepted" | "Expired" | "Converted";
export type InvoiceStatus = "Open" | "Overdue" | "Paid";
export type FulfillmentStatus = "Not Started" | "Partially Fulfilled" | "Fulfilled" | "Pickup Ready" | "Shipped";

export interface OptionChoice {
  id: string;
  label: string;
  hint?: string;
}

export type FieldKind = "dimensions" | "quantity" | "select" | "toggle" | "note";

/** Product-driven configuration field definition (delivered by the server). */
export interface ConfigField {
  id: string;
  kind: FieldKind;
  label: string;
  help?: string;
  required?: boolean;
  choices?: OptionChoice[];
  defaultValue?: string;
  unit?: string;
}

export interface PortalProduct {
  id: string;
  name: string;
  category: string;
  blurb: string;
  imageHue: number;
  startingAt?: string;
  negotiated?: boolean;
  artworkRequired: boolean;
  maxArtworkFiles: number;
  fields: ConfigField[];
}

export interface ArtworkFile {
  id: string;
  name: string;
  sizeLabel: string;
  status: "uploading" | "uploaded" | "failed";
  progress: number;
  hue: number;
}

export interface CartLine {
  id: string;
  productId: string;
  productName: string;
  config: { label: string; value: string }[];
  qty: number;
  unitPrice: number;
  lineTotal: number;
  artwork: ArtworkFile[];
  artworkLater: boolean;
  notes?: string;
}

export interface OrderLine {
  id: string;
  product: string;
  description: string;
  qty: number;
  size?: string;
  options: string[];
  unitPrice: number;
  total: number;
  artwork: { name: string; status: "Received" | "Awaiting artwork" | "Proof approved" }[];
  proofStatus?: ProofStatus;
}

export interface Shipment {
  id: string;
  carrier: string;
  service: string;
  tracking: string;
  shippedOn: string;
  contents: string;
  status: "In Transit" | "Delivered" | "Label Created";
}

export interface PortalOrder {
  id: string;
  number: string;
  po: string;
  placedOn: string;
  dueOn?: string;
  status: OrderStatus;
  fulfillment: FulfillmentStatus;
  total: number;
  balance: number;
  contact: string;
  shipTo: string;
  method: "Ship" | "Pickup";
  lines: OrderLine[];
  shipments: Shipment[];
  invoiceIds: string[];
  documents: { name: string; kind: "PDF"; date: string }[];
  notes?: string;
}

export interface PortalProof {
  id: string;
  orderNumber: string;
  orderId: string;
  jobName: string;
  version: number;
  sentOn: string;
  status: ProofStatus;
  hue: number;
  size: string;
  history: { version: number; date: string; event: string; note?: string }[];
}

export interface PortalQuote {
  id: string;
  number: string;
  date: string;
  expiresOn: string;
  status: QuoteStatus;
  total: number;
  po?: string;
  lines: OrderLine[];
  convertedOrderId?: string;
  documents: { name: string; kind: "PDF"; date: string }[];
}

export interface PortalInvoice {
  id: string;
  number: string;
  orderNumber: string;
  orderId: string;
  po: string;
  date: string;
  dueOn: string;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  allowsPartial: boolean;
}

export interface PortalAccount {
  company: string;
  contactName: string;
  email: string;
  phone: string;
  accountRep: string;
  terms: string;
  addresses: { label: string; lines: string[] }[];
}
