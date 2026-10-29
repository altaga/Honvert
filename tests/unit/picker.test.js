import { pickFiles, takePendingPick } from "../../modules/honvert-engine";
import { parsePick, pick, restorePendingPick, takeRestoredPick } from "../../src/engine/picker";

jest.mock("../../modules/honvert-engine", () => ({ pickFiles: jest.fn(), takePendingPick: jest.fn() }));

const result = (overrides = {}) =>
  JSON.stringify({
    canceled: false,
    tag: JSON.stringify({ kind: "repair", mode: undefined, slot: "files" }),
    files: [{ name: "a.mp3", path: "/cache/picked/x/0/a.mp3", mime: "audio/mpeg", size: 120 }],
    error: null,
    ...overrides,
  });

describe("parsePick", () => {
  it("reads the picked files and where they go", () => {
    expect(parsePick(result())).toEqual({
      canceled: false,
      failed: false,
      tag: { kind: "repair", slot: "files" },
      files: [{ name: "a.mp3", path: "/cache/picked/x/0/a.mp3", mime: "audio/mpeg", size: 120 }],
    });
  });

  it("treats a cancel, no files, or broken JSON as a cancel", () => {
    expect(parsePick(result({ canceled: true, files: [] })).canceled).toBe(true);
    expect(parsePick(result({ files: [] })).canceled).toBe(true);
    expect(parsePick("{not json").canceled).toBe(true);
    expect(parsePick(result({ tag: "{bad" })).canceled).toBe(true);
  });

  it("drops entries without a path and fills missing fields", () => {
    const parsed = parsePick(result({ files: [null, { path: "" }, { path: "/x/b.wav", size: "oops" }] }));
    expect(parsed.files).toEqual([{ name: "b.wav", path: "/x/b.wav", mime: "", size: 0 }]);
  });

  it("reports files that could not be read", () => {
    expect(parsePick(result({ error: "unreadable" })).failed).toBe(true);
    expect(parsePick(result({ files: [], error: "unreadable" }))).toMatchObject({ canceled: true, failed: true });
  });
});

describe("pick", () => {
  it("sends the tag as JSON and parses the answer", async () => {
    pickFiles.mockResolvedValueOnce(result());
    const picked = await pick(["audio/*"], true, { kind: "repair", slot: "files" });
    expect(pickFiles).toHaveBeenCalledWith(["audio/*"], true, JSON.stringify({ kind: "repair", slot: "files" }));
    expect(picked.files).toHaveLength(1);
  });
});

describe("files picked while the app restarted", () => {
  it("reopens the converter once and hands it the files once", () => {
    takePendingPick.mockReturnValueOnce(result());
    expect(restorePendingPick()).toBe("/convert/repair");
    expect(takeRestoredPick("image")).toBeNull();
    expect(takeRestoredPick("repair").files[0].name).toBe("a.mp3");
    expect(takeRestoredPick("repair")).toBeNull();
  });

  it("does nothing when there is nothing pending, it was canceled, or the native call fails", () => {
    takePendingPick.mockReturnValueOnce(null);
    expect(restorePendingPick()).toBeNull();
    takePendingPick.mockReturnValueOnce(result({ canceled: true }));
    expect(restorePendingPick()).toBeNull();
    takePendingPick.mockImplementationOnce(() => {
      throw new Error("no module");
    });
    expect(restorePendingPick()).toBeNull();
  });
});
