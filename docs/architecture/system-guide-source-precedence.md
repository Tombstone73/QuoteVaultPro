# System Guide source precedence

1. Tenant-scoped live records, organization configuration, and authenticated permissions.
2. The versioned System Guide manifest built from registered route/status/capability metadata.
3. Curated active `docs/knowledge` articles indexed by the knowledge sync.
4. Current architecture and workflow documentation.
5. Explicitly marked historical documentation.
6. Generic model knowledge only for non-PrintersHero print-industry concepts, labeled as general knowledge.

Higher-priority sources replace conflicting lower-priority sources. The assistant must identify an older source as outdated when useful and must not merge conflicting instructions as equally current. Tenant supplemental knowledge is always queried with an exact organization scope and may override global curated knowledge only within that organization.
