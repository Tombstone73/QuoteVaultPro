import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M15PermissionPhysicalPostconditions, checkV2M15PermissionPhysicalPostconditions } from "../infrastructure/authorization/permissionPhysicalPostconditions.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";

/** Guarded physical verification only. Pool max 3 is the minimum for the later lock-holder plus two contenders rehearsal. */
async function main(): Promise<void> {
  const url=requireV2M0CloneDatabaseUrl(); const pool=new Pool({connectionString:url,max:3}); let client: Awaited<ReturnType<typeof pool.connect>>|undefined;
  try { client=await pool.connect(); assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client)); const findings=await checkV2M15PermissionPhysicalPostconditions(client); assertV2M15PermissionPhysicalPostconditions(findings); console.log("[m1.5-postgres] normalized permission-set catalog postconditions passed."); }
  finally { client?.release(); await pool.end(); }
}
main().catch((error:unknown)=>{console.error(`[m1.5-postgres] rehearsal failed: ${error instanceof Error ? error.message : "unknown failure"}`);process.exitCode=1;});
