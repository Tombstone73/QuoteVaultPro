import {
  PORTAL_FILE_SUBMISSION_MAX_BYTES,
  parsePortalFileSubmissionPayload,
} from "../services/portal.service";

describe("portal file submission payload", () => {
  test("accepts a conservative PDF submission and sanitizes a path-like filename", () => {
    const result = parsePortalFileSubmissionPayload({
      fileName: "C:\\customer-files\\final-art.PDF",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("portal artwork").toString("base64"),
      note: "Please review this version.",
    });

    expect(result).toMatchObject({
      fileName: "final-art.PDF",
      mimeType: "application/pdf",
      note: "Please review this version.",
    });
    expect(result.buffer.toString()).toBe("portal artwork");
  });

  test("rejects unsupported types, mismatched extensions, and malformed file content", () => {
    const validContent = Buffer.from("file").toString("base64");

    expect(() => parsePortalFileSubmissionPayload({
      fileName: "art.svg",
      mimeType: "image/svg+xml",
      dataBase64: validContent,
    })).toThrow("Use a PDF, JPG, PNG, or TIFF file.");

    expect(() => parsePortalFileSubmissionPayload({
      fileName: "art.pdf",
      mimeType: "image/png",
      dataBase64: validContent,
    })).toThrow("File name and file type do not match.");

    expect(() => parsePortalFileSubmissionPayload({
      fileName: "art.pdf",
      mimeType: "application/pdf",
      dataBase64: "not valid base64!",
    })).toThrow("File content is invalid.");
  });

  test("enforces the server-side size limit", () => {
    expect(() => parsePortalFileSubmissionPayload({
      fileName: "large.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.alloc(PORTAL_FILE_SUBMISSION_MAX_BYTES + 1, 1).toString("base64"),
    })).toThrow("Files must be 1 MB or smaller.");
  });
});
