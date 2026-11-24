import { expect, it, vi } from "vitest";
import type { Fetcher } from "@/lib/fetcher";
import { completeSignup } from "./signup";

vi.mock("server-only", () => ({}));
const input = { code: "one-use-code", phoneNumberId: "123", wabaId: "456" };

function setup(failedStep = -1) {
  let call = 0;
  const bodies = [
    { access_token: "business-token" },
    { display_phone_number: "+1 555 000", verified_name: "Dojo" },
    { success: true },
    { success: true },
  ];
  return {
    fetch: vi.fn<Fetcher>(async () => {
      const index = call++;
      return Response.json(index === failedStep ? { error: { code: 100 } } : bodies[index], {
        status: index === failedStep ? 400 : 200,
      });
    }),
    appId: () => "app-id",
    appSecret: () => "app-secret",
    encrypt: vi.fn((value: string, school: string) => `encrypted:${school}:${value}`),
    setState: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

it("exchanges the code, reads the number, subscribes, registers and atomically saves live credentials", async () => {
  const dependencies = setup();
  expect(await completeSignup("school", input, dependencies)).toEqual({ ok: true });
  expect(dependencies.setState).toHaveBeenCalledWith("school", "registering");
  const calls = dependencies.fetch.mock.calls;
  expect(calls).toHaveLength(4);
  expect(dependencies.save).toHaveBeenCalledWith(
    "school",
    expect.objectContaining({
      phoneNumberId: "123",
      wabaId: "456",
      displayPhoneNumber: "+1 555 000",
      encryptedToken: "encrypted:school:business-token",
      encryptedPin: expect.stringMatching(/^encrypted:school:\d{6}$/),
    }),
  );
  // Inspect real RequestInit values, including auth and the exact registration body.
  const fetchCall = dependencies.fetch;
  expect(fetchCall.mock.calls[0]?.[0]).toContain(
    "oauth/access_token?client_id=app-id&client_secret=app-secret&code=one-use-code",
  );
  expect(fetchCall.mock.calls[1]?.[1]?.headers).toMatchObject({
    authorization: "Bearer business-token",
  });
  expect(fetchCall.mock.calls[2]?.[0]).toContain("/456/subscribed_apps");
  expect(fetchCall.mock.calls[3]?.[0]).toContain("/123/register");
  expect(JSON.parse(String(fetchCall.mock.calls[3]?.[1]?.body))).toEqual({
    messaging_product: "whatsapp",
    pin: expect.stringMatching(/^\d{6}$/),
  });
});

it.each(["token_exchange", "phone_lookup", "subscribe", "register"])(
  "records a clear failure code when %s fails and does not go live",
  async (step) => {
    const index = ["token_exchange", "phone_lookup", "subscribe", "register"].indexOf(step);
    const dependencies = setup(index);
    expect(await completeSignup("school", input, dependencies)).toEqual({
      ok: false,
      code: `${step}_failed`,
    });
    expect(dependencies.setState).toHaveBeenLastCalledWith("school", "failed", `${step}_failed`);
    expect(dependencies.fetch).toHaveBeenCalledTimes(index + 1);
    expect(dependencies.save).not.toHaveBeenCalled();
  },
);

it("fails closed on network, malformed response and storage errors", async () => {
  for (const failure of ["network", "malformed", "storage"]) {
    const dependencies = setup();
    if (failure === "network") dependencies.fetch.mockRejectedValue(new Error("network"));
    if (failure === "malformed") dependencies.fetch.mockResolvedValue(Response.json({}));
    if (failure === "storage") dependencies.save.mockRejectedValue(new Error("storage"));
    const code = failure === "storage" ? "save_connection_failed" : "token_exchange_failed";
    expect(await completeSignup("school", input, dependencies)).toEqual({ ok: false, code });
  }
});

it("rejects malformed inputs and missing app configuration before I/O", async () => {
  const dependencies = setup();
  expect(
    await completeSignup("school", { ...input, phoneNumberId: "../other" }, dependencies),
  ).toEqual({ ok: false, code: "invalid_signup" });
  dependencies.appId = () => "";
  expect(await completeSignup("school", input, dependencies)).toEqual({
    ok: false,
    code: "signup_unconfigured",
  });
  expect(dependencies.fetch).not.toHaveBeenCalled();
});

it("records encryption configuration failures before exchanging the expiring code", async () => {
  const dependencies = setup();
  dependencies.encrypt.mockImplementation(() => {
    throw new Error("invalid_key");
  });
  expect(await completeSignup("school", input, dependencies)).toEqual({
    ok: false,
    code: "encryption_failed",
  });
  expect(dependencies.fetch).not.toHaveBeenCalled();
  expect(dependencies.setState).toHaveBeenCalledExactlyOnceWith(
    "school",
    "failed",
    "encryption_failed",
  );
});
