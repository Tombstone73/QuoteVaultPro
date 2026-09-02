import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth = readFileSync("v2/infrastructure/authentication/standaloneStaffAuth.ts", "utf8");
const team = readFileSync("v2/infrastructure/organization/postgresTeamAccess.ts", "utf8");
const ui = readFileSync("v2/ui/src/PortalApp.tsx", "utf8");

assert.match(auth, /customer_portal_invite_tokens/u);
assert.match(auth, /v2_portal_password_reset_tokens/u);
assert.match(auth, /token_hash=\$1 AND t\.used_at IS NULL AND t\.revoked_at IS NULL/u);
assert.match(auth, /a\.status='PENDING_INVITE'/u);
assert.match(auth, /a\.status='ACTIVE'/u);
assert.match(auth, /session\.regenerate/u);
assert.match(auth, /safePortalReturnTo/u);
assert.match(auth, /forgot-password/u);
assert.match(auth, /customer_contact_links/u);
assert.match(auth, /a\.status='PENDING_INVITE'[\s\S]*FOR UPDATE OF t, a/u);
assert.match(auth, /a\.status='ACTIVE'[\s\S]*FOR UPDATE OF a/u);
assert.match(auth, /t\.token_hash=\$1[\s\S]*a\.status='ACTIVE'[\s\S]*FOR UPDATE OF t, a/u);
assert.match(team, /portal\/setup\?token=/u);
assert.match(team, /resendPortalSetup/u);
assert.match(team, /setPortalAccessStatus/u);
assert.match(team, /v2_portal_password_reset_tokens SET revoked_at/u);
assert.match(ui, /\/portal\/setup/u);
assert.match(ui, /\/portal\/forgot-password/u);
assert.match(ui, /Forgot password\?/u);
console.log("V2 portal credential lifecycle contract tests passed.");
