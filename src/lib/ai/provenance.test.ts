import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { platformInstructionsHash } from "./provenance";

describe("reply provenance", () => {
  it("changes when a model-facing tool description changes", async () => {
    const definition = tool({
      description: "List trial offerings.",
      inputSchema: z.object({ age: z.number().optional() }),
    });

    const original = await platformInstructionsHash({ list: definition });
    const changed = await platformInstructionsHash({
      list: { ...definition, description: "List eligible trial offerings." },
    });

    expect(original).toMatch(/^[0-9a-f]{12}$/);
    expect(changed).not.toBe(original);
  });

  it("changes when a tool's input schema or registered name changes", async () => {
    const definition = tool({
      description: "List trial offerings.",
      inputSchema: z.object({ age: z.number().optional() }),
    });
    const original = await platformInstructionsHash({ list: definition });

    expect(
      await platformInstructionsHash({
        list: {
          ...definition,
          inputSchema: z.object({ age: z.number().min(5).optional() }),
        },
      }),
    ).not.toBe(original);
    expect(
      await platformInstructionsHash({ list_offerings: definition }),
    ).not.toBe(original);
    expect(await platformInstructionsHash({})).not.toBe(original);
  });

  it("is stable across fresh schemas and reordered JSON object keys", async () => {
    const original = await platformInstructionsHash({
      list: tool({
        description: "List trial offerings.",
        inputSchema: jsonSchema({
          type: "object",
          properties: { age: { type: "integer", minimum: 0 } },
          required: ["age"],
          additionalProperties: false,
        }),
      }),
    });
    const reordered = await platformInstructionsHash({
      list: tool({
        description: "List trial offerings.",
        inputSchema: jsonSchema({
          additionalProperties: false,
          required: ["age"],
          properties: { age: { minimum: 0, type: "integer" } },
          type: "object",
        }),
      }),
    });

    expect(reordered).toBe(original);
  });
});
