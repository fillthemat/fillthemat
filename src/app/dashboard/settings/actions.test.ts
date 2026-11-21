import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAgentAction, updateBrandingAction, updatePricingAction } from "./actions";

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return {
    single,
    select,
    eq,
    update,
    from: vi.fn(() => ({ update })),
    rpc: vi.fn(),
    requireSchool: vi.fn(),
    revalidatePath: vi.fn(),
    unstable_rethrow: vi.fn(),
  };
});

vi.mock("@/lib/auth/current-school", () => ({ requireSchool: mocks.requireSchool }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstable_rethrow }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.single.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.requireSchool.mockResolvedValue({ school: { id: "school-id", slug: "demo" } });
});

describe("school settings actions", () => {
  it("parses raw strings on the server, scopes the update, and returns normalized values", async () => {
    const result = await updatePricingAction({ pricing: "  Free trial  ", logoUrl: "ignored" });
    expect(mocks.from).toHaveBeenCalledWith("school_profiles");
    expect(mocks.update).toHaveBeenCalledWith({
      pricing: "Free trial",
      updated_at: expect.any(String),
    });
    expect(mocks.eq).toHaveBeenCalledWith("school_id", "school-id");
    expect(result).toMatchObject({
      status: "success",
      message: "Pricing saved. Your agent may share it now.",
      values: { pricing: "Free trial" },
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/dashboard/settings"],
      ["/dashboard"],
      ["/s/demo"],
    ]);
  });

  it("keeps the agent field mapping and success copy", async () => {
    const result = await updateAgentAction({ welcomeMessage: "  Hello  ", agentInstructions: " " });
    expect(mocks.rpc).toHaveBeenCalledWith("update_school_agent", {
      p_school_id: "school-id",
      p_welcome_message: "Hello",
      p_agent_instructions: "",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      message: "Agent settings saved and live on your page.",
      values: { welcomeMessage: "Hello", agentInstructions: "" },
    });
  });

  it("keeps branding normalization and success copy", async () => {
    const result = await updateBrandingAction({ logoUrl: "", primaryColor: "123ABC" });
    expect(mocks.update).toHaveBeenCalledWith({
      logo_url: null,
      primary_color: "#123ABC",
      updated_at: expect.any(String),
    });
    expect(result).toMatchObject({
      message: "Branding saved and live on your public page.",
      values: { logoUrl: "", primaryColor: "#123ABC" },
    });
  });

  it("rejects invalid values without updating or revalidating", async () => {
    const result = await updateBrandingAction({
      logoUrl: "http://example.com/logo.png",
      primaryColor: "invalid",
    });
    expect(result.status).toBe("error");
    expect(result.fieldErrors).toHaveProperty("logoUrl");
    expect(result.fieldErrors).toHaveProperty("primaryColor");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps unexpected failures visible after checking Next control flow", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database unavailable");
    mocks.single.mockResolvedValue({ error });
    try {
      expect(await updatePricingAction({ pricing: "Free" })).toMatchObject({ status: "error" });
      expect(mocks.unstable_rethrow).toHaveBeenCalledWith(error);
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ event: "settings_action_failed", message: error.message }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("does not turn Next control-flow exceptions into a form error", async () => {
    const redirect = new Error("redirect");
    mocks.requireSchool.mockRejectedValueOnce(redirect);
    mocks.unstable_rethrow.mockImplementationOnce(() => {
      throw redirect;
    });
    await expect(updatePricingAction({ pricing: "Free" })).rejects.toBe(redirect);
  });
});
