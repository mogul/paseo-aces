import type { PaseoApi } from "@getpaseo/client";
import { UNASSIGNED_CARD_ID, type Board, type Session, type WorkspaceCard } from "../shared/contracts";

const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const ISSUE_LABEL_PREFIX = "issue:";

function parentAgentIdOf(labels: Readonly<Record<string, string>> | undefined): string | null {
  const value = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function attentionReasonOf(agent: { requiresAttention?: boolean; attentionReason?: string | null }): "permission" | "error" | "finished" | undefined {
  if (!agent.requiresAttention) return undefined;
  if (agent.attentionReason === "permission" || agent.attentionReason === "error" || agent.attentionReason === "finished") {
    return agent.attentionReason;
  }
  return undefined;
}

async function collectWorkspaceCards(paseo: PaseoApi): Promise<WorkspaceCard[]> {
  const [workspaceResult, agentResult] = await Promise.all([paseo.workspaces.list(), paseo.agents.list()]);
  const workspaces = workspaceResult.entries.filter((workspace) => !workspace.archivingAt);
  const agents = agentResult.entries.map((entry) => entry.agent).filter((agent) => !agent.archivedAt);

  const cards: WorkspaceCard[] = workspaces.map((workspace) => {
    const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
    const pr = workspace.githubRuntime?.pullRequest ?? null;

    const sessions: Session[] = agents
      .filter((agent) => (agent.workspaceId != null && agent.workspaceId === workspace.id) || (agent.workspaceId == null && agent.cwd === directory))
      .map((agent) => ({
        id: agent.id,
        title: agent.title ?? "(untitled)",
        status: agent.status,
        provider: agent.provider,
        model: agent.model,
        parentAgentId: parentAgentIdOf(agent.labels),
        attentionReason: attentionReasonOf(agent),
      }));

    const issues = (workspace.labels ?? []).filter((label) => label.startsWith(ISSUE_LABEL_PREFIX));

    return {
      id: workspace.id,
      name: workspace.name,
      kind: workspace.workspaceKind,
      directory,
      branch: workspace.gitRuntime?.currentBranch ?? null,
      pr: pr ? { number: pr.number ?? 0, url: pr.url, title: pr.title, state: pr.state } : null,
      issues,
      zoneId: "",
      sessions,
    };
  });

  const matched = new Set(cards.flatMap((card) => card.sessions.map((session) => session.id)));
  const unassigned = agents.filter((agent) => !matched.has(agent.id));
  if (unassigned.length > 0) {
    cards.push({
      id: UNASSIGNED_CARD_ID,
      name: "No workspace",
      kind: "directory",
      directory: "",
      branch: null,
      pr: null,
      issues: [],
      zoneId: "",
      sessions: unassigned.map((agent) => ({
        id: agent.id,
        title: agent.title ?? "(untitled)",
        status: agent.status,
        provider: agent.provider,
        model: agent.model,
        parentAgentId: parentAgentIdOf(agent.labels),
        attentionReason: attentionReasonOf(agent),
      })),
    });
  }

  return cards;
}

/** Every workspace card, regardless of board membership. Used by the "Find card" picker. */
export async function buildAllWorkspaceCards(paseo: PaseoApi): Promise<WorkspaceCard[]> {
  return collectWorkspaceCards(paseo);
}

/** Only the workspaces placed on the given board (plus the synthetic "No workspace" card). */
export async function buildWorkspaceCards(paseo: PaseoApi, board: Board): Promise<WorkspaceCard[]> {
  const cards = await collectWorkspaceCards(paseo);
  const placement = board.placement ?? {};
  const defaultZoneId = board.groups[0]?.zones[0]?.id ?? "";

  return cards
    .filter((card) => card.id === UNASSIGNED_CARD_ID || Object.prototype.hasOwnProperty.call(placement, card.id))
    .map((card) => ({ ...card, zoneId: placement[card.id] ?? defaultZoneId }));
}
