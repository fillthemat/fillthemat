import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LangfuseClient } from "@langfuse/client";
import { gateway, wrapLanguageModel } from "ai";
import { z } from "zod";
import { registerTracing } from "../src/lib/tracing/register";
import { maskContactFields } from "../src/lib/tracing/span-processor";
import { cases, DATASET_NAME, type EvalCase } from "./assistant-eval/cases";
import {
  compareRuns,
  type RunReport,
  reportSchema,
  requireCompleteBaseline,
} from "./assistant-eval/compare";
import { judgeHash, judgeReply } from "./assistant-eval/judge";
import { type CaseResult, runCase } from "./assistant-eval/runner";
import { scoreToolCalls } from "./assistant-eval/scoring";

const args = process.argv.slice(2);
class AssistantEvalError extends Error {}
function caseFor(metadata: unknown): EvalCase {
  const { caseId } = z.object({ caseId: z.string() }).parse(metadata);
  const testCase = cases.find((row) => row.id === caseId);
  if (!testCase) throw new AssistantEvalError("Unknown dataset case");
  return testCase;
}
function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}
function required(name: string): string {
  const value = flag(name);
  if (!value || value.startsWith("--"))
    throw new AssistantEvalError(`Missing --${name}`);
  return value;
}
// Serialize dates before masking; never export Date objects as empty objects.
function safe(value: unknown): unknown {
  return maskContactFields(JSON.parse(JSON.stringify(value)));
}
const datasetHash = createHash("sha256")
  .update(JSON.stringify(safe(cases)))
  .digest("hex");

function cli(resource: string, action: string, body: unknown): unknown {
  const child = spawnSync(
    "bunx",
    ["langfuse-cli", "api", resource, action, "--body-file", "-", "--json"],
    {
      input: JSON.stringify(safe(body)),
      encoding: "utf8",
      env: {
        ...process.env,
        LANGFUSE_HOST:
          process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST,
      },
    },
  );
  if (child.status !== 0)
    throw new AssistantEvalError(
      `Langfuse ${resource}/${action} failed (credentials/network/API); no secrets printed`,
    );
  const result = JSON.parse(child.stdout);
  if (result.status >= 400)
    throw new AssistantEvalError(
      `Langfuse ${resource}/${action}: HTTP ${result.status}`,
    );
  return result.body;
}

async function seed() {
  const dataset = cli("datasets", "create", {
    name: DATASET_NAME,
    description:
      "Spec #92: reconstructed production turns plus labeled requirement variants; review expected outputs before trusting the gate.",
    metadata: { issue: 97, datasetHash, draft: true },
  });
  for (const testCase of cases) {
    const hex = createHash("sha256")
      .update(`${DATASET_NAME}/${testCase.id}`)
      .digest("hex");
    cli("dataset-items", "create", {
      id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
      datasetName: DATASET_NAME,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      metadata: { ...testCase.metadata, caseId: testCase.id },
      sourceTraceId: testCase.metadata.sourceTraceId,
      sourceObservationId: testCase.metadata.sourceObservationId,
    });
  }
  console.log(JSON.stringify({ dataset, cases: cases.length, datasetHash }));
}

async function run() {
  const modelId = required("model");
  const judgeModel = flag("judge-model") ?? modelId;
  const runName = required("name");
  const outputPath = required("out");
  const intervalMs = Number(flag("interval-ms") ?? 15000);
  if (!Number.isFinite(intervalMs) || intervalMs < 0)
    throw new AssistantEvalError("Invalid --interval-ms");
  let nextRequestAt = 0;
  function pacedModel(id: string) {
    return wrapLanguageModel({
      model: gateway(id),
      middleware: {
        specificationVersion: "v4",
        wrapGenerate: async ({ doGenerate }) => {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())),
          );
          nextRequestAt = Date.now() + intervalMs;
          return doGenerate();
        },
      },
    });
  }
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY)
    throw new AssistantEvalError("Set Langfuse credentials via an env file");
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN)
    throw new AssistantEvalError(
      "Set Gateway credentials; eval never falls back to the scripted local model",
    );
  process.env.LANGFUSE_TRACING_ENVIRONMENT = "assistant-eval";
  const provider = registerTracing();
  if (!provider)
    throw new AssistantEvalError("Langfuse tracing could not be registered");
  const client = new LangfuseClient();
  try {
    const dataset = await client.dataset.get(DATASET_NAME);
    if (dataset.items.length !== cases.length)
      throw new AssistantEvalError(
        "Hosted dataset differs from fixed cases; seed the versioned dataset first",
      );
    for (const item of dataset.items) {
      const testCase = caseFor(item.metadata);
      if (
        !testCase ||
        !isDeepStrictEqual(safe(testCase.input), item.input) ||
        !isDeepStrictEqual(safe(testCase.expectedOutput), item.expectedOutput)
      )
        throw new AssistantEvalError(
          "Hosted case changed; do not compare different datasets",
        );
    }
    const assistantPath = flag("assistant");
    const module = assistantPath
      ? await import(pathToFileURL(resolve(assistantPath)).href)
      : await import("../src/lib/ai/assistant");
    if (typeof module.completedReply !== "function")
      throw new AssistantEvalError(
        "Assistant module must export completedReply",
      );
    const commit = spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const assistantCommit = spawnSync(
      "git",
      [
        "-C",
        dirname(resolve(assistantPath ?? "src/lib/ai/assistant.ts")),
        "rev-parse",
        "HEAD",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    const result = await dataset.runExperiment({
      name: "spec-92-assistant",
      runName,
      maxConcurrency: 1,
      metadata: {
        model: modelId,
        judgeModel,
        judgeHash,
        datasetHash,
        commit,
        assistantCommit,
        assistantPath: assistantPath ?? "src/lib/ai/assistant.ts",
        intervalMs,
        temperature: 0,
      },
      task: async (item) => {
        const testCase = caseFor(item.metadata);
        return safe(
          await runCase(testCase, pacedModel(modelId), module.completedReply),
        );
      },
      evaluators: [
        async ({ output }) => (output as CaseResult).scores,
        async ({ output, metadata }) => {
          const result = output as CaseResult;
          const testCase = caseFor(metadata);
          const judged = await judgeReply(
            testCase,
            result.reply.text,
            pacedModel(judgeModel),
          );
          return judged;
        },
      ],
    });
    const report: RunReport = {
      model: modelId,
      judgeModel,
      judgeHash,
      datasetHash,
      runName: result.runName,
      experimentId: result.experimentId,
      cases: result.itemResults.map((item) => ({
        caseId: caseFor(item.item.metadata).id,
        scores: item.evaluations.map((score) => ({
          name: score.name,
          value: Number(score.value),
          ...(score.comment ? { comment: score.comment } : {}),
        })),
      })),
    };
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify(
        safe({
          ...report,
          commit,
          assistantCommit,
          datasetRunUrl: result.datasetRunUrl,
          outputs: result.itemResults.map((item) => ({
            caseId: caseFor(item.item.metadata).id,
            output: item.output,
            traceId: item.traceId,
          })),
        }),
        null,
        2,
      ),
    );
    const incomplete =
      report.cases.length !== cases.length ||
      report.cases.some(
        (row) =>
          !row.scores.some((score) => score.name === "reply-rules") ||
          !row.scores.some((score) => score.name === "bookingIntent") ||
          !row.scores.some((score) => score.name === "leadRequest"),
      );
    console.log(
      JSON.stringify({
        runName,
        experimentId: result.experimentId,
        datasetRunUrl: result.datasetRunUrl,
        outputPath,
        incomplete,
        failedCases: report.cases
          .filter((row) => row.scores.some((score) => score.value === 0))
          .map((row) => row.caseId),
      }),
    );
    if (incomplete)
      throw new AssistantEvalError(
        "Experiment incomplete (assistant/judge failure); report saved but not a usable baseline",
      );
  } finally {
    await client.flush();
    await provider.forceFlush();
    await provider.shutdown();
  }
}

async function main() {
  switch (args[0]) {
    case "seed":
      return seed();
    case "run":
      return run();
    case "compare": {
      const baseline = reportSchema.parse(
        JSON.parse(await readFile(required("baseline"), "utf8")),
      );
      const candidate = reportSchema.parse(
        JSON.parse(await readFile(required("candidate"), "utf8")),
      );
      requireCompleteBaseline(
        baseline,
        cases.map((testCase) => ({
          caseId: testCase.id,
          scores: [
            "reply-rules",
            "bookingIntent",
            "leadRequest",
            ...scoreToolCalls(testCase.expectedOutput, []).map(
              (score) => score.name,
            ),
          ],
        })),
      );
      const regressions = compareRuns(baseline, candidate);
      console.log(
        JSON.stringify(
          {
            baseline: baseline.runName,
            candidate: candidate.runName,
            regressions,
          },
          null,
          2,
        ),
      );
      process.exitCode = regressions.length ? 1 : 0;
      return;
    }
    default:
      throw new AssistantEvalError(
        "Usage: bun run eval:assistant seed | run --model ID --name NAME --out PATH [--judge-model ID] [--assistant PATH] | compare --baseline PATH --candidate PATH",
      );
  }
}
main().catch((error) => {
  // Provider errors may contain request bodies or credentials. Never log them.
  console.error(
    "Assistant eval failed:",
    error instanceof AssistantEvalError
      ? error.message
      : "credentials/network/model/validation error (details withheld to protect secrets)",
  );
  process.exitCode = 1;
});
