import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

const { Pool } = pg;
const poolSymbol = Symbol.for("zaffa.neon.pool");

export function getPool() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("DATABASE_URL is not configured");
    error.code = "DATABASE_URL_MISSING";
    throw error;
  }

  if (!globalThis[poolSymbol]) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 8_000,
      keepAlive: true
    });
    attachDatabasePool(pool);
    globalThis[poolSymbol] = pool;
  }

  return globalThis[poolSymbol];
}
