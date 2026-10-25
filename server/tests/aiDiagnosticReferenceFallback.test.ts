import { describe, expect, test } from "@jest/globals";
import { sanitizeOrFallbackAiDiagnosticEnvelope } from "../services/aiDiagnosticsService";

const reference = "4d099e06-773d-4106-a555-87d4595cb163";

describe("assistant diagnostic reference", () => {
  test("retains a safe lookup identity when optional runtime data is invalid", () => {
    const fallback = sanitizeOrFallbackAiDiagnosticEnvelope({ referenceId: reference, correlationId: reference,
      tenantId: "org_1", actorId: "user_1", conversationId: "conversation_1", diagnosticType: "operator_runtime",
      operatorRuntime: { invalid: "raw data must not persist" } });
    expect(fallback).toMatchObject({ referenceId: reference, tenantId: "org_1", stage: "diagnostic_payload_validation_failed", errorCode: "diagnostic_sanitization_failed" });
    expect(JSON.stringify(fallback)).not.toContain("raw data must not persist");
  });

  test("never fabricates a lookup record without safe tenant and reference IDs", () => {
    expect(sanitizeOrFallbackAiDiagnosticEnvelope({ referenceId: "unsafe/reference", correlationId: reference, tenantId: "org_1" })).toBeNull();
    expect(sanitizeOrFallbackAiDiagnosticEnvelope({ referenceId: reference, correlationId: reference, tenantId: "" })).toBeNull();
  });
});
