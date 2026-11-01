import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import {
  boardAddZoneRpc,
  boardAdoptCardRpc,
  boardCreateCardRpc,
  boardCreateRpc,
  boardDeleteRpc,
  boardDeleteZoneRpc,
  boardMoveGroupRpc,
  boardMoveRpc,
  boardMoveZoneRpc,
  boardNewSessionRpc,
  boardProjectsRpc,
  boardRenameRpc,
  boardSetDefaultsRpc,
  boardSetLastVisitedRpc,
  boardStartTeammateRpc,
  boardStateRpc,
  boardTeammateSessionsRpc,
  boardTeammatesRpc,
  boardUpdateZoneRpc,
  boardWorkspacesRpc,
} from "./shared/contracts";
import { BoardStore } from "./server/board";
import { BoardEngine } from "./server/engine";
import { createBoardTools } from "./server/agent-tools";
import { addHook } from "./server/hooks";
import { buildAllWorkspaceCards, buildWorkspaceCards } from "./server/state";
import { DEFAULT_TEAMMATE_PROVIDER, TEAMMATE_HEARTBEAT_LABEL, TEAMMATE_ID_LABEL, buildTeammateSystemPrompt } from "./server/teammate-prompt";
import { readBoardTeammates, readTeammateStart, setTeammateWorkspaceId } from "./server/teammates";

export default function contribute(server: PluginServerContext) {
  const store = new BoardStore();
  const engine = new BoardEngine(store);
  const boardTools = createBoardTools(store, engine);

  const capturePaseo = (paseo: PaseoApi) => {
    engine.attachPaseo(paseo);
  };

  addHook(server, "agent.create.before", async (_payload, context) => {
    capturePaseo(context.paseo);
  });

  // Board tools are available to every agent. Attaching them per launch keeps
  // them out of the agent's saved config, so they never go stale when the
  // plugin is disabled or reloaded.
  addHook(server, "agent.open.before", async (payload, context) => {
    capturePaseo(context.paseo);
    return { ...payload.request, tools: [...payload.request.tools, ...boardTools] };
  });

  server.handle(boardStateRpc, async ({ boardId }, { paseo }) => {
    capturePaseo(paseo);
    const board = boardId ? store.get(boardId) : store.current();
    const workspaces = await buildWorkspaceCards(paseo, board);
    return {
      boardId: board.id,
      board,
      workspaces,
      boards: store.list().map((b) => ({ id: b.id, name: b.name })),
      lastVisitedBoardId: store.lastVisited(),
    };
  });

  server.handle(boardTeammatesRpc, () => {
    const { teammates, active } = readBoardTeammates();
    return { teammates, active };
  });

  server.handle(boardStartTeammateRpc, async ({ teammateId }, { paseo }) => {
    capturePaseo(paseo);
    const teammate = readTeammateStart(teammateId);
    if (!teammate) throw new Error(`Teammate not found: ${teammateId}`);
    let workspaceId = teammate.workspaceId;
    if (!workspaceId) {
      const workspace = await paseo.workspaces.create({ source: { kind: "directory", path: teammate.homeDir }, title: teammate.name, background: true });
      workspaceId = workspace.id;
      setTeammateWorkspaceId(teammate.id, workspaceId);
    }
    const systemPrompt = buildTeammateSystemPrompt({ name: teammate.name, id: teammate.id, homeDir: teammate.homeDir });
    const agent = await paseo.workspaces.ref(workspaceId).agents.create({
      config: { provider: teammate.provider || DEFAULT_TEAMMATE_PROVIDER, thinkingOptionId: teammate.thinkingOptionId, systemPrompt },
      title: teammate.name,
      labels: { [TEAMMATE_ID_LABEL]: teammate.id },
    });
    return { agentId: agent.id };
  });

  server.handle(boardTeammateSessionsRpc, async ({ teammateId }, { paseo }) => {
    capturePaseo(paseo);
    const result = await paseo.agents.list();
    const sessions = result.entries
      .map((entry) => entry.agent)
      .filter((agent) => !agent.archivedAt)
      .filter((agent) => agent.labels?.[TEAMMATE_ID_LABEL] === teammateId)
      .filter((agent) => !agent.labels?.[TEAMMATE_HEARTBEAT_LABEL])
      .map((agent) => ({ id: agent.id, title: agent.title ?? "(untitled)" }));
    return { sessions };
  });

  server.handle(boardCreateRpc, ({ name }) => {
    const board = store.create(name);
    return { boardId: board.id };
  });

  server.handle(boardRenameRpc, ({ boardId, name }) => {
    store.rename(boardId, name);
    return { ok: true };
  });

  server.handle(boardDeleteRpc, ({ boardId }) => {
    store.delete(boardId);
    return { ok: true };
  });

  server.handle(boardSetLastVisitedRpc, ({ boardId }) => {
    store.setLastVisited(boardId);
    return { ok: true };
  });

  server.handle(boardSetDefaultsRpc, ({ boardId, cardDefaults }) => {
    store.setDefaults(boardId, cardDefaults);
    return { ok: true };
  });

  server.handle(boardProjectsRpc, async (_input, { paseo }) => {
    capturePaseo(paseo);
    const result = await paseo.projects.list();
    return {
      projects: result.projects.map((p) => ({ id: p.projectId, name: p.projectDisplayName, path: p.projectRootPath, isGit: p.projectKind === "git" })),
    };
  });

  server.handle(boardWorkspacesRpc, async (_input, { paseo }) => {
    capturePaseo(paseo);
    return { workspaces: await buildAllWorkspaceCards(paseo) };
  });

  server.handle(boardAddZoneRpc, ({ boardId, groupId, title }) => {
    engine.addZone(boardId, groupId, title);
    return { ok: true };
  });

  server.handle(boardMoveGroupRpc, ({ boardId, groupId, index }) => {
    engine.moveGroup(boardId, groupId, index);
    return { ok: true };
  });

  server.handle(boardMoveZoneRpc, ({ boardId, zoneId, groupId, index }) => {
    engine.moveZone(boardId, zoneId, groupId, index);
    return { ok: true };
  });

  server.handle(boardUpdateZoneRpc, ({ boardId, zoneId, title, trigger }) => {
    engine.updateZone(boardId, zoneId, { title, trigger });
    return { ok: true };
  });

  server.handle(boardDeleteZoneRpc, ({ boardId, zoneId }) => {
    engine.deleteZone(boardId, zoneId);
    return { ok: true };
  });

  server.handle(boardMoveRpc, async ({ boardId, workspaceId, zoneId, reuseAgentId }, { paseo }) => {
    capturePaseo(paseo);
    await engine.move(boardId, workspaceId, zoneId, reuseAgentId);
    return { ok: true };
  });

  server.handle(boardNewSessionRpc, async ({ workspaceId }, { paseo }) => {
    capturePaseo(paseo);
    return { agentId: await engine.newSession(workspaceId) };
  });

  server.handle(boardAdoptCardRpc, ({ boardId, zoneId, workspaceId }) => {
    engine.adoptCard(boardId, zoneId, workspaceId);
    return { ok: true };
  });

  server.handle(boardCreateCardRpc, async (input, { paseo }) => {
    capturePaseo(paseo);
    return { workspaceId: await engine.createCard(input) };
  });

  addHook(server, "agent.create.after", async (_payload, context) => {
    capturePaseo(context.paseo);
  });
  addHook(server, "agent.turn.before", async (_payload, context) => {
    capturePaseo(context.paseo);
  });
  addHook(server, "workspace.create.after", async (_payload, context) => {
    capturePaseo(context.paseo);
  });

  return () => {};
}
