import { describe, expect, test } from "@jest/globals";
import { redoGroupSelectionError, redoOrderPreviewSchema, redoSourceGroupId, type RedoSourceLine } from "../orderRedo";

const operational: RedoSourceLine[] = [
  { id: "vinyl", description: "Translucent vinyl", quantity: 2, lineItemRole: "standalone" },
  { id: "backer", description: "Polycarbonate backer", quantity: 2, parentLineItemId: "vinyl", lineItemRole: "standalone" },
];
const select = (vinyl: number, backer: number) => [{ sourceLineItemId: "vinyl", quantity: vinyl }, { sourceLineItemId: "backer", quantity: backer }];
const bundle = [{ ...operational[0], lineItemRole: "parent" }, { ...operational[1], lineItemRole: "child" }];

describe("Redo assembly selection contract", () => {
  test("valid linked standalone lines are not misinterpreted as pricing wrappers", () => {
    expect(redoGroupSelectionError(operational, select(1, 0))).toBeNull();
    expect(redoGroupSelectionError(operational, select(1, 2))).toBeNull();
    expect(redoGroupSelectionError(operational, select(0, 1))).toBeNull();
    expect(redoSourceGroupId(operational[1], operational)).toBe("vinyl");
  });
  test("real pricing bundles preserve reproduced proportions and explicitly account for reused components", () => {
    expect(redoGroupSelectionError(bundle, select(1, 1))).toBeNull();
    expect(redoGroupSelectionError(bundle, select(1, 2))).toContain("proportions");
    expect(redoGroupSelectionError(bundle, select(0, 1))).toContain("proportions");
    expect(redoGroupSelectionError(bundle, select(1, 0))).toContain("physical item");
    const three = [...bundle, { id: "second", description: "Second component", quantity: 2, parentLineItemId: "vinyl", lineItemRole: "child" }];
    expect(redoGroupSelectionError(three, [...select(1, 0), { sourceLineItemId: "second", quantity: 1 }])).toBeNull();
  });
  test("incomplete, duplicate, foreign, invalid, orphan and cyclic selections remain rejected", () => {
    expect(redoGroupSelectionError(operational, select(1, 0).slice(0, 1))).toContain("every component");
    expect(redoGroupSelectionError(operational, [...select(1, 0), select(1, 0)[0]])).toContain("only once");
    expect(redoGroupSelectionError(operational, [{ sourceLineItemId: "foreign", quantity: 1 }])).toContain("belong");
    expect(redoGroupSelectionError(operational, select(3, 0))).toContain("0 to 2");
    expect(redoGroupSelectionError(operational, select(-1, 1))).toContain("0 to 2");
    expect(redoGroupSelectionError([{ ...operational[1], parentLineItemId: "missing" }], select(0, 1).slice(1))).toContain("missing");
    expect(redoGroupSelectionError([{ ...operational[1], parentLineItemId: null, lineItemRole: "child" }], select(0, 1).slice(1))).toContain("no assembly link");
    expect(redoGroupSelectionError([{ ...operational[0], parentLineItemId: "backer" }, operational[1]], select(1, 0))).toContain("circular");
  });
  test("independent groups do not share quantities or source identities", () => {
    const others = operational.map(line => ({ ...line, id: `${line.id}-2`, parentLineItemId: line.parentLineItemId ? `${line.parentLineItemId}-2` : null }));
    expect(redoGroupSelectionError([...operational, ...others], [...select(1, 0), ...select(0, 2).map(line => ({ ...line, sourceLineItemId: `${line.sourceLineItemId}-2` }))])).toBeNull();
  });
  test("zero reuse is accepted only alongside physical replacements and never carries a charge", () => {
    const token = "2026-11-03T12:00:00.000Z";
    const body = { requestKey: "10000000-0000-4000-8000-000000000001", expectedUpdatedAt: token,
      lines: select(1, 0).map(line => ({ ...line, expectedUpdatedAt: token })), reason: "Shipping damage", promisedDate: "2026-11-05", disposition: "no_customer_charge" };
    expect(redoOrderPreviewSchema.safeParse(body).success).toBe(true);
    expect(redoOrderPreviewSchema.safeParse({ ...body, lines: body.lines.map(line => ({ ...line, quantity: 0 })) }).success).toBe(false);
    expect(redoOrderPreviewSchema.safeParse({ ...body, disposition: "charge_customer", shipping: { decision: "free", amountCents: 0 },
      lines: body.lines.map(line => ({ ...line, priceOverrideTotalCents: 100 })) }).success).toBe(false);
  });
});
