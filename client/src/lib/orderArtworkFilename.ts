import { buildFileUploadDisplayFilename, numericJobNumberFromFull } from "@shared/fileUploadNaming";

/** Download label only. The canonical file identity and storage key never change. */
export function orderArtworkFilename(filename: string, orderNumber?: string | number | null): string {
  const fullJobNumber = String(orderNumber ?? "").trim();
  return buildFileUploadDisplayFilename({
    originalFilename: filename || "artwork",
    fullJobNumber,
    numericJobNumber: numericJobNumberFromFull(fullJobNumber),
    fileUploadJobPrefixMode: "full_job_number",
    prepressLabel: "none",
  });
}
