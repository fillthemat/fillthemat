import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { connectionTransport, sendConnectionTypingIndicator } from "./connection-transport";
import { liveWhatsAppConnection, resolveWhatsAppToken } from "./connections";
import { encryptWhatsAppSecret } from "./encryption";
import { publicSchoolIdForPhone } from "./queue-store";
import { setWhatsAppSignupState } from "./signup";

vi.mock("server-only", () => ({}));
loadLocalEnv();
const sql = authSql();
const owner = randomUUID();
const otherOwner = randomUUID();
const school = randomUUID();
const otherSchool = randomUUID();
const phone = randomUUID();
const otherPhone = randomUUID();
const key = randomBytes(32).toString("base64");
const originalKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;

beforeAll(async () => {
  for (const [userId, schoolId, phoneId] of [
    [owner, school, phone],
    [otherOwner, otherSchool, otherPhone],
  ]) {
    await insertAuthUser(sql, userId!, `${userId}@local.test`);
    await sql`INSERT INTO public.users (id, email) VALUES (${userId!}, ${`${userId}@local.test`})`;
    await sql`INSERT INTO public.schools (id, slug, timezone, approved_at, published_at) VALUES (${schoolId!}, ${schoolId!}, 'UTC', now(), now())`;
    await sql`INSERT INTO public.school_settings (school_id, owner_user_id) VALUES (${schoolId!}, ${userId!})`;
    await sql`INSERT INTO public.whatsapp_connections (school_id, phone_number_id, state) VALUES (${schoolId!}, ${phoneId!}, 'live')`;
  }
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = key;
});

afterAll(async () => {
  if (originalKey === undefined) delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  else process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = originalKey;
  await deleteAuthUser(sql, owner);
  await deleteAuthUser(sql, otherOwner);
  await sql.end({ timeout: 5 });
});

it("owners read only their own connection, cannot write it, and cannot read any secrets", async () => {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('request.jwt.claim.sub', ${owner}, true)`;
    const rows =
      await tx`SELECT school_id FROM public.whatsapp_connections WHERE school_id IN (${school}, ${otherSchool})`;
    expect(rows.map((row) => row.school_id)).toEqual([school]);
  });
  for (const statement of [
    "SELECT * FROM public.whatsapp_connection_secrets",
    `UPDATE public.whatsapp_connections SET state = 'live' WHERE school_id = '${school}'`,
    `DELETE FROM public.whatsapp_connections WHERE school_id = '${school}'`,
    `INSERT INTO public.whatsapp_connections (school_id) VALUES ('${randomUUID()}')`,
    "SELECT public.finish_whatsapp_signup(NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
  ]) {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claim.sub', ${owner}, true)`;
        await tx.unsafe(statement);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  }
  await expect(
    sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE anon`;
      await tx`SELECT * FROM public.whatsapp_connections`;
    }),
  ).rejects.toMatchObject({ code: "42501" });
});

it("routes live numbers only, ignoring unknown numbers and every non-live state", async () => {
  expect(await publicSchoolIdForPhone(phone)).toBe(school);
  expect(await publicSchoolIdForPhone(randomUUID())).toBeNull();
  for (const state of [
    "off",
    "popup",
    "cancelled",
    "popup-failed",
    "registering",
    "failed",
    "broken-card",
  ]) {
    await sql`UPDATE public.whatsapp_connections SET state = ${state} WHERE school_id = ${school}`;
    expect(await publicSchoolIdForPhone(phone)).toBeNull();
    expect(await liveWhatsAppConnection(phone)).toBeNull();
  }
  await sql`UPDATE public.whatsapp_connections SET state = 'live' WHERE school_id = ${school}`;
});

it("commits secrets with live state and resolves the business token for all four Graph operations", async () => {
  await sql`UPDATE public.whatsapp_connections SET state = 'registering' WHERE school_id = ${school}`;
  const { error } = await createAdminClient().rpc("finish_whatsapp_signup", {
    p_school_id: school,
    p_phone_number_id: phone,
    p_waba_id: "123",
    p_display_phone_number: "+15550000000",
    p_verified_name: "Dojo",
    p_encrypted_token: encryptWhatsAppSecret("school-business-token", school, key),
    p_encrypted_pin: encryptWhatsAppSecret("123456", school, key),
  });
  expect(error).toBeNull();
  expect(await publicSchoolIdForPhone(phone)).toBe(school);
  expect(await resolveWhatsAppToken(school)).toBe("school-business-token");
  const graphFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    // Let Supabase resolve connections/secrets; intercept only Graph.
    if (String(url).includes("graph.facebook.com")) {
      expect(init?.headers).toMatchObject({ authorization: "Bearer school-business-token" });
      return Response.json({ messages: [{ id: "wamid.sent" }], success: true });
    }
    return originalFetch(url, init);
  });
  const common = { schoolId: school, phoneNumberId: phone, to: "15550000000" };
  try {
    expect((await connectionTransport.sendText({ ...common, text: "Hello" })).ok).toBe(true);
    expect(
      (
        await connectionTransport.sendTemplate({
          ...common,
          templateName: "booking_confirmation",
          languageCode: "en",
          params: [],
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await connectionTransport.sendInteractive({
          ...common,
          body: "Confirm?",
          buttons: [{ id: "yes", title: "Yes" }],
        })
      ).ok,
    ).toBe(true);
    expect(
      (await sendConnectionTypingIndicator({ phoneNumberId: phone, messageId: "wamid.inbound" }))
        .ok,
    ).toBe(true);
  } finally {
    graphFetch.mockRestore();
  }
});
const originalFetch = globalThis.fetch;

it("payment error 131042 moves the connection to broken-card and stops subsequent sends", async () => {
  let graphCalls = 0;
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes("graph.facebook.com")) {
      graphCalls++;
      return Response.json({ error: { code: 131042, message: "Payment issue" } }, { status: 400 });
    }
    return originalFetch(url, init);
  });
  try {
    const input = { schoolId: school, phoneNumberId: phone, to: "15550000000", text: "Hello" };
    expect(await connectionTransport.sendText(input)).toMatchObject({ ok: false, code: 131042 });
    const [row] =
      await sql`SELECT state, failure_code FROM public.whatsapp_connections WHERE school_id = ${school}`;
    expect(row).toMatchObject({ state: "broken-card", failure_code: "payment_131042" });
    expect(await connectionTransport.sendText(input)).toMatchObject({
      ok: false,
      message: "whatsapp_connection_not_live",
    });
    expect(graphCalls).toBe(1);
  } finally {
    mock.mockRestore();
  }
});

it("the generated migration backfills pilot IDs as live/rented before dropping old columns", async () => {
  const migration = readFileSync("supabase/migrations/20261124030231_declarative_sync.sql", "utf8");
  const backfill = requireRow(
    migration.match(
      /INSERT INTO public\.whatsapp_connections \(school_id, phone_number_id, waba_id, state, number_source\)[\s\S]*?;/,
    )?.[0],
    "backfill",
  );
  expect(migration.indexOf(backfill)).toBeLessThan(
    migration.indexOf("DROP COLUMN whatsapp_phone_number_id"),
  );
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE pilot_settings (school_id uuid, whatsapp_phone_number_id text, whatsapp_waba_id text) ON COMMIT DROP`;
    await tx`CREATE TEMP TABLE pilot_connections (LIKE public.whatsapp_connections INCLUDING CONSTRAINTS INCLUDING DEFAULTS) ON COMMIT DROP`;
    await tx`INSERT INTO pilot_settings VALUES (${school}, 'pilot-phone', 'pilot-waba'), (${otherSchool}, NULL, NULL)`;
    await tx.unsafe(
      backfill
        .replace("public.whatsapp_connections", "pilot_connections")
        .replace("public.school_settings", "pilot_settings"),
    );
    const rows =
      await tx`SELECT school_id, phone_number_id, waba_id, state, number_source FROM pilot_connections`;
    expect(rows).toEqual([
      {
        school_id: school,
        phone_number_id: "pilot-phone",
        waba_id: "pilot-waba",
        state: "live",
        number_source: "rented",
      },
    ]);
  });
});

it("guards popup and failure transitions for live/registering connections, including direct library calls", async () => {
  for (const state of ["live", "registering"]) {
    await sql`UPDATE public.whatsapp_connections SET state = ${state} WHERE school_id = ${school}`;
    for (const popup of ["popup", "cancelled", "popup-failed"] as const) {
      await expect(setWhatsAppSignupState(school, popup)).rejects.toThrow("signup_state_locked");
    }
    const [row] =
      await sql`SELECT state FROM public.whatsapp_connections WHERE school_id = ${school}`;
    expect(row?.state).toBe(state);
  }
  await setWhatsAppSignupState(school, "failed", "register_failed");
  await setWhatsAppSignupState(school, "popup");
  await setWhatsAppSignupState(school, "failed", "late_cleanup");
  const [row] =
    await sql`SELECT state FROM public.whatsapp_connections WHERE school_id = ${school}`;
  expect(row?.state).toBe("popup");
});

it("atomically rejects a second signup claim and a phone owned by another school", async () => {
  await sql`UPDATE public.whatsapp_connections SET state = 'off' WHERE school_id = ${school}`;
  const claim = () =>
    createAdminClient()
      .rpc("claim_whatsapp_signup", {
        p_school_id: school,
        p_phone_number_id: phone,
      })
      .throwOnError();
  const results = await Promise.all([claim(), claim()]);
  expect(results.map((result) => result.data).sort()).toEqual(["claimed", "signup_in_progress"]);
  await sql`UPDATE public.whatsapp_connections SET state = 'live' WHERE school_id = ${school}`;
  expect((await claim()).data).toBe("connection_live");
  await setWhatsAppSignupState(school, "failed", "late_cleanup");
  expect(await publicSchoolIdForPhone(phone)).toBe(school);
  await sql`UPDATE public.whatsapp_connections SET state = 'off' WHERE school_id = ${school}`;
  const conflict = await createAdminClient()
    .rpc("claim_whatsapp_signup", {
      p_school_id: school,
      p_phone_number_id: otherPhone,
    })
    .throwOnError();
  expect(conflict.data).toBe("phone_number_in_use");
});

it("finish signup rejects every state other than registering without modifying secrets", async () => {
  for (const state of [
    "off",
    "popup",
    "cancelled",
    "popup-failed",
    "failed",
    "live",
    "broken-card",
  ]) {
    await sql`UPDATE public.whatsapp_connections SET state = ${state} WHERE school_id = ${school}`;
    const { error } = await createAdminClient().rpc("finish_whatsapp_signup", {
      p_school_id: school,
      p_phone_number_id: phone,
      p_waba_id: "123",
      p_display_phone_number: "+15550000000",
      p_verified_name: "Dojo",
      p_encrypted_token: "must-not-save",
      p_encrypted_pin: "must-not-save",
    });
    expect(error?.message).toBe("signup_not_registering");
    const [row] =
      await sql`SELECT encrypted_pin FROM public.whatsapp_connection_secrets WHERE school_id = ${school}`;
    expect(row?.encrypted_pin).not.toBe("must-not-save");
  }
});

it("rejects a transport school mismatch without sending or resolving a token", async () => {
  await sql`UPDATE public.whatsapp_connections SET state = 'live' WHERE school_id = ${school}`;
  const graph = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes("graph.facebook.com")) throw new Error("must_not_send");
    return originalFetch(url, init);
  });
  try {
    expect(
      await connectionTransport.sendText({
        schoolId: otherSchool,
        phoneNumberId: phone,
        to: "15550000000",
        text: "Wrong school",
      }),
    ).toMatchObject({ ok: false, message: "whatsapp_connection_school_mismatch" });
    expect(
      graph.mock.calls.some(
        ([url]) =>
          String(url).includes("whatsapp_connection_secrets") ||
          String(url).includes("graph.facebook.com"),
      ),
    ).toBe(false);
  } finally {
    graph.mockRestore();
  }
});

async function abandonSignup() {
  // Only fixture setup may bypass the timestamp trigger to simulate a dead process.
  await sql.begin(async (tx) => {
    await tx`ALTER TABLE public.whatsapp_connections DISABLE TRIGGER whatsapp_connections_set_updated_at`;
    await tx`UPDATE public.whatsapp_connections SET state = 'registering',
      updated_at = statement_timestamp() - interval '11 minutes' WHERE school_id = ${school}`;
    await tx`ALTER TABLE public.whatsapp_connections ENABLE TRIGGER whatsapp_connections_set_updated_at`;
  });
}

it("reclaims an abandoned signup, preserves the same number's PIN, and rejects a fresh claim", async () => {
  await sql`UPDATE public.whatsapp_connections SET phone_number_id = ${phone} WHERE school_id = ${school}`;
  await sql`INSERT INTO public.whatsapp_connection_secrets (school_id, encrypted_token, encrypted_pin)
    VALUES (${school}, 'saved-token', 'saved-pin') ON CONFLICT (school_id)
    DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token, encrypted_pin = EXCLUDED.encrypted_pin`;
  await abandonSignup();
  const claim = () =>
    createAdminClient()
      .rpc("claim_whatsapp_signup", {
        p_school_id: school,
        p_phone_number_id: phone,
      })
      .throwOnError();
  expect((await claim()).data).toBe("claimed");
  const [row] =
    await sql`SELECT state, updated_at > statement_timestamp() - interval '1 minute' AS fresh
    FROM public.whatsapp_connections WHERE school_id = ${school}`;
  expect(row).toMatchObject({ state: "registering", fresh: true });
  const [secret] =
    await sql`SELECT encrypted_pin FROM public.whatsapp_connection_secrets WHERE school_id = ${school}`;
  expect(secret?.encrypted_pin).toBe("saved-pin");
  expect((await claim()).data).toBe("signup_in_progress");
});

it("checks number ownership on stale reclaim and clears credentials only when the number changes", async () => {
  await abandonSignup();
  const conflict = await createAdminClient()
    .rpc("claim_whatsapp_signup", {
      p_school_id: school,
      p_phone_number_id: otherPhone,
    })
    .throwOnError();
  expect(conflict.data).toBe("phone_number_in_use");
  const newPhone = randomUUID();
  const reclaimed = await createAdminClient()
    .rpc("claim_whatsapp_signup", {
      p_school_id: school,
      p_phone_number_id: newPhone,
    })
    .throwOnError();
  expect(reclaimed.data).toBe("claimed");
  expect(
    await sql`SELECT school_id FROM public.whatsapp_connection_secrets WHERE school_id = ${school}`,
  ).toHaveLength(0);
  // A late completion from the abandoned, different-number attempt cannot go live.
  const finish = (phoneNumberId: string) =>
    createAdminClient().rpc("finish_whatsapp_signup", {
      p_school_id: school,
      p_phone_number_id: phoneNumberId,
      p_waba_id: "123",
      p_display_phone_number: "+15550000000",
      p_verified_name: "Dojo",
      p_encrypted_token: "new-token",
      p_encrypted_pin: "new-pin",
    });
  expect((await finish(phone)).error?.message).toBe("signup_not_registering");
  expect((await finish(newPhone)).error).toBeNull();
  expect(await publicSchoolIdForPhone(newPhone)).toBe(school);
});

it("allows popup-state writes over abandoned registering claims, but not fresh ones", async () => {
  for (const popup of ["popup", "cancelled", "popup-failed"] as const) {
    await sql`UPDATE public.whatsapp_connections SET state = 'registering' WHERE school_id = ${school}`;
    await expect(setWhatsAppSignupState(school, popup)).rejects.toThrow("signup_state_locked");
    await abandonSignup();
    await setWhatsAppSignupState(school, popup);
    const [row] =
      await sql`SELECT state FROM public.whatsapp_connections WHERE school_id = ${school}`;
    expect(row?.state).toBe(popup);
  }
});
