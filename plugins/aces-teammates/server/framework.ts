import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONAS } from "../shared/personas";
import {
  AGENTS_SEED,
  BOARD_SEED,
  BOOT_SEED,
  HEARTBEAT_SEED,
  SOUL_SEED,
  USER_SEED,
  baseDir,
  identitySeed,
} from "./teammates";

function run(cmd: string, dir: string): string {
  return execSync(cmd, { cwd: dir, encoding: "utf8" });
}

// Pulls a human-readable message out of a thrown execSync error. Prefers git's
// stderr (the actual failure text) over the generic "Command failed: …" prefix.
function gitErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") return stderr.trim();
    if (stderr && typeof stderr === "object" && typeof (stderr as { toString(): string }).toString === "function") {
      const text = (stderr as { toString(): string }).toString();
      if (text.trim()) return text.trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function writeFile(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, "utf8");
}

function branchExists(dir: string, branch: string): boolean {
  try {
    return run(`git branch --list ${branch}`, dir).trim().length > 0;
  } catch {
    return false;
  }
}

export function frameworkDir(): string {
  return join(baseDir(), "framework");
}

export function frameworkBaseBranch(): string {
  try {
    const branch = run("git branch --show-current", frameworkDir()).trim();
    return branch || "main";
  } catch {
    return "main";
  }
}

export function addTeammateWorktree(slug: string, baseBranch: string): string {
  const home = join(baseDir(), "teammates", slug);
  run(`git worktree add ${JSON.stringify(home)} -b tm/${slug} ${baseBranch}`, frameworkDir());
  return home;
}

export function syncTeammateBranch(slug: string, baseBranch: string): { ok: boolean; conflict: boolean; files: string[]; error?: string } {
  const home = join(baseDir(), "teammates", slug);
  try {
    // Safety net: snapshot any uncommitted work first so `git rebase` can run
    // even if the teammate's home is dirty (memory writes, learned-file edits).
    commitSnapshot(home, "aces: snapshot before framework sync");
    run(`git rebase ${baseBranch}`, home);
    return { ok: true, conflict: false, files: [] };
  } catch (error) {
    const message = gitErrorMessage(error);
    try {
      const files = run("git diff --name-only --diff-filter=U", home).trim().split(/\s+/).filter(Boolean);
      if (files.length > 0) return { ok: false, conflict: true, files, error: message };
    } catch {
      // fall through
    }
    return { ok: false, conflict: false, files: [], error: message };
  }
}

function readFrameworkVersion(dir: string): string {
  try {
    return run("git config framework.version", dir).trim();
  } catch {
    return "";
  }
}

function commitIfChanged(dir: string, message: string): void {
  try {
    commitSnapshot(dir, message);
  } catch {
    // nothing to commit, or commit failed — ignore (framework template update)
  }
}

// Commits any uncommitted changes in `dir` as "aces" (the plugin identity), so
// plugin-generated snapshots are clearly distinguishable from a teammate's own
// commits. No-op when the working tree is clean.
export function commitSnapshot(dir: string, message: string): void {
  if (!run("git status --porcelain", dir).trim()) return;
  run("git add -A", dir);
  run(`git -c user.name=aces -c user.email=aces@localhost commit -m ${JSON.stringify(message)}`, dir);
}

// Rewrites the framework template branches to the current seeds. Persona
// SOUL/USER/IDENTITY are preserved; only the framework files (AGENTS/BOOT/
// BOARD/HEARTBEAT) and the blank main identity are refreshed.
function updateTemplate(dir: string, version: string): void {
  const base = run("git branch --show-current", dir).trim() || "main";

  run(`git checkout ${base}`, dir);
  writeFile(dir, "AGENTS.md", AGENTS_SEED);
  writeFile(dir, "BOOT.md", BOOT_SEED);
  writeFile(dir, "BOARD.md", BOARD_SEED);
  writeFile(dir, "HEARTBEAT.md", HEARTBEAT_SEED);
  writeFile(dir, "SOUL.md", SOUL_SEED);
  writeFile(dir, "USER.md", USER_SEED);
  writeFile(dir, "IDENTITY.md", identitySeed("(name)"));
  commitIfChanged(dir, "framework: update template");

  for (const persona of PERSONAS) {
    const branch = `template/${persona.id}`;
    if (!branchExists(dir, branch)) continue;
    run(`git checkout ${branch}`, dir);
    writeFile(dir, "AGENTS.md", AGENTS_SEED);
    writeFile(dir, "BOOT.md", BOOT_SEED);
    writeFile(dir, "BOARD.md", BOARD_SEED);
    writeFile(dir, "HEARTBEAT.md", HEARTBEAT_SEED);
    commitIfChanged(dir, `template/${persona.id}: framework update`);
    run(`git checkout ${base}`, dir);
  }

  run(`git config framework.version ${version}`, dir);
}

function bootstrapRepo(): void {
  const dir = frameworkDir();
  if (existsSync(join(dir, ".git"))) return;

  mkdirSync(dir, { recursive: true });
  run("git init -b main", dir);
  run("git config user.name aces", dir);
  run("git config user.email aces@localhost", dir);
  run("git config commit.gpgsign false", dir);

  writeFile(dir, "AGENTS.md", AGENTS_SEED);
  writeFile(dir, "BOOT.md", BOOT_SEED);
  writeFile(dir, "BOARD.md", BOARD_SEED);
  writeFile(dir, "HEARTBEAT.md", HEARTBEAT_SEED);
  writeFile(dir, "SOUL.md", SOUL_SEED);
  writeFile(dir, "USER.md", USER_SEED);
  writeFile(dir, "IDENTITY.md", identitySeed("(name)"));

  run("git add -A", dir);
  run('git commit -m "framework: initial template"', dir);

  const baseBranch = run("git branch --show-current", dir).trim() || "main";

  for (const persona of PERSONAS) {
    const branch = `template/${persona.id}`;
    if (branchExists(dir, branch)) continue;
    run(`git checkout -b ${branch}`, dir);
    writeFile(dir, "SOUL.md", persona.soul);
    writeFile(dir, "USER.md", persona.user);
    writeFile(dir, "IDENTITY.md", persona.identity || identitySeed("(name)"));
    run("git add -A", dir);
    run(`git commit -m "template/${persona.id}: persona ${persona.name}"`, dir);
    run(`git checkout ${baseBranch}`, dir);
  }
}

let ready: Promise<void> | null = null;

export function ensureFrameworkRepo(version: string): Promise<void> {
  if (!ready) {
    ready = new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          const dir = frameworkDir();
          const wasMissing = !existsSync(join(dir, ".git"));
          bootstrapRepo();
          if (wasMissing) {
            run(`git config framework.version ${version}`, dir);
          } else if (readFrameworkVersion(dir) !== version) {
            updateTemplate(dir, version);
          }
        } catch (error) {
          console.warn(`aces-teammates: failed to update framework repo: ${error instanceof Error ? error.message : String(error)}`);
        }
        resolve();
      }, 0);
    });
  }
  return ready;
}
