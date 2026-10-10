import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 1 });
  return drizzle(client, { schema });
}

let cached: ReturnType<typeof createDb> | undefined;

export function getDb() {
  if (!cached) {
    cached = createDb();
  }
  return cached;
}

export type Database = ReturnType<typeof getDb>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type TransactionOptions = { transaction?: Transaction };

/** Join the caller's atomic write, or own a transaction for standalone use. */
export function withTransaction<T>(
  write: (transaction: Transaction) => Promise<T>,
  { transaction }: TransactionOptions = {},
): Promise<T> {
  return transaction ? write(transaction) : getDb().transaction(write);
}
