// Used only by jest.local-postgres.config.js. Runtime application imports keep
// the Neon driver; local PostgreSQL tests use the compatible pg Pool API.
import pg from 'pg';

export const Pool = pg.Pool;
export const neonConfig = {};
