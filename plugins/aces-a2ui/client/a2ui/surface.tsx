/**
 * Timeline renderer for `a2ui-surface` items: narrows the item data, applies the
 * A2UI messages to a hand-rolled surface state once per data change, renders the
 * component tree from the root, and routes button presses back to the agent.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { a2uiActionRpc, A2uiSurfaceDataSchema, newA2uiEventId, type A2uiSurfaceData } from "../../shared/contracts";
import { A2uiNodeView } from "./components";
import { rootContext } from "./resolve";
import { applyMessages, setDataPath } from "./state";

export function A2uiSurfaceItem({ theme, layout, agentId, item }: PluginTimelineItemProps<A2uiSurfaceData>): ReactNode {
  // The host validates against the schema before rendering, but a stale or hostile
  // item must degrade to a placeholder, never crash the timeline.
  const data = useMemo(() => {
    const parsed = A2uiSurfaceDataSchema.safeParse(item.data);
    return parsed.success ? parsed.data : null;
  }, [item.data]);
  const state = useMemo(() => (data ? applyMessages(data.messages) : null), [data]);
  // Field edits mutate a live copy of the message-time dataModel; replacing the item's
  // data (a new a2ui_render with the same surfaceId) resets it — the client keeps no
  // cross-render edits by contract.
  const [liveModel, setLiveModel] = useState<Record<string, unknown>>(() => copyModel(state?.dataModel ?? {}));
  useEffect(() => {
    setLiveModel(copyModel(state?.dataModel ?? {}));
  }, [data]);
  const ctx = useMemo(() => rootContext(liveModel), [liveModel]);
  const onEdit = useCallback((path: string, value: unknown) => {
    setLiveModel((model) => {
      const next = copyModel(model);
      setDataPath(next, path, value);
      return next;
    });
  }, []);
  const sendAction = useRpc(a2uiActionRpc);
  const toast = useToast();

  const onAction = useCallback(
    (action: unknown) => {
      if (!data) return;
      const eventId = newA2uiEventId();
      // A refusal means the server no longer knows this surface (plugin restarted,
      // or the press names a card this instance never rendered): tell the user
      // instead of failing silently.
      void sendAction({ agentId, surfaceId: data.surfaceId, eventId, action })
        .then((result) => {
          if (!result.ok) {
            toast.error(`This A2UI card is no longer active (${result.reason ?? "unknown"}). Ask the agent to render it again.`);
          }
        })
        .catch(() => {});
    },
    [agentId, data, sendAction, toast],
  );

  if (!data || !state) {
    return (
      <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }]}>
        <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>This A2UI card could not be rendered.</RNText>
      </View>
    );
  }

  return (
    <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }]}>
      {data.title ? (
        <RNText style={{ color: theme.colors.foreground, fontSize: layout.compact ? 13 : 15, fontWeight: "600" }}>{data.title}</RNText>
      ) : null}
      <A2uiNodeView
        componentId={state.rootId}
        state={state}
        ctx={ctx}
        theme={theme}
        compact={layout.compact}
        depth={0}
        onAction={onAction}
        onEdit={onEdit}
      />
    </View>
  );
}

/** JSON round-trip clone of the data model; RN-safe (no structuredClone assumption). */
function copyModel(model: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(model)) as Record<string, unknown>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
});
