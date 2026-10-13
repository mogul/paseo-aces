import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView as HostScrollView, TextInput as HostTextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TextInput as NativeTextInput } from "react-native";
import { Animated, Dimensions, Pressable, ScrollView, Text, View } from "react-native";
import {
  UNASSIGNED_CARD_ID,
  boardAddZoneRpc,
  boardAdoptCardRpc,
  boardCreateCardRpc,
  boardCreateRpc,
  boardDeleteRpc,
  boardDeleteZoneRpc,
  boardMoveGroupRpc,
  boardMoveRpc,
  boardMoveZoneRpc,
  boardNewSessionRpc,
  boardProjectsRpc,
  boardRenameRpc,
  boardSetDefaultsRpc,
  boardSetLastVisitedRpc,
  boardStartTeammateRpc,
  boardStateRpc,
  boardTeammateSessionsRpc,
  boardTeammatesRpc,
  boardUpdateZoneRpc,
  boardWorkspacesRpc,
  type Board,
  type BoardGroup,
  type BoardSummary,
  type BoardTeammate,
  type CardDefaults,
  type Project,
  type Session,
  type WorkspaceCard,
  type Zone,
  type ZoneTrigger,
} from "../shared/contracts";
import { DragSurface, measureInWindow, type DragFrames, type Frame, type Measurable } from "./dnd";
import { ProviderCombobox } from "./provider-combobox";

const DEFAULT_PROVIDER = "opencode/opencode-go/deepseek-v4-flash";
const SUGGESTED_PROMPT = "Review the working tree in {{workspace.directory}} and summarize what changed.";
const TEMPLATES = [
  "{{workspace.name}}",
  "{{workspace.directory}}",
  "{{workspace.kind}}",
  "{{branch.name}}",
  "{{pr.number}}",
  "{{pr.url}}",
  "{{pr.title}}",
  "{{zone.title}}",
];

type CreateCardInput = {
  boardId: string;
  zoneId: string;
  name: string;
  isolation: "worktree" | "directory";
  projectCwd: string;
  baseBranch?: string;
  provider?: string;
  modeId?: string;
  thinkingOptionId?: string;
  prompt?: string;
};

type Overlay =
  | { kind: "zone-settings"; zone: Zone }
  | { kind: "move"; card: WorkspaceCard }
  | { kind: "pick-session"; card: WorkspaceCard; zone: Zone }
  | { kind: "create-find-card"; zone: Zone }
  | { kind: "move-zone"; zone: Zone }
  | { kind: "new-board" }
  | { kind: "rename-board" }
  | { kind: "card-defaults" };

interface MenuItem {
  label: string;
  danger?: boolean;
  checked?: boolean;
  onPress: () => void;
}
interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

type DropTarget = { kind: "group"; index: number } | { kind: "zone"; groupId: string; index: number };

function computeIndicatorRect(board: Board, dragId: string, target: DropTarget, frames: DragFrames): { left: number; top: number; width: number; height: number } | null {
  const colFrames = board.groups.map((c) => frames.groups[c.id]).filter((f): f is Frame => Boolean(f));
  if (target.kind === "group") {
    const remaining = board.groups.filter((c) => c.id !== dragId);
    let x: number;
    if (remaining.length === 0) {
      const df = frames.groups[dragId];
      x = df ? df.x + df.w : 0;
    } else if (target.index === 0) {
      const f = frames.groups[remaining[0].id];
      x = f ? f.x : 0;
    } else if (target.index >= remaining.length) {
      const f = frames.groups[remaining[remaining.length - 1].id];
      x = f ? f.x + f.w + 6 : 0;
    } else {
      const a = frames.groups[remaining[target.index - 1].id];
      x = a ? a.x + a.w + 6 : 0;
    }
    const top = colFrames.length ? Math.min(...colFrames.map((f) => f.y)) : 0;
    const height = colFrames.length ? Math.max(...colFrames.map((f) => f.h)) : 0;
    return { left: x - frames.rootX, top: top - frames.rootY, width: 4, height };
  }
  const col = board.groups.find((c) => c.id === target.groupId);
  const cf = col ? frames.groups[col.id] : undefined;
  if (!col || !cf) return null;
  const remaining = col.zones.filter((z) => z.id !== dragId);
  let y: number;
  if (remaining.length === 0) {
    y = frames.zones[dragId] ? frames.zones[dragId].y : cf.y + 32;
  } else if (target.index === 0) {
    const f = frames.zones[remaining[0].id];
    y = f ? f.y : cf.y;
  } else if (target.index >= remaining.length) {
    const f = frames.zones[remaining[remaining.length - 1].id];
    y = f ? f.y + f.h : cf.y + cf.h;
  } else {
    const a = frames.zones[remaining[target.index - 1].id];
    const b = frames.zones[remaining[target.index].id];
    y = a && b ? (a.y + a.h + b.y) / 2 : 0;
  }
  return { left: cf.x - frames.rootX, top: y - frames.rootY, width: cf.w, height: 4 };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function BoardScreen({ theme, layout, navigation }: PluginScreenProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const getState = useRpc(boardStateRpc);
  const getTeammates = useRpc(boardTeammatesRpc);
  const move = useRpc(boardMoveRpc);
  const addZone = useRpc(boardAddZoneRpc);
  const moveGroup = useRpc(boardMoveGroupRpc);
  const moveZone = useRpc(boardMoveZoneRpc);
  const updateZone = useRpc(boardUpdateZoneRpc);
  const deleteZone = useRpc(boardDeleteZoneRpc);
  const newSession = useRpc(boardNewSessionRpc);
  const createBoard = useRpc(boardCreateRpc);
  const renameBoard = useRpc(boardRenameRpc);
  const deleteBoard = useRpc(boardDeleteRpc);
  const setLastVisited = useRpc(boardSetLastVisitedRpc);
  const setDefaults = useRpc(boardSetDefaultsRpc);
  const adoptCard = useRpc(boardAdoptCardRpc);
  const createCard = useRpc(boardCreateCardRpc);
  const startTeammate = useRpc(boardStartTeammateRpc);
  const getTeammateSessions = useRpc(boardTeammateSessionsRpc);

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
  const rootRef = useRef<View>(null);

  const [drag, setDrag] = useState<{ kind: "group" | "zone"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragDelta = useRef(new Animated.ValueXY()).current;
  const grantRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const framesRef = useRef<DragFrames | null>(null);
  const colRefs = useRef<Record<string, Measurable>>({});
  const zoneRefs = useRef<Record<string, Measurable>>({});

  const query = useQuery({
    queryKey: ["aces-boards", "board", selectedBoardId],
    queryFn: () => getState(selectedBoardId ? { boardId: selectedBoardId } : {}),
    refetchInterval: 3000,
  });

  const teammatesQuery = useQuery({
    queryKey: ["aces-boards", "board-teammates"],
    queryFn: () => getTeammates({}),
    refetchInterval: 3000,
  });

  const c = theme.colors;
  const compact = layout.compact;
  const styles = useMemo(
    () =>
      ({
        root: { flex: 1, backgroundColor: c.surface0 },
        banner: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border },
        bannerSide: { flex: 1, flexDirection: "row", alignItems: "center" },
        selector: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 },
        selectorText: { color: c.foreground, fontSize: 13, fontWeight: "600" },
        teammatesRow: { flexDirection: "row", alignItems: "center", gap: 2 },
        teammateItem: { position: "relative" as const, paddingRight: 4 },
        teammateEmoji: { color: c.foreground, fontSize: 16 },
        teammateEmojiInactive: { opacity: 0.35 },
        teammateActiveDot: { position: "absolute" as const, top: 0, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent },
        search: { flex: 1, color: c.foreground, backgroundColor: c.surface0, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13 },
        dots: { color: c.foreground, fontSize: 18, paddingHorizontal: 6, paddingVertical: 2 },
        col: { width: 260, marginRight: 12, backgroundColor: c.surface1, borderRadius: 10, borderWidth: 1, borderColor: c.border },
        colStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 6, paddingRight: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
        dragSurface: { flex: 1, flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
        colGroup: { backgroundColor: c.surface1, borderRadius: 10, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
        grip: { color: c.foregroundMuted, fontSize: 16, paddingHorizontal: 6, paddingVertical: 2 },
        zoneRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 4, paddingRight: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
        zoneTitle: { color: c.foregroundMuted, fontSize: 12, textTransform: "uppercase" as const, letterSpacing: 0.4, flex: 1, paddingLeft: 4 },
        cards: { padding: 8, gap: 8 },
        hint: { color: c.foregroundMuted, fontSize: 12, padding: 8 },
        addZoneBtn: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, borderStyle: "dashed" as const, alignItems: "center" as const, marginTop: 4 },
        addZoneText: { color: c.foregroundMuted, fontSize: 13 },
      }) as const,
    [c, compact],
  );

  const boardId = query.data?.boardId;
  const board = query.data?.board;
  const workspaces = query.data?.workspaces ?? [];
  const boards = query.data?.boards ?? [];

  const boardTeammates: BoardTeammate[] = boardId
    ? (teammatesQuery.data?.teammates ?? []).filter((t) => t.boardId === boardId)
    : [];
  const activeTeammateIds = new Set(teammatesQuery.data?.active ?? []);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["aces-boards", "board"] });
  }

  function switchBoard(id: string) {
    setSelectedBoardId(id);
    void setLastVisited({ boardId: id }).catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
  }

  async function doMove(card: WorkspaceCard, zoneId: string, reuseAgentId?: string) {
    if (!boardId) return;
    try {
      await move({ boardId, workspaceId: card.id, zoneId, reuseAgentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function doAddZone(groupId?: string) {
    if (!boardId) return;
    try {
      await addZone({ boardId, groupId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
  }

  async function doDeleteBoard() {
    if (!boardId) return;
    try {
      await deleteBoard({ boardId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setSelectedBoardId(null);
    invalidate();
  }

  async function handleCreateBoard(name: string) {
    try {
      const { boardId: newId } = await createBoard({ name });
      setSelectedBoardId(newId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleRenameBoard(name: string) {
    if (!boardId) return;
    try {
      await renameBoard({ boardId, name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleSetDefaults(cardDefaults: CardDefaults) {
    if (!boardId) return;
    try {
      await setDefaults({ boardId, cardDefaults });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleCreateCard(input: CreateCardInput) {
    try {
      await createCard(input);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleAdopt(zone: Zone, workspaceId: string) {
    if (!boardId) return;
    try {
      await adoptCard({ boardId, zoneId: zone.id, workspaceId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  function placeMenu(items: MenuItem[], pageX: number, pageY: number) {
    const root = rootRef.current;
    if (root && typeof root.measureInWindow === "function") {
      try {
        root.measureInWindow((rx, ry) => setMenu({ x: pageX - rx, y: pageY - ry, items }));
        return;
      } catch {
        // fall through to raw coordinates
      }
    }
    setMenu({ x: pageX, y: pageY, items });
  }

  function openBoardSelector(event: { nativeEvent: { pageX: number; pageY: number } }) {
    const items: MenuItem[] = boards.map((b) => ({
      label: b.name,
      checked: b.id === boardId,
      onPress: () => {
        setMenu(null);
        switchBoard(b.id);
      },
    }));
    items.push({
      label: "New board…",
      onPress: () => {
        setMenu(null);
        setOverlay({ kind: "new-board" });
      },
    });
    placeMenu(items, event.nativeEvent.pageX, event.nativeEvent.pageY);
  }

  function openSettingsMenu(event: { nativeEvent: { pageX: number; pageY: number } }) {
    placeMenu(
      [
        { label: "Rename board", onPress: () => { setMenu(null); setOverlay({ kind: "rename-board" }); } },
        { label: "Delete board", danger: true, onPress: () => { setMenu(null); void doDeleteBoard(); } },
        { label: "Edit card defaults", onPress: () => { setMenu(null); setOverlay({ kind: "card-defaults" }); } },
      ],
      event.nativeEvent.pageX,
      event.nativeEvent.pageY,
    );
  }

  async function openTeammateMenu(event: { nativeEvent: { pageX: number; pageY: number } }, teammate: BoardTeammate) {
    let sessions: { id: string; title: string }[] = [];
    try {
      sessions = (await getTeammateSessions({ teammateId: teammate.id })).sessions;
    } catch {
      sessions = [];
    }
    const items: MenuItem[] = [
      {
        label: "New session",
        onPress: () => {
          setMenu(null);
          void startTeammate({ teammateId: teammate.id })
            .then(({ agentId }) => navigation?.openAgent({ agentId }))
            .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
        },
      },
      ...sessions.map((s) => ({
        label: s.title,
        onPress: () => {
          setMenu(null);
          navigation?.openAgent({ agentId: s.id });
        },
      })),
    ];
    placeMenu(items, event.nativeEvent.pageX, event.nativeEvent.pageY);
  }

  function openZoneMenu(event: { nativeEvent: { pageX: number; pageY: number } }, zone: Zone) {
    placeMenu(
      [
        { label: "Settings", onPress: () => { setMenu(null); setOverlay({ kind: "zone-settings", zone }); } },
        { label: "Add card", onPress: () => { setMenu(null); setOverlay({ kind: "create-find-card", zone }); } },
        { label: "Move zone…", onPress: () => { setMenu(null); setOverlay({ kind: "move-zone", zone }); } },
        {
          label: "Delete",
          danger: true,
          onPress: () => {
            setMenu(null);
            if (!boardId) return;
            void deleteZone({ boardId, zoneId: zone.id })
              .then(() => invalidate())
              .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
          },
        },
      ],
      event.nativeEvent.pageX,
      event.nativeEvent.pageY,
    );
  }

  function openGroupMenu(event: { nativeEvent: { pageX: number; pageY: number } }, group: BoardGroup) {
    const index = groups.findIndex((c) => c.id === group.id);
    const items: MenuItem[] = [
      { label: "Add zone", onPress: () => { setMenu(null); void doAddZone(group.id); } },
    ];
    if (index > 0) {
      items.push({
        label: compact ? "Move up" : "Move left",
        onPress: () => {
          setMenu(null);
          void moveGroupBy(index, index - 1);
        },
      });
    }
    if (index < groups.length - 1) {
      items.push({
        label: compact ? "Move down" : "Move right",
        onPress: () => {
          setMenu(null);
          void moveGroupBy(index, index + 1);
        },
      });
    }
    placeMenu(items, event.nativeEvent.pageX, event.nativeEvent.pageY);
  }

  async function moveGroupBy(fromIndex: number, toIndex: number) {
    if (!boardId) return;
    const group = groups[fromIndex];
    if (!group) return;
    try {
      await moveGroup({ boardId, groupId: group.id, index: toIndex });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
  }

  async function handleMoveZone(zone: Zone, groupId: string, index: number) {
    if (!boardId) return;
    try {
      await moveZone({ boardId, zoneId: zone.id, groupId, index });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  function beginDrag(kind: "group" | "zone", id: string, pageX: number, pageY: number) {
    grantRef.current = { x: pageX, y: pageY };
    dragDelta.setValue({ x: 0, y: 0 });
    setDrag({ kind, id });
    setDropTarget(null);
    void measureDragFrames().then((frames) => {
      framesRef.current = frames;
    });
  }

  async function measureDragFrames(): Promise<DragFrames> {
    const rootFrame = rootRef.current ? await measureInWindow(rootRef.current) : null;
    const cols: Record<string, Frame> = {};
    const zones: Record<string, Frame> = {};
    await Promise.all([
      ...Object.entries(colRefs.current).map(async ([id, ref]) => {
        const f = await measureInWindow(ref);
        if (f) cols[id] = f;
      }),
      ...Object.entries(zoneRefs.current).map(async ([id, ref]) => {
        const f = await measureInWindow(ref);
        if (f) zones[id] = f;
      }),
    ]);
    return { rootX: rootFrame?.x ?? 0, rootY: rootFrame?.y ?? 0, groups: cols, zones };
  }

  function computeGroupTarget(pageX: number): number {
    const fr = framesRef.current;
    if (!fr || !drag) return -1;
    const remaining = groups.filter((c) => c.id !== drag.id);
    let index = 0;
    for (const c of remaining) {
      const f = fr.groups[c.id];
      if (f && pageX > f.x + f.w / 2) index++;
    }
    return index;
  }

  function computeZoneTarget(pageX: number, pageY: number): { groupId: string; index: number } | null {
    const fr = framesRef.current;
    if (!fr || !drag) return null;
    let target: BoardGroup | undefined;
    let best = Infinity;
    for (const c of groups) {
      const f = fr.groups[c.id];
      if (!f) continue;
      const d = Math.abs(pageX - (f.x + f.w / 2));
      if (d < best) {
        best = d;
        target = c;
      }
    }
    if (!target) return null;
    const remaining = target.zones.filter((z) => z.id !== drag.id);
    let index = 0;
    for (const z of remaining) {
      const f = fr.zones[z.id];
      if (f && pageY > f.y + f.h / 2) index++;
    }
    return { groupId: target.id, index };
  }

  function moveDrag(pageX: number, pageY: number) {
    if (!drag) return;
    const g = grantRef.current;
    dragDelta.setValue({ x: pageX - g.x, y: pageY - g.y });
    if (drag.kind === "group") {
      const index = computeGroupTarget(pageX);
      if (index >= 0) setDropTarget({ kind: "group", index });
    } else {
      const t = computeZoneTarget(pageX, pageY);
      if (t) setDropTarget({ kind: "zone", groupId: t.groupId, index: t.index });
    }
  }

  function endDrag(pageX: number, pageY: number) {
    if (!drag || !boardId) {
      setDrag(null);
      setDropTarget(null);
      return;
    }
    if (drag.kind === "group") {
      const index = computeGroupTarget(pageX);
      if (index >= 0) {
        void moveGroup({ boardId, groupId: drag.id, index })
          .then(() => invalidate())
          .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
      }
    } else {
      const t = computeZoneTarget(pageX, pageY);
      if (t) {
        void moveZone({ boardId, zoneId: drag.id, groupId: t.groupId, index: t.index })
          .then(() => invalidate())
          .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
      }
    }
    setDrag(null);
    setDropTarget(null);
  }

  function dragTransform(id: string, kind: "group" | "zone") {
    if (!drag || drag.id !== id) return undefined;
    return {
      transform: kind === "group" ? [{ translateX: dragDelta.x }] : [{ translateX: dragDelta.x }, { translateY: dragDelta.y }],
      opacity: 0.5,
      zIndex: 10,
      elevation: 5,
    };
  }

  function toggleCard(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = search.trim().toLowerCase();
  const visibleWorkspaces = q
    ? workspaces.filter((ws) => ws.name.toLowerCase().includes(q) || (ws.branch ?? "").toLowerCase().includes(q))
    : workspaces;

  function renderZone(zone: Zone) {
    const cards = visibleWorkspaces.filter((ws) => ws.zoneId === zone.id);
    return (
      <Animated.View
        key={zone.id}
        ref={(r) => {
          zoneRefs.current[zone.id] = r as Measurable | null;
        }}
        style={dragTransform(zone.id, "zone")}
      >
        <View style={styles.zoneRow}>
          {!compact ? (
            <DragSurface onGrant={(x, y) => beginDrag("zone", zone.id, x, y)} onMove={moveDrag} onRelease={endDrag} style={styles.dragSurface}>
              <Text style={styles.grip}>≡</Text>
              <Text style={styles.zoneTitle} selectable={false}>{zone.title}</Text>
            </DragSurface>
          ) : (
            <Text style={styles.zoneTitle} selectable={false}>{zone.title}</Text>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={`${zone.title} menu`} onPress={(e) => openZoneMenu(e, zone)}>
            <Text style={styles.dots}>⋯</Text>
          </Pressable>
        </View>
        <View style={styles.cards}>
          {cards.length === 0 ? (
            <Text style={styles.hint}>No workspaces</Text>
          ) : (
            cards.map((ws) => (
              <WorkspaceCardView
                key={ws.id}
                card={ws}
                theme={theme}
                expanded={expanded.has(ws.id)}
                onToggle={() => toggleCard(ws.id)}
                onOpenAgent={(agentId) => navigation?.openAgent({ agentId })}
                onMove={() => setOverlay({ kind: "move", card: ws })}
                onNewSession={() => {
                  void newSession({ workspaceId: ws.id })
                    .then(({ agentId }) => {
                      invalidate();
                      navigation?.openAgent({ agentId });
                    })
                    .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
                }}
              />
            ))
          )}
        </View>
      </Animated.View>
    );
  }

  const groups = board?.groups ?? [];
  const indicatorRect = drag && dropTarget && board && framesRef.current ? computeIndicatorRect(board, drag.id, dropTarget, framesRef.current) : null;

  return (
    <View
      ref={rootRef}
      style={styles.root}
      onLayout={(e) => setRootSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <View style={styles.banner}>
        <Pressable accessibilityRole="button" accessibilityLabel="Switch board" onPress={(e) => openBoardSelector(e)} style={styles.selector}>
          <Text style={styles.selectorText}>Board: {board?.name ?? "…"}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>▾</Text>
        </Pressable>
        {boardTeammates.length > 0 ? (
          <View style={styles.teammatesRow}>
            {boardTeammates.map((t) => {
              const active = activeTeammateIds.has(t.id);
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.name} sessions`}
                  onPress={(e) => openTeammateMenu(e, t)}
                  style={styles.teammateItem}
                >
                  <Text style={[styles.teammateEmoji, !active && styles.teammateEmojiInactive]}>{t.emoji ?? "🤖"}</Text>
                  {active ? <View style={styles.teammateActiveDot} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={styles.bannerSide}>
          <HostTextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={c.foregroundMuted}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={[styles.bannerSide, { justifyContent: "flex-end" }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Board settings" onPress={(e) => openSettingsMenu(e)}>
            <Text style={styles.dots}>⋯</Text>
          </Pressable>
        </View>
      </View>

      {compact ? (
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          {groups.map((group) => (
            <View key={group.id} style={styles.colGroup}>
              <View style={[styles.colStrip, { justifyContent: "flex-end" }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="Group options" onPress={(e) => openGroupMenu(e, group)}>
                  <Text style={styles.dots}>⋯</Text>
                </Pressable>
              </View>
              {group.zones.map((zone) => renderZone(zone))}
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => void doAddZone()} style={styles.addZoneBtn}>
            <Text style={styles.addZoneText}>+ Add Zone in new Group</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView horizontal scrollEnabled={!drag} contentContainerStyle={{ padding: 12 }}>
          {groups.map((group) => (
            <Animated.View
              key={group.id}
              ref={(r) => {
                colRefs.current[group.id] = r as Measurable | null;
              }}
              style={[styles.col, dragTransform(group.id, "group")]}
            >
              <View style={styles.colStrip}>
                <DragSurface onGrant={(x, y) => beginDrag("group", group.id, x, y)} onMove={moveDrag} onRelease={endDrag} style={styles.dragSurface}>
                  <Text style={styles.grip}>≡</Text>
                </DragSurface>
                <Pressable accessibilityRole="button" accessibilityLabel="Group options" onPress={(e) => openGroupMenu(e, group)}>
                  <Text style={styles.dots}>⋯</Text>
                </Pressable>
              </View>
              {group.zones.map((zone) => renderZone(zone))}
              <Pressable accessibilityRole="button" onPress={() => void doAddZone(group.id)} style={styles.addZoneBtn}>
                <Text style={styles.addZoneText}>+ Add zone</Text>
              </Pressable>
            </Animated.View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => void doAddZone()} style={[styles.addZoneBtn, { width: 160, alignSelf: "flex-start" }]}>
            <Text style={styles.addZoneText}>+ Add Zone in new Group</Text>
          </Pressable>
        </ScrollView>
      )}

      {indicatorRect ? (
        <View pointerEvents="none" style={{ position: "absolute", left: indicatorRect.left, top: indicatorRect.top, width: indicatorRect.width, height: indicatorRect.height, backgroundColor: c.accent, borderRadius: 2, opacity: 0.9 }} />
      ) : null}

      {menu ? <ContextMenu menu={menu} theme={theme} onClose={() => setMenu(null)} containerWidth={rootSize.width} containerHeight={rootSize.height} /> : null}

      {overlay ? (
        <OverlayView
          overlay={overlay}
          theme={theme}
          boardId={boardId}
          board={board}
          boards={boards}
          onClose={() => setOverlay(null)}
          onSaveZone={async (zoneId, title, trigger) => {
            if (!boardId) return;
            try {
              await updateZone({ boardId, zoneId, title, trigger });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
              return;
            }
            invalidate();
            setOverlay(null);
          }}
          onMove={doMove}
          onPickZone={(card, zone) => {
            if (zone.trigger?.session.mode === "reuse") setOverlay({ kind: "pick-session", card, zone });
            else void doMove(card, zone.id);
          }}
          onCreateCard={handleCreateCard}
          onAdopt={handleAdopt}
          onMoveZone={handleMoveZone}
          onCreatedBoard={handleCreateBoard}
          onRenameBoard={handleRenameBoard}
          onSaveDefaults={handleSetDefaults}
        />
      ) : null}
    </View>
  );
}

function ContextMenu({
  menu,
  theme,
  onClose,
  containerWidth,
  containerHeight,
}: {
  menu: MenuState;
  theme: PluginTheme;
  onClose: () => void;
  containerWidth: number;
  containerHeight: number;
}) {
  const c = theme.colors;
  const width = containerWidth || Dimensions.get("window").width;
  const height = containerHeight || Dimensions.get("window").height;
  const menuWidth = 180;
  const itemHeight = 40;
  const menuHeight = menu.items.length * itemHeight + 2;
  const left = Math.max(8, Math.min(menu.x - menuWidth + 8, width - menuWidth - 8));
  let top = menu.y + 4;
  if (top + menuHeight > height - 8) {
    top = Math.max(8, menu.y - menuHeight - 4);
  }
  return (
    <>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", top, left, width: menuWidth, backgroundColor: c.surface1, borderRadius: 8, borderWidth: 1, borderColor: c.border }}>
        {menu.items.map((item) => (
          <Pressable key={item.label} accessibilityRole="button" onPress={item.onPress} style={{ paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", gap: 6 }}>
            <Text style={{ color: item.danger ? c.statusDanger : c.foreground, fontSize: 14 }}>{item.checked ? "✓ " : ""}{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function cardAttention(card: WorkspaceCard): "error" | "permission" | "finished" | undefined {
  const reasons = card.sessions
    .map((s) => s.attentionReason)
    .filter((r): r is "error" | "permission" | "finished" => r === "error" || r === "permission" || r === "finished");
  if (reasons.includes("error")) return "error";
  if (reasons.includes("permission")) return "permission";
  if (reasons.includes("finished")) return "finished";
  return undefined;
}

function WorkspaceCardView({
  card,
  theme,
  expanded,
  onToggle,
  onOpenAgent,
  onMove,
  onNewSession,
}: {
  card: WorkspaceCard;
  theme: PluginTheme;
  expanded: boolean;
  onToggle: () => void;
  onOpenAgent: (agentId: string) => void;
  onMove: () => void;
  onNewSession: () => void;
}) {
  const c = theme.colors;
  const ids = new Set(card.sessions.map((s) => s.id));
  const roots = card.sessions.filter((s) => !s.parentAgentId || !ids.has(s.parentAgentId));
  const attention = cardAttention(card);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!attention) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 1000, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [attention, pulse]);
  const attentionColor = attention === "error" ? c.statusDanger : attention === "permission" ? c.foreground : c.accent;
  return (
    <View>
      {attention ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, borderWidth: 2, borderColor: attentionColor, opacity: pulse }}
        />
      ) : null}
      <View style={{ backgroundColor: c.surface0, borderRadius: 8, borderWidth: 1, borderColor: c.border, padding: 10, gap: 4 }}>
        <Pressable accessibilityRole="button" onPress={onToggle}>
          <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 13 }}>{card.name}</Text>
          {card.branch ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{card.branch}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {card.pr ? (
              <View style={{ backgroundColor: c.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: c.foreground, fontSize: 11 }}>PR #{card.pr.number}</Text>
              </View>
            ) : null}
            {card.issues.map((issue, i) => (
              <View key={i} style={{ backgroundColor: c.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: c.foreground, fontSize: 11 }}>{issue}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: c.foregroundMuted, fontSize: 11, marginTop: 2 }}>
            {card.sessions.length} session{card.sessions.length === 1 ? "" : "s"}
          </Text>
        </Pressable>

        {expanded ? (
          <View style={{ gap: 2, marginTop: 4 }}>
            {roots.map((root) => (
              <SessionTree key={root.id} session={root} sessions={card.sessions} depth={0} theme={theme} onOpen={onOpenAgent} />
            ))}
            {card.id !== UNASSIGNED_CARD_ID ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                <Pressable accessibilityRole="button" onPress={onMove} style={{ padding: 6, borderRadius: 6, backgroundColor: c.border }}>
                  <Text style={{ color: c.foreground, fontSize: 12 }}>Move</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={onNewSession} style={{ padding: 6, borderRadius: 6, backgroundColor: c.border }}>
                  <Text style={{ color: c.foreground, fontSize: 12 }}>New session</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SessionTree({ session, sessions, depth, theme, onOpen }: { session: Session; sessions: Session[]; depth: number; theme: PluginTheme; onOpen: (id: string) => void }) {
  const c = theme.colors;
  const children = sessions.filter((s) => s.parentAgentId === session.id);
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => onOpen(session.id)} style={{ paddingLeft: depth * 12, paddingVertical: 2, flexDirection: "row", gap: 6 }}>
        <Text style={{ color: c.foreground, fontSize: 12 }}>• {session.title}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{session.status}</Text>
      </Pressable>
      {children.map((child) => (
        <SessionTree key={child.id} session={child} sessions={sessions} depth={depth + 1} theme={theme} onOpen={onOpen} />
      ))}
    </View>
  );
}

function RadioOption({ theme, selected, label, onPress, disabled }: { theme: PluginTheme; selected: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  const c = theme.colors;
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: selected ? c.accent : c.foregroundMuted, alignItems: "center", justifyContent: "center" }}>
        {selected ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} /> : null}
      </View>
      <Text style={{ color: c.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function PromptEditor({ theme, value, onChange, placeholder, minHeight = 120 }: { theme: PluginTheme; value: string; onChange: (v: string) => void; placeholder?: string; minHeight?: number }) {
  const c = theme.colors;
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const inputRef = useRef<NativeTextInput>(null);

  function insertTemplate(template: string) {
    const { start, end } = selection;
    const next = value.slice(0, start) + template + value.slice(end);
    onChange(next);
    const pos = start + template.length;
    setSelection({ start: pos, end: pos });
    inputRef.current?.focus();
  }

  return (
    <View style={{ gap: 8 }}>
      <HostTextInput
        ref={inputRef}
        multiline
        value={value}
        onChangeText={onChange}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
        selection={selection}
        placeholder={placeholder}
        placeholderTextColor={c.foregroundMuted}
        style={{ color: c.foreground, backgroundColor: c.surface0, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, fontSize: 13, minHeight, textAlignVertical: "top" }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {TEMPLATES.map((template) => (
          <Pressable key={template} accessibilityRole="button" onPress={() => insertTemplate(template)} style={{ backgroundColor: c.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
            <Text style={{ color: c.foreground, fontSize: 11 }}>{template}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const inputStyle = (c: PluginTheme["colors"]) => ({ color: c.foreground, backgroundColor: c.surface0, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, fontSize: 13 }) as const;
const labelStyle = (c: PluginTheme["colors"]) => ({ color: c.foreground, fontWeight: "600", fontSize: 13 }) as const;
const btn = (c: PluginTheme["colors"]) => ({ padding: 8, borderRadius: 8, backgroundColor: c.border }) as const;

function OverlayView({
  overlay,
  theme,
  boardId,
  board,
  boards,
  onClose,
  onSaveZone,
  onMove,
  onPickZone,
  onCreateCard,
  onAdopt,
  onMoveZone,
  onCreatedBoard,
  onRenameBoard,
  onSaveDefaults,
}: {
  overlay: Overlay;
  theme: PluginTheme;
  boardId?: string;
  board?: Board;
  boards: BoardSummary[];
  onClose: () => void;
  onSaveZone: (zoneId: string, title: string, trigger: ZoneTrigger | null) => void;
  onMove: (card: WorkspaceCard, zoneId: string, reuseAgentId?: string) => void;
  onPickZone: (card: WorkspaceCard, zone: Zone) => void;
  onCreateCard: (input: CreateCardInput) => void;
  onAdopt: (zone: Zone, workspaceId: string) => void;
  onMoveZone: (zone: Zone, groupId: string, index: number) => void;
  onCreatedBoard: (name: string) => void;
  onRenameBoard: (name: string) => void;
  onSaveDefaults: (cardDefaults: CardDefaults) => void;
}) {
  switch (overlay.kind) {
    case "zone-settings":
      return <ZoneSettingsModal theme={theme} zone={overlay.zone} onClose={onClose} onSave={onSaveZone} />;
    case "move":
      return <MoveModal theme={theme} card={overlay.card} groups={board?.groups ?? []} onClose={onClose} onPickZone={onPickZone} />;
    case "pick-session":
      return <PickSessionModal theme={theme} card={overlay.card} zone={overlay.zone} onClose={onClose} onMove={onMove} />;
    case "create-find-card":
      return (
        <CreateFindCardModal
          theme={theme}
          zone={overlay.zone}
          boardId={boardId ?? ""}
          board={board}
          boards={boards}
          onClose={onClose}
          onCreateCard={onCreateCard}
          onAdopt={(workspaceId) => onAdopt(overlay.zone, workspaceId)}
        />
      );
    case "move-zone":
      return <MoveZoneModal theme={theme} zone={overlay.zone} board={board} onClose={onClose} onMove={(groupId, index) => onMoveZone(overlay.zone, groupId, index)} />;
    case "new-board":
      return <NewBoardModal theme={theme} onClose={onClose} onCreated={onCreatedBoard} />;
    case "rename-board":
      return <RenameBoardModal theme={theme} currentName={board?.name ?? ""} onClose={onClose} onRename={onRenameBoard} />;
    case "card-defaults":
      return <CardDefaultsModal theme={theme} defaults={board?.cardDefaults} onClose={onClose} onSave={onSaveDefaults} />;
  }
}

function ZoneSettingsModal({
  theme,
  zone,
  onClose,
  onSave,
}: {
  theme: PluginTheme;
  zone: Zone;
  onClose: () => void;
  onSave: (zoneId: string, title: string, trigger: ZoneTrigger | null) => void;
}) {
  const c = theme.colors;
  const [title, setTitle] = useState(zone.title);
  const [mode, setMode] = useState<"new" | "reuse">(zone.trigger?.session.mode ?? "new");
  const [action, setAction] = useState<"prompt" | "spawn">(zone.trigger?.action ?? "prompt");
  const [provider, setProvider] = useState(zone.trigger?.provider ?? DEFAULT_PROVIDER);
  const [prompt, setPrompt] = useState(zone.trigger?.prompt ?? "");

  const hasPrompt = prompt.trim().length > 0;
  const dim = hasPrompt ? 1 : 0.4;
  const trigger: ZoneTrigger | null = hasPrompt ? { session: { mode }, action, provider: provider.trim() || undefined, prompt } : null;

  return (
    <Modal title="Zone settings" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={labelStyle(c)}>Name</Text>
        <HostTextInput value={title} onChangeText={setTitle} style={inputStyle(c)} />

        <Text style={labelStyle(c)}>Action on entry</Text>
        <PromptEditor theme={theme} value={prompt} onChange={setPrompt} placeholder={SUGGESTED_PROMPT} />

        <View style={{ opacity: dim }}>
          <Text style={labelStyle(c)}>Session</Text>
          <RadioOption theme={theme} disabled={!hasPrompt} selected={mode === "new"} label="Create a new session" onPress={() => setMode("new")} />
          <RadioOption theme={theme} disabled={!hasPrompt} selected={mode === "reuse"} label="Reuse a session" onPress={() => setMode("reuse")} />

          {mode === "reuse" ? (
            <>
              <Text style={labelStyle(c)}>Action</Text>
              <RadioOption theme={theme} disabled={!hasPrompt} selected={action === "prompt"} label="Prompt - send message" onPress={() => setAction("prompt")} />
              <RadioOption theme={theme} disabled={!hasPrompt} selected={action === "spawn"} label="Spawn - child session" onPress={() => setAction("spawn")} />
            </>
          ) : null}

          <Text style={labelStyle(c)}>Provider</Text>
          <HostTextInput value={provider} onChangeText={setProvider} editable={hasPrompt} autoCapitalize="none" autoCorrect={false} style={inputStyle(c)} />
        </View>

        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onSave(zone.id, title.trim() || zone.title, trigger)} style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent }}>
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Save</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function MoveModal({
  theme,
  card,
  groups,
  onClose,
  onPickZone,
}: {
  theme: PluginTheme;
  card: WorkspaceCard;
  groups: Board["groups"];
  onClose: () => void;
  onPickZone: (card: WorkspaceCard, zone: Zone) => void;
}) {
  const c = theme.colors;
  return (
    <Modal title={`Move "${card.name}"`} open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content scrollable={false} contentContainerStyle={{ gap: 12 }}>
        <HostScrollView style={{ maxHeight: 320 }}>
          {groups.map((group, ci) =>
            group.zones.map((zone) => (
              <Pressable key={zone.id} accessibilityRole="button" onPress={() => onPickZone(card, zone)} style={{ padding: 10, borderRadius: 8, backgroundColor: c.border, marginBottom: 6 }}>
                <Text style={{ color: c.foreground }}>Group {ci + 1} / {zone.title}</Text>
              </Pressable>
            )),
          )}
        </HostScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
          <Text style={{ color: c.foreground }}>Cancel</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}

function PickSessionModal({
  theme,
  card,
  zone,
  onClose,
  onMove,
}: {
  theme: PluginTheme;
  card: WorkspaceCard;
  zone: Zone;
  onClose: () => void;
  onMove: (card: WorkspaceCard, zoneId: string, reuseAgentId?: string) => void;
}) {
  const c = theme.colors;
  return (
    <Modal title="Choose a session to reuse" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content scrollable={false} contentContainerStyle={{ gap: 12 }}>
        <HostScrollView style={{ maxHeight: 320 }}>
          {card.sessions.map((session) => (
            <Pressable key={session.id} accessibilityRole="button" onPress={() => onMove(card, zone.id, session.id)} style={{ padding: 10, borderRadius: 8, backgroundColor: c.border, marginBottom: 6 }}>
              <Text style={{ color: c.foreground }}>{session.title}</Text>
              <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{session.status}</Text>
            </Pressable>
          ))}
        </HostScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
          <Text style={{ color: c.foreground }}>Cancel</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}

function MoveZoneModal({
  theme,
  zone,
  board,
  onClose,
  onMove,
}: {
  theme: PluginTheme;
  zone: Zone;
  board?: Board;
  onClose: () => void;
  onMove: (groupId: string, index: number) => void;
}) {
  const c = theme.colors;
  const groups = board?.groups ?? [];
  return (
    <Modal title={`Move "${zone.title}"`} open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content scrollable={false} contentContainerStyle={{ gap: 12 }}>
        <HostScrollView style={{ maxHeight: 320 }}>
          {groups.map((group, ci) => (
            <View key={group.id} style={{ marginBottom: 8 }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
                Group {ci + 1}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => onMove(group.id, 0)} style={{ padding: 10, borderRadius: 8, backgroundColor: c.border, marginBottom: 4 }}>
                <Text style={{ color: c.foreground }}>Top of group</Text>
              </Pressable>
              {group.zones
                .filter((z) => z.id !== zone.id)
                .map((z, zi) => (
                  <Pressable key={z.id} accessibilityRole="button" onPress={() => onMove(group.id, zi + 1)} style={{ padding: 10, borderRadius: 8, backgroundColor: c.border, marginBottom: 4 }}>
                    <Text style={{ color: c.foreground }}>After {z.title}</Text>
                  </Pressable>
                ))}
            </View>
          ))}
        </HostScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
          <Text style={{ color: c.foreground }}>Cancel</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}

function CreateFindCardModal({
  theme,
  zone,
  boardId,
  board,
  boards,
  onClose,
  onCreateCard,
  onAdopt,
}: {
  theme: PluginTheme;
  zone: Zone;
  boardId: string;
  board?: Board;
  boards: BoardSummary[];
  onClose: () => void;
  onCreateCard: (input: CreateCardInput) => void;
  onAdopt: (workspaceId: string) => void;
}) {
  const c = theme.colors;
  const toast = useToast();
  const getProjects = useRpc(boardProjectsRpc);
  const getState = useRpc(boardStateRpc);
  const getWorkspaces = useRpc(boardWorkspacesRpc);

  const [tab, setTab] = useState<"create" | "find">("create");

  const defaults: CardDefaults = board?.cardDefaults ?? { isolation: "worktree" };
  const [name, setName] = useState("");
  const [isolation, setIsolation] = useState<"worktree" | "directory">(defaults.isolation ?? "worktree");
  const [projectCwd, setProjectCwd] = useState(defaults.projectCwd ?? "");
  const [baseBranch, setBaseBranch] = useState(defaults.baseBranch ?? "");
  const [provider, setProvider] = useState(defaults.provider ?? DEFAULT_PROVIDER);
  const [thinkingOptionId, setThinkingOptionId] = useState(defaults.thinkingOptionId ?? "");
  const [prompt, setPrompt] = useState(defaults.prompt ?? "");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const projectsQuery = useQuery({ queryKey: ["aces-boards", "projects"], queryFn: () => getProjects({}), staleTime: 60000 });
  const projects: Project[] = projectsQuery.data?.projects ?? [];

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.path === projectCwd)) {
      setProjectCwd(projects[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const allWorkspacesQuery = useQuery({ queryKey: ["aces-boards", "workspaces"], queryFn: () => getWorkspaces({}) });
  const allWorkspaces: WorkspaceCard[] = allWorkspacesQuery.data?.workspaces ?? [];

  const [otherPlacements, setOtherPlacements] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    const others = boards.filter((b) => b.id !== boardId);
    if (others.length === 0) {
      setOtherPlacements({});
      return;
    }
    let cancelled = false;
    Promise.all(
      others.map(async (b) => {
        const s = await getState({ boardId: b.id });
        return { id: b.id, placement: s.board.placement ?? {} };
      }),
    )
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, Record<string, string>> = {};
        for (const item of list) map[item.id] = item.placement;
        setOtherPlacements(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [boards, boardId, getState]);

  const placements = useMemo(() => {
    const m: Record<string, Record<string, string>> = { [boardId]: board?.placement ?? {} };
    for (const [id, placement] of Object.entries(otherPlacements)) m[id] = placement;
    return m;
  }, [boardId, board, otherPlacements]);

  const placedWorkspaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const placement of Object.values(placements)) {
      for (const id of Object.keys(placement)) ids.add(id);
    }
    return ids;
  }, [placements]);

  const candidates = allWorkspaces.filter((ws) => ws.id !== UNASSIGNED_CARD_ID);
  const unassigned = candidates.filter((ws) => !placedWorkspaceIds.has(ws.id));

  const selectedProject = projects.find((p) => p.path === projectCwd);
  const isGit = selectedProject ? selectedProject.isGit : true;

  useEffect(() => {
    if (!isGit && isolation === "worktree") setIsolation("directory");
  }, [isGit, isolation]);

  function submitCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Workspace name is required.");
      return;
    }
    if (!projectCwd) {
      toast.error("Choose a project.");
      return;
    }
    onCreateCard({
      boardId,
      zoneId: zone.id,
      name: trimmedName,
      isolation,
      projectCwd,
      baseBranch: isolation === "worktree" ? baseBranch.trim() || undefined : undefined,
      provider: provider.trim() || undefined,
      thinkingOptionId: thinkingOptionId.trim() || undefined,
      prompt: prompt.trim() || undefined,
    });
  }

  return (
    <Modal title="Add card" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <SegmentedControl
          theme={theme}
          options={[
            { id: "create", label: "Create card" },
            { id: "find", label: "Find card" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as "create" | "find")}
        />

        {tab === "create" ? (
          <>
            <Text style={labelStyle(c)}>Name</Text>
            <HostTextInput value={name} onChangeText={setName} style={inputStyle(c)} />
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Branch: {slugify(name) || "—"}</Text>

            <Text style={labelStyle(c)}>Project</Text>
            <Pressable accessibilityRole="button" onPress={() => setProjectPickerOpen((o) => !o)} style={{ ...inputStyle(c), flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: c.foreground }}>{selectedProject?.name ?? projectCwd ?? "Choose a project"}</Text>
              <Text style={{ color: c.foregroundMuted }}>▾</Text>
            </Pressable>
            {projectPickerOpen ? (
              <View style={{ backgroundColor: c.surface1, borderRadius: 8, borderWidth: 1, borderColor: c.border }}>
                {projects.map((p) => (
                  <Pressable key={p.id} accessibilityRole="button" onPress={() => { setProjectCwd(p.path); setProjectPickerOpen(false); }} style={{ padding: 10 }}>
                    <Text style={{ color: c.foreground }}>{p.name}</Text>
                    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{p.path}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={labelStyle(c)}>Isolation</Text>
            <RadioOption theme={theme} disabled={!isGit} selected={isolation === "worktree"} label="Worktree" onPress={() => setIsolation("worktree")} />
            {!isGit ? <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingLeft: 24 }}>This project is not a git repository</Text> : null}

            <View style={{ paddingLeft: 24, gap: 8 }}>
              <Text style={labelStyle(c)}>Base branch</Text>
              <HostTextInput value={baseBranch} onChangeText={setBaseBranch} editable={isolation === "worktree" && isGit} style={[inputStyle(c), isolation === "directory" || !isGit ? { opacity: 0.4 } : undefined]} autoCapitalize="none" autoCorrect={false} />
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>The new card creates a branch from this base.</Text>
            </View>

            <RadioOption theme={theme} selected={isolation === "directory"} label="Directory" onPress={() => setIsolation("directory")} />

            <Text style={labelStyle(c)}>Provider</Text>
            <ProviderCombobox
              theme={theme}
              provider={provider}
              thinkingOptionId={thinkingOptionId}
              queryKeyPrefix="aces-boards"
              onChange={(next) => {
                setProvider(next.provider);
                setThinkingOptionId(next.thinkingOptionId ?? "");
              }}
            />

            <Text style={labelStyle(c)}>Prompt</Text>
            <PromptEditor theme={theme} value={prompt} onChange={setPrompt} />

            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
              <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
                <Text style={{ color: c.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={submitCreate} style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent }}>
                <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Create card</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {unassigned.length > 0 ? (
              <>
                <Text style={labelStyle(c)}>Unassigned workspaces</Text>
                {unassigned.map((ws) => (
                  <Pressable key={ws.id} accessibilityRole="button" onPress={() => onAdopt(ws.id)} style={{ padding: 10, borderRadius: 8, backgroundColor: c.border, marginBottom: 6 }}>
                    <Text style={{ color: c.foreground }}>{ws.name}</Text>
                    {ws.branch ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{ws.branch}</Text> : null}
                  </Pressable>
                ))}
              </>
            ) : (
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>No unassigned workspaces.</Text>
            )}

            {boards.filter((b) => b.id !== boardId).map((b) => {
              const cardIds = Object.keys(placements[b.id] ?? {});
              const cards = candidates.filter((ws) => cardIds.includes(ws.id));
              return (
                <View key={b.id} style={{ marginTop: 8 }}>
                  <Text style={{ color: c.foregroundMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
                    Board: {b.name}
                  </Text>
                  {cards.map((ws) => (
                    <View key={ws.id} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Text style={{ color: c.foregroundMuted }}>{ws.name}</Text>
                      {ws.branch ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{ws.branch}</Text> : null}
                    </View>
                  ))}
                </View>
              );
            })}
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}

function NewBoardModal({ theme, onClose, onCreated }: { theme: PluginTheme; onClose: () => void; onCreated: (name: string) => void }) {
  const c = theme.colors;
  const [name, setName] = useState("");
  return (
    <Modal title="New board" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={labelStyle(c)}>Name</Text>
        <HostTextInput value={name} onChangeText={setName} style={inputStyle(c)} autoFocus />
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!name.trim()} onPress={() => onCreated(name.trim())} style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent, opacity: name.trim() ? 1 : 0.4 }}>
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Create</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function RenameBoardModal({ theme, currentName, onClose, onRename }: { theme: PluginTheme; currentName: string; onClose: () => void; onRename: (name: string) => void }) {
  const c = theme.colors;
  const [name, setName] = useState(currentName);
  return (
    <Modal title="Rename board" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={labelStyle(c)}>Name</Text>
        <HostTextInput value={name} onChangeText={setName} style={inputStyle(c)} autoFocus />
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!name.trim()} onPress={() => onRename(name.trim())} style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent, opacity: name.trim() ? 1 : 0.4 }}>
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Save</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function SegmentedControl({ theme, options, value, onChange }: { theme: PluginTheme; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: c.border, overflow: "hidden", backgroundColor: c.surface0 }}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable key={opt.id} accessibilityRole="button" onPress={() => onChange(opt.id)} style={{ flex: 1, paddingVertical: 8, alignItems: "center", backgroundColor: active ? c.accent : "transparent" }}>
            <Text style={{ color: active ? c.accentForeground : c.foreground, fontWeight: "600", fontSize: 13 }}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CardDefaultsModal({ theme, defaults, onClose, onSave }: { theme: PluginTheme; defaults?: CardDefaults; onClose: () => void; onSave: (cardDefaults: CardDefaults) => void }) {
  const c = theme.colors;
  const getProjects = useRpc(boardProjectsRpc);

  const [isolation, setIsolation] = useState<"worktree" | "directory">(defaults?.isolation ?? "worktree");
  const [projectCwd, setProjectCwd] = useState(defaults?.projectCwd ?? "");
  const [baseBranch, setBaseBranch] = useState(defaults?.baseBranch ?? "");
  const [provider, setProvider] = useState(defaults?.provider ?? DEFAULT_PROVIDER);
  const [thinkingOptionId, setThinkingOptionId] = useState(defaults?.thinkingOptionId ?? "");
  const [prompt, setPrompt] = useState(defaults?.prompt ?? "");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const projectsQuery = useQuery({ queryKey: ["aces-boards", "projects"], queryFn: () => getProjects({}), staleTime: 60000 });
  const projects: Project[] = projectsQuery.data?.projects ?? [];

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.path === projectCwd)) {
      setProjectCwd(projects[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const selectedProject = projects.find((p) => p.path === projectCwd);
  const isGit = selectedProject ? selectedProject.isGit : true;

  useEffect(() => {
    if (!isGit && isolation === "worktree") setIsolation("directory");
  }, [isGit, isolation]);

  function submit() {
    onSave({
      isolation,
      projectCwd: projectCwd || undefined,
      baseBranch: baseBranch.trim() || undefined,
      provider: provider.trim() || undefined,
      thinkingOptionId: thinkingOptionId.trim() || undefined,
      prompt: prompt.trim() || undefined,
    });
  }

  return (
    <Modal title="Edit card defaults" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={labelStyle(c)}>Project</Text>
        <Pressable accessibilityRole="button" onPress={() => setProjectPickerOpen((o) => !o)} style={{ ...inputStyle(c), flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: c.foreground }}>{selectedProject?.name ?? projectCwd ?? "Choose a project"}</Text>
          <Text style={{ color: c.foregroundMuted }}>▾</Text>
        </Pressable>
        {projectPickerOpen ? (
          <View style={{ backgroundColor: c.surface1, borderRadius: 8, borderWidth: 1, borderColor: c.border }}>
            {projects.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => { setProjectCwd(p.path); setProjectPickerOpen(false); }} style={{ padding: 10 }}>
                <Text style={{ color: c.foreground }}>{p.name}</Text>
                <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{p.path}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={labelStyle(c)}>Isolation</Text>
        <RadioOption theme={theme} disabled={!isGit} selected={isolation === "worktree"} label="Worktree" onPress={() => setIsolation("worktree")} />
        {!isGit ? <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingLeft: 24 }}>This project is not a git repository</Text> : null}

        <Text style={labelStyle(c)}>Base branch</Text>
        <HostTextInput value={baseBranch} onChangeText={setBaseBranch} editable={isolation === "worktree" && isGit} style={[inputStyle(c), isolation === "directory" || !isGit ? { opacity: 0.4 } : undefined]} autoCapitalize="none" autoCorrect={false} />
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>The new card creates a branch from this base.</Text>

        <RadioOption theme={theme} selected={isolation === "directory"} label="Directory" onPress={() => setIsolation("directory")} />

        <Text style={labelStyle(c)}>Provider</Text>
        <ProviderCombobox
          theme={theme}
          provider={provider}
          thinkingOptionId={thinkingOptionId}
          queryKeyPrefix="aces-boards"
          onChange={(next) => {
            setProvider(next.provider);
            setThinkingOptionId(next.thinkingOptionId ?? "");
          }}
        />

        <Text style={labelStyle(c)}>Prompt</Text>
        <PromptEditor theme={theme} value={prompt} onChange={setPrompt} />

        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={submit} style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent }}>
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Save</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
