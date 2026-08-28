import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamAccessWorkspace } from "./TeamAccessWorkspace";
import type { TeamAccessRead } from "./api";

const value: TeamAccessRead = {
  authorityRevision: "authority-revision",
  staff: [{ memberId: "staff-1", displayName: "QA Operator", email: "qa@example.test", status: "active", permissionSets: ["Operations"], administratorCapable: true, allowedActions: ["membership.manage", "permission-sets.assign"] }],
  invitations: [],
  permissionSets: [
    { permissionSetId: "system-1", name: "Operations", description: "Managed template", revision: "revision-1", principalKind: "staff", active: true, systemManaged: true, capabilities: ["orders.view"], assignmentCount: 1 },
    { permissionSetId: "custom-1", name: "QA custom", revision: "revision-2", principalKind: "staff", active: true, systemManaged: false, capabilities: ["orders.view"], assignmentCount: 0 },
  ],
  portalAccess: [],
  readiness: { status: "ready", reasons: [], activeStaffCount: 1, viableAdministratorCount: 1, pendingInvitationCount: 0 },
  capabilityGroups: [{ key: "orders", label: "Orders", capabilities: ["orders.view"] }],
};

const render = (section: "staff" | "permission-sets" | "portal", permissions = true) => {
  const client = new QueryClient();
  client.setQueryData(["v2", "scope-1", "organization-1", "settings", "team-access"], value);
  return renderToStaticMarkup(<QueryClientProvider client={client}><TeamAccessWorkspace organizationId="organization-1" sessionScope="scope-1" canView={permissions} canManageSets={permissions} canAssignStaff={permissions} canAssignPortal={permissions} section={section} openCustomers={() => undefined}/></QueryClientProvider>);
};

const staff = render("staff");
assert.match(staff, /Invite staff/);
assert.match(staff, /Edit access/);
assert.match(staff, /Disable/);
assert.match(staff, /Operations/);

const sets = render("permission-sets");
assert.match(sets, /System template/);
assert.match(sets, /Create custom set/);
assert.match(sets, /QA custom/);

const portal = render("portal");
assert.match(portal, /Open Customers/);
assert.match(portal, /does not create Contacts or convert Staff identities/);
assert.doesNotMatch(portal, /Grant portal access/);

const denied = render("staff", false);
assert.match(denied, /do not have permission to view this setting/);
console.log("Team & Access canonical-wiring rendering tests passed.");
