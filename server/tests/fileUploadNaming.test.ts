import { buildFileUploadDisplayFilename } from "@shared/fileUploadNaming";

describe("buildFileUploadDisplayFilename", () => {
  const base = {
    fullJobNumber: "ORD-12345",
    numericJobNumber: "12345",
  };

  test("adds numeric-only job prefix and print label", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "artwork.pdf",
        fileUploadJobPrefixMode: "numeric_only",
        prepressLabel: "print",
      }),
    ).toBe("12345_artwork_PRINT.pdf");
  });

  test("adds full job number prefix and proof label", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "artwork.pdf",
        fileUploadJobPrefixMode: "full_job_number",
        prepressLabel: "proof",
      }),
    ).toBe("ORD-12345_artwork_PROOF.pdf");
  });

  test("allows no prefix and no label", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "artwork.pdf",
        fileUploadJobPrefixMode: "none",
        prepressLabel: "none",
      }),
    ).toBe("artwork.pdf");
  });

  test("does not double-prefix numeric or full job numbers", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "12345_artwork.pdf",
        fileUploadJobPrefixMode: "numeric_only",
        prepressLabel: "none",
      }),
    ).toBe("12345_artwork.pdf");

    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "ORD-12345 artwork.pdf",
        fileUploadJobPrefixMode: "numeric_only",
        prepressLabel: "none",
      }),
    ).toBe("ORD-12345 artwork.pdf");
  });

  test("treats underscore, dash, space, and end as valid prefix boundaries", () => {
    for (const originalFilename of ["12345_art.pdf", "12345-art.pdf", "12345 art.pdf", "12345"]) {
      expect(
        buildFileUploadDisplayFilename({
          ...base,
          originalFilename,
          fileUploadJobPrefixMode: "full_job_number",
          prepressLabel: "none",
        }),
      ).toBe(originalFilename);
    }
  });

  test("does not duplicate an existing label suffix before the extension", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "artwork_PRINT.pdf",
        fileUploadJobPrefixMode: "numeric_only",
        prepressLabel: "print",
      }),
    ).toBe("12345_artwork_PRINT.pdf");
  });

  test("recognizes cut file suffix variants before the extension", () => {
    for (const originalFilename of ["artwork_CUT_FILE.pdf", "artwork Cut File.pdf", "artwork-CutFile.pdf"]) {
      expect(
        buildFileUploadDisplayFilename({
          ...base,
          originalFilename,
          fileUploadJobPrefixMode: "numeric_only",
          prepressLabel: "cut_file",
        }),
      ).toBe(`12345_${originalFilename}`);
    }
  });

  test("preserves the original extension", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "nested.name.tif",
        fileUploadJobPrefixMode: "numeric_only",
        prepressLabel: "cut_file",
      }),
    ).toBe("12345_nested.name_CUT_FILE.tif");
  });

  test("can place the production tag immediately after the job number", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "customer-art.pdf",
        fileUploadJobPrefixMode: "full_job_number",
        prepressLabel: "print",
        labelPlacement: "after_job_prefix",
      }),
    ).toBe("ORD-12345_PRINT_customer-art.pdf");
  });

  test("inserts the production tag after an existing job prefix", () => {
    expect(
      buildFileUploadDisplayFilename({
        ...base,
        originalFilename: "ORD-12345_customer-art.pdf",
        fileUploadJobPrefixMode: "full_job_number",
        prepressLabel: "print",
        labelPlacement: "after_job_prefix",
      }),
    ).toBe("ORD-12345_PRINT_customer-art.pdf");
  });
});
