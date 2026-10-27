import { EngineError, JobCancelled, keyForFfmpeg, keyForPdf } from "../../src/engine/errors";

describe("EngineError and JobCancelled", () => {
  it("carry a translation key and a technical detail", () => {
    const error = new EngineError("error.corrupt", "moov atom not found");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EngineError");
    expect(error.key).toBe("error.corrupt");
    expect(error.detail).toBe("moov atom not found");
    expect(new EngineError("error.generic").detail).toBe("");
  });

  it("marks a cancellation so callers can stay silent", () => {
    const error = new JobCancelled();
    expect(error).toBeInstanceOf(JobCancelled);
    expect(error.name).toBe("JobCancelled");
  });
});

describe("keyForFfmpeg", () => {
  it.each([
    ["Unknown encoder 'libx265'", "error.unsupported"],
    ["No such filter: 'foo'", "error.unsupported"],
    ["Unknown input format: 'xyz'", "error.unsupported"],
    ["Invalid data found when processing input", "error.corrupt"],
    ["moov atom not found", "error.corrupt"],
    ["Conversion failed!", "error.generic"],
    ["", "error.generic"],
  ])("%j -> %s", (output, key) => {
    expect(keyForFfmpeg(output)).toBe(key);
  });
});

describe("keyForPdf", () => {
  it("tells encrypted files apart from broken ones", () => {
    expect(keyForPdf(new Error("This document is encrypted"))).toBe("error.pdfEncrypted");
    expect(keyForPdf("Password required")).toBe("error.pdfEncrypted");
    expect(keyForPdf(new Error("xref missing"))).toBe("error.pdfInvalid");
    expect(keyForPdf(undefined)).toBe("error.pdfInvalid");
    expect(keyForPdf(null)).toBe("error.pdfInvalid");
  });
});
