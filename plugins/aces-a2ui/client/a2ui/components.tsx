/**
 * React Native widgets for the A2UI 1.0 basic-catalog subset this plugin renders:
 * Row, Column, List, Card, Text, Divider, Image, Icon, Button, TextField, CheckBox,
 * AudioPlayer. Component property names mirror the v1.0 basic catalog schemas read off
 * the installed .d.ts files (Text uses `text`, Image/AudioPlayer use `url`, Row/Column/
 * List use `children`, Card and Button use `child`, ...). Components outside the subset
 * render a visible placeholder instead of crashing.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Image as RNImage, Pressable, Text as RNText, TextInput as RNTextInput, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { absoluteDataPath, readDataPath, type A2uiSurfaceState } from "./state";
import { bindingPath, evaluateChecks, resolveBinding, UNRESOLVED, type A2uiResolveContext } from "./resolve";
import { playAudioFromUrl } from "./audio";

export const MAX_RENDER_DEPTH = 40;

export interface A2uiNodeProps {
  componentId: string;
  state: A2uiSurfaceState;
  ctx: A2uiResolveContext;
  theme: PluginTheme;
  compact: boolean;
  depth: number;
  onAction: (action: unknown) => void;
  /** Writes a field edit at an absolute JSON Pointer into the live data model. */
  onEdit?: (path: string, value: unknown) => void;
}

/** Renders one component (by id) of the surface, recursing into its children. */
export function A2uiNodeView({ componentId, state, ctx, theme, compact, depth, onAction, onEdit }: A2uiNodeProps): ReactNode {
  const component = state.components[componentId];
  if (!component) return <Placeholder theme={theme} text={`‹missing: ${componentId}›`} />;
  if (depth > MAX_RENDER_DEPTH) return <Placeholder theme={theme} text="‹too deep›" />;

  const { component: type, ...properties } = component;
  const nodeProps: A2uiNodeProps = { componentId, state, ctx, theme, compact, depth: depth + 1, onAction, onEdit };
  const gap = compact ? 6 : 10;

  switch (type) {
    case "Row":
    case "Column":
    case "List":
      return renderLayout(nodeProps, properties, gap, type);
    case "Card":
      return (
        <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.surface1, padding: compact ? 8 : 12, gap }}>
          <A2uiNodeView {...nodeProps} componentId={typeof properties.child === "string" ? properties.child : ""} />
        </View>
      );
    case "Text": {
      const text = resolveBinding(properties.text, ctx);
      const caption = properties.variant === "caption";
      return (
        <RNText style={{ color: caption ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: caption ? (compact ? 11 : 12) : compact ? 13 : 14 }}>
          {text === undefined || text === null ? "" : String(text)}
        </RNText>
      );
    }
    case "Divider": {
      const vertical = properties.axis === "vertical";
      return <View style={vertical ? { width: 1, alignSelf: "stretch" } : { height: 1, alignSelf: "stretch", backgroundColor: theme.colors.border }} />;
    }
    case "Image": {
      const url = resolveBinding(properties.url, ctx);
      if (typeof url !== "string" || url === "") return <Placeholder theme={theme} text="‹no image›" />;
      const fit = typeof properties.fit === "string" ? properties.fit : "cover";
      const variant = typeof properties.variant === "string" ? properties.variant : "mediumFeature";
      const size = IMAGE_SIZE[variant] ?? IMAGE_SIZE.mediumFeature;
      const description = resolveBinding(properties.description, ctx);
      return (
        <RNImage
          source={{ uri: url }}
          accessibilityLabel={typeof description === "string" ? description : undefined}
          resizeMode={IMAGE_FIT[fit] ?? "cover"}
          style={{ width: size, height: size, borderRadius: variant === "avatar" || variant === "icon" ? 999 : 8, alignSelf: variant === "icon" || variant === "avatar" ? "flex-start" : "auto" }}
        />
      );
    }
    case "Icon":
      return <Icon name={lucideIconName(properties.name)} />;
    case "Button":
      return <ButtonWidget {...nodeProps} properties={properties} />;
    case "TextField":
      return <TextFieldWidget {...nodeProps} properties={properties} />;
    case "CheckBox":
      return <CheckBoxWidget {...nodeProps} properties={properties} />;
    case "AudioPlayer":
      return <AudioPlayerWidget theme={theme} compact={compact} properties={properties} ctx={ctx} />;
    default:
      return <Placeholder theme={theme} text={`‹unsupported: ${String(type)}›`} />;
  }
}

/** Row/Column/List share one widget; `children` is either static ids or a template list. */
function renderLayout(nodeProps: A2uiNodeProps, properties: Record<string, unknown>, gap: number, type: string): ReactNode {
  const { ctx, theme } = nodeProps;
  const template = templateChildren(properties.children);
  if (template) {
    const listPath = absoluteDataPath(ctx.dataPath, template.path);
    const items = readDataPath(ctx.dataModel, ctx.dataPath, listPath);
    if (!Array.isArray(items)) {
      return <Placeholder theme={theme} text={items === undefined ? `‹unresolved: ${listPath}›` : `‹not a list: ${listPath}›`} />;
    }
    return (
      <LayoutView properties={properties} gap={gap} type={type}>
        {items.map((_, index) => (
          <A2uiNodeView key={index} {...nodeProps} componentId={template.componentId} ctx={{ dataModel: ctx.dataModel, dataPath: `${listPath}/${index}`, index }} />
        ))}
      </LayoutView>
    );
  }
  return (
    <LayoutView properties={properties} gap={gap} type={type}>
      {childIds(properties.children).map((childId) => (
        <A2uiNodeView key={childId} {...nodeProps} componentId={childId} />
      ))}
    </LayoutView>
  );
}

function LayoutView({ properties, gap, type, children }: { properties: Record<string, unknown>; gap: number; type: string; children: ReactNode }): ReactNode {
  const vertical = type === "Column" || (type === "List" && (properties.direction ?? "vertical") === "vertical");
  const align = typeof properties.align === "string" ? properties.align : vertical ? "stretch" : "center";
  const style: Record<string, unknown> = {
    flexDirection: vertical ? "column" : "row",
    gap,
    alignItems: ALIGN[align] ?? "flex-start",
  };
  if (typeof properties.justify === "string" && JUSTIFY[properties.justify]) style.justifyContent = JUSTIFY[properties.justify];
  return <View style={style}>{children}</View>;
}

function ButtonWidget({ componentId, state, ctx, theme, compact, onAction, properties }: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const check = evaluateChecks(properties.checks, ctx);
  const variant = typeof properties.variant === "string" ? properties.variant : "default";
  const primary = variant === "primary";
  const disabled = !check.ok;
  const caption = buttonCaption(properties.child, state, ctx);
  const handlePress = useCallback(() => {
    const action = properties.action;
    if (typeof action !== "object" || action === null) return;
    const record = action as Record<string, unknown>;
    const event = record.event;
    if (typeof event === "object" && event !== null) {
      const eventRecord = event as Record<string, unknown>;
      const context: Record<string, unknown> = {};
      if (typeof eventRecord.context === "object" && eventRecord.context !== null) {
        for (const [key, value] of Object.entries(eventRecord.context as Record<string, unknown>)) {
          context[key] = resolveBinding(value, ctx);
        }
      }
      const userMessage = resolveBinding(eventRecord.userMessage, ctx);
      onAction({
        name: eventRecord.name,
        context,
        ...(typeof userMessage === "string" ? { userMessage } : {}),
        sourceComponentId: componentId,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const call = callName(record.functionCall);
    if (call !== undefined) {
      const functionCall = record.functionCall as Record<string, unknown>;
      onAction({ name: call, functionCall: true, args: functionCall.args ?? {}, sourceComponentId: componentId, timestamp: new Date().toISOString() });
    }
  }, [componentId, ctx, onAction, properties.action]);
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityLabel={caption}
      style={({ pressed }) => [
        {
          borderWidth: variant === "borderless" ? 0 : 1,
          borderColor: primary ? theme.colors.accent : theme.colors.border,
          backgroundColor: primary ? theme.colors.accent : theme.colors.surface1,
          borderRadius: 8,
          paddingHorizontal: compact ? 10 : 14,
          paddingVertical: compact ? 6 : 8,
          opacity: disabled ? 0.45 : 1,
        },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <RNText style={{ color: primary ? theme.colors.accentForeground : theme.colors.foreground, fontSize: compact ? 13 : 14, fontWeight: "500" }}>
        {caption}
      </RNText>
    </Pressable>
  );
}

/** The Button child is a component id (usually a Text); render its resolved text on the button. */
function buttonCaption(childId: unknown, state: A2uiSurfaceState, ctx: A2uiResolveContext): string {
  if (typeof childId !== "string" || childId === "") return "";
  const child = state.components[childId];
  if (!child) return `‹missing: ${childId}›`;
  if (child.component === "Text") {
    const text = resolveBinding(child.text, ctx);
    return text === undefined || text === null ? "" : String(text);
  }
  return `‹${String(child.component)}›`;
}

function TextFieldWidget({ theme, compact, ctx, properties, onEdit }: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const label = resolvedString(properties.label, ctx);
  const boundValue = resolveBinding(properties.value, ctx);
  const boundText = boundValue === UNRESOLVED || boundValue === undefined || boundValue === null ? "" : String(boundValue);
  // Bound fields are controlled by the live model; unbound fields keep local state.
  const valuePath = bindingPath(properties.value);
  const [localText, setLocalText] = useState(boundText);
  useEffect(() => {
    setLocalText(boundText);
  }, [boundText]);
  const text = valuePath !== undefined && onEdit ? boundText : localText;
  const handleTextChange = (value: string) => {
    if (valuePath !== undefined && onEdit) {
      onEdit(absoluteDataPath(ctx.dataPath, valuePath), value);
    } else {
      setLocalText(value);
    }
  };
  const variant = typeof properties.variant === "string" ? properties.variant : "shortText";
  const check = evaluateChecks(properties.checks, ctx);
  return (
    <View style={{ gap: 4, alignSelf: "stretch" }}>
      {label ? <RNText style={{ color: theme.colors.foregroundMuted, fontSize: compact ? 11 : 12 }}>{label}</RNText> : null}
      <RNTextInput
        value={text}
        onChangeText={handleTextChange}
        placeholder={resolvedString(properties.placeholder, ctx)}
        placeholderTextColor={theme.colors.foregroundMuted}
        multiline={variant === "longText"}
        secureTextEntry={variant === "obscured"}
        keyboardType={variant === "number" ? "numeric" : "default"}
        accessibilityLabel={label}
        style={{
          borderWidth: 1,
          borderColor: check.ok ? theme.colors.border : theme.colors.statusDanger,
          borderRadius: 8,
          paddingHorizontal: compact ? 8 : 10,
          paddingVertical: compact ? 6 : 8,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface1,
          fontSize: compact ? 13 : 14,
        }}
      />
      {!check.ok && check.message ? <RNText style={{ color: theme.colors.statusDanger, fontSize: compact ? 11 : 12 }}>{check.message}</RNText> : null}
    </View>
  );
}

function CheckBoxWidget({ theme, compact, ctx, properties, onEdit }: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const label = resolvedString(properties.label, ctx);
  const boundValue = resolveBinding(properties.value, ctx);
  const valuePath = bindingPath(properties.value);
  const [localChecked, setLocalChecked] = useState(boundValue === true);
  useEffect(() => {
    setLocalChecked(boundValue === true);
  }, [boundValue]);
  // Bound boxes are controlled by the live model; unbound ones keep local state.
  const checked = valuePath !== undefined && onEdit ? boundValue === true : localChecked;
  const toggle = () => {
    if (valuePath !== undefined && onEdit) {
      onEdit(absoluteDataPath(ctx.dataPath, valuePath), !checked);
    } else {
      setLocalChecked(!checked);
    }
  };
  return (
    <Pressable onPress={toggle} accessibilityRole="checkbox" style={{ flexDirection: "row", alignItems: "center", gap: compact ? 6 : 8 }}>
      <View
        style={{
          width: compact ? 18 : 20,
          height: compact ? 18 : 20,
          borderWidth: 1,
          borderRadius: 4,
          borderColor: checked ? theme.colors.accent : theme.colors.border,
          backgroundColor: checked ? theme.colors.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="Check" /> : null}
      </View>
      <RNText style={{ color: theme.colors.foreground, fontSize: compact ? 13 : 14 }}>{label}</RNText>
    </Pressable>
  );
}

function AudioPlayerWidget({ theme, compact, properties, ctx }: { theme: PluginTheme; compact: boolean; properties: Record<string, unknown>; ctx: A2uiResolveContext }): ReactNode {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlePlay = useCallback(() => {
    if (playing) {
      // Paseo's playAudio has no cancel; "stop" only resets the control.
      setPlaying(false);
      return;
    }
    const url = resolveBinding(properties.url, ctx);
    if (typeof url !== "string" || url === "") {
      setError("‹no audio›");
      return;
    }
    setError(null);
    setPlaying(true);
    void playAudioFromUrl(url)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setPlaying(false));
  }, [ctx, playing, properties.url]);
  return (
    <View style={{ gap: 4, alignItems: "flex-start" }}>
      <Pressable
        onPress={handlePlay}
        accessibilityLabel={playing ? "Stop audio" : "Play audio"}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: compact ? 6 : 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            backgroundColor: theme.colors.surface1,
            paddingHorizontal: compact ? 10 : 14,
            paddingVertical: compact ? 6 : 8,
          },
          pressed ? { opacity: 0.7 } : null,
        ]}
      >
        {playing ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Icon name="Play" />}
        <RNText style={{ color: theme.colors.foreground, fontSize: compact ? 13 : 14 }}>{playing ? "Playing…" : "Play"}</RNText>
      </Pressable>
      {error ? <RNText style={{ color: theme.colors.statusDanger, fontSize: compact ? 11 : 12 }}>{error}</RNText> : null}
    </View>
  );
}

function Placeholder({ theme, text }: { theme: PluginTheme; text: string }): ReactNode {
  return <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{text}</RNText>;
}

function templateChildren(children: unknown): { componentId: string; path: string } | null {
  if (typeof children !== "object" || children === null || Array.isArray(children)) return null;
  const record = children as Record<string, unknown>;
  if (typeof record.componentId !== "string" || typeof record.path !== "string") return null;
  return { componentId: record.componentId, path: record.path };
}

function childIds(children: unknown): string[] {
  if (typeof children === "string") return [children];
  if (Array.isArray(children)) return children.filter((id): id is string => typeof id === "string");
  return [];
}

function resolvedString(value: unknown, ctx: A2uiResolveContext): string {
  const resolved = resolveBinding(value, ctx);
  return typeof resolved === "string" ? resolved : "";
}

function callName(functionCall: unknown): string | undefined {
  if (typeof functionCall !== "object" || functionCall === null) return undefined;
  const record = functionCall as Record<string, unknown>;
  if (typeof record["@call"] === "string") return record["@call"];
  if (typeof record.call === "string") return record.call;
  return undefined;
}

const ALIGN: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceAround: "space-around",
  spaceBetween: "space-between",
  spaceEvenly: "space-evenly",
};

const IMAGE_FIT: Record<string, "cover" | "contain" | "stretch" | "center"> = {
  contain: "contain",
  cover: "cover",
  fill: "stretch",
  none: "center",
  scaleDown: "contain",
};

const IMAGE_SIZE: Record<string, number> = {
  icon: 24,
  avatar: 40,
  smallFeature: 96,
  mediumFeature: 160,
  largeFeature: 240,
  header: 320,
};

/** A2UI ships Material Symbols icon names; Paseo's `Icon` renders Lucide names. */
const ICON_NAMES: Record<string, string> = {
  accountCircle: "CircleUser",
  add: "Plus",
  arrowBack: "ArrowLeft",
  arrowForward: "ArrowRight",
  attachFile: "Paperclip",
  calendarToday: "Calendar",
  call: "Phone",
  camera: "Camera",
  check: "Check",
  close: "X",
  delete: "Trash2",
  download: "Download",
  edit: "Pencil",
  event: "CalendarDays",
  error: "CircleAlert",
  fastForward: "FastForward",
  favorite: "Heart",
  favoriteOff: "HeartOff",
  folder: "Folder",
  help: "CircleHelp",
  home: "House",
  info: "Info",
  locationOn: "MapPin",
  lock: "Lock",
  lockOpen: "LockOpen",
  mail: "Mail",
  menu: "Menu",
  moreVert: "MoreVertical",
  moreHoriz: "MoreHorizontal",
  notificationsOff: "BellOff",
  notifications: "Bell",
  pause: "Pause",
  payment: "CreditCard",
  person: "User",
  phone: "Phone",
  photo: "Image",
  play: "Play",
  print: "Printer",
  refresh: "RefreshCw",
  rewind: "Rewind",
  search: "Search",
  send: "Send",
  settings: "Settings",
  share: "Share2",
  shoppingCart: "ShoppingCart",
  skipNext: "SkipForward",
  skipPrevious: "SkipBackward",
  star: "Star",
  starHalf: "StarHalf",
  starOff: "StarOff",
  stop: "Square",
  upload: "Upload",
  visibility: "Eye",
  visibilityOff: "EyeOff",
  volumeDown: "Volume1",
  volumeMute: "VolumeX",
  volumeOff: "VolumeX",
  volumeUp: "Volume2",
  warning: "TriangleAlert",
};

function lucideIconName(name: unknown): string {
  return typeof name === "string" && ICON_NAMES[name] ? ICON_NAMES[name] : "CircleHelp";
}
