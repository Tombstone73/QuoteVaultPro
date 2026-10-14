import type { Product } from "@shared/schema";

export type LiveProductSaveRequest = {
  expectedProductUpdatedAt: string;
  expectedActiveTreeVersionId: string;
  product: Record<string, unknown>;
  treeJson: unknown;
};

/** A warning response validates without committing. Confirmation retries the
 * same immutable request; the successful response is the only mutation. */
export async function submitLiveProductSave(
  productId: string,
  request: LiveProductSaveRequest,
  fetcher: typeof fetch = fetch,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
): Promise<Product> {
  for (const confirmWarnings of [false, true]) {
    let response: Response;
    try {
      response = await fetcher(`/api/products/${encodeURIComponent(productId)}/save-live-configuration`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, confirmWarnings }),
      });
    } catch {
      throw new Error("The Save outcome could not be confirmed. Reload the Product before retrying.");
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body.code === "PRODUCT_SAVE_WARNINGS_CONFIRM_REQUIRED" && !confirmWarnings) {
      const details = Array.isArray(body.findings)
        ? body.findings.map((finding: { message?: string }) => finding.message).filter(Boolean).join("\n")
        : "";
      if (!confirm(`Review PBV2 publish warnings before saving:\n\n${details}\n\nSave and publish this configuration?`)) {
        throw new Error("Save canceled. Your edits remain in the editor.");
      }
      continue;
    }
    if (!response.ok) {
      const details = Array.isArray(body.findings)
        ? body.findings.slice(0, 3).map((finding: { message?: string; path?: string }) =>
            finding.message || finding.path
          ).filter(Boolean).join("; ")
        : "";
      throw new Error(`${body.message || `Product Save failed (${response.status}). No changes were committed.`}${details ? ` ${details}` : ""}`);
    }
    if (!body?.data?.product?.id) throw new Error("Product Save returned no Product. Reload before editing again.");
    return body.data.product as Product;
  }
  throw new Error("Product Save needs review before it can be published.");
}
