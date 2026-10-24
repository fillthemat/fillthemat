import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Database } from "@/db/types";
import { hashToken } from "@/lib/crypto";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/request-limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import {
  appendMessage,
  claimGeneration,
  endConversationAtMessageLimit,
  findConversation,
  findOrCreateConversation,
  loadTranscript,
} from "./conversation-store";

vi.mock("server-only", () => ({}));
loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))
  throw new Error("Local database required");
const sql = authSql();
const ownerId = randomUUID();
const otherOwnerId = randomUUID();
let schoolId = "";
let otherSchoolId = "";
const anon = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
beforeAll(async () => {
  schoolId = (
    await seedPublicSchool(sql, {
      ownerId,
      slug: ownerId,
      name: "Chat",
      publishedAt: new Date(),
      offerings: [],
    })
  ).schoolId;
  otherSchoolId = (
    await seedPublicSchool(sql, {
      ownerId: otherOwnerId,
      slug: otherOwnerId,
      name: "Other",
      offerings: [],
    })
  ).schoolId;
});
afterAll(async () => {
  await deletePublicSchoolOwner(sql, ownerId);
  await deletePublicSchoolOwner(sql, otherOwnerId);
  await sql.end();
});

async function conversation(resumeToken = randomUUID()) {
  const result = await findOrCreateConversation({ schoolId, resumeToken });
  return { id: result.id, resumeToken };
}

it("allows service-only RPCs and denies anonymous reads, writes and forged replies", async () => {
  const current = await conversation();
  const client = anon();
  expect((await client.from("conversations").select()).error?.code).toBe("42501");
  expect((await client.from("messages").select()).error?.code).toBe("42501");
  expect(
    (
      await client.from("conversations").insert({
        school_id: schoolId,
        resume_token_hash: "forged",
        expires_at: new Date().toISOString(),
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await client
        .from("messages")
        .insert({ conversation_id: current.id, message_id: "forged", role: "assistant", parts: [] })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await client.rpc("resolve_web_conversation", {
        p_school_id: schoolId,
        p_token_hash: hashToken(current.resumeToken),
        p_now: new Date().toISOString(),
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await client.rpc("append_web_message", {
        p_school_id: schoolId,
        p_conversation_id: current.id,
        p_generation: new Date().toISOString(),
        p_id: randomUUID(),
        p_message_id: "forged",
        p_role: "assistant",
        p_parts: [],
        p_completion: "complete",
        p_now: new Date().toISOString(),
      })
    ).error?.code,
  ).toBe("42501");
});

it("settles concurrent first turns and replaces an expired conversation only once", async () => {
  const resumeToken = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => findOrCreateConversation({ schoolId, resumeToken })),
  );
  const ids = results.map((result) => result.id);
  expect(new Set(ids).size).toBe(1);
  await sql`UPDATE public.conversations SET expires_at = now() - interval '1 minute' WHERE id = ${ids[0]!}`;
  expect(await findConversation({ schoolId, resumeToken })).toBeNull();
  const replacements = await Promise.all(
    Array.from({ length: 4 }, () => conversation(resumeToken)),
  );
  expect(new Set(replacements.map(({ id }) => id)).size).toBe(1);
  expect(replacements[0]!.id).not.toBe(ids[0]);
  const [ended] =
    await sql`SELECT ended_at, end_reason FROM public.conversations WHERE id = ${ids[0]!}`;
  expect(ended!.ended_at).toBeInstanceOf(Date);
  expect(ended!.end_reason).toBe("inactivity");
});

it("scopes the same token to independent school conversations and transcripts", async () => {
  const resumeToken = randomUUID();
  const results = await Promise.all(
    [schoolId, otherSchoolId].map((schoolId) =>
      findOrCreateConversation({ schoolId, resumeToken }),
    ),
  );
  const first = results[0]!;
  const other = results[1]!;
  expect(first.id).not.toBe(other.id);
  expect(
    await sql`SELECT id FROM public.conversations WHERE resume_token_hash = ${hashToken(resumeToken)}`,
  ).toHaveLength(2);
  const lock = (await claimGeneration(schoolId, first.id))!;
  await appendMessage({
    id: randomUUID(),
    schoolId,
    conversationId: first.id,
    generation: lock.generation,
    messageId: "private",
    role: "user",
    parts: [{ type: "text", text: "Only the first school" }],
  });
  await lock.release();
  expect(await loadTranscript(otherSchoolId, first.id)).toEqual([]);
  expect(await loadTranscript(otherSchoolId, other.id)).toEqual([]);
  expect(await loadTranscript(schoolId, first.id)).toHaveLength(1);
  await sql`UPDATE public.conversations SET expires_at = now() - interval '1 minute' WHERE id = ${first.id}`;
  const replacement = await conversation(resumeToken);
  expect(replacement.id).not.toBe(first.id);
  expect(await findOrCreateConversation({ schoolId: otherSchoolId, resumeToken })).toEqual(other);
  expect(await findConversation({ schoolId: otherSchoolId, resumeToken })).toEqual(other);
  expect(await loadTranscript(schoolId, first.id)).toHaveLength(1);
});

it("claims one generation, recovers abandoned claims and fences stale saves/releases", async () => {
  const current = await conversation();
  const now = new Date();
  const claims = await Promise.all([
    claimGeneration(schoolId, current.id, now),
    claimGeneration(schoolId, current.id, now),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const original = claims.find(Boolean)!;
  expect(await claimGeneration(otherSchoolId, current.id)).toBeUndefined();
  const recovered = await claimGeneration(
    schoolId,
    current.id,
    new Date(now.getTime() + 11 * 60_000),
  );
  expect(recovered).toBeDefined();
  await original.release();
  await expect(
    appendMessage({
      id: randomUUID(),
      schoolId,
      conversationId: current.id,
      generation: original.generation,
      messageId: "stale",
      role: "assistant",
      parts: [],
    }),
  ).rejects.toMatchObject({ message: "generation_lost" });
  expect(await claimGeneration(schoolId, current.id)).toBeUndefined();
  await recovered!.release();
  const next = await claimGeneration(schoolId, current.id);
  expect(next).toBeDefined();
  await next!.release();
});

it("rechecks expiry after a concurrent deadline extension commits", async () => {
  const current = await conversation();
  await sql`UPDATE public.conversations SET expires_at = now() - interval '1 minute' WHERE id = ${current.id}`;
  const inspector = authSql();
  let resolving: ReturnType<typeof findOrCreateConversation> | undefined;
  try {
    await sql.begin(async (tx) => {
      // Simulate an accepted message extending the deadline while resolution
      // still sees the previously committed, expired version of this row.
      await tx`UPDATE public.conversations SET expires_at = now() + interval '30 days' WHERE id = ${current.id}`;
      resolving = findOrCreateConversation({ schoolId, resumeToken: current.resumeToken });
      await vi.waitFor(async () => {
        const blocked = await inspector`SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query LIKE '%resolve_web_conversation%'`;
        expect(blocked.length).toBeGreaterThan(0);
      });
    });
    expect(await resolving).toEqual({ id: current.id });
    expect(await findConversation({ schoolId, resumeToken: current.resumeToken })).toEqual({
      id: current.id,
    });
  } finally {
    await resolving;
    await inspector.end();
  }
});

it("saves transcripts idempotently, slides only accepted user deadlines, and isolates tenants", async () => {
  const current = await conversation();
  const lock = (await claimGeneration(schoolId, current.id))!;
  const input = {
    id: randomUUID(),
    schoolId,
    conversationId: current.id,
    generation: lock.generation,
    messageId: "user-1",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Hi" }],
  };
  await sql`UPDATE public.conversations SET expires_at = now() + interval '1 day' WHERE id = ${current.id}`;
  expect(await appendMessage(input)).toBe(input.id);
  const [accepted] =
    await sql`SELECT expires_at FROM public.conversations WHERE id = ${current.id}`;
  expect(accepted!.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  expect(await appendMessage({ ...input, id: randomUUID() })).toBeNull();
  expect(
    (await sql`SELECT expires_at FROM public.conversations WHERE id = ${current.id}`)[0]!
      .expires_at,
  ).toEqual(accepted!.expires_at);
  await appendMessage({
    ...input,
    id: randomUUID(),
    messageId: "reply-1",
    role: "assistant",
    completion: "aborted",
  });
  expect(await loadTranscript(schoolId, current.id)).toEqual([
    { id: "user-1", role: "user", parts: input.parts },
    { id: "reply-1", role: "assistant", parts: input.parts },
  ]);
  expect(await loadTranscript(otherSchoolId, current.id)).toEqual([]);
  expect(
    await findConversation({ schoolId: otherSchoolId, resumeToken: current.resumeToken }),
  ).toBeNull();
  await lock.release();
});

it("ends at the canonical message limit and preserves history on replacement", async () => {
  const current = await conversation();
  const lock = (await claimGeneration(schoolId, current.id))!;
  expect(
    await endConversationAtMessageLimit(schoolId, current.id, lock.generation, new Date()),
  ).toBe(false);
  for (let index = 0; index < MAX_CHAT_MESSAGES_PER_CONVERSATION; index++) {
    if (index === MAX_CHAT_MESSAGES_PER_CONVERSATION - 1) {
      expect(
        await endConversationAtMessageLimit(schoolId, current.id, lock.generation, new Date()),
      ).toBe(false);
    }
    await appendMessage({
      id: randomUUID(),
      schoolId,
      conversationId: current.id,
      generation: lock.generation,
      messageId: `m-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      parts: [],
    });
  }
  expect(
    await endConversationAtMessageLimit(schoolId, current.id, lock.generation, new Date()),
  ).toBe(true);
  await lock.release();
  expect(await findConversation({ schoolId, resumeToken: current.resumeToken })).toBeNull();
  const replacement = await conversation(current.resumeToken);
  expect(replacement.id).not.toBe(current.id);
  expect(await loadTranscript(schoolId, current.id)).toHaveLength(
    MAX_CHAT_MESSAGES_PER_CONVERSATION,
  );
  expect(await loadTranscript(schoolId, replacement.id)).toEqual([]);
});

it("rolls back a failed append without extending the inactivity deadline", async () => {
  const current = await conversation();
  const lock = (await claimGeneration(schoolId, current.id))!;
  const [before] = await sql`SELECT expires_at FROM public.conversations WHERE id = ${current.id}`;
  await expect(
    appendMessage({
      id: randomUUID(),
      schoolId,
      conversationId: current.id,
      generation: lock.generation,
      messageId: "invalid",
      role: "user",
      parts: [{ type: "text", text: "bad\u0000" }],
    }),
  ).rejects.toMatchObject({ code: "22P05" });
  expect(await loadTranscript(schoolId, current.id)).toEqual([]);
  expect(
    (await sql`SELECT expires_at FROM public.conversations WHERE id = ${current.id}`)[0]!
      .expires_at,
  ).toEqual(before!.expires_at);
  await lock.release();
});

it("rolls back the inserted message if extending the deadline fails", async () => {
  const current = await conversation();
  const lock = (await claimGeneration(schoolId, current.id))!;
  const name = `chat_deadline_${randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN RAISE EXCEPTION 'deadline_failed'; END; $$`,
  );
  await sql.unsafe(
    `CREATE TRIGGER ${name} BEFORE UPDATE OF expires_at ON public.conversations FOR EACH ROW WHEN (NEW.id = '${current.id}') EXECUTE FUNCTION public.${name}()`,
  );
  try {
    await expect(
      appendMessage({
        id: randomUUID(),
        schoolId,
        conversationId: current.id,
        generation: lock.generation,
        messageId: "atomic",
        role: "user",
        parts: [],
      }),
    ).rejects.toMatchObject({ message: "deadline_failed" });
    expect(await loadTranscript(schoolId, current.id)).toEqual([]);
  } finally {
    await sql.unsafe(`DROP TRIGGER ${name} ON public.conversations`);
    await sql.unsafe(`DROP FUNCTION public.${name}()`);
    await lock.release();
  }
});

it("has no elevated application functions", async () => {
  const { data, error } = await createAdminClient()
    .from("school_settings")
    .select("agent_instructions")
    .eq("school_id", schoolId)
    .single();
  expect(error).toBeNull();
  expect(data).toBeDefined();
  expect(
    await sql`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef`,
  ).toHaveLength(0);
  const permissions =
    await sql`SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS allowed
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('resolve_web_conversation', 'append_web_message', 'end_web_conversation_at_limit')`;
  expect(permissions).toHaveLength(3);
  expect(permissions.every((row) => !row.allowed)).toBe(true);
});
