// A2UI worker CLI: the only plugin file that may import `@a2ui/*`.
//
// The daemon bundles and evaluates the plugin's TypeScript entries with its own
// `require`, where the `zod` specifier resolves to the daemon's zod 4;
// `@a2ui/web_core` is built for zod 3 and crashes at import time there. This
// script is never imported by the TS entries, so it never enters that bundle:
// `server/worker.ts` spawns it as a plain Node process, and it resolves
// `@a2ui/*` (and web_core's nested zod 3) from this plugin's own node_modules.
//
// Protocol: one JSON document on stdout, exit 0 on success; `{"error": string}`
// and exit 1 on failure. Errors are message-only, never stacks.
//
//   a2ui-worker.mjs instructions
//   a2ui-worker.mjs compile --surfaceId <id>   (Express source on stdin)
//   a2ui-worker.mjs validate                   (JSON message array on stdin)

import { readFileSync } from "node:fs";

/** The message envelopes this plugin lets agents send; mirrors `server/catalog.ts`. */
const ALLOWED_MESSAGES = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"];

function writeJson(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function fail(error) {
  writeJson({ error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

function readStdin() {
  return readFileSync(0, "utf8");
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : undefined;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // Imported lazily so a broken install reports as {"error": ...} instead of a
  // bare module-lookup crash before the handlers above run.
  const { basicCatalog } = await import("@a2ui/web_core/v1_0");
  const { ExpressFormat, ExpressPromptGenerator, validatePayload } = await import("@a2ui/agent");
  const catalogs = [basicCatalog];

  if (command === "instructions") {
    const generator = new ExpressPromptGenerator(catalogs, undefined, ALLOWED_MESSAGES);
    writeJson({
      baseRules: generator.generateBaseRules(),
      catalogInstructions: generator.generateCatalogInstructions(),
    });
    return;
  }

  if (command === "compile") {
    const surfaceId = flagValue(rest, "--surfaceId") ?? "main";
    const source = readStdin().trim();
    if (!source) throw new Error("Empty A2UI Express source.");
    // Same fence handling as server/compile.ts: the literal <a2ui>...</a2ui>
    // sentinel fences are stripped when present; raw Express is compiled as-is.
    const parser = new ExpressFormat(catalogs, { surfaceId, allowedMessages: ALLOWED_MESSAGES }).createParser();
    const messages = [];
    if (parser.hasFormatContent(source, { complete: true })) {
      for (const part of parser.unwrap(source)) {
        if (part.type === "a2ui") messages.push(...parser.compile(part.a2uiRaw, true));
      }
    } else {
      messages.push(...parser.compile(source, true));
    }
    if (messages.length === 0) {
      throw new Error("The A2UI Express source compiled to no messages; it must create or update a surface.");
    }
    validatePayload(catalogs, messages);
    writeJson({ messages });
    return;
  }

  if (command === "validate") {
    const messages = JSON.parse(readStdin());
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("No A2UI messages to render.");
    }
    validatePayload(catalogs, messages);
    writeJson({ ok: true });
    return;
  }

  throw new Error(`Unknown A2UI worker command: ${command ?? "(none)"}`);
}

main().catch(fail);