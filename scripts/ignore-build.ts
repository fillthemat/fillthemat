import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function isDocsPath(path: string): boolean {
  return (
    path.endsWith(".md") ||
    path.startsWith("docs/") ||
    path.startsWith(".agents/") ||
    path === "opencode.json" ||
    path === "opencode.jsonc" ||
    path.startsWith(".github/ISSUE_TEMPLATE/")
  );
}

export function ignoredBuildExitCode(
  env: Record<string, string | undefined> = process.env,
  readDiff = (base: string) =>
    execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
      { encoding: "utf8", timeout: 5_000 },
    ),
): 0 | 1 {
  const base = env.VERCEL_GIT_PREVIOUS_SHA;
  if (env.VERCEL_ENV !== "preview" || !base || !/^[a-f0-9]{40}$/.test(base))
    return 1;
  try {
    const diff = readDiff(base);
    if (!diff.endsWith("\0")) return 1;
    return diff.slice(0, -1).split("\0").every(isDocsPath) ? 0 : 1;
  } catch {
    return 1; // Previous deployment may be outside Vercel's depth-10 clone.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = ignoredBuildExitCode();
  console.log(code === 0 ? "Skip: docs-only Preview" : "Build");
  process.exit(code);
}
