import { I18nManager } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getAsyncStorageValue, setAsyncStorageValue } from "../utilsApp/utils";
import { loadPrefs } from "../core/prefs";
import ar from "./locales/ar";
import de from "./locales/de";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import hi from "./locales/hi";
import ja from "./locales/ja";
import pt from "./locales/pt";
import ru from "./locales/ru";
import zh from "./locales/zh";

// Order matches the language picker.
export const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "ar", name: "العربية", flag: "🇸🇦", rtl: true },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "pt", name: "Português", flag: "🇧🇷" },
  { code: "hi", name: "हिन्दी", flag: "🇮🇳" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
];

const DICTIONARIES = { en, zh, fr, es, ar, ru, de, pt, hi, ja };
const RTL_CODES = new Set(LANGUAGES.filter((language) => language.rtl).map((language) => language.code));

// Scripts without uppercase or letter-spacing need plain monospace labels.
export const NO_CASE_CODES = new Set(["ar", "hi", "zh", "ja"]);

export function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      let saved = null;
      try {
        saved = await getAsyncStorageValue("locale", "Settings");
      } catch {
        saved = null;
      }
      await loadPrefs();
      if (!active) return;
      // English is the default; the device language is not used. Only an explicit choice overrides it.
      setLocaleState(saved && DICTIONARIES[saved] ? saved : "en");
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Changing direction needs a restart on Android, so this reports whether one is pending.
  const setLocale = useCallback(async (code) => {
    setLocaleState(code);
    await setAsyncStorageValue({ locale: code }, "Settings");
    const wantRtl = RTL_CODES.has(code);
    if (I18nManager.isRTL !== wantRtl) {
      I18nManager.allowRTL(wantRtl);
      I18nManager.forceRTL(wantRtl);
      return true;
    }
    return false;
  }, []);

  const value = useMemo(() => {
    const dictionary = DICTIONARIES[locale] ?? en;
    const t = (key, params) => interpolate(dictionary[key] ?? en[key] ?? key, params);
    return {
      locale,
      setLocale,
      t,
      ready,
      isRTL: RTL_CODES.has(locale),
      noCase: NO_CASE_CODES.has(locale),
      directionMismatch: I18nManager.isRTL !== RTL_CODES.has(locale),
    };
  }, [locale, setLocale, ready]);

  if (!ready) return null;
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useT must be used inside LocaleProvider");
  return context;
}
