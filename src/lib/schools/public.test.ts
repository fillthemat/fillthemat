import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPublicSchoolBySlug,
  getSchoolBySlug,
  getSchoolForLandingAccess,
  loadSchoolCatalog,
} from "./public";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));

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
  owner_user_id: "owner-id",
  slug: "demo",
  timezone: "UTC",
  approved_at: timestamp,
  published_at: timestamp,
  previewed_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  school_settings: {
    name: "Demo",
    notification_email: "owner@example.com",
    welcome_message: "Welcome!",
    logo_url: "https://example.com/logo.png",
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue(null);
});

describe("school access", () => {
  it("loads the split profile and preserves domain dates and names", async () => {
    const read = query(school);
    mocks.from.mockReturnValue(read);
    expect(await getSchoolBySlug("demo")).toMatchObject({
      id: school.id,
      ownerUserId: school.owner_user_id,
      name: "Demo",
      notificationEmail: "owner@example.com",
      welcomeMessage: "Welcome!",
      logoUrl: "https://example.com/logo.png",
      approvedAt: new Date(timestamp),
      publishedAt: new Date(timestamp),
      previewedAt: null,
      createdAt: new Date(timestamp),
    });
    expect(mocks.from).toHaveBeenCalledWith("schools");
    expect(read.select).toHaveBeenCalledWith("*, school_settings(*)");
    expect(read.eq).toHaveBeenCalledWith("slug", "demo");
  });

  it("requires approval and publication for public lookups", async () => {
    const read = query(school);
    mocks.from.mockReturnValue(read);
    await getPublicSchoolBySlug("demo");
    expect(read.not.mock.calls).toEqual([
      ["approved_at", "is", null],
      ["published_at", "is", null],
    ]);
  });

  it("allows published schools without authentication", async () => {
    mocks.from.mockReturnValue(query(school));
    expect(await getSchoolForLandingAccess("demo")).toMatchObject({ id: school.id });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("does not look up private schools without an explicit preview", async () => {
    mocks.from.mockReturnValue(query(null));
    expect(await getSchoolForLandingAccess("demo")).toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it.each([null, { id: "other-owner" }, { id: "owner-id" }])(
    "limits previews to the verified owner: %j",
    async (user) => {
      mocks.from
        .mockReturnValueOnce(query(null))
        .mockReturnValueOnce(query({ ...school, approved_at: null, published_at: null }));
      mocks.getCurrentUser.mockResolvedValue(user);
      const result = await getSchoolForLandingAccess("demo", { preview: true });
      if (user?.id === "owner-id") {
        expect(result).toMatchObject({ id: school.id, approvedAt: null, publishedAt: null });
      } else {
        expect(result).toBeNull();
      }
      expect(mocks.from).toHaveBeenCalledTimes(user ? 2 : 1);
    },
  );

  it("returns null for unknown schools", async () => {
    mocks.from.mockReturnValue(query(null));
    expect(await getSchoolBySlug("missing")).toBeNull();
  });

  it("throws database failures rather than treating them as missing schools", async () => {
    const error = new Error("Data API unavailable");
    mocks.from.mockReturnValue(query(null, error));
    await expect(getSchoolForLandingAccess("demo", { preview: true })).rejects.toBe(error);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("fails visibly when school settings are missing", async () => {
    mocks.from.mockReturnValue(query({ ...school, school_settings: null }));
    await expect(getSchoolBySlug("demo")).rejects.toThrow("School settings are missing");
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
