import { V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson } from "../shared/commercialValues.js";

/** Shipping-owned return identity. This is never the delivery destination. */
export type ShippingSender = Readonly<{ company?: string; recipient?: string; addressLine1: string; addressLine2?: string; city: string; region: string; postalCode: string; country: string; phone?: string; email?: string }>;
export type ShipmentSenderIntent = Readonly<{ orderId: string; blindShipping?: boolean; source?: "customer" | "custom"; customSender?: ShippingSender }>;
export type OrderingCustomerSender = Readonly<{ orderId: string; customerId: string|null; defaultBlindShipping: boolean; billingSender: unknown }>;
export type ShipmentSenderSnapshot = Readonly<{ version: 1; blindShipping: boolean; source: "customer" | "custom" | "organization"; sender?: ShippingSender; intents: readonly ShipmentSenderIntent[] }>;

export function shippingSender(value: unknown): ShippingSender {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "Blind shipping requires a complete sender identity and billing/return address.");
  const row = value as Record<string, unknown>, result: Record<string, string> = {};
  const required = ["addressLine1", "city", "region", "postalCode", "country"];
  const fields = [...required, "company", "recipient", "addressLine2", "phone", "email"];
  if (Object.keys(row).some(key => !fields.includes(key))) throw new V2ApplicationError("VALIDATION_ERROR", "Sender fields are not supported.");
  for (const key of fields) {
    const item = row[key];
    if (item === undefined || item === null || item === "") { if (required.includes(key)) throw new V2ApplicationError("VALIDATION_ERROR", `Blind sender ${key} is required.`); continue; }
    if (typeof item !== "string" || !item.trim() || item.length > 500 || /[\u0000-\u001f]/.test(item)) throw new V2ApplicationError("VALIDATION_ERROR", "Sender fields must be bounded printable text.");
    result[key] = item.trim();
  }
  if(!result.company&&!result.recipient)throw new V2ApplicationError("VALIDATION_ERROR","Blind sender identity is required.");
  return result as ShippingSender;
}

/** Resolve a whole Customer billing address or a whole Custom address, never fieldwise fallback. */
export function resolveShipmentSender(rows: readonly OrderingCustomerSender[], intents: readonly ShipmentSenderIntent[] = []): ShipmentSenderSnapshot {
  if (!rows.length || new Set(rows.map(row => row.orderId)).size !== rows.length || new Set(rows.map(row => row.customerId)).size !== 1) throw new V2ApplicationError("CONFLICT", "Linked Orders require one ordering Customer.");
  if (new Set(intents.map(intent => intent.orderId)).size !== intents.length || intents.some(intent => !rows.some(row => row.orderId === intent.orderId))) throw new V2ApplicationError("VALIDATION_ERROR", "Sender intent must identify each linked Order at most once.");
  const resolved = rows.map(row => {
    const intent = intents.find(item => item.orderId === row.orderId) ?? { orderId: row.orderId };
    if (Object.keys(intent).some(key => !["orderId", "blindShipping", "source", "customSender"].includes(key))) throw new V2ApplicationError("VALIDATION_ERROR", "Sender intent fields are not supported.");
    if (intent.blindShipping !== undefined && typeof intent.blindShipping !== "boolean" || intent.source !== undefined && intent.source !== "customer" && intent.source !== "custom") throw new V2ApplicationError("VALIDATION_ERROR", "Blind intent and sender source are invalid.");
    const blindShipping = intent.blindShipping ?? row.defaultBlindShipping;
    let historicCustom=false;
    if(blindShipping&&intent.source===undefined&&intent.customSender){try{shippingSender(intent.customSender);historicCustom=true;}catch{ /* No explicit source: legacy incomplete hints do not override Customer billing. */ }}
    const source = blindShipping ? intent.source ?? (historicCustom ? "custom" : "customer") : "organization";
    const sender = blindShipping ? shippingSender(source === "custom" ? intent.customSender : row.billingSender) : undefined;
    // Public frozen evidence contains canonical intent, not unused fields from
    // the initiating actor's admitted command body.
    const savedIntent:ShipmentSenderIntent={orderId:row.orderId,...(intent.blindShipping===undefined?{}:{blindShipping:intent.blindShipping}),...(intent.source===undefined?{}:{source:intent.source}),...(source==="custom"?{customSender:sender!}:{})};
    return { blindShipping, source, ...(sender ? { sender } : {}), intent: savedIntent };
  });
  const first = resolved[0]!;
  if (resolved.some(item => item.blindShipping !== first.blindShipping || item.source !== first.source || canonicalJson(item.sender ?? null) !== canonicalJson(first.sender ?? null))) throw new V2ApplicationError("CONFLICT", "Combined Orders have incompatible blind intent, sender source or return identity. Use matching sender details or separate shipments.");
  return { version: 1, blindShipping: first.blindShipping, source: first.source as ShipmentSenderSnapshot["source"], ...(first.sender ? { sender: first.sender } : {}), intents: resolved.map(item => item.intent) };
}

export function requireShipmentSenderSnapshot(value: unknown): ShipmentSenderSnapshot {
  const snapshot = value as ShipmentSenderSnapshot | null;
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.blindShipping !== "boolean" || !Array.isArray(snapshot.intents) || (snapshot.blindShipping ? !["customer", "custom"].includes(snapshot.source) : snapshot.source !== "organization")) throw new V2ApplicationError("CONFLICT", "Frozen shipment sender evidence is unavailable. Correct the prepared shipment before handoff.");
  if (snapshot.blindShipping) shippingSender(snapshot.sender);
  return snapshot;
}
