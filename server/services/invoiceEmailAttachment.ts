import { PDFDocument } from "pdf-lib";

export const INVOICE_PDF_CONTENT_TYPE = "application/pdf";

export type InvoicePdfEmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: typeof INVOICE_PDF_CONTENT_TYPE;
};

function invalidInvoicePdf(message: string, cause?: unknown): Error {
  const error = Object.assign(new Error(message), {
    code: "INVOICE_PDF_INVALID",
    statusCode: 500,
  });
  if (cause) (error as any).cause = cause;
  return error;
}

/**
 * Validate the exact bytes that will be given to the mail transport. This
 * prevents HTML, JSON, empty responses, or base64 text from being attached as
 * a file named .pdf.
 */
export async function createInvoicePdfEmailAttachment(input: {
  filename: string;
  pdfBytes: Uint8Array | Buffer;
}): Promise<InvoicePdfEmailAttachment> {
  const content = Buffer.from(input.pdfBytes);

  if (content.length === 0 || content.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw invalidInvoicePdf("Invoice PDF generation returned invalid PDF bytes; the invoice email was not sent.");
  }

  try {
    await PDFDocument.load(content, { updateMetadata: false, ignoreEncryption: true });
  } catch (cause) {
    throw invalidInvoicePdf("Invoice PDF could not be parsed; the invoice email was not sent.", cause);
  }

  return {
    filename: input.filename,
    content,
    contentType: INVOICE_PDF_CONTENT_TYPE,
  };
}
