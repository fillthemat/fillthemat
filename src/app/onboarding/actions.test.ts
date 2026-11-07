import { expect, it, vi } from "vitest";
import { createSchoolAction } from "./actions";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => ({ id: "owner-id", email: "owner@local.test" }),
}));
vi.mock("@/lib/auth/current-school", () => ({ getCurrentSchool: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));

it("redirects database timezone validation failures to the existing invalid-form error", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "invalid_timezone" } });
  const form = new FormData();
  form.set("name", "School");
  form.set("slug", "fresh-school");
  form.set("timezone", "America/New_York");
  form.set("notificationEmail", "owner@local.test");

  await expect(createSchoolAction(form)).rejects.toThrow("/onboarding?error=invalid");
  expect(rpc).toHaveBeenCalledWith(
    "create_onboarding_school",
    expect.objectContaining({
      p_owner_user_id: "owner-id",
      p_city: "",
    }),
  );
});
