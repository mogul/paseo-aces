import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const TeammateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().optional(),
  description: z.string().optional(),
  provider: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  lastAgentId: z.string().optional(),
  workspaceId: z.string().optional(),
  boardId: z.string().optional(),
  boardName: z.string().optional(),
  heartbeatCron: z.string().optional(),
  persona: z.string().optional(),
  frameworkVersion: z.string().optional(),
  syncConflict: z.boolean().optional(),
  createdAt: z.string(),
  memoryPath: z.string(),
});
export type Teammate = z.infer<typeof TeammateSchema>;

export const BoardSummarySchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
export type BoardSummary = z.infer<typeof BoardSummarySchema>;

export const teammateListRpc = defineRpc({
  name: "teammate.list",
  input: z.object({}).strict(),
  output: z.object({ teammates: z.array(TeammateSchema) }),
});

export const teammateCreateRpc = defineRpc({
  name: "teammate.create",
  input: z
    .object({
      name: z.string().min(1),
      description: z.string().optional(),
      provider: z.string().optional(),
      thinkingOptionId: z.string().optional(),
      boardId: z.string().optional(),
      boardName: z.string().optional(),
      heartbeatCron: z.string().optional(),
      persona: z.string().optional(),
      emoji: z.string().optional(),
    })
    .strict(),
  output: z.object({ teammate: TeammateSchema, agentId: z.string().optional() }),
});

// Editing a teammate (update/delete) is a HUMAN-ONLY operation. It is exposed
// exclusively as a plugin RPC — reachable from the Teammates view in the Paseo
// app — and must NEVER be added to the teammates MCP server (server/mcp.ts).
// Agents can only reach `teammate_list`, `teammate_memory_append`, and
// `teammate_memory_read`, which is what prevents a teammate from editing itself
// or another teammate.
export const teammateUpdateRpc = defineRpc({
  name: "teammate.update",
  input: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      provider: z.string().optional(),
      thinkingOptionId: z.string().optional(),
      boardId: z.string().optional(),
      boardName: z.string().optional(),
      heartbeatCron: z.string().optional(),
      emoji: z.string().optional(),
    })
    .strict(),
  output: z.object({ teammate: TeammateSchema }),
});

export const teammateBoardsRpc = defineRpc({
  name: "teammate.boards",
  input: z.object({}).strict(),
  output: z.object({ boards: z.array(BoardSummarySchema) }),
});

export const teammateDeleteRpc = defineRpc({
  name: "teammate.delete",
  input: z.object({ id: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const teammateStartRpc = defineRpc({
  name: "teammate.start",
  input: z.object({ id: z.string().min(1), workspaceId: z.string().optional() }).strict(),
  output: z.object({ agentId: z.string() }),
});

export const teammateSyncFrameworkRpc = defineRpc({
  name: "teammate.sync-framework",
  input: z.object({ id: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean(), conflict: z.boolean(), files: z.array(z.string()), error: z.string().optional() }),
});
