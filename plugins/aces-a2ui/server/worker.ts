import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";

/**
 * Bridge to `server/a2ui-worker.mjs`, the plain Node CLI that does all A2UI work
 * (compile, validate, prompt instructions). Plugin server code must never import
 * `@a2ui/*`: the daemon evaluates the TS-entry bundle with its own `require`, where
 * `zod` resolves to the daemon's zod 4, while `@a2ui/web_core` is built for zod 3
 * and crashes at import time. The worker runs as a separate Node process against
 * this plugin's own `node_modules`, so its zod 3 resolves correctly.
 */

const PLUGIN_ID = "aces-a2ui";
const WORKER_RELATIVE_PATH = path.join("server", "a2ui-worker.mjs");
const WORKER_TIMEOUT_MS = 30_000;
const WORKER_MAX_BUFFER = 8 * 1024 * 1024;

export type WorkerMode =
  | { kind: "instructions" }
  | { kind: "compile"; surfaceId: string; source: string }
  | { kind: "validate"; messages: unknown[] };

let cachedPluginDir: string | undefined;

/**
 * This plugin's installation/source directory: where `server/a2ui-worker.mjs` and
 * the `node_modules` it resolves `@a2ui/*` from live. The plugin SDK context
 * exposes no plugin directory (`PluginServerContext` in
 * `@getpaseo/plugin/server` `contracts.d.ts` carries none), so read the path from
 * the daemon's own plugin registry, which is also the directory the daemon
 * compiles the server bundle from. `PASEO_PLUGIN_DIR` overrides for tests.
 */
function pluginDir(): string {
  cachedPluginDir ??= discoverPluginDir();
  return cachedPluginDir;
}

function discoverPluginDir(): string {
  const override = process.env.PASEO_PLUGIN_DIR;
  if (override) return path.resolve(override);
  const home = process.env.PASEO_HOME || path.join(homedir(), ".paseo");
  const configPath = path.join(home, "config.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      plugins?: Record<string, { path?: string }>;
    };
    const configured = config.plugins?.[PLUGIN_ID]?.path;
    if (configured) return path.resolve(configured);
  } catch {
    // Unreadable or not JSON: report below instead of failing silently.
  }
  throw new Error(
    `Cannot find the ${PLUGIN_ID} plugin directory (looked at ${configPath}); ` +
      "set PASEO_PLUGIN_DIR to the directory containing paseo-plugin.json.",
  );
}

/**
 * Runs one worker command and parses its JSON output.
 *
 * @throws Error carrying the worker's message on non-zero exit, invalid output
 *         JSON, timeout, or output over the buffer cap.
 */
export async function runWorker(mode: WorkerMode): Promise<unknown> {
  const pluginDirectory = pluginDir();
  const args = [path.join(pluginDirectory, WORKER_RELATIVE_PATH), mode.kind];
  if (mode.kind === "compile") args.push("--surfaceId", mode.surfaceId);
  const input =
    mode.kind === "compile"
      ? mode.source
      : mode.kind === "validate"
        ? JSON.stringify(mode.messages)
        : undefined;
  return spawnWorker(pluginDirectory, args, input);
}

async function spawnWorker(cwd: string, args: string[], input: string | undefined): Promise<unknown> {
  // ELECTRON_RUN_AS_NODE makes process.execPath (an Electron binary when the
  // daemon runs from the desktop app) behave as plain Node for the worker.
  const child: ChildProcessWithoutNullStreams = spawnProcess(process.execPath, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    cwd,
    stdio: "pipe",
  });

  let stdout = "";
  let stderr = "";
  let oversized = false;
  const append = (current: string, chunk: string): string => {
    if (current.length + chunk.length > WORKER_MAX_BUFFER) {
      oversized = true;
      void terminateProcess(child).catch(() => {});
      return current;
    }
    return current + chunk;
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = append(stderr, chunk);
  });
  // The worker reads stdin to EOF and exits; an EPIPE here only means it died
  // first, which the close handler reports.
  child.stdin.on("error", () => {});
  child.stdin.end(input);

  const { promise: closed, resolve: closedResolve, reject: errored } = Promise.withResolvers<{
    code: number | null;
  }>();
  child.once("error", errored);
  child.once("close", (code) => closedResolve({ code }));

  const { promise: timedOut, reject: timedOutReject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    void terminateProcess(child).catch(() => {});
    timedOutReject(new Error(`A2UI worker timed out after ${WORKER_TIMEOUT_MS} ms.`));
  }, WORKER_TIMEOUT_MS);

  try {
    const { code } = await Promise.race([closed, timedOut]);
    if (code !== 0) {
      if (oversized) throw new Error(`A2UI worker output exceeded ${WORKER_MAX_BUFFER} bytes.`);
      throw new Error(workerFailure(stdout, stderr, code));
    }
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        `A2UI worker printed invalid JSON (stdout: ${JSON.stringify(stdout.slice(0, 200))}` +
          (stderr ? `, stderr: ${JSON.stringify(stderr.slice(0, 200))}` : "") +
          ").",
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/** The worker's failure message: JSON `{"error"}` on stdout, else stderr, else the exit code. */
function workerFailure(stdout: string, stderr: string, code: number | null): string {
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    // Not JSON: fall through to stderr / the exit code.
  }
  return stderr.trim() || `A2UI worker exited with code ${code ?? "null"}.`;
}