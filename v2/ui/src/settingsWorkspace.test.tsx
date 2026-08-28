import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsWorkspace } from "./SettingsWorkspace";
import "./teamAccessWorkspace.test";

const view = renderToStaticMarkup(<SettingsWorkspace salesTax={<p>Canonical tax</p>} email={<p>Canonical email</p>} businessProfile={<p>Canonical business</p>} documents={<p>Canonical documents</p>} numbering={<p>Canonical numbering</p>} staff={<p>Canonical staff</p>} permissionSets={<p>Canonical permission sets</p>} portalAccess={<p>Canonical portal access</p>} />);
for (const label of ["Business Profile", "Documents &amp; Branding", "Numbering", "Staff &amp; Users", "Permission Sets", "Customer Portal Access", "Sales Tax", "Email Delivery", "Invoice Defaults", "Accounting", "Appearance"]) assert.match(view, new RegExp(label));
assert.match(view, /Readiness is server-authoritative/);
assert.match(view, /Open a section to view canonical readiness/);
assert.doesNotMatch(view, /Pickup ready|Destination tax needs attention/);
console.log("Settings workspace approved-reference navigation tests passed.");
