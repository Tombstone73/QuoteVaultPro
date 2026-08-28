import assert from "node:assert/strict";
import { emailIntegrationCallbackNotice } from "./emailIntegrationCallbackNotice";

assert.equal(emailIntegrationCallbackNotice("?email=connected"), "Gmail was connected. Email delivery readiness has been refreshed.");
assert.equal(emailIntegrationCallbackNotice("?email=cancelled"), "Google authorization was cancelled. No email credential was changed.");
assert.equal(emailIntegrationCallbackNotice("?email=error"), "Google connection could not be completed. Reconnect Gmail and try again.");
assert.equal(emailIntegrationCallbackNotice("?email=https://untrusted.example"), undefined);
assert.equal(emailIntegrationCallbackNotice(""), undefined);
console.log("email integration callback notice passed");
