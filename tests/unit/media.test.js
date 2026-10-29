import { getEncoders, probe } from "../../modules/honvert-engine";
import {
  buildAudioArgs,
  buildGifArgs,
  buildImageArgs,
  buildVideoArgs,
  cropFilter,
  estimateBytes,
  extensionFor,
  hasHardwareH264,
  orientFilters,
  pixelScale,
  probeFile,
  tagArgs,
  trimArgs,
} from "../../src/engine/media";

jest.mock("../../modules/honvert-engine", () => ({ probe: jest.fn(), getEncoders: jest.fn() }));

const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

describe("cropFilter", () => {
  it("centers the crop for each ratio", () => {
    expect(cropFilter("16:9", 1080, 1920)).toBe("crop=1080:608:0:656");
    expect(cropFilter("1:1", 1920, 1080)).toBe("crop=1080:1080:420:0");
    expect(cropFilter("4:3", 1920, 1080)).toBe("crop=1440:1080:240:0");
  });

  it("returns null when there is nothing to crop", () => {
    expect(cropFilter("original", 1920, 1080)).toBeNull();
    expect(cropFilter("unknown-ratio", 1920, 1080)).toBeNull();
    expect(cropFilter("16:9", 0, 1080)).toBeNull();
  });

  it("returns null for a picture too small to crop without an empty side", () => {
    expect(cropFilter("16:9", 1, 1)).toBeNull();
    expect(cropFilter("16:9", 4096, 1)).toBeNull();
  });
});

describe("buildImageArgs", () => {
  it("writes one frame as JPEG using the mapped quality", () => {
    expect(buildImageArgs({ input: "in.heic", output: "out.jpg", format: "jpg", quality: 90 })).toEqual([
      "-y", "-i", "in.heic", "-frames:v", "1", "-map_metadata", "-1", "-c:v", "mjpeg", "-q:v", "5", "out.jpg",
    ]);
  });

  it("maps quality 100 to the best JPEG scale and quality 1 to the worst", () => {
    expect(valueAfter(buildImageArgs({ input: "a", output: "b.jpg", format: "jpg", quality: 100 }), "-q:v")).toBe("2");
    expect(valueAfter(buildImageArgs({ input: "a", output: "b.jpg", format: "jpg", quality: 1 }), "-q:v")).toBe("31");
  });

  it("flattens transparency onto white for BMP and JPEG when the size is known", () => {
    expect(buildImageArgs({ input: "in.png", output: "out.bmp", format: "bmp", width: 4, height: 2 })).toEqual([
      "-y", "-i", "in.png", "-filter_complex",
      "color=c=white:s=4x2,format=rgba[bg];[0:v]format=rgba[fg];[bg][fg]overlay=format=auto,format=bgr24[out]",
      "-map", "[out]", "-frames:v", "1", "-map_metadata", "-1", "-c:v", "bmp", "out.bmp",
    ]);
  });

  it("scales down without going below 2 px", () => {
    const args = buildImageArgs({ input: "a.png", output: "b.png", format: "png", scalePercent: 50 });
    expect(valueAfter(args, "-vf")).toBe("scale=max(2\\,trunc(iw*0.5/2)*2):max(2\\,trunc(ih*0.5/2)*2)");
  });

  it("refuses formats that do not go through FFmpeg (WEBP is encoded natively)", () => {
    expect(() => buildImageArgs({ input: "a", output: "b", format: "webp" })).toThrow();
  });
});

describe("buildGifArgs", () => {
  it("builds a two-pass palette GIF that loops forever", () => {
    expect(buildGifArgs({ input: "clip.mp4", output: "out.gif" })).toEqual([
      "-y", "-i", "clip.mp4", "-filter_complex",
      "[0:v]fps=15,scale='min(iw\\,480)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer",
      "-an", "-loop", "0", "out.gif",
    ]);
  });

  it("drops the frame-rate filter for a single still frame", () => {
    const graph = valueAfter(buildGifArgs({ input: "still.png", output: "out.gif", still: true }), "-filter_complex");
    expect(graph).not.toContain("fps=");
  });

  it("applies speed before the palette", () => {
    const graph = valueAfter(buildGifArgs({ input: "clip.mp4", output: "out.gif", speed: 2 }), "-filter_complex");
    expect(graph.startsWith("[0:v]setpts=PTS/2,")).toBe(true);
  });
});

describe("buildAudioArgs", () => {
  it("maps each format to its codec and bitrate", () => {
    expect(buildAudioArgs({ input: "a.mp4", output: "a.mp3", format: "mp3", bitrate: 192 })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "a.mp3",
    ]);
    expect(buildAudioArgs({ input: "a.mp4", output: "a.ogg", format: "ogg", bitrate: 96 })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "libopus", "-b:a", "96k", "a.ogg",
    ]);
    expect(buildAudioArgs({ input: "a.mp4", output: "a.wav", format: "wav" })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "pcm_s16le", "a.wav",
    ]);
    expect(buildAudioArgs({ input: "a.mp4", output: "a.flac", format: "flac" })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "flac", "a.flac",
    ]);
  });

  it("changes the tempo only when the speed differs from 1", () => {
    expect(valueAfter(buildAudioArgs({ input: "a", output: "b.m4a", format: "m4a", speed: 1.5 }), "-af")).toBe("atempo=1.5");
    expect(buildAudioArgs({ input: "a", output: "b.m4a", format: "m4a" })).not.toContain("-af");
  });
});

describe("buildVideoArgs", () => {
  it("encodes MP4 with H.264 and AAC, faststart, and a player-friendly pixel format", () => {
    expect(buildVideoArgs({ input: "in.mov", output: "out.mp4", format: "mp4" })).toEqual([
      "-y", "-i", "in.mov", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libopenh264", "-b:v", "2000k",
      "-c:a", "aac", "-b:a", "128k",
      "-map_metadata", "-1",
      "-movflags", "+faststart", "out.mp4",
    ]);
  });

  it("encodes WEBM with VP8 and Opus, always in software", () => {
    expect(buildVideoArgs({ input: "in.mov", output: "out.webm", format: "webm", hardware: true })).toEqual([
      "-y", "-i", "in.mov", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libvpx", "-b:v", "2000k", "-deadline", "realtime", "-cpu-used", "6",
      "-c:a", "libopus", "-b:a", "96k", "-map_metadata", "-1", "out.webm",
    ]);
  });

  it("uses the hardware encoder for MP4 only when asked", () => {
    expect(valueAfter(buildVideoArgs({ input: "a", output: "b.mp4", format: "mp4", hardware: true }), "-c:v")).toBe("h264_mediacodec");
  });

  it("drops the audio track when asked and scales only when a height is set", () => {
    const args = buildVideoArgs({ input: "a", output: "b.mp4", format: "mp4", keepAudio: false, height: 480 });
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
    expect(valueAfter(args, "-vf")).toBe("scale=-2:min(ih\\,480),scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
  });

  it("writes MKV and MOV with H.264, and MOV with faststart", () => {
    const mkv = buildVideoArgs({ input: "a", output: "b.mkv", format: "mkv" });
    expect(valueAfter(mkv, "-c:v")).toBe("libopenh264");
    expect(mkv).not.toContain("+faststart");
    const mov = buildVideoArgs({ input: "a", output: "b.mov", format: "mov", hardware: true });
    expect(valueAfter(mov, "-c:v")).toBe("h264_mediacodec");
    expect(mov).toContain("+faststart");
  });

  it("applies frame rate, rotation, mirroring, trim, loudness and kept metadata", () => {
    const args = buildVideoArgs({
      input: "a", output: "b.mp4", format: "mp4",
      fps: 30, rotate: 90, flip: "horizontal", normalize: true, metadata: "keep", startMs: 15000, endMs: 80000,
    });
    expect(args.slice(0, 6)).toEqual(["-y", "-ss", "15.000", "-to", "80.000", "-i"]);
    expect(valueAfter(args, "-vf")).toBe("fps=30,hflip,transpose=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
    expect(valueAfter(args, "-af")).toBe("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(args).not.toContain("-map_metadata");
  });
});

describe("orientFilters", () => {
  it.each([
    [0, "none", []],
    [90, "none", ["transpose=1"]],
    [180, "none", ["hflip", "vflip"]],
    [270, "none", ["transpose=2"]],
    [0, "vertical", ["vflip"]],
    [270, "horizontal", ["hflip", "transpose=2"]],
  ])("rotate %d flip %s -> %j", (rotate, flip, expected) => {
    expect(orientFilters(rotate, flip)).toEqual(expected);
  });
});

describe("trimArgs, tagArgs, extensionFor and estimateBytes", () => {
  it("seeks only when there is a range", () => {
    expect(trimArgs(0, 0)).toEqual([]);
    expect(trimArgs(1500, 0)).toEqual(["-ss", "1.500"]);
    expect(trimArgs(0, 2000)).toEqual(["-to", "2.000"]);
    expect(trimArgs(3000, 1000)).toEqual(["-ss", "3.000"]);
  });

  it("writes only the tags that were filled in", () => {
    expect(tagArgs({ title: " Song ", artist: "", year: "2026" })).toEqual(["-metadata", "title=Song", "-metadata", "date=2026"]);
    expect(tagArgs()).toEqual([]);
  });

  it("maps ALAC to the m4a extension and keeps the rest", () => {
    expect(extensionFor("alac")).toBe("m4a");
    expect(extensionFor("opus")).toBe("opus");
  });

  it("estimates bytes from bitrate, duration, speed and trim", () => {
    expect(estimateBytes({ durationMs: 60000, videoKbps: 2000, audioKbps: 128 })).toBe(15960000);
    expect(estimateBytes({ durationMs: 60000, audioKbps: 128, speed: 2 })).toBe(480000);
    expect(estimateBytes({ durationMs: 60000, audioKbps: 128, startMs: 30000 })).toBe(480000);
    expect(estimateBytes({ durationMs: 0, audioKbps: 128 })).toBe(0);
    expect(estimateBytes({ durationMs: 60000 })).toBe(0);
  });
});

describe("new audio and GIF options", () => {
  it("encodes ALAC, AAC and Opus, mono, loudness and tags", () => {
    expect(valueAfter(buildAudioArgs({ input: "a", output: "b.m4a", format: "alac" }), "-c:a")).toBe("alac");
    expect(valueAfter(buildAudioArgs({ input: "a", output: "b.aac", format: "aac" }), "-c:a")).toBe("aac");
    const args = buildAudioArgs({
      input: "a", output: "b.opus", format: "opus", channels: "mono", normalize: true, tags: { artist: "Me" },
    });
    expect(valueAfter(args, "-c:a")).toBe("libopus");
    expect(valueAfter(args, "-ac")).toBe("1");
    expect(valueAfter(args, "-af")).toBe("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(valueAfter(args, "-metadata")).toBe("artist=Me");
  });

  it("plays GIFs in reverse or as a boomerang, and sets the loop count", () => {
    const reverse = buildGifArgs({ input: "a", output: "b.gif", playback: "reverse", loop: "once" });
    expect(valueAfter(reverse, "-filter_complex")).toContain(",reverse,split[a][b]");
    expect(valueAfter(reverse, "-loop")).toBe("-1");
    const boomerang = buildGifArgs({ input: "a", output: "b.gif", playback: "boomerang", loop: "three" });
    expect(valueAfter(boomerang, "-filter_complex")).toContain("[f][rv]concat=n=2:v=1");
    expect(valueAfter(boomerang, "-loop")).toBe("2");
    const still = buildGifArgs({ input: "a", output: "b.gif", playback: "reverse", still: true, startMs: 5000 });
    expect(valueAfter(still, "-filter_complex")).not.toContain("reverse");
    expect(still).not.toContain("-ss");
  });

  it("writes TIFF with deflate and applies rotation to images", () => {
    const args = buildImageArgs({ input: "a.png", output: "b.tiff", format: "tiff", rotate: 180 });
    expect(valueAfter(args, "-c:v")).toBe("tiff");
    expect(valueAfter(args, "-vf")).toBe("hflip,vflip");
  });
});

describe("probeFile", () => {
  it("reads duration, size, codec and streams", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({
      format: { duration: "12.5" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, { codec_type: "audio" }],
    }));
    expect(await probeFile("a.mp4")).toEqual({ durationMs: 12500, width: 1920, height: 1080, codec: "h264", hasVideo: true, hasAudio: true });
  });

  it("swaps width and height for a 90 or 270 degree rotation", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({
      streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
    }));
    const info = await probeFile("phone.mp4");
    expect([info.width, info.height]).toEqual([1080, 1920]);
  });

  it("reads the rotate tag and keeps the size for 180 degrees", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({
      streams: [{ codec_type: "video", width: 640, height: 480, tags: { rotate: "180" } }],
    }));
    const info = await probeFile("flipped.mp4");
    expect([info.width, info.height]).toEqual([640, 480]);
  });

  it("reports zero for missing or unreadable durations and empty files", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({ format: { duration: "N/A" }, streams: [] }));
    expect(await probeFile("x")).toEqual({ durationMs: 0, width: 0, height: 0, codec: "", hasVideo: false, hasAudio: false });
  });
});

describe("hasHardwareH264", () => {
  it("is true only when a hardware AVC encoder exists", () => {
    getEncoders.mockReturnValueOnce([{ hardware: false }, { hardware: true }]);
    expect(hasHardwareH264()).toBe(true);
    getEncoders.mockReturnValueOnce([{ hardware: false }]);
    expect(hasHardwareH264()).toBe(false);
  });

  it("treats a failing native call as no hardware", () => {
    getEncoders.mockImplementationOnce(() => {
      throw new Error("no module");
    });
    expect(hasHardwareH264()).toBe(false);
  });
});

describe("pixelScale", () => {
  it("scales to exact pixels, keeping the proportion when one side is empty", () => {
    expect(pixelScale("800", "600")).toBe("scale=800:600:flags=lanczos");
    expect(pixelScale("800", "")).toBe("scale=800:-2:flags=lanczos");
    expect(pixelScale("", "600")).toBe("scale=-2:600:flags=lanczos");
  });

  it("ignores empty, tiny, invalid and huge values", () => {
    expect(pixelScale("", "")).toBeNull();
    expect(pixelScale("1", "abc")).toBeNull();
    expect(pixelScale("99999", "")).toBe("scale=16384:-2:flags=lanczos");
  });
});

describe("new output formats", () => {
  it("applies exact pixels after rotation", () => {
    const args = buildImageArgs({ input: "a.png", output: "b.png", format: "png", width: 100, height: 50, rotate: 90, scalePercent: "custom", pixelWidth: "40" });
    expect(valueAfter(args, "-vf")).toBe("transpose=1,scale=40:-2:flags=lanczos");
  });

  it("caps icons at 256 px and stores PNG frames", () => {
    const args = buildImageArgs({ input: "a.png", output: "b.ico", format: "ico", width: 1024, height: 1024 });
    expect(valueAfter(args, "-vf")).toContain("min(256");
    expect(valueAfter(args, "-vf").endsWith(",format=rgba")).toBe(true);
    expect(valueAfter(args, "-c:v")).toBe("png");
  });

  it("writes AVI as XviD with MP3 audio", () => {
    const args = buildVideoArgs({ input: "a.mp4", output: "b.avi", format: "avi", inputWidth: 640, inputHeight: 360 });
    expect(valueAfter(args, "-c:v")).toBe("mpeg4");
    expect(valueAfter(args, "-vtag")).toBe("xvid");
    expect(valueAfter(args, "-c:a")).toBe("libmp3lame");
    expect(args).not.toContain("-movflags");
  });

  it("limits GIF colors and picks the dither pattern", () => {
    const args = buildGifArgs({ input: "a.mp4", output: "b.gif", colors: 64, dither: "sierra2_4a" });
    expect(valueAfter(args, "-filter_complex")).toContain("palettegen=max_colors=64:stats_mode=diff");
    expect(valueAfter(args, "-filter_complex")).toContain("paletteuse=dither=sierra2_4a");
    const fallback = buildGifArgs({ input: "a.mp4", output: "b.gif", colors: 7, dither: "evil;rm" });
    expect(valueAfter(fallback, "-filter_complex")).toContain("palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer");
  });
});
