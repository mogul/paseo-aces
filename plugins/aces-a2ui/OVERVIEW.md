# A2UI

A2UI lets a Paseo agent answer with an interactive UI instead of a paragraph.
The agent describes a surface with Google's A2UI 1.0 protocol (Express DSL or
raw JSON messages); the plugin compiles and validates it server-side and
renders it as a native card in the agent's timeline.

## How it works

- Opt-in per agent: an agent gets the `a2ui_render` tool and the A2UI
  instructions only when its labels carry a truthy `aces-a2ui` value and the
  session is interactive (`purpose: "interactive"`). Both attach per launch via
  the `agent.open.before` hook — nothing is written to the agent's saved
  config, so nothing can go stale.
- The agent calls `a2ui_render` with either `express` (A2UI Express source) or
  `messages` (raw A2UI 1.0 JSON envelopes). The server compiles Express and
  validates both in a worker subprocess (`server/a2ui-worker.mjs`) against the
  A2UI 1.0 basic catalog — the daemon-evaluated server bundle must not import
  `@a2ui/*` (built for zod 3 vs the daemon's zod 4) — then appends a plugin
  timeline item (`a2ui-surface`).
  A call with the same `surfaceId` replaces the previous card in place, so the
  agent can stream live updates into one card. The tool result echoes the
  compiled summary (`components`/`buttons` counts, `events`/`functionCalls`) so
  the agent can self-check what actually rendered.
- The client renderer (`addTimelineRenderer`, kind `a2ui-surface` v1) applies
  the messages to a hand-rolled surface state — the client never imports
  `@a2ui/*` at runtime, because those packages ship DOM/Lit code — and renders
  the v1 basic-catalog subset with native widgets: Row, Column, List, Card,
  Text, Divider, Image, Icon, Button, TextField, CheckBox, and AudioPlayer
  (through Paseo's `playAudio`). Components outside the subset (Modal, Tabs,
  Video, ChoicePicker, Slider, DateTimeInput) render a visible placeholder
  instead of crashing. Styling follows `theme.colors` and tightens under
  `layout.compact`. Bindings resolve against a per-card live dataModel, so
  edits in a bound TextField or CheckBox reach the button's action context;
  replacing the card resets the model.
- A press of a Button lands back in the agent as a user message:
  `[a2ui action] {"eventId":"...","surfaceId":"...","action":{...}}` (each press
  carries a client-generated `eventId` so the agent can dedupe double-delivery).
  The RPC only forwards to
  surfaces this plugin instance actually rendered for that agent (in-memory
  record, capped, never persisted), so a client cannot inject text into an
  arbitrary agent. The agent answers by calling `a2ui_render` again with the
  same `surfaceId`.

## Setup

Requires Paseo 0.17.1 or later. Give an agent the `aces-a2ui` label, e.g.
`paseo run --label aces-a2ui=on "..."`, and ask it something; it can now answer
with a card.

## Limits

Surfaces are ephemeral: they live in the daemon's in-memory timeline only, are
never persisted to agent config or state, and disappear on plugin restart —
recovery is asking the agent again. The rendered subset is the basic catalog
minus Modal/Tabs/Video/pickers; `formatString`/`formatDate`/`pluralize` are
best-effort; `openUrl` opens the platform browser. The Express grammar and
catalog instructions are appended to the agent's system prompt on open
(`appendSystemPrompt`), which is also ephemeral.