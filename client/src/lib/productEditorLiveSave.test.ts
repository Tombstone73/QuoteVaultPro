import { describe, expect, test } from "@jest/globals";
import { submitLiveProductSave } from "./productEditorLiveSave";

const request = {
  expectedProductUpdatedAt: "2026-10-01T00:00:00.000Z",
  expectedActiveTreeVersionId: "active-1",
  product: { name: "Updated Stickers" },
  treeJson: { schemaVersion: 2, status: "ACTIVE", nodes: {}, edges: [], rootNodeIds: [] },
};

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("live Product Save transport", () => {
  test("sends one complete mutation and returns only the committed Product", async () => {
    const calls: Array<{ url: unknown; body: any }> = [];
    const fetcher = (async (url: unknown, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return response(200, { success: true, data: { product: { id: "product", pbv2ActiveTreeVersionId: "active-2" } } });
    }) as typeof fetch;
    const saved = await submitLiveProductSave("product", request, fetcher, () => { throw new Error("Unexpected confirmation"); });
    expect(saved.pbv2ActiveTreeVersionId).toBe("active-2");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/products/product/save-live-configuration", body: { ...request, confirmWarnings: false } });
  });

  test("confirms warnings then retries the exact same proposed configuration", async () => {
    const bodies: any[] = [];
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1
        ? response(409, { code: "PRODUCT_SAVE_WARNINGS_CONFIRM_REQUIRED", findings: [{ message: "Weight is missing" }] })
        : response(200, { data: { product: { id: "product", pbv2ActiveTreeVersionId: "active-2" } } });
    }) as typeof fetch;
    const confirmations: string[] = [];
    await submitLiveProductSave("product", request, fetcher, (message) => { confirmations.push(message); return true; });
    expect(confirmations[0]).toContain("Weight is missing");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ ...request, confirmWarnings: false });
    expect(bodies[1]).toMatchObject({ ...request, confirmWarnings: true });
  });

  test("canceling a warning leaves the Product unsubmitted", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return response(409, { code: "PRODUCT_SAVE_WARNINGS_CONFIRM_REQUIRED", findings: [] });
    }) as typeof fetch;
    await expect(submitLiveProductSave("product", request, fetcher, () => false)).rejects.toThrow("Save canceled.");
    expect(calls).toBe(1);
  });

  test("returns actionable validation findings without claiming success", async () => {
    const fetcher = (async () => response(400, {
      code: "PRODUCT_SAVE_INVALID", message: "Review PBV2 validation errors",
      findings: [{ path: "tree.meta.pricingV2.base", message: "Base pricing is missing" }],
    })) as typeof fetch;
    await expect(submitLiveProductSave("product", request, fetcher)).rejects.toThrow("Base pricing is missing");
  });

  test("treats a lost response as an unknown outcome instead of inviting a blind retry", async () => {
    const fetcher = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await expect(submitLiveProductSave("product", request, fetcher)).rejects.toThrow("Reload the Product before retrying.");
  });
});
