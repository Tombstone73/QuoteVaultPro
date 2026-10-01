# Production Financial Release: Decision Required

Characterized at `3c48029c9dc62dac6090a69dc1f6d5f466039fa2` during the overnight
campaign. This is a contract recommendation, not an implemented release gate or
a new ownership source. Billing owns financial validity; Production and Routing
must consume a Billing-owned release decision when its policy is approved.

## Available facts

- Billing settlement derives current Invoice total minus payment allocations plus
  refund allocations. Pending or uncertain provider operations are not payments.
- Orders can have base and replacement Invoices; no-charge replacements preserve
  the original Invoice/payment evidence.
- CRM supplies terms and optional credit configuration. Existing terms include
  due-on-receipt, net terms, custom values and arbitrary historical strings.
- Sales automatic completion requires operational eligibility and settled active
  Invoices. This completion rule is not a Production-release policy.

No authoritative current contract establishes that a term string such as `cash`
means upfront payment or that `net_30` by itself grants credit. Cash is also a
tender method, which must not be confused with account terms.

## Proposed owner contract

```ts
type FinancialReleaseDecision = Readonly<{
  state: "eligible" | "held" | "undetermined";
  policyReference: string;
  assessedAt: string;
  invoiceEvidence: readonly Readonly<{
    invoiceId: string;
    synchronizationVersion: string;
    currency: string;
    balanceCents: number;
  }>[];
  reasonCode?: string;
}>;
```

The server-side owner must compute this decision within the caller's transaction
from scoped canonical facts and an approved policy. UI text such as **Awaiting
Payment** may represent `held`; it must not become another persisted Order state.
Unknown policy must remain explicit rather than being guessed as held or eligible.
This document does not authorize wiring a default-deny or default-allow gate.

## Decisions still required

1. Which explicit policy or terms require prepayment, credit approval or deposits?
2. What do absent versus configured-zero credit limits mean?
3. How do contact-only Orders, multiple/replacement Invoices, partial payments,
   pending payments, refunds, credits and multiple currencies affect release?
4. Which existing capability authorizes a financial override, and what evidence
   must it preserve or invalidate after a financial change?
5. Which actions are release boundaries: normal Prepress handoff, direct/skip
   workflow, Production work opening, attempt start, or a specified subset?

Entry and Proofing must not inherit an invented financial hold. A complete
implementation must enforce the approved policy at every release path, including
direct APIs, before mutation. Tests must prove later payment changes the owner
decision and that UI labels use the same decision. Until these questions are
approved, no cosmetic status or production-release enforcement is claimed.
