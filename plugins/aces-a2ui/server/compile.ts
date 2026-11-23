import { runWorker } from "./worker";
import { DEFAULT_SURFACE_ID } from "../shared/contracts";

/**
 * Compiles A2UI Express source into A2UI 1.0 JSON message envelopes. The
 * source may be raw Express or wrapped in the literal `<a2ui>`/`</a2ui>`
 * sentinel fences the Express rules ask models to use; the fences are
 * stripped, not compiled. The work happens in the worker subprocess
 * (`server/a2ui-worker.mjs`); see `server/worker.ts` for why.
 *
 * @throws Error carrying the worker's message (compile errors include
 *         line/column/help) when the source cannot be read.
 */
export async function compileExpress(text: string, surfaceId: string = DEFAULT_SURFACE_ID): Promise<unknown[]> {
  const result = (await runWorker({ kind: "compile", surfaceId, source: text })) as {
    messages?: unknown;
  };
  if (!Array.isArray(result.messages)) {
    throw new Error("The A2UI worker returned no messages for the Express source.");
  }
  return result.messages;
}

/**
 * Validates compiled or raw messages the way a renderer holding the basic
 * catalog would (stateless: an update may name components an earlier payload
 * added), in the worker subprocess.
 *
 * @throws Error carrying the worker's message when a message is invalid.
 */
export async function validateMessages(messages: unknown[]): Promise<void> {
  await runWorker({ kind: "validate", messages });
}
