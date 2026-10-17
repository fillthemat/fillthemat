/**
 * Assign each git worktree its own local Next.js port.
 *
 * Why: every worktree shares one Docker/Supabase stack (fixed API/DB ports),
 * but each `bun run dev` needs a unique listen port. Auth redirects are
 * allow-listed for the ten origins below (`supabase/config.toml`).
 *
 * Where: claims live in the **shared** git dir, not the worktree:
 *
 *   git rev-parse --git-common-dir   →  usually `<repo>/.git`
 *   `<that>/fillthemat-ports/3010`   →  one-line file, worktree absolute path
 *
 * Linked worktrees have their own checkout but the same `--git-common-dir`,
 * so they all see the same claim files. Example:
 *
 *   .git/fillthemat-ports/3000  →  /Users/you/Code/fillthemat
 *   .git/fillthemat-ports/3010  →  /Users/you/Code/fillthemat/.worktrees/feat-x
 *
 * The file *is* the lock: `writeFileSync(..., { flag: "wx" })` creates it or
 * fails if another setup got there first. Contents are the owning worktree
 * path. If that path is gone, the claim is stale and the next setup reuses
 * the port.
 *
 * Persistence in the worktree is `NEXT_PUBLIC_SITE_URL` in `.env.local`
 * (e.g. http://127.0.0.1:3010). `bun run setup` claims, then writes that URL.
 * `bun run dev` / `dev:stop` parse the port from it. Re-running setup with
 * that URL already set keeps the same port instead of hopping.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tryCapture } from "./local-process";

/** Allowed local Next ports. Must match `supabase/config.toml` redirect URLs. */
export const APP_PORTS = [3000, 3010, 3020, 3030, 3040, 3050, 3060, 3070, 3080, 3090] as const;

/** Directory name under `--git-common-dir` (do not commit; it lives in `.git`). */
const PORTS_DIR = "fillthemat-ports";

export function localSiteUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function portFromSiteUrl(url: string | undefined): number | undefined {
  const match = url?.match(/^http:\/\/127\.0\.0\.1:(\d+)$/);
  if (!match) return undefined;
  const port = Number(match[1]);
  return (APP_PORTS as readonly number[]).includes(port) ? port : undefined;
}

function isListenFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolveFree(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolveFree(true));
    });
  });
}

function git(args: string[]): string | undefined {
  const result = tryCapture("git", args);
  if (!result.ok) return undefined;
  return result.stdout.trim() || undefined;
}

function portFile(gitCommonDir: string, port: number): string {
  return join(gitCommonDir, PORTS_DIR, String(port));
}

function readOwner(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim() || undefined;
}

function dropOtherClaims(gitCommonDir: string, toplevel: string, keep: number) {
  for (const port of APP_PORTS) {
    if (port === keep) continue;
    const file = portFile(gitCommonDir, port);
    if (readOwner(file) === toplevel) {
      try {
        unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
}

export type ClaimAppPortOptions = {
  toplevel: string;
  gitCommonDir: string;
  existingUrl?: string;
  probe?: (port: number) => Promise<boolean>;
};

/** Claim a port for `toplevel` (reuse existing URL / existing claim if any). */
export async function claimAppPort(options: ClaimAppPortOptions): Promise<number> {
  const probe = options.probe ?? isListenFree;
  mkdirSync(join(options.gitCommonDir, PORTS_DIR), { recursive: true });

  const preferred = portFromSiteUrl(options.existingUrl);
  if (options.existingUrl && preferred === undefined) {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL=${options.existingUrl} is not an eligible local origin (use http://127.0.0.1:3000, :3010, … :3090).`,
    );
  }

  if (preferred === undefined) {
    for (const port of APP_PORTS) {
      if (readOwner(portFile(options.gitCommonDir, port)) === options.toplevel) {
        return port;
      }
    }
  }

  const ports = preferred === undefined ? APP_PORTS : [preferred];
  for (const port of ports) {
    const file = portFile(options.gitCommonDir, port);
    const owner = readOwner(file);
    if (owner === options.toplevel) return port;
    if (owner && existsSync(owner)) {
      if (preferred !== undefined) {
        throw new Error(
          `Port ${port} is already claimed by ${owner}. Unset NEXT_PUBLIC_SITE_URL or pick a free origin.`,
        );
      }
      continue;
    }
    if (owner) {
      try {
        unlinkSync(file);
      } catch {
        if (preferred !== undefined) {
          throw new Error(`Port ${port} is already claimed. Retry bun run setup.`);
        }
        continue;
      }
    }
    if (preferred === undefined && !(await probe(port))) continue;
    try {
      writeFileSync(file, `${options.toplevel}\n`, { flag: "wx" });
    } catch {
      if (preferred !== undefined) {
        throw new Error(`Port ${port} is already claimed. Retry bun run setup.`);
      }
      continue;
    }
    dropOtherClaims(options.gitCommonDir, options.toplevel, port);
    return port;
  }

  throw new Error(
    `No free app port in ${APP_PORTS[0]}–${APP_PORTS[APP_PORTS.length - 1]}. Stop an extra bun run dev or remove a stale worktree.`,
  );
}

export async function claimAppPortForCwd(existingUrl?: string): Promise<number> {
  const toplevel = git(["rev-parse", "--show-toplevel"]);
  const gitCommonDirRaw = git(["rev-parse", "--git-common-dir"]);
  if (!toplevel || !gitCommonDirRaw) {
    if (!existingUrl) return APP_PORTS[0];
    const port = portFromSiteUrl(existingUrl);
    if (port === undefined) {
      throw new Error(
        `NEXT_PUBLIC_SITE_URL=${existingUrl} is not an eligible local origin (use http://127.0.0.1:3000, :3010, … :3090).`,
      );
    }
    return port;
  }

  return claimAppPort({
    toplevel,
    gitCommonDir: resolve(gitCommonDirRaw),
    existingUrl,
  });
}
