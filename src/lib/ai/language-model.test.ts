import { isStepCount, streamText, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GATEWAY_TOKEN_ENV_VARS } from "./gateway-token";
import { defaultLanguageModel } from "./language-model";

// These tests never call a Gateway model: without a token, the Gateway would
// try to mint one from the Vercel CLI login and make a paid call.
describe("the assistant's default language model", () => {
  beforeEach(() => {
    for (const name of GATEWAY_TOKEN_ENV_VARS) vi.stubEnv(name, undefined);
    vi.stubEnv("BOOKING_AGENT_MODEL", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is never the scripted model in production, even without a Gateway token", () => {
    vi.stubEnv("NODE_ENV", "production");

    const model = defaultLanguageModel();

    expect([model.provider, model.modelId]).toEqual([
      "gateway",
      "anthropic/claude-sonnet-4.6",
    ]);
  });

  it.each(["VERCEL_OIDC_TOKEN", "AI_GATEWAY_API_KEY"])(
    "is the BOOKING_AGENT_MODEL Gateway model outside production when %s is set",
    (credential) => {
      vi.stubEnv(credential, "test-token");
      vi.stubEnv("BOOKING_AGENT_MODEL", "google/gemini-2.5-flash");

      const model = defaultLanguageModel();

      expect([model.provider, model.modelId]).toEqual([
        "gateway",
        "google/gemini-2.5-flash",
      ]);
    },
  );

  it("is a scripted local model outside production without a Gateway token that also streams its reply", async () => {
    const result = streamText({
      model: defaultLanguageModel(),
      tools: {
        list_trial_offerings: tool({
          inputSchema: z.object({}),
          execute: async () => ({
            offerings: [{ name: "Kids BJJ" }, { name: "Adult Muay Thai" }],
            noMatch: false,
          }),
        }),
      },
      stopWhen: isStepCount(2),
      prompt: "What can I try?",
    });

    expect(await result.text).toBe(
      "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ, Adult Muay Thai.",
    );
  });
});
