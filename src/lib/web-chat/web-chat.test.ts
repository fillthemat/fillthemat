import { beforeEach, expect, it, vi } from "vitest";
import { loadWebTranscript, startWebTurn } from "./web-chat";

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return {
    single,
    eq,
    select,
    from: vi.fn(() => ({ select })),
    getSchool: vi.fn(),
    catalog: vi.fn(),
    find: vi.fn(),
    resolve: vi.fn(),
    claim: vi.fn(),
    transcript: vi.fn(),
    limit: vi.fn(),
    append: vi.fn(),
    release: vi.fn(),
    reply: vi.fn(),
    validate: vi.fn(),
    run: vi.fn((work: () => unknown) => work()),
    end: vi.fn(),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ validateUIMessages: mocks.validate }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/ai/assistant", () => ({ streamedReply: mocks.reply }));
vi.mock("@/lib/schools/public", () => ({
  getSchoolForLandingAccess: mocks.getSchool,
  loadSchoolCatalog: mocks.catalog,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("./conversation-store", () => ({
  findConversation: mocks.find,
  findOrCreateConversation: mocks.resolve,
  claimGeneration: mocks.claim,
  loadTranscript: mocks.transcript,
  endConversationAtMessageLimit: mocks.limit,
  appendMessage: mocks.append,
}));
vi.mock("@/lib/tracing/turn-trace", () => ({
  startTurnTrace: () => ({ run: mocks.run, end: mocks.end }),
}));

const message = {
  id: "question",
  role: "user" as const,
  parts: [{ type: "text" as const, text: "Hello" }],
};
const input = { slug: "school", preview: false, resumeToken: "browser-token", message };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSchool.mockResolvedValue({ id: "school-id" });
  mocks.catalog.mockResolvedValue({ offerings: [], windows: [], occurrences: [], faqs: [] });
  mocks.resolve.mockResolvedValue({ id: "conversation-id" });
  mocks.claim.mockResolvedValue({ generation: "generation", release: mocks.release });
  mocks.transcript.mockResolvedValue([]);
  mocks.limit.mockResolvedValue(false);
  mocks.validate.mockImplementation(async ({ messages }) => messages);
  mocks.single.mockResolvedValue({
    data: { agent_instructions: "Private instructions" },
    error: null,
  });
  mocks.reply.mockResolvedValue(new Response("reply"));
});

it("checks school/preview access before any privileged conversation operation", async () => {
  mocks.getSchool.mockResolvedValue(null);
  expect(await startWebTurn(input)).toEqual({ ok: false, reason: "not_found" });
  expect(await loadWebTranscript(input)).toEqual({ ok: false, reason: "not_found" });
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it("loads transcripts only after a token-scoped lookup and never creates on GET", async () => {
  mocks.find.mockResolvedValue(null);
  expect(await loadWebTranscript(input)).toEqual({ ok: true, messages: [] });
  expect(mocks.find).toHaveBeenCalledWith({ schoolId: "school-id", resumeToken: "browser-token" });
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.transcript).not.toHaveBeenCalled();
  mocks.find.mockResolvedValue({ id: "conversation-id" });
  mocks.transcript.mockResolvedValue([message]);
  expect(await loadWebTranscript(input)).toEqual({ ok: true, messages: [message] });
  expect(mocks.transcript).toHaveBeenCalledWith("school-id", "conversation-id");
});

it("does not write during a live generation", async () => {
  mocks.claim.mockResolvedValueOnce(undefined);
  expect(await startWebTurn(input)).toEqual({ ok: false, reason: "generation_in_progress" });
  expect(mocks.append).not.toHaveBeenCalled();
});

it("refuses duplicates and message limits without starting a reply and releases the lock", async () => {
  mocks.transcript.mockResolvedValueOnce([message]);
  expect(await startWebTurn(input)).toEqual({ ok: false, reason: "duplicate" });
  mocks.limit.mockResolvedValueOnce(true);
  expect(await startWebTurn(input)).toEqual({ ok: false, reason: "message_limit" });
  expect(mocks.release).toHaveBeenCalledTimes(2);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.reply).not.toHaveBeenCalled();
});

it("loads private instructions on the server and hands its generation fence to reply persistence", async () => {
  const result = await startWebTurn(input);
  expect(result.ok).toBe(true);
  expect(mocks.from).toHaveBeenCalledWith("school_settings");
  expect(mocks.select).toHaveBeenCalledWith("agent_instructions");
  expect(mocks.eq).toHaveBeenCalledWith("school_id", "school-id");
  expect(mocks.reply).toHaveBeenCalledWith(
    expect.objectContaining({
      school: { id: "school-id", agentInstructions: "Private instructions" },
    }),
  );
  expect(mocks.append).toHaveBeenCalledWith(
    expect.objectContaining({
      schoolId: "school-id",
      conversationId: "conversation-id",
      generation: "generation",
      messageId: "question",
      role: "user",
    }),
  );
  expect(mocks.release).not.toHaveBeenCalled();
  const reply = { id: "assistant-reply", role: "assistant", parts: [{ type: "text", text: "Hi" }] };
  await mocks.reply.mock.calls[0]![0].onFinish({ reply, completion: "aborted", provenance: {} });
  expect(mocks.append).toHaveBeenLastCalledWith(
    expect.objectContaining({
      schoolId: "school-id",
      conversationId: "conversation-id",
      generation: "generation",
      messageId: reply.id,
      role: "assistant",
      completion: "aborted",
    }),
  );
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("fails closed and releases its claim when private settings cannot be read", async () => {
  mocks.single.mockResolvedValueOnce({ data: null, error: new Error("settings unavailable") });
  await expect(startWebTurn(input)).rejects.toThrow("settings unavailable");
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.reply).not.toHaveBeenCalled();
});

it("releases the lock if the assistant cannot start or its final save fails", async () => {
  mocks.reply.mockRejectedValueOnce(new Error("model failed"));
  await expect(startWebTurn(input)).rejects.toThrow("model failed");
  expect(mocks.release).toHaveBeenCalledOnce();
  await startWebTurn(input);
  mocks.append.mockRejectedValueOnce(new Error("save failed"));
  await expect(
    mocks.reply.mock.calls[1]![0].onFinish({
      reply: { id: "reply", parts: [] },
      completion: "error",
      provenance: {},
    }),
  ).rejects.toThrow("save failed");
  expect(mocks.release).toHaveBeenCalledTimes(2);
});
