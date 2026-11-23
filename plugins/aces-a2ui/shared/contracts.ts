import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Agents must carry this label (truthy value) to get the A2UI tool + instructions. */
export const A2UI_LABEL = "aces-a2ui";

/** Timeline item kind rendered by this plugin's client renderer. */
export const A2UI_TIMELINE_KIND = "a2ui-surface";
export const A2UI_TIMELINE_VERSION = 1;

/** Default card/surface id used when the agent passes none. */
export const DEFAULT_SURFACE_ID = "main";

/**
 * Data of one `a2ui-surface` timeline item. `messages` stays loose `unknown`:
 * the server validates them against the A2UI 1.0 schemas, the client narrows
 * them in `client/a2ui/state.ts`.
 */
export const A2uiSurfaceDataSchema = z.object({
  surfaceId: z.string(),
  title: z.string().optional(),
  catalogId: z.string().optional(),
  messages: z.array(z.unknown()),
});
export type A2uiSurfaceData = z.infer<typeof A2uiSurfaceDataSchema>;

/** Client → server: a button press on a rendered surface, forwarded to the agent. */
export const a2uiActionRpc = defineRpc({
  name: "a2ui.action",
  input: z.object({
    agentId: z.string(),
    surfaceId: z.string(),
    eventId: z.string().min(1),
    action: z.unknown().optional(),
  }),
  output: z.object({ ok: z.boolean(), reason: z.string().optional() }),
});

/** Hermes-safe unique-enough dispatch id: no crypto.randomUUID guarantee in RN. */
export function newA2uiEventId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
