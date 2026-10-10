import { describe, expect, it, vi } from "vitest";
import { recordLandingSession } from "@/lib/sessions/record-session";
import { POST } from "./route";

vi.mock("@/lib/sessions/record-session", () => ({
  recordLandingSession: vi.fn(),
}));

function post(body: string) {
  return POST(
    new Request("http://localhost/api/sessions", { method: "POST", body }),
  );
}

describe("landing session requests", () => {
  it.each(["{", "null", JSON.stringify({ slug: "school", token: 123 })])(
    "returns 400 for malformed or invalid input: %s",
    async (body) => {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid" });
    },
  );

  it("returns the recorded visit's qualification", async () => {
    vi.mocked(recordLandingSession).mockResolvedValue({
      status: "recorded",
      qualified: true,
    });
    const response = await post(
      JSON.stringify({
        slug: "school",
        token: "long-enough-token",
        utm: { utm_source: "search" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, qualified: true });
  });
});
