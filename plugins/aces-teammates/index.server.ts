import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  teammateBoardsRpc,
  teammateCreateRpc,
  teammateDeleteRpc,
  teammateListRpc,
  teammateStartRpc,
  teammateSyncFrameworkRpc,
  teammateUpdateRpc,
} from "./shared/contracts";
import { ensureFrameworkRepo } from "./server/framework";
import { McpServer } from "./server/mcp";
import { PresenceTracker } from "./server/presence";
import { HeartbeatScheduler, buildHeartbeatPrompt } from "./server/scheduler";
import { buildSystemPrompt, createBoard, FRAMEWORK_VERSION, readBoards, TeammateStore } from "./server/teammates";
import { TEAMMATE_ID_LABEL } from "./server/teammate-prompt";

export default function contribute(server: PluginServerContext) {
  const store = new TeammateStore();
  void ensureFrameworkRepo(FRAMEWORK_VERSION);
  const presence = new PresenceTracker();
  let paseoApi: PaseoApi | null = null;

  const mcpServer = new McpServer();
  mcpServer.attachHandlers({
    listTeammates: () => store.list().map((t) => ({ id: t.id, name: t.name })),
    appendMemory: (teammate, text) => store.appendMemory(teammate, text),
    readMemory: (teammate, days) => store.readMemory(teammate, days),
  });
  mcpServer.start();

  const capturePaseo = (paseo: PaseoApi) => {
    paseoApi = paseo;
  };

  const scheduler = new HeartbeatScheduler(store, () => paseoApi, presence);
  scheduler.start();

  server.before("agent.create", ({ request }, { paseo }) => {
    capturePaseo(paseo);
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers,
          "aces-teammates": { type: "http", url: mcpServer.url(), alwaysLoad: true },
        },
      },
    };
  });

  server.handle(teammateListRpc, (_input, { paseo }) => {
    capturePaseo(paseo);
    return { teammates: store.list() };
  });

  server.handle(teammateBoardsRpc, (_input, { paseo }) => {
    capturePaseo(paseo);
    return { boards: readBoards() };
  });

  server.handle(teammateCreateRpc, async ({ name, description, provider, thinkingOptionId, boardId, boardName, heartbeatCron, persona, emoji }, { paseo }) => {
    await ensureFrameworkRepo(FRAMEWORK_VERSION);
    capturePaseo(paseo);

    let resolvedBoardId = boardId;
    let resolvedBoardName = boardName;
    if (!resolvedBoardId) {
      const board = createBoard(name);
      resolvedBoardId = board.id;
      resolvedBoardName = board.name;
    } else if (!resolvedBoardName) {
      resolvedBoardName = readBoards().find((b) => b.id === resolvedBoardId)?.name;
    }

    const teammate = store.create(name, description, provider, thinkingOptionId, resolvedBoardId, resolvedBoardName, heartbeatCron, persona, emoji);

    const { systemPrompt, provider: resolvedProvider, thinkingOptionId: resolvedThinking } = buildSystemPrompt(store, teammate.id);
    const homeWorkspaceId = await store.ensureWorkspace(teammate.id, paseo);
    const agent = await paseo.workspaces.ref(homeWorkspaceId).agents.create({
      config: { provider: resolvedProvider, thinkingOptionId: resolvedThinking, systemPrompt },
      title: teammate.name,
      prompt: heartbeatCron ? buildHeartbeatPrompt(teammate) : "Introduce yourself and orient to your board.",
      labels: { [TEAMMATE_ID_LABEL]: teammate.id },
    });
    presence.markActive(teammate.id, agent.id);
    store.setLastAgentId(teammate.id, agent.id);

    return { teammate: store.get(teammate.id), agentId: agent.id };
  });

  server.handle(teammateUpdateRpc, ({ id, name, description, provider, thinkingOptionId, boardId, boardName, heartbeatCron, emoji }, { paseo }) => {
    capturePaseo(paseo);
    return { teammate: store.update(id, name, description, provider, thinkingOptionId, boardId, boardName, heartbeatCron, emoji) };
  });

  server.handle(teammateDeleteRpc, ({ id }, { paseo }) => {
    capturePaseo(paseo);
    store.delete(id);
    return { ok: true };
  });

  server.handle(teammateSyncFrameworkRpc, ({ id }, { paseo }) => {
    capturePaseo(paseo);
    return store.syncFramework(id);
  });

  server.handle(teammateStartRpc, async ({ id }, { paseo }) => {
    capturePaseo(paseo);
    if (!paseoApi) throw new Error("Paseo API is not available yet.");
    const { name, systemPrompt, provider, thinkingOptionId } = buildSystemPrompt(store, id);
    const homeWorkspaceId = await store.ensureWorkspace(id, paseo);
    const agent = await paseo.workspaces.ref(homeWorkspaceId).agents.create({
      config: { provider, thinkingOptionId, systemPrompt },
      title: name,
      labels: { [TEAMMATE_ID_LABEL]: id },
    });
    const agentId = agent.id;
    presence.markActive(id, agentId);
    store.setLastAgentId(id, agentId);
    store.clearSyncConflict(id);
    return { agentId };
  });

  server.on("agent.created", async (event, { paseo }) => {
    capturePaseo(paseo);
    try {
      const refetched = await paseo.agents.ref(event.agent.id).refresh();
      const teammateId = refetched?.agent.labels?.[TEAMMATE_ID_LABEL];
      if (typeof teammateId === "string") presence.markActive(teammateId, event.agent.id);
    } catch {
      // ignore — presence is best-effort
    }
  });
  server.on("agent.turn_started", (_event, { paseo }) => capturePaseo(paseo));
  server.on("agent.turn_ended", (event, { paseo }) => void scheduler.onTurnEnded(event.agent.id, paseo));

  return () => {
    scheduler.stop();
    mcpServer.stop();
  };
}
