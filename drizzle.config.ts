import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./server/db/migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
