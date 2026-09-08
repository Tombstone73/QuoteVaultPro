import { describe, expect, test } from "@jest/globals";
import { PostgresProofArtifactRead } from "../../infrastructure/proofing/postgresProofArtifactRead";

describe("Proof artifact read", () => {
  test("delivers only a file explicitly bound to the requested immutable Proof Version", async () => {
    const calls: readonly unknown[][] = [];
    const reader = new PostgresProofArtifactRead({
      query: async (_text: string, values: readonly unknown[]) => {
        (calls as unknown[][]).push([...values]);
        return { rows: [{ display_filename: "version-2.pdf", content_type: "application/pdf" }] };
      },
    } as any, { file: async (organizationId, artworkFileId) => organizationId === "org-a" && artworkFileId === "file-a" ? { contentType: "application/pdf", bytes: Buffer.from("%PDF") } : null });

    await expect(reader.file("org-a", "proof-v2", "file-a")).resolves.toMatchObject({ filename: "version-2.pdf", contentType: "application/pdf" });
    expect(calls).toEqual([["org-a", "proof-v2", "file-a"]]);
  });

  test("fails closed before storage access when the version/file binding is absent", async () => {
    let storageReads = 0;
    const reader = new PostgresProofArtifactRead({ query: async () => ({ rows: [] }) } as any, { file: async () => { storageReads += 1; return null; } });
    await expect(reader.file("org-a", "proof-v2", "foreign-file")).rejects.toThrow(/artifact was not found/i);
    expect(storageReads).toBe(0);
  });
});
