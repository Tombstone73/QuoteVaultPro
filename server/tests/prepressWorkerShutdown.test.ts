import fs from "fs";
import path from "path";
import { createPrepressPoller } from "../prepress/worker/pollerController";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("standalone prepress worker shutdown", () => {
  test("stops queued task admission and waits for already-active work", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const poller = createPrepressPoller(async (canClaim) => {
      if (!canClaim?.()) return false;
      calls += 1;
      await active;
      return true;
    });

    poller.start({ pollIntervalMs: 60_000, concurrency: 1 });
    await flush();
    expect(calls).toBe(1);

    const stop = poller.stop({ drainTimeoutMs: 100 });
    expect(poller.isPolling()).toBe(false);
    expect(poller.activeJobCount()).toBe(1);
    release?.();

    await expect(stop).resolves.toEqual({ drained: true, activeJobs: 0 });
    expect(calls).toBe(1);
  });

  test("does not admit a scheduled claim after shutdown begins", async () => {
    let calls = 0;
    const poller = createPrepressPoller(async () => {
      calls += 1;
      return true;
    });

    poller.start({ pollIntervalMs: 60_000, concurrency: 2 });
    await expect(poller.stop({ drainTimeoutMs: 100 })).resolves.toEqual({ drained: true, activeJobs: 0 });
    await flush();
    expect(calls).toBe(0);
  });

  test("returns a bounded timeout rather than waiting indefinitely", async () => {
    let release: (() => void) | undefined;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const poller = createPrepressPoller(async () => {
      await active;
      return true;
    });

    poller.start({ pollIntervalMs: 60_000, concurrency: 1 });
    await flush();
    await expect(poller.stop({ drainTimeoutMs: 1 })).resolves.toEqual({ drained: false, activeJobs: 1 });
    release?.();
    await flush();
  });

  test("claim SQL is deterministic and locks one row", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "server/prepress/worker/processor.ts"), "utf8");
    expect(source).toContain("ORDER BY ${prepressJobs.createdAt} ASC, ${prepressJobs.id} ASC");
    expect(source).toContain("FOR UPDATE SKIP LOCKED");
    expect(source).toContain("LIMIT 1");
  });
});
