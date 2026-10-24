import { beforeEach, describe, expect, it, vi } from "vitest";
import { markPreviewedAction, publishSchoolAction } from "./actions";

const mocks = vi.hoisted(() => ({
  requireSchool: vi.fn(),
  from: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/auth/current-school", () => ({ requireSchool: mocks.requireSchool }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/site-url", () => ({ publicSchoolPath: (slug: string) => `/s/${slug}` }));

function query(result: { data?: { id: string }[]; error: Error | null }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: Promise.resolve(result).then.bind(Promise.resolve(result)),
  };
  return builder;
}

const school = {
  id: "school-id",
  slug: "demo",
  name: "Demo",
  timezone: "UTC",
  notification_email: "owner@example.com",
  city: "London",
  approved_at: "2026-01-01T00:00:00.000Z",
  previewed_at: "2026-01-02T00:00:00.000Z",
  published_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReset();
  mocks.requireSchool.mockResolvedValue({ school: { ...school } });
});

describe("dashboard actions", () => {
  it.each([null, school.previewed_at])(
    "marks previewed and preserves timestamp %s",
    async (previewed_at) => {
      mocks.requireSchool.mockResolvedValue({ school: { ...school, previewed_at } });
      const update = query({ error: null });
      mocks.from.mockReturnValue(update);
      await expect(markPreviewedAction()).rejects.toThrow("redirect:/s/demo?preview=1");
      expect(mocks.from).toHaveBeenCalledWith("schools");
      expect(update.update).toHaveBeenCalledWith({
        previewed_at: previewed_at ?? expect.any(String),
      });
      expect(update.eq).toHaveBeenCalledWith("id", school.id);
    },
  );

  it("checks active school records and publishes only an unpublished school", async () => {
    const offerings = query({ data: [{ id: "offering" }], error: null });
    const windows = query({ data: [{ id: "window" }], error: null });
    const update = query({ error: null });
    mocks.from
      .mockReturnValueOnce(offerings)
      .mockReturnValueOnce(windows)
      .mockReturnValueOnce(update);
    await expect(publishSchoolAction()).rejects.toThrow("redirect:/dashboard");
    expect(mocks.from.mock.calls).toEqual([["trial_offerings"], ["trial_windows"], ["schools"]]);
    for (const read of [offerings, windows]) {
      expect(read.select).toHaveBeenCalledWith("id");
      expect(read.eq.mock.calls).toEqual([
        ["school_id", school.id],
        ["active", true],
      ]);
      expect(read.limit).toHaveBeenCalledWith(1);
    }
    expect(update.update).toHaveBeenCalledWith({ published_at: expect.any(String) });
    expect(update.eq).toHaveBeenCalledWith("id", school.id);
    expect(update.is).toHaveBeenCalledWith("published_at", null);
  });

  it("does not publish without active records", async () => {
    const read = query({ data: [], error: null });
    mocks.from.mockReturnValue(read);
    await expect(publishSchoolAction()).rejects.toThrow("redirect:/dashboard?error=not_ready");
    expect(read.update).not.toHaveBeenCalled();
  });

  it.each(["preview", "offerings", "windows", "publish"])(
    "throws %s errors without redirecting",
    async (stage) => {
      const error = new Error("Data API unavailable");
      mocks.from
        .mockReturnValueOnce(
          query({
            data: [{ id: "offering" }],
            error: stage === "preview" || stage === "offerings" ? error : null,
          }),
        )
        .mockReturnValueOnce(
          query({ data: [{ id: "window" }], error: stage === "windows" ? error : null }),
        )
        .mockReturnValueOnce(query({ error: stage === "publish" ? error : null }));
      await expect(
        stage === "preview" ? markPreviewedAction() : publishSchoolAction(),
      ).rejects.toBe(error);
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
