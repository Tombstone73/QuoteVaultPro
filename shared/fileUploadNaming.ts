export const fileUploadJobPrefixModes = ["none", "numeric_only", "full_job_number"] as const;
export type FileUploadJobPrefixMode = (typeof fileUploadJobPrefixModes)[number];

export const prepressFileLabelModes = ["optional", "required"] as const;
export type PrepressFileLabelMode = (typeof prepressFileLabelModes)[number];

export const prepressFileLabels = ["none", "print", "proof", "cut_file"] as const;
export type PrepressFileLabel = (typeof prepressFileLabels)[number];

export type FileUploadNamingPolicy = {
  fileUploadJobPrefixMode: FileUploadJobPrefixMode;
  prepressFileLabelMode: PrepressFileLabelMode;
};

export const DEFAULT_FILE_UPLOAD_NAMING_POLICY: FileUploadNamingPolicy = {
  fileUploadJobPrefixMode: "full_job_number",
  prepressFileLabelMode: "required",
};

const labelSuffixByValue: Record<Exclude<PrepressFileLabel, "none">, string> = {
  print: "PRINT",
  proof: "PROOF",
  cut_file: "CUT_FILE",
};

const labelDetectionPatterns: Record<Exclude<PrepressFileLabel, "none">, RegExp> = {
  print: /(?:^|[_\-\s])PRINT$/i,
  proof: /(?:^|[_\-\s])PROOF$/i,
  cut_file: /(?:^|[_\-\s])CUT(?:[_\-\s]?FILE)$/i,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeFileUploadJobPrefixMode(value: unknown): FileUploadJobPrefixMode {
  return fileUploadJobPrefixModes.includes(value as FileUploadJobPrefixMode)
    ? (value as FileUploadJobPrefixMode)
    : DEFAULT_FILE_UPLOAD_NAMING_POLICY.fileUploadJobPrefixMode;
}

export function normalizePrepressFileLabelMode(value: unknown): PrepressFileLabelMode {
  return prepressFileLabelModes.includes(value as PrepressFileLabelMode)
    ? (value as PrepressFileLabelMode)
    : DEFAULT_FILE_UPLOAD_NAMING_POLICY.prepressFileLabelMode;
}

export function normalizePrepressFileLabel(value: unknown): PrepressFileLabel {
  if (prepressFileLabels.includes(value as PrepressFileLabel)) {
    return value as PrepressFileLabel;
  }

  if (value === "final_print" || value === "print_file") return "print";
  if (value === "proof_only") return "proof";
  if (value === "cut" || value === "cutfile") return "cut_file";
  return "none";
}

export function numericJobNumberFromFull(jobNumber: string | null | undefined): string {
  const match = String(jobNumber || "").match(/\d+/g);
  return match ? match.join("") : "";
}

function splitExtension(filename: string): { base: string; ext: string } {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return { base: filename, ext: "" };
  }
  return {
    base: filename.slice(0, lastDot),
    ext: filename.slice(lastDot),
  };
}

function startsWithJobPrefix(filename: string, fullJobNumber: string, numericJobNumber: string): boolean {
  const candidates = [fullJobNumber, numericJobNumber]
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

  return candidates.some((candidate) => {
    const pattern = new RegExp(`^${escapeRegExp(candidate)}(?:[_\\-\\s]|$)`, "i");
    return pattern.test(filename);
  });
}

function baseEndsWithLabel(base: string, label: Exclude<PrepressFileLabel, "none">): boolean {
  return labelDetectionPatterns[label].test(base);
}

export function buildFileUploadDisplayFilename(params: {
  originalFilename: string;
  fullJobNumber: string;
  numericJobNumber: string;
  fileUploadJobPrefixMode: FileUploadJobPrefixMode;
  prepressLabel: PrepressFileLabel;
}): string {
  const originalFilename = (params.originalFilename || "file").trim() || "file";
  const fullJobNumber = (params.fullJobNumber || "").trim();
  const numericJobNumber = (params.numericJobNumber || "").trim();
  const prefixMode = normalizeFileUploadJobPrefixMode(params.fileUploadJobPrefixMode);
  const prepressLabel = normalizePrepressFileLabel(params.prepressLabel);

  const { base, ext } = splitExtension(originalFilename);
  const labelSuffix = prepressLabel === "none" ? null : labelSuffixByValue[prepressLabel];
  const labeledFilename =
    labelSuffix && prepressLabel !== "none" && !baseEndsWithLabel(base, prepressLabel)
      ? `${base}_${labelSuffix}${ext}`
      : originalFilename;

  if (prefixMode === "none" || startsWithJobPrefix(labeledFilename, fullJobNumber, numericJobNumber)) {
    return labeledFilename;
  }

  const prefix = prefixMode === "numeric_only" ? numericJobNumber : fullJobNumber;
  return prefix ? `${prefix}_${labeledFilename}` : labeledFilename;
}
