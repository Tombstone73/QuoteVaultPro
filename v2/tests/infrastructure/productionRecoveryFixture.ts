import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

// Disposable declared foreign-owner read schemas; actual ledger and Run DDL.
export async function productionRecoveryFixture(client: PoolClient, invariantSql: string) {
  await client.query(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
    INSERT INTO organizations VALUES('org-a'),('org-b'); INSERT INTO users VALUES('actor-a'),('actor-b');
    CREATE TABLE v2_production_works(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,order_line_id varchar,ordered_quantity integer,artwork_assignment_id varchar,artwork_file_id varchar,rework_cycle_id varchar,replacement_origin_production_work_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_artwork_assignments(id varchar PRIMARY KEY,organization_id varchar,artwork_file_id varchar,identity_fingerprint varchar,UNIQUE(id,organization_id,artwork_file_id));
    CREATE TABLE v2_artwork_files(id varchar PRIMARY KEY,organization_id varchar,object_version varchar);
    CREATE TABLE v2_order_line_material_requirements(organization_id varchar,order_line_id varchar,material_id varchar,unit varchar);
    CREATE TABLE v2_production_rework_cycles(id varchar,organization_id varchar,destination_station_key varchar);
    CREATE TABLE v2_sales_line_workflow_exceptions(organization_id varchar,order_line_id varchar,production_destination varchar);
    CREATE TABLE v2_route_instances(id varchar,organization_id varchar,order_document_id varchar,order_line_id varchar,current_step_id varchar);
    CREATE TABLE v2_route_instance_steps(id varchar,organization_id varchar,route_instance_id varchar,step_kind varchar,production_destination_station_key varchar);
    CREATE TABLE v2_production_work_events(organization_id varchar,production_work_id varchar,event_kind varchar,sequence integer);
    CREATE TABLE v2_production_attempts(id varchar PRIMARY KEY,organization_id varchar,production_work_id varchar,sequence integer,attempt_kind varchar,station_key varchar,good_quantity integer DEFAULT 0,waste_quantity integer DEFAULT 0,completed_at timestamptz,started_principal_kind varchar,started_principal_subject varchar,started_staff_actor_user_id varchar,completed_principal_kind varchar,completed_principal_subject varchar,completed_staff_actor_user_id varchar,UNIQUE(id,organization_id));
    CREATE UNIQUE INDEX production_fixture_active_attempt ON v2_production_attempts(organization_id,production_work_id) WHERE completed_at IS NULL;
    CREATE FUNCTION v2_usable_production_good_quantity(varchar,varchar) RETURNS integer LANGUAGE SQL AS 'SELECT COALESCE(sum(good_quantity),0)::integer FROM v2_production_attempts WHERE organization_id=$1 AND production_work_id=$2 AND completed_at IS NOT NULL';`);
  const migration = (name: string) => readFile(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
  const ledger = await migration("0180_v2_foundation_persistence.sql");
  await client.query(ledger.slice(ledger.indexOf("CREATE TABLE v2_operation_requests"), ledger.indexOf("CREATE TABLE v2_principal_attributions")));
  const runs = await migration("0279_v2_canonical_production_runs.sql");
  await client.query(runs.slice(runs.indexOf("CREATE TABLE v2_production_runs"), runs.indexOf("INSERT INTO v2_permission_capabilities")));
  if(invariantSql)await client.query(invariantSql);
  for (const id of ["work-a", "work-b"]) {
    await client.query("INSERT INTO v2_artwork_files VALUES($1,'org-a','version-a')", [`file-${id}`]);
    await client.query("INSERT INTO v2_artwork_assignments VALUES($1,'org-a',$2,$3)", [`art-${id}`, `file-${id}`, `sha256:${"a".repeat(64)}`]);
    await client.query("INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,ordered_quantity,artwork_assignment_id,artwork_file_id) VALUES($1,'org-a','order-a',$1,10,$2,$3)", [id, `art-${id}`, `file-${id}`]);
    await client.query("INSERT INTO v2_sales_line_workflow_exceptions VALUES('org-a',$1,'roll')", [id]);
  }
}
