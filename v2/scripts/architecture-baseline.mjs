import { importBaseline } from "./architecture-import-baseline.mjs";
import { sqlBaseline } from "./architecture-sql-baseline.mjs";
import { auditBaseline } from "./architecture-audit-baseline.mjs";

// Exact observed instances at 63f19bd3; never owner permissions.
export const baseline = [...importBaseline, ...sqlBaseline, ...auditBaseline];
