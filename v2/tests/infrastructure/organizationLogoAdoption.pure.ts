import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../..", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const adoption = source("v2/infrastructure/organization/organizationLogoAdoption.ts");
const settings = source("v2/infrastructure/organization/postgresOrganizationSettings.ts");
const routes = source("v2/src/interfaces/http/organizationSettingsRoutes.ts");

assert.match(adoption, /StorageApplicationService/u);
assert.match(adoption, /resourceType: "organization"/u);
assert.match(adoption, /fileRecordId: stored\.fileRecord\.id/u);
assert.match(adoption, /image\/png/u);
assert.match(adoption, /image\/jpeg/u);
assert.match(adoption, /maximumBytes = 2 \* 1024 \* 1024/u);
assert.match(adoption, /organization\.documents_branding\.logo\.adopt\.v1/u);
assert.doesNotMatch(adoption, /signedUrl|previewUrl|objectPath/u);
assert.match(settings, /adoptLogoAsset/u);
assert.match(settings, /WHERE organization_id=\$1 AND id=\$2 FOR UPDATE/u);
assert.match(settings, /invoice_logo_asset_id=\$3,invoice_logo_url=NULL,logo_url=NULL/u);
assert.match(settings, /organization_logo_adopted/u);
assert.match(routes, /documents-branding\/logo/u);
assert.match(routes, /multipart\/form-data/u);
assert.match(routes, /logoAdoption\.adopt/u);
console.log("Organization logo adoption private-storage, tenant, and no-URL contract tests passed.");
