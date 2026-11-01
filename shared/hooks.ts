import type {
  PluginBeforeRequests,
  PluginHookContext,
  PluginLifecycleEvents,
  PluginServerContext,
} from "@getpaseo/plugin/server";

// The 0.15 hook names are `agent.open.before`, `agent.create.after`, and so on.
// Paseo 0.14 ships the same payloads under the legacy names (`agent.session_open`,
// `agent.created`, ...). The shim below registers the modern hook when the host
// exposes `addHook`, and otherwise registers the equivalent legacy hook, so the
// plugins run on both daemons without branching at each call site.
interface HookPayloads {
  "agent.create.before": { request: PluginBeforeRequests["agent.create"] };
  "agent.open.before": { request: PluginBeforeRequests["agent.session_open"] };
  "agent.create.after": PluginLifecycleEvents["agent.created"];
  "agent.turn.before": PluginLifecycleEvents["agent.turn_started"];
  "agent.turn.after": PluginLifecycleEvents["agent.turn_ended"];
  "workspace.create.after": PluginLifecycleEvents["workspace.created"];
}

export type HookName = keyof HookPayloads;

type BeforeHookName = "agent.create.before" | "agent.open.before";

type BeforeRequest<Name extends BeforeHookName> = PluginBeforeRequests[
  Name extends "agent.create.before" ? "agent.create" : "agent.session_open"
];

export type HookResult<Name extends HookName> = Name extends BeforeHookName
  ? BeforeRequest<Name> | void
  : void;

export type HookHandler<Name extends HookName> = (
  payload: HookPayloads[Name],
  context: PluginHookContext,
) => Promise<HookResult<Name>>;

const LEGACY_HOOKS: Record<HookName, { kind: "before" | "event"; name: string }> = {
  "agent.create.before": { kind: "before", name: "agent.create" },
  "agent.open.before": { kind: "before", name: "agent.session_open" },
  "agent.create.after": { kind: "event", name: "agent.created" },
  "agent.turn.before": { kind: "event", name: "agent.turn_started" },
  "agent.turn.after": { kind: "event", name: "agent.turn_ended" },
  "workspace.create.after": { kind: "event", name: "workspace.created" },
};

interface AddHookHost {
  addHook(name: string, handler: (payload: never, context: PluginHookContext) => Promise<unknown>): () => void;
}

interface LegacyHookHost {
  before(name: string, handler: (input: never, context: PluginHookContext) => unknown): () => void;
  on(name: string, handler: (event: never, context: PluginHookContext) => unknown): () => void;
}

export function addHook<Name extends HookName>(
  server: PluginServerContext,
  name: Name,
  handler: HookHandler<Name>,
): () => void {
  const modern = server as unknown as Partial<AddHookHost>;
  if (typeof modern.addHook === "function") {
    return modern.addHook(name, handler as unknown as (payload: never, context: PluginHookContext) => Promise<unknown>);
  }

  const legacy = LEGACY_HOOKS[name];
  const host = server as unknown as LegacyHookHost;

  if (legacy.kind === "before") {
    return host.before(legacy.name, async (input, context) =>
      handler(input as HookPayloads[Name], context),
    );
  }

  return host.on(legacy.name, async (event, context) => {
    await handler(event as HookPayloads[Name], context);
  });
}
