# Architecture

`aces-boards` is the boards plugin in the aces suite — an Agor-style, multi-board
workspace board. Its siblings: `aces-teammates` handles persistent teammates
and memory; `aces-a2ui` renders agents' answers as interactive A2UI 1.0 cards.
This is the canonical, current-state summary; decisions are recorded in
`docs/decisions/`.

## Principles

1. **Build on Paseo, don't reimplement it.** Paseo provides the multi-agent
   harness, multi-provider, worktrees, schedules, and orchestration MCP tools.
   `aces-boards` adds a board surface and a small MCP bridge; there is no
   workflow/DAG engine.
2. **Zones are the whole feature.** A zone has an optional prompt; dropping a
   workspace card into it runs that prompt. A zone with no prompt is a status
   flag.
3. **In-app RN surface.** The board is a native React Native screen (Paseo's
   platform requirement), rendering consistently on desktop/web/mobile.
4. **No external runtime deps.** Only Node builtins + Paseo's host modules
   (`@getpaseo/*`, `zod`, React, React Native). Templating, cron-free scheduling
   (none used), and the MCP JSON-RPC server are hand-rolled.

## Terminology

Card on the board == Paseo **workspace** == Agor "branch". "Zones" are the
droppable regions (arranged in columns). Agor's "Cards (beta)" is unrelated.

## Data model

`~/.paseo/aces/boards.json`:

```json
{
  "boards": [ { "id", "name", "groups": [...], "placement": {...}, "cardDefaults": CardDefaults } ],
  "lastVisitedBoardId": "..."
}
```

- `groups`: `[{ id, title, width?, zones: [{ id, title, trigger? }] }]`.
- `placement`: `{ workspaceId: zoneId }`. **This is membership** — a workspace
  is on a board iff its id is in that board's `placement`; unassigned workspaces
  appear only in the "Find card" picker. Workspaces never leak across boards.
- `cardDefaults`: `{ isolation: "worktree"|"directory", projectCwd?, baseBranch?,
  provider?, modeId?, thinkingOptionId?, prompt? }`.

Workspace cards are derived live from Paseo each poll:
- branch: `workspace.gitRuntime.currentBranch`
- PR pill: `workspace.githubRuntime.pullRequest`
- issue pills: `workspace.labels` with an `issue:` prefix
- session tree: agents in the workspace, parented via `labels["paseo.parent-agent-id"]`
- archived entities filtered (`workspace.archivingAt`, `agent.archivedAt`)
- a synthetic "No workspace" card (`UNASSIGNED_CARD_ID`) collects workspace-less agents

## RPCs (`shared/contracts.ts`)

`board.state` (get current/`boardId` board + workspaces + board list + lastVisited),
`board.create`, `board.rename`, `board.delete`, `board.set-last-visited`,
`board.set-defaults`, `board.projects` (projects + `isGit`), `board.workspaces`
(all workspaces, for Find card), `board.add-zone`, `board.update-zone`,
`board.delete-zone`, `board.move` (drop-to-zone, fires trigger), `board.new-session`,
`board.adopt-card`, `board.create-card` (slugify name → worktree branch / directory;
optional initial agent).

## Board MCP (for agents)

Hand-rolled JSON-RPC-over-HTTP server on `127.0.0.1:0`, injected via
`before("agent.create")` as `mcpServers["aces-boards"]`. Tools: `board_list` (current board +
workspaces + board summaries) and `board_move_card(workspaceId, zoneId, boardId?)`.
Action-firing is implicit in the move — there is no `run_action`.

## Card creation

Zone ⋯ menu → "Add card" → tabs "Create card" / "Find card".

- **Create card**: name (slugified for branch), project picker (from
  `board.projects`, defaults to `cardDefaults.projectCwd`), isolation
  (Worktree/Directory; Worktree + base branch disabled for non-git projects),
  dependent provider→model→mode→thinking dropdowns, and an optional prompt
  template (shared `PromptEditor` with template pills). Server calls
  `paseo.workspaces.create(...)` and places the new workspace in the zone.
- **Find card**: unassigned workspaces first, then other boards (non-selectable
  separators) with their cards; adopting an unassigned workspace places it in
  the zone.

## UI

- Sidebar item **"Boards"** → opens last-visited board.
- Top banner: board-selector dropdown (current checked, + "New board…"), a
  search field (client-side filter), and a settings ⋯ (rename/delete board,
  edit card defaults).
- Zone ⋯ menu: Settings / Add card / Delete.
- Host components from `@getpaseo/plugin/client/react-native` are used where
  available (`Modal`, `TextInput`, `ScrollView`, `useToast`, `Icon`).
- Mobile (`layout.compact`) renders zones vertically stacked.

## Correctness invariants

- Spawning always via `paseo.workspaces.ref(workspaceId).agents.create(...)` —
  never `agents.create({ cwd })`, which auto-creates a new workspace.
- `deleteZone` clears `placement` entries for the removed zone.
- `move` fires the trigger before committing placement.
- All mutation handlers surface errors via `useToast`.
- `structuredClone` for the default board; no shared-reference mutation.

## Deferred / out of scope

Scheduled/lifecycle prompts (Paseo `schedules`), canned prompts (Paseo skills),
agent "fork" (not in the plugin SDK), card action icons for terminal/files/diff
(not exposed by plugin navigation), and multiplayer presence (needs a relay).

## aces-a2ui (interactive answers)

`plugins/aces-a2ui` lets an agent answer with Google's A2UI 1.0 instead of text.

- **Opt-in gate**: the `agent.open.before` hook appends the A2UI Express grammar
  + basic-catalog instructions (`appendSystemPrompt`, ephemeral per open) and
  the `a2ui_render` tool only when `labels["aces-a2ui"]` is truthy and the
  session is interactive. Nothing is persisted anywhere; there is no MCP server.
- **Server pipeline** (`server/`): the TS entries never import `@a2ui/*` — the
  daemon evaluates the server bundle with its own `zod` (v4) while
  `@a2ui/web_core` is built for zod 3, so any import crashes the plugin load.
  `server/worker.ts` bridges to `server/a2ui-worker.mjs`, a plain Node CLI
  (never bundled) spawned via `spawnProcess(process.execPath, …)` with
  `ELECTRON_RUN_AS_NODE=1`, where Express compiles (`ExpressFormat`) and both
  paths validate (`validatePayload`) against the A2UI 1.0 basic catalog;
  `agent-tools.ts` appends the `a2ui-surface` timeline item with id
  `a2ui:<agentId>:<surfaceId>` (same id = live replace) and records the pair
  in `surfaces.ts`.
- **Client renderer** (`client/a2ui/`): hand-rolled state + binding resolution —
  the RN client never imports `@a2ui/*` at runtime (those packages ship DOM/Lit
  code); type-only imports. Renders the v1 subset (Row/Column/List/Card/Text/
  Divider/Image/Icon/Button/TextField/CheckBox/AudioPlayer via `playAudio`);
  anything else renders a visible placeholder. Theme (`theme.colors`) and
  `layout.compact` aware; recursion depth-capped. A per-card **live dataModel**
  (a copy of the message-time model) resolves all bindings: bound TextField/
  CheckBox edits write through into it (`onEdit` → `setDataPath`), so a press
  dispatches the edited values in its action context; the model resets when the
  card is replaced, so edits never survive a re-render (the ephemeral-surface
  contract the agent instructions state).
- **Action round-trip**: a button press goes through the `a2ui.action` RPC with a
  client-generated `eventId` (one per press); the server checks the (agentId,
  surfaceId) pair was rendered by this instance (in-memory map, capped at 64 per
  agent), size-caps the serialized action at 16 KiB, then sends
  `[a2ui action] {"surfaceId":…,"action":…,"eventId":…}` into the agent as a
  user message. The eventId is forwarded, never stored; the agent re-renders
  with the same surfaceId, and an identical `eventId` means a duplicate
  delivery of one press, so it does not repeat non-idempotent side effects.
