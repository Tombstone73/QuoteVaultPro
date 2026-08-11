import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("material duplication workflow source contract", () => {
  test("frontend action invokes the duplicate mutation directly and blocks repeats while pending", () => {
    const listPage = read("client/src/pages/materials.tsx");
    const settingsPanel = read("client/src/features/materials/MaterialsSettingsPanel.tsx");
    const hook = read("client/src/hooks/useMaterials.ts");

    expect(hook).toContain("export function useDuplicateMaterial()");
    expect(hook).toContain("fetch(`/api/materials/${id}/duplicate`");
    expect(hook).toContain("queryClient.invalidateQueries({ queryKey: [\"/api/materials\"] })");
    expect(hook).toContain("title: \"Material duplicated\"");
    expect(hook).toContain("title: \"Unable to duplicate material\"");

    for (const source of [listPage, settingsPanel]) {
      expect(source).toContain("useDuplicateMaterial()");
      expect(source).toContain("duplicateMaterialMutation.mutateAsync(material.id)");
      expect(source).toContain("duplicateMaterialInFlightRef.current = true;");
      expect(source).toContain("if (duplicateMaterialInFlightRef.current || duplicateMaterialMutation.isPending) return;");
      expect(source).toContain("disabled={duplicateMaterialInFlight || duplicateMaterialMutation.isPending}");
      expect(source).not.toContain("setDuplicateMaterial(material)");
    }
  });

  test("backend route uses the tenant-scoped duplicate service instead of generic material create", () => {
    const routes = read("server/routes/orders.routes.ts");
    const service = read("server/services/materialDuplicationService.ts");

    expect(routes).toContain("app.post('/api/materials/:id/duplicate'");
    expect(routes).toContain("duplicateMaterial({");
    expect(routes).toContain("materialId: String(req.params.id)");
    expect(routes).toContain("DuplicateMaterialError");
    expect(service).toContain("eq(materials.organizationId, input.organizationId)");
    expect(service).toContain("stockQuantity: 0");
    expect(service).toContain("isActive: true");
    expect(service).toContain("if (linkedProductIds.length > 0)");
  });
});
