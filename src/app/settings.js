import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Hairline, Mono, Notice, SectionHeader } from "../components/ui";
import { prefs, setAutoSave, setHaptics } from "../core/prefs";
import { colors, radius, space, type } from "../core/theme";
import { LANGUAGES, useT } from "../i18n";

const logo = require("../assets/logo-mark.png");

// An on/off setting with a short explanation and a checkbox.
function SwitchRow({ label, hint, value, onToggle }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={onToggle}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: space.md },
        pressed && { backgroundColor: colors.surface },
      ]}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={type.bodyStrong}>{label}</Text>
        <Text style={type.small}>{hint}</Text>
      </View>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: value ? colors.accent : colors.lineStrong,
          backgroundColor: value ? colors.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value ? <Ionicons name="checkmark" size={18} color={colors.accentInk} /> : null}
      </View>
    </Pressable>
  );
}

export default function Settings() {
  const { t, locale, setLocale, directionMismatch } = useT();
  const [restartNeeded, setRestartNeeded] = useState(directionMismatch);
  const [haptics, setHapticsState] = useState(prefs.haptics);
  const [autoSave, setAutoSaveState] = useState(prefs.autoSave);

  async function chooseLanguage(code) {
    if (code === locale) return;
    const needsRestart = await setLocale(code);
    if (needsRestart) setRestartNeeded(true);
  }

  async function toggleAutoSave() {
    const next = !autoSave;
    setAutoSaveState(next);
    await setAutoSave(next);
  }

  async function toggleHaptics() {
    const next = !haptics;
    setHapticsState(next);
    await setHaptics(next);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom"]}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("screen.back")} hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Image source={logo} style={{ width: 26, height: 26, borderRadius: 4 }} accessibilityIgnoresInvertColors />
        </View>
        <Text style={type.title} accessibilityRole="header">{t("settings.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xxl, paddingBottom: space.xxl }}>
        <View style={{ gap: space.lg }}>
          <SectionHeader title={t("settings.language")} />
          <Mono>{t("settings.languageHint")}</Mono>
          <View>
            {LANGUAGES.map((language) => {
              const selected = language.code === locale;
              return (
                <Pressable
                  key={language.code}
                  accessibilityRole="radio"
                  accessibilityLabel={language.name}
                  accessibilityState={{ selected }}
                  onPress={() => chooseLanguage(language.code)}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.lg,
                      paddingVertical: space.lg,
                      borderTopWidth: 1,
                      borderTopColor: colors.line,
                    },
                    pressed && { backgroundColor: colors.surface },
                  ]}
                >
                  <Text style={{ fontSize: 22 }}>{language.flag}</Text>
                  <Text style={[type.bodyStrong, { flex: 1, color: selected ? colors.accent : colors.text }]}>{language.name}</Text>
                  {selected ? <Ionicons name="checkmark" size={22} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            <Hairline />
          </View>
          {restartNeeded ? <Notice tone="danger">{t("settings.rtlRestart")}</Notice> : null}
        </View>

        <View style={{ gap: space.lg }}>
          <SectionHeader title={t("settings.about")} />
          <SwitchRow label={t("settings.autoSave")} hint={t("settings.autoSaveHint")} value={autoSave} onToggle={toggleAutoSave} />
          <Hairline />
          <SwitchRow label={t("settings.haptics")} hint={t("settings.hapticsHint")} value={haptics} onToggle={toggleHaptics} />
          <Hairline />
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: space.md }}>
            <Mono>{t("settings.version")}</Mono>
            <Mono color={colors.text}>{t("app.version")}</Mono>
          </View>
          <Hairline />
          <Notice tone="success">{t("settings.privacy")}</Notice>
          <Hairline />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("settings.licenses")}
            onPress={() => router.push("/licenses")}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, opacity: pressed ? 0.7 : 1 })}
          >
            <Mono style={{ flex: 1 }}>{t("settings.licenses")}</Mono>
            <Ionicons name="arrow-forward" size={18} color={colors.accent} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
