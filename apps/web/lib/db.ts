import { Pool } from "pg";

let pool: Pool | undefined;

export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return (pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));
}
