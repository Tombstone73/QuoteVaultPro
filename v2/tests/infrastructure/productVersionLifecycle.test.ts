import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { PostgresProductVersionLifecycleReader, PostgresProductVersionTransactionRunner, createInitialProductDraftTree } from "../../infrastructure/products/postgresProductVersionLifecycle";
import { optionTreeV2Schema } from "../../../shared/optionTreeV2";
import { validateOptionTreeV2 } from "../../../shared/optionTreeV2Runtime";

const version=(id:string,status:"ACTIVE"|"DRAFT"|"DEPRECATED"|"ARCHIVED",updated:string)=>({id,status,schema_version:2,tree_json:{nodes:{}},created_at:new Date("2026-08-01T00:00:00.000Z"),updated_at:new Date(updated),published_at:status==="ACTIVE"?new Date("2026-08-02T00:00:00.000Z"):null});
describe("P2 Product version lifecycle read",()=>{
  test("initializes a structurally valid Draft tree for a new Product identity",()=>{
    const tree=createInitialProductDraftTree("New Product");
    expect(validateOptionTreeV2(tree)).toEqual({ok:true});
    expect(optionTreeV2Schema.safeParse(tree).success).toBe(true);
    expect(tree.rootNodeIds).toEqual(["product_configuration"]);
    expect(tree.nodes.product_configuration).toMatchObject({id:"product_configuration",kind:"group"});
  });
  test("persists a new identity with a single text type for name and description",async()=>{
    const source=await readFile("v2/infrastructure/products/postgresProductVersionLifecycle.ts","utf8");
    const create=source.slice(source.indexOf("async createProductWithInitialDraft"),source.indexOf("async succeed"));
    expect(create).toContain("VALUES($1,$2,$3::text,$3::text,FALSE");
  });
  test("is tenant-scoped, bounded, deterministic, and separates Active, Draft, and history",async()=>{const calls:any[]=[];const reader=new PostgresProductVersionLifecycleReader({query:async<T>(text:string,values?:readonly unknown[])=>{calls.push({text,values});return {rows:(text.startsWith("SELECT pbv2")?[{pbv2_active_tree_version_id:"active-a"}]:[version("draft-a","DRAFT","2026-08-04T00:00:00.000Z"),version("active-a","ACTIVE","2026-08-03T00:00:00.000Z"),version("old-a","DEPRECATED","2026-08-02T00:00:00.000Z")])as T[]};}}as any);await expect(reader.read("org-a","product-a")).resolves.toMatchObject({active:{status:"active",editable:false},draft:{status:"draft",editable:true},history:[{status:"deprecated"}],historyLimit:25,historyHasMore:false,canCreateDraft:false});expect(calls[0].text).toContain("organization_id=$1 AND id=$2");expect(calls[0].values).toEqual(["org-a","product-a"]);expect(calls[1].text).toContain("organization_id=$1 AND product_id=$2");expect(calls[1].text).toContain("ORDER BY updated_at DESC,id DESC LIMIT $3");expect(calls[1].values).toEqual(["org-a","product-a",28]);});
  test("includes the pointed Active version when it is older than the bounded history window",async()=>{const calls:any[]=[];const reader=new PostgresProductVersionLifecycleReader({query:async<T>(_text:string,values?:readonly unknown[])=>{calls.push(values);if(calls.length===1)return {rows:[{pbv2_active_tree_version_id:"active-old"}]as T[]};if(calls.length===2)return {rows:[version("draft-current","DRAFT","2026-08-04T00:00:00.000Z"),version("new-history","DEPRECATED","2026-08-03T00:00:00.000Z")]as T[]};return {rows:[version("active-old","ACTIVE","2026-07-01T00:00:00.000Z")]as T[]};}}as any);await expect(reader.read("org-a","product-a")).resolves.toMatchObject({active:{productVersionId:"active-old",status:"active"},draft:{productVersionId:"draft-current",status:"draft"},canCreateDraft:false});expect(calls[2]).toEqual(["org-a","product-a","active-old"]);});
  test("returns a truthful empty lifecycle for a Product with no PBV2 configuration",async()=>{const reader=new PostgresProductVersionLifecycleReader({query:async<T>(text:string)=>({rows:(text.startsWith("SELECT pbv2")?[{pbv2_active_tree_version_id:null}]:[])as T[]})}as any);await expect(reader.read("org-a","product-a")).resolves.toEqual({history:[],historyLimit:25,historyHasMore:false,canCreateDraft:false});});
  test("serializes draft creation on the Product row and never updates the Active pointer", async () => {
    const active = { ...version("active-a", "ACTIVE", "2026-08-03T00:00:00.000Z"), tree_json: createInitialProductDraftTree("Product") };
    const draft = version("draft-a", "DRAFT", "2026-08-04T00:00:00.000Z");
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const client = { query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      if (text.includes("FROM products")) return { rows: [{ pbv2_active_tree_version_id: active.id }] };
      if (text.includes("status='ACTIVE'")) return { rows: [active] };
      if (text.includes("status='DRAFT' ORDER BY")) return { rows: [] };
      if (text.startsWith("INSERT INTO pbv2_tree_versions")) return { rows: [draft] };
      if (text.includes("FROM v2_product_recipes")) return { rows: [{ id: "active-recipe" }] };
      if (text.startsWith("INSERT INTO v2_product_recipes")) return { rows: [{ id: "draft-recipe" }] };
      if (text.includes("FROM pbv2_tree_versions")) return { rows: [draft, active] };
      return { rows: [] };
    }, release: () => undefined };
    const runner = new PostgresProductVersionTransactionRunner({ connect: async () => client } as any);
    await expect(runner.transaction(tx => tx.createDraftFromActive({ organizationId: "org-a", productId: "product-a", expectedActiveVersionUpdatedAt: active.updated_at.toISOString() }))).resolves.toMatchObject({ draftId: draft.id, lifecycle: { active: { productVersionId: active.id }, draft: { productVersionId: draft.id } } });
    expect(calls[1]).toEqual({ text: "SELECT pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE", values: ["org-a", "product-a"] });
    expect(calls[2].text).toContain("status='ACTIVE' FOR UPDATE");
    expect(calls[2].values).toEqual(["org-a", "product-a", active.id]);
    expect(calls[3].text).toContain("status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE");
    expect(calls[3].values).toEqual(["org-a", "product-a"]);
    const insert = calls.find(call => call.text.startsWith("INSERT INTO pbv2_tree_versions"))!;
    expect(insert.text).toContain("'DRAFT'");
    expect(JSON.parse(String(insert.values![3]))).toEqual(active.tree_json);
    const writes = calls.filter(call => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.text));
    expect(writes).toHaveLength(5);
    expect(writes.every(call => /^\s*INSERT\b/i.test(call.text))).toBe(true);
    for (const table of ["v2_product_version_formula_revision_bindings", "v2_product_version_routing_specs"]) {
      expect(writes.find(call => call.text.includes(table))!.values?.slice(0, 4)).toEqual(["org-a", "product-a", active.id, draft.id]);
    }
    expect(calls.at(-1)?.text).toBe("COMMIT");
  });
  test("abandonment is a separate operation that legitimately archives only the current Draft", async () => {
    const active = version("active-a", "ACTIVE", "2026-08-03T00:00:00.000Z");
    const draft = version("draft-a", "DRAFT", "2026-08-04T00:00:00.000Z");
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const client = { query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      if (text.includes("FROM products")) return { rows: [{ pbv2_active_tree_version_id: active.id }] };
      if (text.startsWith("SELECT id FROM pbv2_tree_versions")) return { rows: [{ id: draft.id }] };
      if (text.includes("AND id=$3 FOR UPDATE")) return { rows: [draft] };
      if (text.includes("FROM pbv2_tree_versions")) return { rows: [active, { ...draft, status: "ARCHIVED" }] };
      return { rows: [] };
    }, release: () => undefined };
    const runner = new PostgresProductVersionTransactionRunner({ connect: async () => client } as any);
    await expect(runner.transaction(tx => tx.abandonDraft!({ organizationId: "org-a", productId: "product-a", draftVersionId: draft.id, expectedDraftUpdatedAt: draft.updated_at.toISOString(), staffActorUserId: "staff-a" }))).resolves.toMatchObject({ active: { productVersionId: active.id }, history: [{ productVersionId: draft.id, status: "archived" }] });
    const writes = calls.filter(call => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.text));
    expect(writes).toEqual([{ text: "UPDATE pbv2_tree_versions SET status='ARCHIVED',updated_at=now(),updated_by_user_id=$1 WHERE organization_id=$2 AND product_id=$3 AND id=$4 AND status='DRAFT'", values: ["staff-a", "org-a", "product-a", draft.id] }]);
    expect(calls.at(-1)?.text).toBe("COMMIT");
  });
  test("locks and patches only the current Draft General section",async()=>{const source=await readFile("v2/infrastructure/products/postgresProductVersionLifecycle.ts","utf8");const update=source.slice(source.indexOf("async updateDraftGeneral"),source.indexOf("async auditDraftGeneral"));expect(update).toContain("FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE");expect(update).toContain("AND d.id=$3 FOR UPDATE");expect(update).toContain("row.status !== \"DRAFT\"");expect(update).toContain("UPDATE pbv2_tree_versions SET tree_json");expect(update).not.toMatch(/UPDATE products/);});
});
