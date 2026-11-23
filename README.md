# aces — Agentic Coding Enabler Suite

aces is a suite of three [Paseo](https://paseo.sh) plugins that bring Agor-style,
board-based orchestration, persistent AI teammates, and interactive A2UI
answers to Paseo:

- **`aces-boards`** — a board of **zones** where each **workspace** is a card showing its
  branch, pull request, issue pills, and a live session tree. Move a card into a
  zone to run that zone's prompt, or use zones as status flags. Multiple boards,
  per-board card defaults, create/find cards, and a board MCP so agents can read
  and drive the board.
- **`aces-teammates`** — persistent teammates with file-based identity
  (`SOUL.md` / `USER.md` / `IDENTITY.md`) and a daily-journal memory, a bench UI,
  a persona gallery + emoji, and a memory MCP. Give a teammate a resident board
  and a heartbeat and it becomes a **supervisor** that periodically drives that
  board.
- **`aces-a2ui`** — answers as interactive UI: agents compile Google's
  A2UI 1.0 (Express DSL or raw JSON messages) into native timeline cards
  (layout, text, buttons, form fields), with button presses round-tripping
  back into the agent. Opt-in per agent via the `aces-a2ui` label.

Everything builds on Paseo's native facilities (multi-agent harness,
multi-provider, worktrees, schedules, and orchestration MCP tools) rather than
reimplementing them. There is no separate "pipeline" or "action" engine here —
a zone's prompt is the workflow step, and multi-step work is the agent's to
orchestrate.

## Plugins

| Plugin | ID | What it does |
| --- | --- | --- |
| Board | `aces-boards` | Zones + workspace cards (branch/PR/sessions), move-to-zone triggers, multiple boards + card defaults, board MCP |
| Teammates | `aces-teammates` | Persistent identity + file memory, bench UI, personas + emoji, memory MCP, heartbeat supervisor |
| A2UI | `aces-a2ui` | Answers as interactive UI: A2UI 1.0 surfaces rendered natively in the timeline, button actions round-trip into the agent |

## Install

From this repository (`github:mogul/paseo-aces`):

```
paseo plugin install github:mogul/paseo-aces:plugins/aces-boards
paseo plugin install github:mogul/paseo-aces:plugins/aces-teammates
paseo plugin install github:mogul/paseo-aces:plugins/aces-a2ui
```

Or from a local checkout:

```
paseo plugin install /absolute/path/to/paseo-aces/plugins/aces-boards
paseo plugin install /absolute/path/to/paseo-aces/plugins/aces-teammates
paseo plugin install /absolute/path/to/paseo-aces/plugins/aces-a2ui
```

## Roadmap

Shipped: board, multiple boards + card defaults, board MCP, teammates + memory,
supervisor (board-resident agent), persona gallery + emoji, presence, template
versioning, state-as-git, and A2UI 1.0 timeline cards.

Next: the **discussion plane** (a human/agent message layer above sessions, with
drop-in/steer). See `docs/roadmap.md` for the full backlog (multiplayer
presence, card action icons, a Knowledge-like shared store, and more).

## State (version control)

Both plugins store their runtime state in one shared, git-versioned directory
under the daemon's Paseo home (`$PASEO_HOME`, defaulting to `~/.paseo`):

```
~/.paseo/aces/
  boards.json                # aces-boards: board layout, placement, card defaults
  teammates.json             # aces-teammates: teammate index
  teammates/<slug>/          # aces-teammates: SOUL.md, USER.md, memory/, …
  active.json                # aces-teammates: ephemeral "running now" set (gitignored)
```

`active.json` records which teammates currently have a running session so the
board can light them up; it is transient and excluded from version control
(the setup script writes a `.gitignore` entry for it).

On first load each plugin migrates any state found under the previous
`~/.paseo/ace` directory or the legacy `~/.paseo/plugins/ace` /
`~/.paseo/plugins/ace-teammates` locations into `~/.paseo/aces` (copy only;
previous files are left in place).

To version-control this directory, run the one-shot setup script with your
remote as the argument:

```
.\scripts\aces-state-init.ps1 https://github.com/user/paseo-aces-state.git
./scripts/aces-state-init.sh  https://github.com/user/paseo-aces-state.git
```

After that, from inside `~/.paseo/aces`:

```
git add -A; git commit -m "aces state snapshot"   # commit current state
git push                                         # push to origin
git pull --rebase                                # pull remote changes
git log --oneline                                # inspect history
git checkout <sha> -- .                          # restore files to a snapshot
```

## Development

Each plugin is a standalone `paseo plugin init` project. To typecheck all
plugins:

```
npm install
npm run typecheck
```

See `docs/architecture.md` for the design and `docs/decisions/` for the
rationale (ADRs).

## License

MIT. See [LICENSE](LICENSE).
