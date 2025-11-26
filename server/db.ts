import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@shared/schema";

// Configure Neon to use WebSocket in Node
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set (in your environment or .env file) before starting the server or running migrations."
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });
