import { Pool } from "pg";

let pool: Pool | undefined;

export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // DB_POOL_MAX: lower it for a database with a small connection limit (the local test DB takes one connection)
  return (pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) || 10 }));
}
