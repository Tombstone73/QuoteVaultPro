import { config } from "dotenv";
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "./shared/schema.js";
import { eq } from "drizzle-orm";

// Load environment variables
config();

// Setup Neon connection
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function fixUserRole() {
  try {
    const email = "dale@titan-graphics.com";
    
    const [updated] = await db
      .update(schema.users)
      .set({ 
        role: "owner",
        isAdmin: true 
      })
      .where(eq(schema.users.email, email))
      .returning();

    console.log("Updated user:", updated);
    
    if (!updated) {
      console.log("No user found with that email. Creating new user...");
      
      const [newUser] = await db
        .insert(schema.users)
        .values({
          id: `owner-${Date.now()}`,
          email: email,
          firstName: "Dale",
          lastName: "Owner",
          profileImageUrl: null,
          isAdmin: true,
          role: "owner"
        })
        .returning();
        
      console.log("Created new owner user:", newUser);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

fixUserRole();
