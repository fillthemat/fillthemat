import { after } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppTypingIndicator } from "@/lib/whatsapp/client";
import { WHATSAPP_STUB_APP_SECRET } from "@/lib/whatsapp/config";
import { applyWhatsAppStatuses } from "@/lib/whatsapp/deliveries";
import { enqueueInboundJobs } from "@/lib/whatsapp/jobs";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";
import { post, textInboundPayload } from "@/test/whatsapp-webhook";
import { POST } from "./route";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/whatsapp/client", () => ({
  sendWhatsAppTypingIndicator: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/whatsapp/deliveries", () => ({
  applyWhatsAppStatuses: vi.fn(),
}));
vi.mock("@/lib/whatsapp/jobs", () => ({ enqueueInboundJobs: vi.fn() }));
vi.mock("@/lib/whatsapp/worker", () => ({ runWhatsAppWorkerOnce: vi.fn() }));

function inboundPayload() {
  return textInboundPayload({
    phoneNumberId: "phone-123",
    waId: "16505551234",
    wamid: "wamid.inbound",
  });
}

const statuses = [{ id: "wamid.outbound", status: "delivered" }];

function statusPayload() {
  return { entry: [{ changes: [{ value: { statuses } }] }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_APP_SECRET", WHATSAPP_STUB_APP_SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(enqueueInboundJobs).mockResolvedValue(1);
  vi.mocked(applyWhatsAppStatuses).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/webhooks/whatsapp acknowledgement", () => {
  it("returns 500 so Meta redelivers when inbound enqueue fails", async () => {
    vi.mocked(enqueueInboundJobs).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );

    const response = await POST(post(inboundPayload()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "enqueue_failed" });
    expect(sendWhatsAppTypingIndicator).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(runWhatsAppWorkerOnce).not.toHaveBeenCalled();
  });

  it("does not repeat read receipts or typing for an already-enqueued Meta retry", async () => {
    vi.mocked(enqueueInboundJobs).mockResolvedValueOnce(0);

    const response = await POST(post(inboundPayload()));

    expect(response.status).toBe(200);
    expect(enqueueInboundJobs).toHaveBeenCalledOnce();
    expect(sendWhatsAppTypingIndicator).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
  });

  it("logs enqueue failures with wamids but without contact PII or message text", async () => {
    vi.mocked(enqueueInboundJobs).mockRejectedValueOnce(
      new Error("Failed query params: 16505551234, private enquiry text"),
    );

    const response = await POST(post(inboundPayload()));

    expect(response.status).toBe(500);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "whatsapp_webhook_enqueue_failed",
        error: "Error",
        messageCount: 1,
        wamids: ["wamid.inbound"],
      }),
    );
  });

  it("still returns 200 when a status-only callback fails", async () => {
    vi.mocked(applyWhatsAppStatuses).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );

    const response = await POST(post(statusPayload()));

    expect(response.status).toBe(200);
    expect(applyWhatsAppStatuses).toHaveBeenCalledOnce();
    expect(enqueueInboundJobs).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("returns 200 after enqueue succeeds without running the assistant inline", async () => {
    const enqueue = Promise.withResolvers<number>();
    vi.mocked(enqueueInboundJobs).mockReturnValueOnce(enqueue.promise);

    const pendingResponse = POST(post(inboundPayload()));
    await vi.waitFor(() => expect(enqueueInboundJobs).toHaveBeenCalledOnce());
    expect(sendWhatsAppTypingIndicator).not.toHaveBeenCalled();
    enqueue.resolve(1);
    const response = await pendingResponse;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(enqueueInboundJobs).toHaveBeenCalledOnce();
    expect(sendWhatsAppTypingIndicator).toHaveBeenCalledExactlyOnceWith({
      phoneNumberId: "phone-123",
      messageId: "wamid.inbound",
    });
    expect(after).toHaveBeenCalledOnce();
    expect(runWhatsAppWorkerOnce).not.toHaveBeenCalled();
  });

  it("still acknowledges durable messages when the read/typing Graph call fails", async () => {
    vi.mocked(sendWhatsAppTypingIndicator).mockRejectedValueOnce(
      new Error("Graph unavailable"),
    );

    const response = await POST(post(inboundPayload()));

    expect(response.status).toBe(200);
    expect(enqueueInboundJobs).toHaveBeenCalledOnce();
    expect(sendWhatsAppTypingIndicator).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });

  it("enqueues mixed-payload messages even when their status callback fails", async () => {
    vi.mocked(applyWhatsAppStatuses).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const payload = inboundPayload();
    Object.assign(payload.entry[0].changes[0].value, { statuses });

    const response = await POST(post(payload));

    expect(response.status).toBe(200);
    expect(applyWhatsAppStatuses).toHaveBeenCalledOnce();
    expect(enqueueInboundJobs).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });

  it("returns 500 for mixed payloads when enqueue fails after status success", async () => {
    vi.mocked(enqueueInboundJobs).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const payload = inboundPayload();
    Object.assign(payload.entry[0].changes[0].value, { statuses });

    const response = await POST(post(payload));

    expect(response.status).toBe(500);
    expect(applyWhatsAppStatuses).toHaveBeenCalledOnce();
    expect(after).not.toHaveBeenCalled();
  });

  it("returns 200 for unknown events without enqueueing or waking the worker", async () => {
    const response = await POST(post({ entry: [] }));

    expect(response.status).toBe(200);
    expect(enqueueInboundJobs).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
