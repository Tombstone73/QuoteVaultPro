import { expect, test } from "@jest/globals";
import { boundedProofingRequest } from "./proofingRequest";

test("a hung manual proof operation settles, aborts its request and ignores late completion", async () => {
  let signal: AbortSignal | undefined;
  let release!: (value: string) => void;
  let accepted = false;
  const pending = boundedProofingRequest((current) => { signal = current; return new Promise<string>(resolve => { release = resolve; }); }, 10).then(() => { accepted = true; });
  await expect(pending).rejects.toThrow("Refresh the proof history before retrying");
  expect(signal?.aborted).toBe(true);
  release("late version"); await Promise.resolve(); expect(accepted).toBe(false);
});

test("success and visible failures both settle without replacing the original error", async () => {
  await expect(boundedProofingRequest(async () => "persisted version")).resolves.toBe("persisted version");
  await expect(boundedProofingRequest(async () => { throw new Error("Storage upload unavailable"); })).rejects.toThrow("Storage upload unavailable");
});
