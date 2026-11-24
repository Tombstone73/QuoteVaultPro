export function shipmentTitle(
  scope: 'SINGLE_ORDER' | 'MULTI_ORDER',
  reference: string | null,
  orderNumbers: readonly string[],
): string {
  if (scope === 'MULTI_ORDER' || orderNumbers.length > 1) return 'Combined shipment';
  const prefix = orderNumbers[0] ? `SH-${orderNumbers[0]}-` : '';
  if (!prefix || !reference?.startsWith(prefix)) return 'Shipment';
  // ShipmentRepo embeds the sequence for the primary Order in this reference.
  // Historical references that don't match the linked Order stay unnumbered.
  const sequence = reference.slice(prefix.length);
  const ordinal = Number(sequence);
  return /^\d{2,}$/.test(sequence) && Number.isSafeInteger(ordinal) && ordinal > 0
    ? `Shipment ${ordinal}` : 'Shipment';
}

export function boxTitle(ordinal: number, boxes: readonly { ordinal: number }[]): string {
  // Deleted boxes can leave gaps in the saved ordinals.
  const contiguous = boxes.every((box, index) => box.ordinal === index + 1);
  return contiguous ? `Box ${ordinal} of ${boxes.length}` : `Box ${ordinal}`;
}
