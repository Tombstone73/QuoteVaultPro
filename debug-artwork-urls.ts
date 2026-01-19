/**
 * Debug script to check artwork URLs in database
 */
import { db } from "./server/db";
import { orderAttachments, orders, orderLineItems } from "@shared/schema";
import { eq } from "drizzle-orm";

async function debugArtworkUrls() {
  console.log("=== Checking Order Attachments ===\n");
  
  // Get attachments for order 31 (MotoGFX job)
  const attachments = await db
    .select()
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(eq(orders.orderNumber, 1027))
    .limit(10);

  console.log(`Found ${attachments.length} attachments for Order #1027:`);
  
  for (const row of attachments) {
    const a = row.order_attachments;
    console.log(`\n--- Attachment ID: ${a.id} ---`);
    console.log(`fileName: ${a.fileName}`);
    console.log(`fileUrl: ${a.fileUrl}`);
    console.log(`thumbnailUrl: ${a.thumbnailUrl || '(null)'}`);
    console.log(`thumbKey: ${a.thumbKey || '(null)'}`);
    console.log(`previewKey: ${a.previewKey || '(null)'}`);
    console.log(`thumbStatus: ${a.thumbStatus || '(null)'}`);
    console.log(`side: ${a.side || '(null)'}`);
    console.log(`orderLineItemId: ${a.orderLineItemId || '(null)'}`);
  }

  process.exit(0);
}

debugArtworkUrls().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
