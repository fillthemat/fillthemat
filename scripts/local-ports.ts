/**
 * Assign each git worktree its own local Next.js port.
 *
 *
 *
 * Why: give agents in worktrees more freedom to work without conflicting with other agents.
 *
 * Where: claims live in the shared `.git/` dir, not the worktree. Example:
 *
 *   .git/fillthemat-ports/3000  →  /Users/you/Code/fillthemat
 *   .git/fillthemat-ports/3010  →  /Users/you/Code/fillthemat/.worktrees/feat-x
 *   ...
 *   .git/fillthemat-ports/3090  →  /Users/you/Code/fillthemat/.worktrees/feat-z
 *
 * Persistence in the worktree is `NEXT_PUBLIC_SITE_URL` in `.env.local`
 * (e.g. http://127.0.0.1:3010). `bun run setup` claims, then writes that URL.
 * `bun run dev` / `dev:stop` parse the port from it. Re-running setup with
 * that URL already set keeps the same port instead of hopping.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Allowed local Next ports. Must match `supabase/config.toml` redirect URLs. */
export const APP_PORTS = [3000, 3010, 3020, 3030, 3040, 3050, 3060, 3070, 3080, 3090] as const;

/** Directory name under `--git-common-dir` (do not commit; it lives in `.git`). */
const PORTS_DIR = "fillthemat-ports";

export function portFromSiteUrl(url: string | undefined): number | undefined {
  const match = url?.match(/^http:\/\/127\.0\.0\.1:(\d+)$/);
  if (!match) return undefined;
  const port = Number(match[1]);
  return port;
}

export async function claimAppPort(): Promise<number> {
  const procGitTopLevel = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const gitCurrentWorktree = (await new Response(procGitTopLevel.stdout).text()).trim();

  const procGitCommonDir = Bun.spawn(["git", "rev-parse", "--git-common-dir"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const gitCommonDir = (await new Response(procGitCommonDir.stdout).text()).trim();

  mkdirSync(join(gitCommonDir, PORTS_DIR), { recursive: true });

  for (const port of APP_PORTS) {
    const portFile = join(gitCommonDir, PORTS_DIR, String(port));

    // No portFile exists yet, so create and claim it for gitCurrentWorktree.
    if (!(await Bun.file(portFile).exists())) {
      Bun.write(portFile, `${gitCurrentWorktree}\n`);
      return port;
    }

    const portOwner = (await Bun.file(portFile).text()).trim();

    // Port already belongs to gitCurrentWorktree.
    if (portOwner === gitCurrentWorktree) return port;

    // Port belongs to a deleted worktree, so claim it for gitCurrentWorktree.
    if (!existsSync(portOwner)) {
      Bun.write(portFile, `${gitCurrentWorktree}\n`);
      return port;
    }

    // Port belongs to an active worktree, so try the next eligible port.
  }

  throw new Error(
    `No free app port in ${APP_PORTS[0]}–${APP_PORTS[APP_PORTS.length - 1]}. Stop an extra bun run dev or remove a stale worktree.`,
  );
}
