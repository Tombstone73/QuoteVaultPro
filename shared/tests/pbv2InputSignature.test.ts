import { canonicalizeJson, computePbv2InputSignature } from "@shared/pbv2/pbv2InputSignature";
import { describe, expect, test } from "@jest/globals";

describe("PBV2 input signature", () => {
  test("canonicalizeJson is deterministic and key-order independent", () => {
    const a = {
      treeVersionId: "tv_1",
      explicitSelections: { b: 2, a: 1 },
      env: { heightIn: 10, widthIn: 20, nested: { z: 1, y: 2 } },
    };

    const b = {
      env: { widthIn: 20, nested: { y: 2, z: 1 }, heightIn: 10 },
      explicitSelections: { a: 1, b: 2 },
      treeVersionId: "tv_1",
    };

    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  test("computePbv2InputSignature is stable across object key order", async () => {
    const sig1 = await computePbv2InputSignature({
      treeVersionId: "tv_1",
      explicitSelections: { b: 2, a: 1 },
      env: { widthIn: 20, heightIn: 10, qty: 5 },
    });

    const sig2 = await computePbv2InputSignature({
      treeVersionId: "tv_1",
      explicitSelections: { a: 1, b: 2 },
      env: { qty: 5, heightIn: 10, widthIn: 20 },
    });

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });
});
