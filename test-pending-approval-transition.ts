import "dotenv/config";
import { pool } from "./server/db";

async function testTransition() {
  console.log("Testing quote status transition to pending_approval...\n");
  
  try {
    // Find a draft quote to test with
    const draftQuote = await pool.query(`
      SELECT id, quote_number, status, customer_name
      FROM quotes
      WHERE status = 'draft'
      LIMIT 1;
    `);
    
    if (draftQuote.rows.length === 0) {
      console.log("⚠️  No draft quotes found to test with");
      console.log("Creating a test quote...");
      
      // Get default organization
      const orgResult = await pool.query(`
        SELECT id FROM organizations LIMIT 1;
      `);
      
      if (orgResult.rows.length === 0) {
        console.log("❌ No organizations found in database");
        return;
      }
      
      const orgId = orgResult.rows[0].id;
      
      // Create a test quote
      const createResult = await pool.query(`
        INSERT INTO quotes (
          organization_id,
          customer_name,
          status,
          total_price,
          subtotal
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, quote_number, status, customer_name;
      `, [orgId, 'Test Customer (Migration Verification)', 'draft', '0', '0']);
      
      console.log(`✅ Created test quote #${createResult.rows[0].quote_number}\n`);
      
      // Now test the transition
      await pool.query(`
        UPDATE quotes
        SET status = 'pending_approval'
        WHERE id = $1;
      `, [createResult.rows[0].id]);
      
      // Verify the update
      const verifyResult = await pool.query(`
        SELECT id, quote_number, status
        FROM quotes
        WHERE id = $1;
      `, [createResult.rows[0].id]);
      
      console.log("Transition Test Results:");
      console.log("========================");
      console.log(`Quote Number: ${verifyResult.rows[0].quote_number}`);
      console.log(`Previous Status: draft`);
      console.log(`New Status: ${verifyResult.rows[0].status}`);
      console.log("");
      
      if (verifyResult.rows[0].status === 'pending_approval') {
        console.log("✅ SUCCESS: Quote successfully transitioned to pending_approval status");
      } else {
        console.log("❌ ERROR: Transition failed");
      }
      
    } else {
      const quote = draftQuote.rows[0];
      console.log(`Found draft quote #${quote.quote_number}`);
      console.log(`Customer: ${quote.customer_name || 'N/A'}\n`);
      
      // Test transition
      await pool.query(`
        UPDATE quotes
        SET status = 'pending_approval'
        WHERE id = $1;
      `, [quote.id]);
      
      // Verify
      const verifyResult = await pool.query(`
        SELECT status FROM quotes WHERE id = $1;
      `, [quote.id]);
      
      console.log("Transition Test Results:");
      console.log("========================");
      console.log(`Quote Number: ${quote.quote_number}`);
      console.log(`Previous Status: draft`);
      console.log(`New Status: ${verifyResult.rows[0].status}`);
      console.log("");
      
      if (verifyResult.rows[0].status === 'pending_approval') {
        console.log("✅ SUCCESS: Quote successfully transitioned to pending_approval status");
        
        // Restore to draft
        await pool.query(`
          UPDATE quotes SET status = 'draft' WHERE id = $1;
        `, [quote.id]);
        console.log(`ℹ️  Restored quote #${quote.quote_number} back to draft status`);
      } else {
        console.log("❌ ERROR: Transition failed");
      }
    }
    
  } catch (error) {
    console.error("Error testing transition:", error);
  } finally {
    await pool.end();
  }
}

testTransition();
