import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LovableProductBuilderRoot } from "./lovableRoot";

type PublishState = Readonly<{
  canEdit?: boolean;
  persisted?: boolean;
  saving?: boolean;
  publishing?: boolean;
  errors?: number;
  publishDisabled?: boolean;
  publishBlockedReason?: string;
}>;

const renderBuilder = (state: PublishState = {}) => renderToStaticMarkup(
  <LovableProductBuilderRoot
    title="Test Product"
    lifecycle={null}
    findings={{ errors: state.errors ?? 0, warnings: 0 }}
    canEdit={state.canEdit ?? true}
    persisted={state.persisted ?? true}
    saving={state.saving}
    publishing={state.publishing}
    publishDisabled={state.publishDisabled}
    publishBlockedReason={state.publishBlockedReason}
    onSave={() => {}}
    onPublish={() => {}}
    rail={null}
  >{{ basics: <p>Basics</p>, review: <p>Review</p> }}</LovableProductBuilderRoot>,
);

const publishButtons = (markup: string) => [...markup.matchAll(/<button\b[^>]*>Publish<\/button>/g)].map(([button]) => button);
const assertPublishDisabled = (markup: string, reason: string) => {
  const buttons = publishButtons(markup);
  assert.equal(buttons.length, 2, "header and Review must expose the same Publish state");
  for (const button of buttons) {
    assert.match(button, /disabled=""/);
    assert.match(button, /aria-describedby="product-builder-publish-state"/);
  }
  assert.match(markup, new RegExp(`id="product-builder-publish-state"[^>]*>${reason}`));
};

// A clean, persisted Draft remains publishable; the server still owns final readiness.
const clean = renderBuilder();
assert.equal(publishButtons(clean).length, 2);
for (const button of publishButtons(clean)) assert.doesNotMatch(button, /disabled=""/);
assert.doesNotMatch(clean, /product-builder-publish-state/);

// Every dirty canonical section must use the same save-first contract. The
// caller intentionally supplies the concrete section(s), so users are never
// told an older persisted Draft is safe to publish.
for (const reason of [
  "Save Changes before publishing: Basics has unsaved edits.",
  "Save Changes before publishing: Options has unsaved edits.",
  "Save Changes before publishing: Pricing and Formula have unsaved edits.",
]) assertPublishDisabled(renderBuilder({ publishDisabled: true, publishBlockedReason: reason }), reason);

// A running or partially failed save cannot race publication. Stale state
// preserves local edits and requires reconciliation before Publish can return.
assertPublishDisabled(renderBuilder({ saving: true, publishDisabled: true, publishBlockedReason: "Saving Draft changes before publishing." }), "Saving Draft changes before publishing.");
assertPublishDisabled(renderBuilder({ publishDisabled: true, publishBlockedReason: "Save stopped after Options. Resolve the error before publishing." }), "Save stopped after Options. Resolve the error before publishing.");
assertPublishDisabled(renderBuilder({ publishDisabled: true, publishBlockedReason: "This Draft changed elsewhere. Refresh and reconcile before publishing." }), "This Draft changed elsewhere. Refresh and reconcile before publishing.");

// Persisted server readiness remains independently authoritative.
assertPublishDisabled(renderBuilder({ errors: 1, publishDisabled: true, publishBlockedReason: "Fix 1 blocking issue before publishing." }), "Fix 1 blocking issue before publishing.");

// New and read-only workspaces have no mutation surface at all.
const unsavedNew = renderBuilder({ persisted: false });
assert.equal(publishButtons(unsavedNew).length, 0);
const readOnly = renderBuilder({ canEdit: false });
assert.equal(publishButtons(readOnly).length, 0);
assert.doesNotMatch(readOnly, />Save Changes</);

console.log("Product Builder Save-to-Publish presentation contract tests passed.");
