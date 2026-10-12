import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const queueEntry = z.object({
  position: z.number().int().positive(),
  state: z.string().min(1),
});

function graphql(query: string, id: string) {
  const output = JSON.parse(
    runGh(["api", "graphql", "-f", `query=${query}`, "-f", `id=${id}`]).stdout,
  );
  if (output.errors?.length) throw new Error(JSON.stringify(output.errors));
  return output;
}

function runGh(args: string[], allowedStatuses = [0]) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === null || !allowedStatuses.includes(result.status)) {
    throw new Error(result.stderr.trim() || "gh command failed.");
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
      graphql(
        "query($id:ID!){node(id:$id){... on PullRequest{mergeQueueEntry{position state}}}}",
        pr.id,
      ),
    ).data.node.mergeQueueEntry;
  if (current)
    throw new Error(
      `PR #${number} is already queued (position ${current.position}, state ${current.state}).`,
    );
  // gh uses 1 for failed checks and 8 for pending checks; both still carry JSON.
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
  const blocked = checks.filter((check) => check.bucket !== "pass");
  if (blocked.length)
    throw new Error(
      `Required checks not passing: ${blocked.map((check) => `${check.name}: ${check.bucket}`).join(", ")}`,
    );
  if (!checks.length || result.status !== 0)
    throw new Error("Cannot confirm all required checks are passing.");
  return z
    .object({
      data: z.object({
        enqueuePullRequest: z.object({ mergeQueueEntry: queueEntry }),
      }),
    })
    .parse(
      graphql(
        "mutation($id:ID!){enqueuePullRequest(input:{pullRequestId:$id}){mergeQueueEntry{position state}}}",
        pr.id,
      ),
    ).data.enqueuePullRequest.mergeQueueEntry;
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
