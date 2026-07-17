import { describe, expect, test } from "@jest/globals";

import {
  GENERATED_PROOF_DESCRIPTION_MARKER,
  classifyPrepressFileForDisplay,
} from "../prepressFileClassification";

describe("Prepress file classification", () => {
  test("keeps customer artwork in Original Customer Files", () => {
    expect(classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: "artwork",
      originalFilename: "customer-art.pdf",
    })).toEqual({
      category: "original_customer",
      systemGenerated: false,
      tagLabel: "Artwork",
    });
  });

  test("classifies generated proof artifacts as System Proof files", () => {
    expect(classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: "proof",
      description: `${GENERATED_PROOF_DESCRIPTION_MARKER} Generated basic proof`,
      originalFilename: "20000_coroplast-proof-2026-07-15T19-42-34-235Z.pdf",
    })).toEqual({
      category: "proof",
      systemGenerated: true,
      tagLabel: "System Proof",
    });
  });

  test("does not classify PO or reference attachments as proofs", () => {
    expect(classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: "customer_po",
      originalFilename: "PO-123.pdf",
    }).category).toBe("reference");
    expect(classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: "reference",
      originalFilename: "reference.pdf",
    }).category).toBe("reference");
  });

  test("keeps final production files in Final Production Files", () => {
    expect(classifyPrepressFileForDisplay({
      source: "line_item_file",
      role: "final",
      originalFilename: "print-ready.pdf",
    })).toEqual({
      category: "final_production",
      systemGenerated: false,
      tagLabel: "Final",
    });
  });

  test("handles legacy missing metadata safely and recognizes the generated proof filename pattern", () => {
    expect(classifyPrepressFileForDisplay({
      source: "order_attachment",
      originalFilename: "legacy-upload.pdf",
    }).category).toBe("original_customer");

    expect(classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: "other",
      originalFilename: "20000_coroplast-proof-2026-07-15T19-42-34-235Z.pdf",
    })).toMatchObject({
      category: "proof",
      systemGenerated: true,
      tagLabel: "System Proof",
    });
  });
});
