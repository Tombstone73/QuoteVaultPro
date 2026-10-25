import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ExistingProductEditService } from "../services/assistant/existingProductEditService";
import { canonicalBlankCoroplastOperations } from "../services/products/canonicalBlankCoroplastOperations";

afterEach(() => jest.restoreAllMocks());

describe("existing Product warning review", () => {
  test("a model proposal cannot acknowledge warnings; the GO execution path supplies acknowledgement", async () => {
    const pricing = { unit: "per_square_foot" as const, minimumChargeCents: 0,
      optionRates: { selectionKey: "thickness", choices: [{ value: "4mm", rateCents: 75 }, { value: "10mm", rateCents: 125 }] } };
    const service = new ExistingProductEditService();
    const proposal = { productId: "product_1", productName: "Coroplast", productActive: true, sourceLifecycle: "ACTIVE",
      blankCoroplastPricing: pricing, changes: [{ field: "Product warning PBV2_W_WEIGHT_MISSING", before: "requires review in GO", after: "Weight is missing" }], fingerprint: "a".repeat(64) };
    jest.spyOn(service, "revalidateProposal").mockResolvedValue({ valid: true, proposal } as never);
    const save = jest.spyOn(canonicalBlankCoroplastOperations, "execute").mockResolvedValue({ resultingActiveTreeVersionId: "tree_new" } as never);
    await service.execute({ organizationId: "org_1", productId: "product_1", userId: "user_1", expectedFingerprint: proposal.fingerprint,
      operations: { operations: [{ op: "configure_product_option_rates", context: "unprinted_substrate", pricing }] } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ pricing, confirmWarnings: true, expectedFingerprint: proposal.fingerprint }));
  });
});
