import { isFinalProductionFile, sortFinalProductionFiles } from "../productionFileHydration";

describe("production final-file hydration", () => {
  test("includes active final production output and excludes proofs and customer originals", () => {
    const candidates = [
      { id: "print", role: "final", status: "active", tag: "final_print", createdAt: "2026-07-17T12:00:00Z" },
      { id: "proof", role: "final", status: "active", tag: "proof_only", createdAt: "2026-07-17T13:00:00Z" },
      { id: "original", role: "original", status: "active", tag: null, createdAt: "2026-07-17T14:00:00Z" },
      { id: "superseded", role: "final", status: "superseded", tag: "final_print", createdAt: "2026-07-17T15:00:00Z" },
    ];

    expect(sortFinalProductionFiles(candidates).map((file) => file.id)).toEqual(["print"]);
    expect(isFinalProductionFile(candidates[1])).toBe(false);
    expect(isFinalProductionFile(candidates[2])).toBe(false);
  });

  test("prefers the newest final print file over cut and untagged output", () => {
    const files = [
      { id: "cut", role: "final", status: "active", tag: "cut_file", createdAt: "2026-07-17T15:00:00Z" },
      { id: "other", role: "final", status: "active", tag: null, createdAt: "2026-07-17T14:00:00Z" },
      { id: "print-old", role: "final", status: "active", tag: "final_print", createdAt: "2026-07-17T12:00:00Z" },
      { id: "print-new", role: "final", status: "active", tag: "final_print", createdAt: "2026-07-17T13:00:00Z" },
    ];

    expect(sortFinalProductionFiles(files).map((file) => file.id)).toEqual([
      "print-new",
      "print-old",
      "other",
      "cut",
    ]);
  });
});
