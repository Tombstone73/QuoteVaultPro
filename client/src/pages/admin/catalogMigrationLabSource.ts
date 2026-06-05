export const SAMPLE_INFOFLO_JSON = JSON.stringify({
  products: [
    {
      productName: "Sample Banner",
      product_type: "modal_configurable",
      form_fields: [
        { field_label: "Size", field_type: "select", options: ["Standard 3x5", "Custom Size"] },
        { field_label: "Finishing", field_type: "checkbox", options: ["Hems", "Grommets"] },
      ],
    },
  ],
}, null, 2);

export type AnalyzerSourceKind = "upload" | "paste" | "sample";

export function resolveCatalogMigrationAnalyzerSource(input: {
  activeSource: AnalyzerSourceKind | null;
  uploadedJsonText: string;
  pastedJsonText: string;
  sampleJsonText: string;
}): { kind: AnalyzerSourceKind | null; text: string; label: string } {
  const candidates: Array<{ kind: AnalyzerSourceKind; text: string; label: string }> = [
    { kind: "upload", text: input.uploadedJsonText, label: "Uploaded file content" },
    { kind: "paste", text: input.pastedJsonText, label: "Pasted JSON content" },
    { kind: "sample", text: input.sampleJsonText, label: "Sample JSON content" },
  ];
  const sources = candidates.filter((source) => source.text.trim().length > 0);

  const active = sources.find((source) => source.kind === input.activeSource);
  return active ?? sources[0] ?? { kind: null, text: "", label: "No source selected" };
}
