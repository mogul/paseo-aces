import { defineAgentTool, type AgentToolDefinition, type AgentToolResult } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { BoardStore } from "./board";
import type { BoardEngine } from "./engine";
import { buildWorkspaceCards } from "./state";

function json(data: unknown): AgentToolResult {
  return { text: JSON.stringify(data) };
}

function failure(error: unknown): AgentToolResult {
  return json({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

export function createBoardTools(store: BoardStore, engine: BoardEngine): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "board_list",
      description: "List the board groups, zones, and workspace cards.",
      input: z.object({}),
      execute: async (_input, context) => {
        const board = store.current();
        const boards = store.list().map((b) => ({ id: b.id, name: b.name }));
        const workspaces = await buildWorkspaceCards(context.paseo, board);
        return json({ board, boards, workspaces });
      },
    }),

    defineAgentTool({
      name: "board_move_card",
      description: "Move a workspace card into a zone.",
      input: z.object({
        workspaceId: z.string(),
        zoneId: z.string(),
        boardId: z.string().optional(),
      }),
      execute: async (input, context) => {
        engine.attachPaseo(context.paseo);
        try {
          await engine.move(input.boardId ?? store.current().id, input.workspaceId, input.zoneId);
          return json({ ok: true });
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineAgentTool({
      name: "board_create_card",
      description: "Create a workspace card in a zone (spawns a git branch/workspace and optionally an initial agent).",
      input: z.object({
        zoneId: z.string(),
        name: z.string(),
        projectCwd: z.string(),
        boardId: z.string().optional(),
        prompt: z.string().optional(),
      }),
      execute: async (input, context) => {
        engine.attachPaseo(context.paseo);
        try {
          const boardId = input.boardId ?? store.current().id;
          const workspaceId = await engine.createCard({
            boardId,
            zoneId: input.zoneId,
            name: input.name,
            projectCwd: input.projectCwd,
            isolation: "worktree",
            prompt: input.prompt,
          });
          return json({ ok: true, workspaceId });
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineAgentTool({
      name: "board_add_zone",
      description: "Add a zone. If groupId is given the zone is appended to that group; otherwise a new group containing the zone is created.",
      input: z.object({
        boardId: z.string().optional(),
        groupId: z.string().optional(),
        title: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          engine.addZone(input.boardId ?? store.current().id, input.groupId, input.title);
          return json({ ok: true });
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineAgentTool({
      name: "board_rename_zone",
      description: "Rename a zone.",
      input: z.object({
        boardId: z.string().optional(),
        zoneId: z.string(),
        title: z.string(),
      }),
      execute: async (input) => {
        try {
          engine.updateZone(input.boardId ?? store.current().id, input.zoneId, { title: input.title });
          return json({ ok: true });
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineAgentTool({
      name: "board_delete_zone",
      description: "Delete a zone.",
      input: z.object({
        boardId: z.string().optional(),
        zoneId: z.string(),
      }),
      execute: async (input) => {
        try {
          engine.deleteZone(input.boardId ?? store.current().id, input.zoneId);
          return json({ ok: true });
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineAgentTool({
      name: "board_move_zone",
      description: "Move a zone into a group at a 0-based position.",
      input: z.object({
        boardId: z.string().optional(),
        zoneId: z.string(),
        groupId: z.string(),
        index: z.number(),
      }),
      execute: async (input) => {
        try {
          engine.moveZone(input.boardId ?? store.current().id, input.zoneId, input.groupId, input.index);
          return json({ ok: true });
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineAgentTool({
      name: "board_move_group",
      description: "Reorder a group (column) to a 0-based position.",
      input: z.object({
        boardId: z.string().optional(),
        groupId: z.string(),
        index: z.number(),
      }),
      execute: async (input) => {
        try {
          engine.moveGroup(input.boardId ?? store.current().id, input.groupId, input.index);
          return json({ ok: true });
        } catch (error) {
          return failure(error);
        }
      },
    }),
  ];
}
