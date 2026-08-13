import { describe, expect, jest, test } from "@jest/globals";
import { createExistingProductEditExecutionCommand } from "../services/assistant/execution/existingProductEditCommand";

const fingerprint = "a".repeat(64);
const proposal = { productId: "product_1", productName: "Translucent Vinyl", productActive: true, treeId: "tree_1", treeUpdatedAt: "2026-08-10T00:00:00.000Z", changes: [{ field: "Layer default", before: "5 Layer", after: "3 Layer" }], fingerprint };
const input = { productId: "product_1", operations: [{ op: "set_option_default", optionGroup: "Layer", value: "3 Layer" }], proposalFingerprint: fingerprint };
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.products.update_existing_product"], environment: "test" } as const;

describe("existing product edit execution command", () => {
  test("creates a targeted preview, revalidates stale state, and makes no mutation before GO", async () => {
    const service = {
      revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal })),
      execute: jest.fn(async () => proposal),
    } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const built = await command.buildPreview({ scope, arguments: input, context: {} as any });

    expect(service.execute).not.toHaveBeenCalled();
    expect(built.preview.title).toContain("Update existing product");
    expect(built.preview.summary).toContain("Layer default: 5 Layer → 3 Layer");
    expect(built.preview.summary).toContain("before GO");

    const stale = await command.revalidate({ plan: { sanitizedArguments: input } as any, scope });
    expect(stale).toEqual({ valid: true, proposal });

    const result = await command.execute({ plan: { sanitizedArguments: input, id: "plan_1", idempotencyKey: "key", correlationId: "correlation" } as any, scope });
    expect(service.execute).toHaveBeenCalledWith(expect.objectContaining({ productId: "product_1", expectedFingerprint: fingerprint }));
    expect(result.status).toBe("succeeded");
  });

  test("fails closed when the current PBV2 DRAFT no longer matches the preview", async () => {
    const service = { revalidateProposal: jest.fn(async () => ({ valid: false as const, code: "EXISTING_PRODUCT_EDIT_STALE", summary: "Changed" })), execute: jest.fn() } as any;
    const command = createExistingProductEditExecutionCommand(service);
    await expect(command.buildPreview({ scope, arguments: input, context: {} as any })).rejects.toThrow("EXISTING_PRODUCT_EDIT_STALE");
    expect(service.execute).not.toHaveBeenCalled();
  });

  test("keeps a canonical configuration proposal behind the same GO command", async () => {
    const configurationInput = { productId: "product_1", operations: [{ op: "update_product_configuration", changes: { name: "Updated banner", requiresProofApproval: true } }], proposalFingerprint: fingerprint };
    const canonicalProposal = { ...proposal, sourceLifecycle: "PRODUCT", canonicalOperationReference: "products.update_configuration.v1", expectedProductUpdatedAt: "2026-08-10T00:00:00.000Z", changes: [{ field: "name", before: "Translucent Vinyl", after: "Updated banner" }] };
    const service = { revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal: canonicalProposal })), execute: jest.fn(async () => canonicalProposal) } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const result = await command.execute({ plan: { sanitizedArguments: configurationInput, id: "plan_1", idempotencyKey: "key", correlationId: "correlation" } as any, scope });
    expect(service.execute).toHaveBeenCalledWith(expect.objectContaining({ operations: { operations: configurationInput.operations } }));
    expect(result.steps[0]?.summary).toContain("shared canonical Product configuration");
  });

  test("keeps canonical PBV2 option configuration behind GO and reports the final shared operation", async () => {
    const pbv2Input = { productId: "product_1", operations: [{ op: "update_pbv2_option_configuration", mutations: [{ kind: "add_input", group: "Finishing", input: { selectionKey: "placement_note", label: "Placement note", type: "textarea", required: true, visibilityRules: [{ type: "equals", selectionKey: "grommets", value: "custom" }] } }] }], proposalFingerprint: fingerprint };
    const pbv2Proposal = { ...proposal, sourceLifecycle: "DRAFT", canonicalOperationReference: "products.update_option_configuration.v1", changes: [{ field: "Input Placement note", before: "(missing)", after: "textarea created" }] };
    const service = { revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal: pbv2Proposal })), execute: jest.fn(async () => pbv2Proposal) } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const built = await command.buildPreview({ scope, arguments: pbv2Input, context: {} as any });
    expect(service.execute).not.toHaveBeenCalled();
    expect(built.preview.summary).toContain("before GO");
    const result = await command.execute({ plan: { sanitizedArguments: pbv2Input } as any, scope });
    expect(result.steps[0]?.summary).toContain("canonical PBV2 option configuration");
  });

  test("keeps trusted existing-Product material assignment behind the same GO command", async () => {
    const materialInput = { productId: "product_1", operations: [{ op: "update_product_material", materialLabel: "13oz Banner" }], proposalFingerprint: fingerprint };
    const materialProposal = { ...proposal, sourceLifecycle: "PRODUCT", canonicalOperationReference: "products.update_material_configuration.v1", expectedProductUpdatedAt: "2026-08-10T00:00:00.000Z", changes: [{ field: "Primary material", before: "(none)", after: "13oz Banner" }] };
    const service = { revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal: materialProposal })), execute: jest.fn(async () => materialProposal) } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const built = await command.buildPreview({ scope, arguments: materialInput, context: {} as any });
    expect(service.execute).not.toHaveBeenCalled();
    expect(built.preview.summary).toContain("Primary material: (none) → 13oz Banner");
    const result = await command.execute({ plan: { sanitizedArguments: materialInput, id: "plan_1", idempotencyKey: "key", correlationId: "correlation" } as any, scope });
    expect(service.execute).toHaveBeenCalledWith(expect.objectContaining({ operations: { operations: materialInput.operations }, expectedFingerprint: fingerprint }));
    expect(result.steps[0]?.summary).toContain("shared canonical Product material operation");
  });
  test("keeps Product activation behind the same GO command and canonical lifecycle operation", async () => {
    const lifecycleInput = { productId: "product_1", operations: [{ op: "update_product_lifecycle", isActive: true }], proposalFingerprint: fingerprint };
    const lifecycleProposal = { ...proposal, sourceLifecycle: "PRODUCT", canonicalOperationReference: "products.update_lifecycle.v1", expectedProductUpdatedAt: "2026-08-10T00:00:00.000Z", changes: [{ field: "Lifecycle", before: "inactive", after: "active" }] };
    const service = { revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal: lifecycleProposal })), execute: jest.fn(async () => lifecycleProposal) } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const built = await command.buildPreview({ scope, arguments: lifecycleInput, context: {} as any });
    expect(service.execute).not.toHaveBeenCalled(); expect(built.preview.summary).toContain("before GO");
    const result = await command.execute({ plan: { sanitizedArguments: lifecycleInput } as any, scope });
    expect(result.steps[0]?.summary).toContain("canonical Product lifecycle operation");
  });

  test("shows a transparent publish then activate plan and confirmed warnings before GO", async () => {
    const lifecycleInput = { productId: "product_1", operations: [{ op: "update_product_lifecycle", isActive: true, confirmPublishWarnings: true }], proposalFingerprint: fingerprint };
    const publishProposal = { ...proposal, productActive: false, sourceLifecycle: "DRAFT", canonicalOperationReference: "products.publish_configuration.v1", publishProposal: { treeVersionId: "tree_1", expectedProductUpdatedAt: "2026-08-10T00:00:00.000Z", expectedTreeUpdatedAt: "2026-08-10T00:00:00.000Z", activateAfterPublish: true, confirmWarnings: true, warnings: [{ code: "PBV2_W_TEST", message: "Review material weight." }] }, changes: [{ field: "PBV2 configuration", before: "DRAFT", after: "ACTIVE" }, { field: "Lifecycle", before: "inactive", after: "active" }] };
    const service = { revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal: publishProposal })), execute: jest.fn(async () => publishProposal) } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const built = await command.buildPreview({ scope, arguments: lifecycleInput, context: {} as any });
    expect(service.execute).not.toHaveBeenCalled();
    expect(built.preview.summary).toContain("publish PBV2 configuration tree_1 and activate the Product atomically");
    expect(built.preview.summary).toContain("Review material weight");
    const result = await command.execute({ plan: { sanitizedArguments: lifecycleInput } as any, scope });
    expect(result.steps[0]?.summary).toContain("PBV2 publication");
  });

  test("keeps typed Pricing Engine rotation behind the existing Product GO command", async () => {
    const pricingInput = { productId: "product_1", operations: [{ op: "update_product_pricing_engine_configuration", changes: { allowRotation: true } }], proposalFingerprint: fingerprint };
    const pricingProposal = { ...proposal, sourceLifecycle: "PRODUCT", canonicalOperationReference: "products.update_pricing_engine_configuration.v1", changes: [{ field: "Allow Rotation / Mixed Sheet Layout", before: "off", after: "on" }] };
    const service = { revalidateProposal: jest.fn(async () => ({ valid: true as const, proposal: pricingProposal })), execute: jest.fn(async () => pricingProposal) } as any;
    const command = createExistingProductEditExecutionCommand(service);
    const built = await command.buildPreview({ scope, arguments: pricingInput, context: {} as any });
    expect(service.execute).not.toHaveBeenCalled();
    expect(built.preview.summary).toContain("Allow Rotation / Mixed Sheet Layout");
    const result = await command.execute({ plan: { sanitizedArguments: pricingInput } as any, scope });
    expect(result.steps[0]?.summary).toContain("Pricing Engine configuration");
  });
});
