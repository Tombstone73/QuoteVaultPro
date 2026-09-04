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
  selectionKey: "new:flute",
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
assert.equal(first.options[0]?.selectionKey, first.options[0]?.optionId, "a newly created option returns its durable selection identity");
assert.equal((tree as any).nodes[first.options[0]!.optionId].input.valueType, "ENUM");

const second = await runner.transaction((tx) => tx.updateDraftOptions!(input(first.draftUpdatedAt, first.options)));
assert.equal(second.options[0]?.optionId, first.options[0]?.optionId);
assert.equal(second.options[0]?.selectionKey, first.options[0]?.optionId, "the next revision accepts the returned canonical selection identity");
assert.deepEqual(second.options[0]?.choices.map((choice) => choice.choiceValue), ["yes", "no"]);
assert.equal(second.options[0]?.defaultValue, "yes");

const typed = await runner.transaction((tx) => tx.updateDraftOptions!(input(second.draftUpdatedAt, [
  ...second.options,
  { optionId: "new:multi", label: "Multi", inputType: "multiselect", required: false, defaultValue: [], choices: [{ choiceValue: "one", label: "One" }], canRemove: true },
  { optionId: "new:boolean", label: "Boolean", inputType: "boolean", required: false, defaultValue: false, choices: [], canRemove: true },
  { optionId: "new:number", label: "Number", inputType: "number", required: false, defaultValue: 1, choices: [], canRemove: true },
  { optionId: "new:text", label: "Text", inputType: "text", required: false, defaultValue: "", choices: [], canRemove: true },
  { optionId: "new:textarea", label: "Textarea", inputType: "textarea", required: false, defaultValue: "", choices: [], canRemove: true },
])));

const valueTypeByLabel = Object.values((tree as any).nodes).filter((node: any) => node.kind === "question").reduce((result: Record<string, string>, node: any) => ({ ...result, [node.label]: node.input?.valueType }), {});
assert.deepEqual(valueTypeByLabel, {
  "Flute direction matters?": "ENUM",
  Multi: "ENUM",
  Boolean: "BOOLEAN",
  Number: "NUMBER",
  Text: "TEXT",
  Textarea: "TEXT",
});
assert.equal(typed.options.length, 6);

console.log("Product Draft choice-value persistence tests passed.");
