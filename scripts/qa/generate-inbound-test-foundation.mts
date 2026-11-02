/** Synthetic, data-free prerequisite for the comment-only V2 baseline.
 * Never writes a migration ledger, modifies migration SQL, or connects to a DB.
 * The canonical runner subsequently executes EVERY journal entry.
 */
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../../shared/schema.ts';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const folder = 'server/db/migrations_v2';
const sql = readdirSync(folder).filter(file => file.endsWith('.sql'))
  .map(file => readFileSync(`${folder}/${file}`, 'utf8')).join('\n');
const snapshot = generateDrizzleJson(schema);
// Foundation contains only tables which predate the lineage. Stations retain
// the existing ORM varchar IDs; their migration-only default/link are supplied
// below. All other V2-created tables must be created by their actual migration.
const created = new Set([...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi)]
  .map(match => match[1]).filter(name => name !== 'stations'));
for (const [key, table] of Object.entries(snapshot.tables)) {
  if (created.has(table.name)) { delete snapshot.tables[key]; continue; }
  table.indexes = Object.fromEntries(Object.entries(table.indexes).filter(([, index]) => index.isUnique));
  table.checkConstraints = {};
  for (const statement of sql.split(';')) {
    const alter = statement.match(new RegExp(`ALTER TABLE(?:\\s+ONLY)?\\s+(?:public\\.)?"?${table.name}"?\\s+([\\s\\S]*)`, 'i'));
    if (!alter) continue;
    for (const match of alter[1].matchAll(/ADD COLUMN\s+(?!IF\b)"?(\w+)"?/gi)) delete table.columns[match[1]];
  }
  for (const [name, fk] of Object.entries(table.foreignKeys)) {
    if (created.has(fk.tableTo) || fk.columnsFrom.some(column => !table.columns[column])) delete table.foreignKeys[name];
  }
  for (const [name, constraint] of Object.entries(table.uniqueConstraints)) {
    if (constraint.columns.some(column => !table.columns[column])) delete table.uniqueConstraints[name];
  }
  for (const [name, index] of Object.entries(table.indexes)) {
    if (index.columns.some(column => !table.columns[column.expression])) delete table.indexes[name];
  }
}
for (const match of sql.matchAll(/^CREATE TYPE\s+(?:public\.)?"?(\w+)"?/gmi)) delete snapshot.enums[`public.${match[1]}`];
snapshot.tables['public.production_jobs'].columns.station_id = { name: 'station_id', type: 'varchar', primaryKey: false, notNull: false };
snapshot.tables['public.stations'].columns.id.default = 'gen_random_uuid()::text';
const statements = await generateMigration(generateDrizzleJson({}), snapshot);
// Unique indexes used by foreign keys must exist before ALTER TABLE ADD FK.
statements.sort((a, b) => Number(a.startsWith('ALTER TABLE')) - Number(b.startsWith('ALTER TABLE')));
writeFileSync('node_modules/.cache/inbound-pg-validation/bootstrap.sql', statements.join(';\n') +
  ";\nINSERT INTO organizations (id,name,slug) VALUES ('inbound-bootstrap-test','Synthetic migration fixture','inbound-bootstrap-test');");
console.log(`Generated synthetic foundation: ${Object.keys(snapshot.tables).length} tables, no customer data or migration ledger.`);
