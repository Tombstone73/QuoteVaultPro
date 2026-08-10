import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CanonicalProductIntentCardView, CanonicalProductIntentReviewProposalCard, toCanonicalProductIntentCard, toCanonicalProductIntentProposal } from "./AssistantCanonicalProductIntentCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fingerprint = "a".repeat(64);
function canonicalCard(overrides: Record<string, unknown> = {}) {
  return {
    kind: "canonical_product_intent_proposal",
    title: "Create inactive draft: Yard Signs",
    details: {
      canonicalProductIntent: {
        kind: "canonical_product_intent_proposal", revision: 4, fingerprint,
        title: "Create inactive draft: Yard Signs",
        readiness: { ready: false, blockers: [], questions: ["How should the matrix prices be charged?"] },
        fields: {
          Product: "Yard Signs", Category: "Rigid Signs", Measurement: "Quantity only", Quantity: "Customer enters quantity",
          Pricing: "Per piece matrix (4 prices)", Material: "No material selected", Options: ["Thickness: 3mm, 6mm", "Printed sides: Single-sided, Double-sided"],
          Proof: "Not required", "Production job": "Required", "Production route": "Flatbed", Lifecycle: "Inactive draft", Visibility: "Hidden",
        },
      },
    },
    ...overrides,
  };
}

describe("canonical Product Intent assistant card", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("recognizes only the canonical card discriminator and renders server-projected fields", () => {
    const card = toCanonicalProductIntentCard(canonicalCard())!;
    act(() => root.render(<CanonicalProductIntentCardView card={card} />));
    expect(container.textContent).toContain("Yard Signs");
    expect(container.textContent).toContain("Revision 4");
    expect(container.textContent).toContain("Thickness: 3mm, 6mm · Printed sides: Single-sided, Double-sided");
    expect(container.textContent).toContain("No material selected");
    expect(container.textContent).not.toContain("[object Object]");
    expect(toCanonicalProductIntentCard({ kind: "product_intake_summary", details: canonicalCard().details })).toBeNull();
  });

  it("numbers required questions and blocks confirmation messaging until they are resolved", () => {
    const card = toCanonicalProductIntentCard(canonicalCard())!;
    act(() => root.render(<CanonicalProductIntentCardView card={card} />));
    expect(container.querySelector("ol")?.textContent).toContain("How should the matrix prices be charged?");
    expect(container.textContent).toContain("cannot be confirmed");
  });

  it("submits only the opaque candidate action once and replaces the card after the server reply", async () => {
    const proposalId = "11111111-1111-4111-8111-111111111111";
    const actionId = "cand_flatbed_printing";
    const payload = canonicalCard({ details: { proposalId, canonicalProductIntent: {
      ...canonicalCard().details.canonicalProductIntent,
      candidateResolutions: [
        { id: actionId, issueId: "4:identity.category:candidate", revision: 4, fingerprint, kind: "select_category", label: "Use Flatbed Printing", description: "Use the tenant category.", blocksConfirmation: true, candidate: { id: "flatbed-printing", label: "Flatbed Printing" }, navigationOnly: false },
        { id: "cand_roll_printing", issueId: "4:identity.category:candidate", revision: 4, fingerprint, kind: "select_category", label: "Use Roll Printing", description: "Use the tenant category.", blocksConfirmation: true, candidate: { id: "roll-printing", label: "Roll Printing" }, navigationOnly: false },
      ],
    } } });
    const card = toCanonicalProductIntentCard(payload)!;
    let resolveInteraction: ((value: unknown) => void) | undefined;
    const onInteraction = jest.fn(() => new Promise<unknown>((resolve) => { resolveInteraction = resolve; }));
    act(() => root.render(<CanonicalProductIntentCardView card={card} onInteraction={onInteraction} />));

    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => buttons[0]?.click());
    expect(onInteraction).toHaveBeenCalledWith({ proposalId, action: "apply_candidate", actionId, newProductName: undefined });
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);

    await act(async () => resolveInteraction?.({ card: {
      ...payload.details.canonicalProductIntent,
      revision: 5, fingerprint: "b".repeat(64), readiness: { ready: false, blockers: [], questions: ["How should the matrix prices be charged?"] },
      fields: { ...(payload.details.canonicalProductIntent.fields as Record<string, unknown>), Category: "Flatbed Printing" }, candidateResolutions: [],
    } }));
    expect(container.textContent).toContain("Category: Flatbed Printing");
    expect(container.textContent).not.toContain("Use Flatbed Printing");
  });

  it("fails closed for object-valued product facts and reports a ready revision without a GO control", () => {
    const payload = canonicalCard();
    (payload.details.canonicalProductIntent.fields as Record<string, unknown>).Pricing = { cents: 1200 };
    (payload.details.canonicalProductIntent.readiness as Record<string, unknown>).ready = true;
    (payload.details.canonicalProductIntent.readiness as Record<string, unknown>).questions = [];
    const card = toCanonicalProductIntentCard(payload)!;
    act(() => root.render(<CanonicalProductIntentCardView card={card} />));
    expect(container.textContent).toContain("Ready for server-side review and confirmation");
    expect(container.textContent).not.toContain("[object Object]");
    expect(container.querySelector("button")).toBeNull();
  });

  it("recognizes only a turn-bound canonical review proposal", () => {
    const onCreatePlan = jest.fn();
    const proposal = toCanonicalProductIntentProposal({ kind: "action_proposal", title: "Create inactive draft: Yard Signs", plan: { action: "products.create_from_canonical_intent", proposalId: "11111111-1111-4111-8111-111111111111", revision: 4, fingerprint, turnId: "turn_1" } })!;
    act(() => root.render(<CanonicalProductIntentReviewProposalCard proposal={proposal} onCreatePlan={onCreatePlan} />));
    expect(container.textContent).toContain("Revision 4 is bound to this review");
    act(() => container.querySelector("button")?.click());
    expect(onCreatePlan).toHaveBeenCalledWith("turn_1");
    expect(toCanonicalProductIntentProposal({ kind: "action_proposal", plan: { action: "products.create_inactive_draft", proposalId: proposal.proposalId, revision: 4, fingerprint, turnId: "turn_1" } })).toBeNull();
  });

  it("disables a stale review control until the latest revision is reviewed", () => {
    const proposal = toCanonicalProductIntentProposal({ kind: "action_proposal", plan: { action: "products.create_from_canonical_intent", proposalId: "11111111-1111-4111-8111-111111111111", revision: 4, fingerprint, turnId: "turn_1" } })!;
    act(() => root.render(<CanonicalProductIntentReviewProposalCard proposal={proposal} onCreatePlan={jest.fn()} stale />));
    expect(container.textContent).toContain("newer canonical revision");
    expect(container.querySelector("button")?.hasAttribute("disabled")).toBe(true);
  });
});
