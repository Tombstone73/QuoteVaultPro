import assert from "node:assert/strict";
import { createInitialProductDraftTree, PostgresProductVersionTransactionRunner } from "../../infrastructure/products/postgresProductVersionLifecycle";

let tree: unknown = createInitialProductDraftTree("Rigid sign");
let updatedAt = new Date("2026-08-22T12:00:00.000Z");

const client = {
  async query(sql: string, values: readonly unknown[] = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("SELECT id FROM products WHERE")) return { rows: [{ id: "product-a" }] };
    if (sql.includes("SELECT p.id product_id,d.id draft_id")) return { rows: [{
      product_id: "product-a",
      draft_id: "draft-a",
      draft_updated_at: updatedAt,
      draft_tree_json: tree,
      status: "DRAFT",
    }] };
    if (sql.includes("UPDATE pbv2_tree_versions SET tree_json")) {
      tree = JSON.parse(String(values[0]));
      updatedAt = values[1] as Date;
      return { rows: [{ updated_at: updatedAt }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  release() {},
};

const runner = new PostgresProductVersionTransactionRunner({ connect: async () => client } as any);
const input = (expectedDraftUpdatedAt: string, options: readonly any[]) => ({
  organizationId: "org-a",
  productId: "product-a",
  draftVersionId: "draft-a",
  expectedDraftUpdatedAt,
  options,
});

const first = await runner.transaction((tx) => tx.updateDraftOptions!(input(updatedAt.toISOString(), [{
  optionId: "new:flute",
  label: "Flute direction matters?",
  inputType: "select",
  required: false,
  defaultValue: "yes",
  choices: [
    { choiceValue: "yes", label: "Yes" },
    { choiceValue: "no", label: "No" },
  ],
  canRemove: true,
}])));

assert.deepEqual(first.options[0]?.choices.map((choice) => choice.choiceValue), ["yes", "no"]);
assert.equal(first.options[0]?.defaultValue, "yes");

const second = await runner.transaction((tx) => tx.updateDraftOptions!(input(first.draftUpdatedAt, first.options)));
assert.equal(second.options[0]?.optionId, first.options[0]?.optionId);
assert.deepEqual(second.options[0]?.choices.map((choice) => choice.choiceValue), ["yes", "no"]);
assert.equal(second.options[0]?.defaultValue, "yes");

console.log("Product Draft choice-value persistence tests passed.");
