export type ProductionFileCandidate = {
  id: string;
  role?: string | null;
  status?: string | null;
  tag?: string | null;
  createdAt?: Date | string | null;
};

const normalize = (value: unknown): string => String(value ?? "").trim().toLowerCase();

/** Final prepress output only. Proof-tagged files remain proof assets even when
 * an older upload path stored them in the line-item final-file collection. */
export function isFinalProductionFile(file: ProductionFileCandidate): boolean {
  const tag = normalize(file.tag);
  return normalize(file.role) === "final"
    && normalize(file.status) === "active"
    && tag !== "proof"
    && tag !== "proof_only";
}

function productionFilePriority(file: ProductionFileCandidate): number {
  const tag = normalize(file.tag);
  if (tag === "final_print" || tag === "print") return 0;
  if (tag === "cut_file" || tag === "cut") return 2;
  return 1;
}

/** Prefer the final print/imposed sheet, then other final output, then cut files. */
export function sortFinalProductionFiles<T extends ProductionFileCandidate>(files: T[]): T[] {
  return files
    .filter(isFinalProductionFile)
    .slice()
    .sort((left, right) => {
      const priority = productionFilePriority(left) - productionFilePriority(right);
      if (priority !== 0) return priority;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      return rightTime - leftTime;
    });
}
