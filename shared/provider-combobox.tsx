import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { ScrollView as HostScrollView, TextInput as HostTextInput } from "@getpaseo/plugin/client/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

export interface ProviderSelection {
  provider: string;
  thinkingOptionId?: string;
}

export function ProviderCombobox({
  theme,
  provider,
  thinkingOptionId,
  queryKeyPrefix,
  onChange,
}: {
  theme: PluginTheme;
  provider: string;
  thinkingOptionId: string;
  queryKeyPrefix: string;
  onChange: (next: ProviderSelection) => void;
}) {
  const c = theme.colors;
  const paseo = usePaseo();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("");
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inputStyle = { color: c.foreground, backgroundColor: c.surface0, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, fontSize: 13 } as const;
  const labelStyle = { color: c.foreground, fontWeight: "600", fontSize: 13 } as const;

  const providersQuery = useQuery({
    queryKey: [queryKeyPrefix, "providers"],
    queryFn: () => paseo.providers.listAvailable(),
    staleTime: 60000,
  });
  const harnesses = useMemo(() => (providersQuery.data?.providers ?? []).map((p) => p.provider), [providersQuery.data]);
  const modelQueries = useQueries({
    queries: harnesses.map((h) => ({
      queryKey: [queryKeyPrefix, "models", h],
      queryFn: () => paseo.providers.listModels(h),
      staleTime: 60000,
    })),
  });

  const options = useMemo(() => {
    const out: string[] = [];
    harnesses.forEach((h, i) => {
      for (const m of modelQueries[i]?.data?.models ?? []) out.push(`${h}/${m.id}`);
    });
    return out.sort((a, b) => a.localeCompare(b));
  }, [harnesses, modelQueries]);

  const thinkingOptions = useMemo(() => {
    const idx = provider.indexOf("/");
    if (idx === -1) return [];
    const harness = provider.slice(0, idx);
    const model = provider.slice(idx + 1);
    const hi = harnesses.indexOf(harness);
    if (hi === -1) return [];
    const def = (modelQueries[hi]?.data?.models ?? []).find((m) => m.id === model);
    return (def?.thinkingOptions ?? []).map((t) => ({ id: t.id, label: t.label, isDefault: t.isDefault }));
  }, [provider, harnesses, modelQueries]);

  useEffect(() => {
    if (thinkingOptions.length > 0 && (!thinkingOptionId || !thinkingOptions.some((t) => t.id === thinkingOptionId))) {
      const def = thinkingOptions.find((t) => t.isDefault) ?? thinkingOptions[0];
      onChange({ provider, thinkingOptionId: def.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, thinkingOptions, thinkingOptionId]);

  const q = filter.trim().toLowerCase();
  const matches = (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 50);
  const display = editing ? filter : provider;

  function closeSoon() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => { setOpen(false); setEditing(false); }, 150);
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ ...inputStyle, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 0 }}>
        <HostTextInput
          value={display}
          onChangeText={(v) => { setFilter(v); onChange({ provider: v, thinkingOptionId: "" }); setOpen(true); }}
          style={{ flex: 1, color: c.foreground, padding: 8, fontSize: 13 }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Search providers and models…"
          placeholderTextColor={c.foregroundMuted}
          onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setEditing(true); setFilter(""); setOpen(true); }}
          onBlur={closeSoon}
        />
        <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingHorizontal: 8 }}>▾</Text>
      </View>
      {open && matches.length > 0 ? (
        <HostScrollView style={{ maxHeight: 180, borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface0 }} keyboardShouldPersistTaps="handled">
          {matches.map((o) => (
            <Pressable
              key={o}
              accessibilityRole="button"
              accessibilityLabel={o}
              onPress={() => { onChange({ provider: o, thinkingOptionId: "" }); setEditing(false); setFilter(""); setOpen(false); }}
              style={{ paddingHorizontal: 10, paddingVertical: 8 }}
            >
              <Text style={{ color: o === provider ? c.accent : c.foreground, fontSize: 12 }}>{o}</Text>
            </Pressable>
          ))}
        </HostScrollView>
      ) : null}
      {thinkingOptions.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Thinking option</Text>
          {thinkingOptions.map((t) => (
            <Pressable key={t.id} accessibilityRole="button" onPress={() => onChange({ provider, thinkingOptionId: t.id })} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: thinkingOptionId === t.id ? c.accent : c.foregroundMuted, alignItems: "center", justifyContent: "center" }}>
                {thinkingOptionId === t.id ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} /> : null}
              </View>
              <Text style={{ color: c.foreground, fontSize: 13 }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
