import fs from "fs";
import path from "path";
import { interpolate, LANGUAGES } from "../../src/i18n/index";
import ar from "../../src/i18n/locales/ar";
import de from "../../src/i18n/locales/de";
import en from "../../src/i18n/locales/en";
import es from "../../src/i18n/locales/es";
import fr from "../../src/i18n/locales/fr";
import hi from "../../src/i18n/locales/hi";
import ja from "../../src/i18n/locales/ja";
import pt from "../../src/i18n/locales/pt";
import ru from "../../src/i18n/locales/ru";
import zh from "../../src/i18n/locales/zh";

jest.mock("../../src/utilsApp/utils", () => ({ getAsyncStorageValue: jest.fn(), setAsyncStorageValue: jest.fn() }));
jest.mock("../../src/core/prefs", () => ({ loadPrefs: jest.fn(), prefs: { haptics: true }, setHaptics: jest.fn() }));

const DICTIONARIES = { en, ar, de, es, fr, hi, ja, pt, ru, zh };
const CODES = Object.keys(DICTIONARIES);
const OTHERS = CODES.filter((code) => code !== "en");
const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const LOCALES = path.join(SRC, "i18n", "locales");
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;
const enKeys = Object.keys(en).sort();
const placeholders = (text) => JSON.stringify([...new Set(String(text).match(/\{\w+\}/g) ?? [])].sort());

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.jsx?$/.test(entry.name) && !full.startsWith(LOCALES)) found.push(full);
  }
  return found;
}

// Every dotted string literal in the app, and every translation call that builds its key at runtime.
const usage = (() => {
  const literals = new Set();
  const templated = [];
  for (const file of sourceFiles(SRC)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)) {
      const literal = match[1] ?? match[2];
      if (KEY_SHAPE.test(literal)) literals.add(literal);
    }
    if (/\bt\(\s*`/.test(source)) templated.push(path.relative(ROOT, file));
  }
  return { literals, templated };
})();

describe("locales", () => {
  it("cover exactly the languages offered in the picker", () => {
    expect(LANGUAGES.map((language) => language.code).sort()).toEqual([...CODES].sort());
    for (const code of CODES) expect(fs.existsSync(path.join(LOCALES, `${code}.js`))).toBe(true);
  });

  it("mark only Arabic as right-to-left", () => {
    expect(LANGUAGES.filter((language) => language.rtl).map((language) => language.code)).toEqual(["ar"]);
  });

  it.each(OTHERS)("%s has every English key and no extra keys", (code) => {
    const keys = Object.keys(DICTIONARIES[code]);
    expect(enKeys.filter((key) => !keys.includes(key))).toEqual([]);
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });

  it.each(CODES)("%s has no empty translations", (code) => {
    const empty = Object.entries(DICTIONARIES[code]).filter(([, value]) => typeof value !== "string" || value.trim() === "");
    expect(empty.map(([key]) => key)).toEqual([]);
  });

  it.each(OTHERS)("%s keeps the placeholders of each English string", (code) => {
    const mismatched = enKeys.filter(
      (key) => key in DICTIONARIES[code] && placeholders(en[key]) !== placeholders(DICTIONARIES[code][key]),
    );
    expect(mismatched).toEqual([]);
  });

  it.each(CODES)("%s has a singular file count", (code) => {
    expect(DICTIONARIES[code]["file.count.one"]).toEqual(expect.any(String));
  });
});

describe("keys in the code", () => {
  it("only asks for keys that exist in English", () => {
    const enNamespaces = new Set(enKeys.map((key) => key.split(".")[0]));
    const missing = [...usage.literals].filter((key) => enNamespaces.has(key.split(".")[0]) && !(key in en));
    expect(missing).toEqual([]);
  });

  it("uses every English key somewhere", () => {
    expect(enKeys.filter((key) => !usage.literals.has(key))).toEqual([]);
  });

  it("builds no translation keys at runtime", () => {
    expect(usage.templated).toEqual([]);
  });
});

describe("interpolate", () => {
  it("fills known names and keeps unknown ones", () => {
    expect(interpolate("{count} files in {folder}", { count: 3, folder: "Docs" })).toBe("3 files in Docs");
    expect(interpolate("{a} and {b}", { a: "x" })).toBe("x and {b}");
    expect(interpolate("plain text")).toBe("plain text");
  });

  it("keeps zero and empty values instead of dropping them", () => {
    expect(interpolate("{count}", { count: 0 })).toBe("0");
    expect(interpolate("[{name}]", { name: "" })).toBe("[]");
  });

  it("uses the singular and plural count forms in English", () => {
    expect(interpolate(en["file.count.one"])).toBe("1 file");
    expect(interpolate(en["file.count"], { count: 4 })).toBe("4 files");
  });
});
