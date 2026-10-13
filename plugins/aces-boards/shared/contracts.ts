import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ZoneTriggerSchema = z.object({
  session: z.discriminatedUnion("mode", [z.object({ mode: z.literal("new") }), z.object({ mode: z.literal("reuse") })]),
  action: z.enum(["prompt", "spawn"]).default("prompt"),
  provider: z.string().optional(),
  prompt: z.string().min(1),
});
export type ZoneTrigger = z.infer<typeof ZoneTriggerSchema>;

export const ZoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger: ZoneTriggerSchema.nullable().optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const GroupSchema = z.object({
  id: z.string().min(1),
  width: z.number().positive().optional(),
  zones: z.array(ZoneSchema).min(1),
});
export type BoardGroup = z.infer<typeof GroupSchema>;

export const CardDefaultsSchema = z.object({
  isolation: z.enum(["worktree", "directory"]).default("worktree"),
  projectCwd: z.string().optional(),
  baseBranch: z.string().optional(),
  provider: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  prompt: z.string().optional(),
});
export type CardDefaults = z.infer<typeof CardDefaultsSchema>;

export const BoardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  groups: z.array(GroupSchema),
  placement: z.record(z.string(), z.string()).optional(),
  cardDefaults: CardDefaultsSchema.optional(),
});
export type Board = z.infer<typeof BoardSchema>;

export const BoardsDataSchema = z.object({
  boards: z.array(BoardSchema),
  lastVisitedBoardId: z.string().optional(),
});
export type BoardsData = z.infer<typeof BoardsDataSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  parentAgentId: z.string().nullable(),
  attentionReason: z.enum(["permission", "error", "finished"]).optional(),
});
export type Session = z.infer<typeof SessionSchema>;

export const PrSchema = z.object({
  number: z.number(),
  url: z.string(),
  title: z.string(),
  state: z.string(),
});
export type Pr = z.infer<typeof PrSchema>;

export const WorkspaceCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  directory: z.string(),
  branch: z.string().nullable(),
  pr: PrSchema.nullable(),
  issues: z.array(z.string()),
  zoneId: z.string(),
  sessions: z.array(SessionSchema),
});
export type WorkspaceCard = z.infer<typeof WorkspaceCardSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  isGit: z.boolean(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const BoardSummarySchema = z.object({ id: z.string(), name: z.string() });
export type BoardSummary = z.infer<typeof BoardSummarySchema>;

// Read-only coupling to the `aces-teammates` plugin via the filesystem contract
// (~/.paseo/aces/teammates.json + active.json). Only the fields aces-boards needs to
// render presence on the board.
export const BoardTeammateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().optional(),
  lastAgentId: z.string().optional(),
  boardId: z.string().optional(),
});
export type BoardTeammate = z.infer<typeof BoardTeammateSchema>;

export const boardTeammatesRpc = defineRpc({
  name: "board.teammates",
  input: z.object({}).strict(),
  output: z.object({
    teammates: z.array(BoardTeammateSchema),
    active: z.array(z.string()),
  }),
});

export const boardStateRpc = defineRpc({
  name: "board.state",
  input: z.object({ boardId: z.string().optional() }).strict(),
  output: z.object({
    boardId: z.string(),
    board: BoardSchema,
    workspaces: z.array(WorkspaceCardSchema),
    boards: z.array(BoardSummarySchema),
    lastVisitedBoardId: z.string().nullable(),
  }),
});

export const boardCreateRpc = defineRpc({
  name: "board.create",
  input: z.object({ name: z.string().min(1) }).strict(),
  output: z.object({ boardId: z.string() }),
});

export const boardRenameRpc = defineRpc({
  name: "board.rename",
  input: z.object({ boardId: z.string().min(1), name: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardDeleteRpc = defineRpc({
  name: "board.delete",
  input: z.object({ boardId: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardSetLastVisitedRpc = defineRpc({
  name: "board.set-last-visited",
  input: z.object({ boardId: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardSetDefaultsRpc = defineRpc({
  name: "board.set-defaults",
  input: z.object({ boardId: z.string().min(1), cardDefaults: CardDefaultsSchema }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardProjectsRpc = defineRpc({
  name: "board.projects",
  input: z.object({}).strict(),
  output: z.object({ projects: z.array(ProjectSchema) }),
});

export const boardWorkspacesRpc = defineRpc({
  name: "board.workspaces",
  input: z.object({}).strict(),
  output: z.object({ workspaces: z.array(WorkspaceCardSchema) }),
});

export const boardAddZoneRpc = defineRpc({
  name: "board.add-zone",
  input: z.object({ boardId: z.string().min(1), groupId: z.string().min(1).optional(), title: z.string().optional() }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardMoveGroupRpc = defineRpc({
  name: "board.move-group",
  input: z.object({ boardId: z.string().min(1), groupId: z.string().min(1), index: z.number().int().min(0) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardMoveZoneRpc = defineRpc({
  name: "board.move-zone",
  input: z.object({ boardId: z.string().min(1), zoneId: z.string().min(1), groupId: z.string().min(1), index: z.number().int().min(0) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardUpdateZoneRpc = defineRpc({
  name: "board.update-zone",
  input: z
    .object({ boardId: z.string().min(1), zoneId: z.string().min(1), title: z.string().min(1).optional(), trigger: ZoneTriggerSchema.nullable().optional() })
    .strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardDeleteZoneRpc = defineRpc({
  name: "board.delete-zone",
  input: z.object({ boardId: z.string().min(1), zoneId: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardMoveRpc = defineRpc({
  name: "board.move",
  input: z
    .object({ boardId: z.string().min(1), workspaceId: z.string().min(1), zoneId: z.string().min(1), reuseAgentId: z.string().optional() })
    .strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardNewSessionRpc = defineRpc({
  name: "board.new-session",
  input: z.object({ workspaceId: z.string().min(1) }).strict(),
  output: z.object({ agentId: z.string() }),
});

export const boardAdoptCardRpc = defineRpc({
  name: "board.adopt-card",
  input: z.object({ boardId: z.string().min(1), zoneId: z.string().min(1), workspaceId: z.string().min(1) }).strict(),
  output: z.object({ ok: z.boolean() }),
});

export const boardCreateCardRpc = defineRpc({
  name: "board.create-card",
  input: z
    .object({
      boardId: z.string().min(1),
      zoneId: z.string().min(1),
      name: z.string().min(1),
      isolation: z.enum(["worktree", "directory"]),
      projectCwd: z.string().min(1),
      baseBranch: z.string().optional(),
      provider: z.string().optional(),
      modeId: z.string().optional(),
      thinkingOptionId: z.string().optional(),
      prompt: z.string().optional(),
    })
    .strict(),
  output: z.object({ workspaceId: z.string() }),
});

export const boardStartTeammateRpc = defineRpc({
  name: "board.start-teammate",
  input: z.object({ teammateId: z.string().min(1) }).strict(),
  output: z.object({ agentId: z.string() }),
});

export const boardTeammateSessionsRpc = defineRpc({
  name: "board.teammate-sessions",
  input: z.object({ teammateId: z.string().min(1) }).strict(),
  output: z.object({ sessions: z.array(z.object({ id: z.string(), title: z.string() })) }),
});

export const UNASSIGNED_CARD_ID = "__unassigned__";
