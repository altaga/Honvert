import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DisclosureRow, Hairline, Mono, SectionHeader } from "../components/ui";
import { colors, fonts, space, type } from "../core/theme";
import { useT } from "../i18n";
import { FFMPEG_KIT_VERSION, FFMPEG_VERSION, NOTICES } from "../legal/third-party-notices";

const logo = require("../assets/logo-mark.png");

// Public source for the FFmpeg release and for the build used in this app (LGPL section 6 / source offer).
const FFMPEG_SOURCE_URL = "https://ffmpeg.org/releases/";
const BUILD_SOURCE_URL = "https://github.com/ffmpegkit-maintained/ffmpeg";

// License texts are not uppercased, unlike Mono, so they stay readable.
const legalText = { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.muted, letterSpacing: 0, textTransform: "none" };

function LinkRow({ label, url }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => Linking.openURL(url).catch(() => {})}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, opacity: pressed ? 0.7 : 1 })}
    >
      <Mono color={colors.text} style={{ flex: 1 }}>
        {label}
      </Mono>
      <Ionicons name="open-outline" size={18} color={colors.accent} />
    </Pressable>
  );
}

export default function Licenses() {
  const { t } = useT();
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom"]}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("screen.back")} hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Image source={logo} style={{ width: 26, height: 26, borderRadius: 4 }} accessibilityIgnoresInvertColors />
        </View>
        <Text style={type.title}>{t("licenses.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xxl, paddingBottom: space.xxl }}>
        <Text style={type.body}>{t("licenses.intro")}</Text>
        <Mono color={colors.accent}>
          FFmpeg {FFMPEG_VERSION} · ffmpeg-kit {FFMPEG_KIT_VERSION}
        </Mono>

        <View style={{ gap: space.sm }}>
          <SectionHeader title={t("licenses.sourceTitle")} />
          <Text style={[legalText, { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text }]}>{t("licenses.sourceBody")}</Text>
          <Hairline />
          <LinkRow label={t("licenses.ffmpegSource")} url={FFMPEG_SOURCE_URL} />
          <Hairline />
          <LinkRow label={t("licenses.buildSource")} url={BUILD_SOURCE_URL} />
          <Hairline />
        </View>

        <View style={{ gap: space.sm }}>
          <SectionHeader title={t("licenses.libraries")} />
          <Text style={legalText}>{NOTICES.map((notice) => notice.name).join("  ·  ")}</Text>
        </View>

        <View style={{ gap: space.sm }}>
          <SectionHeader title={t("licenses.fullTexts")} />
          {NOTICES.map((notice, index) => (
            <View key={notice.name}>
              <DisclosureRow
                label={notice.name}
                open={openIndex === index}
                onToggle={() => setOpenIndex(openIndex === index ? null : index)}
              />
              {openIndex === index ? (
                <Text selectable style={[legalText, { paddingVertical: space.md }]}>
                  {notice.text}
                </Text>
              ) : null}
              <Hairline />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
