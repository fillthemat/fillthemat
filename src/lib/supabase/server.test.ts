import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./server";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("existing Supabase server client", () => {
  it.each([false, true])("uses the publishable key with anonymous=%s", async (anonymous) => {
    const cookieStore = {
      getAll: vi.fn().mockReturnValue([{ name: "session", value: "cookie" }]),
      set: vi.fn(),
    };
    mocks.cookies.mockResolvedValue(cookieStore);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    await createClient({ anonymous });
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "publishable-key",
      expect.any(Object),
    );
    const options = mocks.createServerClient.mock.calls[0]?.[2];
    expect(options.cookies.getAll()).toEqual(
      anonymous ? [] : [{ name: "session", value: "cookie" }],
    );
    options.cookies.setAll([{ name: "refresh", value: "new", options: {} }]);
    if (anonymous) {
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(cookieStore.set).not.toHaveBeenCalled();
    } else {
      expect(cookieStore.set).toHaveBeenCalledWith("refresh", "new", {});
    }
  });
});
