import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Image, PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { colors, radius, space, type } from "../core/theme";
import { prefs } from "../core/prefs";
import { fileUri } from "../engine/jobs";
import { useT } from "../i18n";

const tap = () => {
  if (prefs.haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

// Built once at module scope: one entering builder per stagger step, not one per render.
const RISE = Array.from({ length: 12 }, (_, step) =>
  FadeInDown.duration(380).delay(step * 60).easing(Easing.out(Easing.cubic)),
);
const SPRING = { damping: 18, stiffness: 420, mass: 0.6 };

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function iconFor(mime = "") {
  if (mime.startsWith("image/")) return "image-outline";
  if (mime.startsWith("video/")) return "videocam-outline";
  if (mime.startsWith("audio/")) return "musical-notes-outline";
  if (mime === "application/pdf") return "document-text-outline";
  return "document-outline";
}

// Entrance: content rises 10px and fades in, staggered by index. Skipped when reduce-motion is on.
export function Reveal({ index = 0, style, children }) {
  const reduced = useReducedMotion();
  return (
    <Animated.View entering={reduced ? undefined : RISE[Math.min(index, RISE.length - 1)]} style={style}>
      {children}
    </Animated.View>
  );
}

// A press target with a spring scale. The outer view takes layout styles; the inner Pressable handles touches.
export function Tappable({ onPress, disabled, label, role = "button", state, style, innerStyle, pressedStyle, children }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[animated, style]}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityState={state}
        disabled={disabled}
        onPressIn={() => {
          if (!disabled) scale.value = withSpring(0.97, SPRING);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, SPRING);
        }}
        onPress={() => {
          tap();
          onPress?.();
        }}
        style={({ pressed }) => [innerStyle, pressed && !disabled && pressedStyle, disabled && { opacity: 0.35 }]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function Mono({ children, color, style, ...rest }) {
  const { noCase } = useT();
  return (
    <Text style={[type.mono, color && { color }, noCase && styles.noCase, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Hairline({ strong, style }) {
  return <View style={[styles.hairline, { backgroundColor: strong ? colors.lineStrong : colors.line }, style]} />;
}

// index is only passed where the sections are real steps (conversion), never for menus.
export function SectionHeader({ index, title, trailing }) {
  return (
    <View style={styles.sectionHeader}>
      {index ? <Mono color={colors.accent}>{index}</Mono> : null}
      <Mono color={colors.text} style={styles.flex}>
        {title}
      </Mono>
      {trailing}
    </View>
  );
}

export function Button({ label, onPress, variant = "primary", icon, disabled, style }) {
  const { noCase } = useT();
  const primary = variant === "primary";
  const ink = primary ? colors.accentInk : colors.text;

  return (
    <Tappable
      label={label}
      onPress={onPress}
      disabled={disabled}
      state={{ disabled: !!disabled }}
      style={style}
      innerStyle={[styles.button, primary ? { backgroundColor: colors.accent } : styles.buttonGhost]}
      pressedStyle={{ opacity: 0.9 }}
    >
      {icon ? <Ionicons name={icon} size={18} color={ink} /> : null}
      <Text style={[styles.buttonLabel, noCase && styles.buttonLabelNoCase, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Tappable>
  );
}

export function OptionGroup({ label, choices, value, onChange }) {
  const { t } = useT();
  return (
    <View style={styles.group}>
      <Mono>{label}</Mono>
      <View style={styles.optionRow}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          const text = choice.labelKey ? t(choice.labelKey) : choice.label;
          return (
            <Tappable
              key={String(choice.value)}
              label={text}
              role="radio"
              state={{ selected }}
              onPress={() => {
                if (!selected && prefs.haptics) Haptics.selectionAsync();
                onChange(choice.value);
              }}
              innerStyle={[styles.option, selected && styles.optionSelected]}
              pressedStyle={!selected ? { borderColor: colors.accent } : undefined}
            >
              <Text style={[styles.optionLabel, { color: selected ? colors.accentInk : colors.text }]}>{text}</Text>
            </Tappable>
          );
        })}
      </View>
    </View>
  );
}

export function DisclosureRow({ label, count, open, onToggle }) {
  return (
    <Tappable label={label} state={{ expanded: open }} onPress={onToggle} innerStyle={styles.disclosure} pressedStyle={{ backgroundColor: colors.surface }}>
      <Mono color={colors.text} style={styles.flex}>
        {label}
      </Mono>
      {count ? <Mono color={colors.accent}>{count}</Mono> : null}
      <Ionicons name={open ? "remove" : "add"} size={20} color={colors.accent} />
    </Tappable>
  );
}

const THUMB_SIZE = 44;

function Thumbnail({ file }) {
  if (!file?.mime?.startsWith("image/")) {
    return (
      <View style={styles.fileIcon}>
        <Ionicons name={iconFor(file?.mime)} size={22} color={colors.accent} />
      </View>
    );
  }
  // Decode at the size it is drawn, not at full resolution: a full-size camera photo can take tens of MB of memory.
  const pixels = Math.round(PixelRatio.getPixelSizeForLayoutSize(THUMB_SIZE));
  return <Image source={{ uri: fileUri(file.path), width: pixels, height: pixels }} style={styles.thumb} accessibilityIgnoresInvertColors />;
}

// Empty state is a dashed drop zone; filled state is a compact file card with a real preview when possible.
export function FileDrop({ files, hint, meta, multiple, disabled, onPress }) {
  const { t } = useT();

  if (files.length === 0) {
    return (
      <Tappable
        label={multiple ? t("file.chooseMany") : t("file.choose")}
        disabled={disabled}
        onPress={onPress}
        innerStyle={styles.drop}
        pressedStyle={{ backgroundColor: colors.surface }}
      >
        <View style={styles.dropBadge}>
          <Ionicons name="add" size={26} color={colors.accentInk} />
        </View>
        <Text style={type.heading}>{multiple ? t("file.chooseMany") : t("file.choose")}</Text>
        <Mono>{hint}</Mono>
      </Tappable>
    );
  }

  const first = files[0];
  const title = multiple ? t("file.count", { count: files.length }) : first.name;
  const subtitle = multiple
    ? files
        .slice(0, 2)
        .map((file) => file.name)
        .join(" · ")
    : [formatBytes(first.size), meta].filter(Boolean).join(" · ");

  return (
    <Tappable
      label={t("file.change")}
      disabled={disabled}
      onPress={onPress}
      innerStyle={styles.fileCard}
      pressedStyle={{ backgroundColor: colors.surfaceHigh }}
    >
      <Thumbnail file={first} />
      <View style={[styles.flex, styles.fileText]}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {title}
        </Text>
        <Mono numberOfLines={1}>{subtitle}</Mono>
      </View>
      <Mono color={colors.accent}>{t("file.change")}</Mono>
    </Tappable>
  );
}

// Driven by a shared value on the UI thread: no React state, no JS-side animation frames.
export function ProgressBar({ fraction }) {
  const value = useSharedValue(0);

  useEffect(() => {
    value.value = withTiming(Math.max(0, Math.min(1, fraction)), { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [fraction, value]);

  const fill = useAnimatedStyle(() => ({ width: `${value.value * 100}%` }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <View style={styles.stat}>
      <Mono>{label}</Mono>
      <Text style={[type.stat, tone && { color: tone }]}>{value}</Text>
    </View>
  );
}

export function Notice({ tone = "info", children }) {
  const bar = tone === "danger" ? colors.danger : tone === "success" ? colors.success : colors.accent;
  return (
    <View style={styles.notice}>
      <View style={[styles.noticeBar, { backgroundColor: bar }]} />
      <Text style={[type.small, styles.flex, { color: colors.text }]}>{children}</Text>
    </View>
  );
}

export function CategoryRow({ icon, title, subtitle, formats, onPress }) {
  return (
    <Tappable label={title} onPress={onPress} innerStyle={styles.categoryRow} pressedStyle={{ backgroundColor: colors.surface }}>
      <View style={styles.categoryIcon}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={[styles.flex, styles.categoryText]}>
        <Text style={type.title}>{title}</Text>
        <Text style={type.small} numberOfLines={2}>
          {subtitle}
        </Text>
        <Mono>{formats}</Mono>
      </View>
      <Ionicons name="arrow-forward" size={22} color={colors.accent} />
    </Tappable>
  );
}

export function OutputRow({ name, mime, path, size, onPress, label }) {
  const ext = name.split(".").pop()?.toUpperCase();
  return (
    <Tappable label={label} onPress={onPress} innerStyle={styles.outputRow} pressedStyle={{ backgroundColor: colors.surface }}>
      <Thumbnail file={{ mime, path }} />
      <View style={[styles.flex, styles.fileText]}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {name}
        </Text>
        <Mono>{`${ext} · ${formatBytes(size)}`}</Mono>
      </View>
      <Ionicons name="share-outline" size={22} color={colors.accent} />
    </Tappable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noCase: { letterSpacing: 0, textTransform: "none", fontSize: 16 },
  hairline: { height: StyleSheet.hairlineWidth },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.xl,
    borderRadius: radius,
  },
  buttonGhost: { borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: "transparent" },
  buttonLabel: {
    fontFamily: type.heading.fontFamily,
    fontWeight: "700",
    fontSize: 19,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  buttonLabelNoCase: { letterSpacing: 0, textTransform: "none", fontSize: 19 },
  group: { gap: space.sm },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  option: {
    minHeight: 44,
    minWidth: 52,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius,
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionLabel: { fontFamily: type.body.fontFamily, fontWeight: "600", fontSize: 16 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  drop: {
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    borderRadius: radius,
  },
  dropBadge: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    borderRadius: radius,
    marginBottom: space.xs,
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius,
    backgroundColor: colors.surface,
  },
  fileIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceHigh,
  },
  fileText: { gap: space.xxs },
  track: { height: 6, backgroundColor: colors.line, borderRadius: 1, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.accent },
  stat: { gap: space.xs },
  notice: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space.md,
    backgroundColor: colors.surface,
    paddingRight: space.md,
    paddingVertical: space.md,
  },
  noticeBar: { width: 3 },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  categoryIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius,
  },
  categoryText: { gap: space.xs },
  outputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
});
