# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Read this
before changing plugin code, especially anything that touches agent creation,
MCP servers, tools, or persisted state.

## What this is

`aces` is a suite of three Paseo plugins: `plugins/aces-boards`,
`plugins/aces-teammates`, and `plugins/aces-a2ui`. See `README.md` for the
product and `docs/architecture.md` for the design. Plugin code is trusted,
runs in a subprocess on the daemon machine, and has filesystem access plus a
Paseo SDK (`PaseoApi`).

## Rules that prevent data-corruption bugs

These exist because of a real incident: the plugins injected a plugin-owned HTTP
MCP server into every agent's *saved* config (`config.mcpServers`), and the
ephemeral `http://127.0.0.1:<port>` URL went stale whenever the plugin was
disabled/reloaded/upgraded. Unrelated agents then failed to reopen with
`ECONNREFUSED`. (Fixed in `896cfcd`; detection/cleanup added in `6f6b7c9`.)

1. **Never persist ephemeral, plugin-owned resources.** Anything whose lifetime
   is tied to the plugin subprocess — HTTP MCP servers, ports, URLs, in-memory
   handles — must NOT be written into an agent's saved config, its
   `persistence.metadata`, a schedule target, or any daemon-persisted record.
   It *will* go stale and break agents the next time the plugin restarts.

2. **Prefer `defineAgentTool` + per-launch hooks over MCP servers.**
   - Attach tools in an `agent.open.before` hook (Paseo 0.14 names it
     `agent.session_open`; use the `shared/hooks.ts` shim), returning `tools`,
     never `mcpServers`. Launch-only tools can't go stale.
   - `config.mcpServers` via `agent.create.before` is only for *stable,
     user-owned* servers, never plugin-owned ephemeral ones.
   - Scope injection to the agents that need it: match `request.labels`
     (e.g. `paseo.teammate-id`) and return early otherwise. Don't give every
     agent every tool.

3. **The SDK cannot clean up what you persisted.** `PaseoApi` has no
   agent-config mutation API (`updateAgent` only sets name/labels). Removing
   something already baked into saved records means editing
   `$PASEO_HOME/agents/**/*.json` and `schedules/*.json` directly, which only
   takes effect after a daemon restart. Prefer not to persist in the first
   place.

4. **When a feature changes how it persists data, ship a one-time migration.**
   `shared/stale-mcp.ts` is the template: a `scan` (detect) + `clean` (strip)
   pair, exposed via an RPC and surfaced in the UI as an offer, with a note that
   a daemon restart is required. Any change that obsoletes persisted data needs
   the equivalent, or it leaves every existing user broken.

## Paseo API version notes (0.14 vs 0.15)

- `server.addHook(...)` is **0.15-beta, not 0.14**. Paseo 0.14 uses
  `server.before(...)` / `server.on(...)` with legacy names
  (`agent.create`, `agent.session_open`, `agent.created`, `agent.turn_started`,
  `agent.turn_ended`, `workspace.created`, …).
- `defineAgentTool` **is** available in 0.14 (and is the way to give agents
  tools).
- `shared/hooks.ts` is a compat shim that registers the modern hook name when
  `addHook` exists and the legacy name otherwise. Use it; don't call
  `server.before`/`server.on` directly in `index.server.ts`.
- The paseo.sh docs can describe the *next* (unreleased) release. Verify API
  availability against the installed `@getpaseo/*` types in
  `plugins/*/node_modules` before relying on a doc claim.

## Repo layout and shared code

- Canonical shared code lives in `shared/`. `scripts/sync-shared.mjs` copies
  `shared/*.ts` → `plugins/*/server/` and `shared/*.tsx` → `plugins/*/client/`
  (adding a `// @generated` banner). **Edit the canonical `shared/` file, never
  the synced copy.**
- `npm run typecheck` (repo root) runs the sync and typechecks both plugins.
- Runtime state lives under `$PASEO_HOME` (default `~/.paseo`): our state in
  `~/.paseo/aces/`; the daemon's agent records in `~/.paseo/agents/`; schedules
  in `~/.paseo/schedules/`.

## Development workflow

- Typecheck: `npm run typecheck` (repo root).
- Reload a plugin after changing code:
  `paseo plugin reload aces-boards` (CLI at
  `C:\Program Files\Paseo\resources\bin\paseo.cmd`).
- Commit unsigned: `git commit --no-gpg-sign` (1Password signing is flaky in
  this environment).
- Keep `README.md` and `docs/architecture.md` current when you change behavior —
  stale docs were a contributing factor in the MCP incident above.
