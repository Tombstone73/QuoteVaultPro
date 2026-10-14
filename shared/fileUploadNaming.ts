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

function applyFilenamePrefix(filename: string, prefix: string, separator: string, alreadyPrefixed: boolean): string {
  return !prefix || alreadyPrefixed ? filename : `${prefix}${separator}${filename}`;
}

/** A local rename preserves every character of the original filename. */
export function buildLocalPrefixedFilename(originalFilename: string, prefix: string): string {
  return applyFilenamePrefix(originalFilename, prefix, "  ", originalFilename.startsWith(`${prefix}  `));
}

const WINDOWS_INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED_BASENAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export function validateLocalRenamePrefix(prefix: string): string | null {
  if (!prefix) return "Enter a prefix.";
  if (WINDOWS_INVALID_FILENAME_CHARACTERS.test(prefix)) return "The prefix contains a character Windows does not allow in filenames.";
  return null;
}

export function validateWindowsFilename(filename: string): string | null {
  if (!filename || filename === "." || filename === ".." || filename.length > 255) return "Invalid filename length or name.";
  if (WINDOWS_INVALID_FILENAME_CHARACTERS.test(filename) || /[. ]$/.test(filename)) return "The filename is not valid on Windows.";
  if (WINDOWS_RESERVED_BASENAME.test(filename.split(".")[0])) return "The filename is reserved on Windows.";
  return null;
}

export type LocalRenamePlanEntry = {
  originalName: string;
  proposedName: string;
  status: "ready" | "already_prefixed" | "invalid" | "collision";
  reason?: string;
};

/** The server owns the proposal; the local helper only checks and executes it. */
export function buildLocalRenamePlan(prefix: string, filenames: string[]): LocalRenamePlanEntry[] {
  const prefixError = validateLocalRenamePrefix(prefix);
  const entries = filenames.map((originalName): LocalRenamePlanEntry => {
    const proposedName = prefixError ? originalName : buildLocalPrefixedFilename(originalName, prefix);
    const reason = prefixError || validateWindowsFilename(originalName) || validateWindowsFilename(proposedName);
    if (reason) return { originalName, proposedName, status: "invalid", reason };
    return { originalName, proposedName, status: proposedName === originalName ? "already_prefixed" : "ready" };
  });
  const originalNames = new Set(filenames.map((name) => name.toLocaleLowerCase("en-US")));
  const originalCounts = new Map<string, number>();
  filenames.forEach((name) => {
    const key = name.toLocaleLowerCase("en-US");
    originalCounts.set(key, (originalCounts.get(key) ?? 0) + 1);
  });
  const targets = new Map<string, number>();
  entries.forEach((entry) => {
    if (entry.status !== "ready") return;
    const key = entry.proposedName.toLocaleLowerCase("en-US");
    targets.set(key, (targets.get(key) ?? 0) + 1);
  });
  return entries.map((entry) => {
    if ((originalCounts.get(entry.originalName.toLocaleLowerCase("en-US")) ?? 0) > 1) {
      return { ...entry, status: "collision", reason: "Selected files must have distinct names in one plan." };
    }
    if (entry.status !== "ready") return entry;
    const key = entry.proposedName.toLocaleLowerCase("en-US");
    return originalNames.has(key) || (targets.get(key) ?? 0) > 1
      ? { ...entry, status: "collision", reason: "A selected file already uses this destination name." }
      : entry;
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
  labelPlacement?: "suffix" | "after_job_prefix";
}): string {
  const originalFilename = (params.originalFilename || "file").trim() || "file";
  const fullJobNumber = (params.fullJobNumber || "").trim();
  const numericJobNumber = (params.numericJobNumber || "").trim();
  const prefixMode = normalizeFileUploadJobPrefixMode(params.fileUploadJobPrefixMode);
  const prepressLabel = normalizePrepressFileLabel(params.prepressLabel);

  const { base, ext } = splitExtension(originalFilename);
  const labelSuffix = prepressLabel === "none" ? null : labelSuffixByValue[prepressLabel];
  const labelPlacement = params.labelPlacement ?? "suffix";
  const prefix = prefixMode === "numeric_only" ? numericJobNumber : fullJobNumber;

  if (labelSuffix && labelPlacement === "after_job_prefix" && prefixMode !== "none" && prefix) {
    const existingPrefixPattern = new RegExp(`^${escapeRegExp(prefix)}(?:[_\\-\\s]+)?(.+)$`, "i");
    const existingPrefixMatch = originalFilename.match(existingPrefixPattern);
    const descriptiveFilename = existingPrefixMatch?.[1]?.trim() || originalFilename;
    const tagPrefixPattern = new RegExp(`^${escapeRegExp(labelSuffix)}(?:[_\\-\\s]|$)`, "i");
    return tagPrefixPattern.test(descriptiveFilename)
      ? `${prefix}_${descriptiveFilename}`
      : `${prefix}_${labelSuffix}_${descriptiveFilename}`;
  }

  const labeledFilename =
    labelSuffix && labelPlacement === "suffix" && prepressLabel !== "none" && !baseEndsWithLabel(base, prepressLabel)
      ? `${base}_${labelSuffix}${ext}`
      : originalFilename;

  return applyFilenamePrefix(
    labeledFilename,
    prefixMode === "none" ? "" : prefix,
    "_",
    startsWithJobPrefix(labeledFilename, fullJobNumber, numericJobNumber),
  );
}
