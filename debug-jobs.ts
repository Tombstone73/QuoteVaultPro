import "dotenv/config";
import { db } from "./server/db";
import { jobs, jobStatuses } from "./shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Fetching job statuses...");
  const allStatuses = await db.select().from(jobStatuses);
  console.log("Statuses:", allStatuses.map(s => s.key));

  console.log("\nFetching jobs...");
  const allJobs = await db.select().from(jobs);
  console.log(`Found ${allJobs.length} jobs.`);
  
  allJobs.forEach(job => {
    console.log(`Job ID: ${job.id}, StatusKey: ${job.statusKey}`);
  });

  const validKeys = new Set(allStatuses.map(s => s.key));
  const invalidJobs = allJobs.filter(j => !validKeys.has(j.statusKey));

  if (invalidJobs.length > 0) {
    console.log(`\nWARNING: Found ${invalidJobs.length} jobs with invalid status keys!`);
    invalidJobs.forEach(j => console.log(`- Job ${j.id}: ${j.statusKey}`));
  } else {
    console.log("\nAll jobs have valid status keys.");
  }

  process.exit(0);
}

main().catch(console.error);
