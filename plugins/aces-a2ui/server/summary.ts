// Compact tally of what a render actually produced, echoed in the a2ui_render
// tool result so the agent can self-check (a truncated prompt that lost its
// Button shows up as `buttons: 0`).
//
// Plain TS, no SDK and no `@a2ui/*` imports: this has to stay safe for both the
// daemon-evaluated server bundle and any worker-side caller. Pure and total:
// unknown shapes are skipped, never thrown on.

export interface A2uiRenderSummary {
  components: number;
  buttons: number;
  events: string[];
  functionCalls: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/** Tallies a validated message list. Tolerant of unknown shapes: never throws. */
export function summarizeMessages(messages: unknown[]): A2uiRenderSummary {
  const summary: A2uiRenderSummary = {
    components: 0,
    buttons: 0,
    events: [],
    functionCalls: [],
  };

  for (const message of messages) {
    if (!isPlainObject(message)) continue;
    const body = isPlainObject(message.createSurface)
      ? message.createSurface
      : isPlainObject(message.updateComponents)
        ? message.updateComponents
        : undefined;
    if (!body || !Array.isArray(body.components)) continue;

    for (const entry of body.components) {
      if (!isPlainObject(entry) || typeof entry.component !== "string") continue;
      summary.components++;
      if (entry.component !== "Button" || !isPlainObject(entry.action)) continue;
      summary.buttons++;

      const action = entry.action;
      const event = action.event;
      if (isPlainObject(event) && typeof event.name === "string") {
        pushUnique(summary.events, event.name);
        continue;
      }
      const functionCall = action.functionCall;
      if (!isPlainObject(functionCall)) continue;
      const name =
        typeof functionCall["@call"] === "string"
          ? functionCall["@call"]
          : typeof functionCall["call"] === "string"
            ? functionCall["call"]
            : undefined;
      if (name !== undefined) pushUnique(summary.functionCalls, name);
    }
  }

  return summary;
}
