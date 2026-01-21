/**
 * Production helpers for deriving display values from job data
 */

export type LaminationDisplay = {
  kind: "gloss" | "matte" | "textured_floor" | "custom" | "none";
  label: string;
  source: "option" | "note" | "unknown";
};

/**
 * Derive lamination/finish display from line item options and notes
 * Priority: structured options → notes text search → "none"
 * 
 * @param input - Object containing lineItem (with selectedOptions) and/or notes
 * @returns LaminationDisplay object with kind, label, and source
 */
export function deriveLaminationDisplay(input: {
  lineItem?: {
    selectedOptions?: Array<{
      optionId: string;
      optionName: string;
      value: string | number | boolean;
      note?: string;
    }>;
  } | null;
  notes?: string;
}): LaminationDisplay {
  const { lineItem, notes } = input;

  // 1. Check structured options first (most reliable)
  if (lineItem?.selectedOptions && Array.isArray(lineItem.selectedOptions)) {
    const laminationOption = lineItem.selectedOptions.find((opt) => {
      const optName = String(opt.optionName || "").toLowerCase();
      return (
        optName.includes("lamination") ||
        optName.includes("laminat") ||
        optName.includes("finish") ||
        optName.includes("coating")
      );
    });

    if (laminationOption) {
      const value = String(laminationOption.value || "").toLowerCase();
      const note = String(laminationOption.note || "").toLowerCase();
      const combined = `${value} ${note}`.toLowerCase();

      if (combined.includes("gloss")) {
        return { kind: "gloss", label: "Gloss", source: "option" };
      }
      if (combined.includes("matte") || combined.includes("mat ")) {
        return { kind: "matte", label: "Matte", source: "option" };
      }
      if (combined.includes("textured") || combined.includes("floor") || combined.includes("anti-slip") || combined.includes("antislip")) {
        return { kind: "textured_floor", label: "Textured Floor (Anti-slip)", source: "option" };
      }
      if (combined.includes("custom") || combined.includes("see note") || combined.includes("special")) {
        return { kind: "custom", label: "Custom (see notes)", source: "option" };
      }

      // Found a lamination option but couldn't parse the value
      return { kind: "custom", label: "Custom (see notes)", source: "option" };
    }
  }

  // 2. Fallback to notes text search (less reliable)
  if (notes && typeof notes === "string") {
    const notesLower = notes.toLowerCase();

    // Check for specific lamination keywords in notes
    if (notesLower.includes("gloss laminat") || notesLower.includes("glossy laminat")) {
      return { kind: "gloss", label: "Gloss", source: "note" };
    }
    if (notesLower.includes("matte laminat") || notesLower.includes("mat laminat")) {
      return { kind: "matte", label: "Matte", source: "note" };
    }
    if (notesLower.includes("textured") || (notesLower.includes("floor") && notesLower.includes("laminat"))) {
      return { kind: "textured_floor", label: "Textured Floor (Anti-slip)", source: "note" };
    }
    if (notesLower.includes("custom laminat") || notesLower.includes("special laminat")) {
      return { kind: "custom", label: "Custom (see notes)", source: "note" };
    }
  }

  // 3. No lamination data found
  return { kind: "none", label: "—", source: "unknown" };
}

/**
 * Format dimensions for display (width × height or run length for rolls)
 */
export function formatDimensions(
  width: string | null | undefined,
  height: string | null | undefined,
  isRoll: boolean = false
): string {
  if (!width && !height) return "—";
  
  if (isRoll && width) {
    // For rolls, width is the roll width, height might be run length
    if (height) {
      return `${width}" wide × ${height}" run`;
    }
    return `${width}" wide`;
  }
  
  // Standard flat goods
  if (width && height) {
    return `${width} × ${height}`;
  }
  
  return width || height || "—";
}

/**
 * Detect if a job is roll-based from station key
 */
export function isRollJob(stationKey: string | null | undefined): boolean {
  if (!stationKey) return false;
  const key = String(stationKey).toLowerCase();
  return key === "roll" || key.includes("roll");
}

/**
 * Detect if a job is flatbed-based from station key
 */
export function isFlatbedJob(stationKey: string | null | undefined): boolean {
  if (!stationKey) return false;
  const key = String(stationKey).toLowerCase();
  return key === "flatbed" || key.includes("flatbed");
}
