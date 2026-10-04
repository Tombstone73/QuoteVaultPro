import { createHash } from "crypto";
import { z } from "zod";
import { insertMaterialSchema } from "@shared/schema";
import { materialMutationService } from "../materialMutation.service";
import { materialFamilyAssignmentService } from "../materialFamilyAssignment.service";
import { materialFamilyCreationService } from "../materialFamilyCreation.service";
import { normalizeAssistantMaterialUnitInput } from "./materialActionNormalization";

const id = z.string().trim().min(1).max(128);
const value = z.object({ dimensionId: id, value: z.string().trim().min(1).max(255) }).strict();
const keyedValue = z.object({ dimensionKey: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/), value: z.string().trim().min(1).max(255) }).strict();
const dimension = z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/), displayName: z.string().trim().min(1).max(100) }).strict();

/** The action DTO intentionally accepts only a complete canonical Material
 * payload. Conversational collection happens before proposal creation. */
export const assistantMaterialActionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("materials.create"), material: z.record(z.unknown()) }).strict(),
  z.object({ action: z.literal("materials.create_family"), family: z.object({ name: z.string().trim().min(1).max(255), description: z.string().trim().max(4000).nullable().optional(), dimensions: z.array(dimension).max(8).default([]) }).strict(), variants: z.array(z.object({ material: z.record(z.unknown()), values: z.array(keyedValue).max(8).default([]) }).strict()).max(25).default([]) }).strict(),
  z.object({ action: z.literal("materials.create_variant"), familyId: id, material: z.record(z.unknown()), values: z.array(value).max(8) }).strict(),
  z.object({ action: z.literal("materials.assign_family"), materialId: id, familyId: id, values: z.array(value).max(8) }).strict(),
]);
export type AssistantMaterialActionInput = z.infer<typeof assistantMaterialActionInputSchema>;

export class AssistantMaterialActionError extends Error {
  constructor(readonly code: "MATERIAL_EXISTS" | "FAMILY_EXISTS" | "FAMILY_NOT_FOUND" | "FAMILY_INACTIVE" | "VARIANT_EXISTS" | "MATERIAL_ACTION_INVALID", message: string, readonly statusCode = 409) { super(message); }
}

/**
 * AI-facing adapter around the canonical Material domain services. It has no
 * database handle and never calls an HTTP route.  It is deliberately usable
 * only after a protected execution plan has been confirmed.
 */
export class AssistantMaterialActionService {
  async lookup(organizationId: string, input: { materialName?: string; familyName?: string }) {
    const [material, family] = await Promise.all([
      input.materialName ? materialMutationService.findByExactName(organizationId, input.materialName) : null,
      input.familyName ? materialFamilyCreationService.findFamilyByExactName(organizationId, input.familyName) : null,
    ]);
    const context = family ? await materialFamilyCreationService.getFamilyContext(organizationId, family.id) : null;
    return {
      material: material ? { id: material.id, name: material.name, materialFamilyId: material.materialFamilyId } : null,
      family: context ? { id: context.family.id, name: context.family.name, isActive: context.family.isActive, dimensions: context.dimensions.map((item) => ({ id: item.id, key: item.key, displayName: item.displayName })), variants: context.variants.map((item) => ({ id: item.id, name: item.name })) } : null,
    };
  }

  normalizeMaterial(input: Record<string, unknown>) {
    return insertMaterialSchema.parse(normalizeAssistantMaterialUnitInput(input));
  }

  async prepare(organizationId: string, raw: unknown): Promise<AssistantMaterialActionInput> {
    const input = assistantMaterialActionInputSchema.parse(raw);
    if (input.action === "materials.create") {
      const material = this.normalizeMaterial(input.material);
      const existing = await materialMutationService.findByExactName(organizationId, material.name);
      if (existing) throw new AssistantMaterialActionError("MATERIAL_EXISTS", `A Material named ${material.name} already exists.`, 409);
      return { ...input, material };
    }
    if (input.action === "materials.create_family") {
      const existing = await materialFamilyCreationService.findFamilyByExactName(organizationId, input.family.name);
      if (existing) throw new AssistantMaterialActionError("FAMILY_EXISTS", `A Material Family named ${input.family.name} already exists.`, 409);
      return { ...input, variants: input.variants.map((variant) => ({ ...variant, material: this.normalizeMaterial(variant.material) })) };
    }
    if (input.action === "materials.create_variant") {
      const context = await materialFamilyCreationService.getFamilyContext(organizationId, input.familyId);
      if (!context) throw new AssistantMaterialActionError("FAMILY_NOT_FOUND", "Material Family not found.", 404);
      if (!context.family.isActive) throw new AssistantMaterialActionError("FAMILY_INACTIVE", "This Material Family is inactive. Reactivate it before adding a variant.", 409);
      const material = this.normalizeMaterial(input.material);
      const candidate = input.values.map((item) => `${item.dimensionId}:${item.value.trim().toLocaleLowerCase()}`).sort().join("|");
      for (const variant of context.variants) {
        const variantValues = await materialFamilyCreationService.getVariantValues(organizationId, variant.id);
        if (variantValues.map((item) => `${item.dimensionId}:${item.value.trim().toLocaleLowerCase()}`).sort().join("|") === candidate) {
          throw new AssistantMaterialActionError("VARIANT_EXISTS", "That Material Family already has a variant with the supplied dimension values.", 409);
        }
      }
      return { ...input, material };
    }
    return input;
  }

  async execute(organizationId: string, raw: unknown) {
    const input = await this.prepare(organizationId, raw);
    if (input.action === "materials.create") {
      const result = await materialMutationService.create({ organizationId, material: input.material });
      if (!result.created) throw new AssistantMaterialActionError("MATERIAL_EXISTS", `A Material named ${result.material.name} already exists.`, 409);
      return { status: "succeeded" as const, summary: `Created Material ${result.material.name}.`, material: result.material };
    }
    if (input.action === "materials.create_variant") {
      const result = await materialFamilyCreationService.createVariant({ organizationId, familyId: input.familyId, material: input.material, values: input.values });
      return { status: "succeeded" as const, summary: `Created Material variant ${result.material.name}.`, material: result.material, variantValues: result.variantValues };
    }
    if (input.action === "materials.assign_family") {
      const result = await materialFamilyAssignmentService.assign({ organizationId, materialId: input.materialId, familyId: input.familyId, values: input.values });
      return { status: "succeeded" as const, summary: `Assigned Material ${result.material.name} to its Material Family.`, material: result.material, variantValues: result.variantValues };
    }
    const family = await materialFamilyCreationService.createFamily({ organizationId, ...input.family });
    const created: Array<{ name: string; id: string }> = [];
    for (const variant of input.variants) {
      try {
        const values = variant.values.map((item) => {
          const dimension = family.dimensions.find((candidate) => candidate.key === item.dimensionKey);
          if (!dimension) throw new AssistantMaterialActionError("MATERIAL_ACTION_INVALID", `Variant dimension ${item.dimensionKey} is not defined for this Material Family.`, 400);
          return { dimensionId: dimension.id, value: item.value };
        });
        const result = await materialFamilyCreationService.createVariant({ organizationId, familyId: family.id, material: variant.material, values });
        created.push({ id: result.material.id, name: result.material.name });
      } catch (error) {
        return { status: "partially_failed" as const, summary: `Created Material Family ${family.name} and ${created.length} variant${created.length === 1 ? "" : "s"}; a later variant failed.`, family, created, failure: error instanceof Error ? error.message : "Variant creation failed." };
      }
    }
    return { status: "succeeded" as const, summary: `Created Material Family ${family.name}${created.length ? ` with ${created.length} concrete variants` : ""}.`, family, created };
  }

  fingerprint(input: AssistantMaterialActionInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }
}

export const assistantMaterialActionService = new AssistantMaterialActionService();
