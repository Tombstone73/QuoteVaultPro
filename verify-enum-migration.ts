import "dotenv/config";
import { pool } from "./server/db";

async function verifyEnum() {
  console.log("Verifying quote_status enum values...\n");
  
  try {
    // Query to get all enum values
    const result = await pool.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'quote_status')
      ORDER BY enumsortorder;
    `);
    
    console.log("Current quote_status enum values:");
    console.log("================================");
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.enumlabel}`);
    });
    console.log("");
    
    // Check if pending_approval exists
    const hasPendingApproval = result.rows.some(row => row.enumlabel === 'pending_approval');
    
    if (hasPendingApproval) {
      console.log("✅ SUCCESS: 'pending_approval' value exists in quote_status enum");
    } else {
      console.log("❌ ERROR: 'pending_approval' value NOT found in quote_status enum");
    }
    
  } catch (error) {
    console.error("Error verifying enum:", error);
  } finally {
    await pool.end();
  }
}

verifyEnum();
