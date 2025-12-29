import "dotenv/config";
import { pool } from "./server/db";

async function testApprovalsAPI() {
  console.log("Testing Approvals API - Full Integration\n");
  console.log("=========================================\n");
  
  try {
    // Get organization and user
    const orgResult = await pool.query(`SELECT id FROM organizations LIMIT 1;`);
    const orgId = orgResult.rows[0].id;
    
    const userResult = await pool.query(`
      SELECT id, email, first_name, last_name
      FROM users
      WHERE role IN ('owner', 'admin', 'manager', 'employee')
      LIMIT 1;
    `);
    const testUser = userResult.rows[0];
    const userName = `${testUser.first_name || ''} ${testUser.last_name || ''}`.trim() || testUser.email;
    
    // Create 2 test quotes in draft
    console.log("Creating test quotes...");
    
    // Get next quote number
    const nextNumResult = await pool.query(`
      SELECT COALESCE(MAX(quote_number), 0) + 1 as next_num FROM quotes WHERE organization_id = $1;
    `, [orgId]);
    let nextNum = nextNumResult.rows[0].next_num;
    
    const quote1 = await pool.query(`
      INSERT INTO quotes (
        organization_id,
        customer_name,
        status,
        total_price,
        subtotal,
        user_id,
        quote_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, quote_number;
    `, [orgId, 'Customer A', 'draft', '1250.00', '1250.00', testUser.id, nextNum]);
    
    const quote2 = await pool.query(`
      INSERT INTO quotes (
        organization_id,
        customer_name,
        status,
        total_price,
        subtotal,
        user_id,
        quote_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, quote_number;
    `, [orgId, 'Customer B', 'draft', '875.50', '875.50', testUser.id, nextNum + 1]);
    
    const q1Id = quote1.rows[0].id;
    const q1Num = quote1.rows[0].quote_number;
    const q2Id = quote2.rows[0].id;
    const q2Num = quote2.rows[0].quote_number;
    
    console.log(`✅ Created quote #${q1Num}`);
    console.log(`✅ Created quote #${q2Num}\n`);
    
    // Transition both to pending_approval with different timestamps
    console.log("Transitioning quotes to pending_approval...");
    
    // First quote - 5 minutes ago
    await pool.query(`UPDATE quotes SET status = 'pending_approval' WHERE id = $1;`, [q1Id]);
    await pool.query(`
      INSERT INTO audit_logs (
        organization_id, user_id, user_name, action_type, entity_type, entity_id, entity_name,
        description, old_values, new_values, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '5 minutes');
    `, [
      orgId, testUser.id, userName, 'UPDATE', 'quote', q1Id, q1Num.toString(),
      'Changed status from draft to pending_approval',
      JSON.stringify({ status: 'draft' }),
      JSON.stringify({ status: 'pending_approval' })
    ]);
    
    // Second quote - 2 minutes ago
    await pool.query(`UPDATE quotes SET status = 'pending_approval' WHERE id = $1;`, [q2Id]);
    await pool.query(`
      INSERT INTO audit_logs (
        organization_id, user_id, user_name, action_type, entity_type, entity_id, entity_name,
        description, old_values, new_values, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '2 minutes');
    `, [
      orgId, testUser.id, userName, 'UPDATE', 'quote', q2Id, q2Num.toString(),
      'Changed status from draft to pending_approval',
      JSON.stringify({ status: 'draft' }),
      JSON.stringify({ status: 'pending_approval' })
    ]);
    
    console.log(`✅ Quote #${q1Num} → pending_approval (5 min ago)`);
    console.log(`✅ Quote #${q2Num} → pending_approval (2 min ago)\n`);
    
    // Simulate API query (the logic from the endpoint)
    console.log("Simulating GET /api/quotes/pending-approvals...\n");
    
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
        AND q.id IN ($2, $3)
      ORDER BY q.created_at DESC;
    `, [orgId, q1Id, q2Id]);
    
    const quoteIds = pendingQuotes.rows.map((q: any) => q.id);
    
    const approvalLogs = await pool.query(`
      SELECT 
        entity_id,
        user_id,
        user_name,
        created_at
      FROM audit_logs
      WHERE organization_id = $1
        AND entity_type = 'quote'
        AND entity_id = ANY($2::text[])
        AND description LIKE '%to pending_approval%'
      ORDER BY created_at DESC;
    `, [orgId, quoteIds]);
    
    // Build requester map
    const requestersMap = new Map();
    for (const log of approvalLogs.rows) {
      if (!requestersMap.has(log.entity_id)) {
        requestersMap.set(log.entity_id, {
          userName: log.user_name,
          userId: log.user_id,
          requestedAt: log.created_at,
        });
      }
    }
    
    console.log("API Response (formatted):");
    console.log("=========================\n");
    
    for (const quote of pendingQuotes.rows) {
      const requester = requestersMap.get(quote.id);
      console.log(`Quote #${quote.quote_number}`);
      console.log(`  Customer: ${quote.customer_name}`);
      console.log(`  Total: $${Number(quote.total_price).toFixed(2)}`);
      console.log(`  Requested By: ${requester?.userName || 'Unknown'}`);
      console.log(`  Requested At: ${requester?.requestedAt || quote.created_at}`);
      console.log(``);
    }
    
    // Verify both quotes are tracked
    if (pendingQuotes.rows.length === 2) {
      console.log("✅ SUCCESS: Both quotes found with requester information");
    } else {
      console.log(`❌ ERROR: Expected 2 quotes, found ${pendingQuotes.rows.length}`);
    }
    
    // Verify requester info is present
    let allHaveRequesters = true;
    for (const quote of pendingQuotes.rows) {
      if (!requestersMap.has(quote.id)) {
        console.log(`❌ ERROR: Quote #${quote.quote_number} missing requester info`);
        allHaveRequesters = false;
      }
    }
    
    if (allHaveRequesters) {
      console.log("✅ SUCCESS: All quotes have requester information tracked");
    }
    
    // Clean up
    console.log("\nCleaning up test data...");
    await pool.query(`DELETE FROM audit_logs WHERE entity_id IN ($1, $2);`, [q1Id, q2Id]);
    await pool.query(`DELETE FROM quotes WHERE id IN ($1, $2);`, [q1Id, q2Id]);
    console.log("✅ Test data cleaned up\n");
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await pool.end();
  }
}

testApprovalsAPI();
