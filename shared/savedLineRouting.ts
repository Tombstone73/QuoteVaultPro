export type SavedLineRequirements = {
  design: boolean;
  prepress: boolean;
  proof: boolean;
};

export function hasSavedLineProductChange(previousProductId: string, submittedProductId?: string): boolean {
  return submittedProductId !== undefined && submittedProductId !== previousProductId;
}

export function hasSavedLineRoutingChange(input: {
  previousProductId: string;
  submittedProductId?: string;
  previous: SavedLineRequirements;
  submitted: Partial<SavedLineRequirements>;
}): boolean {
  return hasSavedLineProductChange(input.previousProductId, input.submittedProductId)
    || (typeof input.submitted.design === "boolean" && input.submitted.design !== input.previous.design)
    || (typeof input.submitted.prepress === "boolean" && input.submitted.prepress !== input.previous.prepress)
    || (typeof input.submitted.proof === "boolean" && input.submitted.proof !== input.previous.proof);
}

/** A requirement is a durable plan; moving an already-owned job is a separate, reasoned action. */
export function savedLineRequirementConflict(input: {
  previous: SavedLineRequirements;
  next: SavedLineRequirements;
  activeStation: string | null;
}): string | null {
  const station = String(input.activeStation || "").toLowerCase();
  if (!station) return null;
  const { previous, next } = input;
  if (station === "design") {
    return previous.design && !next.design
      ? "Design owns this line. Complete or return the Design work before removing its requirement."
      : null;
  }
  if (station === "prepress") {
    if (!previous.design && next.design) return "Prepress owns this line. Use Return to Design with a reason to reopen Design work.";
    if ((previous.prepress || previous.proof) && !next.prepress && !next.proof) {
      return "Prepress owns this line. Finish or resolve its active work before removing its last Prepress/Proofing requirement.";
    }
    return null;
  }
  if (["roll", "wide_roll", "flatbed"].includes(station)) {
    if (!previous.design && next.design) return "Production owns this line. Use Return for Correction → Design with a reason.";
    if (!previous.prepress && next.prepress) return "Production owns this line. Use Return for Correction → Prepress with a reason.";
    return null;
  }
  return "This line has active work at another station. Resolve that owner before changing routing requirements.";
}
