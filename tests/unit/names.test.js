import { clipBytes, fileNameFor, reencodeTarget, repairExtension, stemOf, withoutExtension } from "../../src/engine/names";

const bytes = (text) => new TextEncoder().encode(text).length;

describe("withoutExtension", () => {
  it.each([
    ["video.mp4", "video"],
    ["archive.tar.gz", "archive.tar"],
    ["README", "README"],
    [".bashrc", ""],
    ["", ""],
  ])("%j -> %j", (name, expected) => {
    expect(withoutExtension(name)).toBe(expected);
  });
});

describe("clipBytes", () => {
  it("keeps whole characters inside the byte budget", () => {
    expect(clipBytes("héllo", 3)).toBe("hé");
    expect(clipBytes("🎬🎬", 5)).toBe("🎬");
    expect(clipBytes("abc", 0)).toBe("");
    expect(clipBytes("abc", 10)).toBe("abc");
  });
});

describe("stemOf", () => {
  it("makes a readable, file-system-safe stem", () => {
    expect(stemOf("Mi Video Final.mp4")).toBe("Mi_Video_Final");
    expect(stemOf('a/b\\c:d*e?f"g<h>i|j.png')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(stemOf("视频 文件.mov")).toBe("视频_文件");
    expect(stemOf("emoji 🎬.mov")).toBe("emoji_🎬");
  });

  it("falls back to a fixed name when nothing is left", () => {
    expect(stemOf("")).toBe("file");
    expect(stemOf(".mp4")).toBe("file");
  });

  it("caps the stem at 96 bytes without splitting a character", () => {
    const stem = stemOf(`${"🎬".repeat(60)}.mp4`);
    expect(bytes(stem)).toBeLessThanOrEqual(96);
    expect(stem).toBe("🎬".repeat(24));
  });
});

describe("fileNameFor", () => {
  it("keeps the typed name and the result's extension", () => {
    expect(fileNameFor("mi_pdf_reparado", "broken-repaired-x.pdf")).toBe("mi_pdf_reparado.pdf");
    expect(fileNameFor("mi pdf", "a.pdf")).toBe("mi pdf.pdf");
  });

  it("does not repeat an extension the user typed", () => {
    expect(fileNameFor("mi_pdf_reparado.pdf", "a.pdf")).toBe("mi_pdf_reparado.pdf");
    expect(fileNameFor("MI.PDF", "a.pdf")).toBe("MI.pdf");
  });

  it("replaces characters a file system refuses", () => {
    expect(fileNameFor("a/b:c*d", "x.png")).toBe("a_b_c_d.png");
    expect(fileNameFor("tab\tname\u0000", "x.png")).toBe("tab_name_.png");
  });

  it("falls back to honvert when nothing usable was typed", () => {
    expect(fileNameFor("   ", "x.png")).toBe("honvert.png");
    expect(fileNameFor(undefined, "x.png")).toBe("honvert.png");
    expect(fileNameFor("nombre", "sinextension")).toBe("nombre");
  });

  it("caps the typed name at 200 bytes", () => {
    expect(fileNameFor("a".repeat(400), "x.mp4")).toBe(`${"a".repeat(200)}.mp4`);
  });
});

describe("repairExtension", () => {
  it.each([
    ["zip", "report.docx", "docx"],
    ["zip", "SHEET.XLSX", "xlsx"],
    ["zip", "bundle.zip", "zip"],
    ["zip", "noextension", "zip"],
    ["jpeg", "photo.JPEG", "jpg"],
    ["png", "scan.bin", "png"],
    ["unknown", "data.bin", null],
  ])("%s %j -> %j", (type, name, expected) => {
    expect(repairExtension(type, name)).toBe(expected);
  });
});

describe("reencodeTarget", () => {
  it.each([
    ["/data/converted/out.mkv", "/data/converted/out.mkv"],
    ["/data/converted/out.MOV", "/data/converted/out.MOV"],
    ["/data/converted/out.mp4", "/data/converted/out.mp4"],
    ["/data/converted/out.avi", "/data/converted/out.mp4"],
    ["/data.v2/converted/out", "/data.v2/converted/out.mp4"],
    ["/data/converted/.hidden", "/data/converted/.hidden.mp4"],
  ])("%s -> %s", (output, expected) => {
    expect(reencodeTarget(output)).toBe(expected);
  });
});
