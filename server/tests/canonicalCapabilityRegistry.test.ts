import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCanonicalCapabilityForCommand, getCapabilitiesForActor, canonicalCapabilityRegistry, isAiExecutableCanonicalCapability, renderCanonicalCapabilityRegistryMarkdown, validateCanonicalCapabilityRegistry } from "../services/assistant/canonicalCapabilityRegistry";
import { resolveAssistantActorAuthority } from "../services/assistant/actorAuthorityResolver";
import { assistantProductionCommandAllowlist } from "../services/assistant/execution/commandRegistry";
import { assistantToolRegistry } from "../services/assistant/toolRegistry";

const authority = (role: unknown, organizationId = "org_1") => resolveAssistantActorAuthority({ actorUserId: "user_1", organizationId, organizationRole: role, authenticationSource: "authenticated_request", tenantSource: "tenant_context" });

describe("canonical AI capability registry and privilege ceiling", () => {
  it("is internally consistent and wraps every existing reviewed command and read tool", () => {
    expect(() => validateCanonicalCapabilityRegistry()).not.toThrow();
    expect(new Set(canonicalCapabilityRegistry.map((capability) => capability.id)).size).toBe(canonicalCapabilityRegistry.length);
    expect(canonicalCapabilityRegistry.filter((capability) => capability.source === "command").map((capability) => capability.sourceId).sort()).toEqual([...assistantProductionCommandAllowlist].sort());
    expect(canonicalCapabilityRegistry.filter((capability) => capability.source === "read_tool").map((capability) => capability.sourceId).sort()).toEqual([...assistantToolRegistry.keys()].sort());
  });

  it("allows an admin and owner normal eligible tenant capabilities but never exposes hard denies", () => {
    for (const role of ["admin", "owner"]) {
      const discovery = getCapabilitiesForActor({ authority: authority(role) });
      expect(discovery.modelFacing.map((capability) => capability.sourceId)).toContain("billing.send_invoice");
      expect(discovery.modelFacing.some((capability) => capability.aiEligibility === "hard_denied")).toBe(false);
      expect(discovery.diagnostics.find((item) => item.capabilityId === "capability.hard_deny.organization.delete")).toMatchObject({ available: false, reason: "ai_hard_denied" });
    }
  });

  it("marks the bounded existing-Product configuration capability as shared canonical without expanding the Product surface", () => {
    const capability = getCanonicalCapabilityForCommand("products.update_existing_product");
    expect(capability).toMatchObject({ parityStatus: "shared_canonical", migrationStatus: "shared_canonical", confirmation: "go_required" });
    expect(capability?.canonicalOperationReference).toContain("products.update_configuration.v1");
    expect(capability?.canonicalOperationReference).toContain("products.update_option_configuration.v1");
    expect(capability?.canonicalOperationReference).toContain("products.publish_configuration.v1");
    expect(capability?.canonicalOperationReference).toContain("products.update_pricing_engine_configuration.v1");
    expect(canonicalCapabilityRegistry.filter((item) => item.domain === "products" && item.parityStatus === "shared_canonical").map((item) => item.sourceId)).toEqual(["products.update_existing_product"]);
  });

  it("distinguishes pending, deliberately ineligible, and hard-denied Product capabilities", () => {
    expect(canonicalCapabilityRegistry.find((item) => item.id === "capability.ui.products.pricing_formula_profile")).toMatchObject({ parityStatus: "ai_integration_pending", aiEligibility: "ineligible", aiExposure: "not_exposed" });
    expect(canonicalCapabilityRegistry.find((item) => item.id === "capability.ui.products.delete")).toMatchObject({ parityStatus: "deliberately_ai_ineligible", aiEligibility: "ineligible" });
    expect(canonicalCapabilityRegistry.find((item) => item.id === "capability.hard_deny.organization.delete")).toMatchObject({ aiEligibility: "hard_denied" });
  });

  it("keeps members below prior synthetic execution privileges", () => {
    const discovery = getCapabilitiesForActor({ authority: authority("member") });
    expect(discovery.modelFacing.map((capability) => capability.sourceId)).not.toContain("billing.send_invoice");
    expect(discovery.modelFacing.map((capability) => capability.sourceId)).not.toContain("payments.record_manual_payment");
  });

  it("does not grant tenant authority from developer/internal labels and fails closed for unknown roles", () => {
    const discovery = getCapabilitiesForActor({ authority: authority("super_admin") });
    expect(discovery.modelFacing).toEqual([]);
    expect(discovery.diagnostics.some((item) => item.reason === "unknown_authority")).toBe(true);
  });

  it("prevents future elevated grants and metadata errors from bypassing the admin AI ceiling or hard denies", () => {
    const owner = authority("owner");
    const elevated = { ...owner, grants: [...owner.grants, "owner.delete_organization", "developer.database.maintenance"] };
    const discovery = getCapabilitiesForActor({ authority: elevated });
    expect(discovery.modelFacing.some((capability) => capability.id.includes("hard_deny"))).toBe(false);
    expect(discovery.diagnostics.find((item) => item.capabilityId === "capability.hard_deny.platform.developer_operations")).toMatchObject({ reason: "ai_hard_denied" });
    expect(isAiExecutableCanonicalCapability(canonicalCapabilityRegistry.find((capability) => capability.id === "capability.hard_deny.organization.delete"))).toBe(false);
    expect(isAiExecutableCanonicalCapability(getCanonicalCapabilityForCommand("billing.send_invoice"))).toBe(true);
  });

  it("keeps tenant mismatch and provider/context-shaped fields from changing discovery", () => {
    const actor = authority("admin");
    const mismatch = getCapabilitiesForActor({ authority: actor, targetOrganizationId: "org_2" } as any);
    expect(mismatch.modelFacing).toEqual([]);
    const injected = getCapabilitiesForActor({ authority: actor, modelPermissions: ["owner.delete_organization"], pageContext: { organizationId: "org_2" }, providerCapabilities: ["platform.developer_operations"] } as any);
    expect(injected.modelFacing.some((capability) => capability.aiEligibility === "hard_denied")).toBe(false);
  });

  it("keeps the checked-in canonical registry report generated", async () => {
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/ai-operator-canonical-capability-registry.md"), "utf8")).resolves.toBe(renderCanonicalCapabilityRegistryMarkdown());
  });
});
