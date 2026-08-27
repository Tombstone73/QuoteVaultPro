import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type TenantBranding = Readonly<{ name: string; address?: string; phone?: string; email?: string; website?: string }>;
export type OwnerDocumentSection = Readonly<{ heading: string; entries: readonly Readonly<{ label?: string; value: string }>[] }>;
export type OwnerPdfDocument = Readonly<{
  kind: "traveler" | "packing-slip" | "pickup-receipt" | "invoice";
  title: string;
  number: string;
  issuedAt: string;
  organization: TenantBranding;
  sections: readonly OwnerDocumentSection[];
}>;

const forbidden = /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b(?:opt|choice)_[\w-]+\b|\b\w*_import\w*\b|\b(?:product(?:version)?|orderline|productionwork|fulfillment(?:handoff)?|artwork(?:file|assignment)?|route(?:instance)?|storage(?:key|path))id\b|https?:\/\/\S+\/v2\/|(?:^|[\\/])(?:var|tmp|home|users|appdata)(?:[\\/]|$))/iu;
const clean = (value: string) => value.replace(/[\u0000-\u001f]/g, " ").trim();
const visible = (document: OwnerPdfDocument) => [
  document.title, document.number, document.issuedAt,
  document.organization.name, document.organization.address, document.organization.phone,
  document.organization.email, document.organization.website,
  ...document.sections.flatMap((section) => [section.heading, ...section.entries.flatMap((entry) => [entry.label, entry.value])]),
].filter((value): value is string => typeof value === "string");

/** A final presentation boundary: owner projections may never leak persistence or storage identities. */
export const assertOwnerDocumentSafe = (document: OwnerPdfDocument): OwnerPdfDocument => {
  if (visible(document).some((value) => forbidden.test(value)))
    throw new Error("Owner document contains an internal identifier.");
  return document;
};

export const ownerDocumentFilename = (document: OwnerPdfDocument) =>
  `${document.kind.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()).replace(/^[a-z]/, (letter) => letter.toUpperCase())}_${clean(document.number).replace(/[^a-z0-9._-]+/gi, "-") || "document"}.pdf`;

/** Shared PDF typography/layout only. Each owner supplies its own typed facts and sections. */
export const renderOwnerPdf = async (input: OwnerPdfDocument): Promise<Uint8Array> => {
  const document = assertOwnerDocumentSafe(input);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 748;
  const write = (value: string, options: Readonly<{ bold?: boolean; size?: number; indent?: number; color?: [number, number, number] }> = {}) => {
    const size = options.size ?? 9;
    const lines = clean(value).match(/.{1,84}(?:\s|$)|\S+?(?:\s|$)/g) ?? [clean(value)];
    for (const line of lines) {
      if (y < 54) { page = pdf.addPage([612, 792]); y = 748; }
      page.drawText(line.trim(), { x: 42 + (options.indent ?? 0), y, size, font: options.bold ? bold : regular, color: rgb(...(options.color ?? [0.1, 0.12, 0.16])) });
      y -= size + 4;
    }
  };
  write(document.organization.name || "Organization", { bold: true, size: 18 });
  for (const value of [document.organization.address, document.organization.phone, document.organization.email, document.organization.website]) if (value) write(value, { size: 8, color: [0.32, 0.35, 0.4] });
  y -= 10;
  write(document.title, { bold: true, size: 14 });
  write(`Date: ${document.issuedAt}`, { size: 9 });
  write(`Reference: ${document.number}`, { size: 9 });
  for (const section of document.sections) {
    y -= 7;
    write(section.heading, { bold: true, size: 11 });
    for (const entry of section.entries) write(entry.label ? `${entry.label}: ${entry.value}` : entry.value, { size: 9, indent: entry.label ? 0 : 8 });
  }
  return pdf.save();
};
