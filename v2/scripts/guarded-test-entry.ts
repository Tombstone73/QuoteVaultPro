import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireSafeTestDatabaseUrl } from '../../server/tests/helpers/safeTestDatabase.js';
import { requireV2M0CloneDatabaseUrl } from '../infrastructure/persistence/cloneSafety.js';

// Only the pure guards are imported before the suite's runtime closure.
const url = requireSafeTestDatabaseUrl();
requireV2M0CloneDatabaseUrl();
const target = process.argv[2];
if (!target) throw new Error('A classified guarded test path is required.');
process.env.DATABASE_URL = url;
if (process.env.V2_VALIDATION_MODE === 'qa') process.env.RAILWAY_ENVIRONMENT_NAME = 'Development';
await import(pathToFileURL(path.resolve(target)).href);
