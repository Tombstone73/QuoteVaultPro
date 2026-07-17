export const GENERATED_PROOF_DESCRIPTION_MARKER = "[proof-artifact:generated-basic]";

export type PrepressFileDisplayCategory =
  | "original_customer"
  | "proof"
  | "final_production"
  | "reference";

export type PrepressFileClassification = {
  category: PrepressFileDisplayCategory;
  systemGenerated: boolean;
  tagLabel: string;
};

const normalize = (value: unknown): string => String(value ?? "").trim().toLowerCase();

const looksLikeLegacyGeneratedProof = (fileName: string): boolean => (
  /(?:^|[-_])proof[-_]\d{4}[-_]\d{2}[-_]\d{2}t\d{2}[-_]\d{2}[-_]\d{2}/i.test(fileName)
  && /\.pdf$/i.test(fileName)
);

/**
 * Classifies files for Prepress display. Persisted role/description metadata is
 * authoritative; the filename check exists only for older generated proofs
 * that predate consistent role metadata.
 */
export function classifyPrepressFileForDisplay(input: {
  source: "line_item_file" | "order_attachment";
  role?: string | null;
  description?: string | null;
  originalFilename?: string | null;
  fileName?: string | null;
}): PrepressFileClassification {
  const role = normalize(input.role);
  const description = normalize(input.description);
  const fileName = String(input.originalFilename ?? input.fileName ?? "").trim();
  const generatedProof = description.includes(GENERATED_PROOF_DESCRIPTION_MARKER)
    || (input.source === "order_attachment" && (!role || role === "other") && looksLikeLegacyGeneratedProof(fileName));

  if (role === "proof" || generatedProof) {
    return {
      category: "proof",
      systemGenerated: generatedProof,
      tagLabel: generatedProof ? "System Proof" : "Proof",
    };
  }

  if (input.source === "line_item_file") {
    if (role === "final") return { category: "final_production", systemGenerated: false, tagLabel: "Final" };
    if (role === "reference") return { category: "reference", systemGenerated: false, tagLabel: "Reference" };
    return { category: "original_customer", systemGenerated: false, tagLabel: "Original" };
  }

  if (["reference", "customer_po", "setup", "output"].includes(role)) {
    return {
      category: "reference",
      systemGenerated: false,
      tagLabel: role === "customer_po" ? "Customer PO" : role === "output" ? "Output" : role === "setup" ? "Setup" : "Reference",
    };
  }

  // Older order attachments may not have role metadata. Preserve their
  // visibility as originals rather than dropping or guessing beyond filename.
  return { category: "original_customer", systemGenerated: false, tagLabel: role === "artwork" ? "Artwork" : "Order" };
}
