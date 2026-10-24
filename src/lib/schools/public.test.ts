import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPublicSchoolBySlug,
  getSchoolBySlug,
  getSchoolForLandingAccess,
  loadSchoolCatalog,
} from "./public";

const mocks = vi.hoisted(() => ({ from: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

function query(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    range: vi.fn().mockResolvedValue({ data, error }),
  };
}

const timestamp = "2026-01-01T12:00:00.000Z";
const school = {
  id: "school-id",
  slug: "demo",
  timezone: "UTC",
  approved_at: timestamp,
  published_at: timestamp,
  school_profiles: {
    name: "Demo",
    welcome_message: "Welcome!",
    logo_url: "https://example.com/logo.png",
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ from: mocks.from });
  mocks.from.mockReturnValue(query(school));
});

describe("school access", () => {
  it("loads public profile tables without carrying private school fields", async () => {
    const result = await getSchoolBySlug("demo");
    expect(result).toMatchObject({
      id: school.id,
      name: "Demo",
      welcomeMessage: "Welcome!",
      logoUrl: "https://example.com/logo.png",
      approvedAt: new Date(timestamp),
      publishedAt: new Date(timestamp),
    });
    for (const field of [
      "ownerUserId",
      "notificationEmail",
      "agentInstructions",
      "whatsappPhoneNumberId",
    ]) {
      expect(result).not.toHaveProperty(field);
    }
    expect(mocks.from).toHaveBeenCalledWith("schools");
    expect(mocks.from.mock.results[0]?.value.select).toHaveBeenCalledWith(
      "*, school_profiles!inner(*)",
    );
  });

  it.each([false, true])("delegates preview=%s authorization to RLS", async (preview) => {
    await getSchoolForLandingAccess("demo", { preview });
    const read = mocks.from.mock.results[0]?.value;
    expect(read.eq).toHaveBeenCalledWith("slug", "demo");
    expect(read.not).toHaveBeenCalledTimes(preview ? 0 : 2);
  });

  it("never requests previews through the public lookup", async () => {
    await getPublicSchoolBySlug("demo");
    expect(mocks.from.mock.results[0]?.value.not.mock.calls).toEqual([
      ["approved_at", "is", null],
      ["published_at", "is", null],
    ]);
  });

  it("defaults to public-only access and returns null for denied or unknown schools", async () => {
    mocks.from.mockReturnValue(query(null));
    expect(await getSchoolForLandingAccess("missing")).toBeNull();
    expect(mocks.from.mock.results[0]?.value.not).toHaveBeenCalledTimes(2);
  });

  it("propagates query failures", async () => {
    const error = new Error("Data API unavailable");
    mocks.from.mockReturnValue(query(null, error));
    await expect(getSchoolForLandingAccess("demo")).rejects.toBe(error);
  });
});

describe("school catalog", () => {
  it("scopes every query and maps scheduling timestamps and profile fields", async () => {
    const reads = [
      query([{ id: "offering", minimum_age: 5, maximum_age: 12, active: true }]),
      query([{ id: "window", trial_offering_id: "offering", day_of_week: 1, start_minute: 600 }]),
      query([{ trial_window_id: "window", start_at: timestamp, booked_count: 2, capacity: 5 }]),
      query([{ question: "Where?", answer: "Here", sort_order: 1 }]),
    ];
    for (const read of reads) mocks.from.mockReturnValueOnce(read);
    const catalog = await loadSchoolCatalog(school.id);
    expect(mocks.from.mock.calls).toEqual([
      ["trial_offerings"],
      ["trial_windows"],
      ["trial_occurrences"],
      ["faqs"],
    ]);
    for (const read of reads) {
      expect(read.eq).toHaveBeenCalledWith("school_id", school.id);
      expect(read.range).toHaveBeenCalledWith(0, 999);
      expect(read.order).toHaveBeenCalledWith("id");
    }
    expect(reads.at(-1)?.order).toHaveBeenCalledWith("sort_order");
    expect(catalog.offerings).toEqual([
      expect.objectContaining({ minimumAge: 5, maximumAge: 12, active: true }),
    ]);
    expect(catalog.windows).toEqual([
      expect.objectContaining({ trialOfferingId: "offering", dayOfWeek: 1, startMinute: 600 }),
    ]);
    expect(catalog.occurrences).toEqual([
      expect.objectContaining({
        trialWindowId: "window",
        startAt: new Date(timestamp),
        bookedCount: 2,
        capacity: 5,
      }),
    ]);
    expect(catalog.faqs).toEqual([
      expect.objectContaining({ question: "Where?", answer: "Here", sortOrder: 1 }),
    ]);
  });

  it("reads beyond PostgREST's first page", async () => {
    const occurrences = query([]);
    occurrences.range
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, () => ({ start_at: timestamp })),
      })
      .mockResolvedValueOnce({ data: [{ start_at: timestamp }] });
    mocks.from.mockImplementation((table: string) =>
      table === "trial_occurrences" ? occurrences : query([]),
    );
    expect((await loadSchoolCatalog(school.id)).occurrences).toHaveLength(1001);
    expect(occurrences.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("can use the same server client anonymously outside a request", async () => {
    mocks.from.mockReturnValue(query([]));
    await loadSchoolCatalog(school.id, { anonymous: true });
    expect(mocks.createClient).toHaveBeenCalledWith({ anonymous: true });
  });

  it.each(["trial_offerings", "trial_windows", "trial_occurrences", "faqs"])(
    "propagates %s read failures",
    async (failedTable) => {
      const error = new Error("Data API unavailable");
      mocks.from.mockImplementation((table: string) =>
        query([], table === failedTable ? error : null),
      );
      await expect(loadSchoolCatalog(school.id)).rejects.toBe(error);
    },
  );
});
