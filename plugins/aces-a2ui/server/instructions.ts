import { runWorker } from "./worker";

// Hand-written Paseo contract: how the a2ui_render tool, the timeline card and the
// button round-trip behave. The A2UI grammar itself comes from ExpressPromptGenerator.
const PASEO_A2UI_CONTRACT = `# Answering with interactive UI (A2UI) on Paseo

- You can render interactive UI cards directly in the chat with the \`a2ui_render\` tool.
  Pass exactly one of: \`express\` (A2UI Express source; the literal <a2ui>...</a2ui> fences
  are optional) or \`messages\` (an array of raw A2UI 1.0 JSON message envelopes).
- Each call is compiled and validated server-side, then rendered as a card in the user's
  timeline. \`surfaceId\` (default "main") names the card: a call with the same surfaceId
  REPLACES that card live, so always send the surface's complete current state (a
  createSurface plus any updateComponents/updateDataModel, in order).
- A press of a button on the card arrives as a user message of the form
  \`[a2ui action] {"eventId":"...","surfaceId":"...","action":{"name":"...","sourceComponentId":"...","context":{...}}}\`.
  Treat it like any user request; usually you reply by calling \`a2ui_render\` again with
  updated components/dataModel reflecting the press.
- The same press may occasionally arrive more than once (double tap, duplicate delivery). An identical \`eventId\` means the same press: don't repeat non-idempotent side effects for it.
- Surfaces are ephemeral: the client keeps no state between renders. Never assume the
  user's local edits (text fields, checkboxes) survived; re-render the full surface from
  your own state on every turn.
- Put dynamic values in the surface \`dataModel\` and bind component properties to them
  with JSON Pointer bindings like \`{"@path": "/user/name"}\`.
- The tool result echoes a summary of what compiled: \`components\` count, \`buttons\` count,
  and the \`events\`/\`functionCalls\` it found. Check it against what you intended (e.g. a
  missing button shows as \`buttons: 0\`).`;

let cached: Promise<string[]> | undefined;

/**
 * Instructions appended to an agent's system prompt on open; built once, cached.
 * A rejected run is not cached: a transient worker failure (spawn timeout, install
 * mid-upgrade) must not poison every later open.
 */
export function buildA2uiInstructions(): Promise<string[]> {
  cached ??= buildInstructions().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}

async function buildInstructions(): Promise<string[]> {
  // The A2UI Express grammar and basic-catalog instructions come from the
  // worker (`server/a2ui-worker.mjs`); this module never imports `@a2ui/*`.
  const result = (await runWorker({ kind: "instructions" })) as {
    baseRules?: unknown;
    catalogInstructions?: unknown;
  };
  if (typeof result.baseRules !== "string" || typeof result.catalogInstructions !== "string") {
    throw new Error("The A2UI worker returned no base rules or catalog instructions.");
  }
  return [PASEO_A2UI_CONTRACT, result.baseRules, result.catalogInstructions];
}
