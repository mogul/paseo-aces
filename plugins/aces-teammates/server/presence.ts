import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Ephemeral "who is currently running" state, shared with the `aces-boards` board via a
// filesystem contract (aces-boards reads active.json the same way aces-teammates reads
// boards.json). It is NOT part of the state repo's git history — see
// scripts/aces-state-init.ps1, which git-ignores active.json. It may go stale if
// the daemon restarts mid-run, which is acceptable for a presence indicator.

function acesBaseDir(): string {
  const base = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(base, "aces");
}

export class PresenceTracker {
  // agentId -> teammateId for every agent this plugin spawns (heartbeat or
  // teammate.start). Multiple agents may point at one teammate; the teammate is
  // active as long as at least one of its agents is live.
  private readonly agentToTeammate = new Map<string, string>();
  private readonly activePath: string;

  constructor() {
    this.activePath = join(acesBaseDir(), "active.json");
  }

  markActive(teammateId: string, agentId: string): void {
    this.agentToTeammate.set(agentId, teammateId);
    this.persist();
  }

  onTurnEnded(agentId: string): string | undefined {
    const teammateId = this.agentToTeammate.get(agentId);
    if (teammateId === undefined) return undefined;
    this.agentToTeammate.delete(agentId);
    this.persist();
    return teammateId;
  }

  // Writes { "<teammateId>": true } for every currently-active teammate.
  private persist(): void {
    const active: Record<string, boolean> = {};
    for (const teammateId of this.agentToTeammate.values()) {
      active[teammateId] = true;
    }
    try {
      mkdirSync(acesBaseDir(), { recursive: true });
      const tmp = this.activePath + ".tmp";
      writeFileSync(tmp, JSON.stringify(active, null, 2), "utf8");
      renameSync(tmp, this.activePath);
    } catch (error) {
      console.error("[aces-teammates] failed to persist active.json:", error);
    }
  }
}
