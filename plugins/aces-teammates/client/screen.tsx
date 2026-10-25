import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Modal, ScrollView as HostScrollView, TextInput as HostTextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import {
  teammateBoardsRpc,
  teammateCreateRpc,
  teammateDeleteRpc,
  teammateListRpc,
  teammateStartRpc,
  teammateSyncFrameworkRpc,
  teammateUpdateRpc,
  type BoardSummary,
  type Teammate,
} from "../shared/contracts";
import { PERSONAS } from "../shared/personas";
import { ProviderCombobox } from "./provider-combobox";

const EMOJI_CHOICES = [
  "🤖", "🧊", "🗂️", "🔍", "📋", "🧠", "🛠️", "🚀",
  "💻", "🔐", "🎨", "📊", "👔", "🧪", "🔬", "⚙️",
  "🧹", "📦", "🔎", "🧯", "🕵️", "🔮", "🤝", "✨",
];

const HEARTBEAT_PRESETS: { label: string; cron: string }[] = [
  { label: "Off", cron: "" },
  { label: "Every 5 min", cron: "*/5 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily", cron: "0 9 * * *" },
  { label: "Weekdays", cron: "0 9 * * 1-5" },
];

type Overlay =
  | { kind: "new" }
  | { kind: "edit"; teammate: Teammate }
  | { kind: "delete"; teammate: Teammate };

interface MenuItem {
  label: string;
  danger?: boolean;
  onPress: () => void;
}
interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const inputStyle = (c: PluginTheme["colors"]) => ({ color: c.foreground, backgroundColor: c.surface0, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, fontSize: 13 }) as const;
const labelStyle = (c: PluginTheme["colors"]) => ({ color: c.foreground, fontWeight: "600", fontSize: 13 }) as const;
const btn = (c: PluginTheme["colors"]) => ({ padding: 8, borderRadius: 8, backgroundColor: c.border }) as const;

export function TeammatesScreen({ theme, layout, navigation }: PluginScreenProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const list = useRpc(teammateListRpc);
  const create = useRpc(teammateCreateRpc);
  const update = useRpc(teammateUpdateRpc);
  const remove = useRpc(teammateDeleteRpc);
  const start = useRpc(teammateStartRpc);
  const boardsRpc = useRpc(teammateBoardsRpc);
  const syncFramework = useRpc(teammateSyncFrameworkRpc);

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rootRef = useRef<View>(null);

  const query = useQuery({
    queryKey: ["aces-teammates", "teammates"],
    queryFn: () => list({}),
  });

  const boardsQuery = useQuery({
    queryKey: ["aces-teammates", "boards"],
    queryFn: () => boardsRpc({}),
  });
  const boards: BoardSummary[] = boardsQuery.data?.boards ?? [];

  const c = theme.colors;
  const compact = layout.compact;

  const styles = useMemo(
    () =>
      ({
        root: { flex: 1, backgroundColor: c.surface0 },
        header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
        headerTitle: { color: c.foreground, fontSize: 16, fontWeight: "600" },
        newBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.accent },
        newBtnText: { color: c.accentForeground, fontWeight: "600", fontSize: 13 },
        list: { padding: 12 },
        empty: { color: c.foregroundMuted, fontSize: 13, padding: 4 },
        card: { backgroundColor: c.surface1, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 10, gap: 4, marginBottom: 10 },
        cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
        cardName: { color: c.foreground, fontWeight: "600", fontSize: 14, flex: 1 },
        dots: { color: c.foreground, fontSize: 18, paddingHorizontal: 6, paddingVertical: 2 },
        muted: { color: c.foregroundMuted, fontSize: 12 },
        cardActions: { flexDirection: "row", gap: 8, marginTop: 6 },
        startBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.border },
        startBtnText: { color: c.foreground, fontSize: 13 },
      }) as const,
    [c, compact],
  );

  const teammates = query.data?.teammates ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["aces-teammates", "teammates"] });
  }

  async function handleCreate(input: { name: string; description?: string; provider?: string; thinkingOptionId?: string; boardId?: string; boardName?: string; heartbeatCron?: string; persona?: string; emoji?: string }) {
    try {
      const { agentId } = await create(input);
      if (agentId) navigation?.openAgent({ agentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleUpdate(teammate: Teammate, input: { name: string; description?: string; provider?: string; thinkingOptionId?: string; boardId?: string; boardName?: string; heartbeatCron?: string; emoji?: string }) {
    try {
      await update({ id: teammate.id, ...input });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleDelete(teammate: Teammate) {
    try {
      await remove({ id: teammate.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    invalidate();
    setOverlay(null);
  }

  async function handleStart(teammate: Teammate) {
    try {
      const { agentId } = await start({ id: teammate.id });
      navigation?.openAgent({ agentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setOverlay(null);
  }

  async function copyPath(teammate: Teammate) {
    try {
      await copyText(teammate.memoryPath);
      toast.show("Copied memory path", { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
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

  function openMenu(event: { nativeEvent: { pageX: number; pageY: number } }, teammate: Teammate) {
    placeMenu(
      [
        { label: "Edit", onPress: () => { setMenu(null); setOverlay({ kind: "edit", teammate }); } },
        { label: "Copy memory path", onPress: () => { setMenu(null); void copyPath(teammate); } },
        { label: "Sync framework", onPress: () => { setMenu(null); void syncFramework({ id: teammate.id }).then((r) => { if (r.ok) toast.show("Framework synced."); else if (r.conflict) toast.error(`Sync conflict in ${r.files.join(", ") || "files"} — start ${teammate.name} to resolve.`); else toast.error("Sync failed."); invalidate(); }).catch((err) => toast.error(err instanceof Error ? err.message : String(err))); } },
        { label: "Delete", danger: true, onPress: () => { setMenu(null); setOverlay({ kind: "delete", teammate }); } },
      ],
      event.nativeEvent.pageX,
      event.nativeEvent.pageY,
    );
  }

  return (
    <View ref={rootRef} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Teammates</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="New teammate" onPress={() => setOverlay({ kind: "new" })} style={styles.newBtn}>
          <Text style={styles.newBtnText}>New teammate</Text>
        </Pressable>
      </View>

      <HostScrollView contentContainerStyle={styles.list}>
        {teammates.length === 0 ? (
          <Text style={styles.empty}>No teammates yet.</Text>
        ) : (
          teammates.map((t) => (
            <View key={t.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{t.emoji ? `${t.emoji} ${t.name}` : t.name}</Text>
                {t.syncConflict ? <Text style={{ color: c.statusDanger, fontSize: 11 }}>⚠ sync conflict</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`${t.name} menu`} onPress={(e) => openMenu(e, t)}>
                  <Text style={styles.dots}>⋯</Text>
                </Pressable>
              </View>
              {t.description ? <Text style={styles.muted}>{t.description}</Text> : null}
              {t.boardName ? <Text style={styles.muted}>Board: {t.boardName}</Text> : null}
              {t.boardId && t.heartbeatCron ? <Text style={styles.muted}>Board agent (heartbeat: {t.heartbeatCron})</Text> : null}
              {t.provider ? <Text style={styles.muted}>{t.provider}</Text> : null}
              <View style={styles.cardActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Start ${t.name}`} onPress={() => void handleStart(t)} style={styles.startBtn}>
                  <Text style={styles.startBtnText}>Start</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </HostScrollView>

      {menu ? <ContextMenu menu={menu} theme={theme} onClose={() => setMenu(null)} /> : null}

      {overlay ? (
        <OverlayView
          overlay={overlay}
          theme={theme}
          boards={boards}
          onClose={() => setOverlay(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ) : null}
    </View>
  );
}

function ContextMenu({ menu, theme, onClose }: { menu: MenuState; theme: PluginTheme; onClose: () => void }) {
  const c = theme.colors;
  const width = Dimensions.get("window").width;
  const menuWidth = 180;
  const left = Math.max(8, Math.min(menu.x - menuWidth + 8, width - menuWidth - 8));
  return (
    <>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", top: menu.y + 4, left, width: menuWidth, backgroundColor: c.surface1, borderRadius: 8, borderWidth: 1, borderColor: c.border }}>
        {menu.items.map((item) => (
          <Pressable key={item.label} accessibilityRole="button" onPress={item.onPress} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text style={{ color: item.danger ? c.statusDanger : c.foreground, fontSize: 14 }}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function OverlayView({
  overlay,
  theme,
  boards,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  overlay: Overlay;
  theme: PluginTheme;
  boards: BoardSummary[];
  onClose: () => void;
  onCreate: (input: { name: string; description?: string; provider?: string; thinkingOptionId?: string; boardId?: string; boardName?: string; heartbeatCron?: string; persona?: string; emoji?: string }) => void;
  onUpdate: (teammate: Teammate, input: { name: string; description?: string; provider?: string; thinkingOptionId?: string; boardId?: string; boardName?: string; heartbeatCron?: string; emoji?: string }) => void;
  onDelete: (teammate: Teammate) => void;
}) {
  switch (overlay.kind) {
    case "new":
      return <NewTeammateModal theme={theme} boards={boards} onClose={onClose} onCreate={onCreate} />;
    case "edit":
      return <EditModal theme={theme} teammate={overlay.teammate} boards={boards} onClose={onClose} onUpdate={onUpdate} />;
    case "delete":
      return <DeleteModal theme={theme} teammate={overlay.teammate} onClose={onClose} onDelete={onDelete} />;
  }
}

function BoardPicker({
  theme,
  boards,
  value,
  onChange,
}: {
  theme: PluginTheme;
  boards: BoardSummary[];
  value?: string;
  onChange: (boardId?: string) => void;
}) {
  const c = theme.colors;
  const [open, setOpen] = useState(false);
  const selected = boards.find((b) => b.id === value);
  const optionStyle = { paddingHorizontal: 10, paddingVertical: 8 } as const;
  return (
    <View style={{ gap: 6 }}>
      <Text style={labelStyle(c)}>Resident board</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Resident board" onPress={() => setOpen((o) => !o)} style={{ ...inputStyle(c), flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: selected ? c.foreground : c.foregroundMuted }}>{selected ? selected.name : "(none)"}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>▾</Text>
      </Pressable>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface0 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange(undefined);
              setOpen(false);
            }}
            style={optionStyle}
          >
            <Text style={{ color: value ? c.foregroundMuted : c.foreground }}>(none)</Text>
          </Pressable>
          {boards.length === 0 ? <Text style={{ ...optionStyle, color: c.foregroundMuted }}>No boards found.</Text> : null}
          {boards.map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              onPress={() => {
                onChange(b.id);
                setOpen(false);
              }}
              style={optionStyle}
            >
              <Text style={{ color: b.id === value ? c.accent : c.foreground }}>{b.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EmojiButton({ theme, value, onChange }: { theme: PluginTheme; value?: string; onChange: (emoji: string) => void }) {
  const c = theme.colors;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose emoji"
        onPress={() => setOpen(true)}
        style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }}
      >
        <Text style={{ fontSize: 18 }}>{value || "🙂"}</Text>
      </Pressable>
      <Modal title="Choose emoji" open={open} onOpenChange={(o) => setOpen(o)}>
        <Modal.Content>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {EMOJI_CHOICES.map((e) => {
              const selected = value === e;
              return (
                <Pressable
                  key={e}
                  accessibilityRole="button"
                  accessibilityLabel={`Emoji ${e}`}
                  onPress={() => { onChange(e); setOpen(false); }}
                  style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : c.surface0 }}
                >
                  <Text style={{ fontSize: 18 }}>{e}</Text>
                </Pressable>
              );
            })}
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}

function HeartbeatPicker({ theme, value, onChange }: { theme: PluginTheme; value: string; onChange: (v: string) => void }) {
  const c = theme.colors;
  const [custom, setCustom] = useState(value !== "" && !HEARTBEAT_PRESETS.some((p) => p.cron === value));
  return (
    <View style={{ gap: 6 }}>
      <Text style={labelStyle(c)}>Heartbeat (cron)</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {HEARTBEAT_PRESETS.map((p) => {
          const selected = !custom && value === p.cron;
          return (
            <Pressable
              key={p.label}
              accessibilityRole="button"
              accessibilityLabel={`Heartbeat ${p.label}`}
              onPress={() => { setCustom(false); onChange(p.cron); }}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : c.surface1 }}
            >
              <Text style={{ color: selected ? c.accentForeground : c.foreground, fontSize: 12 }}>{p.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Heartbeat Custom"
          onPress={() => setCustom(true)}
          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: custom ? c.accent : c.border, backgroundColor: custom ? c.accent : c.surface1 }}
        >
          <Text style={{ color: custom ? c.accentForeground : c.foreground, fontSize: 12 }}>Custom</Text>
        </Pressable>
      </View>
      {custom ? (
        <View style={{ gap: 4 }}>
          <HostTextInput value={value} onChangeText={onChange} style={inputStyle(c)} autoCapitalize="none" autoCorrect={false} placeholder='eg "0 9 * * 1-5" — 9:00 AM every weekday' placeholderTextColor={c.foregroundMuted} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Cron format</Text>
            <ExternalLink href="https://crontab.io/" accessibilityLabel="Cron format documentation">
              <Text style={{ color: c.accent, fontSize: 12 }}>crontab.io</Text>
            </ExternalLink>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PersonaPicker({ theme, value, onChange }: { theme: PluginTheme; value?: string; onChange: (id: string) => void }) {
  const c = theme.colors;
  return (
    <View style={{ gap: 6 }}>
      <Text style={labelStyle(c)}>Starting Point</Text>
      <HostScrollView style={{ maxHeight: 200 }}>
        <View style={{ gap: 6 }}>
          {PERSONAS.map((p) => {
            const selected = value === p.id;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`Persona ${p.name}`}
                onPress={() => onChange(p.id)}
                style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: 8, borderRadius: 8, borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : c.surface1 }}
              >
                <Text style={{ fontSize: 16 }}>{p.emoji}</Text>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ color: selected ? c.accentForeground : c.foreground, fontWeight: "600", fontSize: 13 }}>{p.name}</Text>
                  <Text style={{ color: selected ? c.accentForeground : c.foregroundMuted, fontSize: 11 }}>{p.description}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </HostScrollView>
    </View>
  );
}

function NewTeammateModal({ theme, boards, onClose, onCreate }: { theme: PluginTheme; boards: BoardSummary[]; onClose: () => void; onCreate: (input: { name: string; description?: string; provider?: string; thinkingOptionId?: string; boardId?: string; boardName?: string; heartbeatCron?: string; persona?: string; emoji?: string }) => void }) {
  const c = theme.colors;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("");
  const [thinkingOptionId, setThinkingOptionId] = useState("");
  const [boardId, setBoardId] = useState<string | undefined>(undefined);
  const [heartbeatCron, setHeartbeatCron] = useState("");
  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [emoji, setEmoji] = useState<string | undefined>(PERSONAS[0].emoji);
  const [emojiTouched, setEmojiTouched] = useState(false);

  function selectEmoji(e: string) {
    setEmoji(e);
    setEmojiTouched(true);
  }

  function selectPersona(id: string) {
    setPersonaId(id);
    if (!emojiTouched) {
      const persona = PERSONAS.find((p) => p.id === id);
      if (persona) setEmoji(persona.emoji);
    }
  }

  return (
    <Modal title="New teammate" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={labelStyle(c)}>Name</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <EmojiButton theme={theme} value={emoji} onChange={selectEmoji} />
          <HostTextInput value={name} onChangeText={setName} style={[inputStyle(c), { flex: 1 }]} autoFocus />
        </View>
        <Text style={labelStyle(c)}>Description</Text>
        <HostTextInput value={description} onChangeText={setDescription} style={inputStyle(c)} />
        <Text style={labelStyle(c)}>Provider</Text>
        <ProviderCombobox
          theme={theme}
          provider={provider}
          thinkingOptionId={thinkingOptionId}
          queryKeyPrefix="aces-teammates"
          onChange={(next) => {
            setProvider(next.provider);
            setThinkingOptionId(next.thinkingOptionId ?? "");
          }}
        />
        <PersonaPicker theme={theme} value={personaId} onChange={selectPersona} />
        <BoardPicker theme={theme} boards={boards} value={boardId} onChange={setBoardId} />
        <HeartbeatPicker theme={theme} value={heartbeatCron} onChange={setHeartbeatCron} />
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!name.trim()}
            onPress={() => onCreate({ name: name.trim(), description: description.trim() || undefined, provider: provider.trim() || undefined, thinkingOptionId: thinkingOptionId.trim() || undefined, boardId, boardName: boards.find((b) => b.id === boardId)?.name, heartbeatCron: heartbeatCron.trim() || undefined, persona: personaId, emoji: emoji?.trim() })}
            style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent, opacity: name.trim() ? 1 : 0.4 }}
          >
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Create</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function EditModal({ theme, teammate, boards, onClose, onUpdate }: { theme: PluginTheme; teammate: Teammate; boards: BoardSummary[]; onClose: () => void; onUpdate: (teammate: Teammate, input: { name: string; description?: string; provider?: string; thinkingOptionId?: string; boardId?: string; boardName?: string; heartbeatCron?: string; emoji?: string }) => void }) {
  const c = theme.colors;
  const [name, setName] = useState(teammate.name);
  const [description, setDescription] = useState(teammate.description ?? "");
  const [provider, setProvider] = useState(teammate.provider ?? "");
  const [thinkingOptionId, setThinkingOptionId] = useState(teammate.thinkingOptionId ?? "");
  const [boardId, setBoardId] = useState<string | undefined>(teammate.boardId);
  const [heartbeatCron, setHeartbeatCron] = useState(teammate.heartbeatCron ?? "");
  const [emoji, setEmoji] = useState<string | undefined>(teammate.emoji);

  return (
    <Modal title="Edit teammate" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={labelStyle(c)}>Name</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <EmojiButton theme={theme} value={emoji} onChange={setEmoji} />
          <HostTextInput value={name} onChangeText={setName} style={[inputStyle(c), { flex: 1 }]} autoFocus />
        </View>
        <Text style={labelStyle(c)}>Description</Text>
        <HostTextInput value={description} onChangeText={setDescription} style={inputStyle(c)} />
        <Text style={labelStyle(c)}>Provider</Text>
        <ProviderCombobox
          theme={theme}
          provider={provider}
          thinkingOptionId={thinkingOptionId}
          queryKeyPrefix="aces-teammates"
          onChange={(next) => {
            setProvider(next.provider);
            setThinkingOptionId(next.thinkingOptionId ?? "");
          }}
        />
        <BoardPicker theme={theme} boards={boards} value={boardId} onChange={setBoardId} />
        <HeartbeatPicker theme={theme} value={heartbeatCron} onChange={setHeartbeatCron} />
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!name.trim()}
            onPress={() => onUpdate(teammate, { name: name.trim(), description: description.trim() || undefined, provider: provider.trim() || undefined, thinkingOptionId: thinkingOptionId.trim() || undefined, boardId, boardName: boards.find((b) => b.id === boardId)?.name, heartbeatCron: heartbeatCron.trim() || undefined, emoji: emoji?.trim() })}
            style={{ padding: 8, borderRadius: 8, backgroundColor: c.accent, opacity: name.trim() ? 1 : 0.4 }}
          >
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Save</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function DeleteModal({ theme, teammate, onClose, onDelete }: { theme: PluginTheme; teammate: Teammate; onClose: () => void; onDelete: (teammate: Teammate) => void }) {
  const c = theme.colors;
  return (
    <Modal title="Delete teammate" open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Content contentContainerStyle={{ gap: 12 }}>
        <Text style={{ color: c.foreground, fontSize: 13 }}>
          Delete "{teammate.name}" and its memory? This cannot be undone.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={onClose} style={btn(c)}>
            <Text style={{ color: c.foreground }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onDelete(teammate)} style={{ padding: 8, borderRadius: 8, backgroundColor: c.statusDanger }}>
            <Text style={{ color: c.foreground, fontWeight: "600" }}>Delete</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
