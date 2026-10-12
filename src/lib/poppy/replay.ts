import { createHash } from "node:crypto";
import { lte } from "drizzle-orm";
import { getDb } from "@/db";
import { poppyReplays } from "@/db/schema";

/** An insert, never a preflight read, decides whether this proof is fresh. */
export async function acceptPoppyReplay(
  purpose: "session" | "client" | "dpop",
  issuer: string,
  context: string,
  jti: string,
  expiresAt: Date,
): Promise<boolean> {
  const keyHash = createHash("sha256")
    .update(JSON.stringify([purpose, issuer, context, jti]))
    .digest("hex");
  const rows = await getDb()
    .insert(poppyReplays)
    .values({ keyHash, expiresAt })
    .onConflictDoNothing()
    .returning({ keyHash: poppyReplays.keyHash });
  return rows.length === 1;
}

export async function purgePoppyReplays(now = new Date()): Promise<void> {
  await getDb().delete(poppyReplays).where(lte(poppyReplays.expiresAt, now));
}
