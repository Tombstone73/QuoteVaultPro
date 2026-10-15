export const ORDER_SHIP_TO_FIELDS = [
  "shipToCompany", "shipToName", "shipToEmail", "shipToPhone",
  "shipToAddress1", "shipToAddress2", "shipToCity", "shipToState",
  "shipToPostalCode", "shipToCountry",
] as const;

export type OrderShipToField = typeof ORDER_SHIP_TO_FIELDS[number];
export type OrderShipToValues = Record<OrderShipToField, string | null>;

const clean = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

export function normalizedOrderShipTo(source: Partial<Record<OrderShipToField, unknown>>): OrderShipToValues {
  return Object.fromEntries(ORDER_SHIP_TO_FIELDS.map(field => [field, clean(source[field])])) as OrderShipToValues;
}

export function orderShipToMismatches(
  intended: Partial<Record<OrderShipToField, unknown>>,
  persisted: Partial<Record<OrderShipToField, unknown>>,
): OrderShipToField[] {
  return ORDER_SHIP_TO_FIELDS.filter(field => clean(intended[field]) !== clean(persisted[field]));
}

/** A successful write response is insufficient: compare a fresh Order read. */
export async function saveAndVerifyOrderShipTo<T extends Partial<Record<OrderShipToField, unknown>>>(
  intended: OrderShipToValues,
  save: () => Promise<unknown>,
  read: () => Promise<T>,
): Promise<T> {
  await save();
  const persisted = await read();
  const mismatches = orderShipToMismatches(intended, persisted);
  if (mismatches.length) {
    throw new Error('Shipping details did not match the saved Order (' + mismatches.join(', ') + '). Review and retry.');
  }
  return persisted;
}
