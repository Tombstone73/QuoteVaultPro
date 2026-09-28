import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthSessionControlsContext, clearOrganizationSwitchClientState } from "./AuthGate";
import { V2AccountMenu } from "./VisualShell";

Object.assign(globalThis, { window: { location: { pathname: "/" } } });

const accountMenu = (value: NonNullable<React.ContextType<typeof AuthSessionControlsContext>>) => renderToStaticMarkup(
  <V2AccountMenu session={value} open setOpen={() => undefined} />,
);

const multi = accountMenu({
  displayName: "Dale Hensley",
  email: "dale@example.test",
  organizations: [{ id: "org-dev", name: "Titan Graphics" }, { id: "org-qa", name: "PrintersHero M7 QA" }],
  activeOrganizationId: "org-qa",
  busy: false,
  signOut: () => undefined,
  selectOrganization: () => undefined,
});
assert.match(multi, /PrintersHero M7 QA/);
assert.match(multi, /Switch organization/);
assert.match(multi, /Titan Graphics/);
assert.match(multi, /role="menuitemradio"/);
assert.match(multi, /aria-checked="true"/);

const single = accountMenu({
  displayName: "Only Staff",
  email: "only@example.test",
  organizations: [{ id: "org-only", name: "Only Organization" }],
  activeOrganizationId: "org-only",
  busy: false,
  signOut: () => undefined,
  selectOrganization: () => undefined,
});
assert.match(single, /Only Organization/);
assert.doesNotMatch(single, /Switch organization/);

const client = new QueryClient();
client.setQueryData(["v2", "scope-a", "org-dev", "orders"], { leaked: true });
clearOrganizationSwitchClientState(client);
assert.equal(client.getQueryData(["v2", "scope-a", "org-dev", "orders"]), undefined);

console.log("Organization switcher visual and cache-isolation tests passed.");
