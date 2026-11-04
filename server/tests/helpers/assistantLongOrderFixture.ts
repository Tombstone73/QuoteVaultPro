/** Synthetic business text only. Never contains customer evidence or secrets. */
export function syntheticLongOrder(lineCount = 13): string {
  return [
    "  Enter an Order for Synthetic Motors. Job Label: Multi-artwork installation kit. Artwork will be reviewed before production.",
    ...Array.from({ length: lineCount }, (_, index) => `Line ${index + 1}: artwork \"rider_${String(index + 1).padStart(3, "0")}_front_and_back_final_revision.pdf\"; quantity ${index + 2}; finished size 15.5 × 24 inches; white permanent adhesive vinyl; contour cut; laminate matte; keep artwork orientation; pack each design separately. Do not override the canonical price.`),
    "Blind ship to the supplied destination after staff approval. Preserve the separate customer and ship-to identities. Customer PO total is a reference, not an override.",
    "Ship-to: Synthetic QA Receiving, 123 Example Avenue, Indianapolis, IN 46201. No real shipment should be created in testing. Contact QA Staff. Requested Friday EOD — confirm acceptance separately.",
    "Preserve all artwork filenames, quantities, decimal dimensions, notes, and shipping instructions. Ask targeted questions for missing configuration.  ",
  ].join("\n");
}
