import { beforeEach, expect, it, vi } from "vitest";
import { cancelBookingAction } from "./actions";

const { rpc, send, afterTasks } = vi.hoisted(() => ({
  rpc: vi.fn(),
  send: vi.fn(),
  afterTasks: [] as Array<() => Promise<void>>,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => afterTasks.push(work) }));
vi.mock("@/lib/auth/current-school", () => ({ requireSchool: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@/lib/email/deliveries", () => ({ attemptPendingForBooking: send }));
const id = "9f167fe4-88fa-4e04-ab15-66c8951df27b";
const form = () => {
  const data = new FormData();
  data.set("id", id);
  return data;
};

beforeEach(() => {
  afterTasks.length = 0;
  rpc.mockReset().mockResolvedValue({ data: "cancelled", error: null });
  send.mockReset();
});

it("defers sending until after the cancellation response and logs an attempt failure without throwing", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  send.mockRejectedValue(new Error("database unavailable"));
  try {
    await expect(cancelBookingAction(form())).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
    await expect(afterTasks[0]!()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(id);
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      event: "booking_cancellation_email_attempt_failed",
      bookingId: id,
    });
  } finally {
    log.mockRestore();
  }
});

it.each(["replay", "not_found", "not_cancellable"])(
  "does not schedule a send for %s",
  async (result) => {
    rpc.mockResolvedValue({ data: result, error: null });
    await cancelBookingAction(form());
    expect(afterTasks).toHaveLength(0);
  },
);

it("surfaces a failed cancellation without scheduling sends", async () => {
  rpc.mockResolvedValue({ data: null, error: new Error("cancel failed") });
  await expect(cancelBookingAction(form())).rejects.toThrow("cancel failed");
  expect(afterTasks).toHaveLength(0);
});
