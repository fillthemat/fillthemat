import { createHash } from "node:crypto";
import { asSchema, type Tool } from "ai";
import { PLATFORM_INSTRUCTIONS } from "./instructions";

/** Hash only platform-authored instructions and model-facing tool definitions. */
export async function platformInstructionsHash(
  tools: Record<string, Pick<Tool, "description" | "inputSchema">>,
): Promise<string> {
  const definitions = await Promise.all(
    Object.entries(tools).map(async ([name, definition]) => ({
      name,
      description: definition.description,
      inputSchema: await asSchema(definition.inputSchema).jsonSchema,
    })),
  );
  return createHash("sha256")
    .update(
      JSON.stringify(
        { instructions: PLATFORM_INSTRUCTIONS, tools: definitions },
        (_key, value: unknown) => {
          // JSON object key order is not behaviour; array order is preserved.
          if (value && typeof value === "object" && !Array.isArray(value)) {
            return Object.fromEntries(
              Object.entries(value).sort(([a], [b]) =>
                a < b ? -1 : a > b ? 1 : 0,
              ),
            );
          }
          return value;
        },
      ),
    )
    .digest("hex")
    .slice(0, 12);
}
