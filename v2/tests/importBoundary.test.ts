import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import path from "node:path";

describe("V2 production import boundaries", () => {
  test("accepts the production foundation and rejects neither source nor tests for importing v2-poc", () => {
    const script = path.join(process.cwd(), "v2", "scripts", "check-import-boundaries.mjs");
    expect(() => execFileSync(process.execPath, [script], { cwd: process.cwd(), stdio: "pipe" })).not.toThrow();
  });
});
