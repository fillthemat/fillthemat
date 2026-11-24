import { expect, it, vi } from "vitest";
import { resolveWhatsAppToken } from "./connections";

vi.mock("server-only", () => ({}));

it("decrypts the school's business token without using the fallback", async () => {
  const dependencies = {
    loadSecret: vi.fn().mockResolvedValue({ encrypted_token: "encrypted" }),
    decrypt: vi.fn().mockReturnValue("business-token"),
    fallbackToken: vi.fn().mockReturnValue("pilot-token"),
  };
  expect(await resolveWhatsAppToken("school", dependencies)).toBe("business-token");
  expect(dependencies.decrypt).toHaveBeenCalledWith("encrypted", "school");
  expect(dependencies.fallbackToken).not.toHaveBeenCalled();
});

it("uses the pilot fallback only if the secrets row is absent", async () => {
  const dependencies = {
    loadSecret: vi.fn().mockResolvedValue(null),
    decrypt: vi.fn(),
    fallbackToken: vi.fn().mockReturnValue("pilot-token"),
  };
  expect(await resolveWhatsAppToken("school", dependencies)).toBe("pilot-token");
  dependencies.fallbackToken.mockReturnValue(null);
  expect(await resolveWhatsAppToken("school", dependencies)).toBeNull();
});

it("does not mask storage or decryption failures with the global token", async () => {
  const dependencies = {
    loadSecret: vi.fn().mockResolvedValue({ encrypted_token: "corrupt" }),
    decrypt: vi.fn().mockImplementation(() => {
      throw new Error("invalid_ciphertext");
    }),
    fallbackToken: vi.fn(),
  };
  await expect(resolveWhatsAppToken("school", dependencies)).rejects.toThrow("invalid_ciphertext");
  expect(dependencies.fallbackToken).not.toHaveBeenCalled();
  dependencies.loadSecret.mockRejectedValue(new Error("storage_unavailable"));
  await expect(resolveWhatsAppToken("school", dependencies)).rejects.toThrow("storage_unavailable");
});
