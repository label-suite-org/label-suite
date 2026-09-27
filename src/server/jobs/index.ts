import { pool } from "../../lib/db";
import { PostgresJobStore } from "./postgres-store";

export * from "./core";
export * from "./types";
export * from "./worker";
export { PostgresJobStore } from "./postgres-store";

export const jobStore = new PostgresJobStore(pool);
