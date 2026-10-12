import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const queueEntry = z.object({
  position: z.number().int().nonnegative(),
  state: z.string().min(1),
});

function runGraphql(query: string, id: string) {
  return runGh(["api", "graphql", "-f", `query=${query}`, "-f", `id=${id}`]);
}

function runGh(args: string[], allowedStatuses = [0]) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === null || !allowedStatuses.includes(result.status)) {
    throw new Error(result.stderr.trim() || "gh command failed.");
  }
  if (!result.stdout.trim()) {
    throw new Error(result.stderr.trim() || "gh returned no output.");
  }
  return result;
}

export function queuePullRequest(args: string[]) {
  if (args.length !== 1 || !/^[1-9]\d*$/.test(args[0])) {
    throw new Error("Usage: bun run pr:queue <pr-number>");
  }
  const number = args[0];
  const pr = z
    .object({
      id: z.string().min(1),
      state: z.enum(["OPEN", "CLOSED", "MERGED"]),
    })
    .parse(
      JSON.parse(runGh(["pr", "view", number, "--json", "id,state"]).stdout),
    );
  if (pr.state !== "OPEN")
    throw new Error(`PR #${number} is ${pr.state.toLowerCase()}.`);
  const current = z
    .object({
      data: z.object({
        node: z.object({ mergeQueueEntry: queueEntry.nullable() }),
      }),
    })
    .parse(
      JSON.parse(
        runGraphql(
          "query($id:ID!){node(id:$id){... on PullRequest{mergeQueueEntry{position state}}}}",
          pr.id,
        ).stdout,
      ),
    ).data.node.mergeQueueEntry;
  if (current)
    throw new Error(
      `PR #${number} is already queued (position ${current.position}, state ${current.state}).`,
    );
  // gh 2.102 --json exits 0 even for pending checks; buckets decide (1/8 are fallbacks).
  const result = runGh(
    ["pr", "checks", number, "--required", "--json", "name,bucket"],
    [0, 1, 8],
  );
  const checks = z
    .array(
      z.object({
        name: z.string(),
        bucket: z.enum(["pass", "fail", "pending", "skipping", "cancel"]),
      }),
    )
    .parse(JSON.parse(result.stdout));
  // Refusing skipping is intentionally fail-closed: only pass is accepted.
  const blocked = checks.filter((check) => check.bucket !== "pass");
  if (blocked.length)
    throw new Error(
      `Required checks not passing: ${blocked.map((check) => `${check.name}: ${check.bucket}`).join(", ")}`,
    );
  if (!checks.length || result.status !== 0)
    throw new Error("Cannot confirm all required checks are passing.");
  const enqueued = runGraphql(
    "mutation($id:ID!){enqueuePullRequest(input:{pullRequestId:$id}){mergeQueueEntry{position state}}}",
    pr.id,
  );
  try {
    return z
      .object({
        data: z.object({
          enqueuePullRequest: z.object({ mergeQueueEntry: queueEntry }),
        }),
      })
      .parse(JSON.parse(enqueued.stdout)).data.enqueuePullRequest
      .mergeQueueEntry;
  } catch {
    throw new Error("Enqueue request sent; verify queue state.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.info(JSON.stringify(queuePullRequest(process.argv.slice(2))));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "pr_queue_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  }
}
