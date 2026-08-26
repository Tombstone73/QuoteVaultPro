import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("orders list proof sorting", () => {
  test("keeps Proof Status sorting in the paginated server-side sort path", () => {
    const source = readFileSync(path.join(process.cwd(), "server/storage/orders.repo.ts"), "utf8");

    expect(source).toContain("case 'proof':");
    expect(source).toContain("proofSortRank");
    expect(source).toContain("from ${orderLineItems} as proof_sort_lines");
    expect(source).toContain("deriveOrderProofSummary");
  });
});
