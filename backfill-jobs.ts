
import "dotenv/config";
import { db } from "./server/db";
import { orders, orderLineItems, jobs, jobStatuses, products } from "./shared/schema";
import { eq, inArray } from "drizzle-orm";

async function main() {
  console.log("Starting backfill of jobs for existing orders...");

  // 1. Get all orders
  const allOrders = await db.select().from(orders);
  console.log(`Found ${allOrders.length} orders.`);

  // 2. Get all line items
  const allLineItems = await db.select().from(orderLineItems);
  console.log(`Found ${allLineItems.length} line items.`);

  // 3. Get all products to check requiresProductionJob
  const allProducts = await db.select().from(products);
  const productMap = new Map(allProducts.map(p => [p.id, p]));

  // 4. Get valid job statuses
  const statuses = await db.select().from(jobStatuses);
  const statusKeys = new Set(statuses.map(s => s.key));
  const defaultStatus = 'pending_prepress';

  let createdCount = 0;

  for (const item of allLineItems) {
    // Check if job already exists
    const existingJob = await db.select().from(jobs).where(eq(jobs.orderLineItemId, item.id));
    if (existingJob.length > 0) {
      continue;
    }

    // Check if product requires production job
    const product = productMap.get(item.productId);
    if (product && product.requiresProductionJob === false) {
      console.log(`Skipping line item ${item.id} (Product ${product.name} does not require production)`);
      continue;
    }

    // Find parent order
    const order = allOrders.find(o => o.id === item.orderId);
    if (!order) {
      console.warn(`Orphaned line item ${item.id} (Order ${item.orderId} not found)`);
      continue;
    }

    // Determine status
    let statusKey = defaultStatus;
    if (order.status === 'in_production' && statusKeys.has('in_production')) statusKey = 'in_production';
    if (order.status === 'completed' && statusKeys.has('complete')) statusKey = 'complete';
    if (order.status === 'scheduled' && statusKeys.has('queued_production')) statusKey = 'queued_production';

    // Create Job
    try {
      await db.insert(jobs).values({
        orderId: order.id,
        orderLineItemId: item.id,
        productType: item.productType || 'Unknown',
        statusKey: statusKey,
        priority: order.priority || 'normal',
        specsJson: item.specsJson,
        assignedToUserId: null,
        notesInternal: null,
      });
      createdCount++;
      process.stdout.write(".");
    } catch (err) {
      console.error(`\nFailed to create job for item ${item.id}:`, err);
    }
  }

  console.log(`\n\nBackfill complete. Created ${createdCount} jobs.`);
  process.exit(0);
}

main().catch(console.error);
