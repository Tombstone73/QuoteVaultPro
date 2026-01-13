import { describe, expect, test } from "@jest/globals";

import { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } from "../validator";
import { createPbv2BannerGrommetsPricingTreeJson } from "../starterTree";
import { pbv2ToPricingAddons } from "../pricingAdapter";

describe("pbv2/pricingAdapter (banner grommets proof)", () => {
  test("spacing=24 => total=6 extra=0 addOn=0", () => {
    const tree = createPbv2BannerGrommetsPricingTreeJson();
    const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(res.errors).toHaveLength(0);

    const out = pbv2ToPricingAddons(
      tree,
      { explicitSelections: { grommetsEnabled: true, grommetSpacingIn: 24 } },
      { widthIn: 24, heightIn: 48 }
    );

    expect(out.addOnCents).toBe(0);
  });

  test("spacing=12 => total=10 extra=4 addOn=100", () => {
    const tree = createPbv2BannerGrommetsPricingTreeJson();
    const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(res.errors).toHaveLength(0);

    const out = pbv2ToPricingAddons(
      tree,
      { explicitSelections: { grommetsEnabled: true, grommetSpacingIn: 12 } },
      { widthIn: 24, heightIn: 48 }
    );

    expect(out.addOnCents).toBe(100);
    expect(out.breakdown.length).toBeGreaterThanOrEqual(0);
  });

  test("option off => addOn=0 regardless of spacing", () => {
    const tree = createPbv2BannerGrommetsPricingTreeJson();
    const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(res.errors).toHaveLength(0);

    const out = pbv2ToPricingAddons(
      tree,
      { explicitSelections: { grommetsEnabled: false, grommetSpacingIn: 12 } },
      { widthIn: 24, heightIn: 48 }
    );

    expect(out.addOnCents).toBe(0);
  });
});
