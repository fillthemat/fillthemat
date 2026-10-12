import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function isDocsPath(path: string): boolean {
  return (
    /^[^/]+\.md$/.test(path) ||
    ((path.startsWith("docs/") || path.startsWith(".agents/")) &&
      !/\.(ts|tsx|js|mjs)$/.test(path)) ||
    path === "opencode.json" ||
    path === "opencode.jsonc" ||
    path.startsWith(".github/ISSUE_TEMPLATE/")
  );
}

function decision(code: 0 | 1, reason: string): 0 | 1 {
  console.log(`${code === 0 ? "Skip" : "Build"}: ${reason}`);
  return code;
}

export function ignoredBuildExitCode(
  env: Record<string, string | undefined> = process.env,
  readDiff = (base: string) =>
    execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
      { encoding: "utf8", timeout: 5_000, stdio: "pipe" },
    ),
): 0 | 1 {
  const base = env.VERCEL_GIT_PREVIOUS_SHA;
  if (env.VERCEL_ENV !== "preview") return decision(1, "non-Preview");
  if (!base || !/^[a-f0-9]{40}$/.test(base)) return decision(1, "no base");
  try {
    const diff = readDiff(base);
    if (!diff.endsWith("\0")) return decision(1, "git error");
    const paths = diff.slice(0, -1).split("\0");
    const path = paths.find((path) => !isDocsPath(path));
    return path === undefined
      ? decision(0, "docs-only Preview")
      : decision(1, `non-docs path: ${JSON.stringify(path)}`);
  } catch {
    return decision(1, "git error"); // Base may be outside the depth-10 clone.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(ignoredBuildExitCode());
}
