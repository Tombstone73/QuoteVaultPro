import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("material family integrity contracts", () => {
  const schema = read("shared/schema.ts");
  const routes = read("server/routes/orders.routes.ts");

  test("keeps concrete Materials as the optional Family children", () => {
    const familyDeclaration = schema.slice(schema.indexOf('export const materialFamilies'), schema.indexOf('// Materials table'));
    expect(schema).toContain('materialFamilyId: varchar("material_family_id").references(() => materialFamilies.id, { onDelete: "set null" })');
    expect(schema).toContain('materialId: varchar("material_id").notNull().references(() => materials.id');
    expect(familyDeclaration).not.toContain('stockQuantity');
  });

  test("preserves Material rows when an assignment is removed", () => {
    expect(routes).toContain('materialFamilyId: null');
    expect(routes).toContain('tx.delete(materialVariantValues)');
    expect(routes).not.toContain('tx.delete(materials).where(and(eq(materials.id, req.params.id)');
  });

  test("enforces organization scope, dimension ownership, and inactive-family rejection", () => {
    expect(routes).toContain('eq(materialFamilies.organizationId, organizationId)');
    expect(routes).toContain('eq(materialFamilyVariantDimensions.materialFamilyId, family.id)');
    expect(routes).toContain('Cannot assign a Material to an inactive Material Family');
  });

  test("does not add Family identifiers to production or PBV2 Material references", () => {
    expect(schema).toContain('materialId: varchar("material_id").notNull().references(() => materials.id');
    expect(schema).not.toContain('materialFamilyId: varchar("material_family_id").notNull()');
  });
});
