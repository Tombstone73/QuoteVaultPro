import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamAccessWorkspace, filterCapabilityGroups } from "./TeamAccessWorkspace";
import type { TeamAccessRead } from "./api";

const value: TeamAccessRead = {
  authorityRevision: "authority-revision",
  staff: [{ memberId: "staff-1", displayName: "QA Operator", email: "qa@example.test", status: "active", permissionSets: ["Operations"], permissionSetIds: ["system-1"], effectivePermissions: [{ capability: "order.view", sources: ["Operations"] }], administratorCapable: true, allowedActions: ["membership.manage", "permission-sets.assign"] }],
  invitations: [],
  permissionSets: [
    { permissionSetId: "system-1", name: "Operations", description: "Managed template", revision: "revision-1", principalKind: "staff", active: true, systemManaged: true, capabilities: ["orders.view"], assignmentCount: 1 },
    { permissionSetId: "custom-1", name: "QA custom", revision: "revision-2", principalKind: "staff", active: true, systemManaged: false, capabilities: ["orders.view"], assignmentCount: 0 },
    { permissionSetId: "portal-1", name: "Customer portal basic", revision: "revision-3", principalKind: "portal", active: true, systemManaged: true, capabilities: ["portal.orders.view"], assignmentCount: 0 },
  ],
  portalAccess: [],
  portalCandidates: [{ customerId: "customer-1", customerName: "QA Customer", contactId: "contact-1", contactName: "QA Contact", email: "qa.contact@example.test", eligibility: "eligible" }],
  readiness: { status: "ready", reasons: [], activeStaffCount: 1, viableAdministratorCount: 1, pendingInvitationCount: 0 },
  capabilityGroups: [{ key: "orders", label: "Orders", capabilities: [{ id: "order.view", label: "View orders", sensitive: false }] }],
};

const render = (section: "staff" | "permission-sets" | "portal", canView = true, canManage = true) => {
  const client = new QueryClient();
  client.setQueryData(["v2", "scope-1", "organization-1", "settings", "team-access"], value);
  return renderToStaticMarkup(<QueryClientProvider client={client}><TeamAccessWorkspace organizationId="organization-1" sessionScope="scope-1" canView={canView} canManage={canManage} section={section} openCustomers={() => undefined}/></QueryClientProvider>);
};

const staff = render("staff");
assert.match(staff, /Team &amp; Access/);
assert.match(staff, /Roles &amp; Permissions/);
assert.match(staff, /Invite staff/);
assert.match(staff, /Manage roles/);
assert.match(staff, /View permissions/);
assert.match(staff, /Disable/);
assert.match(staff, /Operations/);

const sets = render("permission-sets");
assert.match(sets, /Built-in/);
assert.match(sets, /Roles &amp; Permissions/);
assert.match(sets, /Create custom role/);
assert.match(sets, /Clone role/);
assert.match(sets, /QA custom/);

assert.deepEqual(filterCapabilityGroups([{ key: "payments", label: "Payments", capabilities: [{ id: "payment.view", label: "View payments", sensitive: false }, { id: "payment.record", label: "Record payments", sensitive: true }] }, { key: "orders", label: "Orders", capabilities: [{ id: "order.view", label: "View orders", sensitive: false }] }], "record"), [{ key: "payments", label: "Payments", capabilities: [{ id: "payment.record", label: "Record payments", sensitive: true }] }]);

const portal = render("portal");
assert.match(portal, /Open Customers/);
assert.match(portal, /does not create Contacts or convert Staff identities/);
assert.match(portal, /Grant Portal access/);

const readonlyStaff = render("staff", true, false);
assert.match(readonlyStaff, /View permissions/);
assert.doesNotMatch(readonlyStaff, /Invite staff|Manage roles|Disable/);

const readonlySets = render("permission-sets", true, false);
assert.match(readonlySets, /Operations|QA custom/);
assert.doesNotMatch(readonlySets, /Create custom role|Clone role|>Edit</);

const denied = render("staff", false, false);
assert.match(denied, /do not have permission to view this setting/);
console.log("Team & Access canonical-wiring rendering tests passed.");
