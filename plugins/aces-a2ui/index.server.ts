import type { PluginServerContext } from "@getpaseo/plugin/server";
import { a2uiActionRpc, A2UI_LABEL } from "./shared/contracts";
import { createA2uiTools } from "./server/agent-tools";
import { addHook } from "./server/hooks";
import { buildA2uiInstructions } from "./server/instructions";
import { hasSurface } from "./server/surfaces";

export default function contribute(server: PluginServerContext) {
  // Tool + instructions attach only to labeled, interactive agents, per launch.
  // Nothing is persisted to the agent's saved config, so nothing can go stale.
  addHook(server, "agent.open.before", async (payload) => {
    const request = payload.request;
    if (request.purpose !== "interactive") return;
    if (!request.labels[A2UI_LABEL]) return;
    return {
      ...request,
      appendSystemPrompt: [...(request.appendSystemPrompt ?? []), ...(await buildA2uiInstructions())],
      tools: [...request.tools, ...createA2uiTools()],
    };
  });

  // A button press on a rendered surface lands in the agent as a user message;
  // the agent answers by calling a2ui_render again with the same surfaceId.
  // Only surfaces this instance rendered for that agent are eligible, so the RPC
  // can never be used to inject a prompt into an arbitrary agent.
  server.handle(a2uiActionRpc, async (input, { paseo }) => {
    if (!hasSurface(input.agentId, input.surfaceId)) {
      return { ok: false, reason: "unknown surface" };
    }
    const action = input.action ?? null;
    const actionJson = JSON.stringify(action);
    if (actionJson.length > 16384) {
      return { ok: false, reason: "action too large" };
    }
    const agent = paseo.agents.ref(input.agentId);
    // The envelope shape is what `server/instructions.ts` documents to agents:
    // `[a2ui action] {"surfaceId":"...","action":{...},"eventId":"..."}`. The
    // eventId is forwarded only, never stored: it lets the agent dedupe a press
    // that arrives twice.
    await agent.send("[a2ui action] " + JSON.stringify({ surfaceId: input.surfaceId, action, eventId: input.eventId }));
    return { ok: true };
  });

  return () => {};
}
