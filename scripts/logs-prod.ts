import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export function buildArgs(filters: string[]): string[] {
  if (filters.length === 1 && filters[0] === "--help")
    return ["logs", "--help"];
  const flags = new Set(
    "--since --until --request-id --status-code --query --limit".split(" "),
  );
  for (let i = 0; i < filters.length; i += 2) {
    if (!flags.has(filters[i]) || !filters[i + 1]?.match(/^[^-]/)) {
      throw new Error("Invalid filters; see bun run logs:prod --help.");
    }
  }
  return "logs --project prj_LMCslFWBFnxPN3ISKqidTBp3kIA7 --scope fillthemat --environment production --non-interactive --no-color"
    .split(" ")
    .concat(filters);
}

export function redact(output: string): string {
  for (const pattern of [
    /(?:\\?["'])?(?:set-cookie|cookie)(?:\\?["'])?\s*[:=]\s*(?:\\?["'][^\r\n]*?\\?["']|[^\r\n]+)/gi,
    /(?:\\?["'])?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization)(?:\\?["'])?\s*[:=]\s*(?:\\?["'][^\r\n]*?\\?["']|Bearer\s+[^\s,;]+|[^\s,;]+)/gi,
    /\bBearer\s+[^\s"'\\,;]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b(?:sk[-_]|re_|gh[pousr]_|vercel_)[\w-]+/gi,
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,
    /(?<![\w.-])(?:\+\d[\d ()-]{7,}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}|\d{10,11})(?![\w.-])/g,
  ])
    output = output.replace(pattern, "[redacted]");
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const command = "run --silent vercel"
      .split(" ")
      .concat(buildArgs(process.argv.slice(2)));
    // A non-Git CLI cwd avoids implicit worktree branch filters and stale links.
    command.push("--cwd", tmpdir());
    const result = spawnSync("bun", command, { encoding: "utf8" });
    if (result.error) throw new Error("CLI failed; narrow the window.");
    process.stdout.write(redact(result.stdout));
    process.stderr.write(redact(result.stderr));
    if (result.status)
      console.error("Auth? Ask a human: bun run vercel login.");
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(redact(String(error)));
    process.exitCode = 1;
  }
}
