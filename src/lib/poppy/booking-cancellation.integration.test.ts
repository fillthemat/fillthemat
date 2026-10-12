import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { cancelPersonalAgentBookingAction } from "@/app/poppy/bookings/[bookingId]/cancel/actions";
import CancelPage from "@/app/poppy/bookings/[bookingId]/cancel/page";
import { getDb } from "@/db";
import { schools, trialWindows } from "@/db/schema";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
import type { EmailMessage } from "@/lib/email/dependencies";
import { bookSlot, cancelBooking } from "@/lib/schedule/book-slot";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

loadLocalEnv(process.env.INTEGRATION_ENV_FILE);
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Cancel-link tests require a local database");
const admin = authSql();
const databaseName = `poppy_cancel_${randomUUID().replaceAll("-", "")}`;
url.pathname = `/${databaseName}`;
const sql = postgres(url.toString(), { max: 1 });
let created = false;
const schoolId = randomUUID();
const offeringId = randomUUID();
let number = 0;
beforeAll(async () => {
  await admin.unsafe(`create database "${databaseName}"`);
  created = true;
  await sql`create schema auth`;
  await sql`create table auth.users (id uuid primary key)`;
  for (const migration of readMigrationFiles({ migrationsFolder: "drizzle" }))
    await sql.begin(async (tx) => {
      for (const statement of migration.sql) await tx.unsafe(statement);
    });
  vi.stubEnv("DATABASE_URL", url.toString());
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.fillthemat.example");
  vi.stubEnv(
    "POPPY_CANCEL_LINK_SECRET",
    "cancel-test-secret-at-least-32-characters",
  );
  vi.stubEnv("RESEND_API_KEY", "");
  const owner = randomUUID();
  await sql`insert into auth.users (id) values (${owner})`;
  await sql`insert into app.users (id, email) values (${owner}, 'owner@local.test')`;
  await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${schoolId}, ${owner}, 'cancel-test', 'Cancel School', 'America/New_York', 'owner@local.test', now(), now())`;
  await sql`insert into app.trial_offerings (id, school_id, name) values (${offeringId}, ${schoolId}, 'Trial')`;
  await getDb()
    .insert(trialWindows)
    .values(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        schoolId,
        trialOfferingId: offeringId,
        dayOfWeek,
        startMinute: 1020,
        durationMinutes: 60,
        capacity: 20,
      })),
    );
}, 60000);
afterAll(async () => {
  await sql.end({ timeout: 5 });
  if (created)
    await admin.unsafe(`drop database "${databaseName}" with (force)`);
  await admin.end({ timeout: 5 });
  vi.unstubAllEnvs();
}, 60000);

async function booking(
  channel: "web" | "whatsapp" | "poppy" = "poppy",
  failConfirmation = false,
) {
  const db = getDb();
  const school = requireRow(
    (await db.select().from(schools).where(eq(schools.id, schoolId)))[0],
    "school",
  );
  const windows = await db
    .select()
    .from(trialWindows)
    .where(eq(trialWindows.schoolId, schoolId));
  const slot = requireRow(
    listOpenSlots({
      offeringId,
      timezone: school.timezone,
      windows,
      occurrences: [],
      now: new Date(),
    })[0],
    "trial",
  );
  const input = {
    school,
    channel,
    offeringId,
    slotId: slot.slotId,
    idempotencyKey: randomUUID(),
    contact: {
      name: "Contact",
      email: `${randomUUID()}@local.test`,
      phone: `1650777${++number}`,
    },
    participant: { name: "Participant", age: 8 },
  };
  const result = await bookSlot(input);
  if (!result.ok) throw new Error(result.code);
  const messages: EmailMessage[] = [];
  await attemptPendingForBooking(result.booking.id, {
    transport: {
      send: async (message) => {
        messages.push(message);
        if (
          failConfirmation &&
          message.to === result.booking.contactEmailSnapshot
        )
          return {
            ok: false,
            kind: "internal",
            reason: "network_error",
            message: "temporary network failure",
          };
        return { ok: true, kind: "accepted", providerId: randomUUID() };
      },
    },
  });
  return { row: result.booking, input, messages };
}

it("Poppy confirmations include a durable cancel link, while web and WhatsApp emails are unchanged", async () => {
  const poppy = await booking();
  const email = requireRow(
    poppy.messages.find(
      (message) => message.to === poppy.row.contactEmailSnapshot,
    ),
    "confirmation",
  );
  expect(email.text).toContain("Not you? Cancel this booking:");
  expect(email.text).toContain(
    `https://app.fillthemat.example/poppy/bookings/${poppy.row.id}/cancel?token=`,
  );
  expect(
    poppy.messages.find((message) => message.to === "owner@local.test")?.text,
  ).not.toContain("?token=");
  for (const channel of ["web", "whatsapp"] as const) {
    const other = await booking(channel);
    expect(
      other.messages.every((message) => !message.text.includes("?token=")),
    ).toBe(true);
  }
});

function link(fixture: Awaited<ReturnType<typeof booking>>) {
  const email = requireRow(
    fixture.messages.find(
      (message) => message.to === fixture.row.contactEmailSnapshot,
    ),
    "confirmation",
  );
  return new URL(
    requireRow(
      email.text.match(/https:\/\/[^\s]+\/cancel\?token=[^\s]+/)?.[0],
      "cancel link",
    ),
  );
}
function form(token: string) {
  const data = new FormData();
  data.set("token", token);
  return data;
}
async function page(bookingId: string, token: string) {
  return renderToStaticMarkup(
    await CancelPage({
      params: Promise.resolve({ bookingId }),
      searchParams: Promise.resolve({ token }),
    }),
  );
}

it("opening the link only shows a confirmation; its POST cancels once and sends the usual emails without an account", async () => {
  const target = await booking();
  const other = await booking();
  const token = requireRow(link(target).searchParams.get("token"), "token");
  expect(await page(target.row.id, token)).toContain("Cancel this booking");
  expect(await page(target.row.id, token)).toContain("Cancel this booking");
  expect(
    await sql`select status from app.bookings where id = ${target.row.id}`,
  ).toMatchObject([{ status: "booked" }]);
  await expect(
    cancelPersonalAgentBookingAction(target.row.id, form(token)),
  ).rejects.toThrow("redirect:/poppy/bookings/cancelled");
  expect(
    await sql`select status, ics_sequence from app.bookings where id = ${target.row.id}`,
  ).toMatchObject([{ status: "cancelled", ics_sequence: 1 }]);
  expect(
    await sql`select status from app.bookings where id = ${other.row.id}`,
  ).toMatchObject([{ status: "booked" }]);
  const emails =
    await sql`select kind, state from app.email_deliveries where booking_id = ${target.row.id} and kind in ('booking_cancellation', 'owner_cancellation') order by kind`;
  expect(emails).toMatchObject([
    { kind: "booking_cancellation", state: "sent" },
    { kind: "owner_cancellation", state: "sent" },
  ]);
  await expect(
    cancelPersonalAgentBookingAction(target.row.id, form(token)),
  ).rejects.toThrow("redirect:/poppy/bookings/cancel-unavailable");
  expect(await page(target.row.id, token)).not.toContain("<form");
});

it("tampered, wrong-booking, missing and malformed tokens are refused on reads and direct POSTs", async () => {
  const target = await booking();
  const other = await booking();
  const token = requireRow(link(target).searchParams.get("token"), "token");
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  for (const [id, value] of [
    [target.row.id, tampered],
    [other.row.id, token],
    [target.row.id, ""],
    ["not-a-booking", token],
    [randomUUID(), token],
  ]) {
    expect(await page(id, value)).not.toContain("<form");
    await expect(
      cancelPersonalAgentBookingAction(id, form(value)),
    ).rejects.toThrow("redirect:/poppy/bookings/cancel-unavailable");
  }
  expect(await page(target.row.id, token)).toContain("Cancel this booking");
  expect(
    await sql`select status from app.bookings where id in (${target.row.id}, ${other.row.id})`,
  ).toMatchObject([{ status: "booked" }, { status: "booked" }]);
});

it("concurrent POSTs accept the token at most once and release capacity once", async () => {
  const target = await booking();
  const token = requireRow(link(target).searchParams.get("token"), "token");
  const before = requireRow(
    (
      await sql`select booked_count from app.trial_occurrences where id = ${target.row.trialOccurrenceId}`
    )[0],
    "occurrence",
  ).booked_count;
  const results = await Promise.allSettled([
    cancelPersonalAgentBookingAction(target.row.id, form(token)),
    cancelPersonalAgentBookingAction(target.row.id, form(token)),
  ]);
  const redirects = results.map((result) =>
    result.status === "rejected" ? String(result.reason) : "unexpected success",
  );
  expect(
    redirects.filter((value) => value.endsWith("/cancelled")),
  ).toHaveLength(1);
  expect(
    redirects.filter((value) => value.endsWith("/cancel-unavailable")),
  ).toHaveLength(1);
  expect(
    (
      await sql`select booked_count from app.trial_occurrences where id = ${target.row.trialOccurrenceId}`
    )[0]?.booked_count,
  ).toBe(before - 1);
  expect(
    await sql`select kind from app.email_deliveries where booking_id = ${target.row.id} and kind in ('booking_cancellation', 'owner_cancellation')`,
  ).toHaveLength(2);
});

it("email retries and booking replays preserve the same signed credential, with only its hash stored", async () => {
  const target = await booking("poppy", true);
  const original = link(target).toString();
  const replay = await bookSlot(target.input);
  expect(replay).toMatchObject({
    ok: true,
    idempotent: true,
    booking: { id: target.row.id },
  });
  const messages: EmailMessage[] = [];
  await attemptPendingForBooking(target.row.id, {
    now: () => new Date(Date.now() + 60 * 60 * 1000),
    transport: {
      send: async (message) => {
        messages.push(message);
        return { ok: true, kind: "accepted", providerId: randomUUID() };
      },
    },
  });
  expect(messages).toHaveLength(1);
  expect(messages[0]?.text).toContain(original);
  const stored =
    await sql`select * from app.booking_cancel_tokens where booking_id = ${target.row.id}`;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    booking_id: target.row.id,
    school_id: schoolId,
    used_at: null,
    token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(stored)).not.toContain(
    new URL(original).searchParams.get("token"),
  );
});

it("a trial that has started, or was already cancelled by the school, cannot be cancelled with the link", async () => {
  const target = await booking();
  const token = requireRow(link(target).searchParams.get("token"), "token");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(target.row.startAt);
    expect(await page(target.row.id, token)).not.toContain("<form");
    await expect(
      cancelPersonalAgentBookingAction(target.row.id, form(token)),
    ).rejects.toThrow("redirect:/poppy/bookings/cancel-unavailable");
  } finally {
    vi.useRealTimers();
  }
  expect(
    await cancelBooking({ schoolId, bookingId: target.row.id }),
  ).toMatchObject({ ok: true, replay: false });
  expect(await page(target.row.id, token)).not.toContain("<form");
  await expect(
    cancelPersonalAgentBookingAction(target.row.id, form(token)),
  ).rejects.toThrow("redirect:/poppy/bookings/cancel-unavailable");
});

it("a failed cancellation write rolls back token consumption, so the contact can retry", async () => {
  const target = await booking();
  const token = requireRow(link(target).searchParams.get("token"), "token");
  await sql.unsafe(
    `create function app.test_cancel_write_failure() returns trigger language plpgsql as $$ begin if NEW.booking_id = '${target.row.id}' and NEW.kind = 'booking_cancellation' then raise exception 'cancel storage unavailable'; end if; return NEW; end; $$`,
  );
  await sql.unsafe(
    "create trigger test_cancel_write_failure before insert on app.email_deliveries for each row execute function app.test_cancel_write_failure()",
  );
  try {
    await expect(
      cancelPersonalAgentBookingAction(target.row.id, form(token)),
    ).rejects.toThrow();
    expect(await page(target.row.id, token)).toContain("Cancel this booking");
    expect(
      await sql`select status from app.bookings where id = ${target.row.id}`,
    ).toMatchObject([{ status: "booked" }]);
  } finally {
    await sql.unsafe(
      "drop trigger test_cancel_write_failure on app.email_deliveries",
    );
    await sql.unsafe("drop function app.test_cancel_write_failure()");
  }
  await expect(
    cancelPersonalAgentBookingAction(target.row.id, form(token)),
  ).rejects.toThrow("redirect:/poppy/bookings/cancelled");
});
