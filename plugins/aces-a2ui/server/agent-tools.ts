import { defineAgentTool } from "@getpaseo/plugin/server";
import type { AgentToolDefinition, AgentToolResult } from "@getpaseo/plugin/server";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
import { catalogId } from "./catalog";
import { compileExpress, validateMessages } from "./compile";
import { recordSurface } from "./surfaces";
import {
  A2UI_TIMELINE_KIND,
  A2UI_TIMELINE_VERSION,
  DEFAULT_SURFACE_ID,
} from "../shared/contracts";

/** The one agent tool this plugin attaches: render (or live-replace) an A2UI card. */
export function createA2uiTools(): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "a2ui_render",
      title: "Render an A2UI surface",
      description:
        "Render or live-update an interactive UI card (A2UI 1.0) in the chat timeline. " +
        "Pass exactly one of `express` (A2UI Express source) or `messages` (raw A2UI 1.0 JSON message envelopes). " +
        "A call with the same `surfaceId` replaces the existing card in place, so send the surface's complete current state.",
      input: z
        .object({
          surfaceId: z.string().min(1).default(DEFAULT_SURFACE_ID),
          title: z.string().min(1).optional(),
          express: z.string().min(1).optional(),
          messages: z.array(z.unknown()).optional(),
        })
        .refine((input) => (input.express !== undefined) !== (input.messages !== undefined), {
          message: "Pass exactly one of `express` or `messages`.",
        }),
      execute: async (input, context): Promise<AgentToolResult> => {
        const surfaceId = input.surfaceId;
        try {
          const messages =
            input.express !== undefined
              ? await compileExpress(input.express, surfaceId)
              : input.messages ?? [];
          await validateMessages(messages);
          // Messages are validated JSON envelopes, so they are JSON-safe by the time they get here.
          const data: Record<string, JsonValue> = {
            surfaceId,
            catalogId,
            messages: messages as JsonValue[],
          };
          if (input.title !== undefined) data.title = input.title;
          await context.paseo.agents.ref(context.agent.id).timeline.append({
            type: "plugin",
            id: `a2ui:${context.agent.id}:${surfaceId}`,
            kind: A2UI_TIMELINE_KIND,
            version: A2UI_TIMELINE_VERSION,
            data,
          });
          recordSurface(context.agent.id, surfaceId);
          return {
            text: JSON.stringify({
              ok: true,
              surfaceId,
              note: "rendered; call again with the same surfaceId to update it live",
            }),
          };
        } catch (error) {
          return {
            isError: true,
            text: JSON.stringify({
              ok: false,
              surfaceId,
              error: error instanceof Error ? error.message : String(error),
              hint: "Fix the payload and call a2ui_render again with the same surfaceId; the full A2UI Express grammar is in your system instructions.",
            }),
          };
        }
      },
    }),
  ];
}
