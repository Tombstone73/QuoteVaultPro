import { inboundOrderParsedDraftSchema, type InboundOrderParsedDraft } from '@shared/inboundOrdersApi';

/** Shipping instructions are free text, not a shipping-method identifier. Keep
 * their complete value in notes; never truncate source instructions to fit. */
export function withPoShippingInstructions(order: InboundOrderParsedDraft['order'], instructions: string | null): InboundOrderParsedDraft['order'] {
  if (!instructions?.trim()) return order;
  instructions = instructions.trim();
  const notes = order.notes?.includes(instructions) ? order.notes : [order.notes, `PO shipping instructions: ${instructions}`].filter(Boolean).join('\n\n');
  return { ...order, notes };
}

/** Narrow compatibility for attempts written before final enrichment was
 * validated. No other invalid fields are coerced or invented. */
export function readInboundParsedDraft(value: unknown): InboundOrderParsedDraft | null {
  let candidate = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const draft = value as Record<string, unknown>;
    const order = draft.order as InboundOrderParsedDraft['order'] | undefined;
    if (order && (order.notes == null || typeof order.notes === 'string') && typeof order.requestedShipMethod === 'string' && order.requestedShipMethod.trim().length > 160) {
      candidate = { ...draft, order: withPoShippingInstructions({ ...order, requestedShipMethod: null }, order.requestedShipMethod) };
    }
  }
  const parsed = inboundOrderParsedDraftSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
