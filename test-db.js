import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

console.log('Testing database connection...');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  console.log('Attempting to connect...');
  const client = await pool.connect();
  console.log('✅ Connected successfully!');
  
  const result = await client.query('SELECT NOW()');
  console.log('✅ Query successful:', result.rows[0]);
  
  client.release();
  await pool.end();
  console.log('✅ Connection closed');
  process.exit(0);
} catch (error) {
  console.error('❌ Connection failed:', error);
  process.exit(1);
}

