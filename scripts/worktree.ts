/**
 * Creates a new worktree and sets up an isolated local dev environment for it.
 *
 * Usage:
 *   bun scripts/worktree.ts
 */
const [command, worktreeName] = Bun.argv.slice(2);

if (!command || !worktreeName) {
  console.log("Usage: bun run worktree <create|remove> <name>");
  process.exit(1);
}

const WORKTREE_PATH = `.worktrees/${worktreeName}`;

if (command === "create") {
  Bun.spawnSync(["git", "worktree", "add", WORKTREE_PATH], {
    stdout: "inherit",
    stderr: "inherit",
  });
  Bun.spawnSync(["bun", "setup"], {
    cwd: WORKTREE_PATH,
    stdout: "inherit",
    stderr: "inherit",
  });
} else if (command === "remove") {
  Bun.spawnSync(["supabase", "stack", "destroy", "--yes"], {
    cwd: WORKTREE_PATH,
    stdout: "inherit",
    stderr: "inherit",
  });
  Bun.spawnSync(["git", "worktree", "remove", WORKTREE_PATH], {
    stdout: "inherit",
    stderr: "inherit",
  });
} else {
  console.log("Usage: bun run worktree <create|remove> <name>");
  process.exit(1);
}
