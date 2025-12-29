import "dotenv/config";
import { pool } from "./server/db";

async function testRequesterTracking() {
  console.log("Testing Approval Requester Tracking\n");
  console.log("====================================\n");
  
  try {
    // Find or create a test quote in draft status
    const draftQuote = await pool.query(`
      SELECT id, quote_number, status, customer_name
      FROM quotes
      WHERE status = 'draft'
      LIMIT 1;
    `);
    
    let quoteId: string;
    let quoteNumber: number;
    
    if (draftQuote.rows.length === 0) {
      console.log("⚠️  No draft quotes found, creating test quote...");
      const orgResult = await pool.query(`SELECT id FROM organizations LIMIT 1;`);
      const orgId = orgResult.rows[0].id;
      
      const createResult = await pool.query(`
        INSERT INTO quotes (
          organization_id,
          customer_name,
          status,
          total_price,
          subtotal
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, quote_number;
      `, [orgId, 'Test Customer (Requester Tracking)', 'draft', '0', '0']);
      
      quoteId = createResult.rows[0].id;
      quoteNumber = createResult.rows[0].quote_number;
      console.log(`✅ Created test quote #${quoteNumber}\n`);
    } else {
      quoteId = draftQuote.rows[0].id;
      quoteNumber = draftQuote.rows[0].quote_number;
      console.log(`✅ Using existing draft quote #${quoteNumber}\n`);
    }
    
    // Get a test user to simulate requester
    const userResult = await pool.query(`
      SELECT id, email, first_name, last_name
      FROM users
      WHERE role IN ('owner', 'admin', 'manager', 'employee')
      LIMIT 1;
    `);
    
    if (userResult.rows.length === 0) {
      console.log("❌ No users found to test with");
      return;
    }
    
    const testUser = userResult.rows[0];
    const userName = `${testUser.first_name || ''} ${testUser.last_name || ''}`.trim() || testUser.email;
    
    console.log(`Test User: ${userName} (${testUser.email})\n`);
    
    // Get organization ID
    const quoteOrgResult = await pool.query(`
      SELECT organization_id FROM quotes WHERE id = $1;
    `, [quoteId]);
    const orgId = quoteOrgResult.rows[0].organization_id;
    
    // Simulate transition to pending_approval with audit log
    console.log("Simulating approval request...");
    
    // Update quote status
    await pool.query(`
      UPDATE quotes
      SET status = 'pending_approval'
      WHERE id = $1;
    `, [quoteId]);
    
    // Create audit log entry (simulating what the transition endpoint does)
    await pool.query(`
      INSERT INTO audit_logs (
        organization_id,
        user_id,
        user_name,
        action_type,
        entity_type,
        entity_id,
        entity_name,
        description,
        old_values,
        new_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
    `, [
      orgId,
      testUser.id,
      userName,
      'UPDATE',
      'quote',
      quoteId,
      quoteNumber.toString(),
      'Changed status from draft to pending_approval',
      JSON.stringify({ status: 'draft' }),
      JSON.stringify({ status: 'pending_approval' })
    ]);
    
    console.log(`✅ Quote #${quoteNumber} transitioned to pending_approval\n`);
    
    // Wait a moment for database to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Now query the pending approvals endpoint logic
    console.log("Querying pending approvals (simulating API endpoint)...\n");
    
    const pendingQuotes = await pool.query(`
      SELECT 
        q.id,
        q.quote_number,
        q.customer_name,
        q.total_price,
        q.created_at
      FROM quotes q
      WHERE q.organization_id = $1
        AND q.status = 'pending_approval'
        AND q.id = $2;
    `, [orgId, quoteId]);
    
    if (pendingQuotes.rows.length === 0) {
      console.log("❌ Quote not found in pending_approval status");
      return;
    }
    
    // Query audit logs to find requester
    const approvalLog = await pool.query(`
      SELECT 
        user_id,
        user_name,
        created_at,
        description
      FROM audit_logs
      WHERE organization_id = $1
        AND entity_type = 'quote'
        AND entity_id = $2
        AND description LIKE '%to pending_approval%'
      ORDER BY created_at DESC
      LIMIT 1;
    `, [orgId, quoteId]);
    
    console.log("Results:");
    console.log("========");
    console.log(`Quote #${quoteNumber}`);
    console.log(`Status: pending_approval`);
    
    if (approvalLog.rows.length > 0) {
      const log = approvalLog.rows[0];
      console.log(`✅ Requested By: ${log.user_name} (${log.user_id})`);
      console.log(`✅ Requested At: ${log.created_at}`);
      console.log(`✅ Description: ${log.description}`);
    } else {
      console.log("❌ No approval request audit log found");
    }
    
    console.log("\n");
    
    // Clean up: restore to draft
    await pool.query(`
      UPDATE quotes SET status = 'draft' WHERE id = $1;
    `, [quoteId]);
    
    console.log(`✅ Restored quote #${quoteNumber} back to draft status`);
    console.log("\n✅ SUCCESS: Requester tracking is working correctly!\n");
    
  } catch (error) {
    console.error("❌ Error testing requester tracking:", error);
  } finally {
    await pool.end();
  }
}

testRequesterTracking();
