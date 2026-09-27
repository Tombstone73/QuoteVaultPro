# V2 Operations role

Operations is a canonical, non-admin built-in Staff permission set
(`source_template_key=operations`), available through existing Team & Access.
It is not a legacy membership role, an administrator alias, or a QA-only set.

The typed contract is `v2/src/authorization/operationsRole.ts`. Migration 0292
seeds the matching template and organization copies. The migration test checks
exact SQL/TypeScript parity. Future grant changes require a forward migration;
historical migrations remain immutable. No users are assigned by the migration.
Existing role meanings, customized sets and portal authority are unchanged.
A conflicting custom set named Operations causes an explicit migration failure,
not silent replacement.

## Scope decisions

- Customer and Contact work uses customer.view/customer.edit.
- Quote create/edit/send/convert and selling-price overrides are operational.
- Order create/edit and selling-price overrides are operational; cancellation
  and workflow overrides are not included.
- Product viewing and pricing preview are included. Product editing, pricing
  configuration/publication and route-template administration are excluded.
- Artwork viewing, adoption and assignment/unassignment are included.
- Proof prepare/issue is included; customer Proof response authority is not.
- Prepress, Production execution/rework/rejection, pickup/shipping/replacement,
  and shipment cost/price evidence are included.
- Invoice draft/issued editing, issue/send and payment visibility are included.
  Payment recording and refunds remain separate financial responsibilities.
- organization.configure is excluded: it controls broad business settings and
  QuickBooks/Stripe integration configuration/readiness. There is no smaller
  existing organization-setting capability needed for the described workflow.
- All permission administration, communications/numbering configuration,
  provider credentials, platform authority and ownership remain excluded.

## DEV QA alignment

`m78i` is only a compatibility name for Operations. Its capability export is the
same frozen object as the production role, not a copied list. The existing
operator assigns the actual tenant Operations set and verifies template
provenance plus exact capabilities. It never edits that set to repair QA drift.

After deploying the migration and code, run in the guarded Railway DEV shell:

```sh
npm run qa:dev-operator -- profile-restore --email m7-7e-qa-browser@printershero.invalid
npm run qa:dev-operator -- verify
npm run qa:dev-operator -- status
```

Restore retains the existing user, password and sole QA tenant membership,
sets legacy account role to employee/isAdmin=false and membership role to
member, and deactivates other browser permission-set assignments. Guardian and
other staff assignments remain unchanged. Repeating restore is a no-op.
Existing temporary fixture profiles remain explicit alternatives over Operations;
Product editing belongs only to the pricing/setup fixture profiles.
The legacy provisioner defaults to m78i and rejects Full Access for this browser.

## Side effects and validation boundary

This role grants ordinary quote/invoice sending to real staff and QA alike.
It does **not** implement a provider sandbox or guarantee that DEV delivery is
suppressed. Existing DEV guards/provider configuration are unchanged and must be
verified before live sending, charging, carrier purchasing or QuickBooks writes.
This change performs no deployment check or live identity/provider mutation.
