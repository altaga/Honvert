import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  DisclosureRow,
  FileDrop,
  Hairline,
  Mono,
  Notice,
  OptionGroup,
  OutputRow,
  ProgressBar,
  Reveal,
  SectionHeader,
  Stat,
  formatBytes,
} from "../../components/ui";
import { prefs } from "../../core/prefs";
import { colors, radius, space, type } from "../../core/theme";
import { cancelControl, fileUri, newControl, runConversion, toPath } from "../../engine/jobs";
import { EngineError, JobCancelled } from "../../engine/errors";
import { fileNameFor, withoutExtension } from "../../engine/names";
import { requestNotificationPermission } from "../../engine/background";
import { setEngineLabels } from "../../engine/labels";
import { saveToFolder } from "../../../modules/honvert-engine";
import { probeFile } from "../../engine/media";
import { CATEGORIES, PDF_MODES } from "../../engine/options";
import { useT } from "../../i18n";

export default function ConvertRoute() {
  const { kind } = useLocalSearchParams();
  const category = CATEGORIES[kind];
  if (!category) return <Redirect href="/" />;
  return <Converter key={kind} kind={kind} category={category} />;
}

// "1280×720 · 12.4 s · VIDEO + AUDIO". Still images are reported as video streams by ffprobe,
// so for the image category only the dimensions are shown.
function describeMedia(info, kind, t) {
  if (!info) return "";
  const parts = [];
  if (info.width) parts.push(`${info.width}×${info.height}`);
  if (kind === "image") return parts.join(" · ");
  if (info.durationMs) parts.push(`${(info.durationMs / 1000).toFixed(1)} ${t("media.seconds")}`);
  if (info.hasVideo && info.hasAudio) parts.push(t("media.videoAudio"));
  else if (info.hasVideo) parts.push(t("media.video"));
  else if (info.hasAudio) parts.push(t("media.audio"));
  return parts.join(" · ");
}

function Converter({ kind, category }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const advancedKeys = category.advanced ?? [];

  const [options, setOptions] = useState(category.defaults);
  const [files, setFiles] = useState([]);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [control, setControl] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [reference, setReference] = useState(null);
  const [saving, setSaving] = useState(null);

  const pdfMode = kind === "pdf" ? PDF_MODES[options.mode] : null;
  const picker = pdfMode ? { types: pdfMode.picker, multiple: pdfMode.multiple } : category.picker;
  const acceptKey = pdfMode ? pdfMode.acceptKey : category.acceptKey;
  const visible = category.controls.filter((control) => !control.visible || control.visible(options));
  const primary = visible.filter((control) => !advancedKeys.includes(control.key));
  const advanced = visible.filter((control) => advancedKeys.includes(control.key));
  const busy = status === "running";

  const inputBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const outputBytes = result ? result.outputs.reduce((sum, output) => sum + (output.size || 0), 0) : 0;
  const savings = inputBytes && outputBytes ? Math.round((1 - outputBytes / inputBytes) * 100) : null;

  // Human summary of the current settings, shown in the bottom bar.
  const summary = [
    pdfMode ? t(pdfMode.labelKey) : null,
    ...primary
      .filter((control) => control.key !== "mode")
      .map((control) => {
        const choice = control.choices.find((item) => item.value === options[control.key]);
        return choice ? (choice.labelKey ? t(choice.labelKey) : choice.label) : null;
      }),
  ]
    .filter(Boolean)
    .join(" · ");

  // Read media details for single-file categories. The result is tagged with its file, so an old
  // result never shows up for a new file and the effect does not have to clear state up front.
  useEffect(() => {
    let active = true;
    if (kind === "pdf" || files.length !== 1) return;
    const path = files[0].path;
    probeFile(path)
      .then((data) => active && setInfo({ path, data }))
      .catch(() => active && setInfo(null));
    return () => {
      active = false;
    };
  }, [files, kind]);
  const mediaInfo = files.length === 1 && info?.path === files[0].path ? info.data : null;

  function resetResult() {
    setResult(null);
    setMessage("");
    setStatus("idle");
    setSaving(null);
  }

  function buzz(type) {
    if (prefs.haptics) Haptics.notificationAsync(type);
  }

  function setOption(key, value) {
    setOptions((previous) => ({ ...previous, [key]: value }));
    if (key === "mode") {
      setFiles([]);
      resetResult();
    }
  }

  async function pickFiles() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: picker.types,
      multiple: picker.multiple,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;

    setFiles(
      picked.assets.map((asset) => ({
        name: asset.name,
        path: toPath(asset.uri),
        mime: asset.mimeType,
        size: asset.size,
      })),
    );
    resetResult();
  }

  // The reference is optional: a healthy video from the same camera, used by the repair tool.
  async function pickReference() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["video/*"],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    setReference({ name: asset.name, path: toPath(asset.uri), mime: asset.mimeType, size: asset.size });
  }

  function startOver() {
    setFiles([]);
    setProgress(0);
    resetResult();
  }

  async function convert() {
    if (!files.length) return;
    // Ask once for notifications, then give the service the strings in the current language.
    await requestNotificationPermission();
    setEngineLabels({ title: "Honvert", processing: t("file.processing"), cancel: t("action.cancel"), done: t("bg.done") });
    const job = newControl();
    resetResult();
    setControl(job);
    setProgress(0);
    setStatus("running");

    try {
      const runOptions = kind === "repair" ? { ...options, reference } : options;
      const output = await runConversion(kind, files, runOptions, { onProgress: setProgress, control: job });
      const outputs = await Promise.all(
        output.outputs.map(async (item) => {
          const stat = await FileSystem.getInfoAsync(fileUri(item.path));
          return { ...item, name: item.path.split("/").pop(), size: stat.exists ? stat.size : 0 };
        }),
      );
      setResult({ note: output.note, outputs });
      setStatus("done");
      buzz(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (error instanceof JobCancelled) {
        setStatus("idle");
        setMessage(t("error.cancelled"));
      } else {
        setStatus("error");
        setMessage(error instanceof EngineError ? t(error.key) : t("error.generic"));
        if (__DEV__) console.warn("conversion failed", error?.key, error?.detail);
        buzz(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setControl(null);
    }
  }

  async function share(output) {
    if (!(await Sharing.isAvailableAsync())) {
      setMessage(t("share.unavailable"));
      setStatus("error");
      return;
    }
    await Sharing.shareAsync(fileUri(output.path), { mimeType: output.mime, dialogTitle: t("action.share") });
  }

  // Saves a copy of one result into a folder the user picks, under the name the user typed.
  async function saveOutput(output) {
    const picked = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!picked.granted) return;
    try {
      await saveToFolder(output.path, picked.directoryUri, fileNameFor(saving?.name, output.name), output.mime);
      setSaving(null);
      setMessage(t("save.done"));
      buzz(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMessage(t("save.failed"));
      setStatus("error");
      buzz(Haptics.NotificationFeedbackType.Error);
    }
  }

  const renderControl = (control) => (
    <OptionGroup
      key={control.key}
      label={t(control.labelKey)}
      choices={control.choices}
      value={options[control.key]}
      onChange={(value) => setOption(control.key, value)}
    />
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("screen.back")} hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Mono>Honvert</Mono>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={type.title} accessibilityRole="header">{t(category.titleKey)}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 170 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 01 → 02 → 03 is a real sequence, so these steps are numbered and enter in order. */}
        <Reveal index={0} style={styles.section}>
          <SectionHeader
            index="01"
            title={t("section.file")}
            trailing={files.length ? <Mono color={colors.success}>● {t("file.ready")}</Mono> : null}
          />
          <FileDrop
            files={files}
            hint={t(acceptKey)}
            meta={describeMedia(mediaInfo, kind, t)}
            multiple={picker.multiple}
            disabled={busy}
            onPress={pickFiles}
          />
        </Reveal>

        {kind === "repair" && (
          <Reveal index={1} style={styles.section}>
            <SectionHeader index="02" title={t("repair.referenceTitle")} />
            <FileDrop
              files={reference ? [reference] : []}
              hint={t("repair.referenceHint")}
              multiple={false}
              disabled={busy}
              onPress={pickReference}
            />
          </Reveal>
        )}

        {primary.length > 0 && (
          <Reveal index={1} style={styles.section}>
            <SectionHeader index="02" title={t("section.settings")} />
            {primary.map(renderControl)}
            {advanced.length > 0 && (
              <View style={styles.advanced}>
                <DisclosureRow
                  label={t("settings.advanced")}
                  count={String(advanced.length)}
                  open={showAdvanced}
                  onToggle={() => setShowAdvanced((open) => !open)}
                />
                {showAdvanced && advanced.map(renderControl)}
              </View>
            )}
          </Reveal>
        )}

        {message ? <Notice tone={status === "error" ? "danger" : "info"}>{message}</Notice> : null}

        {result && (
          <Reveal index={0} style={styles.section}>
            <SectionHeader
              index="03"
              title={t("section.result")}
              trailing={<Mono color={colors.success}>● {t("file.done")}</Mono>}
            />
            <View style={styles.statsRow}>
              <Stat label={t("result.original")} value={formatBytes(inputBytes)} />
              <Stat label={t("output.label")} value={formatBytes(outputBytes)} />
              {savings !== null && (
                <Stat
                  label={savings >= 0 ? t("result.saved") : t("result.increase")}
                  value={`${Math.abs(savings)}%`}
                  tone={savings >= 0 ? colors.success : colors.text}
                />
              )}
            </View>
            {savings !== null && savings < 0 ? <Notice>{t("result.grewNote")}</Notice> : null}
            {result.note ? <Notice>{t(result.note)}</Notice> : null}
            <View>
              {result.outputs.map((output) => (
                <View key={output.path}>
                  <OutputRow
                    name={output.name}
                    mime={output.mime}
                    path={output.path}
                    size={output.size}
                    label={`${t("action.share")}: ${output.name}`}
                    onPress={() => share(output)}
                    onDownload={() => setSaving({ path: output.path, name: withoutExtension(output.name) })}
                  />
                  {saving?.path === output.path ? (
                    <View style={styles.saveEditor}>
                      <Mono>{t("save.nameLabel")}</Mono>
                      <TextInput
                        value={saving.name}
                        onChangeText={(name) => setSaving({ path: output.path, name })}
                        style={styles.nameInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel={t("save.nameLabel")}
                      />
                      <Button label={t("save.choose")} icon="folder-open-outline" onPress={() => saveOutput(output)} />
                      <Button variant="ghost" label={t("action.cancel")} onPress={() => setSaving(null)} />
                    </View>
                  ) : null}
                </View>
              ))}
              <Hairline />
            </View>
          </Reveal>
        )}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {busy ? (
          <View style={styles.bottomStack}>
            <View style={styles.progressHead}>
              <Mono color={colors.text}>{t("file.processing")}</Mono>
              <Mono color={colors.accent}>{Math.round(progress * 100)}%</Mono>
            </View>
            <ProgressBar fraction={progress} />
            <Button variant="ghost" label={t("action.cancel")} icon="close" onPress={() => control && cancelControl(control)} />
          </View>
        ) : (
          <View style={styles.bottomStack}>
            <Mono numberOfLines={1}>{summary ? `${t("output.label")} · ${summary}` : t("output.empty")}</Mono>
            <View style={styles.bottomRow}>
              {result ? (
                <Button variant="ghost" label={t("action.new")} onPress={startOver} style={styles.secondaryAction} />
              ) : null}
              <Button
                label={t("action.convert")}
                icon="arrow-forward"
                disabled={!files.length}
                onPress={convert}
                style={styles.primaryAction}
              />
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerSpacer: { width: 24 },
  content: { padding: space.xl, gap: space.xxl },
  section: { gap: space.lg },
  advanced: { gap: space.md },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xl },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
  },
  bottomStack: { gap: space.md },
  bottomRow: { flexDirection: "row", gap: space.md },
  primaryAction: { flex: 1 },
  secondaryAction: { flex: 0.45 },
  saveEditor: { gap: space.md, paddingTop: space.md },
  nameInput: {
    ...type.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
