const path = require('node:path');
const { require: loadTs } = require('tsx/cjs/api');
const root = path.resolve(__dirname, '../..');
const { requireSafeTestDatabaseUrl } = loadTs(path.join(root, 'server/tests/helpers/safeTestDatabase.ts'), __filename);
const { requireV2M0CloneDatabaseUrl } = loadTs(path.join(root, 'v2/infrastructure/persistence/cloneSafety.ts'), __filename);
const url = requireSafeTestDatabaseUrl();
requireV2M0CloneDatabaseUrl();
process.env.DATABASE_URL = url;
