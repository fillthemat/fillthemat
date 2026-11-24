import { beforeEach, expect, it, vi } from "vitest";
import { requireSchool } from "@/lib/auth/current-school";
import { whatsappSignupConfigured } from "@/lib/whatsapp/config";
import { completeSignup, setWhatsAppSignupState } from "@/lib/whatsapp/signup";
import { completeWhatsAppSignup, updateWhatsAppPopup } from "./whatsapp-actions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-school", () => ({ requireSchool: vi.fn() }));
vi.mock("@/lib/whatsapp/config", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp/config")>()),
  whatsappSignupConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/signup", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp/signup")>()),
  completeSignup: vi.fn(),
  setWhatsAppSignupState: vi.fn(),
}));

const input = { code: "code", wabaId: "123", phoneNumberId: "456" };
function ownedSchool(approved = true, published = true) {
  vi.mocked(requireSchool).mockResolvedValue({
    school: {
      id: "owned-school",
      approved_at: approved ? "2026-01-01" : null,
      published_at: published ? "2026-01-01" : null,
    },
  } as Awaited<ReturnType<typeof requireSchool>>);
}
beforeEach(() => {
  vi.clearAllMocks();
  // Authentication normally returns a full profile. Only eligibility/ownership
  // fields are needed here; the mock must never accept a client-supplied school.
  vi.mocked(requireSchool).mockRejectedValue(new Error("unauthenticated"));
  vi.mocked(whatsappSignupConfigured).mockReturnValue(true);
  vi.mocked(completeSignup).mockResolvedValue({ ok: true });
});

it.each([
  [false, true],
  [true, false],
  [false, false],
])("requires approval=%s and publication=%s before signup", async (approved, published) => {
  ownedSchool(approved, published);
  await expect(completeWhatsAppSignup(input)).rejects.toThrow("school_not_eligible");
  await expect(updateWhatsAppPopup("popup")).rejects.toThrow("school_not_eligible");
  expect(completeSignup).not.toHaveBeenCalled();
  expect(setWhatsAppSignupState).not.toHaveBeenCalled();
});

it("takes ownership from the server, never the submitted school ID", async () => {
  ownedSchool();
  await completeWhatsAppSignup({ ...input, schoolId: "another-school" });
  expect(completeSignup).toHaveBeenCalledExactlyOnceWith("owned-school", input);
  await updateWhatsAppPopup("cancelled");
  expect(setWhatsAppSignupState).toHaveBeenCalledExactlyOnceWith("owned-school", "cancelled", null);
});

it("rejects invalid inputs and unconfigured signup without provider calls", async () => {
  ownedSchool();
  expect(await completeWhatsAppSignup({})).toEqual({ ok: false, code: "invalid_signup" });
  await expect(updateWhatsAppPopup("live")).rejects.toThrow();
  vi.mocked(whatsappSignupConfigured).mockReturnValue(false);
  await expect(completeWhatsAppSignup(input)).rejects.toThrow("signup_unconfigured");
  expect(completeSignup).not.toHaveBeenCalled();
  expect(setWhatsAppSignupState).not.toHaveBeenCalled();
});

it("requires an authenticated owner before any platform write", async () => {
  await expect(completeWhatsAppSignup(input)).rejects.toThrow("unauthenticated");
  await expect(updateWhatsAppPopup("popup")).rejects.toThrow("unauthenticated");
  expect(completeSignup).not.toHaveBeenCalled();
  expect(setWhatsAppSignupState).not.toHaveBeenCalled();
});
