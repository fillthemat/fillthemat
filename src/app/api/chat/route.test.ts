import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_REQUEST_BYTES,
  MAX_USER_MESSAGE_CHARS,
} from "@/lib/security/limits";
import { loadWebTranscript, startWebTurn } from "@/lib/web-chat";
import { GET, maxDuration, POST } from "./route";

// Only the HTTP adapter is under test; Turn behavior is tested against Supabase.
vi.mock("@/lib/web-chat", () => ({
  startWebTurn: vi.fn(),
  loadWebTranscript: vi.fn(),
}));

const validBody = {
  slug: "test-school",
  resumeToken: "resume-token",
  message: {
    id: "question-1",
    role: "user",
    parts: [{ type: "text", text: "Hi" }],
  },
};

function post(body: string, headers: HeadersInit = {}) {
  return POST(
    new Request("http://localhost/api/chat", { method: "POST", body, headers }),
  );
}

beforeEach(() => vi.resetAllMocks());

describe("chat request parsing", () => {
  it("returns 400 for malformed JSON without starting a turn", async () => {
    const response = await post("{");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid" });
    expect(startWebTurn).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(MAX_USER_MESSAGE_CHARS + 1)])(
    "returns 400 for an empty or oversized message",
    async (text) => {
      const response = await post(
        JSON.stringify({
          ...validBody,
          message: { ...validBody.message, parts: [{ type: "text", text }] },
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_message" });
      expect(startWebTurn).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    {},
    { ...validBody, slug: 1 },
    { ...validBody, resumeToken: "" },
    { ...validBody, preview: "true" },
    { ...validBody, message: { ...validBody.message, role: "assistant" } },
    { ...validBody, message: { role: "user", parts: [] } },
    { ...validBody, message: { ...validBody.message, parts: "Hi" } },
    {
      ...validBody,
      message: { ...validBody.message, parts: [{ type: "text", text: 1 }] },
    },
  ])("returns 400 for an invalid body", async (body) => {
    expect((await post(JSON.stringify(body))).status).toBe(400);
    expect(startWebTurn).not.toHaveBeenCalled();
  });

  it("returns 413 for a declared oversized body before parsing it", async () => {
    const response = await post("{", {
      "content-length": String(MAX_REQUEST_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    expect(startWebTurn).not.toHaveBeenCalled();
  });

  it("passes parsed input and the default preview flag to the turn module", async () => {
    const reply = new Response("reply");
    vi.mocked(startWebTurn).mockResolvedValue({ ok: true, response: reply });
    expect(await post(JSON.stringify(validBody))).toBe(reply);
    expect(startWebTurn).toHaveBeenCalledWith({ ...validBody, preview: false });
  });

  it("passes an explicit preview flag to the turn module", async () => {
    vi.mocked(startWebTurn).mockResolvedValue({
      ok: true,
      response: new Response(),
    });
    await post(JSON.stringify({ ...validBody, preview: true }));
    expect(startWebTurn).toHaveBeenCalledWith({ ...validBody, preview: true });
  });
});

describe("chat refusal statuses", () => {
  it.each([
    ["not_found", 404, "not_found"],
    ["invalid_conversation", 403, "invalid_conversation"],
    ["generation_in_progress", 409, "generation_in_progress"],
    ["duplicate", 409, "duplicate"],
    ["message_limit", 429, "limit"],
    ["expired", 410, "expired"],
  ] as const)("maps %s to %i", async (reason, status, error) => {
    vi.mocked(startWebTurn).mockResolvedValue({ ok: false, reason });
    const response = await post(JSON.stringify(validBody));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});

describe("transcript request parsing and status mapping", () => {
  it.each([
    "",
    "?slug=test-school",
    "?resumeToken=resume-token",
    "?slug=&resumeToken=x",
  ])("returns 400 for missing required query parameters", async (query) => {
    expect(
      (await GET(new Request(`http://localhost/api/chat${query}`))).status,
    ).toBe(400);
    expect(loadWebTranscript).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "passes parsed query parameters with preview=%s and returns the messages",
    async (preview) => {
      const messages = [
        {
          id: "question-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Hi" }],
        },
      ];
      vi.mocked(loadWebTranscript).mockResolvedValue({ ok: true, messages });
      const response = await GET(
        new Request(
          `http://localhost/api/chat?slug=test-school&resumeToken=resume-token${preview ? "&preview=1" : ""}`,
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ messages });
      expect(loadWebTranscript).toHaveBeenCalledWith({
        slug: "test-school",
        resumeToken: "resume-token",
        preview,
      });
    },
  );

  it("maps a school access refusal to 404", async () => {
    vi.mocked(loadWebTranscript).mockResolvedValue({
      ok: false,
      reason: "not_found",
    });
    const response = await GET(
      new Request(
        "http://localhost/api/chat?slug=test-school&resumeToken=resume-token",
      ),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("has a positive duration below the stale-lock threshold", () => {
    expect(maxDuration).toBeGreaterThan(0);
    expect(maxDuration).toBeLessThan(600);
  });
});
