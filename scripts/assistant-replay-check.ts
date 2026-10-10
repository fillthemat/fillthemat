import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { gateway, wrapLanguageModel } from "ai";
import {
  completedReply,
  type ReplyFinish,
  streamedReply,
} from "../src/lib/ai/assistant";
import { assistantContext } from "../src/test/assistant-context";
import { legacyAssistantHistory } from "../src/test/assistant-legacy-history";

// Isolated real-Gateway probe: no app, DB, mutations, Langfuse or local fallback.
const modelId = "google/gemini-2.5-flash";
const out = process.argv[2];
if (!out)
  throw new Error("Usage: assistant-replay-check.ts /private/path/report.json");
const calls: {
  mode: string;
  registeredNames: string[];
  replayedNames: string[];
}[] = [];
let lastRequest = 0;
let mode = "completed";
const model = wrapLanguageModel({
  model: gateway(modelId),
  middleware: {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      await setTimeout(Math.max(0, lastRequest + 40_000 - Date.now()));
      lastRequest = Date.now();
      calls.push({
        mode,
        registeredNames: params.tools?.map((tool) => tool.name) ?? [],
        replayedNames: params.prompt.flatMap((message) =>
          message.role === "tool"
            ? message.content.flatMap((part) =>
                part.type === "tool-result" ? [part.toolName] : [],
              )
            : [],
        ),
      });
      return { ...params, temperature: 0 };
    },
  },
});
const input = {
  ...assistantContext(),
  // Simulate loading the saved JSON transcript; retain both legacy names.
  messages: JSON.parse(JSON.stringify(legacyAssistantHistory())),
  model,
};
try {
  const completed = await completedReply(input);
  mode = "streamed";
  let finish: ReplyFinish | undefined;
  const response = await streamedReply({
    ...input,
    onFinish: (value) => {
      finish = value;
    },
  });
  await response.text();
  const streamedText =
    finish?.reply.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("") ?? "";
  const passed =
    completed.text.length > 0 &&
    finish?.completion === "complete" &&
    streamedText.length > 0 &&
    ["completed", "streamed"].every((kind) =>
      calls.some(
        (call) =>
          call.mode === kind &&
          ["list_trial_slots", "capture_lead"].every((name) =>
            call.replayedNames.includes(name),
          ) &&
          !call.registeredNames.includes("list_trial_slots") &&
          !call.registeredNames.includes("capture_lead"),
      ),
    );
  await writeFile(
    out,
    JSON.stringify(
      {
        modelId,
        passed,
        calls,
        completed,
        streamed: { completion: finish?.completion, text: streamedText },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ modelId, passed, report: out }));
  if (!passed) process.exitCode = 1;
} catch {
  // SDK errors may contain request headers: never dump them or credentials.
  await writeFile(
    out,
    JSON.stringify(
      {
        modelId,
        passed: false,
        calls,
        error: "Replay failed; provider/validation error (details suppressed)",
      },
      null,
      2,
    ),
  );
  console.error("Replay failed; details suppressed. See private report.");
  process.exitCode = 1;
}
