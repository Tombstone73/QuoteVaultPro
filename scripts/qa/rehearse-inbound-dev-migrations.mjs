/** DEV-only schema compatibility rehearsal. DDL is always rolled back. This is
 * not the canonical migrator and never writes/stamps a migration ledger. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const migrations = [
  ['0243_inbound_email_processing_jobs','3d717c4fa0e361c9f231eef9da8ff66bc930a98ce37c0c9e3a4c892bc66d4022'],
  ['0244_inbound_versioned_fingerprint_width','57d3632d25ef287c272d114012fc1953da9f3a50a4d65dbe9335696a99678c80'],
  ['0245_inbound_email_import_recovery','35638ac6fa9a54ba026a90cbf5c948db4e89a930e9ebb16fc245659fb8f778b9'],
  ['0246_inbound_gmail_acknowledgements','e3323c9cf840a30a8e75c2de3f1e14d38ca7415e506f96390830f3c51cc9e3b9'],
];
const tables = ['inbound_email_processing_jobs','inbound_email_import_jobs','inbound_gmail_acknowledgements'];
const hash = value => createHash('sha256').update(value).digest('hex');
const env = process.env;
let pool,client,stage='preflight';
try {
  const args=process.argv.slice(2);
  if (args[0]!=='--rollback-only' || !args[1] || args.length!==2) throw new Error('Explicit rollback-only directory required');
  if (env.APP_ENV!=='development' || env.NODE_ENV!=='production' || new URL(env.APP_PUBLIC_WEB_ORIGIN).origin!=='https://dev.printershero.com'
      || env.RAILWAY_ENVIRONMENT_ID!=='fd7aa163-90bc-49f2-ba9b-5b62bbe0283f'
      || env.RAILWAY_ENVIRONMENT_ID!==env.PRINTERSHERO_DEV_QA_APPROVED_RAILWAY_ENVIRONMENT_ID
      || env.WORKERS_ENABLED!=='false') throw new Error('DEV controls not confirmed');
  const app=new URL(env.DATABASE_URL),direct=new URL(env.MIGRATION_DATABASE_URL);
  const identity=[app.hostname.toLowerCase(),app.port||'5432',decodeURIComponent(app.username),decodeURIComponent(app.pathname.slice(1))].join('\n');
  if (`sha256:${hash(identity)}`!==env.PRINTERSHERO_DEV_QA_APPROVED_DATABASE_IDENTITY
      || app.hostname.replace('-pooler','')!==direct.hostname || app.pathname!==direct.pathname || app.username!==direct.username) throw new Error('Database binding mismatch');
  const sources=migrations.map(([tag,expected])=>{
    const source=readFileSync(path.join(args[1],`${tag}.sql`),'utf8').replaceAll('\r\n','\n');
    if(hash(source)!==expected) throw new Error('Migration SQL identity mismatch');
    return source;
  });
  stage='connect';
  neonConfig.webSocketConstructor=ws;
  pool=new Pool({connectionString:env.MIGRATION_DATABASE_URL});
  client=await pool.connect();
  const identityRow=(await client.query('select current_database() as name,current_user as role')).rows[0];
  if(identityRow.name!==decodeURIComponent(direct.pathname.slice(1)) || identityRow.role!==decodeURIComponent(direct.username)) throw new Error('Connected identity mismatch');
  stage='ledger-baseline';
  const ledgerBefore=(await client.query('select count(*)::int as count,max(created_at)::text as frontier from public.__drizzle_migrations_v2')).rows[0];
  if(ledgerBefore.frontier!=='1793491200000') throw new Error('DEV frontier changed; review target first');
  const existing=async()=> (await client.query('select name,to_regclass(name) as relation from unnest($1::text[]) t(name)',[tables.map(t=>'public.'+t)])).rows.filter(row=>row.relation);
  if((await existing()).length) throw new Error('Intake tables already exist; use deployed verification instead');
  stage='transaction-setup';
  await client.query('begin');
  await client.query("select set_config('lock_timeout','3s',true),set_config('statement_timeout','15s',true)");
  await client.query('select pg_advisory_xact_lock(928372001)');
  for(let i=0;i<sources.length;i++) {
    stage=migrations[i][0];
    await client.query(sources[i]);
    console.log(JSON.stringify({migration:migrations[i][0],ddlExecutedInsideRollback:true}));
  }
  stage='transaction-verification';
  if((await existing()).length!==tables.length) throw new Error('Missing rehearsal table');
  const width=(await client.query("select character_maximum_length as width from information_schema.columns where table_schema='public' and table_name='inbound_email_processing_jobs' and column_name='evidence_fingerprint'")).rows[0]?.width;
  if(width!==128) throw new Error('Fingerprint width mismatch');
  const indexes=(await client.query("select indexname from pg_indexes where schemaname='public' and tablename=any($1::text[])",[tables])).rows;
  const required=['inbound_email_processing_evidence_uidx','inbound_import_message_uidx','inbound_import_open_discovery_uidx','inbound_gmail_ack_evidence_uidx'];
  if(required.some(name=>!indexes.some(row=>row.indexname===name))) throw new Error('Required unique index missing');
  stage='rollback';
  await client.query('rollback');
  stage='post-rollback-verification';
  if((await existing()).length) throw new Error('Rollback left a table behind');
  const ledgerAfter=(await client.query('select count(*)::int as count,max(created_at)::text as frontier from public.__drizzle_migrations_v2')).rows[0];
  if(JSON.stringify(ledgerBefore)!==JSON.stringify(ledgerAfter)) throw new Error('Ledger changed');
  console.log(JSON.stringify({devSchemaRehearsal:'passed',transport:'deployed Neon',rolledBack:true,tablesRemainAbsent:true,ledgerUnchanged:true,ledger:ledgerAfter}));
} catch(error) {
  if(client) await client.query('rollback').catch(()=>{});
  console.error(JSON.stringify({devSchemaRehearsal:'failed',stage,code:typeof error?.code==='string'?error.code:'PREFLIGHT_REJECTED',detail:'No exception text or connection details logged; inspect target controls and migration identity.'}));
  process.exitCode=1;
} finally {
  client?.release();
  await pool?.end();
}
