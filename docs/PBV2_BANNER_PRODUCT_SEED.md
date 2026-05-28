# PBV2 Banner Product Seed

The Banner product is not created by application deployment or app boot. Seed it deliberately for each environment and organization.

Dry-run first:

```bash
npm run pbv2:seed:banner -- --organization-id <ORG_ID> --dry-run
```

Create or update the product and leave the PBV2 tree as DRAFT:

```bash
npm run pbv2:seed:banner -- --organization-id <ORG_ID>
```

Create or update and publish the PBV2 tree:

```bash
npm run pbv2:seed:banner -- --organization-id <ORG_ID> --publish
```

Use the DEV and PROD organization ids separately. Do not reuse an id across environments unless that is the intended tenant. The script never mutates all organizations and only uses the default development organization when `--use-default-dev-org` is passed explicitly.
