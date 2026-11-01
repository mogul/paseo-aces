import { defineAgentTool, type AgentToolDefinition, type AgentToolResult } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { TeammateStore } from "./teammates";

function json(data: unknown): AgentToolResult {
  return { text: JSON.stringify(data) };
}

// IMPORTANT: Do not add teammate create/update/delete tools here. Editing a
// teammate is a human-only operation exposed via plugin RPC (see
// shared/contracts.ts). Exposing an edit tool here would let a teammate modify
// itself or other teammates.
export function createTeammateTools(store: TeammateStore): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "teammate_list",
      description: "List the teammates.",
      input: z.object({}),
      execute: async () => json({ teammates: store.list().map((t) => ({ id: t.id, name: t.name })) }),
    }),

    defineAgentTool({
      name: "teammate_memory_append",
      description: "Append a note to a teammate's memory.",
      input: z.object({
        teammate: z.string(),
        text: z.string(),
      }),
      execute: async (input) => {
        store.appendMemory(input.teammate, input.text);
        return json({ ok: true });
      },
    }),

    defineAgentTool({
      name: "teammate_memory_read",
      description: "Read a teammate's recent memory.",
      input: z.object({
        teammate: z.string(),
        days: z.number().optional(),
      }),
      execute: async (input) => json({ memory: store.readMemory(input.teammate, input.days) }),
    }),
  ];
}
