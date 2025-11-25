
import "dotenv/config";
import { db } from "./server/db";
import { orders } from "./shared/schema";

async function main() {
  console.log("Fetching orders...");
  const allOrders = await db.select().from(orders);
  console.log(`Found ${allOrders.length} orders.`);
  
  if (allOrders.length > 0) {
    console.log("Sample order:", allOrders[0]);
  }

  process.exit(0);
}

main().catch(console.error);
