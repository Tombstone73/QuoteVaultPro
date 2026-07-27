import {
  resolveProductionArtworkSideReadiness,
  type ProductionArtworkAssignment,
  type ProductionSides,
} from "./productionHydration";

export type ProofArtworkPanel<T> = {
  label: "Artwork" | "Front" | "Back";
  source: T | null;
};

/**
 * Resolves customer-proof panels from the same per-file side metadata used by
 * Orders, Prepress, and Production. It never assigns sides by upload order.
 */
export function resolveProofArtworkLayout<T extends ProductionArtworkAssignment>(args: {
  printSides: ProductionSides;
  sources: T[];
  useSameArtworkBothSides: boolean;
  sameArtworkFileId?: string | null;
}) {
  const readiness = resolveProductionArtworkSideReadiness({
    sides: args.printSides,
    artwork: args.sources,
    useSameArtworkBothSides: args.useSameArtworkBothSides,
    sameArtworkFileId: args.sameArtworkFileId ?? null,
  });

  if (args.printSides !== "Double-sided") {
    return {
      complete: args.sources.length > 0,
      warning: args.sources.length > 0 ? null : "Artwork not assigned.",
      sameArtworkBothSides: false,
      // A single-sided product may still have several distinct designs. Keep
      // every selected canonical source so the proof composer can append one
      // proof page per design instead of silently using only the first file.
      panels: args.sources.map((source) => ({ label: "Artwork" as const, source })),
    };
  }

  if (readiness.useSameArtworkBothSides) {
    return {
      complete: readiness.complete,
      warning: readiness.warning,
      sameArtworkBothSides: true,
      panels: [{ label: "Artwork" as const, source: readiness.both ?? readiness.front }],
    };
  }

  return {
    complete: readiness.complete,
    warning: readiness.warning,
    sameArtworkBothSides: false,
    panels: [
      { label: "Front" as const, source: readiness.front },
      { label: "Back" as const, source: readiness.back },
    ],
  };
}
