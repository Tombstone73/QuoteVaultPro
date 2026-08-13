import { requireV2PocPostgresUrl } from "../../src/infrastructure/postgresSafety";

// Validate before any integration test imports `pg` or a repository. The URL
// stays in process memory only and is never printed by this V2 harness.
requireV2PocPostgresUrl(process.env);
