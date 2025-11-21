import { db } from "./server/db";
import { users } from "./shared/schema";
import { eq } from "drizzle-orm";

async function verifyUserRole() {
  try {
    const email = "dale@titan-graphics.com";

    // Query using Drizzle ORM
    const [user] = await db.select().from(users).where(eq(users.email, email));

    console.log("User from Drizzle ORM:");
    console.log(JSON.stringify(user, null, 2));

    // Query using raw SQL
    const rawResult = await db.execute({
      sql: `SELECT id, email, first_name, last_name, is_admin, role, created_at, updated_at FROM users WHERE email = $1`,
      args: [email]
    });

    console.log("\nUser from raw SQL:");
    console.log(JSON.stringify(rawResult.rows[0], null, 2));

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

verifyUserRole();

