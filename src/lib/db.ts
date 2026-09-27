import "dotenv/config";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { createRequestScopedDatabase } from "./db-context";
import {
  applyDatabaseRequestContext,
  type DatabaseRequestContext,
} from "./database-request-context";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required. Set it in .env");
}

const pool = new Pool({ connectionString });

const rootDatabase = drizzle(pool, { schema });

const scopedDatabase = createRequestScopedDatabase<NodePgDatabase<typeof schema>, DatabaseRequestContext>(
  rootDatabase,
  applyDatabaseRequestContext,
);

export const db = scopedDatabase.database;
export const runWithDatabaseContext = scopedDatabase.run;
export type { DatabaseRequestContext } from "./database-request-context";
export { pool };
