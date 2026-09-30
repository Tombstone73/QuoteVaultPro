import { apiFetch } from "@/lib/queryClient";
import { canReturnUpstream, ReturnUpstreamError, returnUpstream, type ReturnUpstreamTarget } from "./returnUpstream";
import { requiresExplicitProofReturn, shouldWarnAfterProofRequirementSave } from "./proofRequirementWarning";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));

const target: ReturnUpstreamTarget = {
  lineItemId: "line-1", orderId: "order-1", workflowState: "in_prepress",
  activeOwnerJobId: "job-1", lineItemUpdatedAt: "2026-09-30T12:00:00.000Z",
  isActivelyOwnedByPrepress: true,
};

beforeEach(() => jest.mocked(apiFetch).mockReset());

test("only an active Prepress Owner/Admin sees an available return", () => {
  expect(canReturnUpstream(target, true)).toBe(true);
  expect(canReturnUpstream(target, false)).toBe(false);
  expect(canReturnUpstream({ ...target, workflowState: "in_production" }, true)).toBe(false);
  expect(canReturnUpstream({ ...target, activeOwnerJobId: null }, true)).toBe(false);
  expect(canReturnUpstream({ ...target, lineItemUpdatedAt: "" }, true)).toBe(false);
});

test.each(["proofing", "design"] as const)("%s sends the exact guarded command", async (destination) => {
  jest.mocked(apiFetch).mockResolvedValue({ ok: true } as Response);
  await returnUpstream(target, destination, "  Correct the proof  ");
  expect(apiFetch).toHaveBeenCalledTimes(1);
  const [url, init] = jest.mocked(apiFetch).mock.calls[0];
  expect(url).toBe("/api/line-items/line-1/return-upstream");
  expect(JSON.parse(String(init?.body))).toEqual({
    destination, reason: "Correct the proof", expectedWorkflowState: "in_prepress",
    expectedOwnerJobId: "job-1", expectedUpdatedAt: "2026-09-30T12:00:00.000Z",
  });
});

test("preserves domain conflict code and safe message without retry", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "UPSTREAM_SHARED_PROOF", message: "Resolve the combined Proof first." }) } as Response);
  await expect(returnUpstream(target, "proofing", "Reason")).rejects.toEqual(new ReturnUpstreamError(409, "UPSTREAM_SHARED_PROOF", "Resolve the combined Proof first."));
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

test("the newly required proof warning applies only downstream", () => {
  expect(requiresExplicitProofReturn("in_prepress")).toBe(true);
  expect(requiresExplicitProofReturn("in_production")).toBe(true);
  expect(requiresExplicitProofReturn("awaiting_proof_approval")).toBe(false);
  expect(requiresExplicitProofReturn("completed")).toBe(false);
  expect(shouldWarnAfterProofRequirementSave({ previousRequiresProof: false, savedRequiresProof: true, workflowState: "in_prepress" })).toBe(true);
  expect(shouldWarnAfterProofRequirementSave({ previousRequiresProof: false, savedRequiresProof: true, workflowState: "awaiting_proof_approval" })).toBe(false);
  expect(shouldWarnAfterProofRequirementSave({ previousRequiresProof: true, savedRequiresProof: true, workflowState: "in_prepress" })).toBe(false);
  expect(shouldWarnAfterProofRequirementSave({ previousRequiresProof: false, savedRequiresProof: false, workflowState: "in_prepress" })).toBe(false);
});
