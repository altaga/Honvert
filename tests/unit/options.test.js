import en from "../../src/i18n/locales/en";
import { RATIOS } from "../../src/engine/media";
import { CATEGORIES, PDF_MODES, PDF_QUALITY, RATIO_CHOICES } from "../../src/engine/options";

jest.mock("../../modules/honvert-engine", () => ({ probe: jest.fn(), getEncoders: jest.fn() }));

const hasKey = (key) => Object.prototype.hasOwnProperty.call(en, key);
const NAMES = Object.keys(CATEGORIES);

describe("categories", () => {
  it.each(NAMES)("%s has translated titles and format hints", (name) => {
    const config = CATEGORIES[name];
    for (const key of [config.titleKey, config.subtitleKey, config.formatsKey]) {
      expect(hasKey(key)).toBe(true);
    }
  });

  it.each(NAMES.filter((name) => name !== "pdf"))("%s has a translated accept hint and a valid picker", (name) => {
    const { acceptKey, picker } = CATEGORIES[name];
    expect(hasKey(acceptKey)).toBe(true);
    expect(picker.types.length).toBeGreaterThan(0);
    expect(typeof picker.multiple).toBe("boolean");
  });
});

describe.each(NAMES)("%s controls", (name) => {
  const config = CATEGORIES[name];

  it("have translated labels and translated or fixed choice labels", () => {
    for (const control of config.controls) {
      expect(hasKey(control.labelKey)).toBe(true);
      for (const choice of control.choices) {
        if (choice.labelKey) expect(hasKey(choice.labelKey)).toBe(true);
        else expect(typeof choice.label).toBe("string");
      }
    }
  });

  it("have a default that is one of their choices", () => {
    for (const control of config.controls) {
      expect(control.key in config.defaults).toBe(true);
      expect(control.choices.map((choice) => choice.value)).toContain(config.defaults[control.key]);
    }
  });

  it("list only real controls as advanced", () => {
    const keys = config.controls.map((control) => control.key);
    for (const key of config.advanced) expect(keys).toContain(key);
  });
});

describe("shared choices", () => {
  it("keep every speed inside the 0.5x to 2x range that FFmpeg tempo accepts", () => {
    for (const config of Object.values(CATEGORIES)) {
      for (const control of config.controls) {
        if (control.key !== "speed") continue;
        for (const choice of control.choices) {
          expect(choice.value >= 0.5 && choice.value <= 2).toBe(true);
        }
      }
    }
  });

  it("only offer crops the media module knows", () => {
    for (const choice of RATIO_CHOICES) expect(choice.value in RATIOS).toBe(true);
  });
});

describe("PDF", () => {
  it.each(Object.entries(PDF_MODES))("%s has translated labels and a valid picker", (mode, config) => {
    expect(hasKey(config.labelKey)).toBe(true);
    expect(hasKey(config.acceptKey)).toBe(true);
    expect(config.picker.length).toBeGreaterThan(0);
    expect(typeof config.multiple).toBe("boolean");
  });

  it("has a quality preset for every quality choice", () => {
    const qualityChoices = CATEGORIES.pdf.controls.find((control) => control.key === "quality").choices.map((choice) => choice.value);
    expect(Object.keys(PDF_QUALITY).sort()).toEqual([...qualityChoices].sort());
  });
});
