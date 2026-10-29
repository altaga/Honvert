import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CategoryRow, Hairline, Mono, Reveal, Tappable } from "../components/ui";
import { colors, space, type } from "../core/theme";
import { CATEGORIES } from "../engine/options";
import { restorePendingPick } from "../engine/picker";
import { useT } from "../i18n";

const logo = require("../assets/logo-mark.png");

// One icon per tool. Tools are a menu, not a sequence, so they get no step numbers.
const ICONS = {
  image: "image-outline",
  gif: "sparkles-outline",
  audio: "musical-notes-outline",
  video: "videocam-outline",
  pdf: "document-text-outline",
  repair: "construct-outline",
};

export default function Home() {
  const { t } = useT();
  const entries = Object.entries(CATEGORIES);

  // Android may kill the app while the file picker is open. The picked files survive: reopen their converter.
  useEffect(() => {
    const route = restorePendingPick();
    if (route) router.push(route);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom"]}>
      <Reveal index={0} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xl, paddingTop: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Image source={logo} style={{ width: 30, height: 30, borderRadius: 4 }} accessibilityIgnoresInvertColors />
          <Text style={[type.heading, { fontSize: 20, lineHeight: 22 }]}>{t("app.name")}</Text>
          <Mono>{t("app.version")}</Mono>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ borderWidth: 1, borderColor: colors.accent, paddingHorizontal: space.sm, paddingVertical: space.xxs }}>
            <Mono color={colors.accent}>● {t("home.offline")}</Mono>
          </View>
          <Tappable label={t("home.settings")} onPress={() => router.push("/settings")} innerStyle={{ padding: space.xs }} pressedStyle={{ opacity: 0.6 }}>
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Tappable>
        </View>
      </Reveal>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        <Reveal index={1} style={{ paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.sm }}>
          <Text style={{ ...type.display, fontSize: 52, lineHeight: 50, letterSpacing: -1.5 }} accessibilityRole="header">
            {t("home.headline")}
          </Text>
          <Text style={{ ...type.heading, color: colors.accent, fontSize: 26, lineHeight: 30 }}>{t("home.headlineAccent")}</Text>
          <Text style={[type.small, { marginTop: space.xs }]}>{t("home.lede")}</Text>
        </Reveal>

        <View style={{ marginTop: space.xl }}>
          <Reveal index={2} style={{ paddingHorizontal: space.xl, paddingBottom: space.md }}>
            <Mono>{t("home.tools")}</Mono>
          </Reveal>
          <Hairline strong />
          {entries.map(([key, category], index) => (
            <Reveal key={key} index={3 + index}>
              <CategoryRow
                icon={ICONS[key]}
                title={t(category.titleKey)}
                subtitle={t(category.subtitleKey)}
                formats={t(category.formatsKey)}
                onPress={() => router.push(`/convert/${key}`)}
              />
            </Reveal>
          ))}
          <Hairline />
        </View>

        <Reveal index={9} style={{ paddingHorizontal: space.xl, paddingTop: space.xl }}>
          <Mono>{t("home.footer")}</Mono>
        </Reveal>
      </ScrollView>
    </SafeAreaView>
  );
}
