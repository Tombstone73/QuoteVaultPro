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
    { permissionSetId: "system-1", name: "Operations", description: "Managed template", revision: "revision-1", principalKind: "staff", active: true, systemManaged: true, capabilities: ["order.view"], assignmentCount: 1, assignedStaff: [{ memberId: "staff-1", displayName: "QA Operator", email: "qa@example.test", status: "active" }] },
    { permissionSetId: "custom-1", name: "QA custom", revision: "revision-2", principalKind: "staff", active: true, systemManaged: false, capabilities: ["order.view"], assignmentCount: 0, assignedStaff: [] },
    { permissionSetId: "portal-1", name: "Customer portal basic", revision: "revision-3", principalKind: "portal", active: true, systemManaged: true, capabilities: ["order.view"], assignmentCount: 0, assignedStaff: [] },
  ],
  portalAccess: [],
  portalCandidates: [{ customerId: "customer-1", customerName: "QA Customer", contactId: "contact-1", contactName: "QA Contact", email: "qa.contact@example.test", eligibility: "eligible" }],
  readiness: { status: "ready", reasons: [], activeStaffCount: 1, viableAdministratorCount: 1, pendingInvitationCount: 0 },
  capabilityGroups: [{ key: "orders", label: "Orders", capabilities: [{ id: "order.view", label: "View orders", sensitive: false }] }],
  roleBuilder: { canBuildRoles: true, canAssignStaffRoles: true, selectableCapabilityIds: ["order.view"] },
};

const render = (section: "staff" | "permission-sets" | "portal", canView = true, canManage = true, canBuildRoles = true) => {
  const client = new QueryClient();
  client.setQueryData(["v2", "scope-1", "organization-1", "settings", "team-access"], { ...value, roleBuilder: { ...value.roleBuilder, canBuildRoles, canAssignStaffRoles: canBuildRoles } });
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
assert.match(sets, /1 staff assigned/);
assert.match(sets, /0 staff assigned/);

assert.deepEqual(filterCapabilityGroups([{ key: "payments", label: "Payments", capabilities: [{ id: "payment.view", label: "View payments", sensitive: false }, { id: "payment.record", label: "Record payments", sensitive: true }] }, { key: "orders", label: "Orders", capabilities: [{ id: "order.view", label: "View orders", sensitive: false }] }], "record"), [{ key: "payments", label: "Payments", capabilities: [{ id: "payment.record", label: "Record payments", sensitive: true }] }]);

const portal = render("portal");
assert.match(portal, /Open Customers/);
assert.match(portal, /does not create Contacts or convert Staff identities/);
assert.match(portal, /Grant Portal access/);

const readonlyStaff = render("staff", true, false, false);
assert.match(readonlyStaff, /View permissions/);
assert.doesNotMatch(readonlyStaff, /Invite staff|Manage roles|Disable/);

const readonlySets = render("permission-sets", true, false, false);
assert.match(readonlySets, /Operations|QA custom/);
assert.doesNotMatch(readonlySets, /Create custom role|Clone role|>Edit</);

const denied = render("staff", false, false);
assert.match(denied, /do not have permission to view this setting/);
console.log("Team & Access canonical-wiring rendering tests passed.");
