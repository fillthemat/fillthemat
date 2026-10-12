import { beforeEach, expect, it, vi } from "vitest";
import { queuePullRequest } from "./pr-queue";

const gh = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: gh }));

function reply(value: unknown, status = 0, stderr = "") {
  return { stdout: JSON.stringify(value), stderr, status };
}

beforeEach(() => gh.mockReset());

function openPr() {
  gh.mockReturnValueOnce(
    reply({ id: "PR_224", state: "OPEN" }),
  ).mockReturnValueOnce(reply({ data: { node: { mergeQueueEntry: null } } }));
}

it("enqueues passing PRs via GraphQL and returns position and state", () => {
  openPr();
  gh.mockReturnValueOnce(
    reply([{ name: "Unit tests", bucket: "pass" }]),
  ).mockReturnValueOnce(
    reply({
      data: {
        enqueuePullRequest: {
          mergeQueueEntry: { position: 1, state: "QUEUED" },
        },
      },
    }),
  );
  expect(queuePullRequest(["224"])).toEqual({ position: 1, state: "QUEUED" });
  expect(gh).toHaveBeenNthCalledWith(
    3,
    "gh",
    ["pr", "checks", "224", "--required", "--json", "name,bucket"],
    { encoding: "utf8" },
  );
  expect(gh).toHaveBeenNthCalledWith(
    4,
    "gh",
    [
      "api",
      "graphql",
      "-f",
      "query=mutation($id:ID!){enqueuePullRequest(input:{pullRequestId:$id}){mergeQueueEntry{position state}}}",
      "-f",
      "id=PR_224",
    ],
    { encoding: "utf8" },
  );
});

it.each([
  ["fail", 1],
  ["pending", 8],
  ["cancel", 1],
  ["skipping", 0],
])("refuses a required check in the %s bucket", (bucket, status) => {
  openPr();
  gh.mockReturnValueOnce(reply([{ name: "Unit tests", bucket }], status));
  expect(() => queuePullRequest(["224"])).toThrow(`Unit tests: ${bucket}`);
  expect(gh).toHaveBeenCalledTimes(3);
});

it("refuses an already queued PR before checking or enqueueing", () => {
  gh.mockReturnValueOnce(
    reply({ id: "PR_224", state: "OPEN" }),
  ).mockReturnValueOnce(
    reply({
      data: { node: { mergeQueueEntry: { position: 2, state: "QUEUED" } } },
    }),
  );
  expect(() => queuePullRequest(["224"])).toThrow("already queued");
  expect(gh).toHaveBeenCalledTimes(2);
});

it.each(["CLOSED", "MERGED"])(
  "refuses a %s PR before checking or enqueueing",
  (state) => {
    gh.mockReturnValueOnce(reply({ id: "PR_224", state }));
    expect(() => queuePullRequest(["224"])).toThrow(state.toLowerCase());
    expect(gh).toHaveBeenCalledTimes(1);
  },
);

it.each([[], ["0"], ["--admin"], ["224", "--auto"], ["224; echo unsafe"]])(
  "rejects invalid arguments %j without invoking gh",
  (...args) => {
    expect(() => queuePullRequest(args)).toThrow("Usage:");
    expect(gh).not.toHaveBeenCalled();
  },
);

it("prints every blocking check, not passing checks", () => {
  openPr();
  gh.mockReturnValueOnce(
    reply(
      [
        { name: "Lint", bucket: "pass" },
        { name: "Unit tests", bucket: "fail" },
        { name: "Integration tests", bucket: "pending" },
      ],
      1,
    ),
  );
  expect(() => queuePullRequest(["224"])).toThrow(
    "Required checks not passing: Unit tests: fail, Integration tests: pending",
  );
  expect(gh).toHaveBeenCalledTimes(3);
});

it.each([[[]], [[{ name: "Unit tests", bucket: "unknown" }]], [{}]])(
  "fails closed for empty or malformed required checks: %j",
  (checks) => {
    openPr();
    gh.mockReturnValueOnce(reply(checks));
    expect(() => queuePullRequest(["224"])).toThrow();
    expect(gh).toHaveBeenCalledTimes(3);
  },
);

it("does not enqueue when gh cannot read the PR", () => {
  gh.mockReturnValueOnce(reply(null, 1, "Could not resolve pull request"));
  expect(() => queuePullRequest(["224"])).toThrow(
    "Could not resolve pull request",
  );
  expect(gh).toHaveBeenCalledTimes(1);
});

it("does not enqueue when gh cannot read checks", () => {
  openPr();
  gh.mockReturnValueOnce(reply(null, 4, "Authentication required"));
  expect(() => queuePullRequest(["224"])).toThrow("Authentication required");
  expect(gh).toHaveBeenCalledTimes(3);
});

it("surfaces GraphQL enqueue errors rather than reporting success", () => {
  openPr();
  gh.mockReturnValueOnce(
    reply([{ name: "Unit tests", bucket: "pass" }]),
  ).mockReturnValueOnce(
    reply({ errors: [{ message: "Pull request is already queued" }] }),
  );
  expect(() => queuePullRequest(["224"])).toThrow("already queued");
});

it("fails closed when the queue lookup fails", () => {
  gh.mockReturnValueOnce(
    reply({ id: "PR_224", state: "OPEN" }),
  ).mockReturnValueOnce(reply({ errors: [{ message: "Permission denied" }] }));
  expect(() => queuePullRequest(["224"])).toThrow("Permission denied");
  expect(gh).toHaveBeenCalledTimes(2);
});
