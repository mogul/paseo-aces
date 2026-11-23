/**
 * React Native widgets for the A2UI 1.0 basic catalog this plugin renders: all
 * 18 components (Row, Column, List, Card, Tabs, Text, Divider, Modal, Image,
 * Video, Icon, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput,
 * AudioPlayer). Property names mirror the v1.0 catalog schemas read off the
 * installed .d.ts files. Media URLs pass the spec allowlist (media-url.ts), Text
 * falls back to conservative Markdown-marker stripping (markdown.ts), and only
 * genuinely unknown component types render a visible placeholder.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Image as RNImage, PanResponder, Pressable, Text as RNText, TextInput as RNTextInput, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { absoluteDataPath, readDataPath, type A2uiSurfaceState } from "./state";
import { bindingPath, evaluateChecks, resolveBinding, UNRESOLVED, type A2uiResolveContext } from "./resolve";
import { playAudioFromUrl } from "./audio";
import { isValidMediaUrl } from "./media-url";
import { stripMarkdownMarkers } from "./markdown";
import { sliderFraction, snapSliderValue } from "./slider";

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
      const raw = text === undefined || text === null ? "" : String(text);
      const caption = properties.variant === "caption";
      // Guide: render Markdown when possible; without a parser dependency the
      // conservative fallback strips the common markers so text stays legible.
      return (
        <RNText style={{ color: caption ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: caption ? (compact ? 11 : 12) : compact ? 13 : 14 }}>
          {stripMarkdownMarkers(raw)}
        </RNText>
      );
    }
    case "Divider": {
      const vertical = properties.axis === "vertical";
      return <View style={vertical ? { width: 1, alignSelf: "stretch" } : { height: 1, alignSelf: "stretch", backgroundColor: theme.colors.border }} />;
    }
    case "Image": {
      const url = resolveBinding(properties.url, ctx);
      if (typeof url !== "string" || !isValidMediaUrl(url)) return <Placeholder theme={theme} text="‹no image›" />;
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
    case "Tabs":
      return <TabsWidget {...nodeProps} properties={properties} />;
    case "Modal":
      return <ModalWidget {...nodeProps} properties={properties} />;
    case "ChoicePicker":
      return <ChoicePickerWidget {...nodeProps} properties={properties} />;
    case "Slider":
      return <SliderWidget {...nodeProps} properties={properties} />;
    case "DateTimeInput":
      return <DateTimeInputWidget {...nodeProps} properties={properties} />;
    case "Video":
      return <VideoWidget {...nodeProps} properties={properties} />;
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

function TabsWidget(nodeProps: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const { ctx, theme, compact, properties } = nodeProps;
  // Guide: local selectedIndex (default 0); only the selected tab's child renders.
  const tabs = Array.isArray(properties.tabs)
    ? (properties.tabs as unknown[]).filter((tab): tab is Record<string, unknown> => typeof tab === "object" && tab !== null && typeof (tab as Record<string, unknown>).child === "string")
    : [];
  const [selected, setSelected] = useState(0);
  const active = selected < tabs.length ? selected : 0;
  const activeChild = tabs[active]?.child as string | undefined;
  return (
    <View style={{ alignSelf: "stretch", gap: compact ? 8 : 10 }}>
      <View style={{ flexDirection: "row", gap: compact ? 10 : 14, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        {tabs.map((tab, index) => {
          const activeTab = index === active;
          return (
            <Pressable
              key={index}
              onPress={() => setSelected(index)}
              accessibilityRole="tab"
              style={{ paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: activeTab ? theme.colors.accent : "transparent" }}
            >
              <RNText style={{ color: activeTab ? theme.colors.foreground : theme.colors.foregroundMuted, fontWeight: activeTab ? "600" : "400", fontSize: compact ? 12 : 13 }}>
                {resolvedString(tab.title, ctx)}
              </RNText>
            </Pressable>
          );
        })}
      </View>
      {activeChild ? <A2uiNodeView {...nodeProps} componentId={activeChild} /> : null}
    </View>
  );
}

function ModalWidget(nodeProps: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const { state, ctx, theme, compact, properties } = nodeProps;
  const triggerId = typeof properties.trigger === "string" ? properties.trigger : "";
  const contentId = typeof properties.content === "string" ? properties.content : "";
  const [open, setOpen] = useState(false);
  // Guide: a Modal is an entry point — only the trigger shows until pressed.
  const title = triggerCaption(triggerId, state, ctx);
  return (
    <View>
      {/* Capture steals the touch, so a Button trigger opens the modal instead
          of dispatching its own action (the guide's "intercept"). */}
      <View onStartShouldSetResponderCapture={() => true} onResponderGrant={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Open dialog">
        <A2uiNodeView {...nodeProps} componentId={triggerId} />
      </View>
      <Modal title={title} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <RNText style={{ color: theme.colors.foreground, fontSize: compact ? 13 : 14, fontWeight: "600" }}>{title}</RNText>
            <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close" hitSlop={8}>
              <Icon name="X" />
            </Pressable>
          </View>
          <A2uiNodeView {...nodeProps} componentId={contentId} />
        </Modal.Content>
      </Modal>
    </View>
  );
}

/** Best-effort modal title: a Text trigger's own text, or a Button trigger's caption. */
function triggerCaption(triggerId: string, state: A2uiSurfaceState, ctx: A2uiResolveContext): string {
  const trigger = triggerId === "" ? undefined : state.components[triggerId];
  if (!trigger) return "";
  if (trigger.component === "Text") return buttonCaption(triggerId, state, ctx);
  const childId = trigger.component === "Button" ? trigger.child : undefined;
  return typeof childId === "string" ? buttonCaption(childId, state, ctx) : "";
}

function ChoicePickerWidget(nodeProps: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const { ctx, theme, compact, onEdit, properties } = nodeProps;
  // Schema defaults: variant "mutuallyExclusive", displayStyle "checkbox",
  // filterable false. Both variants bind a string array; mutuallyExclusive
  // writes a one-element array (mirrors web_core's ChoicePicker).
  const exclusive = properties.variant !== "multipleSelection";
  const chips = properties.displayStyle === "chips";
  const filterable = properties.filterable === true;
  const check = evaluateChecks(properties.checks, ctx);
  const label = resolvedString(properties.label, ctx);
  const options = Array.isArray(properties.options)
    ? (properties.options as unknown[])
        .filter((option): option is Record<string, unknown> => typeof option === "object" && option !== null && typeof (option as Record<string, unknown>).value === "string")
        .map((option) => ({ value: option.value as string, label: resolvedString(option.label, ctx) || (option.value as string) }))
    : [];
  const bound = resolveBinding(properties.value, ctx);
  const boundSelection = Array.isArray(bound) ? bound.filter((value): value is string => typeof value === "string") : typeof bound === "string" ? [bound] : [];
  const valuePath = bindingPath(properties.value);
  const [localSelection, setLocalSelection] = useState<string[]>(boundSelection);
  const boundKey = JSON.stringify(boundSelection);
  useEffect(() => {
    setLocalSelection(boundSelection);
    // [boundKey], not the array: the array identity would re-fire every render.
  }, [boundKey]);
  const selection = valuePath !== undefined && onEdit ? boundSelection : localSelection;
  const [filter, setFilter] = useState("");
  const toggle = (value: string) => {
    const next = exclusive
      ? [value]
      : selection.includes(value)
        ? selection.filter((item) => item !== value)
        : [...selection, value];
    if (valuePath !== undefined && onEdit) onEdit(absoluteDataPath(ctx.dataPath, valuePath), next);
    else setLocalSelection(next);
  };
  const visible = filterable && filter !== "" ? options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase())) : options;
  return (
    <View style={{ gap: compact ? 6 : 8, alignSelf: "stretch" }}>
      {label ? <RNText style={{ color: theme.colors.foregroundMuted, fontSize: compact ? 11 : 12 }}>{label}</RNText> : null}
      {filterable ? (
        <RNTextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter options…"
          placeholderTextColor={theme.colors.foregroundMuted}
          accessibilityLabel="Filter options"
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface1, color: theme.colors.foreground, paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 6 : 8, fontSize: compact ? 13 : 14 }}
        />
      ) : null}
      {chips ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: compact ? 6 : 8 }}>
          {visible.map((option) => {
            const selected = selection.includes(option.value);
            return (
              <Pressable
                key={option.value}
                onPress={() => toggle(option.value)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  {
                    borderWidth: 1,
                    borderRadius: 999,
                    borderColor: selected ? theme.colors.accent : theme.colors.border,
                    backgroundColor: selected ? theme.colors.accent : theme.colors.surface1,
                    paddingHorizontal: compact ? 10 : 12,
                    paddingVertical: compact ? 4 : 6,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <RNText style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: compact ? 12 : 13 }}>{option.label}</RNText>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: compact ? 6 : 8 }}>
          {visible.map((option) => {
            const selected = selection.includes(option.value);
            return (
              <Pressable key={option.value} onPress={() => toggle(option.value)} accessibilityRole={exclusive ? "radio" : "checkbox"} style={{ flexDirection: "row", alignItems: "center", gap: compact ? 6 : 8 }}>
                {exclusive ? (
                  <View style={{ width: compact ? 18 : 20, height: compact ? 18 : 20, borderRadius: 999, borderWidth: 1, borderColor: selected ? theme.colors.accent : theme.colors.border, alignItems: "center", justifyContent: "center" }}>
                    {selected ? <View style={{ width: compact ? 8 : 10, height: compact ? 8 : 10, borderRadius: 999, backgroundColor: theme.colors.accent }} /> : null}
                  </View>
                ) : (
                  <View style={{ width: compact ? 18 : 20, height: compact ? 18 : 20, borderWidth: 1, borderRadius: 4, borderColor: selected ? theme.colors.accent : theme.colors.border, backgroundColor: selected ? theme.colors.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {selected ? <Icon name="Check" /> : null}
                  </View>
                )}
                <RNText style={{ color: theme.colors.foreground, fontSize: compact ? 13 : 14 }}>{option.label}</RNText>
              </Pressable>
            );
          })}
        </View>
      )}
      {!check.ok && check.message ? <RNText style={{ color: theme.colors.statusDanger, fontSize: compact ? 11 : 12 }}>{check.message}</RNText> : null}
    </View>
  );
}

function SliderWidget(nodeProps: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const { ctx, theme, compact, onEdit, properties } = nodeProps;
  const label = resolvedString(properties.label, ctx);
  const check = evaluateChecks(properties.checks, ctx);
  const bound = resolveBinding(properties.value, ctx);
  const valuePath = bindingPath(properties.value);
  const min = typeof properties.min === "number" ? properties.min : 0;
  const max = typeof properties.max === "number" ? properties.max : 100;
  const steps = typeof properties.steps === "number" && properties.steps > 0 ? properties.steps : undefined;
  const boundNumber = typeof bound === "number" ? bound : Number(bound);
  const initial = Number.isFinite(boundNumber) ? boundNumber : min;
  const [localValue, setLocalValue] = useState(initial);
  useEffect(() => {
    setLocalValue(initial);
  }, [initial]);
  // Hand-rolled track: plugins cannot ship @react-native-community/slider
  // (native module). Dragging updates local display state; the model is
  // written once, on release.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const grantXRef = useRef(0);
  const widthRef = useRef(0);
  const latest = useRef({ min, max, steps, valuePath, onEdit, dataPath: ctx.dataPath });
  latest.current = { min, max, steps, valuePath, onEdit, dataPath: ctx.dataPath };
  const committed = valuePath !== undefined && onEdit ? initial : localValue;
  const display = dragValue ?? committed;
  const fraction = sliderFraction(display, min, max);
  const thumb = compact ? 16 : 20;
  const setDrag = (value: number | null) => {
    dragValueRef.current = value;
    setDragValue(value);
  };
  const commitDrag = useCallback(() => {
    const value = dragValueRef.current;
    setDrag(null);
    if (value === null) return;
    const snapped = snapSliderValue(value, latest.current.min, latest.current.max, latest.current.steps);
    const { valuePath: path, onEdit: edit, dataPath } = latest.current;
    if (path !== undefined && edit) edit(absoluteDataPath(dataPath, path), snapped);
    else setLocalValue(snapped);
  }, []);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          grantXRef.current = event.nativeEvent.locationX;
          const { min: lo, max: hi, steps: grid } = latest.current;
          setDrag(snapSliderValue(lo + (event.nativeEvent.locationX / Math.max(widthRef.current, 1)) * (hi - lo), lo, hi, grid));
        },
        onPanResponderMove: (_event, gesture) => {
          const { min: lo, max: hi, steps: grid } = latest.current;
          const x = grantXRef.current + gesture.dx;
          setDrag(snapSliderValue(lo + (x / Math.max(widthRef.current, 1)) * (hi - lo), lo, hi, grid));
        },
        onPanResponderRelease: commitDrag,
        onPanResponderTerminate: commitDrag,
      }),
    [commitDrag],
  );
  return (
    <View style={{ gap: 4, alignSelf: "stretch" }}>
      <View style={{ flexDirection: "row", justifyContent: label ? "space-between" : "flex-end" }}>
        {label ? <RNText style={{ color: theme.colors.foregroundMuted, fontSize: compact ? 11 : 12 }}>{label}</RNText> : null}
        <RNText style={{ color: theme.colors.foreground, fontSize: compact ? 11 : 12 }}>{Math.round(display * 100) / 100}</RNText>
      </View>
      <View
        {...panResponder.panHandlers}
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        style={{ alignSelf: "stretch", paddingVertical: 8, justifyContent: "center" }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border }}>
          <View style={{ height: 4, borderRadius: 2, width: `${fraction * 100}%`, backgroundColor: theme.colors.accent }} />
        </View>
        <View
          style={{
            position: "absolute",
            left: `${fraction * 100}%`,
            top: "50%",
            marginTop: -thumb / 2,
            marginLeft: -thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
            backgroundColor: theme.colors.accent,
            borderWidth: 2,
            borderColor: theme.colors.surface1,
          }}
        />
      </View>
      {!check.ok && check.message ? <RNText style={{ color: theme.colors.statusDanger, fontSize: compact ? 11 : 12 }}>{check.message}</RNText> : null}
    </View>
  );
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parses a typed ISO 8601 date, time, or date-time into the normalized string
 * written to the data model: strict shape regex plus a native `Date`
 * round-trip, so `2026-02-30` rejects instead of rolling over. Returns null
 * when the text matches no enabled shape.
 */
function parseIsoDateTimeInput(raw: string, enableDate: boolean, enableTime: boolean): string | null {
  const text = raw.trim();
  const neither = !enableDate && !enableTime;
  const allowDate = enableDate || neither;
  const allowTime = enableTime || neither;
  const allowDateTime = (enableDate && enableTime) || neither;
  if (allowDate && !enableTime && ISO_DATE.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return date.getUTCMonth() === Number(text.slice(5, 7)) - 1 && date.getUTCDate() === Number(text.slice(8, 10)) ? text : null;
  }
  if (allowTime && !enableDate && ISO_TIME.test(text)) return text;
  if (!allowDateTime) return null;
  const match = ISO_DATE_TIME.exec(text);
  if (!match) return null;
  let zone = match[7] ?? "";
  if (zone.length === 5 && zone[3] !== ":") zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}${match[6] ?? ":00"}${zone}`);
  if (Number.isNaN(date.getTime())) return null;
  // Trust the parsed date: zoned offsets are honored by converting to UTC.
  return date.toISOString();
}

function DateTimeInputWidget(nodeProps: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const { ctx, theme, compact, onEdit, properties } = nodeProps;
  const label = resolvedString(properties.label, ctx);
  const check = evaluateChecks(properties.checks, ctx);
  // Schema defaults: enableTime false; enableDate falls back to !enableTime.
  const enableTime = properties.enableTime === true;
  const enableDate = properties.enableDate === undefined ? !enableTime : properties.enableDate === true;
  const bound = resolveBinding(properties.value, ctx);
  const boundText = bound === undefined || bound === null || bound === UNRESOLVED ? "" : String(bound);
  const valuePath = bindingPath(properties.value);
  const placeholder = enableDate && enableTime ? "YYYY-MM-DDTHH:mm" : enableDate ? "YYYY-MM-DD" : "HH:mm";
  // Free-text ISO entry (no native date picker in plugin scope): commit on
  // blur/submit; an invalid draft stays raw with a muted hint, never thrown.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [boundText]);
  const commit = () => {
    if (draft === null) return;
    const normalized = parseIsoDateTimeInput(draft, enableDate, enableTime);
    if (normalized === null) {
      setError(`Invalid date/time — expected ${placeholder}`);
      return;
    }
    setError(null);
    if (valuePath !== undefined && onEdit) {
      onEdit(absoluteDataPath(ctx.dataPath, valuePath), normalized);
      setDraft(null);
    } else {
      setDraft(normalized);
    }
  };
  return (
    <View style={{ gap: 4, alignSelf: "stretch" }}>
      {label ? <RNText style={{ color: theme.colors.foregroundMuted, fontSize: compact ? 11 : 12 }}>{label}</RNText> : null}
      <RNTextInput
        value={draft ?? boundText}
        onChangeText={setDraft}
        onEndEditing={commit}
        onSubmitEditing={commit}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel={label || placeholder}
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
      {error ? <RNText style={{ color: theme.colors.foregroundMuted, fontSize: compact ? 11 : 12 }}>{error}</RNText> : null}
      {!check.ok && check.message ? <RNText style={{ color: theme.colors.statusDanger, fontSize: compact ? 11 : 12 }}>{check.message}</RNText> : null}
    </View>
  );
}

function VideoWidget(nodeProps: A2uiNodeProps & { properties: Record<string, unknown> }): ReactNode {
  const { ctx, theme, compact, properties } = nodeProps;
  const url = resolveBinding(properties.url, ctx);
  if (typeof url !== "string" || !isValidMediaUrl(url)) return <Placeholder theme={theme} text="‹no video›" />;
  const poster = resolveBinding(properties.posterUrl, ctx);
  const posterUrl = typeof poster === "string" && isValidMediaUrl(poster) ? poster : undefined;
  // v1 opens the platform browser. In-timeline playback needs the media-stream
  // pattern (subscription + binary frames); native video modules are off
  // limits for plugins.
  return (
    <Pressable
      onPress={() => {
        void openExternalUrl(url).catch(() => {});
      }}
      accessibilityRole="button"
      accessibilityLabel="Open video"
      style={({ pressed }) => [
        {
          alignSelf: "stretch",
          height: compact ? 140 : 180,
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          justifyContent: "center",
          alignItems: "center",
        },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      {posterUrl ? <RNImage source={{ uri: posterUrl }} resizeMode="cover" style={{ position: "absolute", width: "100%", height: "100%" }} /> : null}
      <View style={{ width: compact ? 40 : 48, height: compact ? 40 : 48, borderRadius: 999, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" }}>
        <Icon name="Play" />
      </View>
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
    if (typeof url !== "string" || !isValidMediaUrl(url)) {
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
