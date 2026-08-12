import { readFile } from "node:fs/promises";
import path from "node:path";
import { jest } from "@jest/globals";
import {
  compareAssistantAuthority,
  compareAssistantCommandMetadata,
  emitAssistantCommandRegistryShadowDiagnostic,
  resolveAssistantActorAuthority,
} from "../services/assistant/actorAuthorityResolver";
import { evaluateAssistantOperationAuthority } from "../services/assistant/actorAuthorityOperationEvaluator";
import { legacyChatPermissionsForOrganizationRole, legacyExecutionSyntheticPermissionsForOrganizationRole } from "../services/assistant/actorAuthorityShadowAdapters";
import { renderAssistantAuthorityDivergenceMarkdown } from "../services/assistant/authorityDivergenceReport";

const trusted = (role: unknown, overrides: Partial<{ actorUserId: string; organizationId: string }> = {}) => resolveAssistantActorAuthority({
  actorUserId: overrides.actorUserId ?? "user_1", organizationId: overrides.organizationId ?? "org_1", organizationRole: role,
  authenticationSource: "authenticated_request", tenantSource: "tenant_context",
});

describe("AssistantActorAuthorityResolver (Phase 2A shadow mode)", () => {
  it("normalizes a standard authorized tenant actor using only the existing chat role translation", () => {
    const authority = trusted("admin");
    expect(authority.status).toBe("resolved");
    expect(evaluateAssistantOperationAuthority(authority, { kind: "read_tool", toolName: "products.get_pricing" }).status).toBe("allowed");
    expect(evaluateAssistantOperationAuthority(authority, { kind: "command", commandName: "products.update_existing_product" }).status).toBe("allowed");
  });

  it("denies a known operation absent from the trusted normal actor grants", () => {
    expect(evaluateAssistantOperationAuthority(trusted("member"), { kind: "command", commandName: "billing.send_invoice" })).toMatchObject({ status: "denied", reason: "trusted_role_grant_missing" });
  });

  it("fails closed on tenant isolation and unknown role sources", () => {
    expect(evaluateAssistantOperationAuthority(trusted("owner"), { kind: "read_tool", toolName: "quotes.search", targetOrganizationId: "org_2" })).toMatchObject({ status: "denied", reason: "tenant_mismatch" });
    expect(trusted("super_admin").status).toBe("unknown");
    expect(trusted(null).status).toBe("unknown");
  });

  it("keeps command capability and allowed-role metadata as separate shadow evidence", () => {
    expect(compareAssistantCommandMetadata({ requiredCapability: "assistant.products.update_existing_product", allowedRoles: ["owner", "admin"] }, trusted("admin")).result).toBe("exact_match");
    expect(compareAssistantCommandMetadata({ requiredCapability: "assistant.billing.send_invoice", allowedRoles: ["member"] }, trusted("member")).result).toBe("current_grants_more");
  });

  it("summarizes command-registry metadata without using a request or provider context", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    emitAssistantCommandRegistryShadowDiagnostic([{ name: "billing.send_invoice", requiredCapability: "assistant.billing.send_invoice", allowedRoles: ["member"] }]);
    expect(info).toHaveBeenCalledWith("[assistant_authority_shadow]", expect.objectContaining({ surface: "command_metadata", mismatchedCommandRolePairCount: 1 }));
    info.mockRestore();
  });

  it("reports missing descriptive command metadata as UNKNOWN", () => {
    expect(evaluateAssistantOperationAuthority(trusted("owner"), { kind: "command", commandName: "products.adjust_pricing" })).toMatchObject({ status: "unknown", reason: "operation_permission_metadata_unknown" });
  });

  it("identifies synthetic execution authority broader than normal actor authority and chat narrower than execution", () => {
    const member = trusted("member");
    const comparison = compareAssistantAuthority("execution", legacyExecutionSyntheticPermissionsForOrganizationRole("member"), member);
    expect(comparison.result).toBe("current_grants_more");
    expect(comparison.currentOnly).toContain("assistant.billing.send_invoice");
    expect(compareAssistantAuthority("chat", legacyChatPermissionsForOrganizationRole("member"), member).result).toBe("exact_match");
  });

  it("does not accept context, model, or synthetic permission fields as authority input", () => {
    const authority = resolveAssistantActorAuthority({
      actorUserId: "user_1", organizationId: "org_1", organizationRole: "member", authenticationSource: "authenticated_request", tenantSource: "tenant_context",
      // Extra provider-controlled values are structurally ignored at runtime.
      modelPermissions: ["assistant.billing.send_invoice"], pageContext: { role: "owner" }, syntheticExecutionPermissions: ["assistant.billing.send_invoice"],
    } as any);
    expect(evaluateAssistantOperationAuthority(authority, { kind: "command", commandName: "billing.send_invoice" }).status).toBe("denied");
  });

  it("preserves current route enforcement maps while shadow adapters are added", async () => {
    expect(legacyChatPermissionsForOrganizationRole("owner")).toEqual(expect.arrayContaining(["assistant.diagnostics.view", "finance.read"]));
    expect(legacyExecutionSyntheticPermissionsForOrganizationRole("member")).toEqual(expect.arrayContaining(["assistant.payments.record_manual_payment", "assistant.billing.send_invoice"]));
    const routes = await Promise.all(["server/routes/assistant.routes.ts", "server/routes/assistantExecution.routes.ts"].map((file) => readFile(path.resolve(process.cwd(), file), "utf8")));
    expect(routes[0]).toContain("legacyChatPermissionsForOrganizationRole(req.orgRole)");
    expect(routes[1]).toContain("legacyExecutionSyntheticPermissionsForOrganizationRole(req.orgRole)");
  });

  it("keeps the checked-in divergence report generated from shadow evidence", async () => {
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/ai-operator-authority-divergence.md"), "utf8")).resolves.toBe(renderAssistantAuthorityDivergenceMarkdown());
  });
});
