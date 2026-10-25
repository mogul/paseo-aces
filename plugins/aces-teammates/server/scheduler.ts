import type { PaseoApi } from "@getpaseo/client";
import type { Teammate } from "../shared/contracts";
import { PresenceTracker } from "./presence";
import { buildSystemPrompt, type TeammateStore } from "./teammates";
import { TEAMMATE_HEARTBEAT_LABEL, TEAMMATE_ID_LABEL } from "./teammate-prompt";

const TICK_MS = 20_000;

interface CronFieldSpec {
  min: number;
  max: number;
  sunday7?: boolean;
}

const CRON_FIELDS: readonly CronFieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7, sunday7: true },
];

// Hand-rolled cron field parser. Supports "*", "*/n", "a", "a-b", comma lists
// and an optional "/n" step on any of them (e.g. "0 9 * * 1-5", "*/15 * * * *").
function parseField(field: string, spec: CronFieldSpec): Set<number> | null {
  const values = new Set<number>();
  const items = field.split(",");
  for (const raw of items) {
    const item = raw.trim();
    if (!item) return null;

    const slash = item.indexOf("/");
    const rangePart = slash === -1 ? item : item.slice(0, slash);
    const stepPart = slash === -1 ? undefined : item.slice(slash + 1);
    if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || Number(stepPart) < 1)) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = spec.min;
      end = spec.max;
    } else if (/^\d+$/.test(rangePart)) {
      start = Number(rangePart);
      end = slash === -1 ? start : spec.max;
    } else {
      const match = /^(\d+)-(\d+)$/.exec(rangePart);
      if (!match) return null;
      start = Number(match[1]);
      end = Number(match[2]);
    }

    if (start < spec.min || end > spec.max || start > end) return null;
    for (let value = start; value <= end; value += step) {
      values.add(spec.sunday7 && value === 7 ? 0 : value);
    }
  }
  return values;
}

// Returns true when the five-field expression (minute hour day-of-month month
// day-of-week) matches the given local time. All five fields must match.
export function matchesCron(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const sets: Set<number>[] = [];
  for (let i = 0; i < CRON_FIELDS.length; i++) {
    const parsed = parseField(fields[i], CRON_FIELDS[i]);
    if (!parsed) return false;
    sets.push(parsed);
  }

  return (
    sets[0].has(date.getMinutes()) &&
    sets[1].has(date.getHours()) &&
    sets[2].has(date.getDate()) &&
    sets[3].has(date.getMonth() + 1) &&
    sets[4].has(date.getDay())
  );
}

export function buildHeartbeatPrompt(teammate: Teammate): string {
  // The prompt only supplies dynamic context (which board this teammate is
  // resident on) and points at HEARTBEAT.md. Behavioral rules — including
  // "finish silently when nothing changed" — live in HEARTBEAT.md (seeded from
  // HEARTBEAT_SEED), which the teammate reads and owns. Keeping behavior out of
  // the prompt avoids two sources of truth drifting apart.
  const parts = ["It's time for your heartbeat. Read HEARTBEAT.md and carry out your periodic tasks."];
  if (teammate.boardId) {
    parts.push(
      `You are the resident teammate for board "${teammate.boardName ?? teammate.boardId}" (${teammate.boardId}). ` +
        `Use your board tools (board_list, board_move_card) to review the board and act.`,
    );
  }
  return parts.join(" ");
}

export class HeartbeatScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly live = new Map<string, string>();
  private readonly lastFire = new Map<string, number>();

  constructor(
    private readonly store: TeammateStore,
    private readonly getPaseo: () => PaseoApi | null,
    private readonly presence: PresenceTracker,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onTurnEnded(agentId: string, paseo: PaseoApi): void {
    // Clear presence for any agent (heartbeat- or start-spawned) that finished,
    // and snapshot the teammate's home so its git tree stays clean for sync.
    const teammateId = this.presence.onTurnEnded(agentId);
    if (teammateId) {
      try {
        this.store.commitHome(teammateId, "aces: snapshot after turn");
      } catch (error) {
        console.error(`[aces-teammates] failed to commit home for ${teammateId}:`, error);
      }
    }
    for (const [tmId, liveId] of this.live) {
      if (liveId === agentId) {
        this.live.delete(tmId);
        void paseo.agents.ref(agentId).archive().catch(() => {});
        return;
      }
    }
  }

  private async tick(): Promise<void> {
    const paseo = this.getPaseo();
    if (!paseo) return;

    const now = new Date();
    const minuteBucket = Math.floor(now.getTime() / 60_000);

    for (const teammate of this.store.list()) {
      const cron = teammate.heartbeatCron;
      if (!cron) continue;
      if (this.live.has(teammate.id)) continue;
      if (this.lastFire.get(teammate.id) === minuteBucket) continue;
      if (!matchesCron(cron, now)) continue;

      this.lastFire.set(teammate.id, minuteBucket);
      await this.fire(paseo, teammate);
    }
  }

  private async fire(paseo: PaseoApi, teammate: Teammate): Promise<void> {
    try {
      const { name, systemPrompt, provider, thinkingOptionId } = buildSystemPrompt(this.store, teammate.id);
      const homeWorkspaceId = await this.store.ensureWorkspace(teammate.id, paseo);
      const agent = await paseo.workspaces.ref(homeWorkspaceId).agents.create({
        config: { provider, thinkingOptionId, systemPrompt },
        title: name,
        prompt: buildHeartbeatPrompt(teammate),
        labels: { [TEAMMATE_ID_LABEL]: teammate.id, [TEAMMATE_HEARTBEAT_LABEL]: "true" },
      });
      this.live.set(teammate.id, agent.id);
      this.presence.markActive(teammate.id, agent.id);
      this.store.setLastAgentId(teammate.id, agent.id);
    } catch (error) {
      console.error(`[aces-teammates] heartbeat failed for ${teammate.id}:`, error);
    }
  }
}
