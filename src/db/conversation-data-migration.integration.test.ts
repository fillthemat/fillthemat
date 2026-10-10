import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
const sql = authSql();
afterAll(() => sql.end({ timeout: 5 }));

it("does not report historic transcript purges as ended conversations", async () => {
  // Exercise the unreleased migration chain in an isolated temporary schema.
  await sql.begin(async (tx) => {
    await tx`create schema migration_review_test`;
    await tx`create table migration_review_test.cron_runs (purged_count integer not null default 0)`;
    await tx`insert into migration_review_test.cron_runs values (12)`;
    await tx`create table migration_review_test.messages (purge_at timestamptz)`;
    await tx`create index messages_purge_at_idx on migration_review_test.messages (purge_at)`;
    for (const name of [
      "0008_conversation-data-contract",
      "0009_correct-ended-conversation-count",
    ]) {
      const migration = readFileSync(`drizzle/${name}.sql`, "utf8").replaceAll(
        '"app"',
        '"migration_review_test"',
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        await tx.unsafe(statement);
      }
    }
    expect(
      await tx`select ended_conversation_count from migration_review_test.cron_runs`,
    ).toEqual([{ ended_conversation_count: 0 }]);
    await tx`drop schema migration_review_test cascade`;
  });
});
