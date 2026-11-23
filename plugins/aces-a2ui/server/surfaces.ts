// Surfaces this plugin instance has actually rendered, per agent. The action RPC
// uses this to refuse forwarding prompts to agents that never got a surface
// from us, so a client cannot inject text into an arbitrary agent.
//
// In-memory only, by design: a surface id that is not in this map after a plugin
// restart is unknown, and the agent has to render again. Never persist it.
const MAX_SURFACES_PER_AGENT = 64;

const surfaces = new Map<string /*agentId*/, Set<string /*surfaceId*/>>();

/** Records that this plugin rendered `surfaceId` for `agentId`. */
export function recordSurface(agentId: string, surfaceId: string): void {
  let ids = surfaces.get(agentId);
  if (!ids) {
    ids = new Set<string>();
    surfaces.set(agentId, ids);
  }
  if (!ids.has(surfaceId) && ids.size >= MAX_SURFACES_PER_AGENT) {
    const oldest = ids.values().next().value;
    if (oldest !== undefined) ids.delete(oldest);
  }
  ids.add(surfaceId);
}

/** True when `surfaceId` was rendered for `agentId` by this plugin instance. */
export function hasSurface(agentId: string, surfaceId: string): boolean {
  return surfaces.get(agentId)?.has(surfaceId) ?? false;
}
