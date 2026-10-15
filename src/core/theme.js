import { Platform } from "react-native";

// Editorial-brutalist tokens: near-black paper, one signal color, hairlines instead of shadows.
export const colors = {
  bg: "#0B0B0B",
  surface: "#141414",
  surfaceHigh: "#1C1C1C",
  line: "#242424",
  lineStrong: "#3A3A3A",
  text: "#F5F5F5",
  muted: "#A8A8A8",
  accent: "#3B82F6",
  accentInk: "#0B0B0B",
  danger: "#FF6B6B",
  success: "#7EE787",
};

// Android ships condensed and monospace families, so no font files are bundled.
export const fonts = {
  display: Platform.select({ android: "sans-serif-condensed", default: undefined }),
  body: "sans-serif",
  mono: "monospace",
};

export const radius = 4;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const type = {
  // lineHeight must clear the glyph box (ascender + descender); a tighter value clips "g", "p", "y" on Android.
  display: { fontFamily: fonts.display, fontWeight: "700", fontSize: 64, lineHeight: 76, letterSpacing: -1.5, color: colors.text },
  title: { fontFamily: fonts.display, fontWeight: "700", fontSize: 40, lineHeight: 50, letterSpacing: -0.8, color: colors.text },
  heading: { fontFamily: fonts.display, fontWeight: "700", fontSize: 26, lineHeight: 34, letterSpacing: -0.3, color: colors.text },
  stat: { fontFamily: fonts.display, fontWeight: "700", fontSize: 32, lineHeight: 42, letterSpacing: -0.5, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: colors.text },
  bodyStrong: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, fontWeight: "600", color: colors.text },
  small: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, letterSpacing: 0.9, textTransform: "uppercase", color: colors.muted },
};
